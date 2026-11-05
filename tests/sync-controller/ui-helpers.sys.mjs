/** Drive actual Zotero windows and HTML controls for the relationship journey. */

/** Assert observable behavior. @param {boolean} value Condition. @param {string} message Failure. @returns {void} */
export function check(value, message) { if (!value) throw new Error(message); }

/** Wait for a real native condition. @param {object} Zotero Platform. @param {Function} predicate Actual check. @param {string} label Diagnostic. @returns {Promise<*>} Observed value. */
export async function until(Zotero, predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await predicate(); if (result) return result;
    await Zotero.Promise.delay(25);
  }
  throw new Error(`Timed out: ${label}`);
}

/** Find one enabled visible plugin pane after actual native selection. @param {object} Zotero Platform. @param {Window} window Real main window. @param {object} item Native item. @returns {Promise<Element>} Actual pane root. */
export async function selectPane(Zotero, window, item) {
  await window.ZoteroPane.selectItem(item.id);
  const root = await until(Zotero, () => [...window.document.querySelectorAll('[data-rr-pane]')]
    .find(node => node.dataset.rrItemKey === item.key), 'Relationships section for selected item');
  const section = root.closest('item-pane-custom-section');
  if (section) {
    section.querySelector('collapsible-section').open = true;
    const details = section.closest('item-details');
    await details.scrollToPane(section.dataset.pane, 'instant');
  }
  await until(Zotero, () => ['ready', 'uninitialized', 'error', 'pending', 'conflict'].includes(root.dataset.rrState), 'relationship view data');
  check(root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().height > 0, 'Relationships section is not actually visible');
  return root;
}

/** Invoke the actual official context-menu entry and cancel its draft. @param {object} Zotero Native API. @param {Window} window Owner. @param {Element} root Current pane. @returns {Promise<void>} Menu and editor verified. */
export async function contextMenu(Zotero, window, root) {
  const popup = window.document.getElementById('zotero-itemmenu');
  await window.ZoteroPane.buildItemContextMenu();
  popup.openPopupAtScreen(window.screenX + 100, window.screenY + 100, true);
  const menu = await until(Zotero, () => popup.querySelector('[data-l10n-id="reference-relationships-add-menu"]'), 'native relationship context menu');
  if (menu.parentElement !== popup) menu.parentElement.parentElement.open = true;
  await until(Zotero, () => menu.getBoundingClientRect().width > 0 && !menu.disabled, 'visible enabled native menu entry');
  menu.doCommand(); popup.hidePopup();
  await until(Zotero, () => root.querySelector('[data-rr-editor]'), 'menu opened editor');
  click(root, 'cancel');
  await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.dataset.rrState !== 'loading', 'cancelled menu draft');
}

/** Type through an actual control input event. @param {Window} window Owner. @param {Element} control Form control. @param {string} value Input. @returns {void} */
export function type(window, control, value) {
  check(!!control, 'Required form control is missing'); control.value = value;
  control.dispatchEvent(new window.Event('input', { bubbles: true }));
  control.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/** Click an actual named action. @param {Element} root UI root. @param {string} action Stable action. @returns {void} */
export function click(root, action) {
  const button = root.querySelector(`[data-rr-action="${action}"]`);
  check(button && !button.disabled, `Action ${action} is unavailable`); button.click();
}

/** Use the native target picker and its actual selection/dialog acceptance APIs. @param {object} api Real resources. @param {Element} root Relationship editor. @param {object} target Actual native item. @returns {Promise<void>} Picker closed. */
export async function chooseTarget(api, root, target) {
  const { Zotero, Services } = api;
  let windows = [];
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
    dialog.document.querySelector('dialog').acceptDialog();
  });
  click(root, 'choose-target');
  try { await selection; }
  catch (error) {
    const messages = Services.console.getMessageArray().map(value => value.message)
      .filter(message => /resource:\/\/rr-|selectItemsDialog/.test(message)).slice(-8);
    error.message += `; diagnostics=${JSON.stringify({ windows,
      alerts: [...root.querySelectorAll('[role="alert"]')].map(node => node.textContent), messages })}`;
    throw error;
  }
  await until(Zotero, () => root.querySelector('[data-rr-target-key]')?.dataset.rrTargetKey === target.key, 'chosen target label');
}

/** Fill and review an actual relationship editor. @param {object} api Native resources. @param {Window} window Owner. @param {Element} root Pane. @param {object} target Reference. @param {string} note Metadata. @param {boolean} save Confirm or cancel. @param {boolean} exerciseHostTransaction Test first Save under a real held host transaction. @returns {Promise<void>} Action complete. */
export async function createThroughUI(api, window, root, target, note, save, exerciseHostTransaction = false) {
  click(root, 'add');
  await until(api.Zotero, () => root.querySelector('[data-rr-editor]'), 'relationship editor');
  await chooseTarget(api, root, target);
  type(window, root.querySelector('[data-rr-field="note"]'), note);
  click(root, 'preview');
  await until(api.Zotero, () => root.querySelector('[data-rr-action="save"]') && !root.querySelector('[data-rr-action="save"]').disabled, 'relationship preview');
  if (save && exerciseHostTransaction) await saveDuringNativeTransaction(api, root, target);
  else click(root, save ? 'save' : 'cancel');
  await until(api.Zotero, () => !root.querySelector('[data-rr-editor]') && root.dataset.rrState !== 'loading', 'editor completion');
}

/** Save through a real event while another native transaction is held; direct nesting must still reject. @param {object} api Native resources. @param {Element} root Actual editor. @param {object} target Native target. @returns {Promise<void>} Host transaction released and event publication allowed. */
async function saveDuringNativeTransaction(api, root, target) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships.application;
  const strict = await app.draftCreate({ source: { library: 'self', key: root.dataset.rrItemKey },
    target: { library: 'self', key: target.key }, type: 'similar', metadata: { note: 'Must not publish inside the outer transaction' } });
  const entered = Zotero.Promise.defer(), release = Zotero.Promise.defer();
  const outer = Zotero.DB.executeTransaction(async function heldHostTransaction() {
    let denied = false;
    try { await app.apply(strict.command, strict.expectedRevision); }
    catch (error) { check(error.code === 'storage', `Direct nesting failed for another reason: ${error.message}`); denied = true; }
    check(denied, 'A directly nested application write was allowed'); entered.resolve();
    await release.promise;
  });
  try {
    await Promise.race([entered.promise, outer.then(() => { throw new Error('Outer transaction ended before the event test'); })]);
    click(root, 'save'); await Zotero.Promise.delay(75);
    check(!root.querySelector('[data-rr-editor] [role="alert"]').textContent, 'Event save rejected unrelated native transaction');
    check((await app.read('self')).state === 'uninitialized', 'Event publication escaped its own transaction boundary');
  } finally { release.resolve(); await outer; }
}

/** Type a new value during actual async review and require a fresh preview before saving. @param {object} api Native resources. @param {Window} window Owner. @param {Element} root Pane. @param {object} target Real target. @returns {Promise<void>} Race and cancellation verified. */
export async function previewRace(api, window, root, target) {
  click(root, 'add'); await until(api.Zotero, () => root.querySelector('[data-rr-editor]'), 'preview-race editor');
  await chooseTarget(api, root, target);
  type(window, root.querySelector('[data-rr-field="note"]'), 'before async preview');
  const editor = root.querySelector('[data-rr-editor]');
  let changed = false;
  const observer = new window.MutationObserver(() => {
    if (editor.getAttribute('aria-busy') !== 'true') return;
    observer.disconnect(); type(window, root.querySelector('[data-rr-field="note"]'), 'changed during preview'); changed = true;
  });
  observer.observe(editor, { attributes: true, attributeFilter: ['aria-busy'] });
  try {
    click(root, 'preview');
    await until(api.Zotero, () => changed && editor.getAttribute('aria-busy') === 'false', 'asynchronous preview edit');
    check(root.querySelector('[data-rr-action="save"]').disabled, 'Stale preview enabled saving older input');
    click(root, 'preview');
    await until(api.Zotero, () => !root.querySelector('[data-rr-action="save"]').disabled, 'review latest input');
    check(root.textContent.includes('changed during preview'), 'Latest metadata is absent from review');
    click(root, 'cancel');
    await until(api.Zotero, () => !root.querySelector('[data-rr-editor]') && root.dataset.rrState !== 'loading', 'cancel preview race');
  } finally { observer.disconnect(); }
}
