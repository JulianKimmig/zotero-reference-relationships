/** Full create/inverse-rule/edit/remove journey driven exclusively by external trusted OS keys after fixture setup. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { book, commits, ref } from './rules-fixtures.sys.mts';
import { check, selectPane, until } from './ui-helpers.sys.mts';
import { present, readyState } from './evidence.sys.mts';
import { NativeKeyboardDriver, activeControl } from './keyboard-driver.sys.mts';
import type { TestWindow } from './platform-contracts.mts';
import { NativeAccessibilityAudit } from './accessibility-audit.sys.mts';
import { verifyNativeKeyboardPublication } from './keyboard-packets.sys.mts';

/** Locate an actual opened native window without activating it or creating a replacement. @param api Real host. @param uri Native document URI. @returns Ready current window. */
async function opened(api: NativeAPI, uri: string): Promise<TestWindow> {
  return until(api.Zotero, () => [...api.Services.wm.getEnumerator(null)].find(window => !window.closed
    && window.location.href === uri && window.document.readyState === 'complete'), `opened ${uri}`);
}

/** Perform the complete actual keyboard workflow and persist evidence before assertions fail. @param job Exact artifact and owned anonymous data. @param api Real installed host resources. @returns Authority, derived effects and trusted event evidence; no programmatic UI activation after initial setup. */
export async function qualityKeyboardJourney(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, io = present(api.IOUtils), exchange = `${job.data}/keyboard-journey`;
  check(job.action === 'quality:keyboard-journey' && job.data === Zotero.DataDirectory.dir, 'Keyboard journey job isolation mismatch');
  check(!Zotero.Users.getCurrentUserID(), 'Keyboard journey requires unsigned-in client');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application;
  check((await app.read('self')).state === 'uninitialized', 'Keyboard journey requires empty authority');
  const a = await book(Zotero, 'keyboard-source Café 你好'), b = await book(Zotero, 'keyboard-target');
  const window = Zotero.getMainWindow(), root = await selectPane(Zotero, window, a);
  const driver = new NativeKeyboardDriver(job, api), stages: object[] = [];
  const accessibility = new NativeAccessibilityAudit(api);
  const clearedErrors: { label: string; nativeName: string | null; absentFromTree: boolean }[] = [];
  /** Persist exact current authority and projected rows after an intentional UI publication. @param label Completed workflow stage. @returns Current validated ready state. */
  async function checkpoint(label: string) {
    app.invalidateAll(); const state = readyState(await app.read('self'));
    const rows = await app.listRelationships(ref(a), 'both', null, { offset: 0, limit: 100 });
    stages.push({ label, state, rows, manifests: await commits(api) });
    await io.writeUTF8(`${exchange}/checkpoint-${stages.length}.json`, JSON.stringify(stages.at(-1)), { mode: 'create', flush: true });
    return { state, rows };
  }
  /** Wait until a real preview has enabled its corresponding confirmation. @param scope Current editor. @param action Confirmation action. @returns Enabled button. */
  async function reviewed(scope: HTMLElement, action: string) {
    return until(Zotero, () => scope.querySelector<HTMLButtonElement>(`[data-rr-action="${action}"]:not(:disabled)`), `${action} enabled`);
  }
  /** Require a successful review to remove the old visible and native accessible error name. @param label Workflow stage. @param scope Live editor. @returns Detached proof that validation state is cleared rather than remaining as a stale named alert. */
  async function clearedError(label: string, scope: HTMLElement): Promise<void> {
    const error = present(scope.querySelector<HTMLElement>('[role="alert"]'));
    await until(Zotero, () => {
      const node = accessibility.service.getAccessibleFor(error);
      return error.textContent === '' && !error.hasAttribute('aria-label') && (!node || node.name === null || node.name === '');
    }, `${label} cleared native validation name`);
    const node = accessibility.service.getAccessibleFor(error);
    clearedErrors.push({ label, nativeName: node ? node.name : null, absentFromTree: node === null });
  }
  try {
    await verifyNativeKeyboardPublication(io, exchange);
    await accessibility.ready(window.document);
    // The only programmatic focus is the initial fixture precondition; every later transition is keyboard-driven.
    window.focus(); present(root.querySelector<HTMLButtonElement>('[data-rr-action="add"]')).focus();
    await driver.key(window, 'space', 'open create');
    const editor = await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor="create"]'), 'keyboard create editor');
    check(window.document.activeElement === editor.querySelector('[data-rr-action="choose-target"]'), 'Create editor did not take keyboard focus');
    await accessibility.capture('create relationship', editor, {
      target: ['[data-rr-action="choose-target"]', 'Choose target…'], type: ['[data-rr-type]', 'Relationship type'],
      note: ['[data-rr-field="note"]', 'Note (optional)'], save: ['[data-rr-action="save"]', 'Save relationship'],
      preview: ['[data-rr-action="preview"]', 'Preview'], cancel: ['[data-rr-action="cancel"]', 'Cancel'],
    });
    await accessibility.focused('create entry', present(editor.querySelector('[data-rr-action="choose-target"]')));
    await driver.action(window, editor, 'preview');
    await until(Zotero, () => editor.querySelector('[role="alert"]')?.textContent?.includes('Choose a target reference'), 'keyboard validation error');
    await accessibility.alert('Choose a target reference');
    await accessibility.focused('validation error', present(editor.querySelector('[role="alert"]')));
    check((await app.read('self')).state === 'uninitialized' && await commits(api) === 0, 'Invalid keyboard preview wrote authority');
    await driver.action(window, editor, 'choose-target');
    const dialog = await opened(api, 'chrome://zotero/content/selectItemsDialog.xhtml');
    await dialog.itemsView.waitForLoad();
    /** Observe Zotero's actual public query-textbox input field without assigning it. @returns Native search input. */
    const search = () => dialog.document.querySelector<HTMLElement & { inputField: HTMLInputElement }>('#zotero-tb-search-textbox')?.inputField ?? null;
    await driver.text(dialog, search, 'keyboard-target');
    await until(Zotero, () => dialog.itemsView.getSortedItems(true).length === 1
      && dialog.itemsView.getSortedItems(true)[0] === b.id, 'keyboard native picker filtered target');
    await driver.tabTo(dialog, () => dialog.document.querySelector('#zotero-items-tree .virtualized-table'), 'native target rows');
    await driver.key(dialog, 'Home', 'select first filtered target');
    await until(Zotero, () => dialog.itemsView.getSelectedItems(true).includes(b.id), 'keyboard selected native target');
    await driver.key(dialog, 'Return', 'accept native target');
    await until(Zotero, () => dialog.closed && editor.querySelector('[data-rr-target-key]')?.getAttribute('data-rr-target-key') === b.key, 'keyboard picker accepted');
    await driver.select(window, () => editor.querySelector<HTMLSelectElement>('[data-rr-type]'), 'referencing');
    await driver.text(window, () => editor.querySelector('[data-rr-field="note"]'), 'keyboard note');
    await driver.action(window, editor, 'preview'); await reviewed(editor, 'save');
    await clearedError('relationship preview', editor);
    await driver.action(window, editor, 'save');
    await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.dataset.rrState === 'ready', 'keyboard relationship saved');
    const created = await checkpoint('created');
    check(created.state.snapshot.assertions.length === 1 && created.state.snapshot.assertions[0].metadata.note === 'keyboard note', 'Keyboard creation differs');
    const assertionID = created.state.snapshot.assertions[0].id;
    await driver.action(window, root, 'manage-rules');
    const preferences = await opened(api, 'chrome://zotero/content/preferences/preferences.xhtml');
    const rules = await until(Zotero, () => preferences.document.querySelector<HTMLElement>('[data-rr-preferences][data-rr-state="ready"]'), 'keyboard preferences ready');
    await driver.action(preferences, rules, 'new-rule');
    const form = await until(Zotero, () => rules.querySelector<HTMLElement>('[data-rr-rule-editor]'), 'keyboard inverse form');
    await accessibility.ready(preferences.document);
    await accessibility.capture('inverse rule form', form, {
      id: ['[data-rr-rule-field="id"]', 'Stable rule ID'], enabled: ['[data-rr-rule-field="enabled"]', 'Enabled'],
      root: ['[data-rr-rule-field="rootType"]', 'Explicit root type'], input: ['[data-rr-rule-field="inputType"]', 'Matching relationship type'],
      output: ['[data-rr-rule-field="outputType"]', 'Output relationship type'], transform: ['[data-rr-rule-field="transform"]', 'Output endpoints'],
    });
    await accessibility.focused('rule entry', present(form.querySelector('[data-rr-rule-field="id"]')));
    await driver.action(preferences, form, 'preview-rule');
    await until(Zotero, () => form.querySelector('[role="alert"]')?.textContent?.includes('Invalid stable identifier'), 'keyboard rule validation error');
    await accessibility.alert('Invalid stable identifier');
    await accessibility.focused('rule validation error', present(form.querySelector('[role="alert"]')));
    check((await app.read('self')).state === 'ready' && await commits(api) === 1, 'Invalid rule preview published authority');
    await driver.text(preferences, () => form.querySelector('[data-rr-rule-field="id"]'), 'keyboard-inverse');
    for (const [field, value] of [['rootType', 'referencing'], ['inputType', 'referencing'], ['outputType', 'referenced-by'], ['transform', 'reverse']]) {
      await driver.select(preferences, () => form.querySelector<HTMLSelectElement>(`[data-rr-rule-field="${field}"]`), value);
    }
    await driver.select(preferences, () => form.querySelector<HTMLSelectElement>('[data-rr-map-mode="note"]'), 'root');
    await driver.select(preferences, () => form.querySelector<HTMLSelectElement>('[data-rr-map-root="note"]'), 'note');
    await driver.action(preferences, form, 'preview-rule'); await reviewed(form, 'save-rule');
    await clearedError('rule preview', form);
    await driver.action(preferences, form, 'save-rule');
    await until(Zotero, () => !rules.querySelector('[data-rr-rule-editor]') && rules.dataset.rrState === 'ready', 'keyboard rule saved');
    const inverse = await checkpoint('inverse rule configured');
    const derived = inverse.rows.relationships.find(row => row.type === 'referenced-by');
    check(inverse.state.snapshot.assertions.length === 1 && inverse.state.snapshot.rules.length === 1
      && derived?.source.key === b.key && derived.target.key === a.key && derived.metadata.note === 'keyboard note'
      && derived.assertions.length === 0 && derived.supports.length === 1, 'Keyboard inverse rule differs');
    await driver.keys(preferences, [{ key: 'w', modifiers: ['Control_L'] }], 'close official preferences');
    await until(Zotero, () => preferences.closed && root.dataset.rrState === 'ready', 'keyboard return to main window');
    const manual = () => [...root.querySelectorAll<HTMLElement>('[data-rr-relation]')].find(row => !!row.querySelector('[data-rr-action="edit"]')) ?? null;
    await driver.action(window, present(manual()), 'edit');
    const edit = await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor="edit"]'), 'keyboard edit form');
    await accessibility.capture('edit relationship', edit, { source: ['[data-rr-action="choose-source"]', 'Choose source…'],
      note: ['[data-rr-field="note"]', 'Note (optional)'], save: ['[data-rr-action="save"]', 'Save relationship'] });
    await driver.text(window, () => edit.querySelector('[data-rr-field="note"]'), 'edited note');
    await driver.action(window, edit, 'preview'); await reviewed(edit, 'save'); await driver.action(window, edit, 'save');
    await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.dataset.rrState === 'ready', 'keyboard edit saved');
    const edited = await checkpoint('edited');
    check(edited.state.snapshot.assertions.length === 1 && edited.state.snapshot.assertions[0].id === assertionID
      && edited.rows.relationships.every(row => row.metadata.note === 'edited note'), 'Keyboard edit lost root identity or inverse metadata');
    await driver.action(window, present(manual()), 'remove');
    const remove = await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor="remove"]'), 'keyboard removal confirmation');
    await accessibility.capture('remove relationship', remove, { save: ['[data-rr-action="save"]', 'Confirm removal'],
      cancel: ['[data-rr-action="cancel"]', 'Cancel'] });
    await reviewed(remove, 'save'); await driver.action(window, remove, 'save');
    await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.dataset.rrState === 'ready', 'keyboard removal saved');
    const removed = await checkpoint('removed');
    check(removed.state.snapshot.assertions.length === 0 && removed.state.snapshot.rules.length === 1
      && removed.rows.relationships.length === 0 && await commits(api) === 4, 'Keyboard removal did not remove solely supported inverse');
    check(driver.events.some(event => event.type === 'input') && driver.events.some(event => event.type === 'click')
      && driver.events.every(event => event.trusted), 'Keyboard journey has missing or untrusted events');
    check(activeControl(window.document) === root.querySelector('[data-rr-action="add"]'), 'Keyboard removal did not restore Add focus');
    await accessibility.focused('after removal', present(root.querySelector('[data-rr-action="add"]')));
    accessibility.healthy();
    return { actualNativeKeyboard: true, unsignedIn: !Zotero.Users.getCurrentUserID(), initialFocusIsSetup: true,
      validationErrorObserved: true, stages, steps: driver.steps, events: driver.events, clearedErrors,
      accessibility: { panels: accessibility.panels, focus: accessibility.focus, events: accessibility.events,
        errors: accessibility.errors, consumers: accessibility.service.getConsumers() } };
  } catch (error) {
    await io.writeUTF8(`${exchange}/error.json`, JSON.stringify({ message: error instanceof Error ? error.message : String(error),
      stages, steps: driver.steps, events: driver.events, accessibility: { panels: accessibility.panels,
        focus: accessibility.focus, events: accessibility.events, errors: accessibility.errors } }), { mode: 'create', flush: true });
    throw error;
  } finally { try { accessibility.dispose(); } finally { driver.dispose(); } }
}
