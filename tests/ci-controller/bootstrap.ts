/** Anonymous CI-only bootstrap: runs one explicit lifecycle job and reports the observed host version. */
/* global Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder */

/** Execute one pending job in a newly owned profile, using real native APIs. @param rootURI Copied CI controller root. @returns Completion after evidence publication and native quit. */
async function runCI(rootURI: string): Promise<void> {
  const path = Services.prefs.getStringPref('extensions.referenceRelationships.sync.job');
  const job = JSON.parse(await IOUtils.readUTF8(path)) as import('../sync-controller/ci-release.sys.mts').ReleaseJob & {
    state: string; profile: string; data: string; result: string;
  };
  if (job.state !== 'pending') throw new Error('CI job is not pending');
  job.state = 'running'; await IOUtils.writeUTF8(path, JSON.stringify(job));
  await Zotero.initializationPromise; await Zotero.uiReadyPromise;
  const handler = Services.io.getProtocolHandler('resource').QueryInterface(Components.interfaces.nsIResProtocolHandler);
  handler.setSubstitution('rr-ci-release-tests', Services.io.newURI(rootURI));
  let report: object | null = null, error: { name: string; message: string } | null = null;
  try {
    if (Zotero.Profile.dir !== job.profile || Zotero.DataDirectory.dir !== job.data) throw new Error('CI profile isolation mismatch');
    const hashLoader = ChromeUtils.importESModule as typeof ChromeUtils.importESModule &
      ((uri: 'resource://rr-ci-release-tests/installed-artifact.sys.mjs') => typeof import('../sync-controller/installed-artifact.sys.mts'));
    hashLoader('resource://rr-ci-release-tests/installed-artifact.sys.mjs').requireCIHashes(job);
    if (job.action === 'ci-release:initialize') {
      if (Zotero.Users.getCurrentUserID()) throw new Error('CI profile must be anonymous');
      report = { anonymous: true };
    } else {
      const loader = ChromeUtils.importESModule as typeof ChromeUtils.importESModule &
        ((uri: 'resource://rr-ci-release-tests/ci-release.sys.mjs') => typeof import('../sync-controller/ci-release.sys.mts'));
      const { ciRelease } = loader('resource://rr-ci-release-tests/ci-release.sys.mjs');
      report = await ciRelease(job, { Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder,
        /** CI does not provide synchronization. @returns Rejection on any unintended sync request. */
        async synchronize(): Promise<never> { throw new Error('CI synchronization is forbidden'); } });
    }
  } catch (caught) {
    error = { name: caught instanceof Error ? caught.name : 'NativeFailure', message: caught instanceof Error ? caught.message : String(caught) };
  } finally { handler.setSubstitution('rr-ci-release-tests', null); }
  await Zotero.DB.waitForTransaction();
  await IOUtils.writeUTF8(job.result, JSON.stringify({ ok: error === null, report, error,
    profile: Zotero.Profile.dir, data: Zotero.DataDirectory.dir, version: Zotero.version }, null, 2));
  await Zotero.DB.waitForTransaction(); Zotero.Utilities.Internal.quit();
}
/** Schedule the CI job after host startup. @param addon Native addon root metadata. @returns Completion of scheduling. */
function startup({ rootURI }: { rootURI: string }): void {
  runCI(rootURI).catch(error => {
    Zotero.logError(error); Services.startup.quit(Services.startup.eForceQuit);
  });
}
