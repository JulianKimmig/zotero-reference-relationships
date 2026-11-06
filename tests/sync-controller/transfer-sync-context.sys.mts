/** Dedicated shared-library transfer tests use actual owner, sync and production storage resources without authentication access. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { found, present } from './evidence.sys.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Compose the exact installed transfer service and restrict all explicit synchronization to the supplied writable development group. @param {object} job Artifact and accepted development group IDs. @param {object} api Actual signed-in native platform. @returns {Promise<object>} Scoped production resources and a native group-only sync operation. */
export async function transferSyncContext(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils, DOMParser, crypto, TextEncoder } = api;
  check(job.groups.writable === 6749379 && job.groups.restricted === 6749388, 'Use only the two user-provided development groups');
  const userID = Number(Zotero.Users.getCurrentUserID());
  check([22463862, 22463893].includes(userID), 'Use only the dedicated signed-in development accounts');
  check(Zotero.Prefs.get('sync.autoSync') === false && !Zotero.Sync.Runner.syncInProgress,
    'Controlled transfer sync requires autosync disabled and no existing sync');
  const group = found(Zotero.Groups.get(job.groups.writable));
  check(group.editable && !group.archived, 'The actual shared development group must be writable');
  const production = await resources(job, api), gateway = production.gateway, scope = `group:${job.groups.writable}` as const;
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const { createTransferIdentity } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-identity.mjs');
  const { createTransferFiles } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-files.mjs');
  const { TransferService } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/transfer/service.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway });
  const identity = createTransferIdentity({ Zotero, gateway }), app = Zotero.ReferenceRelationships!.application;
  const files = createTransferFiles({ io: present(api.IOUtils), digest: factory.digest });
  const transfer = new TransferService({ gateway, identity, files, repositoryFor: factory.repositoryFor,
    repositoryForEvent: factory.repositoryForEvent, digest: factory.digest, now: () => new Date().toISOString(), invalidate: library => app.invalidate(library) });
  const repository = factory.repositoryFor(scope, null);

  /** Execute actual native sync only for this shared group; no authentication material or unrelated libraries are read by the harness. @returns {Promise<object>} Native result and public error categories. */
  async function synchronizeGroup() {
    const errors: string[] = [];
    const outcome = await Zotero.Sync.Runner.sync({ background: true, libraries: [group.libraryID], fileLibraries: [], fullTextLibraries: [],
      onError(error) { errors.push(error.name || 'SyncError'); } });
    return { outcome, errors };
  }

  /** Require a complete successful actual group-only synchronization and invalidate graph caches. @returns {Promise<void>} */
  async function requireSync(): Promise<void> {
    const result = await synchronizeGroup();
    check(result.outcome !== false && result.errors.length === 0, `Native development-group sync failed: ${result.errors.join(',')}`);
    app.invalidate(scope); repository.invalidate();
  }

  /** Release the separately composed test service without changing signed-in profile or graph data. @returns {void} */
  function close(): void { transfer.stop(); factory.clear(); }
  return { userID, group, scope, gateway, factory, identity, transfer, repository, app, files, synchronizeGroup, requireSync, close };
}
