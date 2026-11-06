/** Real additive service imports create recoverable signed group fixtures without seeding, replacing or deleting existing authority. */
import { found, present, readyState } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestItem } from './platform-contracts.mts';
import type { Assertion, Graph } from '../../src/domain/contracts.mts';
import type { TransferMapping } from '../../src/transfer/contracts.mts';
import type { BaselineFixture, GenerationFixture, NativeReady, TransferSyncContext, TransferSyncFixture, UnrelatedAuthority } from './transfer-sync-contracts.mts';

/** Encode real validated graph comparisons through the installed canonical codec. @param api Actual module loader. @param value Compared authority/metadata. @returns NFC canonical JSON. */
export function fixtureJSON(api: NativeAPI, value: unknown): string {
  const { canonicalJSON } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/storage/canonical.mjs');
  return canonicalJSON(value, { maxBytes: 2_097_152 });
}

/** Require all earlier entities to remain exactly preserved in a complete additive result. @param api Actual codec. @param before Earlier authority or genuine initialization. @param after Complete resulting graph. @returns No lost or modified earlier entity. */
export function preserveEntities(api: NativeAPI, before: Graph | null, after: Graph): void {
  if (before === null) return;
  check(before.library === after.library, 'Additive fixture changed its containing library');
  for (const kind of ['types', 'rules', 'assertions'] as const) for (const entity of before[kind]) {
    const actual = after[kind].find(candidate => candidate.id === entity.id);
    check(!!actual && fixtureJSON(api, actual) === fixtureJSON(api, entity), `Additive fixture changed existing ${kind} ${entity.id}`);
  }
}

/** Capture unrelated real authority without touching account material. @param context Actual application and dedicated group IDs. @returns Personal and other development-group reads. */
export async function captureUnrelated(context: TransferSyncContext): Promise<UnrelatedAuthority> {
  context.app.invalidate('self'); context.app.invalidate('group:6749388');
  return { personal: await context.app.read('self'), restricted: await context.app.read('group:6749388') };
}

/** Re-read unrelated authority freshly after native fixture operations. @param api Actual codec. @param context Actual application. @param expected Captured unrelated reads. @returns Exact preservation. */
export async function requireUnrelated(api: NativeAPI, context: TransferSyncContext, expected: UnrelatedAuthority): Promise<void> {
  const actual = await captureUnrelated(context);
  check(fixtureJSON(api, actual.personal) === fixtureJSON(api, expected.personal)
    && fixtureJSON(api, actual.restricted) === fixtureJSON(api, expected.restricted), 'Controlled group fixture changed unrelated authority');
}

/** Require repository and application to expose exactly one specified complete authority. @param api Actual codec. @param context Native resources. @param expected Exact complete generation. @returns Fresh verified ready state. */
export async function requireReady(api: NativeAPI, context: TransferSyncContext, expected: NativeReady): Promise<NativeReady> {
  context.repository.invalidate(); context.app.invalidate(context.scope);
  const state = readyState(await context.repository.read());
  check(fixtureJSON(api, state) === fixtureJSON(api, expected), 'Actual ready authority differs from the complete reviewed fixture');
  check(fixtureJSON(api, await context.app.read(context.scope)) === fixtureJSON(api, expected), 'Application retained different authority');
  return state;
}

/** Check real physical production notes and their native server acknowledgement state. @param api Native Items. @param context Actual group. @param keys Exact physical keys. @param phase New local or acknowledged server notes. @returns Actual saved notes. */
export async function requireNotes(api: NativeAPI, context: TransferSyncContext, keys: string[], phase: 'new' | 'published'): Promise<TestItem[]> {
  check(keys.length > 0 && new Set(keys).size === keys.length, 'Expected unique physical fixture notes');
  const items: TestItem[] = [];
  for (const key of keys) {
    check(/^[A-Z0-9]{8}$/u.test(key), 'Invalid physical production key');
    const item = found(await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, key));
    check(item.libraryID === context.group.libraryID && item.isNote() && item.isTopLevelItem() && !item.deleted,
      'Production authority is not an actual active standalone group note');
    check(phase === 'new' ? item.version === 0 && !item.synced : item.version > 0 && item.synced,
      `Native ${phase} authority note has unexpected sync metadata: ${key}`);
    items.push(item);
  }
  return items;
}

/** Create a unique stable fixture ID from the real native UUID service. @param api Native UUID resource. @param prefix Controlled ASCII namespace. @returns Stable ID within domain length limits. */
export function fixtureID(api: NativeAPI, prefix: string): string {
  return `${prefix}-${api.Services.uuid.generateUUID().toString().replace(/[{}]/gu, '')}`;
}

/** Save an actual group book without triggering synchronization. @param api Real Item constructor. @param context Actual editable group. @param title Controlled visible fixture title. @returns Persisted bibliographic endpoint. */
export async function groupBook(api: NativeAPI, context: TransferSyncContext, title: string): Promise<TestItem> {
  const item = new api.Zotero.Item('book'); item.libraryID = context.group.libraryID;
  item.setField('title', title); await item.saveTx();
  check(item.libraryID === context.group.libraryID && item.isRegularItem() && !item.deleted && item.version === 0 && !item.synced,
    'New group bibliographic fixture was not saved locally without synchronization');
  return item;
}

/** Build one complete explicit original from actual group item identities. @param api UUID resource. @param context Group scope. @param source Actual source. @param target Actual target. @param type New fixture relationship type. @param note Literal Unicode metadata. @returns Valid original assertion. */
function root(api: NativeAPI, context: TransferSyncContext, source: TestItem, target: TestItem, type: string, note: string): Assertion {
  const timestamp = new Date().toISOString();
  return { id: fixtureID(api, 't11-root'), source: { library: context.scope, key: source.key },
    target: { library: context.scope, key: target.key }, type, metadata: { note }, createdAt: timestamp, updatedAt: timestamp };
}

/** Review and commit a real additive import, comparing the exact reviewed complete result. @param api Real codec/service resources. @param context Native owner, permission and transaction composition. @param incoming Only explicit incoming fixture entities. @returns Actual captured before and after generations. */
export async function importMerge(api: NativeAPI, context: TransferSyncContext, incoming: Graph) {
  const before = await context.repository.read();
  check(before.state === 'ready' || before.state === 'uninitialized', 'Do not import into pending/conflicting shared authority');
  const { createExport } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/format.mjs');
  const owner = context.identity.read(context.scope), document = await createExport({ source: owner, snapshot: incoming,
    exportedAt: new Date().toISOString() }, context.factory.digest);
  const endpoints = new Map<string, Assertion['source']>();
  for (const assertion of incoming.assertions) for (const ref of [assertion.source, assertion.target]) endpoints.set(ref.key, ref);
  const mapping: TransferMapping = { source: owner, target: owner, library: context.scope,
    endpoints: [...endpoints.values()].map(ref => ({ source: { ...ref }, target: { ...ref }, mode: 'reference' })) };
  const preview = await context.transfer.previewImport(document, mapping, 'merge', before.state === 'ready' ? before.head : null);
  const inspection = await context.transfer.inspectImport(preview.previewToken);
  check(!inspection.noop, 'Fixture merge must create an actual new production generation');
  preserveEntities(api, before.state === 'ready' ? before.snapshot : null, inspection.after);
  const committed = await context.transfer.commitImport(preview.previewToken), after = readyState(await context.repository.read());
  check(committed.revision === after.head && fixtureJSON(api, after.snapshot) === fixtureJSON(api, inspection.after),
    'Native import differs from its complete reviewed proposal');
  preserveEntities(api, before.state === 'ready' ? before.snapshot : null, after.snapshot);
  return { before, after };
}

/** Persist only this new fixture's recovery JSON before native sync flags can change. @param job Owned existing data directory. @param api Real native output. @param fixture Captured complete publication. @param tag Controlled phase name. @returns Exclusive flushed checkpoint path. */
export async function checkpointFixture(job: ControllerJob, api: NativeAPI, fixture: TransferSyncFixture, tag: string): Promise<string> {
  check(/^[a-z][a-z0-9-]{0,39}$/u.test(tag), 'Invalid fixture checkpoint tag');
  const head = fixture.kind === 'baseline' ? fixture.state.head : fixture.after.head;
  const path = `${present(job.data)}/transfer-sync-${tag}-${head}.json`, text = JSON.stringify(fixture, null, 2);
  const bytes = new api.TextEncoder().encode(text).byteLength;
  check(await present(api.IOUtils).writeUTF8(path, text, { mode: 'create', flush: true }) === bytes, 'Recovery checkpoint write was incomplete');
  check(await present(api.IOUtils).readUTF8(path) === text, 'Recovery checkpoint readback differs');
  return path;
}

/** Publish and synchronize two unique foreign-version types, one inverse rule and a real original through additive service merge only. @param job Fixture labels and checkpoint directory. @param api Actual native resources. @param context Scoped service and group sync. @returns Complete synchronized baseline retaining earlier shared data. */
export async function createBaseline(job: ControllerJob, api: NativeAPI, context: TransferSyncContext): Promise<BaselineFixture> {
  const unrelated = await captureUnrelated(context), current = await context.repository.read();
  check(current.state === 'ready' || current.state === 'uninitialized', 'Baseline requires actual ready or uninitialized shared authority');
  const type = fixtureID(api, 't11-forward'), inverseType = fixtureID(api, 't11-inverse'), rule = fixtureID(api, 't11-rule');
  const source = await groupBook(api, context, `${job.marker} baseline source`);
  const target = await groupBook(api, context, `${job.marker} baseline target`);
  const incoming: Graph = { schema: 1, library: context.scope,
    types: [
      { id: type, label: 'Transfer fixture forward', description: 'Dedicated additive transfer fixture', retired: false, version: 7,
        fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }] },
      { id: inverseType, label: 'Transfer fixture inverse', description: 'Dedicated additive inverse fixture', retired: false, version: 4,
        fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }] },
    ], assertions: [root(api, context, source, target, type, 'Cafe\u0301 你好 😀 <b>literal</b>')],
    rules: [{ id: rule, version: 9, enabled: true, rootType: type, inputType: type, outputType: inverseType,
      transform: 'reverse', conditions: [], mapping: { note: { kind: 'root', field: 'note' } } }] };
  const { after } = await importMerge(api, context, incoming);
  check(after.snapshot.types.find(value => value.id === type)?.version === 7
    && after.snapshot.types.find(value => value.id === inverseType)?.version === 4
    && after.snapshot.rules.find(value => value.id === rule)?.version === 9, 'Baseline reset foreign catalog or rule versions');
  await context.requireSync(); await requireReady(api, context, after);
  const observation = await context.repository.observation();
  const { verifyEnvelope } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/storage/envelopes.mjs');
  const manifest = await verifyEnvelope(present(observation.commits.find(value => value.key === after.head)).body, context.factory.digest);
  check(manifest.format === 'reference-relationships/commit', 'Baseline head is not a verified production manifest');
  await requireNotes(api, context, [...manifest.records.map(record => record.key), after.head], 'published');
  const uploadedSource = found(await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, source.key));
  const uploadedTarget = found(await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, target.key));
  check(uploadedSource.version > 0 && uploadedSource.synced && uploadedTarget.version > 0 && uploadedTarget.synced,
    'Baseline group endpoints were not actually uploaded');
  const fixture: BaselineFixture = { kind: 'baseline', state: after, type, inverseType, rule, sourceKey: source.key };
  await checkpointFixture(job, api, fixture, 'baseline'); await requireUnrelated(api, context, unrelated); return fixture;
}

/** Commit a multi-record complete production generation with 36 new real group targets; synchronization belongs to the caller. @param job Labels and recovery directory. @param api Native UUID/item/module resources. @param context Actual shared service/store. @param baseline Exact fixture catalog identities. @param tag Controlled checkpoint phase. @returns Local complete generation and its new physical record identities. */
export async function createGeneration(job: ControllerJob, api: NativeAPI, context: TransferSyncContext,
  baseline: BaselineFixture, tag: string): Promise<GenerationFixture> {
  const unrelated = await captureUnrelated(context), before = readyState(await context.repository.read());
  const earlier = await context.repository.observation(), oldKeys = new Set([...earlier.commits, ...earlier.records].map(value => value.key));
  const type = present(before.snapshot.types.find(value => value.id === baseline.type));
  const inverse = present(before.snapshot.types.find(value => value.id === baseline.inverseType));
  const rule = present(before.snapshot.rules.find(value => value.id === baseline.rule));
  check(type.version === 7 && inverse.version === 4 && rule.version === 9, 'Fixture foreign catalog history changed');
  check(fixtureJSON(api, [type, inverse]) === fixtureJSON(api, [
    present(baseline.state.snapshot.types.find(value => value.id === baseline.type)),
    present(baseline.state.snapshot.types.find(value => value.id === baseline.inverseType)),
  ]) && fixtureJSON(api, rule) === fixtureJSON(api, present(baseline.state.snapshot.rules.find(value => value.id === baseline.rule))),
  'Fixture catalog definitions changed since the captured baseline');
  const source = found(await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, baseline.sourceKey));
  const incoming: Graph = { schema: 1, library: context.scope, types: structuredClone([type, inverse]), rules: structuredClone([rule]), assertions: [] };
  for (let index = 0; index < 36; index++) {
    const target = await groupBook(api, context, `${job.marker} ${tag} target ${index}`);
    const note = `${'é'.repeat(980)} 你好 😀 ${index}`;
    check([...note].length <= 1024, 'Generation fixture metadata exceeded its scalar limit');
    incoming.assertions.push(root(api, context, source, target, baseline.type, note));
  }
  const committed = await importMerge(api, context, incoming);
  check(fixtureJSON(api, committed.before) === fixtureJSON(api, before), 'Generation baseline changed during fixture creation');
  const after = committed.after, observation = await context.repository.observation();
  const { verifyEnvelope } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/storage/envelopes.mjs');
  const manifest = await verifyEnvelope(present(observation.commits.find(value => value.key === after.head)).body, context.factory.digest);
  check(manifest.format === 'reference-relationships/commit' && fixtureJSON(api, manifest.parents) === fixtureJSON(api, [before.head]),
    'New production manifest does not bind the captured complete parent');
  const records = manifest.records.map(record => record.key);
  check(records.length >= 2 && new Set(records).size === records.length && !oldKeys.has(after.head)
    && records.every(key => !oldKeys.has(key)), 'Generation must contain multiple new immutable production records');
  await requireNotes(api, context, [...records, after.head], 'new');
  const fixture: GenerationFixture = { kind: 'generation', baseline, before, after, records,
    withheld: present(records.at(-1)), assertionIDs: incoming.assertions.map(assertion => assertion.id) };
  await checkpointFixture(job, api, fixture, tag); await requireUnrelated(api, context, unrelated); return fixture;
}
