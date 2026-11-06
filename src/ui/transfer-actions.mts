/** Actual transfer actions keep exact reviewed references and recheck view ownership after every native await. */
import { check } from '../domain/values.mts';
import type { TransferPanel } from './transfer-panel.mts';

/** Choose and read a complete native file before replacing any existing visible draft. @param {object} panel Active view. @param {Function} current Captured connected generation. @returns {Promise<void>} Complete validated document or cancellation. */
export async function openTransfer(panel: TransferPanel, current: () => boolean): Promise<void> {
  const { picker, files, window } = panel.options;
  check(panel.editable && ['ready', 'uninitialized'].includes(panel.authority), 'Target is not editable', 'permission');
  const path = await picker.choose(window, 'import'); if (!current() || path === null) return;
  const input = await files.read(path); if (!current()) return;
  check(panel.availability() && panel.editable, 'Target became unavailable or read-only', 'permission');
  // A successfully chosen replacement draft cancels the old token, but a failed read preserves it and its source file.
  panel.invalidate(''); panel.draft(input, path);
}

/** Export one ready actual graph to an exclusively new verified file, including read-only library owners. @param {object} panel Active view. @param {Function} current Captured connected generation. @returns {Promise<void>} Actual verified file write or cancellation. */
export async function exportTransfer(panel: TransferPanel, current: () => boolean): Promise<void> {
  check(panel.authority === 'ready' && panel.owner !== null, 'Export requires ready authority', 'conflict');
  const { picker, files, transfer, window } = panel.options, library = panel.library;
  const path = await picker.choose(window, 'export'); if (!current() || path === null) return;
  const document = await transfer.exportGraph(library); if (!current()) return;
  await files.writeNew(path, document); if (!current()) return;
  panel.message.textContent = `Export verified: ${path} · SHA-256 ${document.hash}`;
}

/** Preview the exact validated input and complete explicit mapping, retiring any late-issued token. @param {object} panel Active view. @param {Function} current Captured connected generation. @returns {Promise<void>} Captured full evidence or no late view. */
export async function previewTransfer(panel: TransferPanel, current: () => boolean): Promise<void> {
  const { transfer, app } = panel.options;
  check(panel.input !== null && panel.mapping !== null && panel.editable, 'Choose a complete editable import first');
  const document = panel.input, mapping = panel.mapping.value(), operation = panel.operation.value;
  panel.clearReview();
  app.invalidate(panel.library); const state = await app.read(panel.library); if (!current()) return;
  check(state.state === 'ready' || state.state === 'uninitialized', 'Current authority is incomplete; import cannot be previewed', 'conflict');
  panel.authority = state.state; panel.revision = state.state === 'ready' ? state.head : null;
  const preview = await transfer.previewImport(document, mapping, operation, panel.revision);
  if (!current()) { panel.retired.add(preview.previewToken); return; }
  panel.token = preview.previewToken;
  try {
    const inspection = await transfer.inspectImport(preview.previewToken); if (!current()) return;
    panel.showReview(inspection);
  } catch (error) { panel.retired.add(preview.previewToken); panel.token = null; throw error; }
}

/** Acknowledge backup only through the actual token-bound verified old-graph service operation. @param {object} panel Active view. @param {Function} current Captured connected generation. @returns {Promise<void>} Complete matching backup inspection or unchanged draft on cancellation/failure. */
export async function backupTransfer(panel: TransferPanel, current: () => boolean): Promise<void> {
  check(panel.token !== null && panel.inspection?.before !== null, 'A captured previous graph is required');
  const token = panel.token, { picker, transfer, window } = panel.options;
  const path = await picker.choose(window, 'backup'); if (!current() || path === null) return;
  await transfer.backupImport(token, path); if (!current()) return;
  const inspection = await transfer.inspectImport(token); if (!current()) return;
  panel.showReview(inspection); panel.message.textContent = `Backup verified: ${path}. The captured import can now be committed.`;
}

/** Commit exactly the issued reviewed token; publish no replacement from a stale view or guessed document. @param {object} panel Active view. @param {Function} current Captured connected generation. @returns {Promise<void>} Current view reloaded after actual native success. */
export async function commitTransfer(panel: TransferPanel, current: () => boolean): Promise<void> {
  check(panel.token !== null && panel.inspection !== null, 'Preview the complete import first');
  const token = panel.token, noop = panel.inspection.noop;
  const result = await panel.options.transfer.commitImport(token);
  // Native notifications may invalidate the UI during successful publication; a consumed token must not be canceled again.
  panel.retired.delete(token); if (panel.token === token) panel.token = null;
  if (!current()) return;
  const generation = panel.generation + 1; await panel.load(panel.library);
  if (!panel.current(generation)) return;
  panel.message.textContent = noop ? `No changes: merge retained revision ${result.revision}.` : `Import committed at revision ${result.revision}.`;
}
