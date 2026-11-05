/** Complete conflicted-before and valid-after inspection, with no invented aggregate delta. */
import { check } from '../domain/values.mts';
import { element } from './dom.mts';
import { ruleButton } from './rule-controls.mts';
import { contributorValues, literalValues } from './contributor-values.mts';
import { validateItemRef } from '../domain/graph-contract.mts';
import type { Review } from '../application/contracts.mts';
import type { PreviewOwner } from './contracts.mts';

/** Render complete before/after contributor reports using bounded cluster/contributor pages. @param {object} options {view,parent,review,signal}. @returns {object} dispose hook owning only this review's DOM/listeners. */
export function projectionReview({ view, parent, review, signal }: { view: PreviewOwner; parent: HTMLElement; review: Review; signal: AbortSignal }) {
  check(review.changeSet.derived === null && ['conflict', 'endpoint-conflict'].includes(review.projection.before.state)
    && review.projection.after.state === 'ready', 'Explicit conflict and valid after-state required');
  const { document, window, t } = view, abort = new window.AbortController();
  signal.addEventListener('abort', () => abort.abort(), { once: true, signal: abort.signal });
  const beforeState = review.projection.before.state;
  const root = element(document, 'section', { 'data-rr-review-projection': '', 'data-rr-before-state': beforeState,
    'data-rr-after-count': review.projection.after.relationships.length }); parent.append(root);
  root.append(element(document, 'p', {}, t(beforeState === 'endpoint-conflict' ? 'unresolved-before' : 'conflicted-before')), element(document, 'p', {},
    `${t('complete-after')}: ${review.projection.after.relationships.length}`));
  const pages: (() => void)[] = [];
  for (const key of ['before', 'after'] as const) {
    const report = review.projection[key], originals = report.state === 'endpoint-conflict';
    const entries = originals ? report.originals : report.clusters, section = element(document, 'section');
    section.append(element(document, 'h4', {}, t(key))); root.append(section);
    if (originals) for (const diagnostic of report.diagnostics) section.append(element(document, 'p', {},
      `${validateItemRef(diagnostic.details.ref).key}: ${diagnostic.details.status}`));
    const body = element(document, 'div'), controls = element(document, 'div'); section.append(body, controls);
    const owner = { document, t, signal: abort.signal }; let offset = 0, pageAbort: AbortController;
    const previous = ruleButton(owner, 'previous', `${key}-previous`, () => { offset -= 25; render(); });
    const next = ruleButton(owner, 'next', `${key}-next`, () => { offset += 25; render(); });
    controls.append(previous, next); controls.hidden = entries.length <= 25;
    /** Render one complete bounded side while aborting removed contributor controls. @returns {void} */
    function render() {
      if (pageAbort) pageAbort.abort(); pageAbort = new window.AbortController(); body.replaceChildren();
      previous.disabled = offset === 0; next.disabled = offset + 25 >= entries.length;
      for (const cluster of entries.slice(offset, offset + 25)) {
        if ('id' in cluster) {
          const card = element(document, 'section', { 'data-rr-review-original': cluster.id });
          card.append(element(document, 'p', {}, `${cluster.id}: ${cluster.source.key} → ${cluster.type} → ${cluster.target.key}`),
            element(document, 'p', {}, literalValues(cluster.metadata))); body.append(card); continue;
        }
        const card = element(document, 'section', { 'data-rr-review-cluster': cluster.key });
        card.append(element(document, 'p', {}, `${cluster.source.key} → ${cluster.type} → ${cluster.target.key}`));
        for (const conflict of cluster.conflicts) card.append(element(document, 'p', {}, `${t('conflict-field')}: ${conflict.field}`));
        contributorValues({ document, parent: card, cluster, t, signal: pageAbort.signal }); body.append(card);
      }
    }
    render(); pages.push(() => pageAbort.abort());
  }
  return {
    /** Release all page listeners and remove only the owned report. @returns {void} */
    dispose() { abort.abort(); for (const stop of pages) stop(); root.remove(); },
  };
}
