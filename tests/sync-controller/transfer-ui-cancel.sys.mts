/** Native cancellation must retire an issued import review while an external backup dialog remains pending. */
import type { TransferUIFixture } from './transfer-ui-fixtures.sys.mts';
import { action, openImport, preview, settled } from './transfer-ui-fixtures.sys.mts';
import { check, click, until } from './ui-helpers.sys.mts';
import { present } from './evidence.sys.mts';
import { rejects } from './ui-permissions.sys.mts';

/** Cancel before a real pending external dialog returns and prove its captured token is already unusable. @param {object} fixture Actual native panel, files, service and delayed external picker. @param {string} path Existing incoming document. @returns {Promise<void>} Exact review retired without publication or backup creation. */
export async function transferUICancel(fixture: TransferUIFixture, path: string): Promise<void> {
  const { api, panel, root, paths, transfer, app } = fixture;
  await openImport(fixture, path); await preview(fixture);
  const token = present(panel.token), before = await app.read('self');
  const delayed = api.Zotero.Promise.defer<string | null>(), backupPath = `${fixture.job.data}/canceled-pending-backup.json`;
  paths.push(delayed.promise); click(root, 'transfer-backup');
  await until(api.Zotero, () => root.getAttribute('aria-busy') === 'true', 'pending backup picker');
  try {
    click(root, 'transfer-cancel');
    check(!panel.token && !root.querySelector('[data-rr-transfer-mapping]'), 'Cancel retained an import draft');
    await rejects(() => transfer.inspectImport(token), 'conflict');
  } finally { delayed.resolve(backupPath); await settled(fixture); }
  let absent = false;
  try { await fixture.files.read(backupPath); }
  catch (error) { absent = error !== null && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError'; }
  check(absent && JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Canceled backup created a file or changed authority');
}

/** A confirmed commit owns its controls until the actual native transaction finishes, with no claim that a cancel click can undo publication. @param {object} fixture Actual native service and DB. @param {string} path Existing unchanged graph document. @returns {Promise<void>} Successful idempotent native commit after temporary real transaction contention. */
export async function transferUICommitControls(fixture: TransferUIFixture, path: string): Promise<void> {
  const { api, panel, root, app } = fixture;
  await openImport(fixture, path); await preview(fixture);
  const token = present(panel.token), before = await app.read('self');
  const entered = api.Zotero.Promise.defer(), release = api.Zotero.Promise.defer();
  const blocker = api.Zotero.DB.executeTransaction(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  try {
    click(root, 'transfer-commit');
    await until(api.Zotero, () => root.getAttribute('aria-busy') === 'true', 'confirmed import waiting for native transaction');
    check(action(root, 'cancel').disabled && panel.librarySelect.disabled && panel.operation.disabled,
      'Confirmed publication still offers cancellation or a different target/operation');
    action(root, 'cancel').click();
    check(panel.token === token && !!panel.input, 'Disabled cancellation discarded confirmed publication');
  } finally { release.resolve(); await blocker; await settled(fixture); }
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Confirmed no-op import changed authority');
}
