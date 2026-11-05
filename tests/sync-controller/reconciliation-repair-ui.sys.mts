/** Real UI selects original contributors and reviews explicit conflict repairs without destructive rewrites. */
import { present, readyState, found } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import { check, until, selectPane, click, type } from './ui-helpers.sys.mts';
import { resources, fixtures, setEnabled } from './reconciliation-fixtures.sys.mts';
import { ref, commits } from './rules-fixtures.sys.mts';

/** Select a current rendered relation by its stable type. @param {Element} pane Native section. @param {string} typeID Type. @returns {Element} Real row. */
function relation( pane: HTMLElement, typeID: string) {
  const row = [...pane.querySelectorAll<HTMLElement>('[data-rr-relation]')].find(row => JSON.parse(present(row.dataset.rrRelation))[2] === typeID);
  check(!!row, `Native relationship row ${typeID} missing`); return row;
}

/** Select an original root from an actual conflict/contribution panel. @param {object} Zotero Native API. @param {Element} pane Section. @param {string} id Original assertion ID. @returns {Promise<Element>} Row with literal original metadata. */
async function original(Zotero: TestPlatform, pane: HTMLElement, id: string) {
  return until(Zotero, () => [...pane.querySelectorAll<HTMLElement>('[data-rr-repair-root]')].find(row => row.dataset.rrRepairRoot === id), 'original root in repair panel');
}

/** Save a reviewed standard editor and wait for its actual section refresh. @param {object} Zotero Native API. @param {Element} pane Section. @returns {Promise<void>} */
async function save(Zotero: TestPlatform, pane: HTMLElement) {
  click(present(pane.querySelector<HTMLElement>('[data-rr-editor]')), 'save');
  await until(Zotero, () => !pane.querySelector<HTMLElement>('[data-rr-editor]') && pane.dataset.rrState !== 'loading', 'original contribution saved');
}

/** Run actual original-contributor editing, removal, conflict repair and orphan reporting. @param {object} job Phase/artifact/keys. @param {object} api Native resources. @returns {Promise<object>} Evidence. */
export async function reconciliationRepairUI(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, production = await resources(job, api), app = Zotero.ReferenceRelationships!.application, main = Zotero.getMainWindow();
  if (job.action === 'reconcile:repair-ui-endpoints') {
    const { reconciliationEndpointUI } = await import('./reconciliation-endpoint-ui.sys.mts');
    return reconciliationEndpointUI(job, api);
  }
  if (job.action === 'reconcile:repair-ui-restart') {
    const a = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.a));
    check(JSON.stringify(await app.read('self')) === JSON.stringify(job.before), 'Repair UI restart changed original authority');
    const pane = await selectPane(Zotero, main, found(a)); click(pane, 'manage-repairs');
    const row = await original(Zotero, pane, present(job.orphan));
    check(row.textContent.includes(present(job.c)) && row.dataset.rrEndpointStatus === 'missing', 'Restart lost visible retained orphan');
    return { restarted: true, retainedOrphanVisible: true, originalGraphPreserved: true };
  }
  const { a, b, c } = await fixtures(job, api);
  const { mergeItems } = api.ChromeUtils.importESModule('chrome://zotero/content/mergeItems.mjs');
  const rootB = readyState((await app.read('self'))).snapshot.assertions.find(root => root.source.key === b.key && root.type === 'referencing');
  await mergeItems(a, [b]);
  let pane = await selectPane(Zotero, main, a);
  click(relation(pane, 'referencing'), 'choose-contribution');
  let chosen = await original(Zotero, pane, present(rootB).id);
  check(chosen.textContent.includes(b.key) && chosen.textContent.includes('Shared Café 你好'), 'Contributor picker hides original ownership or values');
  click(chosen, 'edit-original');
  await until(Zotero, () => pane.querySelector<HTMLElement>('[data-rr-editor]'), 'chosen original editor');
  click(pane, 'preview'); await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')?.disabled === false, 'original metadata preview');
  await save(Zotero, pane);
  check(present(readyState((await app.read('self'))).snapshot.assertions.find(root => root.id === present(rootB).id)).source.key === b.key, 'UI metadata save promoted projected survivor to original source');
  let before = await app.read('self'), count = await commits(api);
  click(relation(pane, 'referencing'), 'choose-contribution'); chosen = await original(Zotero, pane, present(rootB).id);
  click(chosen, 'remove-original');
  await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')?.disabled === false, 'original removal confirmation');
  click(pane, 'cancel'); await until(Zotero, () => !pane.querySelector<HTMLElement>('[data-rr-editor]') && pane.dataset.rrState !== 'loading', 'original removal canceled');
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before) && await commits(api) === count, 'Canceled original removal changed graph');
  click(relation(pane, 'referencing'), 'choose-contribution'); chosen = await original(Zotero, pane, present(rootB).id);
  click(chosen, 'remove-original'); await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')?.disabled === false, 'second removal confirmation');
  await save(Zotero, pane);
  check(present((await app.listRelationships(ref(a), 'both', null, { offset: 0, limit: 25 })).relationships.find(edge => edge.type === 'referencing')).assertions.length === 1,
    'Removing one original removed the surviving manual contributor');
  await Zotero.UndoHistory.undo();
  const divergent = await app.draftCreate({ source: ref(b), target: ref(c), type: 'referencing', metadata: { note: 'Different original 你好' } });
  await app.applyFromEvent(divergent.command, divergent.expectedRevision);
  const different = readyState((await app.read('self'))).snapshot.assertions.find(root => root.source.key === b.key && root.type === 'referencing');
  await mergeItems(a, [b]); pane = await selectPane(Zotero, main, a);
  await until(Zotero, () => pane.dataset.rrState === 'conflict', 'explicit projected conflict UI');
  click(pane, 'manage-repairs'); chosen = await original(Zotero, pane, present(different).id);
  check(chosen.textContent.includes('Different original 你好') && chosen.textContent.includes(b.key), 'Conflict UI erased an original value');
  click(chosen, 'edit-original'); await until(Zotero, () => pane.querySelector<HTMLElement>('[data-rr-editor]'), 'conflicted original editor');
  type(main, pane.querySelector<FormControl>('[data-rr-field="note"]'), 'Still different'); click(pane, 'preview');
  await until(Zotero, () => present(pane.querySelector<HTMLElement>('[data-rr-editor] [role="alert"]')).textContent, 'still-conflicting repair error');
  check(present(pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')).disabled, 'Still-conflicting repair enabled Save');
  before = await app.read('self'); count = await commits(api);
  type(main, pane.querySelector<FormControl>('[data-rr-field="note"]'), 'Shared Café 你好'); click(pane, 'preview');
  await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')?.disabled === false, 'valid conflict repair review');
  const review = pane.querySelector<HTMLElement>('[data-rr-review-projection]');
  check(review && review.dataset.rrBeforeState === 'conflict' && Number(review.dataset.rrAfterCount) === 2
    && review.textContent.includes('Different original 你好') && review.textContent.includes('Shared Café 你好'), 'Conflict repair review hides complete before/after data');
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before) && await commits(api) === count, 'Conflict preview published data');
  await save(Zotero, pane);
  check(pane.dataset.rrState === 'ready' && present(readyState((await app.read('self'))).snapshot.assertions.find(root => root.id === present(different).id)).source.key === b.key,
    'Conflict UI save did not preserve original ownership');
  before = await app.read('self'); count = await commits(api);
  await setEnabled(Zotero, production.addon, false); await c.eraseTx(); await setEnabled(Zotero, production.addon, true);
  const current = Zotero.ReferenceRelationships!.application;
  pane = await selectPane(Zotero, main, a); click(pane, 'manage-repairs');
  chosen = await original(Zotero, pane, present(different).id);
  check(chosen.dataset.rrEndpointStatus === 'missing' && chosen.textContent.includes(c.key)
    && chosen.textContent.includes('Shared Café 你好'), 'Orphan UI hides retained endpoint identity or metadata');
  check(JSON.stringify(await current.read('self')) === JSON.stringify(before) && await commits(api) === count, 'Opening orphan report wrote repair data');
  return { a: a.key, c: c.key, orphan: present(different).id, before, originalContributionSelected: true,
    originalMetadataAndRemoval: true, completeConflictRepairUI: true, disabledEraseVisible: true };
}
