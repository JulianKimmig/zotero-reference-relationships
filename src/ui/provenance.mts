/** Literal explanations linking effective edges to actual explicit roots and versioned rules. */
import { check } from '../domain/values.mts';
import { element, metadataText } from './dom.mts';
import { ruleButton } from './rule-controls.mts';
import type { Graph, ItemRef, Rule } from '../domain/contracts.mts';
import type { Relationship } from '../domain/projection-contracts.mts';
import type { RelationshipApplication } from '../application/service.mts';
import type { EndpointDescription } from '../application/contracts.mts';
import type { Localizer } from './contracts.mts';

/** Render a complete declarative definition without interpreting user text as markup or code. @param {object} options {document,parent,rule,snapshot,t}. @returns {void} */
export function ruleDefinition({ document, parent, rule, snapshot, t }: { document: Document; parent: HTMLElement; rule: Rule; snapshot: Graph; t: Localizer }): void {
  const type = (id: string) => { const value = snapshot.types.find(type => type.id === id); check(!!value, 'Rule explanation has an unknown type'); return `${value.label} (${id})`; };
  parent.append(element(document, 'p', {}, `${rule.id} · ${t('version')} ${rule.version} · ${t('enabled')}: ${rule.enabled}`));
  parent.append(element(document, 'p', {}, `${t('root-type')}: ${type(rule.rootType)}; ${t('input-type')}: ${type(rule.inputType)}; ${t('output-type')}: ${type(rule.outputType)}; ${t('transform')}: ${t(rule.transform)}`));
  for (const condition of rule.conditions) parent.append(element(document, 'p', {},
    `${t('conditions')}: ${condition.field} ${t(condition.op)} ${JSON.stringify(condition.value)}`));
  for (const [field, expression] of Object.entries(rule.mapping)) parent.append(element(document, 'p', {},
    `${t('mappings')}: ${field} ← ${t(expression.kind)}: ${expression.kind === 'root' ? expression.field : JSON.stringify(expression.value)}`));
}

/** Render actual root/assertion details and support pages of at most 25 entries. @param {object} options {document,parent,edge,snapshot,descriptions,t,signal}; signal owns pagination listeners. @returns {void} */
export function provenance({ document, parent, edge, snapshot, descriptions, t, signal }: {
  document: Document; parent: HTMLElement; edge: Relationship; snapshot: Graph; descriptions: Map<string, EndpointDescription>; t: Localizer; signal: AbortSignal;
}): void {
  const label = (ref: ItemRef) => { const value = descriptions.get(JSON.stringify(ref)); check(!!value, 'Missing endpoint explanation'); return value.title; };
  const type = (id: string) => { const value = snapshot.types.find(type => type.id === id); check(!!value, 'Unknown explanation type'); return value; };
  const roots = new Map(snapshot.assertions.map(assertion => [assertion.id, assertion]));
  for (const id of edge.assertions) {
    const root = roots.get(id); check(!!root, 'Manual explanation has no assertion');
    parent.append(element(document, 'p', {}, `${t('manual')}: ${id} · ${metadataText(root.metadata, type(root.type))}`));
  }
  const body = element(document, 'div'), paging = element(document, 'div'); let offset = 0;
  parent.append(body, paging);
  const owner = { document, t, signal };
  const previous = ruleButton(owner, 'previous', 'support-previous', () => { offset -= 25; render(); });
  const next = ruleButton(owner, 'next', 'support-next', () => { offset += 25; render(); });
  paging.append(previous, next); paging.hidden = edge.supports.length <= 25;
  /** Paint a bounded contributor page without losing access to any support. @returns {void} */
  function render() {
    body.replaceChildren(); previous.disabled = offset === 0; next.disabled = offset + 25 >= edge.supports.length;
    for (const support of edge.supports.slice(offset, offset + 25)) {
      const root = roots.get(support.root), rule = snapshot.rules.find(rule => rule.id === support.rule && rule.version === support.version);
      check(!!root && !!rule, 'Generated explanation has no current root or rule');
      const section = element(document, 'section', { 'data-rr-support': support.rule });
      section.append(element(document, 'p', {}, `${t('root-assertion')}: ${root.id} · ${label(root.source)} → ${type(root.type).label} → ${label(root.target)}`));
      section.append(element(document, 'p', {}, metadataText(root.metadata, type(root.type))));
      ruleDefinition({ document, parent: section, rule, snapshot, t });
      section.append(element(document, 'p', {}, `${t('support')}: ${metadataText(support.metadata, type(support.type))}`));
      body.append(section);
    }
  }
  render();
}

/** Describe every referenced endpoint needed for one bounded edge page, including its supporting roots. @param {object} app Public application. @param {object[]} edges Page. @param {object[]} snapshots Relevant before/after authorities. @returns {Promise<Map>} Exact ItemRef JSON to native descriptions. */
export async function describeContributors(app: RelationshipApplication, edges: Relationship[], snapshots: Graph[]): Promise<Map<string, EndpointDescription>> {
  const refs = new Map<string, ItemRef>(), rootIDs = new Set(edges.flatMap(edge => edge.supports.map(support => support.root)));
  for (const edge of edges) for (const ref of [edge.source, edge.target]) refs.set(JSON.stringify(ref), ref);
  for (const snapshot of snapshots) for (const assertion of snapshot.assertions) {
    if (rootIDs.has(assertion.id)) for (const ref of [assertion.source, assertion.target]) refs.set(JSON.stringify(ref), ref);
  }
  return new Map(await Promise.all([...refs].map(async ([key, ref]) => [key, await app.describe(ref)] as const)));
}
