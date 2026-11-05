/** Installed-XPI custom catalog, schema preservation, typed forms and genuine restart acceptance. */
import { check, until, selectPane, click, type } from './ui-helpers.sys.mjs';
import { rejects } from './ui-permissions.sys.mjs';
import { values, checked, metadataEquals, openCatalog, fillDefinition, finishCatalog, typedRelationship, catalogReviewRace } from './catalog-helpers.sys.mjs';

/** Create a native book. @param {object} Zotero Platform. @param {string} title Fixture label. @returns {Promise<object>} Actual reference. */
async function book(Zotero, title) {
  const item = new Zotero.Item('book'); item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField('title', title); await item.saveTx(); return item;
}

/** Install the built production XPI and wait for actual native trees. @param {object} job Explicit artifact. @param {object} api Native platform. @returns {Promise<Window>} Main window. */
async function install(job, api) {
  const { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  check((await AddonManager.installTemporaryAddon(api.Zotero.File.pathToFile(job.xpi))).isActive, 'Catalog XPI is inactive');
  const window = api.Zotero.getMainWindow();
  await until(api.Zotero, () => window.ZoteroPane.loaded && window.ZoteroPane.itemsView && window.ZoteroPane.collectionsView, 'catalog native trees');
  await Promise.all([window.ZoteroPane.itemsView.waitForLoad(), window.ZoteroPane.collectionsView.waitForLoad()]);
  return window;
}

/** Execute a true process-separated catalog acceptance phase. @param {object} job Phase/artifact/keys. @param {object} api Actual native resources. @returns {Promise<object>} Verified public behavior. */
export async function catalogJourney(job, api) {
  const { Zotero } = api;
  if (job.action === 'catalog:permissions') await api.synchronize();
  const window = await install(job, api), app = Zotero.ReferenceRelationships.application;
  if (job.action === 'catalog:permissions') {
    const scope = `group:${job.groups.restricted}`, group = Zotero.Groups.get(job.groups.restricted);
    check(!group.editable, 'Catalog permission fixture must actually be read-only');
    const before = await app.read(scope);
    const source = (await Zotero.Items.getAll(group.libraryID, true, false)).find(item => item.isRegularItem());
    check(!!source, 'Read-only UI fixture has no native bibliographic reference');
    const root = await selectPane(Zotero, window, source);
    check(root.querySelector('[data-rr-action="manage-types"]').disabled, 'Read-only UI enabled catalog editing');
    const draft = await app.manageTypes({ library: scope, kind: 'create', migration: null,
      type: { id: 'denied-custom', label: 'Denied', description: '', retired: false, fields: [] } });
    await rejects(() => app.preview(draft.command, draft.expectedRevision), 'permission');
    await rejects(() => app.apply(draft.command, draft.expectedRevision), 'permission');
    check(JSON.stringify(await app.read(scope)) === JSON.stringify(before), 'Denied catalog changed authority');
    return { denied: true, unchanged: true, readOnlyUIDisabled: true };
  }
  if (job.action === 'catalog:create') {
    const a = await book(Zotero, `${job.marker} A`), b = await book(Zotero, `${job.marker} B`);
    const root = await selectPane(Zotero, window, a);
    let editor = await openCatalog(api, root); fillDefinition(window, editor);
    await catalogReviewRace(api, window, editor);
    await finishCatalog(api, root, false);
    check((await app.read('self')).state === 'uninitialized', 'Cancelled type initialized authority');
    editor = await openCatalog(api, root); fillDefinition(window, editor); await finishCatalog(api, root, true);
    let graph = (await app.read('self')).snapshot;
    check(graph.types.find(value => value.id === 'custom').version === 1 && graph.assertions.length === 0, 'Custom definition missing');
    await typedRelationship(api, window, root, b);
    graph = (await app.read('self')).snapshot;
    const assertion = graph.assertions[0]; metadataEquals(assertion.metadata, values);
    check(root.textContent.includes(values.text) && !root.querySelector('b'), 'Typed text was interpreted as markup');
    editor = await openCatalog(api, root, 'custom');
    type(window, editor.querySelector('[data-rr-catalog-field="label"]'), 'Stale unsaved label');
    const other = { ...(await app.read('self')).snapshot.types.find(value => value.id === 'similar') };
    delete other.version; other.description = 'Changed by another actual application command';
    const concurrent = await app.manageTypes({ library: 'self', kind: 'update', type: other, migration: null });
    await app.apply(concurrent.command, concurrent.expectedRevision);
    const authoritative = await app.read('self');
    click(editor, 'preview-type');
    await until(Zotero, () => editor.querySelector('[role="alert"]').textContent.includes('changed'), 'stale catalog head rejection');
    check(editor.querySelector('[data-rr-action="save-type"]').disabled, 'Stale catalog command enabled overwrite');
    check(JSON.stringify(await app.read('self')) === JSON.stringify(authoritative), 'Stale catalog draft overwrote authority');
    click(editor, 'cancel-catalog');
    await until(Zotero, () => !root.querySelector('[data-rr-catalog]') && root.dataset.rrState === 'ready', 'stale catalog cancelled');
    editor = await openCatalog(api, root, 'custom');
    check(editor.querySelector('[data-rr-catalog-field="id"]').readOnly, 'Existing type identity is editable');
    type(window, editor.querySelector('[data-rr-catalog-field="label"]'), 'Renamed custom');
    const field = [...editor.querySelectorAll('[data-rr-field-definition]')].find(row => row.querySelector('[data-rr-definition="id"]').value === 'text');
    check(field.querySelector('[data-rr-definition="id"]').readOnly, 'Existing field identity is editable');
    type(window, field.querySelector('[data-rr-definition="label"]'), 'Renamed text');
    await finishCatalog(api, root, true);
    graph = (await app.read('self')).snapshot;
    check(graph.types.find(value => value.id === 'custom').version === 2, 'Schema rename did not version');
    check(JSON.stringify(graph.assertions[0]) === JSON.stringify(assertion), 'Rename changed existing assertion or metadata');
    check(root.textContent.includes('Renamed custom') && root.textContent.includes('Renamed text'), 'Renamed labels missing from relationship');
    const raw = structuredClone(graph); raw.types.find(value => value.id === 'custom').label = 'Bypass version';
    const revision = (await app.read('self')).head;
    await rejects(() => app.apply({ kind: 'replace', snapshot: raw }, revision), 'validation');
    editor = await openCatalog(api, root, 'custom'); checked(editor.querySelector('[data-rr-catalog-field="retired"]'), true);
    await finishCatalog(api, root, true);
    check(root.textContent.includes(values.text), 'Retirement hid old relationship values');
    click(root, 'add'); await until(Zotero, () => root.querySelector('[data-rr-type]'), 'post-retirement editor');
    check(![...root.querySelector('[data-rr-type]').options].some(option => option.value === 'custom'), 'Retired type offered for new relationship');
    click(root, 'cancel'); await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.dataset.rrState === 'ready', 'retired draft cancelled');
    await rejects(() => app.draftCreate({ source: assertion.source, target: assertion.target, type: 'custom', metadata: values }), 'validation');
    return { a: a.key, b: b.key, assertionID: assertion.id, beforeMigration: (await app.read('self')).snapshot,
      allKinds: true, renamePreserved: true, retirementReadable: true, invalidUnchanged: true,
      cancelledUninitialized: true, versionGuard: true, previewRace: true, staleCatalogRejected: true };
  }
  if (job.action === 'catalog:restart') {
    const a = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, job.a);
    const root = await selectPane(Zotero, window, a), initial = await app.read('self');
    check(JSON.stringify(initial.snapshot) === JSON.stringify(job.beforeMigration), 'Restart changed catalog/metadata');
    metadataEquals(initial.snapshot.assertions[0].metadata, values);
    let editor = await openCatalog(api, root, 'custom');
    checked(editor.querySelector('[data-rr-catalog-field="retired"]'), false);
    let row = [...editor.querySelectorAll('[data-rr-field-definition]')].find(row => row.querySelector('[data-rr-definition="id"]').value === 'text');
    click(row, 'remove-field'); click(editor, 'preview-type');
    await until(Zotero, () => editor.querySelector('[role="alert"]').textContent.includes('migration'), 'destructive schema guard');
    check(editor.querySelector('[data-rr-action="save-type"]').disabled, 'Destructive unreviewed schema enabled save');
    check(JSON.stringify((await app.read('self')).snapshot) === JSON.stringify(initial.snapshot), 'Schema error discarded old values');
    click(editor, 'review-migration');
    await until(Zotero, () => editor.querySelector('[data-rr-migration-id]'), 'explicit migration forms');
    check(editor.textContent.includes(values.text), 'Old removed value absent from migration review');
    type(window, editor.querySelector('[data-rr-migration-id] [data-rr-field="count"]'), '42');
    await finishCatalog(api, root, false);
    check(JSON.stringify((await app.read('self')).snapshot) === JSON.stringify(initial.snapshot), 'Cancelled migration changed old values');
    editor = await openCatalog(api, root, 'custom'); checked(editor.querySelector('[data-rr-catalog-field="retired"]'), false);
    row = [...editor.querySelectorAll('[data-rr-field-definition]')].find(row => row.querySelector('[data-rr-definition="id"]').value === 'text');
    click(row, 'remove-field'); click(editor, 'review-migration');
    await until(Zotero, () => editor.querySelector('[data-rr-migration-id]'), 'reviewed migration form');
    type(window, editor.querySelector('[data-rr-migration-id] [data-rr-field="count"]'), '42');
    await finishCatalog(api, root, true);
    const graph = (await app.read('self')).snapshot, after = graph.assertions[0], before = initial.snapshot.assertions[0];
    metadataEquals(after.metadata, { count: 42, flag: false, date: values.date, choice: values.choice });
    check(after.id === before.id && after.createdAt === before.createdAt && after.updatedAt >= before.updatedAt, 'Migration changed assertion identity/time ownership');
    check(graph.types.find(value => value.id === 'custom').version === 4, 'Migration schema version differs');
    return { restartedAllKinds: true, destructiveRejectedUnchanged: true, cancelledMigrationUnchanged: true, explicitMigration: true };
  }
  throw new Error(`Unknown catalog action ${job.action}`);
}
