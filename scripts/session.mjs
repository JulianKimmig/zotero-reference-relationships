/** Provision isolated real-Zotero sessions and validate the controller protocol. */
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const controllerTemplate = fileURLToPath(new URL('../tests/controller/', import.meta.url));
export const requiredChecks = ['isolation', 'updates-empty', 'startup', 'disable', 'reenable', 'window-open', 'window-close', 'uninstall', 'shutdown-enabled'];
export const expectedZoteroVersion = '10.0.7';

/** Create dedicated directories and a controller bound to a real endpoint. @param {string} xpi @param {string} id @param {string} version @param {string} updateURL actual HTTPS manifest. @returns {Promise<object>} session paths. */
export async function createSession(xpi, id, version, updateURL) {
  if (!updateURL || new URL(updateURL).protocol !== 'https:') throw new Error('A real HTTPS update manifest is required');
  const root = await mkdtemp(join(tmpdir(), 'reference-relationships-integration-'));
  const session = { root, profile: join(root, 'profile'), data: join(root, 'data'), result: join(root, 'result.json') };
  await mkdir(session.profile);
  await mkdir(session.data);
  await mkdir(join(session.profile, 'extensions'));
  const controller = join(root, 'controller');
  await cp(controllerTemplate, controller, { recursive: true });
  const manifestPath = join(controller, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Zotero requires this secure URL to load the controller; only production updates are checked.
  manifest.applications.zotero.update_url = updateURL;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(join(session.profile, 'extensions', 'rr-test-controller@example.test'), controller);
  const prefs = {
    'extensions.autoDisableScopes': 0,
    'extensions.enabledScopes': 15,
    'extensions.startupScanScopes': 15,
    'extensions.zotero.useDataDir': true,
    'extensions.zotero.dataDir': session.data,
    'extensions.zotero.firstRun2': false,
    'extensions.zotero.firstRunGuidance': false,
    'extensions.zotero.firstRun.skipFirefoxProfileAccessCheck': true,
    'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
    'extensions.zoteroWinWordIntegration.skipInstallation': true,
    'extensions.zoteroMacWordIntegration.skipInstallation': true,
    'extensions.zotero.automaticScraperUpdates': false,
    'extensions.zotero.sync.autoSync': false,
    'app.update.auto': false,
    'app.update.enabled': false,
    'browser.dom.window.dump.enabled': true,
    'extensions.logging.enabled': true,
    'devtools.console.stdout.chrome': true,
    'extensions.update.enabled': false,
    'extensions.systemAddon.update.enabled': false,
  };
  for (const [key, value] of Object.entries({ xpi, id, version, ...session })) {
    prefs[`extensions.referenceRelationships.test.${key}`] = value;
  }
  const lines = Object.entries(prefs).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
  await writeFile(join(session.profile, 'user.js'), `${lines.join('\n')}\n`);
  return session;
}

/** Compose argv without shell interpolation. @param {string} executable @param {object} session @returns {string[]} Xvfb arguments. */
export function launchArguments(executable, session) {
  return ['-a', executable, '-no-remote', '-profile', session.profile, '-datadir', session.data, '-ZoteroDebugText'];
}

/** Reject incomplete, failed or incorrectly isolated runtime results. @param {object} result @param {object} session @returns {object} verified result. */
export function validateResult(result, session) {
  if (result.ok !== true) throw new Error(`Runtime assertions failed: ${result.error}`);
  for (const check of requiredChecks) {
    if (!Array.isArray(result.checks) || !result.checks.includes(check)) throw new Error(`Missing checks: ${check}`);
  }
  if (result.profile !== session.profile || result.data !== session.data) throw new Error('Runtime profile/data isolation mismatch');
  if (result.zoteroVersion !== expectedZoteroVersion) {
    throw new Error(`Expected Zotero ${expectedZoteroVersion}; received ${result.zoteroVersion}`);
  }
  return result;
}

/** Reject the observed plugin race in the completed native process log. @param {string} log complete stdout/stderr. @returns {void} */
export function validateRuntimeLog(log) {
  if (/TypeError:[^\r\n]*relationshipRuntime is undefined/.test(log)) {
    throw new Error('Plugin shutdown failed: late window unload accessed a stopped relationshipRuntime');
  }
}
