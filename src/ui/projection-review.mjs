/** Complete conflicted-before and valid-after inspection, with no invented aggregate delta. */
import { check } from '../domain/values.mjs';
import { element } from './dom.mjs';
import { ruleButton } from './rule-controls.mjs';
import { contributorValues } from './contributor-values.mjs';

/** Render complete before/after contributor reports using bounded cluster/contributor pages. @param {object} options {view,parent,review,signal}. @returns {object} dispose hook owning only this review's DOM/listeners. */
export function projectionReview({ view, parent, review, signal }) {
  check(review.changeSet.derived === null && review.projection.before.state === 'conflict'
    && review.projection.after.state === 'ready', 'Explicit conflict and valid after-state required');
  const { document, window, t } = view, abort = new window.AbortController();
  signal.addEventListener('abort', () => abort.abort(), { once: true, signal: abort.signal });
  const root = element(document, 'section', { 'data-rr-review-projection': '', 'data-rr-before-state': 'conflict',
    'data-rr-after-count': review.projection.after.relationships.length }); parent.append(root);
  root.append(element(document, 'p', {}, t('conflicted-before')), element(document, 'p', {},
    `${t('complete-after')}: ${review.projection.after.relationships.length}`));
  const pages = [];
  for (const key of ['before', 'after']) {
    const clusters = review.projection[key].clusters, section = element(document, 'section');
    section.append(element(document, 'h4', {}, t(key))); root.append(section);
    const body = element(document, 'div'), controls = element(document, 'div'); section.append(body, controls);
    const owner = { document, t, signal: abort.signal }; let offset = 0, pageAbort;
    const previous = ruleButton(owner, 'previous', `${key}-previous`, () => { offset -= 25; render(); });
    const next = ruleButton(owner, 'next', `${key}-next`, () => { offset += 25; render(); });
    controls.append(previous, next); controls.hidden = clusters.length <= 25;
    /** Render one complete bounded side while aborting removed contributor controls. @returns {void} */
    function render() {
      if (pageAbort) pageAbort.abort(); pageAbort = new window.AbortController(); body.replaceChildren();
      previous.disabled = offset === 0; next.disabled = offset + 25 >= clusters.length;
      for (const cluster of clusters.slice(offset, offset + 25)) {
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
