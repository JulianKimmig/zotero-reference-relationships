/** Actual item-pane pagination and literal long-Unicode presentation in an explicitly selected native theme and host locale. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { resources, preserved } from './reconciliation-fixtures.sys.mts';
import { book, ref, commits } from './rules-fixtures.sys.mts';
import { found, present, readyState } from './evidence.sys.mts';
import { check, click, selectPane, until } from './ui-helpers.sys.mts';

/** Verify real native layout and every bounded relationship page without changing saved authority after setup. @param job Anonymous client with explicit theme/locale expectations. @param api Actual Zotero and Gecko resources. @returns Detached layout/page observations and exact preserved authority; failures retain a checkpoint. */
export async function qualityPresentation(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, io = present(api.IOUtils);
  check(!Zotero.Users.getCurrentUserID(), 'Presentation fixture requires unsigned-in client');
  check(job.fixtures?.theme === 'light' || job.fixtures?.theme === 'dark', 'Explicit presentation theme required');
  check(!!job.fixtures.locale, 'Explicit presentation host locale required');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application, window = Zotero.getMainWindow();
  const initial = await app.read('self');
  const reading = job.action === 'quality:presentation-read';
  check(reading ? initial.state === 'ready' : initial.state === 'uninitialized', 'Presentation action disagrees with actual authority');
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches, locale = window.navigator.language;
  check(dark === (job.fixtures.theme === 'dark'), `Unexpected native theme: ${dark}`);
  check(locale === job.fixtures.locale, `Unexpected native host locale: ${locale}`);
  const source = reading ? found(await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID,
    readyState(initial).snapshot.assertions[0].source.key)) : await book(Zotero, 'Presentation source Café 你好 العربية');
  check(source.getField('title') === 'Presentation source Café 你好 العربية', 'Wrong preserved presentation fixture');
  const titles = new Map<string, string>(), targets = [];
  for (let index = 0; index < 51; index++) {
    const title = `${String(index).padStart(2, '0')} Café 你好 العربية <em>& literal ${'LongUnbrokenTitle'.repeat(40)}`;
    const assertion = reading ? present(readyState(initial).snapshot.assertions.find(value => value.id === `presentation-${index}`)) : null;
    const item = assertion ? found(await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, assertion.target.key)) : await book(Zotero, title);
    check(item.getField('title') === title, 'Preserved presentation title changed');
    titles.set(item.key, title); targets.push(item);
  }
  const note = `Literal metadata Café 你好 <strong>& ${'UnbrokenMetadata'.repeat(30)}`;
  if (!reading) {
    const draft = await app.draftCreate({ source: ref(source), target: ref(targets[0]), type: 'referencing', metadata: { note } });
    const snapshot = draft.command.snapshot, original = snapshot.assertions[0];
    snapshot.assertions = targets.map((target, index) => ({ ...original, id: `presentation-${index}`, target: ref(target) }));
    await app.applyFromEvent(draft.command, draft.expectedRevision);
  }
  const before = readyState(await app.read('self')), count = await commits(api);
  check(count === 1 && before.snapshot.assertions.length === 51, 'Presentation setup did not publish exactly one complete graph');
  const root = await selectPane(Zotero, window, source), pages: object[] = [], observations: { label: string; passed: boolean; detail: object }[] = [];
  /** Record actual containment without hiding overflow, truncating text or inferring layout from CSS source. @param label Diagnostic. @param node Live rendered text/action. @returns A detached measurement used by the final assertion. */
  function layout(label: string, node: HTMLElement): void {
    const bounds = root.getBoundingClientRect(), box = node.getBoundingClientRect(), style = window.getComputedStyle(node);
    observations.push({ label, passed: box.width > 0 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1
      && node.scrollWidth <= node.clientWidth + 1 && bounds.right <= window.innerWidth + 1,
    detail: { rootLeft: bounds.left, rootRight: bounds.right, left: box.left, right: box.right,
      clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, color: style.color, background: style.backgroundColor } });
  }
  /** Compare the real rendered page to the public application page and inspect all literal title/metadata values. @param offset Expected stable offset. @returns Exact relationship identities for this page. */
  async function page(offset: number): Promise<string[]> {
    const expected = await app.listRelationships(ref(source), 'both', null, { offset, limit: 25 });
    const identities = expected.relationships.map(edge => edge.key);
    await until(Zotero, () => root.getAttribute('aria-busy') === 'false'
      && JSON.stringify([...root.querySelectorAll<HTMLElement>('[data-rr-relation]')].map(row => row.dataset.rrRelation)) === JSON.stringify(identities), `presentation page ${offset}`);
    for (const row of root.querySelectorAll<HTMLElement>('[data-rr-relation]')) {
      const edge = present(expected.relationships.find(value => value.key === row.dataset.rrRelation));
      const button = present(row.querySelector<HTMLButtonElement>('[data-rr-action="navigate"]'));
      check(button.textContent === titles.get(edge.target.key) && button.childElementCount === 0, 'Title markup/Unicode was changed or interpreted');
      const metadata = present([...row.querySelectorAll<HTMLElement>('p')].find(node => node.textContent?.includes(note)));
      check(metadata.childElementCount === 0, 'Metadata markup was interpreted');
      layout(`title-${offset}-${edge.target.key}`, button); layout(`metadata-${offset}-${edge.target.key}`, metadata);
    }
    const previous = root.querySelector('[data-rr-action="previous"]'), next = root.querySelector('[data-rr-action="next"]');
    check(!!previous === (offset > 0) && !!next === (expected.nextOffset !== null), 'Native page boundary controls disagree with the public page');
    pages.push({ offset, identities, total: expected.total }); return identities;
  }
  const visited = [];
  visited.push(...await page(0)); click(root, 'next'); visited.push(...await page(25));
  click(root, 'next'); visited.push(...await page(50));
  check(visited.length === 51 && new Set(visited).size === 51, 'Forward pagination lost or repeated a relationship');
  click(root, 'previous'); await page(25); click(root, 'previous'); await page(0);
  await io.writeUTF8(`${job.data}/quality-presentation-pages.json`, JSON.stringify({ pages, observations, before, manifests: count }), { mode: 'create', flush: true });
  const first = present((await app.listRelationships(ref(source), 'both', null, { offset: 0, limit: 25 })).relationships[0]);
  const target = present(targets.find(item => item.key === first.target.key)), edge = present([...root.querySelectorAll<HTMLElement>('[data-rr-relation]')]
    .find(row => row.querySelector('[data-rr-action="navigate"]')?.textContent === titles.get(target.key)));
  click(edge, 'navigate');
  await until(Zotero, () => window.ZoteroPane.getSelectedItems()[0]?.key === target.key, 'native Unicode title navigation selection');
  const selectedPane = window.document.querySelector<HTMLElement>('[data-rr-pane]');
  const navigation = { selectedKey: target.key, automaticPaneKey: selectedPane?.dataset.rrItemKey,
    automaticPaneState: selectedPane?.dataset.rrState, automaticPaneTop: selectedPane?.getBoundingClientRect().top };
  const incoming = await selectPane(Zotero, window, target);
  check(incoming.querySelectorAll('[data-rr-relation]').length === 1, 'Navigation did not show the incoming relationship');
  await selectPane(Zotero, window, source); await page(0);
  const labels = await window.document.l10n.formatMessages([{ id: 'reference-relationships-rule-new' }]);
  check(typeof labels[0]?.value === 'string' && labels[0].value.length > 0, 'Plugin Fluent labels unavailable in selected host locale');
  await preserved(api, before, count);
  const report = { theme: job.fixtures.theme, dark, locale, pluginNewRuleLabel: labels[0].value,
    pages, observations, navigation, noFixturePublication: reading, source: source.key, before, manifests: count, inputBackend: 'native DOM component actions, not OS keyboard' };
  await io.writeUTF8(`${job.data}/quality-presentation-result.json`, JSON.stringify(report), { mode: 'create', flush: true });
  check(observations.every(value => value.passed), `Native presentation overflow: ${JSON.stringify(observations.filter(value => !value.passed).slice(0, 4))}`);
  return report;
}
