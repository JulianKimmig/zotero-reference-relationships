/** Native DOM component regression for validation-error focus and preservation of independently moved focus, without authority writes. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestWindow } from './platform-contracts.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { book, commits } from './rules-fixtures.sys.mts';
import { check, selectPane, click, until } from './ui-helpers.sys.mts';
import { preferences, openRule, cancelRule } from './rule-preferences-helpers.sys.mts';
import { present } from './evidence.sys.mts';

/** Exercise real error presentation and form context, collecting every happy/independent-focus observation. @param job Exact artifact and fresh unsigned-in data. @param api Actual native host. @returns Four error-focus cases, a named rule region and unchanged authority, with a checkpoint written before assertions. */
export async function qualityErrorFocus(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api, io = present(api.IOUtils);
  check(!Zotero.Users.getCurrentUserID(), 'Error focus regression requires unsigned-in client');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application, before = await app.read('self'), count = await commits(api);
  check(before.state === 'uninitialized', 'Error focus regression requires empty authority');
  const item = await book(Zotero, 'Validation focus source Café 你好'), window = Zotero.getMainWindow(), root = await selectPane(Zotero, window, item);
  const service = api.Components.classes['@mozilla.org/accessibilityService;1'].getService(api.Components.interfaces.nsIAccessibilityService);
  service.getApplicationAccessible();
  const observations: { label: string; passed: boolean; name: string | null; expectedName: string; focusedTag: string | null }[] = [];
  const outside: HTMLInputElement[] = [];
  let prefs: TestWindow | undefined;
  /** Provide one visible independent focus destination in the actual document. @param owner Native window. @returns Test-owned input, removed in final cleanup. */
  function independent(owner: TestWindow): HTMLInputElement {
    const input = owner.document.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement;
    input.setAttribute('aria-label', 'Independent error focus destination');
    input.style.cssText = 'position:fixed;left:0;top:0;width:220px;z-index:2147483647';
    owner.document.documentElement.append(input); outside.push(input); return input;
  }
  /** Record actual focus and native error name against the required destination. @param label Scenario. @param owner Native window. @param error Actual rendered error. @param expected Required focus destination. @param named Require the error to expose its whole message as native name. @returns Detached observation. */
  async function observe(label: string, owner: TestWindow, error: HTMLElement, expected: HTMLElement, named: boolean): Promise<void> {
    const accessible = await until(Zotero, () => service.getAccessibleFor(error), `${label} native accessible`);
    observations.push({ label, passed: owner.document.activeElement === expected && (!named || accessible.name === error.textContent),
      name: accessible.name, expectedName: error.textContent ?? '', focusedTag: owner.document.activeElement?.localName ?? null });
  }
  try {
    const mainOutside = independent(window);
    for (const moved of [false, true]) {
      const add = present(root.querySelector<HTMLButtonElement>('[data-rr-action="add"]')); add.focus(); add.click();
      const editor = await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor="create"]'), 'validation relationship editor');
      const preview = present(editor.querySelector<HTMLButtonElement>('[data-rr-action="preview"]')); preview.focus(); preview.click();
      if (moved) mainOutside.focus();
      const error = await until(Zotero, () => { const node = editor.querySelector<HTMLElement>('[role="alert"]'); return node?.textContent && node; }, 'relationship validation error');
      await observe(moved ? 'relationship preserves independent focus' : 'relationship focuses named error', window, error, moved ? mainOutside : error, !moved);
      click(editor, 'cancel'); await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.getAttribute('aria-busy') === 'false', 'validation draft canceled');
    }
    const view = await preferences(api); prefs = view.window;
    const prefsOutside = independent(prefs);
    for (const moved of [false, true]) {
      const editor = await openRule(api, view.root), preview = present(editor.querySelector<HTMLButtonElement>('[data-rr-action="preview-rule"]'));
      if (!moved) {
        const expected = present(view.root.querySelector('[data-rr-action="new-rule"]')).textContent;
        check(!!expected, 'Native New rule action has no label');
        const region = await until(Zotero, () => service.getAccessibleFor(editor), 'native named rule region');
        observations.push({ label: 'rule editor exposes named region', passed: region.name === expected,
          name: region.name, expectedName: expected, focusedTag: prefs.document.activeElement?.localName ?? null });
      }
      preview.focus(); preview.click(); if (moved) prefsOutside.focus();
      const error = await until(Zotero, () => { const node = editor.querySelector<HTMLElement>('[role="alert"]'); return node?.textContent && node; }, 'rule validation error');
      await observe(moved ? 'rule preserves independent focus' : 'rule focuses named error', prefs, error, moved ? prefsOutside : error, !moved);
      await cancelRule(api, view.root);
    }
    app.invalidateAll(); const after = await app.read('self'), manifestsAfter = await commits(api);
    check(JSON.stringify(after) === JSON.stringify(before) && manifestsAfter === count, 'Error focus/cancellation published authority');
    const report = { inputBackend: 'native DOM component activation, not OS keyboard', observations, before, after, manifestsBefore: count, manifestsAfter };
    await io.writeUTF8(`${job.data}/quality-error-focus-result.json`, JSON.stringify(report), { mode: 'create', flush: true });
    check(observations.every(value => value.passed), `Native validation error focus failed: ${JSON.stringify(observations)}`);
    return report;
  } finally { for (const input of outside) input.remove(); if (prefs && !prefs.closed) prefs.close(); }
}
