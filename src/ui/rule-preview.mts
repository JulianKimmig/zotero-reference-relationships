/** Bounded impact pages show complete old/new rules and contributor explanations before publication. */
import { element, metadataText } from './dom.mts';
import { ruleButton } from './rule-controls.mts';
import { ruleDefinition, provenance, describeContributors } from './provenance.mts';
import { projectionReview } from './projection-review.mts';
import type { Graph } from '../domain/contracts.mts';
import type { Relationship } from '../domain/projection-contracts.mts';
import type { Review } from '../application/contracts.mts';
import type { PreviewOwner } from './contracts.mts';

/** Render a detached complete review with at most 25 affected edges mounted per page. @param {object} options {view,parent,before,review,signal,onError}. @returns {Promise<object>} dispose hook for late page responses. */
export async function rulePreview({ view, parent, before, review, signal, onError }: {
  view: PreviewOwner; parent: HTMLElement; before: Graph; review: Review; signal: AbortSignal; onError(error: unknown): void;
}) {
  const { document, t, app } = view, after = review.snapshot, delta = review.changeSet;
  let generation = 0, disposed = false, offset = 0;
  const container = element(document, 'div'); parent.replaceChildren(container);
  for (const rule of delta.rules.added) {
    container.append(element(document, 'h4', {}, t('added'))); ruleDefinition({ document, parent: container, rule, snapshot: after, t });
  }
  for (const pair of delta.rules.updated) for (const [key, rule, snapshot] of [['before', pair.before, before], ['after', pair.after, after]] as const) {
    container.append(element(document, 'h4', {}, t(key))); ruleDefinition({ document, parent: container, rule, snapshot, t });
  }
  for (const rule of delta.rules.removed) {
    container.append(element(document, 'h4', {}, t('removed'))); ruleDefinition({ document, parent: container, rule, snapshot: before, t });
  }
  if (delta.derived === null) {
    const impact = projectionReview({ view, parent: container, review, signal });
    return {
      /** Dispose only this complete conflict review's owned resources. @returns {void} */
      dispose() { impact.dispose(); container.remove(); },
    };
  }
  parent.dataset.rrAdded = String(delta.derived.added.length); parent.dataset.rrUpdated = String(delta.derived.updated.length);
  parent.dataset.rrRemoved = String(delta.derived.removed.length);
  container.prepend(element(document, 'p', {}, `${t('added')}: ${delta.derived.added.length} · ${t('updated')}: ${delta.derived.updated.length} · ${t('removed')}: ${delta.derived.removed.length}`));
  const impacts: { kind: string; before?: Relationship; after?: Relationship }[] = [...delta.derived.added.map(edge => ({ kind: 'added', after: edge })),
    ...delta.derived.updated.map(pair => ({ kind: 'updated', ...pair })),
    ...delta.derived.removed.map(edge => ({ kind: 'removed', before: edge }))];
  if (!impacts.length && !delta.rules.added.length && !delta.rules.updated.length && !delta.rules.removed.length) container.append(element(document, 'p', {}, t('no-changes')));
  const body = element(document, 'div'), paging = element(document, 'div'); container.append(body, paging);
  const owner = { document, t, signal };
  const previous = ruleButton(owner, 'previous', 'impact-previous', () => { offset -= 25; page().catch(onError); });
  const next = ruleButton(owner, 'next', 'impact-next', () => { offset += 25; page().catch(onError); });
  paging.append(previous, next); paging.hidden = impacts.length <= 25;

  /** Paint one bounded page immediately, then fill native titles and exact support details for that generation. @returns {Promise<void>} */
  async function page() {
    const token = ++generation, selected = impacts.slice(offset, offset + 25), cards: HTMLElement[] = [];
    parent.setAttribute('aria-busy', 'true');
    body.replaceChildren(); previous.disabled = offset === 0; next.disabled = offset + 25 >= impacts.length;
    for (const impact of selected) {
      const card = element(document, 'section', { 'data-rr-impact': impact.kind });
      card.append(element(document, 'h4', {}, t(impact.kind))); body.append(card); cards.push(card);
    }
    const edges = selected.flatMap(impact => [impact.before, impact.after].filter(edge => edge !== undefined));
    const descriptions = await describeContributors(app, edges, [before, after]);
    if (disposed || signal.aborted || token !== generation) return;
    selected.forEach((impact, index) => {
      for (const [key, snapshot] of [['before', before], ['after', after]] as const) {
        const edge = impact[key]; if (!edge) continue;
        const section = element(document, 'section'), type = snapshot.types.find(type => type.id === edge.type)!;
        section.append(element(document, 'p', {}, `${t(key)}: ${descriptions.get(JSON.stringify(edge.source))!.title} → ${type.label} (${type.id}) → ${descriptions.get(JSON.stringify(edge.target))!.title}`));
        section.append(element(document, 'p', {}, metadataText(edge.metadata, type)));
        provenance({ document, parent: section, edge, snapshot, descriptions, t, signal }); cards[index].append(section);
      }
    });
    parent.setAttribute('aria-busy', 'false');
  }
  await page();
  return {
    /** Discard only this preview's DOM; a late page must never clear a newer preview. @returns {void} */
    dispose() { disposed = true; generation++; container.remove(); },
  };
}
