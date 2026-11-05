/** Drive actual Zotero windows and HTML controls for the relationship journey. */
import { present, contractFailure, errorMessage } from './evidence.sys.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import type { TestItem, TestWindow, XULDialog, XULMenu, XULPopup } from './platform-contracts.mts';
import type { CollapsibleSection, ItemDetails } from '../../src/adapters/native-contracts.mts';
import type { FormControl } from '../../src/ui/contracts.mts';

/** Polling succeeds only for an actual truthy native observation. */
type Observed<T> = Exclude<T, null | undefined | false | 0 | ''>;
/** Assert observable behavior. @param {boolean} value Condition. @param {string} message Failure. @returns {void} */
export function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

/** Wait for a real native condition. @param {object} Zotero Platform. @param {Function} predicate Actual check. @param {string} label Diagnostic. @returns {Promise<*>} Observed value. */
export async function until<T>(Zotero: TestPlatform, predicate: () => T | Promise<T>, label: string): Promise<Observed<T>> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await predicate(); if (result) return result as Observed<T>;
    await Zotero.Promise.delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

/** Find one enabled visible plugin pane after actual native selection. @param {object} Zotero Platform. @param {Window} window Real main window. @param {object} item Native item. @returns {Promise<Element>} Actual pane root. */
export async function selectPane(Zotero: TestPlatform, window: TestWindow, item: TestItem): Promise<HTMLElement> {
  await window.ZoteroPane.selectItem(item.id);
  const root = await until(Zotero, () => [...window.document.querySelectorAll<HTMLElement>('[data-rr-pane]')]
    .find(node => node.dataset.rrItemKey === item.key), 'Relationships section for selected item');
  const section = root.closest('item-pane-custom-section');
  if (section) {
    section.querySelector<CollapsibleSection>('collapsible-section')!.open = true;
    const details = section.closest<ItemDetails>('item-details')!;
    await details.scrollToPane((section as HTMLElement).dataset.pane!, 'instant');
  }
  await until(Zotero, () => ['ready', 'uninitialized', 'error', 'pending', 'conflict'].includes(root.dataset.rrState!), 'relationship view data');
  check(root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().height > 0, 'Relationships section is not actually visible');
  return root;
}

/** Invoke the actual official context-menu entry and cancel its draft. @param {object} Zotero Native API. @param {Window} window Owner. @param {Element} root Current pane. @returns {Promise<void>} Menu and editor verified. */
export async function contextMenu(Zotero: TestPlatform, window: TestWindow, root: HTMLElement): Promise<void> {
  const popup = window.document.getElementById('zotero-itemmenu') as XULPopup;
  await window.ZoteroPane.buildItemContextMenu();
  popup.openPopupAtScreen(window.screenX + 100, window.screenY + 100, true);
  const menu = await until(Zotero, () => popup.querySelector<XULMenu>('[data-l10n-id="reference-relationships-add-menu"]'), 'native relationship context menu');
  if (menu.parentElement !== popup) (menu.parentElement!.parentElement as XULPopup).open = true;
  await until(Zotero, () => menu.getBoundingClientRect().width > 0 && !menu.disabled, 'visible enabled native menu entry');
  menu.doCommand(); popup.hidePopup();
  await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor]'), 'menu opened editor');
  click(root, 'cancel');
  await until(Zotero, () => !root.querySelector<HTMLElement>('[data-rr-editor]') && root.dataset.rrState !== 'loading', 'cancelled menu draft');
}

/** Type through an actual control input event. @param {Window} window Owner. @param {Element} control Form control. @param {string} value Input. @returns {void} */
export function type(window: TestWindow, control: FormControl | null, value: string): void {
  check(!!control, 'Required form control is missing'); control.value = value;
  control.dispatchEvent(new window.Event('input', { bubbles: true }));
  control.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/** Click an actual named action. @param {Element} root UI root. @param {string} action Stable action. @returns {void} */
export function click(root: HTMLElement, action: string): void {
  const button = root.querySelector<HTMLButtonElement>(`[data-rr-action="${action}"]`);
  check(button && !button.disabled, `Action ${action} is unavailable`); button.click();
}

/** Use the native endpoint picker and actual selection/dialog acceptance APIs. @param {object} api Real resources. @param {Element} root Relationship editor. @param {object} target Actual native item. @param {string} action Source/target picker action. @returns {Promise<void>} Picker closed. */
export async function chooseTarget(api: NativeAPI, root: HTMLElement, target: TestItem, action: string = 'choose-target'): Promise<void> {
  const { Zotero, Services } = api;
  let windows: { uri: string; ready: DocumentReadyState; loaded: boolean; itemsView: string }[] = [];
  const selection = until(Zotero, () => {
    windows = [];
    for (const candidate of Services.wm.getEnumerator(null)) {
      if (candidate.location?.href.startsWith('chrome://zotero/')) windows.push({ uri: candidate.location.href,
        ready: candidate.document.readyState, loaded: candidate.loaded, itemsView: typeof candidate.itemsView });
      if (candidate.location?.href === 'chrome://zotero/content/selectItemsDialog.xhtml'
        && typeof candidate.itemsView?.waitForLoad === 'function'
        && typeof candidate.collectionsView?.waitForLoad === 'function') return candidate;
    }
    return null;
  }, 'native target picker').then(async dialog => {
    await dialog.collectionsView.waitForLoad(); await dialog.itemsView.waitForLoad();
    await until(Zotero, () => dialog.itemsView.getSortedItems(true).includes(target.id), 'target reference in native picker rows');
    const selected = await dialog.itemsView.selectItem(target.id);
    check(dialog.itemsView.getSelectedItems(true).includes(target.id), `Native picker did not select target: ${JSON.stringify({
      targetID: target.id, targetLibrary: target.libraryID, selected,
      actual: dialog.itemsView.getSelectedItems(true), rowCount: dialog.itemsView.rowCount,
      rows: dialog.itemsView.collectionTreeRows.map(row => ({ id: row.id, libraryID: row.ref.libraryID })),
    })}`);
    dialog.document.querySelector<XULDialog>('dialog')!.acceptDialog();
  });
  click(root, action);
  try { await selection; }
  catch (error) {
    const messages = Services.console.getMessageArray().map(value => value.message)
      .filter(message => /resource:\/\/rr-|selectItemsDialog/.test(message)).slice(-8);
    const failure = error instanceof Error ? error : new Error(errorMessage(error));
    failure.message += `; diagnostics=${JSON.stringify({ windows,
      alerts: [...root.querySelectorAll<HTMLElement>('[role="alert"]')].map(node => node.textContent), messages })}`;
    throw failure;
  }
  const source = action === 'choose-source';
  await until(Zotero, () => root.querySelector(source ? '[data-rr-source-key]' : '[data-rr-target-key]')?.getAttribute(source ? 'data-rr-source-key' : 'data-rr-target-key') === target.key, 'chosen endpoint label');
}

/** Fill and review an actual relationship editor. @param {object} api Native resources. @param {Window} window Owner. @param {Element} root Pane. @param {object} target Reference. @param {string} note Metadata. @param {boolean} save Confirm or cancel. @param {boolean} exerciseHostTransaction Test first Save under a real held host transaction. @returns {Promise<void>} Action complete. */
export async function createThroughUI(api: NativeAPI, window: TestWindow, root: HTMLElement, target: TestItem, note: string, save: boolean, exerciseHostTransaction: boolean = false): Promise<void> {
  click(root, 'add');
  await until(api.Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor]'), 'relationship editor');
  await chooseTarget(api, root, target);
  type(window, root.querySelector<FormControl>('[data-rr-field="note"]'), note);
  click(root, 'preview');
  await until(api.Zotero, () => root.querySelector<HTMLButtonElement>('[data-rr-action="save"]') && !present(root.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'relationship preview');
  if (save && exerciseHostTransaction) await saveDuringNativeTransaction(api, root, target);
  else click(root, save ? 'save' : 'cancel');
  await until(api.Zotero, () => !root.querySelector<HTMLElement>('[data-rr-editor]') && root.dataset.rrState !== 'loading', 'editor completion');
}

/** Save through a real event while another native transaction is held; direct nesting must still reject. @param {object} api Native resources. @param {Element} root Actual editor. @param {object} target Native target. @returns {Promise<void>} Host transaction released and event publication allowed. */
async function saveDuringNativeTransaction(api: NativeAPI, root: HTMLElement, target: TestItem): Promise<void> {
  const { Zotero } = api, app = Zotero.ReferenceRelationships!.application;
  const strict = await app.draftCreate({ source: { library: 'self', key: root.dataset.rrItemKey! },
    target: { library: 'self', key: target.key }, type: 'similar', metadata: { note: 'Must not publish inside the outer transaction' } });
  const entered = Zotero.Promise.defer(), release = Zotero.Promise.defer();
  const outer = Zotero.DB.executeTransaction(async function heldHostTransaction() {
    let denied = false;
    try { await app.apply(strict.command, strict.expectedRevision); }
    catch (error) { check(contractFailure(error).code === 'storage', `Direct nesting failed for another reason: ${errorMessage(error)}`); denied = true; }
    check(denied, 'A directly nested application write was allowed'); entered.resolve();
    await release.promise;
  });
  try {
    await Promise.race([entered.promise, outer.then(() => { throw new Error('Outer transaction ended before the event test'); })]);
    click(root, 'save'); await Zotero.Promise.delay(75);
    check(!present(root.querySelector<HTMLElement>('[data-rr-editor] [role="alert"]')).textContent, 'Event save rejected unrelated native transaction');
    check((await app.read('self')).state === 'uninitialized', 'Event publication escaped its own transaction boundary');
  } finally { release.resolve(); await outer; }
}

/** Type a new value during actual async review and require a fresh preview before saving. @param {object} api Native resources. @param {Window} window Owner. @param {Element} root Pane. @param {object} target Real target. @returns {Promise<void>} Race and cancellation verified. */
export async function previewRace(api: NativeAPI, window: TestWindow, root: HTMLElement, target: TestItem): Promise<void> {
  click(root, 'add'); await until(api.Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor]'), 'preview-race editor');
  await chooseTarget(api, root, target);
  type(window, root.querySelector<FormControl>('[data-rr-field="note"]'), 'before async preview');
  const editor = root.querySelector<HTMLElement>('[data-rr-editor]');
  let changed = false;
  const observer = new window.MutationObserver(() => {
    if (present(editor).getAttribute('aria-busy') !== 'true') return;
    observer.disconnect(); type(window, root.querySelector<FormControl>('[data-rr-field="note"]'), 'changed during preview'); changed = true;
  });
  observer.observe(present(editor), { attributes: true, attributeFilter: ['aria-busy'] });
  try {
    click(root, 'preview');
    await until(api.Zotero, () => changed && present(editor).getAttribute('aria-busy') === 'false', 'asynchronous preview edit');
    check(present(root.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'Stale preview enabled saving older input');
    click(root, 'preview');
    await until(api.Zotero, () => !present(root.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'review latest input');
    check(root.textContent.includes('changed during preview'), 'Latest metadata is absent from review');
    click(root, 'cancel');
    await until(api.Zotero, () => !root.querySelector<HTMLElement>('[data-rr-editor]') && root.dataset.rrState !== 'loading', 'cancel preview race');
  } finally { observer.disconnect(); }
}
