/** Zotero lifecycle entrypoints; graph behavior belongs to later verified tasks. */
/* global Zotero, Services */
var relationshipRuntime;

/**
 * Create the shared service and register existing main windows.
 * @param {{id: string, version: string, rootURI: string}} addon Installed descriptor.
 * @returns {void} Completes synchronous lifecycle initialization.
 */
function startup({ id, version, rootURI }) {
  if (Object.hasOwn(Zotero, 'ReferenceRelationships')) {
    throw new Error('Reference Relationships is already running');
  }
  const scope = {};
  Services.scriptloader.loadSubScript(rootURI + 'src/runtime/lifecycle.js', scope);
  relationshipRuntime = new scope.RelationshipRuntime({ id, version });
  for (const window of Zotero.getMainWindows()) {
    relationshipRuntime.addWindow(window);
  }
  Zotero.ReferenceRelationships = relationshipRuntime;
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
 * Release a closing main window without affecting the shared runtime.
 * @param {{window: Window}} event Zotero's main-window unload event.
 * @returns {void}
 */
function onMainWindowUnload({ window }) {
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
}
