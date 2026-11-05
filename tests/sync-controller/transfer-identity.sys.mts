/** Actual anonymous/signed ownership and removed/recreated native library binding for portable transfer. */
import { found } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { localGroup, groupIDs } from './library-fixtures.sys.mts';

/** Verify public owner identity without reading authentication or storing local library IDs in transfer data. @param {object} job Explicit action/artifact/fixture marker. @param {object} api Actual native platform resources. @returns {Promise<object>} Ownership and native binding evidence. */
export async function transferIdentity(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils } = api, production = await resources(job, api);
  const { createTransferIdentity } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-identity.mjs');
  const identity = createTransferIdentity({ Zotero, gateway: production.gateway }), scope = `group:${groupIDs.keep}` as const;
  const app = Zotero.ReferenceRelationships!.application, before = await app.read('self');
  if (job.action === 'transfer:identity-signed') {
    await api.synchronize();
    const userID = Zotero.Users.getCurrentUserID(); check(!!userID, 'Signed identity requires the actual account');
    const signedOwner = identity.read('self');
    check(signedOwner.kind === 'user' && signedOwner.id === String(userID), 'Personal export is not bound to the signed-in owner');
    const shared = identity.read(`group:${job.groups.writable}`), restricted = identity.read(`group:${job.groups.restricted}`);
    check(shared.kind === 'group' && shared.id === String(job.groups.writable), 'Shared export owner uses a local library ID');
    check(restricted.kind === 'group' && restricted.id === String(job.groups.restricted), 'Restricted owner is unavailable for read-only export');
    identity.capture('self').assertCurrent(); identity.capture(`group:${job.groups.restricted}`).assertCurrent();
    if (!found(Zotero.Groups.get(job.groups.restricted)).editable) await rejects(() => production.gateway.assertWritable(`group:${job.groups.restricted}`, []), 'permission');
    check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Identity inspection changed signed authority');
    return { signedOwner: identity.read('self'), shared, restricted, readOnlyIdentityDoesNotGrantWrite: true, noAuthorityWrites: true };
  }
  check(!Zotero.Users.getCurrentUserID(), 'Anonymous identity fixtures require a fresh unsigned-in client');
  const owner = identity.read('self');
  check(owner.kind === 'local-user' && owner.id === Zotero.Users.getLocalUserKey(), 'Anonymous export lost actual local-user identity');
  const personal = identity.capture('self'); personal.owner.id = 'caller-mutation'; personal.assertCurrent();
  check(identity.read('self').id === owner.id, 'Caller changed native export identity');
  await rejects(() => Promise.resolve(identity.read('other')), 'validation');
  await rejects(() => Promise.resolve(identity.read('group:999999999999999')), 'endpoint');
  if (job.action === 'transfer:identity-restart') {
    check(JSON.stringify(owner) === JSON.stringify(job.owner), 'Anonymous owner changed after a real process restart');
    check(JSON.stringify(identity.read(scope)) === JSON.stringify(job.group), 'Group owner changed after restart');
    identity.capture(scope).assertCurrent();
    return { localOwnerStableAcrossRestart: true, groupOwnerStableAcrossRestart: true, noAuthorityWrites: true };
  }
  check(job.action === 'transfer:identity', 'Unknown transfer identity phase');
  const group = await localGroup(job, Zotero, 'keep'), binding = identity.capture(scope);
  check(binding.owner.kind === 'group' && binding.owner.id === String(group.groupID) && binding.owner.id !== String(group.libraryID), 'Group export confused server and local identity');
  group.name += ' renamed'; await group.saveTx(); binding.assertCurrent();
  group.editable = false; await group.saveTx(); binding.assertCurrent();
  await rejects(() => production.gateway.assertWritable(scope, []), 'permission');
  group.editable = true; await group.saveTx(); binding.assertCurrent();
  await group.eraseTx(); await rejects(() => Promise.resolve(binding.assertCurrent()), 'conflict');
  const replacement = await localGroup(job, Zotero, 'keep');
  await rejects(() => Promise.resolve(binding.assertCurrent()), 'conflict');
  identity.capture(scope).assertCurrent();
  const recreated = identity.read(scope);
  check(replacement.libraryID !== group.libraryID && recreated.kind === 'group' && recreated.id === String(groupIDs.keep), 'Recreated group did not preserve portable owner with a different native library');
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Identity inspection initialized unrelated authority');
  return { owner, group: identity.read(scope), actualNativeOwner: true, localAndServerIDsSeparate: true,
    detachedOwners: true, renameAndPermissionDoNotChangeIdentity: true, removedAndRecreatedBindingRejected: true, noAuthorityWrites: true };
}
