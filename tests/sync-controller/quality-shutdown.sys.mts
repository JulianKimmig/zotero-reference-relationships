/** TASK-012 matched native shutdown actions; main owns builds, wiring, paired process runs, documentation and final normal quit. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { TestWindow } from './platform-contracts.mts';
import type { DiagnosticSummary } from './quality-shutdown-diagnostics.sys.mts';
import { shutdownDiagnostics } from './quality-shutdown-diagnostics.sys.mts';
import { shutdownAddonID, shutdownGeneralPaneID, shutdownWindows, shutdownRegistrations, supportsShutdownPreferences,
  shutdownMainReady, shutdownSelect, shutdownOpenPreferences, shutdownClose } from './quality-shutdown-native.sys.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { errorMessage } from './evidence.sys.mts';
import { book } from './rules-fixtures.sys.mts';
import { check, until } from './ui-helpers.sys.mts';

/** Each receipt names a common native action and captures the actual registrations and console delta after it. */
interface ShutdownReceipt {
  action: string; cycle: number; bookIndex: number | null; selection: { itemKey: string; selectedCount: number } | null;
  registrations: ReturnType<typeof shutdownRegistrations>; diagnostics: DiagnosticSummary;
}
/** Track only sidecar-created windows pending close; release each closed window immediately. */
interface OwnedWindow { window: TestWindow; type: 'navigator:browser' | 'zotero:pref' }

/**
 * Run matched real host actions with the exact supplied XPI enabled or a fresh host that never installs it.
 * @param job Fresh unsigned-in controller job; action must be exactly quality:shutdown-plugin or quality:shutdown-baseline.
 * @param api Actual privileged Zotero/Gecko APIs; no synchronization, credentials, process launching or source replacement is used.
 * @returns Pre-quit observations only, with identical native action receipts for paired comparison; process acceptance remains pending.
 * @throws When preconditions, native actions or item selection fail, including sanitized partial receipts for diagnosis.
 */
export async function qualityShutdown(job: ControllerJob, api: NativeAPI) {
  check(job.action === 'quality:shutdown-plugin' || job.action === 'quality:shutdown-baseline', 'Unsupported quality shutdown action');
  check(typeof job.xpi === 'string' && job.xpi.length > 0, 'Matched shutdown actions require the exact production XPI');
  const { Zotero } = api, enabled = job.action === 'quality:shutdown-plugin';
  await Zotero.initializationPromise; await Zotero.uiReadyPromise;
  check(!Zotero.Users.getCurrentUserID() && job.sync !== true && !Zotero.Sync.Runner.syncInProgress, 'Shutdown actions require an unsigned-in, non-syncing profile');
  check(!Object.hasOwn(Zotero, 'ReferenceRelationships'), 'Shutdown profile already contains a plugin runtime');
  check(await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items') === 0, 'Shutdown actions require a fresh empty native profile');
  const original = shutdownWindows(api, 'navigator:browser');
  check(original.length === 1 && shutdownWindows(api, 'zotero:pref').length === 0, 'Shutdown profile must start with one main window and no preferences');
  const primary = original[0], preferencesSupported = supportsShutdownPreferences(api);
  const diagnostics = shutdownDiagnostics(api), receipts: ShutdownReceipt[] = [], setup: ShutdownReceipt[] = [], owned: OwnedWindow[] = [];
  let pendingAction = 'install-exact-xpi', pendingCycle = 0, pendingBookIndex: number | null = null;
  const titles = ['Matched shutdown book 1 — Café 你好', 'Matched shutdown book 2 — Café 你好'];
  const protocol = { version: 1, cycles: 3, books: titles,
    preferencesPane: preferencesSupported ? shutdownGeneralPaneID : null,
    preferencesOmission: preferencesSupported ? null : 'Core General pane or native opener unavailable',
    initialActions: ['create-book', 'create-book', 'select-primary-book', 'select-primary-book'],
    cycleActions: ['open-secondary-main', 'select-secondary-book', 'select-secondary-book',
      ...(preferencesSupported ? ['open-native-general-preferences', 'close-native-general-preferences'] : []), 'close-secondary-main'],
    finalActions: ['actions-complete-awaiting-controller-quit'] };
  /**
   * Record real observations only after a completed native action.
   * @param action Stable action name shared across variants.
   * @param cycle Zero for initial actions, one through three for repeated cycles.
   * @param bookIndex Fixture ordinal when the action concerns a book.
   * @param selection Actual verified selection receipt, when applicable.
   * @returns Snapshot containing real native/plugin counts and the console delta.
   */
  function receipt(action: string, cycle = 0, bookIndex: number | null = null,
    selection: ShutdownReceipt['selection'] = null): ShutdownReceipt {
    return { action, cycle, bookIndex, selection, registrations: shutdownRegistrations(api), diagnostics: diagnostics.delta() };
  }
  /** Record the real returned preference window before awaiting its initialization. @param window Native preference window. @returns Completion. */
  function ownPreferences(window: TestWindow): void { owned.push({ window, type: 'zotero:pref' }); }
  /** Release a closed native window from sidecar ownership. @param window Window already closed through native APIs. @returns Completion. */
  function release(window: TestWindow): void {
    const index = owned.findIndex(entry => entry.window === window);
    check(index >= 0 && window.closed, 'Cannot release an unowned or open shutdown window');
    owned.splice(index, 1);
  }
  try {
    let version: string | null = null;
    if (enabled) {
      const production = await resources(job, api);
      check(production.addon.id === shutdownAddonID && production.addon.isActive, 'Resources installed a different or inactive addon');
      await until(Zotero, () => Zotero.ReferenceRelationships?.state === 'running'
        && Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === 'reference-relationships-rules'), 'shutdown exact-XPI startup');
      version = Zotero.ReferenceRelationships!.version; setup.push(receipt('install-exact-xpi'));
    } else {
      const { AddonManager } = api.ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      check(await AddonManager.getAddonByID(shutdownAddonID) === null, 'Bare-host baseline must never install the plugin');
      check(shutdownRegistrations(api).relationshipPreferenceRegistrations === 0
        && shutdownRegistrations(api).relationshipSectionRegistrations === 0, 'Bare-host baseline contains plugin registrations');
      setup.push(receipt('bare-host-no-plugin-installed'));
    }
    check(Object.hasOwn(Zotero, 'ReferenceRelationships') === enabled,
      'Shutdown variant does not match actual installed addon/runtime state');
    pendingAction = 'await-primary-main';
    await shutdownMainReady(api, primary);
    const books = [];
    for (const [index, title] of titles.entries()) {
      pendingAction = 'create-book'; pendingBookIndex = index;
      books.push(await book(Zotero, title)); receipts.push(receipt('create-book', 0, index));
    }
    for (const [index, item] of books.entries()) {
      pendingAction = 'select-primary-book'; pendingBookIndex = index;
      receipts.push(receipt('select-primary-book', 0, index, await shutdownSelect(api, primary, item)));
    }
    for (let cycle = 1; cycle <= protocol.cycles; cycle++) {
      pendingAction = 'open-secondary-main'; pendingCycle = cycle; pendingBookIndex = null;
      check(shutdownWindows(api, 'navigator:browser').length === 1, 'Unexpected main-window count before matched cycle');
      Zotero.openMainWindow();
      const secondary = await until(Zotero, () => shutdownWindows(api, 'navigator:browser').find(window => window !== primary), 'shutdown actual second main window');
      owned.push({ window: secondary, type: 'navigator:browser' });
      await shutdownMainReady(api, secondary);
      check(shutdownWindows(api, 'navigator:browser').length === 2, 'Native second-window open did not register exactly two windows');
      receipts.push(receipt('open-secondary-main', cycle));
      for (const [index, item] of books.entries()) {
        pendingAction = 'select-secondary-book'; pendingBookIndex = index;
        receipts.push(receipt('select-secondary-book', cycle, index, await shutdownSelect(api, secondary, item)));
      }
      if (preferencesSupported) {
        pendingAction = 'open-native-general-preferences'; pendingBookIndex = null;
        const preferences = await shutdownOpenPreferences(api, ownPreferences);
        check(shutdownWindows(api, 'zotero:pref').length === 1, 'Native General preferences open did not register exactly one window');
        receipts.push(receipt('open-native-general-preferences', cycle));
        pendingAction = 'close-native-general-preferences';
        await shutdownClose(api, preferences, 'zotero:pref');
        release(preferences);
        receipts.push(receipt('close-native-general-preferences', cycle));
      }
      pendingAction = 'close-secondary-main'; pendingBookIndex = null;
      await shutdownClose(api, secondary, 'navigator:browser');
      release(secondary);
      receipts.push(receipt('close-secondary-main', cycle));
    }
    pendingAction = 'actions-complete-awaiting-controller-quit'; pendingCycle = 0;
    await Zotero.DB.waitForTransaction(); await Zotero.Promise.delay(0);
    receipts.push(receipt('actions-complete-awaiting-controller-quit'));
    check(!primary.closed && shutdownWindows(api, 'navigator:browser').length === 1
      && shutdownWindows(api, 'navigator:browser')[0] === primary && shutdownWindows(api, 'zotero:pref').length === 0,
    'Matched actions did not leave the original main window for controller-owned normal quit');
    check(diagnostics.cumulative().pluginErrors.length === 0,
      `Native plugin lifecycle reported errors: ${JSON.stringify(diagnostics.cumulative().pluginErrors)}`);
    return { action: job.action, variant: enabled ? 'plugin-enabled' : 'bare-host-never-installed',
      addon: { id: shutdownAddonID, version, isActive: enabled, installedVia: enabled ? 'resources(job, api)' : null },
      protocol, setup, receipts, initialDiagnostics: diagnostics.initial, actionDiagnostics: diagnostics.cumulative(),
      finalRegistrations: shutdownRegistrations(api), status: 'actions-complete-process-exit-pending',
      finalQuitOwner: 'normal-controller', processExitObserved: false,
      diagnosticBoundary: 'Console subscription ends before controller final quit; runner must retain final console/process logs',
      diagnosticTextPolicy: 'General events retain allowlisted signatures/counts; suspected plugin errors retain native diagnostic details in this verified unsigned-in synthetic fixture',
      baselineBoundary: 'Plugin variant installs the exact XPI; bare-host baseline never installs it; native actions are otherwise identical' };
  } catch (error) {
    // Keep arbitrary exception messages out of evidence; filtered native console details remain available above.
    const failure = error instanceof Error && ['Error', 'TypeError', 'ReferenceError', 'RangeError'].includes(error.name) ? error.name : 'NativeActionFailure';
    const cleanup: { type: OwnedWindow['type']; closed: boolean }[] = [];
    for (const entry of [...owned].reverse()) if (!entry.window.closed) {
      try { await shutdownClose(api, entry.window, entry.type); cleanup.push({ type: entry.type, closed: true }); }
      catch { cleanup.push({ type: entry.type, closed: false }); }
    }
    throw new Error(JSON.stringify({ failure, message: errorMessage(error), action: job.action, status: 'native-actions-failed-process-exit-pending',
      pendingAction, pendingCycle, pendingBookIndex, cleanup,
      protocol, setup, receipts, initialDiagnostics: diagnostics.initial, actionDiagnostics: diagnostics.cumulative(),
      finalRegistrations: shutdownRegistrations(api) }));
  } finally {
    diagnostics.stop();
  }
}
