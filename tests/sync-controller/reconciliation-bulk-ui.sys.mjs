/** Multiple unresolved originals need one explicit atomic removal review, without losing unrelated roots. */
import { check, until, selectPane, click } from './ui-helpers.sys.mjs';
import { rejects } from './ui-permissions.sys.mjs';
import { resources, preserved } from './reconciliation-fixtures.sys.mjs';
import { book, ref, applyOne, commits } from './rules-fixtures.sys.mjs';

/** Select only requested original IDs through actual repair-panel checkboxes. @param {object} api Native resources. @param {Element} pane Actual pane. @param {string[]} ids Explicit selection. @returns {Promise<void>} */
async function selectOriginals(api, pane, ids) {
  click(pane, 'manage-repairs');
  for (const id of ids) {
    const row = await until(api.Zotero, () => [...pane.querySelectorAll('[data-rr-repair-root]')]
      .find(row => row.dataset.rrRepairRoot === id), 'bulk removal original');
    const checkbox = row.querySelector('[data-rr-select-original]');
    check(checkbox && !checkbox.disabled, 'Original removal selection is unavailable'); checkbox.click();
  }
  click(pane, 'remove-selected');
  await until(api.Zotero, () => pane.querySelector('[data-rr-bulk-removal]'), 'selected-original removal editor');
}

/** Verify failed partial repair, canceled complete repair, and exactly one confirmed removal generation. @param {object} job Artifact/marker. @param {object} api Actual native platform. @returns {Promise<object>} Atomic original removal evidence. */
export async function reconciliationBulkUI(job, api) {
  const { Zotero } = api; await resources(job, api);
  const app = Zotero.ReferenceRelationships.application, main = Zotero.getMainWindow(), sources = [];
  const target = await book(Zotero, `${job.marker} batch target`), good = await book(Zotero, `${job.marker} unrelated batch survivor`);
  for (const title of ['first unresolved', 'second unresolved']) sources.push(await book(Zotero, `${job.marker} ${title}`));
  for (const source of [...sources, good]) await applyOne(api, await app.draftCreate({ source: ref(source), target: ref(target), type: 'referencing', metadata: { note: `Original ${source.key} Café 你好` } }));
  const before = await app.read('self'), count = await commits(api);
  const ids = before.snapshot.assertions.filter(root => sources.some(source => source.key === root.source.key)).map(root => root.id);
  const aliases = [];
  for (const source of sources) {
    const uri = Zotero.URI.getItemURI(source); await source.eraseTx();
    for (let index = 0; index < 2; index++) {
      const alias = await book(Zotero, `${job.marker} ${source.key} candidate ${index}`);
      alias.addRelation(Zotero.Relations.replacedItemPredicate, uri); await alias.saveTx(); aliases.push(alias);
    }
  }
  const nativeBefore = JSON.stringify(aliases.map(item => item.getRelations()));
  await rejects(() => app.draftRemoveMany([], 'self'), 'validation');
  await rejects(() => app.draftRemoveMany([ids[0], ids[0]], 'self'), 'validation');
  await rejects(() => app.draftRemoveMany(['unknown-original'], 'self'), 'validation');
  await preserved(api, before, count);
  let pane = await selectPane(Zotero, main, good);
  await selectOriginals(api, pane, [ids[0]]);
  await until(Zotero, () => pane.querySelector('[data-rr-bulk-removal] [role="alert"]')?.textContent, 'partial unresolved removal rejected');
  check(pane.querySelector('[data-rr-action="save-removals"]').disabled, 'Partial unresolved after-state enabled Save');
  click(pane, 'cancel-removals'); await until(Zotero, () => !pane.querySelector('[data-rr-bulk-removal]') && pane.dataset.rrState !== 'loading', 'partial removal canceled');
  await preserved(api, before, count);
  await selectOriginals(api, pane, ids);
  await until(Zotero, () => pane.querySelector('[data-rr-action="save-removals"]')?.disabled === false, 'complete selected-original removal review');
  const review = pane.querySelector('[data-rr-review-projection]');
  check(review?.dataset.rrBeforeState === 'endpoint-conflict' && Number(review.dataset.rrAfterCount) === before.snapshot.assertions.length - ids.length,
    'Bulk repair hid unavailable before state or complete valid after effects');
  for (const source of sources) check(review.textContent.includes(source.key), 'Bulk before review hid a selected original key');
  await preserved(api, before, count);
  click(pane, 'cancel-removals'); await until(Zotero, () => !pane.querySelector('[data-rr-bulk-removal]') && pane.dataset.rrState !== 'loading', 'complete batch removal canceled');
  await preserved(api, before, count);
  await selectOriginals(api, pane, ids);
  await until(Zotero, () => pane.querySelector('[data-rr-action="save-removals"]')?.disabled === false, 'confirmed bulk removal review');
  click(pane, 'save-removals'); await until(Zotero, () => !pane.querySelector('[data-rr-bulk-removal]') && pane.dataset.rrState !== 'loading', 'bulk removal saved');
  const after = await app.read('self');
  check(JSON.stringify(after.snapshot) === JSON.stringify({ ...before.snapshot, assertions: before.snapshot.assertions.filter(root => !ids.includes(root.id)) }), 'Bulk removal changed unselected authority');
  check(await commits(api) === count + 1 && (await app.reconcile('self', { offset: 0, limit: 25 })).state === 'ready', 'Bulk removal did not publish exactly one complete valid generation');
  check(JSON.stringify(aliases.map(item => item.getRelations())) === nativeBefore, 'Bulk graph removal changed host alias records');
  pane = await selectPane(Zotero, main, good); check(pane.dataset.rrState === 'ready', 'Unrelated surviving view did not recover');
  return { before: after, count: count + 1, partialAfterRejected: true, previewCancelNoWrites: true,
    selectedOriginalsRemovedAtomically: true, unrelatedAuthorityAndNativeAliasesPreserved: true };
}
