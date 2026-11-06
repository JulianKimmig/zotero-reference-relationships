/** Read-only native phase measurements locate remaining synchronous work after cooperative traversal integration. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { measureNative } from './quality-measure.sys.mts';
import { commits } from './rules-fixtures.sys.mts';
import { check } from './ui-helpers.sys.mts';
import { present, readyState } from './evidence.sys.mts';

/** Read an existing disposable failed fixture without replaying publication, verifying that inspection itself preserves state and manifest count. @param job Exact existing unsigned-in profile and artifact. @param api Native resources. @returns Full current authority and physical item count, with no authority mutation. */
export async function qualityReadback(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Quality readback requires a disposable unsigned-in profile');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application, before = await app.read('self'), count = await commits(api);
  const nativeItems = await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items WHERE libraryID=?', [Zotero.Libraries.userLibraryID]);
  app.invalidateAll(); const after = await app.read('self');
  check(JSON.stringify(before) === JSON.stringify(after) && await commits(api) === count, 'Read-only quality recovery changed authority');
  return { noAuthorityWrites: true, state: after, manifests: count, nativeItems, inTransaction: Zotero.DB.inTransaction() };
}

/** Measure real validation, observation, closure, report indexing and derived differences on an already-saved disposable dense graph; never replay its mutation. @param job Existing unsigned-in quality profile. @param api Actual native APIs and real production modules. @returns Phase distributions with verified unchanged authority/head/count. */
export async function qualityPhases(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils, DOMParser, crypto, TextEncoder } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Phase measurements require a disposable unsigned-in profile');
  const production = await resources(job, api), app = present(Zotero.ReferenceRelationships).application;
  const before = readyState(await app.read('self')), count = await commits(api);
  check(before.snapshot.assertions.length === 1000 && before.snapshot.rules.length === 50, 'Use the preserved dense quality fixture');
  await app.listRelationships(before.snapshot.assertions[0].source, 'both', null, { offset: 0, limit: 25 });
  await Zotero.Promise.delay(100);
  const { LifecycleProjection, inspectObservedAsync } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/lifecycle.mjs');
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const { validateGraph } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/domain/graph-contract.mjs');
  const { entityDelta, entityDeltaAsync } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/changes.mjs');
  const { indexProjection } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/projection-views.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway: production.gateway });
  const cooperation = { batchSize: 256, yieldToHost: () => Zotero.Promise.delay(0),
    /** Stop read-only profiling if its actual addon lifetime ends. @returns Nothing when the installed plugin remains active. */
    assertActive() { check(Zotero.ReferenceRelationships?.state === 'running', 'Native plugin stopped during phase measurement'); } };
  const lifecycle = new LifecycleProjection(production.gateway, factory.digest, cooperation), proposed = structuredClone(before.snapshot);
  proposed.assertions[0].metadata.note = 'Read-only phase comparison Café 你好'; proposed.assertions[0].updatedAt = new Date().toISOString();
  try {
    const validation = await measureNative(api, () => { validateGraph(before.snapshot); });
    const observation = await measureNative(api, async () => { await lifecycle.observe([before.snapshot, proposed]); }, 3);
    const facts = await lifecycle.observe([before.snapshot, proposed]);
    const inspection = await measureNative(api, async () => {
      const report = await inspectObservedAsync(before.snapshot, facts.rows, cooperation);
      check(report.state === 'ready' && report.relationships.length === 2000, 'Phase inspection changed dense semantics');
    }, 3);
    const previous = await inspectObservedAsync(before.snapshot, facts.rows, cooperation);
    const next = await inspectObservedAsync(proposed, facts.rows, cooperation);
    check(previous.state === 'ready' && next.state === 'ready', 'Dense phase graphs must be fully ready');
    const differences = await measureNative(api, () => {
      const delta = entityDelta(previous.relationships, next.relationships, 'key');
      check(delta.added.length === 0 && delta.removed.length === 0 && delta.updated.length === 1, 'Derived comparison lost the exact one-row metadata change');
    });
    const cooperativeDifferences = await measureNative(api, async () => {
      const delta = await entityDeltaAsync(previous.relationships, next.relationships, 'key', cooperation);
      check(delta.added.length === 0 && delta.removed.length === 0 && delta.updated.length === 1, 'Cooperative comparison changed the exact one-row metadata delta');
    });
    const indexing = await measureNative(api, () => { indexProjection(before.snapshot, { ...facts, report: previous }); });
    app.invalidateAll(); const after = readyState(await app.read('self'));
    check(after.head === before.head && await commits(api) === count, 'Read-only phase measurements changed authority');
    return { noAuthorityWrites: true, head: after.head, assertions: 1000, rules: 50,
      validation, observation, inspection, differences, cooperativeDifferences, indexing };
  } finally { factory.clear(); }
}
