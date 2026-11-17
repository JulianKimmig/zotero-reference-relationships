/** Behavioral release acceptance uses real packaged applications, native addon lifecycle and retained native data. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { RepositoryState } from '../../src/storage/contracts.mts';
import type { RuntimeBridge } from '../../src/runtime/contracts.mts';
import { found, present, readyState } from './evidence.sys.mts';
import { check, until } from './ui-helpers.sys.mts';
import { applyOne, book, ref, rule } from './rules-fixtures.sys.mts';
import { setEnabled } from './reconciliation-fixtures.sys.mts';
import { inspectRuleStorageRestart, paneID } from './rule-preferences-helpers.sys.mts';

const addonID = 'reference-relationships@zotero-plugins.local';

/** Only controller-owned labels may enter release failure diagnostics. */
type ReleaseStep = 'inputs' | 'install-previous' | 'seed-initial-state' | 'seed-native-items'
  | 'seed-type' | 'seed-assertion' | 'seed-rule' | 'seed-readback' | 'upgrade-install'
  | 'upgrade-readback' | 'disable' | 'reenable' | 'reenable-readback' | 'uninstall'
  | 'uninstall-readback' | 'reinstall' | 'reinstall-readback';

/** Exact persisted authority and unrelated native data transferred to a separate native process. */
export interface ReleaseFixture {
  readyState: Extract<RepositoryState, { state: 'ready' }>;
  a: string; b: string; ordinary: string; ordinaryNote: string; relationsJson: string;
  titles: { a: string; b: string };
}
/** Release-only inputs extend the existing public native job without widening unrelated dispatch contracts. */
export interface ReleaseJob extends ControllerJob { previousXPI?: string; releaseFixture?: ReleaseFixture }
/** Proof emitted only after every in-process lifecycle and preservation assertion succeeds. */
export interface ReleaseRoundtripReport {
  releaseFixture: ReleaseFixture; previousVersion: '0.0.9'; currentVersion: '0.1.0';
  nativeUpgrade: true; nativeDisable: true; nativeReenable: true; nativeUninstall: true; nativeReinstall: true;
  permanentInstall: true; exactAuthority: true; nativeDataPreserved: true; preferenceRegistrationCount: 1;
}
/** Proof emitted only by an independent process reading the retained fixture. */
export interface ReleaseRestartReport {
  nativeRestart: true; permanentInstall: true; automaticStartup: true; currentVersion: '0.1.0';
  exactAuthority: true; nativeDataPreserved: true; preferenceRegistrationCount: 1;
}

/** Count actual official preference registrations belonging to this addon. @param api Real native platform. @returns Number of matching registered panes. */
function registrations(api: NativeAPI): number {
  return api.Zotero.PreferencePanes.pluginPanes.filter(pane => pane.id === paneID).length;
}

/** Persist the explicit frozen artifact using the installed 10.0.7 local-file API and await native completion/startup. @param api Native addon manager/platform. @param xpi Explicit immutable artifact. @param version Expected fixture or candidate version. @returns Actual persistent addon and distinct running application generation. */
async function install(api: NativeAPI, xpi: string, version: string) {
  const { Zotero } = api, { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const installer = present(await AddonManager.getInstallForFile(Zotero.File.pathToFile(xpi)));
  /** Bound actual native installation without delaying successful completion or simulating install events. @returns Rejection only when native completion misses the deadline. */
  async function deadline(): Promise<never> {
    await Zotero.Promise.delay(20000);
    throw new Error('Persistent release installation exceeded its native completion deadline');
  }
  const addon = await Promise.race([installer.install(), deadline()]);
  check(addon.id === addonID && addon.version === version && addon.isActive && addon.temporarilyInstalled === false,
    'Release addon must have the expected identity/version and active persistent installation');
  const runtime = await until(Zotero, () => {
    const current = Zotero.ReferenceRelationships;
    return current?.state === 'running' && current.version === version && registrations(api) === 1 ? current : null;
  }, `release ${version} runtime and single preference registration`);
  return { addon, runtime };
}

/** Wait for removal of actual runtime/registration ownership and inspect the retired generation. @param api Native platform. @param runtime Retained prior generation. @returns Completion only after singleton, window and preference ownership are released. */
async function stopped(api: NativeAPI, runtime: RuntimeBridge): Promise<void> {
  await until(api.Zotero, () => !Object.hasOwn(api.Zotero, 'ReferenceRelationships') && registrations(api) === 0, 'release runtime and preferences teardown');
  check(runtime.state === 'stopped' && runtime.windows.size === 0, 'Release teardown retained a live prior generation');
}

/** Observe complete native relation contents and related-item links for both fixture books. @param api Actual item cache/database. @param fixture Exact native keys. @returns Actual books and deterministic relation-content JSON. */
async function nativeBooks(api: NativeAPI, fixture: Pick<ReleaseFixture, 'a' | 'b'>) {
  const { Zotero } = api, library = Zotero.Libraries.userLibraryID;
  const a = found(await Zotero.Items.getByLibraryAndKeyAsync(library, fixture.a));
  const b = found(await Zotero.Items.getByLibraryAndKeyAsync(library, fixture.b));
  /** Normalize set-valued native relations without discarding any predicate or target. @param item Actual loaded native book. @returns Deterministic complete relation data. */
  function relations(item: typeof a) {
    return { related: [...item.relatedItems].sort(), relations: Object.fromEntries(Object.entries(item.getRelations())
      .sort(([left], [right]) => left.localeCompare(right)).map(([predicate, targets]) => [predicate, [...targets].sort()])) };
  }
  return { a, b, relationsJson: JSON.stringify({ a: relations(a), b: relations(b) }) };
}

/** Require every unrelated native fixture to survive with its content and native relations intact. @param api Actual item resources. @param fixture Saved exact observations. @returns Completion only for unchanged, nondeleted books and ordinary note. */
async function nativeData(api: NativeAPI, fixture: ReleaseFixture): Promise<void> {
  const { a, b, relationsJson } = await nativeBooks(api, fixture);
  const ordinary = found(await api.Zotero.Items.getByLibraryAndKeyAsync(api.Zotero.Libraries.userLibraryID, fixture.ordinary));
  await ordinary.loadDataType('note');
  check(!a.deleted && !b.deleted && !ordinary.deleted && ordinary.isNote(), 'Release removed unrelated native items');
  check(a.getField('title') === fixture.titles.a && b.getField('title') === fixture.titles.b, 'Release changed native book contents');
  check(ordinary.getNote() === fixture.ordinaryNote && relationsJson === fixture.relationsJson, 'Release changed ordinary note or native relations');
  check(a.relatedItems.includes(b.key) && b.relatedItems.includes(a.key), 'Release removed reciprocal native Related links');
}

/** Assert exact authority through the active application and the actual inverse-rule projection. @param api Native platform with current running application. @param fixture Original prior-version authority. @returns Completion only for identical head/snapshot and preserved generated semantics. */
async function retained(api: NativeAPI, fixture: ReleaseFixture): Promise<void> {
  const app = present(api.Zotero.ReferenceRelationships).application;
  const current = readyState(await app.read('self'));
  check(current.head === fixture.readyState.head && JSON.stringify(current.snapshot) === JSON.stringify(fixture.readyState.snapshot),
    'Release changed retained head or complete snapshot');
  check(registrations(api) === 1, 'Release duplicated or omitted official preference registration');
  const assertion = present(current.snapshot.assertions[0]);
  const rows = await app.listRelationships({ library: 'self', key: fixture.b }, 'both', null, { offset: 0, limit: 100 });
  const inverse = rows.relationships.find(row => row.type === 'referenced-by');
  check(inverse && inverse.assertions.length === 0 && inverse.supports.length === 1
    && inverse.supports[0].root === assertion.id && inverse.metadata.note === assertion.metadata.note, 'Release lost actual inverse-rule behavior');
  await nativeData(api, fixture);
}

/** Seed through the actual prior-version application, never a substituted repository or synthetic native state. @param job Public fixture marker. @param api Real running prior addon and native items. @param phase Controller-owned diagnostic step, never derived from external exceptions. @returns Exact prior authority/native data receipts for all later lifecycle phases. */
async function seed(job: ReleaseJob, api: NativeAPI, phase: { step: ReleaseStep }): Promise<ReleaseFixture> {
  phase.step = 'seed-initial-state';
  const { Zotero } = api, app = present(Zotero.ReferenceRelationships).application;
  check((await app.read('self')).state === 'uninitialized', 'Release fixture requires fresh anonymous authority');
  phase.step = 'seed-native-items';
  const a = await book(Zotero, `${job.marker} A`), b = await book(Zotero, `${job.marker} B`);
  a.addRelatedItem(b); b.addRelatedItem(a); await a.saveTx(); await b.saveTx();
  const ordinary = new Zotero.Item('note'); ordinary.libraryID = Zotero.Libraries.userLibraryID;
  ordinary.setNote('<div data-schema-version="9"><p>Release unrelated native note — Café 你好</p></div>'); await ordinary.saveTx();
  const metadata = { note: 'Release typed metadata — Café 你好', count: 0, flag: false, date: '2026-11-17', choice: 'kept' };
  phase.step = 'seed-type';
  await applyOne(api, await app.manageTypes({ library: 'self', kind: 'create', migration: null,
    type: { id: 'release-typed', label: 'Release typed fixture', description: 'Retained prior-version test data', retired: false,
      fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] },
        { id: 'count', label: 'Count', kind: 'number', required: false, options: [] },
        { id: 'flag', label: 'Flag', kind: 'boolean', required: false, options: [] },
        { id: 'date', label: 'Date', kind: 'date', required: false, options: [] },
        { id: 'choice', label: 'Choice', kind: 'enum', required: false, options: ['kept', 'other'] }] } }));
  phase.step = 'seed-assertion';
  await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(b), type: 'release-typed', metadata }));
  phase.step = 'seed-rule';
  const { version: _version, ...definition } = rule('release-inverse', 'release-typed');
  await applyOne(api, await app.manageRules({ library: 'self', kind: 'create', rule: definition }));
  phase.step = 'seed-readback';
  const authority = readyState(await app.read('self'));
  check(authority.snapshot.assertions.length === 1 && authority.snapshot.rules.length === 1
    && Object.keys(authority.snapshot.assertions[0].metadata).length === Object.keys(metadata).length
    && Object.entries(metadata).every(([field, value]) => authority.snapshot.assertions[0].metadata[field] === value),
  'Prior release fixture did not retain typed manual authority');
  const fixture = { readyState: authority, a: a.key, b: b.key, ordinary: ordinary.key, ordinaryNote: ordinary.getNote(),
    relationsJson: (await nativeBooks(api, { a: a.key, b: b.key })).relationsJson, titles: { a: a.getField('title'), b: b.getField('title') } };
  await retained(api, fixture);
  return fixture;
}

/** Exercise prior install, real upgrade, disable/re-enable, uninstall/storage read and reinstall without deleting data. @param job Explicit current/prior XPIs and fixture marker. @param api Actual native APIs. @returns Complete native lifecycle proof and restart fixture. */
async function roundtrip(job: ReleaseJob, api: NativeAPI): Promise<ReleaseRoundtripReport> {
  const phase: { step: ReleaseStep } = { step: 'inputs' };
  try {
    const xpi = present(job.xpi), previousXPI = present(job.previousXPI);
    phase.step = 'install-previous';
    const previous = await install(api, previousXPI, '0.0.9');
    const fixture = await seed(job, api, phase);
    phase.step = 'upgrade-install';
    const current = await install(api, xpi, '0.1.0');
    phase.step = 'upgrade-readback';
    check(current.runtime !== previous.runtime && current.runtime.application !== previous.runtime.application
      && previous.runtime.state === 'stopped' && previous.runtime.windows.size === 0, 'Upgrade reused or retained the previous application generation');
    await retained(api, fixture);
    phase.step = 'disable';
    await setEnabled(api.Zotero, current.addon, false); await stopped(api, current.runtime);
    await nativeData(api, fixture);
    phase.step = 'reenable';
    await setEnabled(api.Zotero, current.addon, true);
    phase.step = 'reenable-readback';
    const reenabled = present(api.Zotero.ReferenceRelationships);
    check(reenabled !== current.runtime && reenabled.state === 'running', 'Re-enable reused a retired runtime');
    await retained(api, fixture);
    phase.step = 'uninstall';
    await current.addon.uninstall(); await stopped(api, reenabled);
    const { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    check(await AddonManager.getAddonByID(addonID) === null, 'Release addon remained installed after uninstall');
    phase.step = 'uninstall-readback';
    const stored = await inspectRuleStorageRestart({ ...job, xpi, snapshot: fixture.readyState.snapshot }, api);
    check(stored.standaloneNoAddonInstall && stored.expectedSnapshotMatches && stored.head === fixture.readyState.head,
      'Uninstall changed retained authority observed without addon installation');
    await nativeData(api, fixture);
    phase.step = 'reinstall';
    const reinstalled = await install(api, xpi, '0.1.0');
    phase.step = 'reinstall-readback';
    check(reinstalled.runtime !== reenabled && reinstalled.runtime.application !== reenabled.application, 'Reinstall reused the uninstalled application');
    await retained(api, fixture);
    return { releaseFixture: fixture, previousVersion: '0.0.9', currentVersion: '0.1.0', nativeUpgrade: true,
      nativeDisable: true, nativeReenable: true, nativeUninstall: true, nativeReinstall: true,
      permanentInstall: true, exactAuthority: true, nativeDataPreserved: true, preferenceRegistrationCount: 1 };
  } catch { throw new Error(`Release roundtrip failed at ${phase.step}`); }
}

/** Run release-only behavioral checks on an anonymous initialized native client. Restart inspects automatic startup without an install call. @param job Explicit release action, frozen XPIs and optional prior-process fixture. @param api Real native resources; synchronization is never requested. @returns Actual persistent roundtrip or automatic restart proof. */
export async function release(job: ReleaseJob, api: NativeAPI): Promise<ReleaseRoundtripReport | ReleaseRestartReport> {
  check(!api.Zotero.Users.getCurrentUserID(), 'Release acceptance requires an anonymous dedicated client');
  if (job.action === 'release:roundtrip') return roundtrip(job, api);
  check(job.action === 'release:restart', 'Unknown native release action');
  const fixture = present(job.releaseFixture);
  const { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addon = present(await AddonManager.getAddonByID(addonID));
  check(addon.id === addonID && addon.version === '0.1.0' && addon.isActive && addon.temporarilyInstalled === false,
    'Restart requires the already active persistent release addon');
  await until(api.Zotero, () => {
    const runtime = api.Zotero.ReferenceRelationships;
    return runtime?.state === 'running' && runtime.version === '0.1.0' && registrations(api) === 1;
  }, 'release automatic startup and single preference registration');
  await retained(api, fixture);
  return { nativeRestart: true, permanentInstall: true, automaticStartup: true, currentVersion: '0.1.0',
    exactAuthority: true, nativeDataPreserved: true, preferenceRegistrationCount: 1 };
}
