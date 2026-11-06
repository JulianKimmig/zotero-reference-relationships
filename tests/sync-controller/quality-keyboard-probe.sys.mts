/** Verify real XTEST keyboard delivery into Gecko using only an owned temporary test section in the actual main window. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { present } from './evidence.sys.mts';
import { commits } from './rules-fixtures.sys.mts';
import { check, until } from './ui-helpers.sys.mts';

/** Captured key transitions retain real event trust, target and focus rather than manufactured control state. */
export interface KeyboardTransition {
  type: string; key: string; target: string; focused: string; isTrusted: boolean; repeat: boolean;
}
/** Observable native control behavior required to accept this backend delivery probe. */
export interface KeyboardObservations {
  keys: KeyboardTransition[]; inputs: { isTrusted: boolean; value: string }[];
  clicks: { isTrusted: boolean }[]; value: string; focused: string; windowFocused: boolean;
}

/** Require the complete actual OS sequence and native default actions. @param evidence Captured native events and final state. @returns Throws if input, Tab navigation, trusted activation or window focus is missing. */
export function validateKeyboardObservations(evidence: KeyboardObservations): void {
  const expected = [
    ['keydown', 'a', 'input'], ['keyup', 'a', 'input'], ['keydown', 'Tab', 'input'],
    ['keyup', 'Tab', 'button'], ['keydown', ' ', 'button'], ['keyup', ' ', 'button'],
  ];
  check(evidence.keys.length === expected.length, 'Keyboard probe requires all six key transitions');
  evidence.keys.forEach((event, index) => {
    const [type, key, target] = expected[index];
    check(event.type === type && event.key === key && event.target === target && event.focused === target
      && event.isTrusted && !event.repeat, `Keyboard probe unexpected key transition ${index}: ${JSON.stringify(event)}`);
  });
  check(evidence.inputs.length === 1 && evidence.inputs[0].isTrusted && evidence.inputs[0].value === 'a'
    && evidence.value === 'a', 'Keyboard probe requires actual trusted input a');
  check(evidence.clicks.length === 1 && evidence.clicks[0].isTrusted, 'Keyboard probe requires exactly one trusted Space click');
  check(evidence.focused === 'button' && evidence.windowFocused, 'Keyboard probe lost native window or Tab button focus');
}

/** Install the exact addon and observe a bounded backend probe without modifying product UI or authority. @param job Unsigned-in artifact-bound job; data and marker identify the owned exchange. @param api Actual privileged Gecko/Zotero resources. @returns Native key/control evidence and unchanged app.read/manifests; rejects unknown APIs, focus problems and timeouts. */
export async function qualityKeyboardProbe(job: ControllerJob, api: NativeAPI) {
  const { Zotero, Services } = api;
  check(job.action === 'quality:keyboard-probe', 'Unknown native keyboard probe action');
  check(!Zotero.Users.getCurrentUserID(), 'Keyboard probe requires unsigned-in client');
  check(job.data === Zotero.DataDirectory.dir && job.data.startsWith('/'), 'Keyboard probe requires exact owned client data');
  check(/^[a-f0-9-]{36}$/.test(job.marker), 'Keyboard probe requires unique exchange marker');
  const io = present(api.IOUtils), exchange = `${job.data}/keyboard-probe`;
  check(typeof io.writeUTF8 === 'function' && typeof Services.env.get === 'function', 'Native ready writer/environment APIs unavailable');
  const production = await resources(job, api), app = present(Zotero.ReferenceRelationships).application;
  check(production.addon.isActive, 'Exact keyboard probe addon is inactive');
  app.invalidateAll();
  const before = await app.read('self'), manifestCountBefore = await commits(api);
  const window = Zotero.getMainWindow(), document = window.document, previousTitle = document.title;
  check(!!document.documentElement && typeof document.hasFocus === 'function'
    && typeof window.focus === 'function', 'Native main window/focus APIs unavailable');
  const section = document.createElementNS('http://www.w3.org/1999/xhtml', 'section');
  const input = document.createElementNS('http://www.w3.org/1999/xhtml', 'input') as HTMLInputElement;
  const button = document.createElementNS('http://www.w3.org/1999/xhtml', 'button') as HTMLButtonElement;
  section.id = `rr-keyboard-probe-${job.marker}`;
  section.setAttribute('aria-label', 'OS keyboard delivery probe');
  section.style.cssText = 'position:fixed;left:20px;top:20px;width:360px;padding:16px;z-index:2147483647;background:white;color:black;';
  input.type = 'text'; input.setAttribute('aria-label', 'Keyboard delivery input');
  button.type = 'button'; button.textContent = 'Keyboard delivery activation';
  section.append(input, button);
  const keys: KeyboardTransition[] = [], inputs: KeyboardObservations['inputs'] = [], clicks: KeyboardObservations['clicks'] = [];
  /** Identify only this probe's owned controls. @param node Actual event target or focused element. @returns Stable input/button/other observation. */
  function identify(node: EventTarget | null): string { return node === input ? 'input' : node === button ? 'button' : 'other'; }
  /** Record actual key events without changing focus, value or default browser behavior. @param event Native key transition. @returns Void. */
  function key(event: KeyboardEvent): void {
    keys.push({ type: event.type, key: event.key, target: identify(event.target), focused: identify(document.activeElement),
      isTrusted: event.isTrusted, repeat: event.repeat });
  }
  /** Capture the real native input outcome. @param event Actual input event. @returns Void. */
  function typed(event: Event): void { inputs.push({ isTrusted: event.isTrusted, value: input.value }); }
  /** Count actual button activation without invoking any click API. @param event Native activation. @returns Void. */
  function clicked(event: MouseEvent): void { clicks.push({ isTrusted: event.isTrusted }); }
  /** Snapshot live control state together with recorded events. @returns Actual current keyboard evidence. */
  function observations(): KeyboardObservations {
    return { keys, inputs, clicks, value: input.value, focused: identify(document.activeElement), windowFocused: document.hasFocus() };
  }
  window.addEventListener('keydown', key, true); window.addEventListener('keyup', key, true);
  input.addEventListener('input', typed); button.addEventListener('click', clicked);
  try {
    document.title = `RR keyboard probe ${job.marker}`;
    document.documentElement.append(section);
    check(section.getBoundingClientRect().width > 0 && input.getBoundingClientRect().height > 0
      && button.getBoundingClientRect().height > 0, 'Keyboard probe controls are not actually visible');
    // Initial focus is explicit backend setup; subsequent Tab focus must be a native default action.
    window.focus(); input.focus();
    await until(Zotero, () => document.hasFocus() && document.activeElement === input, 'keyboard probe initial native focus');
    check(input.value === '', 'Keyboard probe input must start empty');
    const display = Services.env.get('DISPLAY'), authority = Services.env.get('XAUTHORITY');
    check(/^:[1-9][0-9]{0,4}$/.test(display) && display.trim() === display, 'Keyboard probe requires private DISPLAY');
    check(/^\/tmp\/xvfb-run\.[A-Za-z0-9]+\/Xauthority$/.test(authority) && authority.trim() === authority,
      'Keyboard probe requires owned XAUTHORITY path');
    await io.writeUTF8(`${exchange}/ready.json`, JSON.stringify({ action: job.action, marker: job.marker, data: job.data,
      state: 'ready', display, authority }), { mode: 'create', flush: true });
    const deadline = Date.now() + 20000;
    while (keys.length < 6 || clicks.length < 1) {
      check(Date.now() < deadline, `Keyboard probe delivery timed out: ${JSON.stringify(observations())}`);
      await Zotero.Promise.delay(25);
    }
    await Zotero.Promise.delay(150);
    const evidence = observations(); validateKeyboardObservations(evidence);
    app.invalidateAll();
    const after = await app.read('self'), manifestCountAfter = await commits(api);
    check(JSON.stringify(after) === JSON.stringify(before), 'Keyboard probe changed real application authority');
    check(manifestCountAfter === manifestCountBefore, 'Keyboard probe published a manifest');
    check(!Zotero.Users.getCurrentUserID(), 'Keyboard probe client became signed in');
    return { actualNativeKeyboard: true, initialFocusIsProbeSetup: true, unsignedIn: true, windowMarker: job.marker, evidence,
      before, after, manifestCountBefore, manifestCountAfter };
  } catch (error) {
    await io.writeUTF8(`${exchange}/error.json`, JSON.stringify({ action: job.action, marker: job.marker,
      message: error instanceof Error ? error.message : String(error), evidence: observations() }), { mode: 'create', flush: true });
    throw error;
  } finally {
    window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', key, true);
    input.removeEventListener('input', typed); button.removeEventListener('click', clicked);
    section.remove();
    document.title = previousTitle;
  }
}
