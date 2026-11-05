/** Deterministic fieldwise contributor aggregation without manual priority or silent overwrites. */
import { ContractError } from './values.mts';
import { edgeKey } from './graph-contract.mts';
import type { Assertion, Edge, Metadata } from './contracts.mts';
import type { ContributorIdentity, EdgeAccumulator, Relationship, Support } from './projection-contracts.mts';

/** Compare stable IDs/keys independent of locale. @param {string} a First. @param {string} b Second. @returns {number} Lexical order. */
function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }

/** Build a private effective-edge collection for one validated evaluation. */
export class Contributions {
  readonly edges: Map<string, EdgeAccumulator>;
  /** Initialize an empty collection; no authority or global state is retained. */
  constructor() { this.edges = new Map(); }

  /** Find/create the private edge corresponding to an actual contribution. @param {object} value Assertion/support. @returns {object} Private accumulator. */
  edge(value: Edge): EdgeAccumulator {
    const key = edgeKey(value);
    if (!this.edges.has(key)) this.edges.set(key, { key, source: { ...value.source }, type: value.type,
      target: { ...value.target }, fields: new Map(), assertions: new Set(), supports: new Map() });
    return this.edges.get(key)!;
  }

  /** Merge present equal primitive fields or throw with two deterministic conflict witnesses. @param {object} edge Accumulator. @param {object} metadata Valid fields. @param {object} identity Contributor descriptor. @returns {void} */
  metadata(edge: EdgeAccumulator, metadata: Metadata, identity: ContributorIdentity): void {
    for (const [field, value] of Object.entries(metadata)) {
      const previous = edge.fields.get(field), contributor = { ...identity, value };
      if (previous && previous.value !== value) {
        throw new ContractError('conflict', `Conflicting relationship metadata for ${field}`, {
          key: edge.key, field, contributors: [previous.contributor, contributor],
        });
      }
      if (!previous) edge.fields.set(field, { value, contributor });
    }
  }

  /** Add independent explicit authority to its effective triple. @param {object} assertion Valid manual assertion. @returns {void} */
  manual(assertion: Assertion): void {
    const edge = this.edge(assertion);
    this.metadata(edge, assertion.metadata, { kind: 'assertion', id: assertion.id });
    edge.assertions.add(assertion.id);
  }

  /** Collect producing-rule support even if traversal already visited its output. @param {object} support Exact valid support. @returns {void} */
  generated(support: Support): void {
    const edge = this.edge(support), key = JSON.stringify([support.root, support.rule, edge.key]);
    if (edge.supports.has(key)) return;
    this.metadata(edge, support.metadata, { kind: 'support', root: support.root, rule: support.rule, version: support.version });
    edge.supports.set(key, { ...support, source: { ...support.source }, target: { ...support.target }, metadata: { ...support.metadata } });
  }

  /** Publish sorted detached effective entities; never apply the stored-graph byte cap to computed supports. @returns {object[]} Frozen-contract relationship entities. */
  relationships(): Relationship[] {
    return [...this.edges.values()].sort((a, b) => compare(a.key, b.key)).map(edge => ({
      key: edge.key, source: edge.source, type: edge.type, target: edge.target,
      metadata: Object.fromEntries([...edge.fields].sort(([a], [b]) => compare(a, b)).map(([field, entry]) => [field, entry.value])),
      assertions: [...edge.assertions].sort(compare),
      supports: [...edge.supports.values()].sort((a, b) => compare(a.root, b.root) || compare(a.rule, b.rule)),
    }));
  }
}
