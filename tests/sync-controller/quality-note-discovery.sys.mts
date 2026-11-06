/** Native feasibility and set-parity checks for note-only authority discovery before replacing full-library enumeration. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { localGroup, libraryBook, linked } from './library-fixtures.sys.mts';
import { present, found } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Independently typed documented native query boundary; this probe validates the actual installed capability. */
type SearchPlatform = NativeAPI['Zotero'] & { Search: new () => {
  libraryID: number; addCondition(condition: string, operator: string, value?: string): number; search(): Promise<number[]>;
} };

/** Save one real note in the stated library with explicit standalone/child/deleted status. @param api Native platform. @param libraryID Native owner. @param html Literal fixture HTML. @param parent Parent book or explicit standalone null. @param deleted Native trash state. @returns Saved note. */
async function fixtureNote(api: NativeAPI, libraryID: number, html: string, parent: TestItem | null, deleted: boolean): Promise<TestItem> {
  const note = new api.Zotero.Item('note'); note.libraryID = libraryID; note.parentID = parent ? parent.id : false;
  note.setNote(html); await note.saveTx();
  if (deleted) { note.deleted = true; await note.saveTx(); }
  return note;
}

/** Prove native note/noChildren query parity with the existing candidate universe in personal, writable/readonly local group and empty libraries. @param job Fresh unsigned-in XPI-bound job; local groups never represent server memberships. @param api Actual native host. @returns Exact candidate sets, exclusions and unchanged relationship authority; no saved search or server operation is created. */
export async function qualityNoteDiscovery(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, native = Zotero as SearchPlatform;
  check(!Zotero.Users.getCurrentUserID(), 'Note-query feasibility requires a fresh unsigned-in profile');
  check(typeof native.Search === 'function', 'Native Zotero.Search capability unavailable');
  const production = await resources(job, api), app = present(Zotero.ReferenceRelationships).application;
  check((await app.read('self')).state === 'uninitialized' && (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true, true)).length === 0,
    'Note-query feasibility must start with empty native authority/items');
  const writable = await localGroup(job, Zotero, 'keep'), readonly = await localGroup(job, Zotero, 'copy'), empty = await localGroup(job, Zotero, 'removed');
  const libraries = [found(Zotero.Libraries.get(Zotero.Libraries.userLibraryID)), writable, readonly];
  const states: { scope: string; value: Awaited<ReturnType<typeof app.read>> }[] = [];
  const fixtures: { libraryID: number; ordinary: string; child: string; deleted: string; beforeOrdinary: string }[] = [];
  for (const library of libraries) {
    const source = await libraryBook(Zotero, library.libraryID, `${job.marker} source`), target = await libraryBook(Zotero, library.libraryID, `${job.marker} target`);
    const state = await linked(app, production.gateway, source, target, 'Note-query authority Café 你好');
    const ordinary = await fixtureNote(api, library.libraryID, '<p>Reference Relationships data mentioned by an ordinary note</p>', null, false);
    const marked = '<h1>Reference Relationships data</h1><pre>{"format":"reference-relationships/commit"}</pre>';
    const child = await fixtureNote(api, library.libraryID, marked, source, false), deleted = await fixtureNote(api, library.libraryID, marked, null, true);
    states.push({ scope: production.gateway.scope(library.libraryID), value: state });
    fixtures.push({ libraryID: library.libraryID, ordinary: ordinary.key, child: child.key, deleted: deleted.key, beforeOrdinary: ordinary.getNote() });
  }
  readonly.editable = false; await readonly.saveTx();
  check(!readonly.editable, 'Local readonly library flag was not persisted');
  await present(api.IOUtils).writeUTF8(`${present(job.data)}/quality-note-discovery-fixture.json`, JSON.stringify({ states, fixtures }), { mode: 'create', flush: true });
  const observations = [];
  for (const library of [...libraries, empty]) {
    const all = await Zotero.Items.getAll(library.libraryID, true, false), expected = all.filter(item => item.isNote()).map(item => item.id).sort((a, b) => a - b);
    const search = new native.Search(); search.libraryID = library.libraryID;
    search.addCondition('itemType', 'is', 'note'); search.addCondition('noChildren', 'true');
    const ids = await search.search();
    check(Array.isArray(ids) && ids.every(id => Number.isSafeInteger(id) && id > 0), 'Native search did not return explicit positive item IDs');
    check(JSON.stringify([...ids].sort((a, b) => a - b)) === JSON.stringify(expected), 'Native note-only candidates differ from existing standalone nondeleted notes');
    for (const id of ids) {
      const item = found(await Zotero.Items.getAsync(id));
      check(item.libraryID === library.libraryID && item.isNote() && item.isTopLevelItem() && !item.deleted,
        'Native query crossed a library/type/standalone/trash boundary');
    }
    observations.push({ libraryID: library.libraryID, editable: library.editable, expected, actual: ids,
      totalTopLevelItems: all.length, noteCandidates: ids.length });
  }
  app.invalidateAll();
  for (const state of states) check(JSON.stringify(await app.read(state.scope)) === JSON.stringify(state.value), 'Query feasibility changed or contaminated relationship authority');
  check((await app.read(production.gateway.scope(empty.libraryID))).state === 'uninitialized', 'Empty query library gained authority');
  for (const fixture of fixtures) {
    const item = found(await Zotero.Items.getByLibraryAndKeyAsync(fixture.libraryID, fixture.ordinary)); await item.loadDataType('note');
    check(item.getNote() === fixture.beforeOrdinary, 'Query feasibility changed an ordinary note');
  }
  return { observations, personalAndLocalGroups: true, serverMembershipTest: false, savedSearchCreated: false,
    standaloneAndTrashParity: true, authorityUnchanged: true, ordinaryNotesUnchanged: true, fixtures };
}
