/** Observe real external notifier and native delay calls while forwarding every operation unchanged. */
import type { NativeAPI } from './native-api.mts';
import { check } from './ui-helpers.sys.mts';

/** Install scoped external-boundary tracing before addon installation; no production method or callback is replaced. @param api Real Zotero resource APIs. @returns Registration/timer observations, one-shot next-yield notification and explicit restoration of original external methods. */
export function resourceTrace(api: NativeAPI) {
  const { Zotero } = api, notifier = Zotero.Notifier;
  const register = notifier.registerObserver, unregister = notifier.unregisterObserver, delay = Zotero.Promise.delay;
  const active = new Set<string>(), pending = new Set<object>();
  const registrations: string[] = [], removals: string[] = [];
  let scheduled = 0, fulfilled = 0, rejected = 0, next: (() => void) | null = null;
  /** Forward the actual native registration and retain only this plugin's returned observer ID. @param observer Actual source callback object. @param kinds Native notification kinds. @param name Native observer label. @returns Original native observer ID. */
  notifier.registerObserver = function(observer, kinds, name) {
    const id = register.call(notifier, observer, kinds, name);
    if (name === 'reference-relationships-ui') { check(!active.has(id), 'Duplicate live native observer ID'); active.add(id); registrations.push(id); }
    return id;
  };
  /** Forward native removal before recording release of the actual registered ID. @param id Native observer ID. @returns Original native completion. */
  notifier.unregisterObserver = function(id) {
    const result = unregister.call(notifier, id);
    if (active.delete(id)) removals.push(id);
    return result;
  };
  /** Return the original native delay promise; observe only calls whose actual stack includes the packaged scheduler owner. @param milliseconds Native timer duration. @returns Original actual timer promise without changing duration or resolution. */
  Zotero.Promise.delay = function(milliseconds) {
    const stack = new Error().stack; check(typeof stack === 'string', 'Native call stacks unavailable for timer ownership');
    const promise = delay.call(Zotero.Promise, milliseconds);
    if (stack.includes('/src/runtime/plugin.mjs')) {
      const token = {}; pending.add(token); scheduled++;
      promise.then(() => { pending.delete(token); fulfilled++; }, () => { pending.delete(token); rejected++; });
      const notify = next; next = null; if (notify) notify();
    }
    return promise;
  };
  return {
    /** Observe actual external registrations and fulfilled/rejected native scheduling requests. @returns Detached scalar/ID evidence, without retaining source observers, windows or promises. */
    snapshot() { return { activeObservers: [...active], registrations: [...registrations], removals: [...removals],
      scheduled, fulfilled, rejected, pendingTimers: pending.size }; },
    /** Wait for one actual packaged scheduler call, without changing or holding its real timer. @returns Notification as soon as the next source-owned native delay is requested. */
    nextYield(): Promise<void> {
      check(next === null, 'A native yield observation is already pending');
      return new Promise(resolve => { next = resolve; });
    },
    /** Restore only the original external methods after all owned test work has settled. @returns Completion. */
    restore(): void { notifier.registerObserver = register; notifier.unregisterObserver = unregister; Zotero.Promise.delay = delay; next = null; },
  };
}
