/** Real paging, ready-before coalesced roots and delayed native changes exercise atomic removal edge cases. */
import type { TestItem } from './platform-contracts.mts';
import type { Assertion } from '../../src/domain/contracts.mts';
import { textValue, readyState, present, found } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check, until, selectPane, click } from './ui-helpers.sys.mts';
import { resources, preserved } from './reconciliation-fixtures.sys.mts';
import { book, ref, commits } from './rules-fixtures.sys.mts';

/** Select originals on separate actual pages and open their complete removal review. @param {object} api Native resources. @param {Element} pane Coalesced relationship pane. @returns {Promise<string[]>} Exact selected identities. */
async function acrossPages(api: NativeAPI, pane: HTMLElement) {
  const row = [...pane.querySelectorAll<HTMLElement>('[data-rr-relation]')].find(row => JSON.parse(present(row.dataset.rrRelation))[2] === 'similar');
  check(!!row, 'Coalesced relation is absent'); click(row, 'choose-contribution');
  await until(api.Zotero, () => pane.querySelectorAll<HTMLElement>('[data-rr-repair-root]').length === 25, 'first bounded original page');
  const first = pane.querySelector<HTMLInputElement>('[data-rr-select-original]'); present(first).click(); const ids = [present(first).dataset.rrSelectOriginal];
  click(pane, 'roots-next'); await until(api.Zotero, () => pane.querySelectorAll<HTMLElement>('[data-rr-repair-root]').length === 1, 'last original page');
  const last = pane.querySelector<HTMLInputElement>('[data-rr-select-original]'); present(last).click(); ids.push(present(last).dataset.rrSelectOriginal);
  click(pane, 'roots-previous'); await until(api.Zotero, () => pane.querySelectorAll<HTMLElement>('[data-rr-repair-root]').length === 25, 'original page restored');
  check(present(pane.querySelector<HTMLInputElement>(`[data-rr-select-original="${ids[0]}"]`)).checked, 'Cross-page selection lost the first original');
  click(pane, 'remove-selected');
  await until(api.Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save-removals"]')?.disabled === false, 'ready-before selected removal preview');
  check(pane.querySelectorAll<HTMLElement>('[data-rr-removed-original]').length === 2 && pane.querySelector<HTMLElement>('[data-rr-updated]')?.dataset.rrUpdated === '1',
    'Ready review omitted selected originals or the surviving coalesced relationship update');
  return ids;
}

/** Verify ready-before multi-root pages, cancellation, native stale-review rejection and surviving contributors. @param {object} job Marker/artifact. @param {object} api Native platform. @returns {Promise<object>} Scoped edge-case evidence. */
export async function reconciliationBulkEdges(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api; await resources(job, api);
  const app = Zotero.ReferenceRelationships!.application, sources: TestItem[] = [], roots: Assertion[] = [];
  const target = await book(Zotero, `${job.marker} paged target`);
  for (let index = 0; index < 26; index++) {
    const source = await book(Zotero, `${job.marker} paged original ${index}`); sources.push(source);
    const draft = await app.draftCreate({ source: ref(source), target: ref(target), type: 'similar', metadata: { note: 'Shared pages Café 你好' } });
    roots.push(present(draft.command.snapshot.assertions.at(-1)));
  }
  const initial = await app.read('self');
  await app.applyFromEvent({ kind: 'replace', snapshot: { ...readyState(initial).snapshot, assertions: [...readyState(initial).snapshot.assertions, ...roots] } }, readyState(initial).head);
  const { mergeItems } = api.ChromeUtils.importESModule('chrome://zotero/content/mergeItems.mjs');
  await mergeItems(sources[0], sources.slice(1));
  const before = await app.read('self'), count = await commits(api);
  const pane = await selectPane(Zotero, Zotero.getMainWindow(), sources[0]);
  const canceled = await acrossPages(api, pane); await preserved(api, before, count);
  for (const id of canceled) {
    const original = readyState(before).snapshot.assertions.find(root => root.id === id);
    const card = [...pane.querySelectorAll<HTMLElement>('[data-rr-removed-original]')].find(card => card.dataset.rrRemovedOriginal === id);
    check(present(card).textContent.includes(present(original).source.key) && present(card).textContent.includes(textValue(present(original).metadata.note)), 'Ready-before removal hid physical original ownership or values');
  }
  click(pane, 'cancel-removals'); await until(Zotero, () => !pane.querySelector<HTMLElement>('[data-rr-bulk-removal]') && pane.dataset.rrState !== 'loading', 'ready-before batch canceled');
  await preserved(api, before, count);
  const selected = await acrossPages(api, pane);
  const notifications: { event: string; type: string; ids: number[] }[] = [];
  const observer = Zotero.Notifier.registerObserver({
    /** Record genuine host notifications during the delayed-event fixture. @param {string} event Event name. @param {string} type Object kind. @param {number[]} ids Actual item IDs. @returns {void} */
    notify(event: string, type: string, ids: number[]) { notifications.push({ event, type, ids }); },
  }, ['item', 'group'], 'rr-bulk-native-change-diagnostic');
  const predicate = Zotero.Relations.replacedItemPredicate, uri = Zotero.URI.getItemURI(sources[1]);
  try {
    // Native undelete saves its merge survivor separately and emits a notification even with skipNotifier.
    // Change the actual survivor alias directly so this fixture really exercises delayed notifications.
    sources[0].removeRelation(predicate, uri); await sources[0].saveTx({ skipNotifier: true });
    check(!present(pane.querySelector<HTMLButtonElement>('[data-rr-action="save-removals"]')).disabled,
      `Delayed native fixture invalidated UI before the stale-save check: ${JSON.stringify(notifications)}`);
  } finally { Zotero.Notifier.unregisterObserver(observer); }
  click(pane, 'save-removals');
  await until(Zotero, () => pane.querySelector<HTMLElement>('[data-rr-bulk-removal] [role="alert"]')?.textContent, 'bulk native-stale Save result');
  check(present(pane.querySelector<HTMLElement>('[data-rr-bulk-removal] [role="alert"]')).textContent.includes('Native endpoints changed'), 'Bulk Save replaced its issued native review');
  await preserved(api, before, count);
  sources[0].addRelation(predicate, uri); await sources[0].saveTx({ skipNotifier: true });
  click(pane, 'preview-removals'); await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save-removals"]')?.disabled === false, 'fresh bulk review after native restore');
  click(pane, 'save-removals'); await until(Zotero, () => !pane.querySelector<HTMLElement>('[data-rr-bulk-removal]') && pane.dataset.rrState !== 'loading', 'ready-before selected removals saved');
  const after = await app.read('self');
  check(JSON.stringify(readyState(after).snapshot) === JSON.stringify({ ...readyState(before).snapshot, assertions: readyState(before).snapshot.assertions.filter(root => !selected.includes(root.id)) }), 'Paged removal changed unselected authority');
  const page = await app.listRelationships(ref(sources[0]), 'both', 'similar', { offset: 0, limit: 25 });
  check(page.total === 1 && page.relationships[0].assertions.length === 24 && await commits(api) === count + 1,
    'Removing selected coalesced originals removed surviving contributors or published multiple generations');
  return { before: after, count: count + 1, crossPageSelection: true, readyBeforeReview: true, cancelNoWrites: true,
    nativeStaleSaveRejected: true, twentyFourContributorsSurvive: true };
}
