/** Native permission, invalid-endpoint and stale-revision application checks without source mocks. */
import type { ItemRef } from '../../src/domain/contracts.mts';
import { contractFailure, errorMessage, found, present } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import { check, selectPane } from './ui-helpers.sys.mts';

/** Require a real public application failure. @param {Function} action Actual operation. @param {string} code Expected public category. @returns {Promise<void>} */
export async function rejects(action: () => unknown, code: string) {
  let rejected = false;
  try { await action(); }
  catch (error) { check(contractFailure(error).code === code, `Expected ${code}, received ${contractFailure(error).code}: ${errorMessage(error)}`); rejected = true; }
  check(rejected, `Expected ${code} rejection`);
}

/** Create a labeled actual bibliographic item. @param {object} Zotero Native API. @param {number} libraryID Scope. @param {string} title Label. @returns {Promise<object>} Native reference. */
async function book(Zotero: TestPlatform, libraryID: number, title: string) {
  const item = new Zotero.Item('book'); item.libraryID = libraryID; item.setField('title', title); await item.saveTx(); return item;
}

/** Prepare real restricted-group endpoints with account A's actual permission. @param {object} job Explicit test group/marker. @param {object} api Native resources. @returns {Promise<object>} Cross-client keys. */
export async function permissionFixtures(job: ControllerJob, api: NativeAPI) {
  const group = api.Zotero.Groups.get(job.groups.restricted);
  check(found(group).editable, 'Fixture creator must actually own group edit permission');
  const source = await book(api.Zotero, found(group).libraryID, `${job.marker} restricted source`);
  const target = await book(api.Zotero, found(group).libraryID, `${job.marker} restricted target`);
  await api.synchronize();
  return { source: source.key, target: target.key };
}

/** Assert readonly UI and real changed-save rejection in account B's group. @param {object} job Exact fixture keys/groups. @param {object} api Actual platform. @returns {Promise<object>} Permission evidence. */
export async function permissionJourney(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, scope = `group:${job.groups.restricted}` as const, group = Zotero.Groups.get(job.groups.restricted);
  check(!found(group).editable, 'Permission test needs actual read-only B membership');
  const source = await Zotero.Items.getByLibraryAndKeyAsync(found(group).libraryID, present(job.source));
  const root = await selectPane(Zotero, Zotero.getMainWindow(), found(source));
  check(present(root.querySelector<HTMLButtonElement>('[data-rr-action="add"]')).disabled, 'Read-only UI enabled creation');
  const application = Zotero.ReferenceRelationships!.application, before = await application.read(scope);
  const draft = await application.draftCreate({ source: { library: scope, key: present(job.source) },
    target: { library: scope, key: present(job.target) }, type: 'referencing', metadata: { note: 'denied' } });
  await rejects(() => application.preview(draft.command, draft.expectedRevision), 'permission');
  await rejects(() => application.apply(draft.command, draft.expectedRevision), 'permission');
  check(JSON.stringify(await application.read(scope)) === JSON.stringify(before), 'Denied action changed authority');
  return { readOnlyUIDisabled: true, permissionDenied: true, unchanged: true };
}

/** Exercise actual unsupported/self/cross-library endpoints before any first save. @param {object} api Native resources. @param {object} a Source book. @param {object} ordinary Native note. @param {string} groupKey Cross-library regular key. @param {number} groupID Server group. @returns {Promise<object>} Rejection evidence. */
export async function invalidEndpoints(api: NativeAPI, a: TestItem, ordinary: TestItem, groupKey: string, groupID: number) {
  const application = api.Zotero.ReferenceRelationships!.application, before = await application.read('self');
  const source: ItemRef = { library: 'self', key: a.key };
  await rejects(() => application.draftCreate({ source, target: source, type: 'referencing', metadata: {} }), 'validation');
  await rejects(() => application.draftCreate({ source, target: { library: `group:${groupID}`, key: groupKey },
    type: 'referencing', metadata: {} }), 'validation');
  const draft = await application.draftCreate({ source, target: { library: 'self', key: ordinary.key }, type: 'referencing', metadata: {} });
  await rejects(() => application.preview(draft.command, draft.expectedRevision), 'endpoint');
  check(JSON.stringify(await application.read('self')) === JSON.stringify(before), 'Invalid input changed authority');
  return { selfRejected: true, crossLibraryRejected: true, unsupportedRejected: true, unchanged: true };
}
