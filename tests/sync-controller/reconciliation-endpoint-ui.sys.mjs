/** Explicitly retarget both unavailable endpoints through actual native selection and preview controls. */
import { check, until, selectPane, click, chooseTarget } from './ui-helpers.sys.mjs';
import { book, commits } from './rules-fixtures.sys.mjs';

/** Repair one original root after both of its endpoints become unavailable. @param {object} job Saved repair fixture. @param {object} api Native platform. @returns {Promise<object>} Explicit-only retarget evidence. */
export async function reconciliationEndpointUI(job, api) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships.application, main = Zotero.getMainWindow();
  const a = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, job.a);
  await a.eraseTx();
  const source = await book(Zotero, `${job.marker} replacement source`), target = await book(Zotero, `${job.marker} replacement target`);
  const before = await app.read('self'), count = await commits(api), original = before.snapshot.assertions.find(root => root.id === job.orphan);
  const pane = await selectPane(Zotero, main, source); click(pane, 'manage-repairs');
  const row = await until(Zotero, () => [...pane.querySelectorAll('[data-rr-repair-root]')]
    .find(row => row.dataset.rrRepairRoot === original.id), 'unavailable source and target original');
  click(row, 'edit-original'); await until(Zotero, () => pane.querySelector('[data-rr-editor]'), 'endpoint repair editor');
  await chooseTarget(api, pane, source, 'choose-source');
  await chooseTarget(api, pane, target);
  click(pane, 'preview'); await until(Zotero, () => pane.querySelector('[data-rr-action="save"]')?.disabled === false, 'explicit endpoint repair review');
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before) && await commits(api) === count, 'Choosing or previewing replacement endpoints wrote authority');
  click(pane, 'cancel'); await until(Zotero, () => !pane.querySelector('[data-rr-editor]') && pane.dataset.rrState !== 'loading', 'endpoint retarget canceled');
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before) && await commits(api) === count, 'Canceling endpoint repair changed original keys');
  click(pane, 'manage-repairs');
  const again = await until(Zotero, () => [...pane.querySelectorAll('[data-rr-repair-root]')].find(row => row.dataset.rrRepairRoot === original.id), 'original after canceled repair');
  click(again, 'edit-original'); await until(Zotero, () => pane.querySelector('[data-rr-editor]'), 'confirmed endpoint repair editor');
  await chooseTarget(api, pane, source, 'choose-source'); await chooseTarget(api, pane, target);
  click(pane, 'preview'); await until(Zotero, () => pane.querySelector('[data-rr-action="save"]')?.disabled === false, 'confirmed endpoint repair preview');
  click(pane, 'save'); await until(Zotero, () => !pane.querySelector('[data-rr-editor]') && pane.dataset.rrState !== 'loading', 'endpoint repair saved');
  const after = await app.read('self'), updated = after.snapshot.assertions.find(root => root.id === original.id);
  check(updated.source.key === source.key && updated.target.key === target.key && updated.createdAt === original.createdAt
    && JSON.stringify(updated.metadata) === JSON.stringify(original.metadata), 'Explicit endpoint repair lost original identity or metadata');
  check(JSON.stringify(after.snapshot.assertions.filter(root => root.id !== original.id))
    === JSON.stringify(before.snapshot.assertions.filter(root => root.id !== original.id)), 'Endpoint repair rewrote unrelated original roots');
  check(await commits(api) === count + 1, 'Explicit repair did not publish exactly one generation');
  return { bothUnavailableEndpointsSelectable: true, cancelAndPreviewDoNotWrite: true, explicitRetargetOnly: true,
    identityMetadataAndOtherRootsPreserved: true };
}
