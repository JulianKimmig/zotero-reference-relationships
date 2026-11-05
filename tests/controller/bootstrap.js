/** Real Zotero lifecycle assertions, loaded only into a dedicated test profile. */
/* global Zotero, Services, ChromeUtils, IOUtils */
var rrChecks = [];

/** Read a required test-only string preference. @param {string} key @returns {string} */
function preference(key) {
  return Services.prefs.getStringPref(`extensions.referenceRelationships.test.${key}`);
}

/** Fail the active test with a diagnostic. @param {boolean} condition @param {string} message @returns {void} */
function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** Poll asynchronous platform callbacks. @param {Function} predicate @param {string} label @returns {Promise<*>} */
async function until(predicate, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await Zotero.Promise.delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}

/** Verify the production addon's actual HTTPS manifest through Zotero's checker. @param {string} id production addon id. @param {string} url published update manifest. @returns {Promise<void>} */
async function checkEmptyUpdates(id, url) {
  check(url.startsWith('https://'), 'update URL must be a real HTTPS no-update manifest');
  const { AddonUpdateChecker } = ChromeUtils.importESModule('resource://gre/modules/addons/AddonUpdateChecker.sys.mjs');
  await new Promise((resolve, reject) => {
    AddonUpdateChecker.checkForUpdates(id, url, {
      onUpdateCheckComplete(updates) {
        if (updates.length === 0) resolve();
        else reject(new Error('Update checker returned unexpected releases'));
      },
      onUpdateCheckError(status) { reject(new Error(`Update manifest failed: ${status}`)); },
    });
  });
}

/** Assert the singleton tracks exactly the real windows. @param {object} runtime @returns {void} */
function checkWindows(runtime) {
  const actual = Zotero.getMainWindows();
  check(Object.prototype.toString.call(runtime.windows) === '[object Set]', 'windows must be a Set');
  check(runtime.windows.size === actual.length, 'window registration count differs from real windows');
  for (const window of actual) check(runtime.windows.has(window), 'real main window missing from Set');
}

/** Check startup metadata and window state. @param {object} runtime @returns {void} */
function checkRunning(runtime) {
  check(runtime.id === preference('id'), 'runtime id differs from installed manifest');
  check(runtime.version === preference('version'), 'runtime version differs from installed manifest');
  check(runtime.state === 'running', 'runtime must be running');
  checkWindows(runtime);
}

/** Assert teardown on a retained reference. @param {object} runtime @returns {void} */
function checkStopped(runtime) {
  check(!Object.hasOwn(Zotero, 'ReferenceRelationships'), 'singleton remains after shutdown');
  check(runtime.state === 'stopped', 'retained runtime must be stopped');
  check(runtime.windows.size === 0, 'retained runtime still owns windows');
}

/** Execute lifecycle tests against the real local XPI and AddonManager. @returns {Promise<void>} */
async function runTests() {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  check(Zotero.Profile.dir === preference('profile'), 'runtime profile isolation mismatch');
  check(Zotero.DataDirectory.dir === preference('data'), 'runtime data isolation mismatch');
  check(Zotero.Profile.dir !== Zotero.DataDirectory.dir, 'profile and data must be distinct');
  rrChecks.push('isolation');
  await until(() => Zotero.getMainWindows().length === 1, 'initial main window');
  check(!Object.hasOwn(Zotero, 'ReferenceRelationships'), 'singleton exists before installation');
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addon = await AddonManager.installTemporaryAddon(Zotero.File.pathToFile(preference('xpi')));
  check(addon.id === preference('id') && addon.isActive, 'real XPI did not become active');
  await checkEmptyUpdates(addon.id, addon.updateURL);
  rrChecks.push('updates-empty');
  const original = await until(() => Zotero.ReferenceRelationships, 'startup singleton');
  checkRunning(original);
  rrChecks.push('startup');

  await addon.disable();
  await until(() => !Object.hasOwn(Zotero, 'ReferenceRelationships'), 'disable cleanup');
  checkStopped(original);
  check(!addon.isActive, 'AddonManager still reports an active disabled plugin');
  rrChecks.push('disable');

  await addon.enable();
  const current = await until(() => Zotero.ReferenceRelationships, 'reenable singleton');
  check(current !== original, 'reenable reused stopped runtime');
  check(addon.isActive, 'reenabled plugin is inactive');
  checkRunning(current);
  checkStoppedReference(original);
  rrChecks.push('reenable');

  const first = Zotero.getMainWindows()[0];
  Zotero.openMainWindow();
  const second = await until(() => Zotero.getMainWindows().find(window => window !== first), 'second real main window');
  await until(() => current.windows.has(second), 'second window registration');
  check(second !== first && !second.closed, 'second window is not a distinct open window');
  check(Zotero.ReferenceRelationships === current, 'opening a window replaced the singleton');
  checkRunning(current);
  check(current.windows.size === 2, 'second window must be registered exactly once');
  rrChecks.push('window-open');
  second.close();
  await until(() => second.closed && !current.windows.has(second), 'second window cleanup');
  checkRunning(current);
  check(current.windows.size === 1 && current.windows.has(first), 'closing second window lost first window');
  rrChecks.push('window-close');

  await addon.uninstall();
  await until(() => !Object.hasOwn(Zotero, 'ReferenceRelationships'), 'uninstall singleton cleanup');
  checkStopped(current);
  checkStoppedReference(original);
  check(await AddonManager.getAddonByID(preference('id')) === null, 'uninstalled XPI remains in AddonManager');
  rrChecks.push('uninstall');
}

/** Confirm an earlier generation stays inert. @param {object} runtime @returns {void} */
function checkStoppedReference(runtime) {
  check(runtime.state === 'stopped' && runtime.windows.size === 0, 'stopped generation regained state');
}

/** Persist a machine-readable result before quitting. @param {Error|null} error @returns {Promise<void>} */
async function finish(error) {
  const result = {
    ok: !error, checks: rrChecks, error: error ? `${error.message}\n${error.stack}` : null,
    profile: Zotero.Profile.dir, data: Zotero.DataDirectory.dir, zoteroVersion: Zotero.version,
  };
  if (error) Zotero.logError(error);
  await IOUtils.writeUTF8(preference('result'), JSON.stringify(result, null, 2));
  Services.startup.quit(Services.startup.eForceQuit);
}

/** Schedule the job without blocking plugin/window startup. @returns {void} */
function startup() {
  Promise.resolve().then(runTests).then(() => finish(null), finish).catch(reportFailure);
}

/** Make result-writing failures visible in the process log. @param {Error} error @returns {void} */
function reportFailure(error) {
  Zotero.logError(error);
  Services.startup.quit(Services.startup.eForceQuit);
}

