/** Native merge/Undo/Redo and erasure checks for packaged endpoint resolution and pure projection. */
import { found, readyState, present, itemReference } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import { check } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { book, ref, commits } from './rules-fixtures.sys.mts';
import { resources, projected, preserved, fixtures, setEnabled } from './reconciliation-fixtures.sys.mts';
import { reconciliationIdentity } from './reconciliation-identity.sys.mts';

/** Persist deliberately malformed native aliases only in disposable adversarial fixtures. Production code never writes merge predicates. @param {object} Zotero Actual native API. @param {object} subject Real fixture item. @param {string} uri Real original item URI. @returns {Promise<void>} */
async function alias(Zotero: TestPlatform, subject: TestItem, uri: string) {
  subject.addRelation(Zotero.Relations.replacedItemPredicate, uri); await subject.saveTx();
}

/** Run one real native lifecycle foundation phase; application/UI integration has separate remaining gates. @param {object} job Phase/artifact/saved keys. @param {object} api Actual platform. @returns {Promise<object>} Verified module behavior. */
export async function reconciliation(job: ControllerJob, api: NativeAPI) {
  if (job.action.startsWith('reconcile:libraries-')) {
    if (job.action === 'reconcile:libraries-pending') {
      const { reconciliationLibraryPending } = await import('./reconciliation-library-pending.sys.mts');
      return reconciliationLibraryPending(job, api);
    }
    if (job.action === 'reconcile:libraries-copy') {
      const { reconciliationLibraryCopy } = await import('./reconciliation-library-copy.sys.mts');
      return reconciliationLibraryCopy(job, api);
    }
    const { reconciliationLibraryRemoval, reconciliationLibraryDisabled } = await import('./reconciliation-library-removal.sys.mts');
    if (job.action === 'reconcile:libraries-remove') return reconciliationLibraryRemoval(job, api);
    if (job.action === 'reconcile:libraries-disabled') return reconciliationLibraryDisabled(job, api);
    check(job.action === 'reconcile:libraries-restart', 'Unknown library lifecycle phase');
    await resources(job, api);
    const { librariesPreserved } = await import('./library-fixtures.sys.mts');
    await librariesPreserved(api, job); return { restarted: true, unrelatedAuthorityPreserved: true };
  }
  if (job.action === 'reconcile:bulk-edges') {
    const { reconciliationBulkEdges } = await import('./reconciliation-bulk-edges.sys.mts');
    return reconciliationBulkEdges(job, api);
  }
  if (job.action === 'reconcile:bulk-ui') {
    const { reconciliationBulkUI } = await import('./reconciliation-bulk-ui.sys.mts');
    return reconciliationBulkUI(job, api);
  }
  if (job.action.startsWith('reconcile:alias-ui')) {
    const { reconciliationAliasUI } = await import('./reconciliation-alias-ui.sys.mts');
    return reconciliationAliasUI(job, api);
  }
  if (job.action.startsWith('reconcile:repair-ui')) {
    const { reconciliationRepairUI } = await import('./reconciliation-repair-ui.sys.mts');
    return reconciliationRepairUI(job, api);
  }
  if (job.action === 'reconcile:ui-binding') {
    const { reconciliationUI } = await import('./reconciliation-ui.sys.mts');
    return reconciliationUI(job, api);
  }
  if (job.action.startsWith('reconcile:application')) {
    const { applicationReconciliation } = await import('./application-reconciliation.sys.mts');
    return applicationReconciliation(job, api);
  }
  const { Zotero } = api, production = await resources(job, api);
  check(typeof production.gateway.resolve === 'function', 'Production native endpoint resolver is unavailable');
  if (job.action === 'reconcile:identity-inspect-account') {
    await api.synchronize();
    const state = await Zotero.ReferenceRelationships!.application.read('self');
    return { userID: Number(Zotero.Users.getCurrentUserID()), personalState: state.state };
  }
  if (job.action.startsWith('reconcile:identity-')) return reconciliationIdentity(job, api, production);
  if (job.action === 'reconcile:readonly') {
    await api.synchronize();
    const group = Zotero.Groups.get(job.groups.restricted); check(!found(group).editable, 'Expected actual restricted group');
    const item = (await Zotero.Items.getAll(found(group).libraryID, true, false)).find(item => item.isRegularItem() && !item.deleted);
    check(!!item, 'Restricted group has no actual regular fixture');
    const result = await production.gateway.resolve({ library: `group:${job.groups.restricted}`, key: item.key });
    check(result.status === 'active' && result.resolved.key === item.key && !result.editable, 'Read-only native resolution grants permission');
    return { actualReadOnlyGroup: true, resolutionDoesNotGrantWrite: true };
  }
  if (job.action === 'reconcile:restart') {
    const before = await Zotero.ReferenceRelationships!.application.read('self');
    check(JSON.stringify(before) === JSON.stringify(job.before), 'Restart changed saved authority or head');
    const result = await projected(production, readyState(before).snapshot);
    check(result.relationships.length === 2 && result.diagnostics.some(value => value.details.status === 'missing'), 'Restart lost unresolved endpoint or surviving closure');
    const target = await production.gateway.resolve({ library: 'self', key: present(job.c) });
    check(target.status === 'active' && target.resolved.key === job.d, 'Restart lost native target merge resolution');
    await preserved(api, before, present(job.count));
    return { restarted: true, nativeAliasRetained: true, erasedEndpointUnresolved: true, originalAuthorityRetained: true };
  }
  check(job.action === 'reconcile:resolve', 'Unknown lifecycle resolver phase');
  const { a, b, c, d, before, count } = await fixtures(job, api);
  const { mergeItems } = api.ChromeUtils.importESModule('chrome://zotero/content/mergeItems.mjs');
  const original = await projected(production, readyState(before).snapshot); check(original.relationships.length === 5, 'Initial native fixture closure differs');
  await mergeItems(a, [b]);
  const resolved = await production.gateway.resolve(ref(b));
  check(resolved.original.key === b.key && present(resolved.resolved).key === a.key && resolved.status === 'active' && resolved.editable,
    'Merged source did not resolve to its actual same-library survivor');
  let result = await projected(production, readyState(before).snapshot);
  check(result.relationships.length === 2 && result.diagnostics.some(value => value.code === 'self-edge'), 'Merge did not hide self-edge');
  check(present(result.relationships.find(edge => edge.type === 'referencing')).assertions.length === 2
    && present(result.relationships.find(edge => edge.type === 'referenced-by')).supports.length === 2, 'Merge lost distinct original contributors');
  await preserved(api, before, count);
  await Zotero.UndoHistory.undo();
  check(present((await production.gateway.resolve(ref(b))).resolved).key === b.key, 'Undo did not prefer restored original');
  check((await projected(production, readyState(before).snapshot)).relationships.length === 5, 'Undo did not restore independent roots');
  await Zotero.UndoHistory.redo();
  check((await projected(production, readyState(before).snapshot)).relationships.length === 2, 'Redo did not restore merge projection');
  await Zotero.UndoHistory.undo();
  await setEnabled(Zotero, production.addon, false);
  await mergeItems(a, [b]); await Zotero.UndoHistory.undo();
  await setEnabled(Zotero, production.addon, true);
  await preserved(api, before, count);
  check((await projected(production, readyState(before).snapshot)).relationships.length === 5, 'Disabled-plugin merge/Undo lost original ownership');
  await mergeItems(d, [c]);
  check(present((await production.gateway.resolve(ref(c))).resolved).key === d.key, 'Merged target did not resolve to survivor');
  await Zotero.UndoHistory.undo(); check(present((await production.gateway.resolve(ref(c))).resolved).key === c.key, 'Target Undo lost original');
  await Zotero.UndoHistory.redo();
  d.deleted = true; await d.saveTx();
  result = await projected(production, readyState(before).snapshot);
  check(result.relationships.length === 1 && result.diagnostics.some(value => value.details.status === 'trashed'
    && itemReference(value.details.resolved).key === d.key), 'Trash did not suppress inactive rooted traversal');
  d.deleted = false; await d.saveTx();
  check((await projected(production, readyState(before).snapshot)).relationships.length === 5, 'Restore did not reactivate roots');
  const duplicate = a.clone(); duplicate.setField('title', `${job.marker} duplicate`); await duplicate.saveTx();
  check(!(await projected(production, readyState(before).snapshot)).relationships.some(edge => edge.source.key === duplicate.key || edge.target.key === duplicate.key), 'Duplicate inherited original graph ownership');
  await setEnabled(Zotero, production.addon, false); await b.eraseTx(); await setEnabled(Zotero, production.addon, true);
  result = await projected(production, readyState(before).snapshot);
  check(result.relationships.length === 2 && result.diagnostics.some(value => value.details.status === 'missing'
    && itemReference(value.details.ref).key === b.key), 'Permanent erase while disabled lost unresolved ownership');
  await preserved(api, before, count);
  const unsupported = new Zotero.Item('note'); unsupported.libraryID = a.libraryID; unsupported.setNote('<p>Unsupported endpoint</p>'); await unsupported.saveTx();
  check((await production.gateway.resolve(ref(unsupported))).status === 'unsupported', 'Nonbibliographic endpoint was accepted');
  const gone = await book(Zotero, `${job.marker} ambiguous original`), goneRef = ref(gone), uri = Zotero.URI.getItemURI(gone);
  await gone.eraseTx();
  const first = await book(Zotero, `${job.marker} ambiguous survivor one`), second = await book(Zotero, `${job.marker} ambiguous survivor two`);
  await alias(Zotero, first, uri); await alias(Zotero, second, uri);
  const ambiguous = await production.gateway.resolve(goneRef);
  check(ambiguous.status === 'ambiguous' && ambiguous.resolved === null && !ambiguous.editable, 'Ambiguous native aliases silently chose a survivor');
  check((await production.gateway.inspect(goneRef)).status === 'ambiguous', 'Read-only inspection lost ambiguity');
  const cycleA = await book(Zotero, `${job.marker} cyclic original`), cycleB = await book(Zotero, `${job.marker} cyclic alias`);
  cycleA.deleted = true; cycleB.deleted = true; await cycleA.saveTx(); await cycleB.saveTx();
  await alias(Zotero, cycleA, Zotero.URI.getItemURI(cycleB)); await alias(Zotero, cycleB, Zotero.URI.getItemURI(cycleA));
  await rejects(() => production.gateway.resolve(ref(cycleA)), 'endpoint');
  check((await production.gateway.inspect(ref(cycleA))).status === 'cyclic', 'Read-only inspection lost the native cycle');
  const chain: TestItem[] = [];
  for (let index = 0; index < 66; index++) {
    const item = await book(Zotero, `${job.marker} adversarial alias chain ${index}`);
    if (index < 65) { item.deleted = true; await item.saveTx(); }
    chain.push(item);
  }
  for (let index = 1; index < chain.length; index++) await alias(Zotero, chain[index], Zotero.URI.getItemURI(chain[index - 1]));
  await rejects(() => production.gateway.resolve(ref(chain[0])), 'limit');
  check((await production.gateway.inspect(ref(chain[0]))).status === 'alias-limit', 'Read-only inspection hid the alias work bound');
  await rejects(() => production.gateway.resolve({ library: 'group:99999999999999', key: a.key }), 'endpoint');
  await preserved(api, before, count);
  return { before, count, a: a.key, b: b.key, c: c.key, d: d.key, nativeMergeUndoRedo: true,
    collisionsRetainRoots: true, hiddenSelfEdge: true, trashRestore: true, erasedWhileDisabled: true,
    disabledMergeUndo: true, duplicateNoInheritance: true, ambiguousAndCycleSafe: true, aliasWorkBound: true,
    productionApplicationProjectionIntegrated: false };
}
