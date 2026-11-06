/** Complete captured import evidence is inspectable as literal named fields in bounded native pages. */
import { element } from './dom.mts';
import { transferButton, transferSelect } from './transfer-controls.mts';
import type { NativeWindow } from '../adapters/native-contracts.mts';
import type { ImportInspection } from './transfer-controls.mts';

/** Flatten every detached DTO leaf with its original path; empty arrays/objects and null remain explicit evidence. @param {unknown} value Complete service DTO. @param {string} path Named authority location. @returns {object[]} All literal field/value entries. */
function fields(value: unknown, path: string): { path: string; value: string }[] {
  if (Array.isArray(value)) return value.length ? value.flatMap((entry, index) => fields(entry, `${path}[${index}]`)) : [{ path, value: '[]' }];
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length ? entries.flatMap(([key, entry]) => fields(entry, `${path}.${key}`)) : [{ path, value: '{}' }];
  }
  return [{ path, value: typeof value === 'string' ? value : JSON.stringify(value) }];
}

/** Render captured authority, original contributors, complete projections and diagnostics without inventing unavailable aggregates. @param {object} options Actual parent/window, complete inspection and owner signal. @returns {object} Owned disposal hook. */
export function transferReview({ window, parent, inspection, signal }: {
  window: NativeWindow; parent: HTMLElement; inspection: ImportInspection; signal: AbortSignal;
}) {
  const document = parent.ownerDocument, abort = new window.AbortController();
  signal.addEventListener('abort', () => abort.abort(), { once: true, signal: abort.signal });
  const root = element(document, 'section', { 'data-rr-transfer-review': '' }); parent.replaceChildren(root);
  root.append(element(document, 'h4', {}, 'Captured import review'), element(document, 'p', {},
    inspection.noop ? 'No changes: this merge preserves the current generation.' : `Operation: ${inspection.operation}. Review the complete before and after authority.`));
  if (inspection.before === null) root.append(element(document, 'p', {}, 'No previous graph: uninitialized library.'));
  if (inspection.projection.before !== null && inspection.projection.before.state !== 'ready') root.append(element(document, 'p', {},
    'The before projection cannot be aggregated. Its original authority, contributors and diagnostics remain available; no empty aggregate is substituted.'));
  const categories = [
    ['before', 'Before authority: types, rules and original assertions', inspection.before === null ? 'No previous graph: uninitialized authority' : inspection.before],
    ['after', 'After authority: types, rules and original assertions', inspection.after],
    ['projection-before', 'Complete before projection and original contributors', inspection.projection.before === null ? 'No previous projection: uninitialized authority' : inspection.projection.before],
    ['projection-after', 'Complete after projection and original contributors', inspection.projection.after],
    ['changes', 'Complete change set and diagnostics', inspection.changeSet],
    ['retained', 'All retained endpoint diagnostics', inspection.retained],
    ['mapping', 'Exact captured endpoint mapping', inspection.mapping],
    ['refs', 'All active original endpoints', inspection.refs],
    ['binding', 'Captured revision, operation and verified backup', { expectedRevision: inspection.expectedRevision, operation: inspection.operation, noop: inspection.noop, backup: inspection.backup }],
  ] as const;
  let offset = 0, entries = fields(categories[0][2], categories[0][0]);
  const selector = transferSelect({ document, parent: root, label: 'Review evidence', attribute: 'data-rr-transfer-review-category',
    choices: categories.map(([value, label]) => [value, label]), signal: abort.signal,
    change: () => { const category = categories.find(([key]) => key === selector.value)!; entries = fields(category[2], category[0]); offset = 0; paint(); } });
  const body = element(document, 'dl'), status = element(document, 'p', { role: 'status' });
  const previous = transferButton(document, 'Previous review fields', 'review-previous', () => { offset -= 25; paint(); }, abort.signal);
  const next = transferButton(document, 'Next review fields', 'review-next', () => { offset += 25; paint(); }, abort.signal);
  root.append(body, status, previous, next);
  /** Paint every selected leaf literally, with at most 25 fields mounted at once. @returns {void} */
  function paint(): void {
    body.replaceChildren();
    for (const entry of entries.slice(offset, offset + 25)) {
      const row = element(document, 'div', { 'data-rr-transfer-review-value': '' });
      row.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
      row.append(element(document, 'dt', {}, entry.path), element(document, 'dd', {}, entry.value)); body.append(row);
    }
    previous.disabled = offset === 0; next.disabled = offset + 25 >= entries.length;
    status.textContent = `Fields ${offset + 1}–${Math.min(offset + 25, entries.length)} of ${entries.length}. All captured fields are available through these pages.`;
  }
  paint();
  return {
    /** Abort every owned review listener and remove only this captured report. @returns {void} */
    dispose(): void { abort.abort(); root.remove(); },
  };
}
