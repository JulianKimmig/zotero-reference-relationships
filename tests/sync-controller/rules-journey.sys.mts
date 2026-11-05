/** Native evaluator/application atomicity, generated provenance and root-owned metadata acceptance. */
import { readyState, present, found } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { RelationshipApplication } from '../../src/application/service.mts';
import type { TestItem } from './platform-contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check, until, selectPane, click } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { install, book, ref, rule, applyOne, change, unchanged, overflow, diamond } from './rules-fixtures.sys.mts';

/** Query actual materialized relationships in both directions. @param {object} app Application. @param {object} item Native item. @returns {Promise<object[]>} Detached rows. */
async function rows(app: RelationshipApplication, item: TestItem) { return (await app.listRelationships(ref(item), 'both', null, { offset: 0, limit: 100 })).relationships; }

/** Execute an isolated real process phase; no plugin internals are mocked. @param {object} job Artifact/phase/keys. @param {object} api Native platform. @returns {Promise<object>} Verified report. */
export async function rulesJourney(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, window = await install(job, api), app = Zotero.ReferenceRelationships!.application;
  if (job.action === 'rules:create') {
    const a = await book(Zotero, `${job.marker} source`), b = await book(Zotero, `${job.marker} target`);
    a.addRelatedItem(b); b.addRelatedItem(a); await a.saveTx(); await b.saveTx();
    const ordinary = new Zotero.Item('note'); ordinary.libraryID = Zotero.Libraries.userLibraryID;
    ordinary.setNote('<div data-schema-version="9"><p>Engine unrelated native note</p></div>'); await ordinary.saveTx();
    const ordinaryText = ordinary.getNote(), note = 'Root Café 你好 😀';
    const first = await app.draftCreate({ source: ref(a), target: ref(b), type: 'referencing', metadata: { note } });
    await applyOne(api, first); const root = readyState((await app.read('self'))).snapshot.assertions[0];
    const enabled = await change(app, graph => { graph.rules = [rule('inverse')]; });
    const review = await app.preview(enabled.command, enabled.expectedRevision);
    check(present(review.changeSet.derived).added.length === 1 && present(review.changeSet.derived).added[0].type === 'referenced-by', 'Inverse preview differs');
    b.deleted = true; await b.saveTx();
    try { await unchanged(api, enabled, 'endpoint'); }
    finally { b.deleted = false; await b.saveTx(); }
    await applyOne(api, enabled);
    const generated = (await rows(app, a)).find(edge => edge.type === 'referenced-by');
    check(present(generated).assertions.length === 0 && present(generated).supports.length === 1 && present(generated).supports[0].root === root.id
      && present(generated).metadata.note === note, 'Expected exactly one correctly rooted inverse');
    check(readyState((await app.read('self'))).snapshot.assertions.length === 1, 'Computed inverse was persisted as manual authority');
    const sourcePane = await selectPane(Zotero, window, a);
    const generatedRow = [...sourcePane.querySelectorAll<HTMLElement>('[data-rr-relation]')].find(row => row.dataset.rrOrigin === 'generated');
    check(generatedRow && generatedRow.textContent.includes('Generated'), 'Generated origin is not visible');
    check(!generatedRow.querySelector<HTMLButtonElement>('[data-rr-action="edit"]') && !generatedRow.querySelector<HTMLButtonElement>('[data-rr-action="remove"]'), 'Generated-only row offers manual edits');
    await rejects(() => app.draftCreate({ source: ref(a), target: ref(b), type: 'referencing', metadata: { note } }), 'validation');
    const manualDraft = await app.draftCreate({ source: ref(b), target: ref(a), type: 'referenced-by', metadata: {} });
    await applyOne(api, manualDraft);
    const manual = readyState((await app.read('self'))).snapshot.assertions.find(value => value.type === 'referenced-by');
    const catalog = await app.manageTypes({ library: 'self', kind: 'create', migration: null,
      type: { id: 'root-two', label: 'Second root', description: '', retired: false,
        fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }] } });
    await applyOne(api, catalog);
    await applyOne(api, await change(app, graph => graph.rules.push(rule('back', 'referencing', 'referenced-by', 'referencing'),
      rule('second-inverse', 'root-two'), rule('second-back', 'root-two', 'referenced-by', 'root-two'))));
    const stale = await app.draftRemove(root.id, 'self');
    await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(b), type: 'root-two', metadata: { note } }));
    const second = readyState((await app.read('self'))).snapshot.assertions.find(value => value.type === 'root-two');
    check(present((await rows(app, a)).find(edge => edge.type === 'referenced-by')).supports.length === 2, 'Independent support missing');
    await unchanged(api, stale, 'conflict');
    const conflict = await app.draftUpdate(present(second).id, { source: ref(a), target: ref(b), type: 'root-two', metadata: { note: 'Conflicting second root' } }, 'self');
    await unchanged(api, conflict, 'conflict');
    const version = await change(app, graph => { graph.rules[0].conditions = [{ field: 'note', op: 'exists', value: true }]; });
    await unchanged(api, version, 'validation');
    await diamond(api, a, note);
    await overflow(job, api);
    return { a: a.key, b: b.key, ordinary: ordinary.key, ordinaryText, note, root: root.id, second: present(second).id, manual: present(manual).id,
      snapshot: readyState((await app.read('self'))).snapshot, atomicInverse: true, generatedNotPersisted: true,
      generatedUI: true, endpointGuard: true, conflictUnchanged: true, staleUnchanged: true, limitUnchanged: true,
      versionGuard: true, diamondLateSupports: true, downstreamRootConditions: true, competingMappingsRejected: true };
  }
  if (job.action === 'rules:restart') {
    const a = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.a));
    const b = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.b));
    check(JSON.stringify(readyState((await app.read('self'))).snapshot) === JSON.stringify(job.snapshot), 'Restart changed explicit authority');
    const baseline = JSON.stringify(await rows(app, found(b)));
    for (let index = 0; index < 20; index++) check(JSON.stringify(await rows(app, found(b))) === baseline, 'Materialized reads are not deterministic');
    const pane = await selectPane(Zotero, window, found(b));
    const combined = [...pane.querySelectorAll<HTMLElement>('[data-rr-relation]')].find(row => JSON.parse(present(row.dataset.rrRelation))[2] === 'referenced-by');
    check(present(combined).dataset.rrOrigin === 'both' && present(combined).textContent.includes(present(job.note)), 'Combined row lost origin or effective metadata');
    click(present(combined), 'edit'); await until(Zotero, () => pane.querySelector<HTMLElement>('[data-rr-editor]'), 'manual contribution editor');
    check(present(pane.querySelector<FormControl>('[data-rr-field="note"]')).value === '', 'Generated metadata was promoted into manual editor');
    click(pane, 'preview'); await until(Zotero, () => !present(pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'manual contribution preview');
    click(pane, 'save'); await until(Zotero, () => !pane.querySelector<HTMLElement>('[data-rr-editor]') && pane.dataset.rrState === 'ready', 'manual contribution save');
    check(!Object.hasOwn(present(readyState((await app.read('self'))).snapshot.assertions.find(value => value.id === job.manual)).metadata, 'note'), 'Saving promoted generated values to manual authority');
    const c = await book(Zotero, `${job.marker} retarget endpoint`);
    await applyOne(api, await app.draftUpdate(present(job.root), { source: ref(found(a)), target: ref(c), type: 'referencing', metadata: { note: present(job.note) } }, 'self'));
    check((await rows(app, c)).some(edge => edge.type === 'referenced-by' && edge.supports[0].root === job.root), 'Retargeted inverse missing');
    await applyOne(api, await app.draftUpdate(present(job.root), { source: ref(found(a)), target: ref(c), type: 'similar', metadata: { note: present(job.note) } }, 'self'));
    check((await rows(app, c)).length === 1 && (await rows(app, c))[0].type === 'similar', 'Retyping left obsolete generated edges');
    await applyOne(api, await app.draftRemove(present(job.root), 'self'));
    let inverse = (await rows(app, found(a))).find(edge => edge.type === 'referenced-by');
    check(present(inverse).supports.length === 1 && present(inverse).supports[0].root === job.second, 'Removing one root erased independent supports');
    check((await rows(app, found(a))).length === 2, 'Retraction left unrelated unsupported generated edges');
    await applyOne(api, await app.draftRemove(job.second, 'self'));
    const onlyManual = await rows(app, found(a)); check(onlyManual.length === 1, 'Removing generated roots left ghost edges'); inverse = onlyManual[0];
    check(inverse.type === 'referenced-by' && inverse.supports.length === 0 && inverse.assertions[0] === job.manual && !Object.hasOwn(inverse.metadata, 'note'), 'Manual inverse did not survive independently');
    await applyOne(api, await app.draftRemove(job.manual, 'self'));
    check((await rows(app, found(a))).length === 0, 'Unrooted cycles kept generated edges alive');
    await applyOne(api, await app.draftCreate({ source: ref(found(a)), target: ref(found(b)), type: 'referencing', metadata: { note: present(job.note) } }));
    await applyOne(api, await change(app, graph => { graph.rules[0].enabled = false; graph.rules[0].version = 2; }));
    check((await rows(app, found(a))).length === 1, 'Disabling a rule left generated edges');
    await applyOne(api, await change(app, graph => { graph.rules[0].enabled = true; graph.rules[0].version = 3;
      graph.rules[0].conditions = [{ field: 'note', op: 'eq', value: 'not present' }]; }));
    check((await rows(app, found(a))).length === 1, 'False root condition produced an edge');
    await applyOne(api, await change(app, graph => { graph.rules[0].conditions = []; graph.rules[0].version = 4; }));
    check((await rows(app, found(a))).length === 2, 'Editing conditions did not restore the inverse');
    await applyOne(api, await change(app, graph => { graph.rules = graph.rules.filter(rule => rule.id !== 'inverse'); }));
    check((await rows(app, found(a))).length === 1, 'Deleted rule retained unsupported edges');
    const ordinary = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.ordinary));
    check(found(ordinary).getNote() === job.ordinaryText && found(a).relatedItems.includes(found(b).key) && found(b).relatedItems.includes(found(a).key), 'Native unrelated content changed');
    return { restarted: true, deterministicReads: true, manualOwnershipPreserved: true, independentSupports: true,
      manualInverseSurvived: true, cyclesRetracted: true, retargetAndRetype: true, disableEditDelete: true, nativeDataPreserved: true };
  }
  throw new Error(`Unknown native rules phase ${job.action}`);
}
