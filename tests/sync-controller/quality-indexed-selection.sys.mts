/** Verify actual indexed native selection and every high-degree UI page without library enumeration or authority writes. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestItem } from './platform-contracts.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { commits, ref } from './rules-fixtures.sys.mts';
import { present, readyState, found, errorMessage } from './evidence.sys.mts';
import { check, selectPane, click, until } from './ui-helpers.sys.mts';

/** Read actual owned row identities without deriving results from source implementation. @param root Native relationship section. @returns Complete identities of the currently mounted page. */
function identities(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-rr-relation]')].map(row => present(row.dataset.rrRelation));
}

/** Exercise real visible item-pane selection/paging on one explicit preserved1000-root/50-rule graph. @param job Exact artifact and existing anonymous head. @param api Native platform. @returns Observed native I/O,80 complete bounded pages and rapid-selection consistency, without publishing data or assigning a new timing SLA. */
export async function qualityIndexedSelection(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  check(!Zotero.Users.getCurrentUserID() && !!job.currentHead, 'Indexed selection requires an anonymous explicit preserved head');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application, before = readyState(await app.read('self')), count = await commits(api);
  check(before.head === job.currentHead && before.snapshot.assertions.length === 1000 && before.snapshot.rules.length === 50,
    'Indexed selection requires the exact preserved dense workload');
  const anchorRef = before.snapshot.assertions[0].target;
  const anchor = found(await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, anchorRef.key));
  const leaves: TestItem[] = [];
  for (const index of [0, 1, 2, 999]) leaves.push(found(await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID,
    before.snapshot.assertions[index].source.key)));
  const warm = await app.listRelationships(anchorRef, 'both', null, { offset: 0, limit: 25 });
  check(warm.total === 2000 && warm.relationships.length === 25, 'Complete dense index was not warmed');
  const window = Zotero.getMainWindow(), getAll = Zotero.Items.getAll;
  let phase = 'warm-selection-render';
  const enumerations: { phase: string; arguments: string[]; stack: string | undefined }[] = [];
  const pages: { offset: number; identities: string[] }[] = [], selections: string[] = [], rapid: string[] = [];
  /** Observe and forward every external full-library enumeration, preserving all runtime arguments and the original returned promise. @param args Actual native arguments. @returns Original native result. */
  Zotero.Items.getAll = function(...args: Parameters<typeof getAll>) {
    enumerations.push({ phase, arguments: args.map(value => String(value)), stack: new Error().stack });
    return getAll.apply(this, args);
  };
  /** Require the actual native visible page to equal the independently queried public application page. @param root Native pane. @param item Actual selected reference. @param offset Expected stable page offset. @returns Exact currently visible relationship identities. */
  async function visible(root: HTMLElement, item: TestItem, offset: number): Promise<string[]> {
    const expected = await app.listRelationships(ref(item), 'both', null, { offset, limit: 25 });
    const keys = expected.relationships.map(edge => edge.key);
    await until(Zotero, () => root.dataset.rrItemKey === item.key && root.getAttribute('aria-busy') === 'false'
      && JSON.stringify(identities(root)) === JSON.stringify(keys), `indexed native page ${item.key}/${offset}`);
    check(root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().height > 0, 'Indexed native page is not visible');
    check(keys.length <= 25 && !!root.querySelector('[data-rr-action="previous"]') === (offset > 0)
      && !!root.querySelector('[data-rr-action="next"]') === (expected.nextOffset !== null), 'Native page bounds disagree with the public page');
    return keys;
  }
  try {
    for (const item of leaves) {
      const root = await selectPane(Zotero, window, item), keys = await visible(root, item, 0);
      check(keys.length === 2, 'Indexed leaf selection omitted a complete relationship'); selections.push(item.key);
    }
    const root = await selectPane(Zotero, window, anchor), visited: string[] = [];
    for (let offset = 0; offset < 2000; offset += 25) {
      const keys = await visible(root, anchor, offset); check(keys.length === 25, 'Dense visible page lost rows');
      pages.push({ offset, identities: keys }); visited.push(...keys);
      if (offset + 25 < 2000) click(root, 'next');
    }
    check(visited.length === 2000 && new Set(visited).size === 2000, 'Native high-degree paging omitted or repeated relationships');
    click(root, 'previous'); await visible(root, anchor, 1950);
    for (let attempt = 0; attempt < 3; attempt++) {
      await Promise.all([window.ZoteroPane.selectItem(leaves[attempt].id), window.ZoteroPane.selectItem(leaves[(attempt + 1) % leaves.length].id)]);
      const selected = present(window.ZoteroPane.getSelectedItems()[0]);
      check(leaves.some(item => item.id === selected.id), 'Concurrent native selection ignored both requested leaves');
      await visible(await selectPane(Zotero, window, selected), selected, 0); rapid.push(selected.key);
    }
    phase = 'cold-selection-render'; app.invalidateAll();
    const current = present(window.ZoteroPane.getSelectedItems()[0]);
    const coldItem = found(leaves.find(item => item.id !== current.id));
    await visible(await selectPane(Zotero, window, coldItem), coldItem, 0);
    phase = 'authority-readback'; app.invalidateAll();
    check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Native selection changed saved relationship authority');
    phase = 'diagnostic-manifest-count';
    check(await commits(api) === count, 'Native selection published an authority generation');
    const productionEnumerations = enumerations.filter(call => call.phase !== 'diagnostic-manifest-count');
    check(productionEnumerations.length === 0, `Native selection/render or cold authority read enumerated a complete library: ${JSON.stringify(productionEnumerations)}`);
    return { head: before.head, manifests: count, originals: 1000, rules: 50, relationships: 2000,
      pages, selections, rapid, coldSelection: coldItem.key, nativeLibraryEnumerations: productionEnumerations,
      diagnosticManifestEnumerations: enumerations.filter(call => call.phase === 'diagnostic-manifest-count'), allExternalCallsForwarded: true,
      noAuthorityWrites: true, warmAndColdSelection: true, nativeVisibleDOM: true };
  } catch (error) {
    await present(api.IOUtils).writeUTF8(`${present(job.data)}/quality-indexed-selection-failure.json`,
      JSON.stringify({ pages, selections, rapid, enumerations, message: errorMessage(error) }), { flush: true });
    throw error;
  } finally { Zotero.Items.getAll = getAll; }
}
