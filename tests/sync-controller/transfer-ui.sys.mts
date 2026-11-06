/** Actual native transfer UI acceptance with source services, native files and bounded literal review. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { readyState } from './evidence.sys.mts';
import { book, ref, commits } from './rules-fixtures.sys.mts';
import { check, click, type, until } from './ui-helpers.sys.mts';
import { transferUIFixture, action, openImport, preview, reviewText, inputFile, settled, advancedKey } from './transfer-ui-fixtures.sys.mts';
import { transferUIEdges } from './transfer-ui-edges.sys.mts';
import { transferUIReferences } from './transfer-ui-reference.sys.mts';
import { transferUICancel, transferUICommitControls } from './transfer-ui-cancel.sys.mts';
export type { TransferUILoader } from './transfer-ui-fixtures.sys.mts';

/** Exercise initial import/export, exact foreign decisions, complete review, backup and native failure/cancellation. @param {object} job Fresh anonymous phase. @param {object} api Actual native APIs. @returns {Promise<object>} Observed evidence, never a substitute for executing this phase. */
export async function transferUI(job: ControllerJob, api: NativeAPI) {
  check(!api.Zotero.Users.getCurrentUserID(), 'UI requires a fresh anonymous native profile');
  const f = await transferUIFixture(job, api);
  try {
    const { root, window, panel, app, files, factory, paths } = f;
    check((await app.read('self')).state === 'uninitialized', 'UI fixture is not a clean store');
    check(action(root, 'export').disabled && !action(root, 'import').disabled, 'Initial UI permissions are incorrect');
    const a = await book(api.Zotero, `${job.marker} A`), b = await book(api.Zotero, `${job.marker} B`);
    const { initialGraph } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/seed.mjs');
    const { createExport } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/format.mjs');
    const graph = initialGraph('self'); graph.types[0].version = 7;
    graph.assertions.push({ id: 'ui-original', source: ref(a), target: ref(b), type: 'referencing',
      metadata: { note: 'Café 你好 <b>literal</b>' }, createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z' });
    graph.rules.push({ id: 'ui-inverse', version: 9, enabled: true, rootType: 'referencing', inputType: 'referencing',
      outputType: 'referenced-by', transform: 'reverse', conditions: [], mapping: { note: { kind: 'root', field: 'note' } } });
    const document = await createExport({ source: f.identity.read('self'), snapshot: graph, exportedAt: '2026-11-05T12:00:00.000Z' }, factory.digest);
    const path = await inputFile(f, document, 'ui-incoming');
    await openImport(f, path);
    check(!action(root, 'preview').disabled, 'Same-owner exact keys were not preselected');
    await preview(f);
    check(reviewText(f, 'before').includes('uninitialized'), 'Initial review invented a previous graph');
    check(reviewText(f, 'after').includes('Café 你好 <b>literal</b>'), 'Complete Unicode authority absent');
    check(!root.querySelector('b'), 'Imported text was interpreted as markup');
    check(reviewText(f, 'projection-after').includes('ui-inverse'), 'Derived original contributor missing');
    check(reviewText(f, 'changes').includes('ui-original'), 'Complete change set absent');
    check((await app.read('self')).state === 'uninitialized', 'Preview initialized storage');
    click(root, 'transfer-commit'); await settled(f);
    const initial = readyState(await app.read('self'));
    check(JSON.stringify(initial.snapshot) === JSON.stringify(document.snapshot), 'UI import changed authority or foreign versions');
    paths.push(`${job.data}/ui-export.json`); click(root, 'transfer-export'); await settled(f);
    check(JSON.stringify((await files.read(`${job.data}/ui-export.json`)).snapshot) === JSON.stringify(initial.snapshot), 'UI export lost authority');
    await openImport(f, path); await preview(f);
    check(root.textContent.includes('No changes'), 'No-op merge was not explicitly reported');
    const count = await commits(api); click(root, 'transfer-commit'); await settled(f);
    check((await app.read('self')).state === 'ready' && await commits(api) === count, 'No-op UI published a generation');
    const foreign = await createExport({ source: { kind: 'user', id: '123456' }, snapshot: graph, exportedAt: document.exportedAt }, factory.digest);
    await openImport(f, await inputFile(f, foreign, 'ui-foreign'));
    check(action(root, 'preview').disabled, 'Cross-owner equal keys were silently accepted');
    await transferUIReferences(f);
    const rows = [...root.querySelectorAll<HTMLElement>('[data-rr-transfer-source-key]')];
    check(rows.length === 2, 'Original foreign endpoints missing');
    for (const [index, row] of rows.entries()) {
      advancedKey(f, row.querySelector<HTMLInputElement>('[data-rr-transfer-target-key]'), row.dataset.rrTransferSourceKey!);
      type(window, row.querySelector<HTMLSelectElement>('[data-rr-transfer-mode]'), 'reference');
      check(action(root, 'preview').disabled === (index < rows.length - 1), 'Incomplete foreign decisions accepted');
    }
    await preview(f); click(root, 'transfer-cancel'); await settled(f);
    check(!root.querySelector('[data-rr-transfer-mapping]') && await commits(api) === count, 'Cancel changed authority or retained review');
    await openImport(f, path);
    type(window, root.querySelector<HTMLSelectElement>('[data-rr-transfer-operation]'), 'replace'); await preview(f);
    check(action(root, 'commit').disabled, 'Replace allowed without a verified backup');
    paths.push(`${job.data}/ui-export.json`); click(root, 'transfer-backup'); await settled(f);
    const backupError = f.errors.at(-1);
    check(action(root, 'commit').disabled && !!panel.error.textContent,
      `Existing backup was not visibly rejected: ${JSON.stringify({ commitDisabled: action(root, 'commit').disabled, error: panel.error.textContent })}`);
    check(backupError !== null && typeof backupError === 'object' && 'name' in backupError && backupError.name === 'NoModificationAllowedError',
      'Existing backup failed at a boundary other than native exclusive creation');
    paths.push(`${job.data}/ui-backup.json`); click(root, 'transfer-backup'); await settled(f);
    check(!action(root, 'commit').disabled, 'Verified backup did not enable replacement');
    check(JSON.stringify((await files.read(`${job.data}/ui-backup.json`)).snapshot) === JSON.stringify(initial.snapshot), 'UI backup lost old authority');
    click(root, 'transfer-commit'); await settled(f);
    check(readyState(await app.read('self')).head !== initial.head, 'Reviewed replacement did not publish');
    const cancellationErrors: string[] = [];
    for (const test of [transferUICancel, transferUICommitControls]) {
      try { await test(f, path); }
      catch (error) { cancellationErrors.push(String(error)); }
    }
    check(cancellationErrors.length === 0, cancellationErrors.join('; '));
    const before = await app.read('self');
    await transferUIEdges(f, document, path);
    check(JSON.stringify(readyState(await app.read('self')).snapshot) === JSON.stringify(readyState(before).snapshot), 'Failure/cancellation changed graph authority');
    return { initialImport: true, exactForeignHistory: true, literalUnicode: true, completeProjection: true, noSeed: true,
      exportRoundTrip: true, explicitForeignDecisions: true, noOpMerge: true, cancel: true, replaceBackup: true,
      failedBackupPreservedDraft: true, nativeInvalidation: true, staleHead: true, dispose: true, nativeMappingPicker: true,
      mappingPickerCancel: true, mappingPickerScopeRestricted: true, mappingPickerPermissionChecked: true,
      mappingDialogTeardown: true, mappingPickerRetiresReview: true, pendingBackupCancelRetiresReview: true,
      confirmedCommitOwnsControls: true, before };
  } finally { f.dispose(); }
}
