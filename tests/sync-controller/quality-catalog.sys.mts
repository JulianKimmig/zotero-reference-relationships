/** Measure actual packaged catalog controls and complete migration reviews without publishing the preserved dense authority. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import { resources, preserved } from './reconciliation-fixtures.sys.mts';
import { commits } from './rules-fixtures.sys.mts';
import { present, readyState, found, errorMessage } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';
import { startNativeProfile } from './native-profile.sys.mts';
import { measureNativePhases } from './profiled-measure.sys.mts';
import { catalogPagingCases } from './catalog-paging-cases.sys.mts';

/** Native loading preserves the shipped classes, host DOM and real application boundary. */
type CatalogLoader = NativeAPI['ChromeUtils'] & {
  importESModule(uri: `resource://${string}/src/ui/view.mjs`): typeof import('../../src/ui/view.mts');
  importESModule(uri: `resource://${string}/src/ui/catalog-editor.mjs`): typeof import('../../src/ui/catalog-editor.mts');
};

/** Actual connected native DOM size after flushing layout, separate from the full logical migration size. */
interface CatalogDOM { rows: number; controls: number; nodes: number; paragraphs: number; width: number; height: number }

/** Observe real connected controls and layout without inspecting source implementation or synthesizing performance results. @param root Connected native editor. @returns Current DOM and layout measurements. */
function catalogDOM(root: HTMLElement): CatalogDOM {
  check(root.isConnected, 'Catalog measurement requires connected native DOM');
  const bounds = root.getBoundingClientRect();
  return { rows: root.querySelectorAll('[data-rr-migration-id]').length,
    controls: root.querySelectorAll('input,textarea,select,button').length, nodes: root.querySelectorAll('*').length,
    paragraphs: root.querySelectorAll('[data-rr-type-review] p').length, width: bounds.width, height: bounds.height };
}

/** Measure migration creation and a genuine1000-update review on one explicitly identified anonymous saved graph. @param job Exact XPI, preserved head and unique evidence label. @param api Actual native runtime and storage. @returns Timings, DOM sizes and exact no-write evidence; component calls do not claim OS-keyboard interaction. */
export async function qualityCatalog(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Catalog measurement requires unsigned-in client');
  check(!!job.currentHead && !!job.fixtures?.pass && /^[a-z][a-z0-9-]*$/.test(job.fixtures.pass), 'Explicit catalog head and unique pass required');
  const production = await resources(job, api), app = present(Zotero.ReferenceRelationships).application;
  const before = readyState(await app.read('self')), count = await commits(api);
  check(before.head === job.currentHead && before.snapshot.assertions.length === 1000 && before.snapshot.rules.length === 50,
    'Catalog measurement requires the exact preserved dense workload');
  const original = present(before.snapshot.types.find(type => type.id === 'referencing'));
  const { version, ...definition } = original;
  check(original.fields.length === 1 && original.fields[0].id === 'note' && original.fields[0].kind === 'string', 'Catalog workload schema differs');
  const loader = api.ChromeUtils as CatalogLoader;
  const { RelationshipView } = loader.importESModule('resource://rr-reconciliation-production/src/ui/view.mjs');
  const { CatalogEditor } = loader.importESModule('resource://rr-reconciliation-production/src/ui/catalog-editor.mjs');
  const window = Zotero.getMainWindow(), document = window.document;
  const host = document.createElementNS('http://www.w3.org/1999/xhtml', 'section');
  host.style.cssText = 'position:fixed;inset:10px auto auto 10px;width:380px;height:600px;overflow:auto;background:Canvas;color:CanvasText';
  document.documentElement.append(host);
  const errors: unknown[] = [];
  const view = new RelationshipView({ body: host, window, Zotero, app, gateway: production.gateway, dialogs: new Set(),
    /** Redraw through the real view. @returns Native rendering completion. */
    async refresh() { await view.render(); },
    /** Retain actual UI failures. @param error Native failure. @returns Completion. */
    report(error: unknown) { errors.push(error); },
    /** Preferences are outside this no-write component measurement. @returns A deliberate unsupported-action failure. */
    async openRules() { throw new Error('Catalog workload does not open rule preferences'); } });
  const profile = startNativeProfile(api, `${job.data}/quality-catalog-${job.fixtures.pass}.json`);
  try {
    const endpoint = before.snapshot.assertions[0].source;
    view.select(found(await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, endpoint.key)));
    await view.render(); check(view.root.dataset.rrState === 'ready', 'Native catalog view did not render ready');
    view.openCatalog(); const editor = view.editor;
    check(editor instanceof CatalogEditor, 'Actual catalog editor was not mounted');
    const migrationDOM: CatalogDOM[] = [], reviewDOM: CatalogDOM[] = [];
    const migration = await measureNativePhases(api, profile, 'RR_PHASE:catalogMigration', async () => {
      editor.edit(original); await editor.migrate();
      check(present(editor.migration).read().length === 1000, 'Catalog migration lost logical replacement rows');
      migrationDOM.push(catalogDOM(editor.root));
    }, 3);
    const draft = await profile.phase('RR_PHASE:catalogDraft', () => app.manageTypes({ library: 'self', kind: 'update',
      type: { ...definition, label: 'Measured catalog label', fields: [{ ...original.fields[0], label: 'Measured note' }] },
      migration: before.snapshot.assertions.map((root, index) => ({ id: root.id, metadata: { note: `Catalog row ${index} Café 你好` } })) }));
    const review = await profile.phase('RR_PHASE:catalogPreview', () => app.preview(draft.command, draft.expectedRevision));
    check(review.changeSet.assertions.updated.length === 1000 && review.projection.after.state === 'ready'
      && review.projection.after.relationships.length === 2000 && review.projection.after.transitions === 100000,
    'Measured catalog review did not preserve complete migration and closure');
    const rendering = await measureNativePhases(api, profile, 'RR_PHASE:catalogReviewRendering', () => {
      editor.invalidate(); editor.renderReview(review); reviewDOM.push(catalogDOM(editor.root));
    }, 3);
    const paging = job.action === 'quality:catalog-pages' ? catalogPagingCases(api, before.snapshot) : null;
    check(errors.length === 0, `Catalog UI failures: ${errors.map(errorMessage).join('; ')}`);
    await preserved(api, before, count);
    return { pass: job.fixtures.pass, head: before.head, assertions: 1000, rules: 50, manifests: count,
      migration, migrationDOM, rendering, reviewDOM, paging, fullMigrationRows: 1000, fullUpdatedAssertions: 1000,
      profile: await profile.finish(), noAuthorityWrites: true, nativeComponent: true, forcedGC: false };
  } finally { view.dispose(); host.remove(); await profile.finish(); }
}
