/** Native transfer UI resources use real production services and files; only the external dialog chooses deterministic paths. */
import { resources } from './reconciliation-fixtures.sys.mts';
import { check, click, until, type } from './ui-helpers.sys.mts';
import { present } from './evidence.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TransferPanel } from '../../src/ui/transfer-panel.mts';
import type { ExportEnvelope } from '../../src/transfer/contracts.mts';
import type { NativeWindow } from '../../src/adapters/native-contracts.mts';

/** Add typed native production imports without changing the shared controller loader. */
export type TransferUILoader = NativeAPI['ChromeUtils'] & {
  importESModule(uri: `resource://${string}/src/ui/transfer-panel.mjs`): typeof import('../../src/ui/transfer-panel.mts');
  importESModule(uri: `resource://${string}/src/adapters/picker.mjs`): typeof import('../../src/adapters/picker.mts');
};

/** Construct the actual UI in a connected native document and actual anonymous storage. @param {object} job Fresh native phase. @param {object} api Actual native capabilities. @returns {Promise<object>} Owned fixtures and disposal. */
export async function transferUIFixture(job: ControllerJob, api: NativeAPI) {
  const production = await resources(job, api), { Zotero, DOMParser, crypto, TextEncoder } = api;
  const loader = api.ChromeUtils as TransferUILoader;
  const { TransferPanel } = loader.importESModule('resource://rr-reconciliation-production/src/ui/transfer-panel.mjs');
  const { TransferService } = loader.importESModule('resource://rr-reconciliation-production/src/transfer/service.mjs');
  const { createRepositoryFactory } = loader.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const { createTransferFiles } = loader.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-files.mjs');
  const { createTransferIdentity } = loader.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-identity.mjs');
  const factory = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway: production.gateway });
  const files = createTransferFiles({ io: present(api.IOUtils), digest: factory.digest });
  const identity = createTransferIdentity({ Zotero, gateway: production.gateway }), app = Zotero.ReferenceRelationships!.application;
  const transfer = new TransferService({ gateway: production.gateway, identity, files, digest: factory.digest,
    repositoryFor: factory.repositoryFor, repositoryForEvent: factory.repositoryForEvent,
    now: () => new Date().toISOString(), invalidate: scope => app.invalidate(scope), yieldToHost: () => Zotero.Promise.delay(0) });
  const window = Zotero.getMainWindow(), root = window.document.createElementNS('http://www.w3.org/1999/xhtml', 'section') as HTMLElement;
  window.document.documentElement.append(root);
  const paths: (string | null | Promise<string | null>)[] = [], calls: string[] = [], errors: unknown[] = [];
  const panel = new TransferPanel({ window, root, Zotero, app, gateway: production.gateway, transfer, identity, files,
    picker: {
      /** Simulate only the external dialog response; actual file and application operations remain native. @param {Window} owner Native window. @param {string} operation Requested dialog mode. @returns {Promise<string|null>} Explicit test path or cancellation. */
      async choose(owner: NativeWindow, operation: 'import' | 'export' | 'backup') {
        check(owner === window, 'Picker lost its native window'); calls.push(operation);
        check(paths.length > 0, 'Unexpected picker request'); return await paths.shift()!;
      },
    }, report: (error: unknown) => errors.push(error) });
  await panel.load('self');
  return { api, job, production, factory, files, identity, transfer, app, window, root, panel, paths, calls, errors,
    /** Dispose this test's listeners, tokens, native DOM and factory references. @returns {void} */
    dispose() { panel.dispose(); transfer.stop(); factory.clear(); root.remove(); } };
}

/** Actual native fixture type shared by independent behavioral journeys. */
export type TransferUIFixture = Awaited<ReturnType<typeof transferUIFixture>>;

/** Read an actual named accessible transfer button. @param {Element} root UI. @param {string} action Stable action. @returns {HTMLButtonElement} Native control. */
export function action(root: HTMLElement, action: string) {
  return present(root.querySelector<HTMLButtonElement>(`[data-rr-action="transfer-${action}"]`));
}

/** Wait for all owned async UI work to settle. @param {object} fixture Native UI fixture. @returns {Promise<void>} UI no longer busy. */
export async function settled(fixture: TransferUIFixture) {
  await until(fixture.api.Zotero, () => fixture.root.getAttribute('aria-busy') === 'false', 'transfer UI settled');
}

/** Open the actual advanced-key disclosure before editing its native control. @param {object} fixture Real window/resources. @param {Element} input Owned advanced key control. @param {string} value Explicit manual key. @returns {void} Native control edited through input/change events. */
export function advancedKey(fixture: TransferUIFixture, input: HTMLInputElement | null, value: string): void {
  const control = present(input), details = present(control.closest('details')); details.open = true;
  type(fixture.window, control, value);
}

/** Choose an actual validated native file through the UI. @param {object} fixture Native UI. @param {string} path Actual existing input. @returns {Promise<void>} Complete mapping form visible. */
export async function openImport(fixture: TransferUIFixture, path: string) {
  fixture.paths.push(path); click(fixture.root, 'transfer-import');
  await until(fixture.api.Zotero, () => fixture.root.querySelector('[data-rr-transfer-mapping]'), 'complete transfer mapping');
  await settled(fixture);
}

/** Prepare a reviewed import with the exact visible operation/mapping. @param {object} fixture Native UI. @returns {Promise<void>} Complete review mounted. */
export async function preview(fixture: TransferUIFixture) {
  click(fixture.root, 'transfer-preview');
  await until(fixture.api.Zotero, () => fixture.root.querySelector('[data-rr-transfer-review]'), 'complete native transfer review');
  await settled(fixture);
}

/** Read every bounded review page as literal native DOM text, selecting one report category. @param {object} fixture Native UI. @param {string} category Exact report category. @returns {string} Complete category text. */
export function reviewText(fixture: TransferUIFixture, category: string) {
  const { root, window } = fixture;
  type(window, root.querySelector<HTMLSelectElement>('[data-rr-transfer-review-category]'), category);
  let text = '';
  for (let page = 0; page < 10000; page++) {
    const rows = root.querySelectorAll('[data-rr-transfer-review-value]');
    check(rows.length <= 25, 'Transfer review mounted an unbounded page');
    text += [...rows].map(row => row.textContent).join('\n');
    if (action(root, 'review-next').disabled) return text;
    click(root, 'transfer-review-next');
  }
  throw new Error('Transfer review paging did not terminate');
}

/** Save one incoming document exclusively using the real production file adapter. @param {object} fixture Native resources. @param {object} document Complete envelope. @param {string} name Unique filename. @returns {Promise<string>} Actual native path. */
export async function inputFile(fixture: TransferUIFixture, document: ExportEnvelope, name: string) {
  const path = `${present(fixture.job.data)}/${name}.json`; await fixture.files.writeNew(path, document); return path;
}

/** Expose the source class type for the main controller's typed route. */
export type NativeTransferPanel = TransferPanel;
