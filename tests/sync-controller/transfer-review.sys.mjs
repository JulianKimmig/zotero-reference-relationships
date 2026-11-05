/** Real item lifecycle observations feed complete history-preserving import review without publishing authority. */
import { check } from './ui-helpers.sys.mjs';
import { rejects } from './ui-permissions.sys.mjs';
import { resources, preserved } from './reconciliation-fixtures.sys.mjs';
import { book, ref, rule, commits, applyOne } from './rules-fixtures.sys.mjs';

/** Capture all unique original endpoint decisions explicitly using actual owner identity. @param {object} graph Valid mapped proposal. @param {object} owner Actual personal owner. @returns {object} Complete same-owner mapping. */
function choices(graph, owner) {
  const refs = new Map(); for (const root of graph.assertions) for (const endpoint of [root.source, root.target]) refs.set(endpoint.key, endpoint);
  return { source: owner, target: owner, library: graph.library,
    endpoints: [...refs.values()].map(endpoint => ({ source: { ...endpoint }, target: { ...endpoint }, mode: 'reference' })) };
}

/** Add one new original root while preserving exact entity shape/history from the valid native authority. @param {object} graph Mutable detached proposal. @param {string} id New stable identity. @param {object} source Real historical/native ItemRef. @param {object} target Real historical/native ItemRef. @param {string} note Literal metadata. @returns {void} */
function append(graph, id, source, target, note) {
  graph.assertions.push({ ...structuredClone(graph.assertions[0]), id, source, target, metadata: { note } });
}

/** Exercise actual stored roots, native merge witnesses and unavailable items on one disposable unsigned client. @param {object} job Exact phase/artifact fixture. @param {object} api Actual native platform. @returns {Promise<object>} Complete bounded review evidence. */
async function runTransferReview(job, api) {
  const { Zotero, ChromeUtils, DOMParser, crypto, TextEncoder } = api, production = await resources(job, api);
  check(!Zotero.Users.getCurrentUserID(), 'Native transfer review fixtures require an unsigned disposable client');
  const app = Zotero.ReferenceRelationships.application;
  if (job.action === 'transfer:review-inspect') {
    const state = await app.read('self'), count = await commits(api);
    check(state.state === 'ready' && state.snapshot.assertions.length === 1 && state.snapshot.rules.length === 0 && count === 1,
      'Failed seed state differs from the rejected caller-version diagnosis');
    return { cleanReadback: true, noReplay: true, state, count, inverseRuleNotCreated: true };
  }
  if (job.action === 'transfer:review-restart') {
    await preserved(api, job.before, job.count);
    check((await app.reconcile('self', { offset: 0, limit: 25 })).state === 'conflict', 'Restart lost the original conflicting witnesses');
    return { restarted: true, reviewedImportDidNotPublish: true, originalConflictingAuthorityPreserved: true };
  }
  check(job.action === 'transfer:review', 'Unknown native transfer review phase');
  const { reviewTransfer } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/review.mjs');
  const { LifecycleProjection } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/lifecycle.mjs');
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const { createTransferIdentity } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-identity.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway: production.gateway });
  const lifecycle = new LifecycleProjection(production.gateway, factory.digest), owner = createTransferIdentity({ Zotero, gateway: production.gateway }).read('self');
  const a = await book(Zotero, `${job.marker} original`), b = await book(Zotero, `${job.marker} target`), c = await book(Zotero, `${job.marker} independent`);
  await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(b), type: 'referencing', metadata: { note: 'Café 你好 <b>literal</b>' } }));
  const { version, ...definition } = rule('transfer-inverse');
  await applyOne(api, await app.manageRules({ library: 'self', kind: 'create', rule: definition }));
  const state = await app.read('self'), count = await commits(api), after = structuredClone(state.snapshot);
  after.types.find(type => type.id === 'referencing').version = 7; after.rules[0].version = 9;
  let observed = await lifecycle.observe([state.snapshot, after]);
  let result = reviewTransfer(state.snapshot, after, choices(after, owner), observed.rows);
  check(result.projection.after.relationships.length === 2 && result.changeSet.rules.updated[0].after.version === 9
    && result.changeSet.types.updated[0].after.version === 7, 'Native review reset foreign versions or omitted inverse effects');
  await preserved(api, state, count);
  a.deleted = true; await a.saveTx();
  let mapping = choices(after, owner); mapping.endpoints.find(row => row.target.key === a.key).mode = 'retain';
  observed = await lifecycle.observe([state.snapshot, after]); result = reviewTransfer(state.snapshot, after, mapping, observed.rows);
  check(result.retained[0].status === 'trashed' && result.after.assertions[0].source.key === a.key
    && result.projection.after.relationships.length === 0 && result.refs.length === 1, 'Trashed original lost authority or generated inference');
  await preserved(api, state, count);
  a.deleted = false; await a.saveTx();
  check((await lifecycle.observe([state.snapshot, after])).endpointRevision !== observed.endpointRevision, 'Actual native restoration did not change endpoint binding');
  const gone = await book(Zotero, `${job.marker} erased imported original`), original = ref(gone); await gone.eraseTx();
  const missing = structuredClone(after); append(missing, 'imported-missing', original, ref(b), 'Recover original');
  mapping = choices(missing, owner); mapping.endpoints.find(row => row.target.key === original.key).mode = 'retain';
  observed = await lifecycle.observe([state.snapshot, missing]); result = reviewTransfer(state.snapshot, missing, mapping, observed.rows);
  check(result.retained[0].status === 'missing' && result.after.assertions.length === 2 && result.projection.after.relationships.length === 2,
    'Erased imported endpoint was dropped or trusted for inference');
  const note = new Zotero.Item('note'); note.libraryID = a.libraryID; note.setNote('<p>Ordinary unsupported endpoint</p>'); await note.saveTx();
  const unsupported = structuredClone(after); append(unsupported, 'imported-unsupported', ref(note), ref(b), 'Historical note-key endpoint');
  mapping = choices(unsupported, owner); mapping.endpoints.find(row => row.target.key === note.key).mode = 'retain';
  observed = await lifecycle.observe([state.snapshot, unsupported]); result = reviewTransfer(state.snapshot, unsupported, mapping, observed.rows);
  check(result.retained[0].status === 'unsupported' && result.after.assertions.length === 2 && result.projection.after.relationships.length === 2,
    'Nonbibliographic historical endpoint was dropped or accepted as active');
  const ambiguous = await book(Zotero, `${job.marker} ambiguous imported original`), ambiguousRef = ref(ambiguous), uri = Zotero.URI.getItemURI(ambiguous);
  await ambiguous.eraseTx();
  for (let index = 0; index < 2; index++) {
    const item = await book(Zotero, `${job.marker} alias candidate ${index}`);
    item.addRelation(Zotero.Relations.replacedItemPredicate, uri); await item.saveTx();
  }
  const unknown = structuredClone(after); append(unknown, 'imported-ambiguous', ambiguousRef, ref(b), 'Full rejected proposal remains intact');
  mapping = choices(unknown, owner); mapping.endpoints.find(row => row.target.key === ambiguousRef.key).mode = 'retain';
  observed = await lifecycle.observe([state.snapshot, unknown]);
  await rejects(() => Promise.resolve(reviewTransfer(state.snapshot, unknown, mapping, observed.rows)), 'endpoint');
  check(unknown.assertions.length === 2 && mapping.endpoints.length === 3, 'Rejected alias review discarded original inputs');
  await preserved(api, state, count);
  await applyOne(api, await app.draftCreate({ source: ref(c), target: ref(b), type: 'referencing', metadata: { note: 'Independent original' } }));
  const before = await app.read('self'), finalCount = await commits(api);
  const { mergeItems } = ChromeUtils.importESModule('chrome://zotero/content/mergeItems.mjs'); await mergeItems(a, [c]);
  const replacement = structuredClone(before.snapshot); replacement.assertions = replacement.assertions.filter(root => root.source.key === a.key);
  observed = await lifecycle.observe([before.snapshot, replacement]); result = reviewTransfer(before.snapshot, replacement, choices(replacement, owner), observed.rows);
  check(result.projection.before.state === 'conflict' && result.before.assertions.length === 2 && result.changeSet.derived === null
    && result.projection.after.state === 'ready' && result.projection.after.relationships.length === 2, 'Native conflict replacement invented an empty before or accepted partial effects');
  const collapsed = structuredClone(replacement); append(collapsed, 'imported-collapsed-history', ref(a), ref(c), 'Preserve original merged keys');
  observed = await lifecycle.observe([before.snapshot, collapsed]); result = reviewTransfer(before.snapshot, collapsed, choices(collapsed, owner), observed.rows);
  check(result.after.assertions.at(-1).target.key === c.key && result.projection.after.relationships.length === 2
    && result.changeSet.diagnostics.some(value => value.code === 'self-edge'), 'Historical collapsed root lost original identity or diagnostics');
  await preserved(api, before, finalCount); factory.clear();
  return { before, count: finalCount, nativeObservations: true, foreignVersionsAndInverseEffects: true, trashedRetained: true,
    missingRetained: true, unsupportedRetained: true, ambiguousRejectedWithoutDrops: true, completeConflictBefore: true,
    collapsedHistoryDiagnosed: true, restoredEndpointBindingChanged: true, noReviewPublication: true };
}

/** Surface source locations for a failed real native review instead of guessing from a generic validation message. @param {object} job Exact phase/artifact fixture. @param {object} api Actual native platform. @returns {Promise<object>} Native journey result, or explicit diagnostic failure. */
export async function transferReview(job, api) {
  try { return await runTransferReview(job, api); }
  catch (error) { throw new Error(`Native transfer review ${job.action}: ${error.stack}`, { cause: error }); }
}
