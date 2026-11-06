/** Native component focus checks precede the full OS-keyboard workflow and never substitute for it. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { book, commits, ref } from './rules-fixtures.sys.mts';
import { check, click, selectPane, type, until } from './ui-helpers.sys.mts';
import { present, readyState } from './evidence.sys.mts';
import type { FormControl } from '../../src/ui/contracts.mts';

/** Actual focus observation records control identities without bibliographic or account contents. */
interface FocusObservation { label: string; passed: boolean; action: string | null; tag: string | null }

/** Exercise entry/cancel/confirmed-save focus using real DOM activation rather than claiming keyboard input. @param job Fresh unsigned-in profile and exact artifact. @param api Native host and actual application/UI. @returns Recorded focus, no-write cancellation and three exact confirmed publications after setup; failed expectations retain a checkpoint before throwing. */
export async function qualityFocus(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Focus checks require a fresh unsigned-in client');
  await resources(job, api);
  const app = present(Zotero.ReferenceRelationships).application;
  check((await app.read('self')).state === 'uninitialized', 'Focus fixture authority must start empty');
  const a = await book(Zotero, `${job.marker} focus source Café 你好`);
  const b = await book(Zotero, `${job.marker} focus target`);
  const draft = await app.draftCreate({ source: ref(a), target: ref(b), type: 'referencing', metadata: { note: 'Native focus setup' } });
  await app.applyFromEvent(draft.command, draft.expectedRevision);
  const before = await app.read('self'), count = await commits(api);
  const window = Zotero.getMainWindow(), document = window.document, root = await selectPane(Zotero, window, a);
  const outside = document.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement;
  outside.setAttribute('aria-label', 'Independent native focus destination');
  outside.style.cssText = 'position:fixed;top:0;left:0;width:200px;z-index:2147483647';
  document.documentElement.append(outside);
  const observations: FocusObservation[] = [];
  /** Snapshot the actual native active element against a connected expected target. @param label Component transition. @param expected Live focus destination. @returns Appends a direct focus observation. */
  function observe(label: string, expected: HTMLElement): void {
    const active = document.activeElement as HTMLElement | null;
    observations.push({ label, passed: active === expected && expected.isConnected,
      action: active?.getAttribute('data-rr-action') ?? null, tag: active?.localName ?? null });
  }
  try {
    const cases = [
      { mode: 'create', action: 'add', first: 'choose-target', outside: false },
      { mode: 'edit', action: 'edit', first: 'choose-source', outside: false },
      { mode: 'remove', action: 'remove', first: 'cancel', outside: false },
      { mode: 'create', action: 'add', first: 'choose-target', outside: true },
    ];
    for (const entry of cases) {
      const action = present(root.querySelector<HTMLButtonElement>(`[data-rr-action="${entry.action}"]`));
      action.focus(); check(document.activeElement === action, 'Native component focus precondition failed');
      action.click();
      const editor = await until(Zotero, () => root.querySelector<HTMLElement>(`[data-rr-editor="${entry.mode}"]`), `${entry.mode} editor for focus`);
      observe(`enter-${entry.mode}`, present(editor.querySelector<HTMLButtonElement>(`[data-rr-action="${entry.first}"]`)));
      const cancel = present(editor.querySelector<HTMLButtonElement>('[data-rr-action="cancel"]'));
      if (entry.outside) outside.focus(); else cancel.focus();
      cancel.click();
      await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.getAttribute('aria-busy') === 'false', 'cancel focus refresh');
      observe(entry.outside ? 'preserve-independent-focus' : `restore-${entry.action}`,
        entry.outside ? outside : present(root.querySelector<HTMLButtonElement>(`[data-rr-action="${entry.action}"]`)));
    }
    app.invalidateAll(); const afterCancellation = await app.read('self'), cancellationCount = await commits(api);
    check(JSON.stringify(before) === JSON.stringify(afterCancellation) && cancellationCount === count, 'Focus cancellations published relationship authority');
    const original = readyState(before).snapshot.assertions[0];
    for (const moved of [false, true]) {
      const edit = present(root.querySelector<HTMLButtonElement>('[data-rr-action="edit"]')); edit.focus(); edit.click();
      const editor = await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor="edit"]'), 'edit before focus save');
      type(window, editor.querySelector<FormControl>('[data-rr-field="note"]'), moved ? 'Saved with independent focus' : 'Saved with editor focus');
      click(editor, 'preview');
      const save = await until(Zotero, () => {
        const control = editor.querySelector<HTMLButtonElement>('[data-rr-action="save"]'); return control && !control.disabled && control;
      }, 'reviewed focus save');
      const entered = Zotero.Promise.defer(), release = Zotero.Promise.defer();
      const held = moved ? Zotero.DB.executeTransaction(async function holdNativeFocusSave() { entered.resolve(); await release.promise; }) : null;
      try {
        if (held) await entered.promise;
        save.focus(); save.click();
        if (held) {
          await until(Zotero, () => editor.getAttribute('aria-busy') === 'true' && save.disabled, 'save started before independent focus');
          outside.focus(); check(document.activeElement === outside, 'Independent pending-save focus precondition failed');
        }
      } finally { if (held) { release.resolve(); await held; } }
      await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.getAttribute('aria-busy') === 'false', 'completed focus save');
      observe(moved ? 'preserve-independent-focus-during-save' : 'return-edit-after-save',
        moved ? outside : present(root.querySelector<HTMLButtonElement>('[data-rr-action="edit"]')));
      const saved = readyState(await app.read('self'));
      check(saved.snapshot.assertions.length === 1 && saved.snapshot.assertions[0].id === original.id
        && saved.snapshot.assertions[0].metadata.note === (moved ? 'Saved with independent focus' : 'Saved with editor focus'), 'Focus save lost the actual assertion or metadata');
    }
    const remove = present(root.querySelector<HTMLButtonElement>('[data-rr-action="remove"]')); remove.focus(); remove.click();
    const removal = await until(Zotero, () => root.querySelector<HTMLElement>('[data-rr-editor="remove"]'), 'focus removal confirmation');
    const confirm = await until(Zotero, () => {
      const control = removal.querySelector<HTMLButtonElement>('[data-rr-action="save"]'); return control && !control.disabled && control;
    }, 'reviewed removal confirmation');
    confirm.focus(); confirm.click();
    await until(Zotero, () => !root.querySelector('[data-rr-editor]') && root.getAttribute('aria-busy') === 'false', 'completed focus removal');
    observe('return-add-after-confirmed-removal', present(root.querySelector<HTMLButtonElement>('[data-rr-action="add"]')));
    app.invalidateAll(); const after = readyState(await app.read('self')), afterCount = await commits(api);
    check(after.snapshot.assertions.length === 0 && afterCount === count + 3, 'Confirmed focus actions did not publish exactly two edits and one removal');
    const report = { inputBackend: 'native DOM button activation, not an OS keyboard journey', observations,
      cancellationDidNotPublish: true, afterCancellation, confirmedPublications: 3, before, after, manifestsBefore: count, manifestsAfter: afterCount };
    await present(api.IOUtils).writeUTF8(`${present(job.data)}/quality-focus-result.json`, JSON.stringify(report), { mode: 'create', flush: true });
    check(observations.every(value => value.passed), `Native component focus expectations failed: ${JSON.stringify(observations)}`);
    return report;
  } finally { outside.remove(); }
}
