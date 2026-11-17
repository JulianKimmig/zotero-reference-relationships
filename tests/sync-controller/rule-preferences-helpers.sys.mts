/** Interactions with the actual official rule preference pane and typed controls. */
import type { RepositoryState } from '../../src/storage/contracts.mts';
import { present, readyState } from './evidence.sys.mts';
import type { TestWindow } from './platform-contracts.mts';
import type { RelationshipApplication } from '../../src/application/service.mts';
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import { check, until, click, type } from './ui-helpers.sys.mts';
import { checked } from './catalog-helpers.sys.mts';

export const paneID = 'reference-relationships-rules';

/** Require evidence with a static fixture/control label instead of an unlocatable generic absence. @param value Actual observation. @param label Non-secret fixture or control label. @returns Present observation. */
export function requiredRuleEvidence<T>(value: T, label: string): NonNullable<T> {
  check(value !== null && value !== undefined, `Missing rule preference evidence: ${label}`); return value;
}

/** Open Zotero's official preferences after registration and fragment mounting. @param {object} api Actual platform. @param {string} library Portable scope. @returns {Promise<object>} Real window/root and registration count observed before waiting. */
export async function preferences(api: NativeAPI, library: string = 'self') {
  const { Zotero } = api;
  const initialRegistrationCount = Zotero.PreferencePanes.pluginPanes.filter(pane => pane.id === paneID).length;
  await until(Zotero, () => Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === paneID), 'official rule preference registration');
  const count = Zotero.PreferencePanes.pluginPanes.filter(pane => pane.id === paneID).length;
  check(count === 1, `Official rule preferences pane is not registered exactly once: ${JSON.stringify({ count, runtime: Zotero.ReferenceRelationships?.state })}`);
  const window = Zotero.Utilities.Internal.openPreferences(paneID);
  const root = await until(Zotero, () => {
    const root = window.document.querySelector<HTMLElement>('[data-rr-preferences]');
    return root?.isConnected && root.dataset.rrState === 'ready' && root.querySelector<HTMLSelectElement>('[data-rr-library]') ? root : null;
  }, 'current official preferences fragment and library data');
  const selector = root.querySelector<HTMLSelectElement>('[data-rr-library]');
  if (requiredRuleEvidence(selector, 'preferences.library-selector').value !== library) {
    type(window, selector, library);
    await until(Zotero, () => root.dataset.rrState === 'ready' && root.dataset.rrLibrary === library, 'selected preference library');
  }
  check(root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().height > 0, 'Official preferences are not visible');
  return { window, root, initialRegistrationCount };
}

/** Open an actual existing rule or a blank definition. @param {object} api Native API. @param {Element} root Preference root. @param {string|null} id Existing identity. @returns {Promise<Element>} Real editor. */
export async function openRule(api: NativeAPI, root: HTMLElement, id: string|null = null) {
  if (id === null) click(root, 'new-rule');
  else {
    const row = [...root.querySelectorAll<HTMLElement>('[data-rr-rule-id]')].find(row => row.dataset.rrRuleId === id);
    check(!!row, `Rule ${id} is absent from preferences`); click(row, 'edit-rule');
  }
  return until(api.Zotero, () => root.querySelector<HTMLElement>('[data-rr-rule-editor]'), 'rule editor');
}

/** Fill explicit type selections and optional root-note mapping from scratch. @param {Window} window Owner. @param {Element} editor Form. @param {object} overrides Definition choices. @returns {void} */
export function fillRule(window: TestWindow, editor: HTMLElement, overrides = {}) {
  const values = { id: 'inverse-ui', rootType: 'referencing', inputType: 'referencing', outputType: 'referenced-by', transform: 'reverse', ...overrides };
  for (const [name, value] of Object.entries(values)) type(window, editor.querySelector<HTMLSelectElement>(`[data-rr-rule-field="${name}"]`), value);
  const mode = editor.querySelector<HTMLSelectElement>('[data-rr-map-mode="note"]');
  if (mode) {
    type(window, mode, 'root'); type(window, editor.querySelector<HTMLSelectElement>('[data-rr-map-root="note"]'), 'note');
  }
}

/** Require a fresh impact review to enable save. @param {object} api Native API. @param {Element} editor Form. @returns {Promise<Element>} Review. */
export async function previewRule(api: NativeAPI, editor: HTMLElement) {
  click(editor, 'preview-rule');
  await until(api.Zotero, () => !present(editor.querySelector<HTMLButtonElement>('[data-rr-action="save-rule"]')).disabled, 'rule impact review');
  return editor.querySelector<HTMLElement>('[data-rr-rule-review]');
}

/** Save a reviewed form and await refreshed current authority. @param {object} api Native API. @param {Element} root Preferences. @returns {Promise<void>} */
export async function saveRule(api: NativeAPI, root: HTMLElement) {
  click(root, 'save-rule');
  await until(api.Zotero, () => !root.querySelector<HTMLElement>('[data-rr-rule-editor]') && root.dataset.rrState === 'ready', 'rule save and reload');
}

/** Cancel the current draft with no save. @param {object} api Native API. @param {Element} root Preferences. @returns {Promise<void>} */
export async function cancelRule(api: NativeAPI, root: HTMLElement) {
  click(root, 'cancel-rule');
  await until(api.Zotero, () => !root.querySelector<HTMLElement>('[data-rr-rule-editor]'), 'rule cancellation');
}

/** Toggle enabled through the actual checkbox and save an explicitly reviewed result. @param {object} api Native API. @param {Element} root Preferences. @param {string} id Rule. @param {boolean} enabled Desired state. @returns {Promise<object>} Review counts. */
export async function toggleRule(api: NativeAPI, root: HTMLElement, id: string, enabled: boolean) {
  const editor = await openRule(api, root, id); checked(editor.querySelector<HTMLInputElement>('[data-rr-rule-field="enabled"]'), enabled);
  const review = await previewRule(api, editor);
  const counts = { added: Number(present(review).dataset.rrAdded), updated: Number(present(review).dataset.rrUpdated), removed: Number(present(review).dataset.rrRemoved) };
  await saveRule(api, root); return counts;
}

/** Return the named rule from actual public authority. @param {object} app Application. @param {string} id Identity. @returns {Promise<object>} Stored rule. */
export async function storedRule(app: RelationshipApplication, id: string) {
  return requiredRuleEvidence(readyState((await app.read('self'))).snapshot.rules.find(rule => rule.id === id), `stored-rule.${id}`);
}

/** Verify disabled and deleted declarations directly against one public authority read; absence is required for the deleted rule. @param app Actual application. @returns Completion or the labeled missing/preservation failure. */
export async function verifyRestartRules(app: RelationshipApplication): Promise<void> {
  const rules = readyState(await app.read('self')).snapshot.rules;
  const conditional = requiredRuleEvidence(rules.find(rule => rule.id === 'conditional-ui'), 'restart.conditional-ui');
  check(!conditional.enabled && !rules.some(rule => rule.id === 'symmetric-ui'), 'Restart lost disable/delete state');
}

/** Inspect already-installed runtime, public authority and real preference controls without installing, saving or toggling the addon. Unavailable runtime/pane evidence is reported explicitly. @param job Prior anonymous fixture receipt, optionally with expected snapshot. @param api Actual native resources. @returns Read-only diagnostic receipt with actual authority, addon status and control-presence flags. */
export async function inspectRuleRestart(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addon = await AddonManager.getAddonByID('reference-relationships@zotero-plugins.local');
  const runtime = Zotero.ReferenceRelationships, app = runtime?.application;
  const authority = app ? await app.read('self') : null;
  const registrationCount = Zotero.PreferencePanes.pluginPanes.filter(pane => pane.id === paneID).length;
  const report = { readOnlyInspection: true, addon: { present: addon !== null, active: addon === null ? null : addon.isActive },
    runtime: { present: runtime !== undefined, state: runtime === undefined ? null : runtime.state }, registrationCount, authority,
    expectedSnapshotProvided: job.snapshot !== undefined,
    expectedSnapshotMatches: job.snapshot === undefined || authority?.state !== 'ready' ? null : JSON.stringify(authority.snapshot) === JSON.stringify(job.snapshot) };
  if (!app || registrationCount !== 1) return { ...report, controls: null, controlsObserved: false };
  const { window, root } = await preferences(api);
  try {
    const rows = [...root.querySelectorAll<HTMLElement>('[data-rr-rule-id]')];
    const inverseRow = rows.some(row => row.dataset.rrRuleId === 'inverse-ui');
    const editor = inverseRow ? await openRule(api, root, 'inverse-ui') : null;
    const controls = { librarySelector: !!root.querySelector('[data-rr-library]'), newRule: !!root.querySelector('[data-rr-action="new-rule"]'),
      inverseRow, conditionalRow: rows.some(row => row.dataset.rrRuleId === 'conditional-ui'),
      symmetricRow: rows.some(row => row.dataset.rrRuleId === 'symmetric-ui'), editor: editor !== null,
      outputType: !!editor?.querySelector('[data-rr-rule-field="outputType"]'), noteMapMode: !!editor?.querySelector('[data-rr-map-mode="note"]'),
      noteMapRoot: !!editor?.querySelector('[data-rr-map-root="note"]') };
    await sameAuthority(app, requiredRuleEvidence(authority, 'inspect.authority'));
    return { ...report, controls, controlsObserved: true, authorityUnchanged: true };
  } finally { window.close(); }
}

/** Require exact native head/snapshot to remain unchanged. @param {object} app Public application. @param {object} before Captured state. @returns {Promise<void>} */
export async function sameAuthority(app: RelationshipApplication, before: RepositoryState) {
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Canceled or invalid rule form changed authority');
}
