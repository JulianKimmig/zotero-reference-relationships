/** Real packaged UI/application fixtures and detached-DOM observations for listener lifetime regressions. */
import type { Draft, Review } from '../../src/application/contracts.mts';
import type { Graph } from '../../src/domain/contracts.mts';
import type { RelationshipView } from '../../src/ui/view.mts';
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { TestItem } from './platform-contracts.mts';
import { present, readyState } from './evidence.sys.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { applyOne, book, change, commits, ref, rule } from './rules-fixtures.sys.mts';
import { preferences } from './rule-preferences-helpers.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Typed additions load genuine packaged modules without modifying shared controller wiring. */
type LifetimeLoader = NativeAPI['ChromeUtils'] & {
  importESModule(uri: `resource://${string}/src/ui/rule-preview.mjs`): typeof import('../../src/ui/rule-preview.mts');
  importESModule(uri: `resource://${string}/src/ui/rule-controls.mjs`): typeof import('../../src/ui/rule-controls.mts');
  importESModule(uri: `resource://${string}/src/ui/view.mjs`): typeof import('../../src/ui/view.mts');
};

/** One real click observation; changed detached DOM demonstrates a still-active retired handler, not GC reachability. */
export interface LifetimeObservation {
  label: string; changed: boolean; before: number; after: number;
}

/**
 * Click one enabled retired pagination control and observe its actual owning DOM.
 * @param root Detached native card, explanation or complete preview being observed.
 * @param action Enabled native control retained before its owner was removed.
 * @param label Diagnostic naming the lifecycle boundary.
 * @param selector Native rows whose before/after counts aid failure diagnosis.
 * @returns Direct DOM mutation evidence; no handler, signal or source implementation is inspected.
 */
export function detachedObservation(root: HTMLElement, action: HTMLButtonElement, label: string, selector: string): LifetimeObservation {
  check(!root.isConnected && !action.isConnected && root.contains(action), `${label}: expected detached owned native controls`);
  check(!action.disabled, `${label}: a disabled control cannot prove listener retirement`);
  const html = root.innerHTML, before = root.querySelectorAll(selector).length;
  action.click();
  return { label, changed: root.innerHTML !== html, before, after: root.querySelectorAll(selector).length };
}

/**
 * Find the currently usable direction on an actual multipage support list.
 * @param root Real card or explanation, including a deliberately retained detached instance.
 * @returns Enabled native button; fails if the fixture cannot exercise a support listener.
 */
export function supportAction(root: HTMLElement): HTMLButtonElement {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-rr-action="support-next"],[data-rr-action="support-previous"]')];
  return present(buttons.find(button => !button.disabled));
}

/**
 * Compose real packaged UI against native storage with 26 impacts and 26 supports per impact.
 * @param job Main-owned fresh anonymous native job with the exact production XPI.
 * @param api Privileged native resources; no client launch, sync or external credentials are used here.
 * @returns Owned DOM/view, genuine pending rule review and explicit cleanup for every test path.
 */
export async function lifetimeFixture(job: ControllerJob, api: NativeAPI) {
  const production = await resources(job, api), { Zotero } = api;
  const app = present(Zotero.ReferenceRelationships).application;
  check((await app.read('self')).state === 'uninitialized', 'Lifetime tests require a fresh anonymous authority');
  const books: TestItem[] = [];
  for (let index = 0; index < 7; index++) books.push(await book(Zotero, `${job.marker} lifetime endpoint ${index}`));
  const draft = await app.draftCreate({ source: ref(books[0]), target: ref(books[1]), type: 'referencing', metadata: { note: 'Lifetime Café 你好' } });
  const graph = draft.command.snapshot, timestamp = graph.assertions[0].createdAt;
  for (const source of books) for (const target of books) {
    if (source === target || (source === books[0] && target === books[1]) || graph.assertions.length === 26) continue;
    graph.assertions.push({ id: `lifetime-root-${graph.assertions.length}`, source: ref(source), target: ref(target),
      type: 'referencing', metadata: { note: 'Lifetime Café 你好' }, createdAt: timestamp, updatedAt: timestamp });
  }
  await applyOne(api, draft);
  const before: Graph = readyState(await app.read('self')).snapshot;
  const rules: Draft = await change(app, snapshot => {
    for (let index = 0; index < 26; index++) snapshot.rules.push(rule(`lifetime-rule-${String(index).padStart(2, '0')}`));
  });
  const review: Review = await app.preview(rules.command, rules.expectedRevision);
  check(review.changeSet.derived?.added.length === 26 && review.changeSet.derived.added.every(edge => edge.supports.length === 26),
    'Lifetime fixture did not produce two impact pages with two support pages per edge');
  const loader = api.ChromeUtils as LifetimeLoader;
  const { rulePreview } = loader.importESModule('resource://rr-reconciliation-production/src/ui/rule-preview.mjs');
  const { ruleLabels } = loader.importESModule('resource://rr-reconciliation-production/src/ui/rule-controls.mjs');
  const { RelationshipView } = loader.importESModule('resource://rr-reconciliation-production/src/ui/view.mjs');
  const window = Zotero.getMainWindow(), document = window.document, t = await ruleLabels(document);
  const host = document.createElementNS('http://www.w3.org/1999/xhtml', 'section');
  host.style.cssText = 'display:block;min-width:400px'; document.documentElement.append(host);
  const errors: unknown[] = [], views: RelationshipView[] = [];
  /**
   * Construct an owned production view with real host navigation and preference callbacks.
   * @returns Native RelationshipView; the caller selects/renders and may repeatedly dispose it.
   */
  function createView(): RelationshipView {
    const body = document.createElementNS('http://www.w3.org/1999/xhtml', 'section'); host.append(body);
    const view = new RelationshipView({ body, window, Zotero, app, gateway: production.gateway, dialogs: new Set(),
      /** Refresh through the actual production render entry point. @returns Native render completion. */
      async refresh() { await view.render(); },
      /** Retain actual UI failures for the test result. @param error Native failure. @returns Completion. */
      report(error: unknown) { errors.push(error); },
      /** Open real host preferences for the selected scope. @param library Portable scope. @returns Mount completion. */
      async openRules(library: string) { await preferences(api, library); } });
    views.push(view); return view;
  }
  return { api, app, books, before, rules, review, window, document, t, host, errors, createView, rulePreview,
    /** Remove only test-owned native DOM and repeatedly retire every constructed view. @returns Completion. */
    dispose(): void { for (const view of views) { view.dispose(); view.dispose(); } host.remove(); } };
}

/** Complete native fixture shared by the independent impact and Explain regressions. */
export type LifetimeFixture = Awaited<ReturnType<typeof lifetimeFixture>>;

/**
 * Require previews and retired control clicks to leave real native authority untouched.
 * @param fixture Real native application and DOM fixture.
 * @param operation Actual behavioral test to execute between native observations.
 * @returns The operation's result after exact read/head and saved-manifest count verification.
 */
export async function withoutPublication<T>(fixture: LifetimeFixture, operation: () => Promise<T>): Promise<T> {
  const before = JSON.stringify(await fixture.app.read('self')), count = await commits(fixture.api);
  const result = await operation();
  fixture.app.invalidateAll();
  check(JSON.stringify(await fixture.app.read('self')) === before && await commits(fixture.api) === count,
    'Listener lifetime interactions unexpectedly published or changed native authority');
  return result;
}
