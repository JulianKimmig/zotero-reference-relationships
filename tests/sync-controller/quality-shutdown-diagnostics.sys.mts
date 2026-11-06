/** Native console signatures and suspected plugin error details from verified unsigned-in shutdown fixtures; final exit belongs to the runner. */
import type { NativeAPI } from './native-api.mts';

/** Independent diagnostic categories may overlap for one native console event. */
type Category = 'core-window' | 'tagSelector' | 'leak' | 'ReferenceRelationships-exception';
/** XPConnect console messages are observed directly without changing the console or production logging. */
interface ConsoleMessage { message: string; errorMessage?: string; sourceName?: string; lineNumber?: number; flags?: number }
/** Native nsIConsoleListener implementation; observe receives an actual platform message. */
interface ConsoleListener {
  /** Use Gecko's actual generated interface query. @param iid Requested native interface. @returns Native interface object. */
  QueryInterface(iid: object): object;
  /** Count an actual native console message. @param message Platform console event. @returns Completion. */
  observe(message: ConsoleMessage): void;
}
/** Existing Gecko console capabilities omitted from the shared controller's minimal read-only type. */
interface ConsoleService {
  /** Read existing buffered events. @returns Actual native console messages. */
  getMessageArray(): ConsoleMessage[];
  /** Subscribe without replacing console methods. @param listener Owned observer. @returns Completion. */
  registerListener(listener: ConsoleListener): void;
  /** Release the owned observer. @param listener Previously subscribed observer. @returns Completion. */
  unregisterListener(listener: ConsoleListener): void;
}
/** Only fixed allowlisted signatures are retained; arbitrary native message content never enters evidence. */
interface DiagnosticEntry { categories: Category[]; signature: string; count: number }
/** Counts describe events, with separate overlapping category counts and aggregated sanitized signatures. */
export interface DiagnosticSummary {
  consoleMessages: number; filteredMessages: number;
  counts: Record<Category, number>; entries: DiagnosticEntry[];
  pluginErrors: { message: string; source: string | null; line: number | null; flags: number | null }[];
}

/** Create independent counters. @returns Empty event summary without shared mutable state. */
function emptySummary(): DiagnosticSummary {
  return { consoleMessages: 0, filteredMessages: 0,
    counts: { 'core-window': 0, tagSelector: 0, leak: 0, 'ReferenceRelationships-exception': 0 }, entries: [], pluginErrors: [] };
}

/**
 * Classify native events; preserve fixed signatures plus actual suspected plugin diagnostics in the caller's unsigned-in synthetic fixture.
 * @param summary Owned counters to update.
 * @param message Actual console event; only suspected plugin errors retain their message/source/line/flags.
 * @returns Completion; general events retain fixed signatures rather than arbitrary text.
 */
function record(summary: DiagnosticSummary, message: ConsoleMessage): void {
  summary.consoleMessages++;
  const text = message.message, categories: Category[] = [];
  if (/ZoteroPane|zoteroPane\.(?:js|xhtml)|core[- ]window|navigator:browser|onMainWindow(?:Load|Unload)/i.test(text)) categories.push('core-window');
  if (/tag[-_ ]?selector/i.test(text)) categories.push('tagSelector');
  if (/\bleak(?:ed|ing|s)?\b|\b(?:detached|retained)[ -]windows?\b/i.test(text)) categories.push('leak');
  if (/Reference[ -]?Relationships|reference-relationships|\brr-(?:reconciliation|quality)-/i.test(text)
    && /\b(?:[A-Za-z]*Error|exception|error)\b/i.test(text)) categories.push('ReferenceRelationships-exception');
  if (!categories.length) return;
  if (categories.includes('ReferenceRelationships-exception')) summary.pluginErrors.push({
    message: message.errorMessage === undefined ? text : message.errorMessage,
    source: message.sourceName === undefined ? null : message.sourceName,
    line: message.lineNumber === undefined ? null : message.lineNumber, flags: message.flags === undefined ? null : message.flags,
  });
  const identifiers = [/\bTypeError\b/, /\bReferenceError\b/, /\bNS_ERROR_[A-Z_]+\b/, /\bSyntaxError\b/, /\bRangeError\b/,
    /\bZoteroPane\b/, /\btagSelector\b/i, /\buninit\b/, /\bonUnload\b/, /\bonMainWindowUnload\b/,
    /\bremoveWindow\b/, /\bReferenceRelationships\b/, /\bleaked\b/i, /\bwindows?\b/i, /\bexception\b/i];
  // Store fixed labels, rather than matching substrings that might contain private text.
  const labels = ['TypeError', 'ReferenceError', 'NS_ERROR', 'SyntaxError', 'RangeError', 'ZoteroPane', 'tagSelector',
    'uninit', 'onUnload', 'onMainWindowUnload', 'removeWindow', 'ReferenceRelationships', 'leaked', 'window', 'exception'];
  const signature = identifiers.flatMap((pattern, index) => pattern.test(text) ? [labels[index]] : []).join(';') || categories.join(';');
  for (const category of categories) summary.counts[category]++;
  summary.filteredMessages++;
  const existing = summary.entries.find(entry => entry.signature === signature && entry.categories.join() === categories.join());
  if (existing) existing.count++; else summary.entries.push({ categories, signature, count: 1 });
}

/**
 * Observe real console deltas without losing identical messages when Gecko's ring buffer rotates.
 * @param api Actual native console service; no listener or logging implementation is replaced.
 * @returns Initial buffered counts, per-checkpoint deltas, cumulative action counts and explicit listener disposal.
 */
export function shutdownDiagnostics(api: NativeAPI) {
  const console = api.Services.console as ConsoleService;
  const chrome = api.ChromeUtils as NativeAPI['ChromeUtils'] & {
    /** Generate actual XPConnect interface support. @param interfaces Native interface names. @returns Native QueryInterface implementation. */
    generateQI(interfaces: readonly string[]): ConsoleListener['QueryInterface'];
  };
  const initial = emptySummary(), cumulative = emptySummary();
  let pending = emptySummary();
  const listener: ConsoleListener = {
    QueryInterface: chrome.generateQI(['nsIConsoleListener']),
    /** Consume one real console notification. @param message Actual platform event. @returns Completion. */
    observe(message) { record(pending, message); record(cumulative, message); },
  };
  console.registerListener(listener);
  try { for (const message of console.getMessageArray()) record(initial, message); }
  catch (error) { console.unregisterListener(listener); throw error; }
  return { initial,
    /** Detach counters since the prior checkpoint. @returns Sanitized actual event delta. */
    delta(): DiagnosticSummary { const result = pending; pending = emptySummary(); return result; },
    /** Read all events since subscription. @returns Sanitized cumulative action counts. */
    cumulative(): DiagnosticSummary { return cumulative; },
    /** Remove only this sidecar's listener. @returns Completion. */
    stop(): void { console.unregisterListener(listener); },
  };
}
