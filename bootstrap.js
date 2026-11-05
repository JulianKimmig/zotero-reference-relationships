/** Zotero lifecycle entrypoints with one isolated module generation and shared native application. */
/* global Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder */
var relationshipRuntime;
var relationshipResource;

/**
 * Create the shared service and register existing main windows.
 * @param {{id: string, version: string, rootURI: string}} addon Installed descriptor.
 * @returns {Promise<void>} Completes native UI and preference registration.
 */
async function startup({ id, version, rootURI }) {
  if (Object.hasOwn(Zotero, 'ReferenceRelationships')) {
    throw new Error('Reference Relationships is already running');
  }
  const scope = {};
  Services.scriptloader.loadSubScript(rootURI + 'src/runtime/lifecycle.js', scope);
  const handler = Services.io.getProtocolHandler('resource').QueryInterface(Components.interfaces.nsIResProtocolHandler);
  relationshipResource = `rr-${Services.uuid.generateUUID().toString().replace(/[^a-z0-9]/gi, '').toLowerCase()}`;
  handler.setSubstitution(relationshipResource, Services.io.newURI(rootURI));
  const { createPlugin } = ChromeUtils.importESModule(`resource://${relationshipResource}/src/runtime/plugin.mjs`);
  const controller = createPlugin({ id, rootURI, Zotero, DOMParser, crypto, TextEncoder });
  relationshipRuntime = new scope.RelationshipRuntime({ id, version, controller });
  for (const window of Zotero.getMainWindows()) {
    relationshipRuntime.addWindow(window);
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
function onMainWindowLoad({ window }) {
  relationshipRuntime.addWindow(window);
}

/**
 * Release a closing window, including callbacks delivered after shutdown.
 * @param {{window: Window}} event Zotero's main-window unload event.
 * @returns {void}
 */
function onMainWindowUnload({ window }) {
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
  handler.setSubstitution(relationshipResource, null); relationshipResource = undefined;
}
