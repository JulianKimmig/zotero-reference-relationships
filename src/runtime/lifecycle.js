/** Shared lifecycle state independent of Zotero's platform implementation. */
var RelationshipRuntime = class RelationshipRuntime {
  /**
   * Construct one active generation of the plugin service.
   * @param {{id: string, version: string, controller: object}} addon Installed identity and real application/UI lifecycle.
   */
  constructor({ id, version, controller }) {
    if (typeof id !== 'string' || !id || typeof version !== 'string' || !version) {
      throw new TypeError('An installed plugin id and version are required');
    }
    this.id = id;
    this.version = version;
    this.state = 'running';
    this.windows = new Set();
    if (!controller || typeof controller.addWindow !== 'function' || typeof controller.stop !== 'function') {
      throw new TypeError('A native application/UI controller is required');
    }
    this.controller = controller; this.application = controller.application;
  }

  /**
   * Track a real open window exactly once while this generation is active.
   * @param {Window} window Open Zotero main window supplied by the host.
   * @returns {void}
   */
  addWindow(window) {
    if (this.state !== 'running') {
      throw new Error('Cannot register windows on a stopped runtime');
    }
    if (!window || window.closed) {
      throw new TypeError('An open main window is required');
    }
    this.controller.addWindow(window); this.windows.add(window);
  }

  /**
   * Release a host window, including repeated unload notifications.
   * @param {Window} window Closing or already-closed Zotero main window.
   * @returns {void}
   */
  removeWindow(window) {
    this.controller.removeWindow(window); this.windows.delete(window);
  }

  /**
   * Release all windows permanently for this runtime generation.
   * @returns {void} Repeated calls preserve the stopped state.
   */
  stop() {
    if (this.state === 'stopped') return;
    this.controller.stop();
    this.windows.clear();
    this.state = 'stopped';
  }
};
