/** Actual native reference dialogs choose mapping targets without source stubs, injected selections or guessed keys. */
import { check, click, until } from './ui-helpers.sys.mts';
import { present } from './evidence.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { action, openImport, preview } from './transfer-ui-fixtures.sys.mts';
import type { TransferUIFixture, TransferUILoader } from './transfer-ui-fixtures.sys.mts';
import type { NativeWindow } from '../../src/adapters/native-contracts.mts';
import type { TestWindow, TestItem, XULDialog } from './platform-contracts.mts';

/** Find the actual supported native select dialog and await its trees. @param {object} f Real native fixture. @returns {Promise<Window>} Loaded XUL reference dialog. */
export async function mappingDialog(f: TransferUIFixture): Promise<TestWindow> {
  const dialog = await until(f.api.Zotero, () => [...f.api.Services.wm.getEnumerator(null)].find(window =>
    !window.closed && window.location?.href === 'chrome://zotero/content/selectItemsDialog.xhtml'
      && window.loaded && typeof window.itemsView?.waitForLoad === 'function'
      && typeof window.collectionsView?.waitForLoad === 'function'), 'native mapping reference dialog');
  await dialog.collectionsView.waitForLoad(); await dialog.itemsView.waitForLoad(); return dialog;
}

/** Select a real visible bibliographic item through the actual dialog tree. @param {object} f Native fixture. @param {Window} dialog Loaded native dialog. @param {object} item Real saved item. @returns {Promise<void>} Actual selection observed. */
async function select(f: TransferUIFixture, dialog: TestWindow, item: TestItem): Promise<void> {
  await until(f.api.Zotero, () => dialog.itemsView.getSortedItems(true).includes(item.id), 'mapped reference present in native tree');
  await dialog.itemsView.selectItem(item.id);
  check(dialog.itemsView.getSelectedItems(true).includes(item.id), 'Native mapping picker did not select requested actual item');
}

/** Invoke the native XUL accept action without fabricating dialog output. @param {Window} dialog Actual native picker. @returns {void} */
function accept(dialog: TestWindow): void { present(dialog.document.querySelector<XULDialog>('dialog')).acceptDialog(); }

/** Invoke the native XUL cancellation action. @param {Window} dialog Actual native picker. @returns {void} */
function cancel(dialog: TestWindow): void {
  present(dialog.document.querySelector<XULDialog & { cancelDialog(): void }>('dialog')).cancelDialog();
}

/** Open one actual mapping-row chooser using its owned real click listener. @param {object} f Native fixture. @param {Element} row Original endpoint row. @returns {Promise<Window>} Actual loaded native dialog. */
async function open(f: TransferUIFixture, row: HTMLElement): Promise<TestWindow> {
  click(row, 'transfer-choose-reference'); return mappingDialog(f);
}

/** Exercise native positive/cancel/scope/permission decisions and cancel owned dialogs on mapping replacement. @param {object} f Connected native panel with a foreign-owner document. @returns {Promise<void>} No graph writes; fresh foreign draft restored for the parent journey. */
export async function transferUIReferences(f: TransferUIFixture): Promise<void> {
  const { api, root, panel, production } = f, path = present(panel.inputPath), { Zotero } = api;
  const rows = [...root.querySelectorAll<HTMLElement>('[data-rr-transfer-source-key]')];
  check(rows.length === 2, 'Reference-picker fixture needs two real original endpoints');
  const input = present(rows[0].querySelector<HTMLInputElement>('[data-rr-transfer-target-key]'));
  const mode = present(rows[0].querySelector<HTMLSelectElement>('[data-rr-transfer-mode]'));
  const group = new Zotero.Group({ groupID: 1991992, name: 'Transfer picker scope', description: '', version: 0, editable: true, filesEditable: true });
  await group.saveTx();
  const other = new Zotero.Item('book'); other.libraryID = group.libraryID;
  other.setField('title', `${f.job.marker} other-library reference`); await other.saveTx();
  const first = await open(f, rows[0]);
  check(!first.itemsView.getSortedItems(true).includes(other.id), 'Mapping picker exposed a foreign-library item');
  await first.itemsView.selectItem(other.id);
  check(!first.itemsView.getSelectedItems(true).includes(other.id), 'Mapping picker accepted a cross-library selection');
  check(first.collectionsView.getRowIndexByID(`L${group.libraryID}`) === false, 'Mapping picker exposed another library in its tree');
  action(rows[0], 'choose-reference').click();
  check([...api.Services.wm.getEnumerator(null)].filter(window => !window.closed && window.location?.href === first.location.href).length === 1,
    'Repeated chooser click opened multiple native dialogs');
  cancel(first);
  await until(Zotero, () => rows[0].getAttribute('aria-busy') === 'false', 'canceled native mapping chooser');
  check(input.value === '' && mode.value === '' && action(root, 'preview').disabled, 'Canceled chooser changed an explicit foreign decision');
  for (const row of rows) {
    const actual = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, row.dataset.rrTransferSourceKey!);
    check(actual, 'Real original endpoint is missing');
    const dialog = await open(f, row); await select(f, dialog, actual); accept(dialog);
    await until(Zotero, () => row.getAttribute('aria-busy') === 'false', 'native mapping reference selected');
    check(present(row.querySelector<HTMLInputElement>('[data-rr-transfer-target-key]')).value === actual.key
      && present(row.querySelector<HTMLSelectElement>('[data-rr-transfer-mode]')).value === 'reference', 'Chooser lost exact native key or reference decision');
    check(row.textContent.includes(actual.key), 'Native selected key is not visible as literal text');
  }
  check(!action(root, 'preview').disabled, 'Complete native mapping decisions did not enable preview');
  await preview(f); const token = present(panel.token);
  const same = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, rows[0].dataset.rrTransferSourceKey!);
  check(same, 'Actual native mapping original disappeared');
  const again = await open(f, rows[0]); await select(f, again, same); accept(again);
  await until(Zotero, () => rows[0].getAttribute('aria-busy') === 'false', 'fresh explicit native mapping decision');
  check(!panel.token && action(root, 'commit').disabled && !root.querySelector('[data-rr-transfer-review]'), 'Native mapping choice retained an issued review');
  await rejects(() => f.transfer.inspectImport(token), 'conflict');
  const loader = api.ChromeUtils as TransferUILoader;
  const { chooseMappedReference, chooseReference } = loader.importESModule('resource://rr-reconciliation-production/src/adapters/picker.mjs');
  const dialogs = new Set<NativeWindow>();
  const legacy = chooseReference({ Zotero, gateway: production.gateway, window: f.window,
    source: { library: 'self', key: same.key }, dialogs });
  const legacyDialog = await mappingDialog(f); await select(f, legacyDialog, same);
  const sameKeyDenied = rejects(() => legacy, 'validation'); accept(legacyDialog); await sameKeyDenied;
  check(dialogs.size === 0, 'Legacy same-key rejection leaked a dialog');
  const pending = chooseMappedReference({ Zotero, gateway: production.gateway, window: f.window, library: 'group:1991992', dialogs });
  const restricted = await mappingDialog(f); await select(f, restricted, other);
  group.editable = false; await group.saveTx();
  const denied = rejects(() => pending, 'permission'); accept(restricted); await denied;
  check(dialogs.size === 0, 'Permission failure leaked native dialog ownership');
  group.editable = true; await group.saveTx();
  const replaced = await open(f, rows[0]);
  await panel.load('group:1991992');
  await until(Zotero, () => replaced.closed, 'mapping dialog closed on target-library change');
  check(!rows[0].isConnected, 'Changed-library mapping remained mounted');
  await panel.load('self'); await openImport(f, path);
  const old = present(root.querySelector<HTMLElement>('[data-rr-transfer-source-key]'));
  const oldInput = present(old.querySelector<HTMLInputElement>('[data-rr-transfer-target-key]'));
  const late = await open(f, old); await select(f, late, same); accept(late); click(root, 'transfer-cancel');
  await until(Zotero, () => late.closed && !root.querySelector('[data-rr-transfer-mapping]'), 'native mapping canceled during completion');
  await Zotero.Promise.delay(75);
  check(oldInput.value === '' && !old.isConnected, 'A late candidate mutated its disposed mapping draft');
  await openImport(f, path);
  const canceledRow = present(root.querySelector<HTMLElement>('[data-rr-transfer-source-key]'));
  const owned = await open(f, canceledRow); click(root, 'transfer-cancel');
  await until(Zotero, () => owned.closed, 'owned mapping dialog closed on draft cancellation');
  await openImport(f, path);
}
