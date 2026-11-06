/** A real native post-commit observer must not turn an already-published application mutation into a rejected write. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { book, ref, commits } from './rules-fixtures.sys.mts';
import { check } from './ui-helpers.sys.mts';
import { present, readyState, errorMessage } from './evidence.sys.mts';

/** Stop a separately composed application from the actual manifest notification after SQLite commit, then verify the published result through an independent live reader. @param {object} job Fresh unsigned-in native fixture. @param {object} api Actual native APIs and guarded repository composition. @returns {Promise<object>} Successful mutation and exact saved state despite service teardown after publication. */
export async function qualityPostcommit(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils, DOMParser, crypto, TextEncoder } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Post-commit tests require an unsigned-in disposable profile');
  const production = await resources(job, api), live = present(Zotero.ReferenceRelationships).application;
  check((await live.read('self')).state === 'uninitialized', 'Post-commit fixture must be a clean store');
  const a = await book(Zotero, `${job.marker} source`), b = await book(Zotero, `${job.marker} target`);
  const { RelationshipApplication } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/service.mjs');
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway: production.gateway });
  const app = new RelationshipApplication({ gateway: production.gateway, repositoryFor: factory.repositoryFor,
    repositoryForEvent: factory.repositoryForEvent, digest: factory.digest, now: () => new Date().toISOString(), newID: () => crypto.randomUUID() });
  const draft = await app.draftCreate({ source: ref(a), target: ref(b), type: 'referencing', metadata: { note: 'Saved before stop Café 你好' } });
  const beforeCount = await commits(api), stopped: { key: string; inTransaction: boolean }[] = [];
  const observer = Zotero.Notifier.registerObserver({
    /** Observe only genuine newly committed native manifest notes, without substituting source or transaction behavior. @param {string} event Native action. @param {string} type Native kind. @param {number[]} ids Actual notified item IDs. @returns {Promise<void>} Stops the separate app only after its real commit. */
    async notify(event: string, type: string, ids: number[]): Promise<void> {
      if (stopped.length || event !== 'add' || type !== 'item') return;
      for (const id of ids) {
        const item = await Zotero.Items.getAsync(id);
        if (item && item.isNote() && item.getNote().includes('reference-relationships/commit')) {
          stopped.push({ key: item.key, inTransaction: Zotero.DB.inTransaction() }); app.stop(); return;
        }
      }
    },
  }, ['item'], 'rr-quality-real-postcommit-stop');
  try {
    const result = await app.applyFromEvent(draft.command, draft.expectedRevision)
      .then(value => ({ value }), (error: unknown) => ({ error }));
    live.invalidateAll(); const state = readyState(await live.read('self'));
    const report = { stopped, state, manifestsAdded: await commits(api) - beforeCount,
      outcome: 'error' in result ? { error: errorMessage(result.error) } : { revision: result.value.revision } };
    await present(api.IOUtils).writeUTF8(`${present(job.data)}/quality-postcommit-result.json`, JSON.stringify(report), { mode: 'create', flush: true });
    const observed = present(stopped[0]);
    check(!observed.inTransaction && observed.key === state.head, 'Stop did not occur at the actual post-commit native manifest notification');
    check(report.manifestsAdded === 1 && state.snapshot.assertions.length === 1
      && state.snapshot.assertions[0].metadata.note === 'Saved before stop Café 你好', 'Native committed mutation was lost or duplicated');
    check('value' in result && result.value.revision === state.head, `Already committed application write was reported as rejected: ${JSON.stringify(report.outcome)}`);
    return { ...report, successfulCommittedWritePreserved: true, actualPostcommitStop: true };
  } finally { Zotero.Notifier.unregisterObserver(observer); app.stop(); factory.clear(); }
}
