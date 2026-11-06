/** Exercise teardown during actual native digest latency without replacing application or repository behavior. */
import { contractFailure } from './evidence.sys.mts';
import type { ItemGateway } from '../../src/adapters/native-contracts.mts';
import type { Draft } from '../../src/application/contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check, until } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { commits } from './rules-fixtures.sys.mts';
import { preserved } from './reconciliation-fixtures.sys.mts';

/** Stop a separately composed real application at a selected external WebCrypto completion. @param {object} api Actual native platform. @param {object} gateway Actual production item gateway. @param {object} draft Real detached command/revision. @param {number} ordinal Digest call to suspend. @returns {Promise<void>} Visible conflict and unchanged native authority. */
async function stopAtDigest(api: NativeAPI, gateway: ItemGateway, draft: Draft, ordinal: number) {
  const { Zotero, ChromeUtils } = api, window = Zotero.getMainWindow();
  const { RelationshipApplication } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/service.mjs');
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const repositories = createRepositoryFactory({ Zotero, DOMParser: window.DOMParser,
    crypto: window.crypto, TextEncoder: window.TextEncoder, gateway });
  const release = Zotero.Promise.defer(); let entered = false, calls = 0;
  /** Delay only an external digest result, retaining the genuine native hash. @param {string} input Canonical native endpoint data. @returns {Promise<string>} Actual SHA-256. */
  async function delayedDigest(input: string) {
    const result = await repositories.digest(input);
    if (++calls === ordinal) { entered = true; await release.promise; }
    return result;
  }
  const app = new RelationshipApplication({ gateway, repositoryFor: repositories.repositoryFor,
    repositoryForEvent: repositories.repositoryForEvent, digest: delayedDigest,
    now: () => new Date().toISOString(), newID: () => window.crypto.randomUUID(), yieldToHost: () => Zotero.Promise.delay(0) });
  const before = await Zotero.ReferenceRelationships!.application.read('self'), count = await commits(api);
  const operation = ordinal === 1 ? app.preview(draft.command, draft.expectedRevision)
    : app.applyFromEvent(draft.command, draft.expectedRevision);
  // Attach immediately so a native promise rejection cannot become unhandled while the observer waits.
  const observed = operation.then(value => ({ value }), (error: unknown) => ({ error }));
  try {
    await until(Zotero, () => entered, `actual digest ${ordinal} reached`);
    app.stop(); release.resolve();
    const result = await observed;
    await rejects(async () => { if ('error' in result) throw result.error; return result.value; }, 'conflict');
    check('error' in result && contractFailure(result.error).message.includes('stopped'), 'Teardown failed for a different conflict');
    await preserved(api, before, count);
  } finally { release.resolve(); app.stop(); repositories.clear(); }
}

/** Verify teardown during both preflight and commit-time native observation. @param {object} api Actual platform. @param {object} gateway Actual native gateway. @param {object} draft Valid proposed command. @returns {Promise<object>} Bounded cancellation evidence. */
export async function reconciliationStop(api: NativeAPI, gateway: ItemGateway, draft: Draft) {
  await stopAtDigest(api, gateway, draft, 1);
  await stopAtDigest(api, gateway, draft, 2);
  return { stoppedDuringNativeReview: true, stoppedDuringOwnedTransactionBinding: true, noAuthorityWrites: true };
}
