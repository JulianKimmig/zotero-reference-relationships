/** Actual native endpoint races and teardown at the external digest boundary test both publishing and no-op transactions. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TransferOptions } from '../../src/transfer/service-contracts.mts';
import type { TransferMapping } from '../../src/transfer/contracts.mts';
import { check, until } from './ui-helpers.sys.mts';
import { readyState } from './evidence.sys.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { book, ref } from './rules-fixtures.sys.mts';

/** Execute real native races using only delayed completion of genuine external WebCrypto results. @param {object} job Anonymous isolated phase. @param {object} api Native platform. @returns {Promise<object>} Guard/no-op/teardown evidence. */
export async function transferServiceEdges(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils, DOMParser, crypto, TextEncoder } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Transfer race fixtures require an anonymous client');
  const production = await resources(job, api);
  const { TransferService } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/service.mjs');
  const { createTransferFiles } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-files.mjs');
  const { createTransferIdentity } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-identity.mjs');
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const { createExport } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/format.mjs');
  const { initialGraph } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/application/seed.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway: production.gateway });
  const identity = createTransferIdentity({ Zotero, gateway: production.gateway });
  const app = Zotero.ReferenceRelationships!.application;
  check(!!api.IOUtils, 'Actual IOUtils required');
  const files = createTransferFiles({ io: api.IOUtils, digest: factory.digest });
  const options: TransferOptions = { gateway: production.gateway, identity, files, repositoryFor: factory.repositoryFor,
    repositoryForEvent: factory.repositoryForEvent, digest: factory.digest, now: () => new Date().toISOString(), invalidate: scope => app.invalidate(scope) };
  const a = await book(Zotero, `${job.marker} source`), b = await book(Zotero, `${job.marker} target`);
  const graph = initialGraph('self');
  graph.assertions.push({ id: 'guard-root', source: ref(a), target: ref(b), type: 'referencing', metadata: { note: 'Guard original' },
    createdAt: '2026-11-05T12:00:00.000Z', updatedAt: '2026-11-05T12:00:00.000Z' });
  const repository = factory.repositoryFor('self', null); await repository.compareAndCommit(graph, null);
  const before = readyState(await repository.read()), owner = identity.read('self');
  const document = await createExport({ source: owner, snapshot: graph, exportedAt: options.now() }, factory.digest);
  const mapping: TransferMapping = { source: owner, target: owner, library: 'self', endpoints: [a, b]
    .map(item => ({ source: ref(item), target: ref(item), mode: 'reference' })) };
  const reports = [];
  for (const operation of ['merge', 'replace'] as const) {
    for (const ordinal of [1, 2]) {
      const release = Zotero.Promise.defer(); let armed = false, entered = false, calls = 0, inTransaction = false;
      /** Delay a genuine endpoint SHA-256 after native observations without replacing the graph service. @param {string} text Canonical data. @returns {Promise<string>} Native hash after test-controlled external latency. */
      async function delayedDigest(text: string) {
        const hash = await factory.digest(text);
        if (armed && text.startsWith('[') && ++calls === ordinal) {
          entered = true; inTransaction = Zotero.DB.inTransaction(); await release.promise;
        }
        return hash;
      }
      const transfer = new TransferService({ ...options, digest: delayedDigest });
      const preview = await transfer.previewImport(document, structuredClone(mapping), operation, before.head);
      if (operation === 'replace') await transfer.backupImport(preview.previewToken, `${job.data}/guard-before-${ordinal}.json`);
      armed = true;
      const pending = transfer.commitImport(preview.previewToken).then(value => ({ value }), (error: unknown) => ({ error }));
      try {
        await until(Zotero, () => entered, `transfer ${operation} external digest ${ordinal}`);
        if (ordinal === 1) {
          check(!inTransaction, 'Preflight latency unexpectedly ran in a native transaction');
          a.deleted = true; await a.saveTx();
        } else {
          check(inTransaction, 'Commit-time verification did not own the native transaction');
          transfer.stop();
        }
        release.resolve(); const outcome = await pending;
        check('error' in outcome, 'Changed native state or teardown allowed import publication/no-op acceptance');
        if (ordinal === 1) {
          a.deleted = false; await a.saveTx();
          let expired = false;
          try { await transfer.inspectImport(preview.previewToken); } catch (error) { expired = !!error; }
          check(expired, 'A rejected changed-endpoint review revived after restoration; fresh review required');
        }
        check(JSON.stringify(await repository.read()) === JSON.stringify(before), 'Rejected import changed graph authority');
        reports.push({ operation, ordinal, inTransaction, rejected: true, authorityUnchanged: true });
      } finally { release.resolve(); transfer.stop(); }
    }
  }
  const malformed = new TransferService(options);
  for (const bad of [{}, { ...document, schema: 2 }, { ...document, hash: '0'.repeat(64) }]) {
    let rejected = false;
    try { await malformed.previewImport(bad, mapping, 'merge', before.head); } catch (error) { rejected = !!error; }
    check(rejected, 'Malformed import reached a proposal');
  }
  check(JSON.stringify(await repository.read()) === JSON.stringify(before), 'Malformed imports changed authority');
  malformed.stop(); factory.clear();
  return { before, reports, nativeRaceBetweenPreflightAndOwnedGuardRejected: true,
    noOpAndPublicationBothGuarded: true, stopDuringOwnedNativeBindingRejected: true, malformedNoPartialWrites: true };
}
