/** Zotero lifecycle entrypoints with one isolated module generation and shared native application. */
/* global Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, IOUtils */
var relationshipRuntime: ReferenceRelationshipsHost.Runtime | undefined;
var relationshipResource: string | undefined;

/**
 * Validate installation without initializing runtime services, seeding authority or migrating notes.
 * @param addon Native descriptor supplied by Zotero for install, upgrade or downgrade.
 * @returns Completes after checking native comparator compatibility and essential APIs, packaged identity and startup resources.
 */
async function install(addon: { id: string; version: string; rootURI: string }): Promise<void> {
  if (!addon || typeof addon !== 'object' || addon.id !== 'reference-relationships@zotero-plugins.local') {
    throw new TypeError('Invalid installed addon identity metadata');
  }
  const { id, version, rootURI } = addon;
  if (typeof version !== 'string' || !version || /\s/.test(version)) {
    throw new TypeError('Invalid installed addon version metadata');
  }
  validateInstallRoot(rootURI);
  if (typeof Zotero.version !== 'string' || !Zotero.version) throw new Error('Installation requires Zotero >=10.0.7 compatibility');
  if (typeof Services.vc?.compare !== 'function') throw new Error('Missing native Mozilla version comparator');
  if (typeof Zotero.getMainWindows !== 'function'
    || typeof Zotero.ItemPaneManager?.registerSection !== 'function' || typeof Zotero.ItemPaneManager?.unregisterSection !== 'function'
    || typeof Zotero.PreferencePanes?.register !== 'function' || typeof Zotero.PreferencePanes?.unregister !== 'function'
    || typeof Zotero.Notifier?.registerObserver !== 'function' || typeof Zotero.Notifier?.unregisterObserver !== 'function') {
    throw new Error('Missing essential native registration API');
  }
  // This installed native File API reads file:/jar: channels without importing application modules.
  const reader = Zotero.File as typeof Zotero.File & { getResourceAsync(uri: string): Promise<string> };
  if (typeof reader?.getResourceAsync !== 'function') throw new Error('Missing native local-resource reader');
  /** Read a required local packaged resource without executing it. @param path Addon-relative resource. @returns Nonempty UTF-8 content; native failures propagate. */
  async function readResource(path: string): Promise<string> {
    const contents = await reader.getResourceAsync(rootURI + path);
    if (typeof contents !== 'string' || !contents.trim()) throw new Error(`Empty installation resource: ${path}`);
    return contents;
  }
  const manifest: unknown = JSON.parse(await readResource('manifest.json'));
  if (!installRecord(manifest) || !installRecord(manifest.applications)
    || !installRecord(manifest.applications.zotero)) throw new Error('Invalid packaged addon manifest');
  const compatibility = manifest.applications.zotero;
  if (manifest.version !== version || compatibility.id !== id) {
    throw new Error('Packaged addon manifest identity/version does not match installation metadata');
  }
  const min = compatibility.strict_min_version, max = compatibility.strict_max_version;
  if (typeof min !== 'string' || !/^\d+(?:\.\d+)*$/.test(min)
    || typeof max !== 'string' || !/^\d+(?:\.\d+)*(?:\.\*)?$/.test(max)
    || Services.vc.compare(min, max) > 0) throw new Error('Invalid packaged addon manifest compatibility bounds');
  if (Services.vc.compare(Zotero.version, min) < 0 || Services.vc.compare(Zotero.version, max) > 0) {
    throw new Error('Packaged addon manifest compatibility requires Zotero >=10.0.7 within its declared bounds');
  }
  for (const path of ['src/runtime/lifecycle.js', 'src/runtime/plugin.mjs', 'src/ui/preferences.xhtml',
    'locale/en-US/reference-relationships.ftl']) await readResource(path);
}

/**
 * Require a local unpacked directory or packed addon root as supplied by native getResourceURI().
 * @param rootURI Addon root; remote URLs, queries, fragments and JAR subdirectories are rejected.
 * @returns Completes for a valid local root; invalid metadata throws before native resource access.
 */
function validateInstallRoot(rootURI: string): void {
  if (typeof rootURI !== 'string' || !rootURI.endsWith('/') || /[\s?#]/.test(rootURI)) {
    throw new TypeError('Invalid installed addon rootURI metadata');
  }
  const packed = rootURI.startsWith('jar:');
  if (packed && !rootURI.endsWith('!/')) throw new TypeError('Invalid packed addon rootURI');
  let uri: URL;
  try { uri = new URL(packed ? rootURI.slice(4, -2) : rootURI); }
  catch (error) { throw new TypeError('Invalid installed addon rootURI', { cause: error }); }
  if (uri.protocol !== 'file:' || uri.host) throw new TypeError('Addon rootURI must reference a local installation');
}

/** Narrow untrusted manifest JSON before reading nested metadata. @param value Parsed JSON value. @returns Whether value is a non-array object. */
function installRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Create the shared service and register existing main windows.
 * @param {{id: string, version: string, rootURI: string}} addon Installed descriptor.
 * @returns {Promise<void>} Completes native UI and preference registration.
 */
async function startup({ id, version, rootURI }: { id: string; version: string; rootURI: string }): Promise<void> {
  if (Object.hasOwn(Zotero, 'ReferenceRelationships')) {
    throw new Error('Reference Relationships is already running');
  }
  const scope = {} as { RelationshipRuntime: ReferenceRelationshipsHost.RuntimeConstructor };
  Services.scriptloader.loadSubScript(rootURI + 'src/runtime/lifecycle.js', scope);
  const handler = Services.io.getProtocolHandler('resource').QueryInterface(Components.interfaces.nsIResProtocolHandler);
  relationshipResource = `rr-${Services.uuid.generateUUID().toString().replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
  handler.setSubstitution(relationshipResource, Services.io.newURI(rootURI));
  const { createPlugin } = ChromeUtils.importESModule(`resource://${relationshipResource}/src/runtime/plugin.mjs`);
  const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
  const controller = createPlugin({ id, rootURI, Zotero, DOMParser, crypto, TextEncoder, IOUtils, FilePicker });
  relationshipRuntime = new scope.RelationshipRuntime({ id, version, controller });
  for (const window of Zotero.getMainWindows()) {
    relationshipRuntime!.addWindow(window);
  }
  Zotero.ReferenceRelationships = relationshipRuntime;
  try { await controller.preferences.register(); }
  catch (error) { shutdown(); throw error; }
}

/**
 * Register a new main window in the existing runtime.
 * @param {{window: Window}} event Zotero's main-window load event.
 * @returns {void}
 */
function onMainWindowLoad({ window }: { window: ReferenceRelationshipsHost.Window }): void {
  relationshipRuntime!.addWindow(window);
}

/**
 * Release a closing window, including callbacks delivered after shutdown.
 * @param {{window: Window}} event Zotero's main-window unload event.
 * @returns {void}
 */
function onMainWindowUnload({ window }: { window: ReferenceRelationshipsHost.Window }): void {
  if (!relationshipRuntime) return;
  relationshipRuntime.removeWindow(window);
}

/**
 * Stop the owned service on disable, uninstall, upgrade or application shutdown.
 * @returns {void} Repeated teardown has no effect.
 */
function shutdown() {
  if (!relationshipRuntime) return;
  relationshipRuntime.stop();
  if (Zotero.ReferenceRelationships !== relationshipRuntime) {
    throw new Error('Reference Relationships singleton ownership changed');
  }
  delete Zotero.ReferenceRelationships;
  relationshipRuntime = undefined;
  const handler = Services.io.getProtocolHandler('resource').QueryInterface(Components.interfaces.nsIResProtocolHandler);
  handler.setSubstitution(relationshipResource!, null); relationshipResource = undefined;
}
