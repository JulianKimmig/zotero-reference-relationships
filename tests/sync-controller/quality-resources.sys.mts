/** Actual repeated addon generations release native observers, pending scheduling work and retired catalog/preferences controls. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { resourceTrace } from './quality-resource-trace.sys.mts';
import { resources, setEnabled, preserved } from './reconciliation-fixtures.sys.mts';
import { shutdownRegistrations, shutdownClose } from './quality-shutdown-native.sys.mts';
import { preferences } from './rule-preferences-helpers.sys.mts';
import { book, ref, commits } from './rules-fixtures.sys.mts';
import { check, selectPane, click, until } from './ui-helpers.sys.mts';
import { present, readyState, errorMessage } from './evidence.sys.mts';
import type { TestItem } from './platform-contracts.mts';

/** Rebuild the actual native item menu and count this plugin's real entries. @param api Native pane and document. @param phase Current lifecycle boundary retained on failure. @returns Mounted relationship action count, including stale duplicates if any. */
async function menuCount(api: NativeAPI, phase: string): Promise<number> {
  const window = api.Zotero.getMainWindow(), menu = present(window.document.getElementById('zotero-itemmenu'));
  const entries = [...menu.querySelectorAll('[data-l10n-id="reference-relationships-add-menu"]')]
    .map(node => ({ id: node.id, classes: node.className }));
  try {
    await window.ZoteroPane.buildItemContextMenu();
    return menu.querySelectorAll('[data-l10n-id="reference-relationships-add-menu"]').length;
  } catch (error) {
    await present(api.IOUtils).writeUTF8(`${api.Zotero.DataDirectory.dir}/quality-resource-menu-boundary.json`, JSON.stringify({
      phase, entries, localizationLinks: window.document.querySelectorAll('link[href="reference-relationships.ftl"]').length,
      thrownNull: error === null, thrownType: typeof error, message: errorMessage(error) }), { flush: true });
    throw error;
  }
}

/** Inspect the actual menu on a preserved failed fixture after independent state readback, without replaying its publication. @param job Exact existing anonymous authority/head. @param api Native host. @returns One real menu count and unchanged authority, or the actual native failure. */
export async function qualityResourceMenu(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api; check(!Zotero.Users.getCurrentUserID() && !!job.currentHead, 'Read-only menu diagnosis needs an anonymous explicit head');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application, before = readyState(await app.read('self')), count = await commits(api);
  check(before.head === job.currentHead, 'Preserved menu fixture head changed');
  const source = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, before.snapshot.assertions[0].source.key);
  check(!!source, 'Preserved menu fixture source missing'); await selectPane(Zotero, Zotero.getMainWindow(), source);
  try {
    const menu = await menuCount(api, 'preserved-readonly'); check(menu === 1, 'Actual relationship menu must contain exactly one action');
    await preserved(api, before, count); return { menu, head: before.head, manifests: count, noAuthorityWrites: true };
  } catch (error) {
    await present(api.IOUtils).writeUTF8(`${present(job.data)}/quality-resource-menu-failure.json`, JSON.stringify({
      head: before.head, count, thrownType: typeof error, thrownNull: error === null, message: errorMessage(error) }), { flush: true });
    throw error;
  }
}

/** Run three real disable/re-enable cycles with live catalog/preferences and a preview at an observed native scheduling boundary. @param job Exact production XPI in a fresh anonymous test client. @param api Actual native host capabilities. @returns External observer/timer receipts and retained-control behavior; no GC reachability or historical-crash claim. */
export async function qualityResources(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Resource tests require an unsigned-in client');
  const trace = resourceTrace(api);
  try {
    const production = await resources(job, api), first = present(Zotero.ReferenceRelationships);
    check((await first.application.read('self')).state === 'uninitialized', 'Resource fixture must start with empty authority');
    const books: TestItem[] = [];
    for (let index = 0; index < 7; index++) books.push(await book(Zotero, `Resource lifetime ${index} Café 你好`));
    const draft = await first.application.draftCreate({ source: ref(books[0]), target: ref(books[1]), type: 'referencing', metadata: { note: 'Retain metadata' } });
    const graph = draft.command.snapshot, original = graph.assertions[0];
    for (const source of books) for (const target of books) {
      if (source === target || (source === books[0] && target === books[1]) || graph.assertions.length === 26) continue;
      graph.assertions.push({ ...original, id: `resource-root-${graph.assertions.length}`, source: ref(source), target: ref(target), metadata: { note: 'Retain metadata' } });
    }
    await first.application.applyFromEvent(draft.command, draft.expectedRevision);
    const before = readyState(await first.application.read('self')), count = await commits(api);
    check(count === 1 && before.snapshot.assertions.length === 26, 'Resource fixture must publish exactly one complete26-root graph');
    await present(api.IOUtils).writeUTF8(`${present(job.data)}/quality-resources-fixture.json`, JSON.stringify({ before, count }), { mode: 'create', flush: true });
    const cycles: object[] = [], window = Zotero.getMainWindow();
    for (let cycle = 0; cycle < 3; cycle++) {
      const runtime = present(Zotero.ReferenceRelationships), app = runtime.application;
      const root = await selectPane(Zotero, window, books[0]);
      const menuBefore = await menuCount(api, `cycle-${cycle}-before-disable`); check(menuBefore === 1, 'Active generation duplicated or omitted its actual context-menu action');
      const popup = present(window.document.getElementById('zotero-itemmenu'));
      const unrelated = window.document.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'menuitem');
      unrelated.setAttribute('class', 'zotero-custom-menu-item rr-unrelated-test-menu'); unrelated.setAttribute('label', 'Other test menu'); popup.append(unrelated);
      click(root, 'manage-types');
      const catalog = await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-catalog]'), 'resource actual catalog editor');
      present(catalog.querySelector<HTMLButtonElement>('[data-rr-type-id="referencing"]')).click();
      click(catalog, 'review-migration');
      const migration = await until(Zotero, () => catalog.querySelector<HTMLElement>('[aria-label="Review metadata migration"]'), 'resource catalog migration');
      check(migration.querySelectorAll('[data-rr-migration-id]').length === 25, 'Resource fixture must exercise bounded migration controls');
      const next = present(migration.querySelector<HTMLButtonElement>('[data-rr-action="migration-next"]'));
      check(!next.disabled, 'Retired migration navigation must be enabled to prove listener ownership');
      const prefs = await preferences(api);
      const newRule = present(prefs.root.querySelector<HTMLButtonElement>('[data-rr-action="new-rule"]'));
      check(!newRule.disabled, 'Native preferences must have an enabled live action');
      const proposal = await app.draftUpdate(original.id, { source: original.source, target: original.target,
        type: original.type, metadata: { note: `No-write pending preview ${cycle}` } }, 'self');
      const nextYield = trace.nextYield();
      const pending = app.preview(proposal.command, proposal.expectedRevision).then(() => ({ state: 'completed' as const }),
        error => ({ state: 'rejected' as const, message: errorMessage(error) }));
      await Promise.race([nextYield, pending.then(outcome => { throw new Error(`Preview settled before the observed native scheduling boundary: ${JSON.stringify(outcome)}`); })]);
      const atYield = trace.snapshot(); check(atYield.pendingTimers > 0, 'No actual native source scheduler was pending at observation');
      await setEnabled(Zotero, production.addon, false);
      const outcome = await pending;
      if (outcome.state === 'rejected') check(outcome.message.includes('stopped'), `Unexpected preview rejection: ${outcome.message}`);
      check(runtime.state === 'stopped' && runtime.windows.size === 0, 'Stopped runtime retained native windows');
      const stopped = shutdownRegistrations(api), released = trace.snapshot();
      check(released.activeObservers.length === 0 && released.pendingTimers === 0, 'Disabled generation retained an observer or native scheduling request');
      check(stopped.relationshipPreferenceRegistrations === 0 && stopped.relationshipSectionRegistrations === 0
        && stopped.relationshipDOMRoots === 0, 'Disabled generation retained official registrations or relationship DOM');
      check(unrelated.isConnected && popup.contains(unrelated), 'Plugin teardown removed unrelated native menu DOM'); unrelated.remove();
      check(popup.querySelectorAll('[data-l10n-id="reference-relationships-add-menu"]').length === 0,
        'Disabled generation retained its localized menu DOM after removing its Fluent resource');
      const menuStopped = await menuCount(api, `cycle-${cycle}-after-disable`); check(menuStopped === 0, 'Disabled generation retained its actual context-menu action');
      const migrationHTML = migration.innerHTML, preferenceHTML = prefs.root.innerHTML;
      next.click(); newRule.click(); await Zotero.Promise.delay(0);
      check(migration.innerHTML === migrationHTML && prefs.root.innerHTML === preferenceHTML, 'Retired actual catalog/preferences actions changed their detached owned roots');
      await shutdownClose(api, prefs.window, 'zotero:pref');
      books[0].setField('title', `Disabled native notification ${cycle}`); await books[0].saveTx();
      await setEnabled(Zotero, production.addon, true);
      const current = present(Zotero.ReferenceRelationships);
      check(current !== runtime && current.application !== app, 'Re-enable reused a stopped source generation');
      const active = shutdownRegistrations(api), registered = trace.snapshot();
      check(registered.activeObservers.length === 1 && active.relationshipPreferenceRegistrations === 1
        && active.relationshipSectionRegistrations === 1 && active.pluginTrackedClosedWindows === 0, 'Re-enable duplicated or omitted native resources');
      const menuEnabled = await menuCount(api, `cycle-${cycle}-after-reenable`); check(menuEnabled === 1, 'Re-enable duplicated or omitted its actual context-menu action');
      await preserved(api, before, count);
      cycles.push({ cycle, atYield, outcome, stopped, released, active, registered, menuBefore, menuStopped, menuEnabled,
        unrelatedMenuPreserved: true, retiredMigrationNavigationInert: true, retiredPreferencesActionInert: true, sameAuthority: true });
      await present(api.IOUtils).writeUTF8(`${present(job.data)}/quality-resources-progress.json`, JSON.stringify({ cycles }), { flush: true });
    }
    return { cycles, trace: trace.snapshot(), assertions: 26, manifests: count, head: before.head,
      externalAPIsForwarded: true, productionCallbacksUnchanged: true, sourceSchedulingNotHeld: true,
      forcedGC: false, nativeLeakEnumerationAvailable: false, noInteractionPublications: true };
  } finally { trace.restore(); }
}
