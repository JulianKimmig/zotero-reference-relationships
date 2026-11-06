/** Actual Zotero main-window, general-preference and registration observations; no fabricated plugin UI or source replacements. */
import type { NativeAPI } from './native-api.mts';
import type { TestItem, TestWindow } from './platform-contracts.mts';
import { check, until } from './ui-helpers.sys.mts';

export const shutdownAddonID = 'reference-relationships@zotero-plugins.local';
export const shutdownGeneralPaneID = 'zotero-prefpane-general';

/** Core preference registry and native section data researched in preferencePanes.js and pluginAPI/itemPaneManager.js. */
type RegistryPlatform = Omit<NativeAPI['Zotero'], 'PreferencePanes'> & {
  PreferencePanes: Omit<NativeAPI['Zotero']['PreferencePanes'], 'pluginPanes'> & {
    builtInPanes?: readonly { id: string }[]; pluginPanes: { id: string; pluginID?: string }[];
  };
  ItemPaneManager: NativeAPI['Zotero']['ItemPaneManager'] & {
    customSectionData: { options: { paneID: string; pluginID: string }[] };
  };
};
/** Native preferences window exposes its real pane registry and loaded/visible state. */
export type GeneralPreferencesWindow = TestWindow & {
  Zotero_Preferences?: {
    navigation: { value: string }; panes: Map<string, { loaded: boolean; container: HTMLElement }>;
  };
};

/**
 * Enumerate actual window-mediator registrations of a known native type.
 * @param api Real Gecko window mediator.
 * @param type Native main-window or preferences window type.
 * @returns Open registered native windows, never synthetic DOM windows.
 */
export function shutdownWindows(api: NativeAPI, type: 'navigator:browser' | 'zotero:pref'): TestWindow[] {
  return [...api.Services.wm.getEnumerator(type)].filter(window => !window.closed);
}

/**
 * Read native and plugin registrations without invoking or replacing their internals.
 * @param api Real platform, window mediator and current plugin singleton.
 * @returns Counts from native registries, plugin tracked windows and actual mounted DOM.
 */
export function shutdownRegistrations(api: NativeAPI) {
  const Zotero = api.Zotero as RegistryPlatform, main = shutdownWindows(api, 'navigator:browser');
  const prefs = shutdownWindows(api, 'zotero:pref'), runtime = Zotero.ReferenceRelationships;
  const tracked = runtime ? [...runtime.windows] : [];
  const panes = Zotero.PreferencePanes.pluginPanes;
  return { nativeMainWindows: main.length, zoteroMainWindows: Zotero.getMainWindows().length,
    nativePreferencesWindows: prefs.length, builtInPreferencePanes: Zotero.PreferencePanes.builtInPanes?.length ?? null,
    pluginPresent: Object.hasOwn(Zotero, 'ReferenceRelationships'), pluginState: runtime?.state ?? 'absent',
    pluginTrackedMainWindows: tracked.length, pluginTrackedOpenMainWindows: tracked.filter(window => main.includes(window as TestWindow)).length,
    pluginTrackedClosedWindows: tracked.filter(window => window.closed).length,
    allPluginPreferenceRegistrations: panes.length,
    relationshipPreferenceRegistrations: panes.filter(pane => pane.pluginID === shutdownAddonID || pane.id === 'reference-relationships-rules').length,
    relationshipSectionRegistrations: Zotero.ItemPaneManager.customSectionData.options.filter(section => section.pluginID === shutdownAddonID).length,
    relationshipDOMRoots: main.reduce((count, window) => count + window.document.querySelectorAll('[data-rr-pane]').length, 0),
    relationshipPreferenceDOMRoots: prefs.reduce((count, window) => count + window.document.querySelectorAll('[data-rr-preferences]').length, 0) };
}

/**
 * Verify support for the same native General preferences operation in either variant.
 * @param api Actual core API and built-in pane registry, independent of addon state.
 * @returns Whether the researched core pane and opener are available; no alternate UI is constructed.
 */
export function supportsShutdownPreferences(api: NativeAPI): boolean {
  const Zotero = api.Zotero as RegistryPlatform;
  return typeof Zotero.Utilities.Internal.openPreferences === 'function'
    && !!Zotero.PreferencePanes.builtInPanes?.some(pane => pane.id === shutdownGeneralPaneID);
}

/**
 * Await real native main-window initialization and both trees.
 * @param api Actual native platform.
 * @param window Registered Zotero main window.
 * @returns Completion only after core chrome and trees are loaded.
 */
export async function shutdownMainReady(api: NativeAPI, window: TestWindow): Promise<void> {
  await until(api.Zotero, () => !window.closed && window.document.readyState === 'complete'
    && window.ZoteroPane?.loaded && window.ZoteroPane.itemsView && window.ZoteroPane.collectionsView, 'shutdown native main-window trees');
  check(window.document.documentURI === 'chrome://zotero/content/zoteroPane.xhtml', 'Shutdown actions require actual Zotero main chrome');
  check(window.document.documentElement.getAttribute('windowtype') === 'navigator:browser', 'Shutdown main window has the wrong native type');
  await Promise.all([window.ZoteroPane.itemsView.waitForLoad(), window.ZoteroPane.collectionsView.waitForLoad()]);
}

/**
 * Select a real persisted book through the native pane and verify actual tree selection.
 * @param api Actual native platform.
 * @param window Open real main window.
 * @param item One of the two persisted fixture books.
 * @returns Saved item identity and verified native selection count, independent of plugin DOM.
 */
export async function shutdownSelect(api: NativeAPI, window: TestWindow, item: TestItem) {
  await window.ZoteroPane.selectItem(item.id);
  await until(api.Zotero, () => {
    const selected = window.ZoteroPane.getSelectedItems();
    return selected.length === 1 && selected[0].id === item.id;
  }, 'shutdown actual native book selection');
  return { itemKey: item.key, selectedCount: window.ZoteroPane.getSelectedItems().length };
}

/**
 * Open the supported core General pane and await its actual visible fragment.
 * @param api Actual native API; caller must first check supportsShutdownPreferences.
 * @param own Record the returned native window immediately so failure cleanup can close it.
 * @returns Registered native preferences window after actual first-pane readiness.
 */
export async function shutdownOpenPreferences(api: NativeAPI, own: (window: TestWindow) => void): Promise<GeneralPreferencesWindow> {
  const window = api.Zotero.Utilities.Internal.openPreferences(shutdownGeneralPaneID) as GeneralPreferencesWindow;
  own(window);
  await until(api.Zotero, () => window.document.readyState === 'complete' && window.Zotero_Preferences?.navigation, 'shutdown native preferences controller');
  const controller = window.Zotero_Preferences!;
  await until(api.Zotero, () => {
    const pane = controller.panes.get(shutdownGeneralPaneID);
    return controller.navigation.value === shutdownGeneralPaneID && pane?.loaded && pane.container.isConnected && !pane.container.hidden;
  }, 'shutdown visible native General preferences pane');
  check(window.document.documentURI === 'chrome://zotero/content/preferences/preferences.xhtml', 'Shutdown preferences must use core chrome');
  check(shutdownWindows(api, 'zotero:pref').includes(window), 'Native preferences window is absent from the mediator');
  return window;
}

/**
 * Close one sidecar-owned native window and await actual removal from its mediator registry.
 * @param api Actual native API.
 * @param window Sidecar-owned secondary main or General preferences window.
 * @param type Expected native registration type.
 * @returns Completion after closed state, mediator removal and one native event turn.
 */
export async function shutdownClose(api: NativeAPI, window: TestWindow, type: 'navigator:browser' | 'zotero:pref'): Promise<void> {
  if (!window.closed) window.close();
  await until(api.Zotero, () => window.closed && !shutdownWindows(api, type).includes(window), 'shutdown native window closed and unregistered');
  await api.Zotero.Promise.delay(0);
}
