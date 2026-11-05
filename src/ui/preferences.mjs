/** Official preference registration, native window mounting and explicit teardown ownership. */
import { check } from '../domain/values.mjs';
import { ruleLabels } from './rule-controls.mjs';
import { RulePreferences } from './rule-preferences.mjs';

/** Bind one generation of official preferences without registering before the runtime singleton exists. @param {object} options {Zotero,id,rootURI,app,gateway,report}. @returns {object} register/open/mount/unmount/nativeChange/stop lifecycle. */
export function createPreferences({ Zotero, id, rootURI, app, gateway, report }) {
  const views = new Map(), pendingMounts = new Map(), paneID = 'reference-relationships-rules';
  let registered = false, stopped = false, requestedLibrary = 'self';

  /** Register the official XHTML fragment after publishing its runtime bridge. @returns {Promise<void>} */
  async function register() {
    check(!stopped && !registered, 'Rule preferences registration is unavailable');
    const result = await Zotero.PreferencePanes.register({ pluginID: id, id: paneID, label: 'Reference Relationships',
      src: rootURI + 'src/ui/preferences.xhtml', image: rootURI + 'src/ui/relationships.svg' });
    check(result === paneID, 'Native rule preferences registration failed', 'storage'); registered = true;
  }

  /** Mount only a currently connected owned root; repeated or canceled native load events cannot duplicate it. @param {Window} window Native preference window. @param {Element} root Owned fragment root. @returns {Promise<void>} */
  async function mount(window, root) {
    check(!stopped && !!root, 'Rule preferences are unavailable');
    if (views.has(root)) return;
    if (pendingMounts.has(root)) return pendingMounts.get(root).promise;
    const token = {};
    token.promise = (async () => {
      const t = await ruleLabels(root.ownerDocument);
      if (stopped || pendingMounts.get(root) !== token || !root.isConnected) return;
      const view = new RulePreferences({ window, root, Zotero, app, gateway, t, report }); views.set(root, view);
      try { await view.load(requestedLibrary); }
      catch (error) { view.dispose(); views.delete(root); throw error; }
    })();
    pendingMounts.set(root, token);
    try { await token.promise; }
    finally { if (pendingMounts.get(root) === token) pendingMounts.delete(root); }
  }

  /** Release a removed native fragment, including a mount awaiting localization. @param {Element} root Owned root. @returns {void} */
  function unmount(root) { pendingMounts.delete(root); views.get(root)?.dispose(); views.delete(root); }

  /** Open official preferences for an explicit library through Zotero's supported API. @param {string} library Portable scope. @returns {Promise<void>} */
  async function open(library) {
    check(!stopped && registered, 'Rule preferences are unavailable'); gateway.library(library); requestedLibrary = library;
    const window = Zotero.Utilities.Internal.openPreferences(paneID);
    for (const view of views.values()) if (view.window === window && view.library !== library) await view.load(library);
  }

  /** Forward actual host notifications through the existing shared UI observer. @returns {void} */
  function nativeChange() { for (const view of views.values()) view.nativeChange(); }

  /** Unregister the official pane and release all roots before application teardown. @returns {void} */
  function stop() {
    if (stopped) return; stopped = true; pendingMounts.clear();
    for (const view of views.values()) view.dispose(); views.clear();
    if (registered) { Zotero.PreferencePanes.unregister(paneID); registered = false; }
  }
  return { register, open, mount, unmount, nativeChange, stop, paneID };
}
