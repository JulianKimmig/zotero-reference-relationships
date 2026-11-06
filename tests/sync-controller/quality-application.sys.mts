/** Native quality workloads measure complete projection, indexed selection, actual UI, reviewed publication and restart without source mocks. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import { resources, setEnabled } from './reconciliation-fixtures.sys.mts';
import { measureNative } from './quality-measure.sys.mts';
import { ref } from './rules-fixtures.sys.mts';
import { check, selectPane } from './ui-helpers.sys.mts';
import { present, readyState } from './evidence.sys.mts';

/** Create actual bibliographic endpoints in one native transaction using item.save, preserving real notifier/cache ownership. @param {object} api Native host. @param {number} count Number of unique actual items. @returns {Promise<object[]>} Exact saved regular references. */
async function nativeBooks(api: NativeAPI, count: number): Promise<TestItem[]> {
  const books: TestItem[] = [];
  await api.Zotero.DB.executeTransaction(async () => {
    for (let index = 0; index < count; index++) {
      const book = new api.Zotero.Item('book'); book.libraryID = api.Zotero.Libraries.userLibraryID;
      book.setField('title', `${index}: Native quality Café 你好 ${'Long bibliographic title '.repeat(8)}`);
      await book.save(); books.push(book);
    }
  });
  return books;
}

/** Measure one real graph shape with complete stored authority, real endpoint projection and bounded visible pages. @param {object} job Exactly one workload and immutable product XPI. @param {object} api Actual unsigned-in host capabilities. @returns {Promise<object>} Timing distributions and semantic/indexing/persistence evidence. */
export async function qualityApplication(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils, DOMParser, crypto, TextEncoder } = api;
  check(!Zotero.Users.getCurrentUserID() && job.qualityWorkloads?.length === 1, 'Native application quality requires one workload in a fresh unsigned-in profile');
  const { shape, graph: original } = job.qualityWorkloads[0];
  check(shape !== 'over-limit' && [10, 100, 1000].includes(original.assertions.length), 'Publication timing requires a complete 10/100/1000-original workload');
  const production = await resources(job, api); let app = present(Zotero.ReferenceRelationships).application;
  check((await app.read('self')).state === 'uninitialized', 'Application measurement store must be fresh');
  const { createRepositoryFactory } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway: production.gateway });
  const books = await nativeBooks(api, original.assertions.length + 1), graph = structuredClone(original);
  graph.types.find(type => type.id === 'referencing')!.fields = [{ id: 'note', kind: 'string', label: 'Note', required: false, options: [] }];
  graph.assertions.forEach((root, index) => { root.source = ref(books[index + 1]); root.target = ref(books[0]); });
  const head = await factory.repositoryFor('self', null).compareAndCommit(graph, null); app.invalidateAll();
  const state = readyState(await app.read('self')); check(state.head === head, 'Native workload head changed');
  const anchor = ref(books[0]), expectedTotal = graph.assertions.length * (shape === 'sparse' ? 1 : 2);
  const coldProjection = await measureNative(api, async () => {
    app.invalidateAll();
    const page = await app.listRelationships(anchor, 'both', null, { offset: 0, limit: 25 });
    check(page.total === expectedTotal && page.relationships.length === Math.min(expectedTotal, 25), 'Cold projected page lost relationships or ignored its bound');
  }, 3);
  let fullEnumerations = 0, index = 0;
  const getAll = Zotero.Items.getAll;
  // Instrument only the actual external item-I/O boundary; every invocation delegates to its original native method.
  Zotero.Items.getAll = function(libraryID: number, topLevel?: boolean, deleted?: boolean) {
    if (libraryID === Zotero.Libraries.userLibraryID) fullEnumerations++;
    return getAll.call(this, libraryID, topLevel, deleted);
  };
  let warmSelection;
  try {
    warmSelection = await measureNative(api, async () => {
      const page = await app.listRelationships(ref(books[++index]), 'both', null, { offset: 0, limit: 25 });
      check(page.total === (shape === 'sparse' ? 1 : 2), 'Indexed leaf selection returned another reference');
    });
  } finally { Zotero.Items.getAll = getAll; }
  check(fullEnumerations === 0, 'Warm selection enumerates the entire native library');
  index = 0;
  const nativeSelection = await measureNative(api, async () => {
    const pane = await selectPane(Zotero, Zotero.getMainWindow(), books[++index]);
    check(pane.querySelectorAll('[data-rr-relation]').length === (shape === 'sparse' ? 1 : 2), 'Native relationship page has missing or extra edges');
  }, 3);
  const draft = await app.draftUpdate(graph.assertions[0].id, { source: graph.assertions[0].source,
    target: graph.assertions[0].target, type: graph.assertions[0].type, metadata: { note: 'Measured real metadata mutation Café 你好' } }, 'self');
  const preview = await measureNative(api, async () => {
    const review = await app.preview(draft.command, draft.expectedRevision);
    check(review.changeSet.assertions.updated.length === 1 && review.projection.after.state === 'ready', 'Measured preview did not retain exactly one metadata edit');
  }, 3);
  const review = await app.preview(draft.command, draft.expectedRevision);
  const publication = await measureNative(api, async () => {
    const result = await app.applyReviewed(review);
    check(result.revision !== head, 'Actual reviewed mutation did not publish');
  }, 1);
  const after = readyState(await app.read('self'));
  const startupRepair = await measureNative(api, async () => {
    await setEnabled(Zotero, production.addon, false); await setEnabled(Zotero, production.addon, true);
    const previous = app; app = present(Zotero.ReferenceRelationships).application;
    check(app !== previous, 'Re-enable retained a stopped application generation');
    const state = readyState(await app.read('self')), projection = await app.reconcile('self', { offset: 0, limit: 25 });
    check(state.head === after.head && projection.state === 'ready' && projection.total === expectedTotal, 'Startup repair lost authority or published a replacement');
  }, 1);
  factory.clear();
  return { shape, assertions: graph.assertions.length, rules: graph.rules.length, nativeReferences: books.length,
    fullEnumerations, actualNativeIOForwarded: true, boundedPages: true, savedHead: after.head,
    coldProjection, warmSelection, nativeSelection, preview, publication, startupRepair };
}
