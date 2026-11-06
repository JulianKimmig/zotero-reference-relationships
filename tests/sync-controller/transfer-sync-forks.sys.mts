/** Real offline rule/assertion imports from one head must become explicit complete conflicts before a reviewed two-head resolution. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { Graph } from '../../src/domain/contracts.mts';
import type { TransferMapping } from '../../src/transfer/contracts.mts';
import type { GenerationFixture, NativeReady, TransferSyncContext } from './transfer-sync-contracts.mts';
import { fixtureJSON, requireReady, captureUnrelated, requireUnrelated, fixtureID } from './transfer-sync-fixtures.sys.mts';
import { present, readyState } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Complete branch snapshots travel between controlled client jobs; no token or native object is serialized. */
export type ForkJob = ControllerJob & { forkRule?: NativeReady; forkAssertion?: NativeReady; resolved?: NativeReady };

/** Build explicit choices for every original, retaining only observed inactive identities without guessing aliases. @param {object} context Native owner/gateway. @param {object} graph Complete reviewed authority. @returns {Promise<object>} Exact mapping over all original endpoints. */
async function mapping(context: TransferSyncContext, graph: Graph): Promise<TransferMapping> {
  const owner = context.identity.read(context.scope), refs = new Map<string, Graph['assertions'][number]['source']>();
  for (const root of graph.assertions) for (const ref of [root.source, root.target]) refs.set(ref.key, ref);
  const endpoints: TransferMapping['endpoints'] = [];
  for (const ref of refs.values()) {
    const row = await context.gateway.inspect(ref);
    check(row.status === 'active' || ['missing', 'trashed', 'unsupported'].includes(row.status), 'Unknown native aliases need explicit repair before this controlled fork');
    endpoints.push({ source: { ...ref }, target: { ...ref }, mode: row.status === 'active' ? 'reference' : 'retain' });
  }
  return { source: { ...owner }, target: { ...owner }, library: context.scope, endpoints };
}

/** Identify only the root created by this fixture's unique baseline type/source. @param {object} fixture Captured complete fixture. @returns {string} Exact owned original identity. */
function baselineRoot(fixture: GenerationFixture): string {
  const roots = fixture.baseline.state.snapshot.assertions.filter(root => root.type === fixture.baseline.type && root.source.key === fixture.baseline.sourceKey);
  check(roots.length === 1, 'Controlled baseline no longer identifies exactly one original'); return roots[0].id;
}

/** Require both complete independent snapshots and refuse any selected current graph from a forked authority. @param {object} api Actual codec. @param {object} context Real repository. @param {object} job Exact branch identities. @returns {Promise<object>} Actual explicit conflict. */
async function conflict(api: NativeAPI, context: TransferSyncContext, job: ForkJob) {
  const rule = present(job.forkRule), assertion = present(job.forkAssertion);
  const expected = [rule.head, assertion.head].sort(); context.repository.invalidate(); context.app.invalidate(context.scope);
  const state = await context.repository.read();
  check(state.state === 'conflict' && fixtureJSON(api, state.heads) === fixtureJSON(api, expected) && !('snapshot' in state), 'Concurrent imports did not remain an explicit two-head conflict');
  check(fixtureJSON(api, await context.app.read(context.scope)) === fixtureJSON(api, state), 'Application exposed a mixed or arbitrarily selected fork');
  for (const branch of [rule, assertion]) {
    const actual = await context.repository.readHead(branch.head);
    check(fixtureJSON(api, actual) === fixtureJSON(api, { head: branch.head, snapshot: branch.snapshot }), 'A competing complete branch was mixed or damaged');
  }
  return state;
}

/** Run one controlled real fork/publish/read/resolve step; preserve every unrelated entity and library. @param {object} job Complete source generation plus branch snapshots. @param {object} api Actual signed host. @param {object} context Scoped native resources. @returns {Promise<object>} Actual branch/conflict/resolution evidence. */
export async function transferSyncForks(job: ForkJob, api: NativeAPI, context: TransferSyncContext) {
  check(job.transferFixture?.kind === 'generation', 'Fork tests require a completed real transfer generation');
  const fixture = job.transferFixture, unrelated = await captureUnrelated(context), rootID = baselineRoot(fixture);
  try {
    if (job.action === 'transfer:sync-fork-rule' || job.action === 'transfer:sync-fork-assertion') {
      const offline = api.Services.io.offline; api.Services.io.offline = true;
      try {
        check(api.Services.io.offline, 'Native fork did not enter offline mode');
        await requireReady(api, context, fixture.after);
        const snapshot = structuredClone(fixture.after.snapshot), ruleBranch = job.action === 'transfer:sync-fork-rule';
        if (ruleBranch) {
          const rule = present(snapshot.rules.find(rule => rule.id === fixture.baseline.rule));
          check(rule.version === 9, 'The controlled rule base changed'); rule.version = 10;
          rule.mapping = { note: { kind: 'constant', value: 'Rule fork Café 你好' } };
        } else {
          const root = present(snapshot.assertions.find(root => root.id === rootID));
          root.metadata.note = 'Assertion fork Café 你好'; root.updatedAt = new Date().toISOString();
        }
        const { createExport } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/format.mjs');
        const document = await createExport({ source: context.identity.read(context.scope), snapshot, exportedAt: new Date().toISOString() }, context.factory.digest);
        const preview = await context.transfer.previewImport(document, await mapping(context, snapshot), 'replace', fixture.after.head);
        const inspection = await context.transfer.inspectImport(preview.previewToken);
        check(!inspection.noop && fixtureJSON(api, inspection.before) === fixtureJSON(api, fixture.after.snapshot), 'Fork was not reviewed from the exact common head');
        const backup = `${present(job.data)}/${fixtureID(api, 'transfer-fork-backup')}.json`;
        await context.transfer.backupImport(preview.previewToken, backup);
        const committed = await context.transfer.commitImport(preview.previewToken), state = readyState(await context.repository.read());
        check(state.head === committed.revision && fixtureJSON(api, state.snapshot) === fixtureJSON(api, inspection.after), 'Offline fork changed its reviewed complete graph');
        const note = await api.Zotero.Items.getByLibraryAndKeyAsync(context.group.libraryID, state.head);
        check(note && !note.synced && note.version === 0, 'Offline fork was prematurely uploaded');
        await requireUnrelated(api, context, unrelated);
        return { state, backup, offlineImport: true, commonHead: fixture.after.head, completeBranchPreserved: true };
      } finally { api.Services.io.offline = offline; }
    }
    if (job.action === 'transfer:sync-fork-publish-rule') {
      await requireReady(api, context, present(job.forkRule)); await context.requireSync();
      const state = await requireReady(api, context, present(job.forkRule)); await requireUnrelated(api, context, unrelated);
      return { state, actualRuleBranchUploaded: true };
    }
    if (job.action === 'transfer:sync-fork-publish-assertion') {
      await requireReady(api, context, present(job.forkAssertion)); await context.requireSync();
      const state = await conflict(api, context, job); await requireUnrelated(api, context, unrelated);
      return { state, actualAssertionBranchUploaded: true, noMixedGeneration: true };
    }
    if (job.action === 'transfer:sync-fork-conflict') {
      await context.requireSync(); const state = await conflict(api, context, job); await requireUnrelated(api, context, unrelated);
      return { state, bothCompleteBranchesPreserved: true, noMixedGeneration: true };
    }
    if (job.action === 'transfer:sync-fork-resolve') {
      await context.requireSync(); await conflict(api, context, job);
      const rule = present(job.forkRule), assertion = present(job.forkAssertion), snapshot = structuredClone(rule.snapshot);
      const changed = present(assertion.snapshot.assertions.find(root => root.id === rootID));
      snapshot.assertions = snapshot.assertions.map(root => root.id === rootID ? structuredClone(changed) : root);
      for (const kind of ['types', 'rules', 'assertions'] as const) {
        check(snapshot[kind].length === fixture.after.snapshot[kind].length, 'Resolution dropped or invented an entity');
        for (const previous of fixture.after.snapshot[kind]) {
          if ((kind === 'rules' && previous.id === fixture.baseline.rule) || (kind === 'assertions' && previous.id === rootID)) continue;
          check(fixtureJSON(api, snapshot[kind].find(entity => entity.id === previous.id)) === fixtureJSON(api, previous), 'Resolution changed an unrelated original entity');
        }
      }
      const { LifecycleProjection } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/lifecycle.mjs');
      const { reviewTransfer } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/review.mjs');
      const lifecycle = new LifecycleProjection(context.gateway, context.factory.digest), choices = await mapping(context, snapshot);
      const observed = await lifecycle.observe([rule.snapshot, assertion.snapshot, snapshot]);
      const review = reviewTransfer(rule.snapshot, snapshot, choices, observed.rows);
      const otherReview = reviewTransfer(assertion.snapshot, snapshot, choices, observed.rows);
      check(review.projection.after.state === 'ready' && otherReview.projection.after.state === 'ready', 'Explicit two-head cleanup has no complete reviewed result');
      const owner = context.identity.capture(context.scope);
      const writer = context.factory.repositoryForEvent(context.scope, async () => {
        owner.assertCurrent(); await context.gateway.assertWritable(context.scope, review.refs);
        await lifecycle.assertBinding(rule.snapshot, snapshot, observed.endpointRevision); owner.assertCurrent();
      });
      const revision = await writer.resolve(snapshot, [rule.head, assertion.head].sort());
      context.app.invalidate(context.scope); await context.requireSync();
      const state = readyState(await context.repository.read());
      check(state.head === revision && fixtureJSON(api, state.snapshot) === fixtureJSON(api, snapshot), 'Explicit cleanup did not preserve both reviewed changes');
      await requireUnrelated(api, context, unrelated);
      return { state, explicitlyReviewedBothHeads: true, ruleVersionPreserved: 10, assertionMetadataPreserved: true,
        unrelatedAuthorityPreserved: true, completeGenerationPublished: true };
    }
    check(job.action === 'transfer:sync-fork-ready', 'Unknown controlled fork phase');
    await context.requireSync(); const state = await requireReady(api, context, present(job.resolved));
    check(present(state.snapshot.rules.find(rule => rule.id === fixture.baseline.rule)).version === 10
      && present(state.snapshot.assertions.find(root => root.id === rootID)).metadata.note === 'Assertion fork Café 你好', 'Converged graph lost a concurrent change');
    await requireUnrelated(api, context, unrelated);
    return { state, independentlyConverged: true, bothChangesPreserved: true, noMixedGeneration: true };
  } catch (error) { throw new Error(`Controlled concurrent import ${job.action}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
}
