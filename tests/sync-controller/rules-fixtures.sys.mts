/** Real native items, immutable note counts and reviewed application commands for engine acceptance. */
import { constantMapping, present, readyState } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import type { Draft } from '../../src/application/contracts.mts';
import type { RelationshipApplication } from '../../src/application/service.mts';
import type { Graph, ItemRef, Rule, Assertion } from '../../src/domain/contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import { check, until } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';

/** Install the exact engine XPI and await actual native trees. @param {object} job Artifact. @param {object} api Platform. @returns {Promise<Window>} Real main window. */
export async function install(job: ControllerJob, api: NativeAPI) {
  const { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  check((await AddonManager.installTemporaryAddon(api.Zotero.File.pathToFile(present(job.xpi)))).isActive, 'Engine XPI is inactive');
  const window = api.Zotero.getMainWindow();
  await until(api.Zotero, () => window.ZoteroPane.loaded && window.ZoteroPane.itemsView && window.ZoteroPane.collectionsView, 'engine native trees');
  await Promise.all([window.ZoteroPane.itemsView.waitForLoad(), window.ZoteroPane.collectionsView.waitForLoad()]);
  return window;
}

/** Create an actual bibliographic reference. @param {object} Zotero Platform. @param {string} title Fixture label. @returns {Promise<object>} Native item. */
export async function book(Zotero: TestPlatform, title: string) {
  const item = new Zotero.Item('book'); item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField('title', title); await item.saveTx(); return item;
}

/** Scope one actual item without numeric persistence IDs. @param {object} item Native book. @returns {object} ItemRef. */
export function ref(item: TestItem): ItemRef { return { library: 'self', key: item.key }; }

/** Declare an optional note mapping on the immutable root. @param {string} id Rule. @param {string} root Root type. @param {string} input Traversal type. @param {string} output Output type. @returns {object} Valid reverse rule. */
export function rule(id: string, root: string = 'referencing', input: string = root, output: string = 'referenced-by'): Rule {
  return { id, version: 1, enabled: true, rootType: root, inputType: input, outputType: output,
    transform: 'reverse', conditions: [], mapping: { note: { kind: 'root', field: 'note' } } };
}

/** Count actual saved native complete-generation notes, not inferred edges. @param {object} api Real platform/parser. @returns {Promise<number>} Committed manifest count. */
export async function commits(api: NativeAPI) {
  let count = 0;
  for (const item of await api.Zotero.Items.getAll(api.Zotero.Libraries.userLibraryID, true, false)) {
    if (!item.isNote()) continue;
    await item.loadDataType('note');
    if (!item.getNote().includes('Reference Relationships data')) continue;
    const pre = new api.DOMParser().parseFromString(item.getNote(), 'text/html').querySelector<HTMLElement>('pre');
    if (JSON.parse(present(pre).textContent).format === 'reference-relationships/commit') count++;
  }
  return count;
}

/** Review then apply one complete authority command and require a single generation publication. @param {object} api Native resources. @param {object} draft Public command/revision. @returns {Promise<object>} Commit result. */
export async function applyOne(api: NativeAPI, draft: Draft) {
  const app = api.Zotero.ReferenceRelationships!.application, before = await commits(api);
  const review = await app.preview(draft.command, draft.expectedRevision);
  const result = await app.applyFromEvent(draft.command, draft.expectedRevision);
  check(await commits(api) === before + 1, 'An explicit command published multiple or zero generations');
  check(JSON.stringify(result.changeSet) === JSON.stringify(review.changeSet), 'Apply changed the reviewed graph delta');
  return result;
}

/** Construct a complete draft against the actual current revision. @param {object} app Installed application. @param {Function} mutate Explicit fixture change. @returns {Promise<object>} Public replacement command. */
export async function change(app: RelationshipApplication, mutate: (snapshot: Graph) => unknown): Promise<Draft> {
  const state = readyState(await app.read('self')), snapshot = structuredClone(state.snapshot); mutate(snapshot);
  return { command: { kind: 'replace', snapshot }, expectedRevision: readyState(state).head };
}

/** Require a real failure and unchanged authority/head/manifest count. @param {object} api Native resources. @param {object} draft Command. @param {string} code Failure category. @returns {Promise<void>} No publication. */
export async function unchanged(api: NativeAPI, draft: Draft, code: string) {
  const app = api.Zotero.ReferenceRelationships!.application, before = await app.read('self'), count = await commits(api);
  await rejects(() => app.preview(draft.command, draft.expectedRevision), code);
  await rejects(() => app.apply(draft.command, draft.expectedRevision), code);
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Rejected engine command changed authority');
  check(await commits(api) === count, 'Rejected engine command published native notes');
}

/** Build real endpoint pairs that exceed the fixed rule bound without missing-item shortcuts. @param {object} job Fixture marker. @param {object} api Actual platform. @returns {Promise<void>} Overflow leaves saved authority unchanged. */
export async function overflow(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships!.application, books = [];
  for (let index = 0; index < 33; index++) books.push(await book(Zotero, `${job.marker} limit endpoint ${index}`));
  const timestamp = new Date().toISOString(), assertions: Assertion[] = [];
  for (const source of books) for (const target of books) {
    if (source === target || assertions.length === 1000) continue;
    assertions.push({ id: `limit-${String(assertions.length).padStart(4, '0')}`, source: ref(source), target: ref(target),
      type: 'referencing', metadata: {}, createdAt: timestamp, updatedAt: timestamp });
  }
  const draft = await change(app, graph => {
    graph.assertions = assertions;
    graph.rules = Array.from({ length: 64 }, (_, index) => ({ ...rule(`limit-rule-${index}`, 'referencing', 'referencing', 'referencing'), mapping: {} }));
  });
  await unchanged(api, draft, 'limit');
}

/** Exercise late diamond supports and immutable-root downstream predicates in actual installed code. @param {object} api Native resources. @param {object} source Real source. @param {string} note Explicit-root metadata. @returns {Promise<void>} Diamond contributes correctly, incompatible routes reject, owned rules retract. */
export async function diamond(api: NativeAPI, source: TestItem, note: string) {
  const app = api.Zotero.ReferenceRelationships!.application;
  for (const id of ['a-left', 'z-right', 'b-join', 'c-tail']) {
    await applyOne(api, await app.manageTypes({ library: 'self', kind: 'create', migration: null,
      type: { id, label: id, description: '', retired: false,
        fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }] } }));
  }
  const declared: Rule[] = [
    { ...rule('d-root-left'), transform: 'same', outputType: 'a-left' },
    { ...rule('d-root-right'), transform: 'same', outputType: 'z-right' },
    { ...rule('d-left-join', 'referencing', 'a-left', 'b-join'), transform: 'same', mapping: { note: { kind: 'constant', value: 'generated note' } } },
    { ...rule('d-right-join', 'referencing', 'z-right', 'b-join'), transform: 'same', mapping: { note: { kind: 'constant', value: 'generated note' } } },
    { ...rule('d-join-tail', 'referencing', 'b-join', 'c-tail'), transform: 'same', conditions: [{ field: 'note', op: 'eq', value: note }] },
  ];
  await applyOne(api, await change(app, graph => graph.rules.push(...declared)));
  const rows = (await app.listRelationships(ref(source), 'both', null, { offset: 0, limit: 100 })).relationships;
  const join = rows.find(edge => edge.type === 'b-join'), tail = rows.find(edge => edge.type === 'c-tail');
  check(present(join).supports.length === 2 && present(join).metadata.note === 'generated note', 'Late diamond route lost support');
  check(present(tail).supports.length === 1 && present(tail).metadata.note === note, 'Downstream condition read generated metadata instead of root');
  const competing = await change(app, graph => {
    const right = graph.rules.find(rule => rule.id === 'd-right-join'); present(right).version++;
    constantMapping(present(right).mapping.note).value = 'incompatible route';
  });
  await unchanged(api, competing, 'validation');
  const ids = new Set(declared.map(rule => rule.id));
  await applyOne(api, await change(app, graph => { graph.rules = graph.rules.filter(rule => !ids.has(rule.id)); }));
  check(!(await app.listRelationships(ref(source), 'both', null, { offset: 0, limit: 100 })).relationships.some(edge => edge.type === 'b-join'), 'Diamond rule deletion left unsupported output');
}
