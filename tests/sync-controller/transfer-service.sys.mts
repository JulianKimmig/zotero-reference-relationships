/** Native transfer service acceptance over actual repositories, item permissions and verified backup files. */
import { present, readyState } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { Graph, ItemRef } from '../../src/domain/contracts.mts';
import type { SourceOwner, TransferMapping } from '../../src/transfer/contracts.mts';
import { check } from './ui-helpers.sys.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { book, ref } from './rules-fixtures.sys.mts';

/** Require a rejected operation without depending on a cross-compartment Error prototype. @param {Function} action Actual operation. @returns {Promise<void>} Completes only after rejection. */
async function denied(action: () => Promise<unknown>) {
  let rejected = false;
  try { await action(); } catch (error) { check(!!error, 'Missing rejection reason'); rejected = true; }
  check(rejected, 'Unsafe native transfer operation unexpectedly succeeded');
}

/** Map every original explicitly; callers choose retained inactive keys separately. @param {object} graph Incoming complete authority. @param {object} owner Actual target owner. @returns {object} Same-owner complete choices. */
function choices(graph: Graph, owner: SourceOwner): TransferMapping {
  const refs = new Map<string, ItemRef>();
  for (const root of graph.assertions) for (const endpoint of [root.source, root.target]) refs.set(endpoint.key, endpoint);
  return { source: { ...owner }, target: { ...owner }, library: graph.library,
    endpoints: [...refs.values()].map(endpoint => ({ source: { ...endpoint }, target: { ...endpoint }, mode: 'reference' })) };
}

/** Exercise opaque reviews and actual all-or-nothing publication without substituting source internals. @param {object} job Dedicated anonymous phase. @param {object} api Actual native APIs. @returns {Promise<object>} Persisted result suitable for separate-process readback. */
export async function transferService(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils, DOMParser, crypto, TextEncoder } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Service fixtures require a fresh unsigned-in profile');
  const production = await resources(job, api);
  const { TransferService } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/service.mjs');
  const { createTransferFiles } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-files.mjs');
  const { createTransferIdentity } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-identity.mjs');
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const { createExport } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/format.mjs');
  const { initialGraph } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/seed.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway: production.gateway });
  const io = present(api.IOUtils), files = createTransferFiles({ io, digest: factory.digest });
  const identity = createTransferIdentity({ Zotero, gateway: production.gateway });
  const app = Zotero.ReferenceRelationships!.application;
  const transfer = new TransferService({ gateway: production.gateway, identity, files,
    repositoryFor: factory.repositoryFor, repositoryForEvent: factory.repositoryForEvent,
    digest: factory.digest, now: () => new Date().toISOString(), invalidate: scope => app.invalidate(scope) });
  const repository = factory.repositoryFor('self', null);
  if (job.action === 'transfer:service-inspect') {
    const state = await repository.read(), owner = identity.read('self');
    transfer.stop(); factory.clear(); return { cleanReadback: true, noReplay: true, state, owner };
  }
  if (job.action === 'transfer:service-restore') {
    const { canonicalJSON } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/storage/canonical.mjs');
    check((await repository.read()).state === 'uninitialized', 'Round-trip restore requires a clean native store');
    const document = await files.read(present(job.pickerPath)), owner = identity.read('self');
    check(JSON.stringify(document.source) !== JSON.stringify(owner), 'Restore must exercise a distinct real owner');
    const originals = new Map<string, ItemRef>();
    for (const root of document.snapshot.assertions) for (const endpoint of [root.source, root.target]) originals.set(endpoint.key, endpoint);
    const endpoints: TransferMapping['endpoints'] = [];
    for (const endpoint of originals.values()) {
      const target = ref(await book(Zotero, `${job.marker} explicit target for ${endpoint.key}`));
      check(target.key !== endpoint.key, 'Round-trip fixture must explicitly map different real item identities');
      endpoints.push({ source: { ...endpoint }, target, mode: 'reference' });
    }
    const mapping: TransferMapping = { source: { ...document.source }, target: owner, library: 'self', endpoints };
    const expected = structuredClone(document.snapshot); expected.library = 'self';
    for (const root of expected.assertions) for (const field of ['source', 'target'] as const) {
      root[field] = { ...present(endpoints.find(row => row.source.key === root[field].key)).target };
    }
    await io.writeUTF8(`${present(job.data)}/transfer-restore-review.json`, JSON.stringify({ sourcePath: job.pickerPath, mapping, expected }), { mode: 'create', flush: true });
    const preview = await transfer.previewImport(document, mapping, 'merge', null);
    const inspection = await transfer.inspectImport(preview.previewToken);
    check(inspection.before === null && inspection.projection.after.state === 'ready', 'Clean restore lacks a complete mapped review');
    const result = await transfer.commitImport(preview.previewToken), state = readyState(await repository.read());
    const exported = await transfer.exportGraph('self');
    check(state.head === result.revision && canonicalJSON(exported.snapshot) === canonicalJSON(expected), 'Actual export/clean restore changed metadata, versions or explicit assertions');
    check(JSON.stringify(exported.source) === JSON.stringify(owner) && inspection.projection.after.relationships?.length === 2,
      'Restored owner or recomputed inverse results differ');
    transfer.stop(); factory.clear();
    return { state, sourcePath: job.pickerPath, differentRealOwner: true, explicitNewItemKeys: true,
      nativeExportRestoredToCleanStore: true, metadataTypesRulesPreserved: true, derivedResultsRecomputed: true };
  }
  if (job.action === 'transfer:service-restart') {
    const state = await repository.read();
    check(JSON.stringify(state) === JSON.stringify(job.before), 'Restart changed imported authority');
    const exported = await transfer.exportGraph('self');
    check(exported.snapshot.types[0].version === 7 && exported.snapshot.rules[0].version === 9,
      'Restart reset imported type/rule versions');
    transfer.stop(); factory.clear(); return { restarted: true, state, importedHistoryPreserved: true };
  }
  check(job.action === 'transfer:service', 'Unknown transfer service phase');
  const a = await book(Zotero, `${job.marker} A`), b = await book(Zotero, `${job.marker} B`);
  const owner = identity.read('self'), graph = initialGraph('self');
  graph.types[0].version = 7; graph.types[1].version = 4;
  graph.assertions.push({ id: 'portable-root', source: ref(a), target: ref(b), type: 'referencing',
    metadata: { note: 'Café 你好 <b>literal</b>' }, createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z' });
  graph.rules.push({ id: 'portable-inverse', version: 9, enabled: true, rootType: 'referencing', inputType: 'referencing',
    outputType: 'referenced-by', transform: 'reverse', conditions: [], mapping: { note: { kind: 'root', field: 'note' } } });
  const document = await createExport({ source: owner, snapshot: graph, exportedAt: '2026-11-05T12:00:00.000Z' }, factory.digest);
  const mapping = choices(graph, owner), preview = await transfer.previewImport(document, mapping, 'merge', null);
  check(Object.keys(preview).sort().join(',') === 'changeSet,previewToken', 'Import preview exposes private binding');
  check((await repository.read()).state === 'uninitialized', 'Preview wrote an initial generation');
  const inspection = await transfer.inspectImport(preview.previewToken);
  check(inspection.before === null && inspection.projection.after.relationships.length === 2 && !inspection.noop, 'Initial import seeded or omitted projected effects');
  inspection.after.assertions[0].metadata.note = 'caller alteration';
  check((await transfer.inspectImport(preview.previewToken)).after.assertions[0].metadata.note === graph.assertions[0].metadata.note,
    'Inspection changed the private reviewed graph');
  await denied(() => transfer.commitImport({}));
  await denied(() => transfer.commitImport(structuredClone(preview.previewToken)));
  const initialized = await transfer.commitImport(preview.previewToken);
  await denied(() => transfer.commitImport(preview.previewToken));
  let state = readyState(await repository.read());
  check(initialized.revision === state.head && JSON.stringify(state.snapshot) === JSON.stringify(document.snapshot), 'Initial import lost complete foreign history');
  check((await app.listRelationships(ref(a), 'both', null, { offset: 0, limit: 25 })).total === 2, 'Application was not invalidated after import');
  let repeated = await transfer.previewImport(document, choices(graph, owner), 'merge', state.head);
  check((await transfer.inspectImport(repeated.previewToken)).noop, 'Repeated merge is not recognized as idempotent');
  check((await transfer.commitImport(repeated.previewToken)).revision === state.head, 'No-op merge published another generation');
  check(JSON.stringify(await repository.read()) === JSON.stringify(state), 'No-op merge changed authority');
  const changedDocument = structuredClone(document), changedMapping = choices(graph, owner);
  const changed = await transfer.previewImport(changedDocument, changedMapping, 'merge', state.head);
  changedDocument.snapshot.assertions[0].metadata.note = 'altered after review';
  await denied(() => transfer.commitImport(changed.previewToken));
  const altered = await transfer.previewImport(document, changedMapping, 'merge', state.head);
  changedMapping.target.id = '123'; await denied(() => transfer.commitImport(altered.previewToken));
  repeated = await transfer.previewImport(document, choices(graph, owner), 'merge', state.head);
  a.deleted = true; await a.saveTx(); await denied(() => transfer.commitImport(repeated.previewToken));
  check(JSON.stringify(await repository.read()) === JSON.stringify(state), 'Stale endpoint review changed authority');
  a.deleted = false; await a.saveTx();
  const retainedMapping = choices(graph, owner); retainedMapping.endpoints.find(row => row.target.key === a.key)!.mode = 'retain';
  await denied(() => transfer.previewImport(document, retainedMapping, 'merge', state.head));
  a.deleted = true; await a.saveTx();
  const retained = await transfer.previewImport(document, retainedMapping, 'merge', state.head);
  check((await transfer.inspectImport(retained.previewToken)).retained[0].status === 'trashed', 'Retained endpoint omitted from review');
  a.deleted = false; await a.saveTx(); await denied(() => transfer.commitImport(retained.previewToken));
  const replacement = await transfer.previewImport(document, choices(graph, owner), 'replace', state.head);
  check(!(await transfer.inspectImport(replacement.previewToken)).noop, 'Replace incorrectly became a no-op');
  await denied(() => transfer.commitImport(replacement.previewToken));
  const backupPath = `${job.data}/transfer-before.json`;
  await transfer.backupImport(replacement.previewToken, backupPath);
  check((await transfer.inspectImport(replacement.previewToken)).backup !== null, 'Verified backup not acknowledged');
  const backup = await files.read(backupPath);
  check(JSON.stringify(backup.snapshot) === JSON.stringify(state.snapshot), 'Backup does not contain exact old graph');
  await io.writeUTF8(backupPath, '{}'); await denied(() => transfer.commitImport(replacement.previewToken));
  check(JSON.stringify(await repository.read()) === JSON.stringify(state), 'Tampered backup allowed graph replacement');
  const good = await transfer.previewImport(document, choices(graph, owner), 'replace', state.head);
  await transfer.backupImport(good.previewToken, `${job.data}/transfer-valid-before.json`);
  const replaced = await transfer.commitImport(good.previewToken);
  check(replaced.revision !== state.head, 'Equal replacement did not publish a new immutable generation');
  state = readyState(await repository.read());
  const stale = await transfer.previewImport(document, choices(graph, owner), 'merge', state.head);
  await repository.compareAndCommit(state.snapshot, state.head);
  await denied(() => transfer.commitImport(stale.previewToken));
  const current = readyState(await repository.read());
  const stopped = await transfer.previewImport(document, choices(graph, owner), 'merge', current.head);
  transfer.stop(); await denied(() => transfer.commitImport(stopped.previewToken));
  factory.clear();
  return { before: current, nativePublication: true, exactPreview: true, foreignVersions: true, noSeed: true,
    explicitMapping: true, inversePreserved: true, callerDetachment: true, forgedTokensRejected: true, consumedTokenRejected: true,
    inputMutationRejected: true, noOpMerge: true, nativeEndpointChangeRejected: true, retainedChoiceChecked: true,
    replaceRequiresVerifiedBackup: true, tamperedBackupRejected: true, equalReplacePublishes: true, staleHeadRejected: true, stoppedTokenRejected: true };
}
