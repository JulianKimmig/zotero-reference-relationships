/** Interactions with the actual official rule preference pane and typed controls. */
import { check, until, click, type } from './ui-helpers.sys.mjs';
import { checked } from './catalog-helpers.sys.mjs';

export const paneID = 'reference-relationships-rules';

/** Open Zotero's official preferences after registration and fragment mounting. @param {object} api Actual platform. @param {string} library Portable scope. @returns {Promise<object>} Real window/root and registration count observed before waiting. */
export async function preferences(api, library = 'self') {
  const { Zotero } = api;
  const initialRegistrationCount = Zotero.PreferencePanes.pluginPanes.filter(pane => pane.id === paneID).length;
  await until(Zotero, () => Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === paneID), 'official rule preference registration');
  const count = Zotero.PreferencePanes.pluginPanes.filter(pane => pane.id === paneID).length;
  check(count === 1, `Official rule preferences pane is not registered exactly once: ${JSON.stringify({ count, runtime: Zotero.ReferenceRelationships?.state })}`);
  const window = Zotero.Utilities.Internal.openPreferences(paneID);
  const root = await until(Zotero, () => {
    const root = window.document.querySelector('[data-rr-preferences]');
    return root?.isConnected && root.dataset.rrState === 'ready' && root.querySelector('[data-rr-library]') ? root : null;
  }, 'current official preferences fragment and library data');
  const selector = root.querySelector('[data-rr-library]');
  if (selector.value !== library) {
    type(window, selector, library);
    await until(Zotero, () => root.dataset.rrState === 'ready' && root.dataset.rrLibrary === library, 'selected preference library');
  }
  check(root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().height > 0, 'Official preferences are not visible');
  return { window, root, initialRegistrationCount };
}

/** Open an actual existing rule or a blank definition. @param {object} api Native API. @param {Element} root Preference root. @param {string|null} id Existing identity. @returns {Promise<Element>} Real editor. */
export async function openRule(api, root, id = null) {
  if (id === null) click(root, 'new-rule');
  else {
    const row = [...root.querySelectorAll('[data-rr-rule-id]')].find(row => row.dataset.rrRuleId === id);
    check(!!row, `Rule ${id} is absent from preferences`); click(row, 'edit-rule');
  }
  return until(api.Zotero, () => root.querySelector('[data-rr-rule-editor]'), 'rule editor');
}

/** Fill explicit type selections and optional root-note mapping from scratch. @param {Window} window Owner. @param {Element} editor Form. @param {object} overrides Definition choices. @returns {void} */
export function fillRule(window, editor, overrides = {}) {
  const values = { id: 'inverse-ui', rootType: 'referencing', inputType: 'referencing', outputType: 'referenced-by', transform: 'reverse', ...overrides };
  for (const [name, value] of Object.entries(values)) type(window, editor.querySelector(`[data-rr-rule-field="${name}"]`), value);
  const mode = editor.querySelector('[data-rr-map-mode="note"]');
  if (mode) {
    type(window, mode, 'root'); type(window, editor.querySelector('[data-rr-map-root="note"]'), 'note');
  }
}

/** Require a fresh impact review to enable save. @param {object} api Native API. @param {Element} editor Form. @returns {Promise<Element>} Review. */
export async function previewRule(api, editor) {
  click(editor, 'preview-rule');
  await until(api.Zotero, () => !editor.querySelector('[data-rr-action="save-rule"]').disabled, 'rule impact review');
  return editor.querySelector('[data-rr-rule-review]');
}

/** Save a reviewed form and await refreshed current authority. @param {object} api Native API. @param {Element} root Preferences. @returns {Promise<void>} */
export async function saveRule(api, root) {
  click(root, 'save-rule');
  await until(api.Zotero, () => !root.querySelector('[data-rr-rule-editor]') && root.dataset.rrState === 'ready', 'rule save and reload');
}

/** Cancel the current draft with no save. @param {object} api Native API. @param {Element} root Preferences. @returns {Promise<void>} */
export async function cancelRule(api, root) {
  click(root, 'cancel-rule');
  await until(api.Zotero, () => !root.querySelector('[data-rr-rule-editor]'), 'rule cancellation');
}

/** Toggle enabled through the actual checkbox and save an explicitly reviewed result. @param {object} api Native API. @param {Element} root Preferences. @param {string} id Rule. @param {boolean} enabled Desired state. @returns {Promise<object>} Review counts. */
export async function toggleRule(api, root, id, enabled) {
  const editor = await openRule(api, root, id); checked(editor.querySelector('[data-rr-rule-field="enabled"]'), enabled);
  const review = await previewRule(api, editor);
  const counts = { added: Number(review.dataset.rrAdded), updated: Number(review.dataset.rrUpdated), removed: Number(review.dataset.rrRemoved) };
  await saveRule(api, root); return counts;
}

/** Return the named rule from actual public authority. @param {object} app Application. @param {string} id Identity. @returns {Promise<object>} Stored rule. */
export async function storedRule(app, id) { return (await app.read('self')).snapshot.rules.find(rule => rule.id === id); }

/** Require exact native head/snapshot to remain unchanged. @param {object} app Public application. @param {object} before Captured state. @returns {Promise<void>} */
export async function sameAuthority(app, before) {
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Canceled or invalid rule form changed authority');
}
