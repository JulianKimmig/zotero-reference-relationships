/** Actual ambiguous/cyclic aliases must permit honest, explicit original-root repair without changing native aliases. */
import { textValue, readyState, present, found } from './evidence.sys.mts';
import type { Assertion } from '../../src/domain/contracts.mts';
import type { ItemGateway } from '../../src/adapters/native-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestPlatform } from './platform-contracts.mts';
import { check, until, selectPane, click, chooseTarget } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { resources, preserved } from './reconciliation-fixtures.sys.mts';
import { book, ref, applyOne, commits } from './rules-fixtures.sys.mts';

const page = { offset: 0, limit: 25 };

/** Store adversarial aliases in owned disposable items only. @param {object} Zotero Native API. @param {object} source Original. @param {string} kind Ambiguous or cyclic. @param {string} marker Fixture label. @returns {Promise<object[]>} Real alias-bearing items. */
async function poison(Zotero: TestPlatform, source: TestItem, kind: string, marker: string) {
  const predicate = Zotero.Relations.replacedItemPredicate, originalURI = Zotero.URI.getItemURI(source);
  const first = await book(Zotero, `${marker} alias one`), second = await book(Zotero, `${marker} alias two`);
  if (kind === 'ambiguous') {
    await source.eraseTx();
    for (const item of [first, second]) { item.addRelation(predicate, originalURI); await item.saveTx(); }
    return [first, second];
  }
  source.deleted = true; first.deleted = true; await source.saveTx(); await first.saveTx();
  first.addRelation(predicate, originalURI); await first.saveTx();
  source.addRelation(predicate, Zotero.URI.getItemURI(first)); await source.saveTx();
  return [source, first];
}

/** Require an actual complete before-original/ready-after UI report. @param {Element} pane Owned actual pane. @param {object} original Exact original assertion. @returns {void} */
function honestReview( pane: HTMLElement, original: Assertion) {
  const review = pane.querySelector<HTMLElement>('[data-rr-review-projection]');
  check(review?.dataset.rrBeforeState === 'endpoint-conflict' && Number(review.dataset.rrAfterCount) >= 1
    && review.textContent.includes(original.source.key) && review.textContent.includes(textValue(original.metadata.note)),
  'Unresolved repair review guessed a before graph or hid original keys/metadata');
}

/** Open a retained unknown root through the real repair panel. @param {object} api Native resources. @param {Element} pane Pane. @param {object} root Original. @param {string} kind Status. @param {string} action Edit/remove. @returns {Promise<void>} Editor opened. */
async function openOriginal(api: NativeAPI, pane: HTMLElement, root: Assertion, kind: string, action: string) {
  click(pane, 'manage-repairs');
  const row = await until(api.Zotero, () => [...pane.querySelectorAll<HTMLElement>('[data-rr-repair-root]')]
    .find(row => row.dataset.rrRepairRoot === root.id), `${kind} original visible`);
  check(row.dataset.rrEndpointStatus === kind && row.textContent.includes(root.source.key)
    && row.textContent.includes(textValue(root.metadata.note)), 'Unknown original identity/status/metadata missing');
  click(row, action);
  await until(api.Zotero, () => pane.querySelector<HTMLElement>('[data-rr-editor]'), 'unknown original editor');
}

/** Exercise native unknown-alias read/preview/cancel/repair and stale binding. @param {object} job Marker. @param {object} api Native API. @param {object} gateway Actual gateway. @param {string} kind Ambiguous or cyclic. @returns {Promise<object>} Scoped evidence. */
async function journey(job: ControllerJob, api: NativeAPI, gateway: ItemGateway, kind: string) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships!.application, main = Zotero.getMainWindow();
  const source = await book(Zotero, `${job.marker} ${kind} original`), target = await book(Zotero, `${job.marker} ${kind} target`);
  const replacement = await book(Zotero, `${job.marker} ${kind} explicit replacement`);
  const draft = await app.draftCreate({ source: ref(source), target: ref(target), type: 'referencing', metadata: { note: `Original ${kind} Café 你好 <b>literal</b>` } });
  await applyOne(api, draft);
  const original = readyState((await app.read('self'))).snapshot.assertions.find(root => root.source.key === source.key);
  const aliases = await poison(Zotero, source, kind, job.marker), nativeBefore = JSON.stringify(aliases.map(item => item.getRelations()));
  const before = await app.read('self'), count = await commits(api), report = await app.reconcile('self', { offset: 0, limit: 1 });
  check(report.state === 'endpoint-conflict' && report.clusters === null && report.originals.length === 1
    && report.diagnostics.some(value => value.details.status === kind), 'Unknown aliases do not produce explicit original inspection');
  const endpoint = await gateway.inspect(ref(source));
  check(endpoint.status === kind && endpoint.resolved === null && !endpoint.editable, 'Gateway guessed an alias target');
  if (kind === 'cyclic') await rejects(() => gateway.resolve(ref(source)), 'endpoint');
  await rejects(() => app.listRelationships(ref(target), 'both', null, page), 'endpoint');
  await rejects(() => app.preview({ kind: 'replace', snapshot: readyState(before).snapshot }, readyState(before).head), 'endpoint');
  await preserved(api, before, count);
  let pane = await selectPane(Zotero, main, target);
  await openOriginal(api, pane, present(original), kind, 'edit-original');
  await chooseTarget(api, pane, replacement, 'choose-source'); click(pane, 'preview');
  await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')?.disabled === false, 'unknown repair preview');
  honestReview(pane, present(original)); await preserved(api, before, count);
  click(pane, 'cancel'); await until(Zotero, () => !pane.querySelector<HTMLElement>('[data-rr-editor]') && pane.dataset.rrState !== 'loading', 'unknown repair canceled');
  await preserved(api, before, count);
  if (kind === 'ambiguous') {
    await openOriginal(api, pane, present(original), kind, 'edit-original');
    await chooseTarget(api, pane, replacement, 'choose-source'); click(pane, 'preview');
    await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')?.disabled === false, 'unknown confirmed repair review');
    const predicate = Zotero.Relations.replacedItemPredicate, uri = Zotero.URI.getLibraryURI(source.libraryID) + '/items/' + source.key;
    aliases[0].removeRelation(predicate, uri); await aliases[0].saveTx({ skipNotifier: true });
    click(pane, 'save');
    await until(Zotero, () => pane.querySelector<HTMLElement>('[data-rr-editor] [role="alert"]')?.textContent, 'unknown-state stale save');
    check(present(pane.querySelector<HTMLElement>('[data-rr-editor] [role="alert"]')).textContent.includes('Native endpoints changed'), 'Unknown native binding change was not rejected');
    await preserved(api, before, count);
    aliases[0].addRelation(predicate, uri); await aliases[0].saveTx({ skipNotifier: true });
    click(pane, 'preview'); await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')?.disabled === false, 'renewed explicit unknown repair');
    honestReview(pane, present(original));
  } else {
    pane = await selectPane(Zotero, main, target);
    await openOriginal(api, pane, present(original), kind, 'remove-original');
    await until(Zotero, () => pane.querySelector<HTMLButtonElement>('[data-rr-action="save"]')?.disabled === false, 'cyclic root removal review');
    honestReview(pane, present(original));
  }
  click(pane, 'save'); await until(Zotero, () => !pane.querySelector<HTMLElement>('[data-rr-editor]') && pane.dataset.rrState !== 'loading', 'unknown repair saved');
  const after = await app.read('self'), changed = readyState(after).snapshot.assertions.find(root => root.id === present(original).id);
  check(kind === 'ambiguous' ? present(changed).source.key === replacement.key && present(changed).createdAt === present(original).createdAt
    && JSON.stringify(present(changed).metadata) === JSON.stringify(present(original).metadata) : changed === undefined, 'Wrong original relationship repaired');
  check(await commits(api) === count + 1 && (await app.reconcile('self', page)).state === 'ready', 'Explicit unknown repair did not publish one ready generation');
  check(JSON.stringify(aliases.map(item => item.getRelations())) === nativeBefore, 'Graph repair changed native alias records');
  check(JSON.stringify(readyState(after).snapshot.assertions.filter(root => root.id !== present(original).id))
    === JSON.stringify(readyState(before).snapshot.assertions.filter(root => root.id !== present(original).id)), 'Unknown repair changed unrelated roots');
  return { explicitOriginals: true, noGuessedAggregate: true, previewCancelNoWrites: true, explicitRepairOnly: true,
    nativeAliasesUnchanged: true, staleNativeReviewRejected: kind === 'ambiguous', selected: replacement.key };
}

/** Run unknown native alias UI acceptance and clean restarted readback. @param {object} job Phase/artifact. @param {object} api Actual platform. @returns {Promise<object>} Evidence. */
export async function reconciliationAliasUI(job: ControllerJob, api: NativeAPI) {
  const production = await resources(job, api), { Zotero } = api, app = Zotero.ReferenceRelationships!.application;
  if (['reconcile:alias-ui-restart', 'reconcile:alias-ui-final'].includes(job.action)) {
    await preserved(api, present(job.before), present(job.count));
    check((await app.reconcile('self', page)).state === 'ready', 'Restart lost explicit unknown repair');
    const selected = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.ambiguous).selected);
    const pane = await selectPane(Zotero, Zotero.getMainWindow(), found(selected));
    check(pane.dataset.rrState === 'ready', 'Restarted actual relationship view is not ready');
    return { restarted: true, repairsRetained: true, originalAuthorityUnchanged: true };
  }
  const ambiguous = await journey(job, api, production.gateway, 'ambiguous');
  const cyclic = await journey(job, api, production.gateway, 'cyclic');
  return { ambiguous, cyclic, before: await app.read('self'), count: await commits(api) };
}
