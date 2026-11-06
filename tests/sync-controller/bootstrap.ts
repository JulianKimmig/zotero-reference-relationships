/** Real account, metadata-sync and permission assertions; no credentials are read. */
/* global Zotero, Services, IOUtils, DOMParser, ChromeUtils, Components, crypto, TextEncoder */
var syncJob: ReferenceRelationshipsHost.ControllerJob & { profile: string; data: string; result: string };
var controllerRootURI: string;

/** Assert native behavior. @param {boolean} value Condition. @param {string} message Failure. @returns {void} */
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Resolve a supplied group using this client's local identity. @param {number} id Server group ID. @returns {object} Native group. */
function group(id: number) {
  const value = Zotero.Groups.get(id);
  check(!!value, `Required test group ${id} is unavailable`);
  return value;
}

/** Sync only the test libraries, collecting native errors without accessing credentials. @returns {Promise<void>} */
async function synchronize() {
  const errors: string[] = [];
  const libraries = [Zotero.Libraries.userLibraryID, group(syncJob.groups.writable).libraryID,
    group(syncJob.groups.restricted).libraryID];
  const outcome = await Zotero.Sync.Runner.sync({
    background: true, libraries, fileLibraries: [], fullTextLibraries: [],
    /** Retain the actual native sync failure category. @param error Native error. @returns Completion. */
    onError(error) { errors.push(error.name || 'SyncError'); },
  });
  check(outcome !== false && errors.length === 0, `Native sync failed: ${errors.join(',')}`);
}

/** Summarize public identities and permissions only. @returns {object} Non-secret native report. */
function inspection() {
  const userID = Number(Zotero.Users.getCurrentUserID());
  check(Number.isSafeInteger(userID) && userID > 0, 'Test profile is not signed in');
  return {
    userID,
    groups: Object.values(syncJob.groups).map(id => {
      const value = group(id);
      return { groupID: id, libraryID: value.libraryID, editable: value.editable };
    }),
  };
}

/** Serialize a synthetic fixture as recognizable note content. @param {object} payload Fixture data. @returns {string} Escaped HTML. */
function noteHTML(payload: unknown) {
  const escaped = JSON.stringify(payload).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return `<div data-schema-version="9"><h1>Reference Relationships sync gate</h1><pre>${escaped}</pre></div>`;
}

/** Create a standalone note in a selected test library. @param {number} libraryID Native local library. @param {string} scope Fixture role. @returns {Promise<string>} Synchronized item key. */
async function createNote(libraryID: number, scope: string) {
  const item = new Zotero.Item('note');
  item.libraryID = libraryID;
  item.setNote(noteHTML({ marker: syncJob.marker, scope, value: 'baseline', text: 'Überprüfung 你好' }));
  await item.saveTx();
  check(item.isTopLevelItem(), 'Probe note must be standalone');
  return item.key;
}

/** Load an exact cross-client fixture without matching local numeric IDs. @param {number} libraryID Local library. @param {string} key Synced key. @returns {Promise<object>} Item and parsed payload. */
async function readNote(libraryID: number, key: string) {
  const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
  check(!!item && item.isNote(), `Synced fixture ${key} is missing`);
  const doc = new DOMParser().parseFromString(item.getNote(), 'text/html');
  const block = doc.querySelector('pre');
  check(!!block, 'Fixture payload block is missing');
  const payload: { marker: string; text: string; value: string; scope: string } = JSON.parse(block.textContent!);
  check(payload.marker === syncJob.marker && payload.text === 'Überprüfung 你好', 'Fixture identity or Unicode changed');
  return { item, payload };
}

/** Change a real fixture and persist through Zotero's API. @param {object} record Loaded note. @param {string} value New test value. @returns {Promise<void>} */
async function changeNote(record: Awaited<ReturnType<typeof readNote>>, value: string) {
  record.payload.value = value;
  record.item.setNote(noteHTML(record.payload));
  await record.item.saveTx();
}

/** Read all three exact A fixtures. @returns {Promise<object>} Loaded records. */
async function readAll() {
  check(syncJob.keys, 'Exact fixture keys required');
  return {
    personal: await readNote(Zotero.Libraries.userLibraryID, syncJob.keys.personal),
    shared: await readNote(group(syncJob.groups.writable).libraryID, syncJob.keys.shared),
    restricted: await readNote(group(syncJob.groups.restricted).libraryID, syncJob.keys.restricted),
  };
}

/** Execute a single explicit test action through native APIs. @returns {Promise<object>} Sanitized action results. */
async function execute() {
  if (syncJob.action.startsWith('transfer:')) {
    const handler = Services.io.getProtocolHandler('resource').QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-transfer-tests', Services.io.newURI(controllerRootURI));
    if (syncJob.action.startsWith('transfer:sync-')) {
      const { transferSync } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-sync.sys.mjs');
      return transferSync(syncJob, { Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder, synchronize });
    }
    if (syncJob.action.startsWith('transfer:picker-')) {
      const { transferPicker } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-picker.sys.mjs');
      return transferPicker(syncJob, { Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder, synchronize });
    }
    if (syncJob.action === 'transfer:mounted') {
      const { transferMounted } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-mounted.sys.mjs');
      return transferMounted(syncJob, { Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder, synchronize });
    }
    if (syncJob.action === 'transfer:ui') {
      const { transferUI } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-ui.sys.mjs');
      return transferUI(syncJob, { Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder, synchronize });
    }
    if (syncJob.action === 'transfer:files') {
      const { transferFiles } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-files.sys.mjs');
      return transferFiles(syncJob, { Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder, synchronize });
    }
    if (syncJob.action === 'transfer:service-edges') {
      const { transferServiceEdges } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-service-edges.sys.mjs');
      return transferServiceEdges(syncJob, { Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder, synchronize });
    }
    if (syncJob.action.startsWith('transfer:service')) {
      const { transferService } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-service.sys.mjs');
      return transferService(syncJob, { Zotero, Services, ChromeUtils, Components, IOUtils, DOMParser, crypto, TextEncoder, synchronize });
    }
    if (syncJob.action.startsWith('transfer:review')) {
      const { transferReview } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-review.sys.mjs');
      return transferReview(syncJob, { Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, synchronize });
    }
    const { transferIdentity } = ChromeUtils.importESModule('resource://rr-transfer-tests/transfer-identity.sys.mjs');
    return transferIdentity(syncJob, { Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, synchronize });
  }
  if (syncJob.action.startsWith('reconcile:')) {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-reconciliation-tests', Services.io.newURI(controllerRootURI));
    const { reconciliation } = ChromeUtils.importESModule('resource://rr-reconciliation-tests/reconciliation.sys.mjs');
    return reconciliation(syncJob, { Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, synchronize });
  }
  if (syncJob.action.startsWith('ruleui:')) {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-rule-preference-tests', Services.io.newURI(controllerRootURI));
    const { rulePreferences } = ChromeUtils.importESModule('resource://rr-rule-preference-tests/rule-preferences.sys.mjs');
    return rulePreferences(syncJob, { Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, synchronize });
  }
  if (syncJob.action.startsWith('rulecmd:')) {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-rule-command-tests', Services.io.newURI(controllerRootURI));
    const { ruleCommands } = ChromeUtils.importESModule('resource://rr-rule-command-tests/rule-commands.sys.mjs');
    return ruleCommands(syncJob, { Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, synchronize });
  }
  if (syncJob.action.startsWith('rules:')) {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-engine-tests', Services.io.newURI(controllerRootURI));
    const { rulesJourney } = ChromeUtils.importESModule('resource://rr-engine-tests/rules-journey.sys.mjs');
    return rulesJourney(syncJob, { Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, synchronize });
  }
  if (syncJob.action.startsWith('catalog:')) {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-catalog-tests', Services.io.newURI(controllerRootURI));
    const { catalogJourney } = ChromeUtils.importESModule('resource://rr-catalog-tests/catalog-journey.sys.mjs');
    return catalogJourney(syncJob, { Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, synchronize });
  }
  if (syncJob.action.startsWith('ui:')) {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-ui-tests', Services.io.newURI(controllerRootURI));
    const { uiJourney } = ChromeUtils.importESModule('resource://rr-ui-tests/ui-journey.sys.mjs');
    return uiJourney(syncJob, { Zotero, Services, ChromeUtils, Components, DOMParser, crypto, TextEncoder, synchronize });
  }
  if (syncJob.action.startsWith('storage:')) {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-storage-tests', Services.io.newURI(controllerRootURI));
    const { repositoryConformance } = ChromeUtils.importESModule('resource://rr-storage-tests/repository.sys.mjs');
    return repositoryConformance(syncJob, { Zotero, Services, Components, ChromeUtils, DOMParser, crypto, TextEncoder, synchronize });
  }
  if (syncJob.action === 'contracts:baseline') {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-contract-tests', Services.io.newURI(controllerRootURI));
    const { contractBaseline } = ChromeUtils.importESModule('resource://rr-contract-tests/contracts.sys.mjs');
    check(syncJob.domainURI && syncJob.workloads, 'Contract workload inputs required');
    return contractBaseline({ domainURI: syncJob.domainURI, workloads: syncJob.workloads }, { Services, Components, ChromeUtils, TextEncoder });
  }
  if (syncJob.action.startsWith('feasibility:') || syncJob.action.startsWith('publication:')) {
    const handler = Services.io.getProtocolHandler('resource')
      .QueryInterface(Components.interfaces.nsIResProtocolHandler);
    handler.setSubstitution('rr-feasibility', Services.io.newURI(controllerRootURI));
    const { runExperiment } = ChromeUtils.importESModule('resource://rr-feasibility/native-experiments.sys.mjs');
    return runExperiment(syncJob, { Zotero, Services, IOUtils, DOMParser, ChromeUtils, Components, crypto, TextEncoder, synchronize });
  }
  await synchronize();
  const identity = inspection();
  if (syncJob.action === 'inspect') return identity;
  if (syncJob.action === 'create') {
    const keys = {
      personal: await createNote(Zotero.Libraries.userLibraryID, 'personal'),
      shared: await createNote(group(syncJob.groups.writable).libraryID, 'shared'),
      restricted: await createNote(group(syncJob.groups.restricted).libraryID, 'restricted'),
    };
    await synchronize();
    return { ...identity, keys };
  }
  if (syncJob.action === 'a2-edit') {
    const notes = await readAll();
    check(notes.shared.payload.value === 'baseline' && notes.restricted.payload.value === 'baseline', 'A2 did not receive initial fixtures');
    await changeNote(notes.personal, 'from-a2');
    await synchronize();
    return { ...identity, personal: notes.personal.payload.value };
  }
  if (syncJob.action === 'b1-edit') {
    check(syncJob.keys, 'Exact fixture keys required');
    const shared = await readNote(group(syncJob.groups.writable).libraryID, syncJob.keys.shared);
    const restricted = await readNote(group(syncJob.groups.restricted).libraryID, syncJob.keys.restricted);
    check(restricted.payload.value === 'baseline', 'B did not receive restricted fixture');
    check(!restricted.item.isEditable(), 'B unexpectedly has write access');
    let denied = false;
    try { await changeNote(restricted, 'unexpected-write'); }
    catch (error) {
      check(String(error instanceof Error ? error.message : error).includes('Cannot edit item'), 'Write failed for a reason other than permission');
      denied = true;
    }
    check(denied, 'Native API allowed a read-only-library modification');
    await changeNote(shared, 'from-b1');
    await synchronize();
    return { ...identity, denied, shared: shared.payload.value };
  }
  if (syncJob.action === 'verify') {
    const notes = await readAll();
    return { ...identity, marker: syncJob.marker, personal: notes.personal.payload.value,
      shared: notes.shared.payload.value, restricted: notes.restricted.payload.value };
  }
  throw new Error('Unknown native sync-probe action');
}

/** Write non-secret results and close the controlled client. @param {object} report Native output. @param {Error|null} error Failure. @returns {Promise<void>} */
async function finish(report: unknown, error: unknown) {
  await Zotero.DB.waitForTransaction();
  const result = { ok: !error, report, error: error ? { name: error instanceof Error ? error.name : 'NativeFailure', message: error instanceof Error ? error.message : String(error) } : null,
    profile: Zotero.Profile.dir, data: Zotero.DataDirectory.dir, version: Zotero.version,
    shutdown: 'native-attempt-quit-after-transactions' };
  await IOUtils.writeUTF8(syncJob.result, JSON.stringify(result, null, 2));
  await Zotero.DB.waitForTransaction();
  Zotero.Utilities.Internal.quit();
}

/** Consume one job before mutations, preventing accidental replay. @returns {Promise<void>} */
async function run() {
  const path = Services.prefs.getStringPref('extensions.referenceRelationships.sync.job');
  syncJob = JSON.parse(await IOUtils.readUTF8(path));
  if (syncJob.state !== 'pending') return;
  syncJob.state = 'running';
  await IOUtils.writeUTF8(path, JSON.stringify(syncJob));
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  try {
    check(Zotero.Profile.dir === syncJob.profile && Zotero.DataDirectory.dir === syncJob.data, 'Signed-in profile isolation mismatch');
    check(Zotero.version === '10.0.7', 'Unverified Zotero version');
    await finish(await execute(), null);
  } catch (error) { await finish(null, error); }
}

/** Schedule test work after native startup. @returns {void} */
function startup({ rootURI }: { rootURI: string }) {
  controllerRootURI = rootURI;
  run().catch(error => {
    Zotero.logError(new Error(`Sync probe initialization failed: ${error.name}`));
    Services.startup.quit(Services.startup.eForceQuit);
  });
}
