/** Genuine first-account sync of production graph notes without reading authentication files. */
import { present } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { resources } from './reconciliation-fixtures.sys.mts';
import { check } from './ui-helpers.sys.mts';
import { book, ref, applyOne, commits } from './rules-fixtures.sys.mts';

/** Create production authority before sign-in or verify it after the user completes real native sign-in/sync. @param {object} job Explicit seed/verify phase and prior saved state. @param {object} api Actual platform. @param {object} production Packaged gateway/evaluator. @returns {Promise<object>} Non-secret identity/ownership evidence. */
export async function reconciliationIdentity(job: ControllerJob, api: NativeAPI, production: Awaited<ReturnType<typeof resources>>) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships!.application;
  if (job.action === 'reconcile:identity-seed') {
    check(!Zotero.Users.getCurrentUserID(), 'Identity seed requires a genuinely anonymous profile');
    const a = await book(Zotero, `${job.marker} before first login source`), b = await book(Zotero, `${job.marker} before first login target`);
    await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(b), type: 'referencing', metadata: { note: 'Before first login Café 你好' } }));
    await applyOne(api, await app.manageRules({ library: 'self', kind: 'create', rule: { id: 'identity-inverse', enabled: true,
      rootType: 'referencing', inputType: 'referencing', outputType: 'referenced-by', transform: 'reverse', conditions: [],
      mapping: { note: { kind: 'root', field: 'note' } } } }));
    const before = await app.read('self');
    check((await app.listRelationships(ref(a), 'both', null, { offset: 0, limit: 25 })).total === 2, 'Anonymous production graph has no exact inverse pair');
    return { a: a.key, b: b.key, before, count: await commits(api), localURI: Zotero.URI.getItemURI(a), beforeUserID: null };
  }
  check(job.action === 'reconcile:identity-verify', 'Unknown identity phase');
  const userID = Number(Zotero.Users.getCurrentUserID());
  check(Number.isSafeInteger(userID) && userID > 0, 'Complete native first-account sign-in before verification');
  const a = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.a));
  const b = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.b));
  check(!!a && !!b && a.synced && b.synced && a.version > 0 && b.version > 0, 'Native references have not completed their first real server sync');
  check(Zotero.URI.getItemURI(a) !== job.localURI, 'Native first-login URI migration did not occur');
  app.invalidateAll();
  check(JSON.stringify(await app.read('self')) === JSON.stringify(job.before), 'First-account sync changed graph head, metadata, rules or original ownership');
  const observed = await production.gateway.resolve(ref(a));
  check(observed.status === 'active' && observed.original.key === job.a && observed.resolved.key === job.a, 'Native identity migration reattached a stored key');
  check((await app.listRelationships(ref(a), 'both', null, { offset: 0, limit: 25 })).total === 2, 'First-account sync lost the production inverse pair');
  for (const item of await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true, false)) {
    if (!item.isNote()) continue;
    await item.loadDataType('note');
    if (item.getNote().includes('Reference Relationships data')) check(item.synced && item.version > 0, 'Production authority note was not synchronized');
  }
  check(await commits(api) === job.count, 'Identity verification published an unnecessary repair generation');
  return { firstAccountSync: true, userID, originalKeysPreserved: true, productionAuthoritySynced: true,
    inverseAndMetadataPreserved: true, noRepairWrites: true };
}
