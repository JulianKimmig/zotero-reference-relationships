/** Native behavioral cases for bounded migration controls, typed draft retention and retired listener ownership. */
import type { NativeAPI } from './native-api.mts';
import type { Graph, Metadata, MetadataField, RelationshipType } from '../../src/domain/contracts.mts';
import type { FormControl } from '../../src/ui/contracts.mts';
import { check, click, type } from './ui-helpers.sys.mts';
import { present, errorMessage } from './evidence.sys.mts';
import { metadataEquals } from './catalog-helpers.sys.mts';

/** Load only the real packaged migration implementation. */
type MigrationLoader = NativeAPI['ChromeUtils'] & {
  importESModule(uri: `resource://${string}/src/ui/catalog-migration.mjs`): typeof import('../../src/ui/catalog-migration.mts');
};

/** Execute separate basic and edge cases with genuine Gecko controls and no stored authority mutation. @param api Native constructors and module loader. @param before Actual graph supplying regular same-library endpoint identities. @returns Named observations after every required behavior passes. */
export function catalogPagingCases(api: NativeAPI, before: Graph) {
  const { migrationForms } = (api.ChromeUtils as MigrationLoader)
    .importESModule('resource://rr-reconciliation-production/src/ui/catalog-migration.mjs');
  const window = api.Zotero.getMainWindow(), document = window.document;
  const host = document.createElementNS('http://www.w3.org/1999/xhtml', 'section'); document.documentElement.append(host);
  const observations: { name: string; passed: boolean; error?: string }[] = [];
  const fields: MetadataField[] = [
    { id: 'text', label: 'Text', kind: 'string', required: false, options: [] },
    { id: 'count', label: 'Count', kind: 'number', required: false, options: [] },
    { id: 'flag', label: 'Flag', kind: 'boolean', required: false, options: [] },
    { id: 'date', label: 'Date', kind: 'date', required: false, options: [] },
    { id: 'choice', label: 'Choice', kind: 'enum', required: false, options: ['é', 'other'] },
  ];
  const next: RelationshipType = { id: 'referencing', version: 2, label: 'Migration', description: '', retired: false, fields };
  const graph = structuredClone(before);
  graph.types = graph.types.map(value => value.id === next.id ? { ...next, version: 1,
    fields: [...fields, { id: 'removed', label: 'Removed', kind: 'string', required: false, options: [] }] } : value);
  const initial: Metadata = { text: '', count: 0, flag: false, date: '2000-02-29', choice: 'é', removed: 'Before Café <b>literal</b>' };
  graph.assertions = graph.assertions.map(root => ({ ...root, metadata: { ...initial } }));

  /** Run one independent native case and retain every failure, disposing its actual owner. @param name Case identity. @param run Actual DOM interaction. @returns Completion. */
  function test(name: string, run: (current: ReturnType<typeof fixture>) => void): void {
    const current = fixture();
    try { run(current); observations.push({ name, passed: true }); }
    catch (error) { observations.push({ name, passed: false, error: errorMessage(error) }); }
    finally { current.forms.dispose(); current.forms.dispose(); current.parent.remove(); }
  }

  /** Create one fresh isolated production form on a complete typed logical migration. @returns Native owner plus observed change counter. */
  function fixture(source = graph) {
    const parent = document.createElementNS('http://www.w3.org/1999/xhtml', 'section'); host.append(parent);
    let changes = 0;
    const forms = migrationForms({ document, window, parent, before: source, type: next,
      /** Count actual edit notifications without replacing application/UI methods. @returns Completion. */
      onChange() { changes++; } });
    return { parent, forms,
      /** Observe the actual callback count. @returns Edit notifications. */
      changes() { return changes; } };
  }

  /** Locate one field on the current first actual row. @param parent Live migration. @param id Declared metadata field. @returns Native editable control. */
  function field(parent: HTMLElement, id: string): FormControl {
    return present(parent.querySelector<FormControl>(`[data-rr-migration-id] [data-rr-field="${id}"]`));
  }

  try {
    test('bounded-complete-pages', ({ parent, forms, changes }) => {
      check(parent.querySelectorAll('[data-rr-migration-id]').length === 25, 'Migration must mount25 rows, not every logical row');
      const rows = forms.read(); check(rows.length === 1000, 'Paging omitted offscreen replacements');
      rows.forEach((row, index) => { check(row.id === graph.assertions[index].id, 'Migration reordered IDs');
        metadataEquals(row.metadata, { text: '', count: 0, flag: false, date: '2000-02-29', choice: 'é' }); });
      check(parent.textContent.includes(initial.removed as string) && !parent.querySelector('b'), 'Old removed value must remain literal');
      const seen: string[] = [];
      for (let page = 0; page < 40; page++) {
        seen.push(...[...parent.querySelectorAll<HTMLElement>('[data-rr-migration-id]')].map(row => present(row.dataset.rrMigrationId)));
        check(parent.querySelector('[role="status"]')?.textContent === `${page * 25 + 1}–${(page + 1) * 25} of 1000`, 'Accessible migration page range missing');
        if (page !== 39) click(parent, 'migration-next');
      }
      check(new Set(seen).size === 1000 && seen.every((id, index) => id === graph.assertions[index].id), 'Native pages lost or duplicated rows');
      check(present(parent.querySelector<HTMLButtonElement>('[data-rr-action="migration-next"]')).disabled, 'Last page enables Next');
      check(changes() === 0, 'Navigation invalidates unchanged metadata');
      rows[0].metadata.text = 'Mutated receipt'; check(forms.read()[0].metadata.text === '', 'Returned replacements alias owned drafts');
    });
    test('edits-survive-page-navigation', ({ parent, forms }) => {
      type(window, field(parent, 'text'), 'First Café 你好'); type(window, field(parent, 'count'), '42');
      const first = present(parent.querySelector<HTMLElement>('[data-rr-migration-id]'));
      present(first.querySelector<HTMLButtonElement>('[aria-label="Remove Flag value"]')).click();
      click(parent, 'migration-next'); type(window, field(parent, 'text'), 'Second page');
      click(parent, 'migration-previous');
      check(field(parent, 'text').value === 'First Café 你好' && field(parent, 'count').value === '42', 'Page navigation discarded inputs');
      const rows = forms.read();
      metadataEquals(rows[0].metadata, { text: 'First Café 你好', count: 42, date: '2000-02-29', choice: 'é' });
      check(rows[25].metadata.text === 'Second page' && rows[999].metadata.flag === false, 'Visited/offscreen values were lost');
      type(window, field(parent, 'text'), ''); click(parent, 'migration-next'); click(parent, 'migration-previous');
      check(Object.hasOwn(forms.read()[0].metadata, 'text') && forms.read()[0].metadata.text === '', 'Intentional empty text became absent');
    });
    test('retired-page-controls-inert', ({ parent, forms, changes }) => {
      const retired = field(parent, 'text');
      const remove = present(retired.parentElement?.querySelector<HTMLButtonElement>('button'));
      click(parent, 'migration-next'); check(!retired.isConnected, 'Old page retained live controls');
      const count = changes(); type(window, retired, 'Retired mutation'); remove.click();
      check(changes() === count && forms.read()[0].metadata.text === '', 'Removed page handlers changed drafts or invalidated review');
      const nextButton = present(parent.querySelector<HTMLButtonElement>('[data-rr-action="migration-next"]'));
      forms.dispose(); const html = parent.innerHTML; nextButton.click();
      check(parent.innerHTML === html, 'Disposed navigation mutated owned DOM');
    });
    test('native-sanitized-offscreen-defaults', ({ parent, forms }) => {
      // Native values are deliberately changed on an offscreen logical row before a new real form is built.
      graph.assertions[999].metadata = { text: true, count: 'not a number', flag: 'false', date: 'invalid', choice: 'missing' };
      const other = fixture();
      try { metadataEquals(other.forms.read()[999].metadata, { text: 'true', flag: false }); }
      finally { other.forms.dispose(); other.parent.remove(); graph.assertions[999].metadata = { ...initial }; }
      check(forms.read().length === 1000 && parent.isConnected, 'Sanitization damaged an independent owner');
    });
    test('empty-and-partial-final-page', () => {
      for (const size of [0, 1, 26]) {
        const other = fixture({ ...graph, assertions: graph.assertions.slice(0, size) });
        try {
          check(other.forms.read().length === size && other.parent.querySelectorAll('[data-rr-migration-id]').length === Math.min(size, 25), 'Small migration row count differs');
          if (size === 26) {
            click(other.parent, 'migration-next');
            check(other.parent.querySelectorAll('[data-rr-migration-id]').length === 1
              && other.parent.querySelector('[role="status"]')?.textContent === '26–26 of 26', 'Partial final page differs');
            click(other.parent, 'migration-previous');
            check(other.parent.querySelectorAll('[data-rr-migration-id]').length === 25, 'Previous lost the first page');
          }
        } finally { other.forms.dispose(); other.parent.remove(); }
      }
    });
    check(observations.every(value => value.passed), `Catalog paging failures: ${JSON.stringify(observations.filter(value => !value.passed))}`);
    return observations;
  } finally { host.remove(); }
}
