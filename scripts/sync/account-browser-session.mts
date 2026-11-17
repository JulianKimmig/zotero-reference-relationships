/** Use Zotero's current browser-approved session protocol without persisting URLs, tokens or issued keys. */
import { setTimeout as delay } from 'node:timers/promises';

/** Owned browser performs only ordinary login/approval actions and leaves verification challenges to the user. */
export interface LoginBrowser { pump(): Promise<void>; close(): Promise<void> }

/** Only locally controlled phase labels may reach setup diagnostics. */
type BrowserPhase = 'session-create' | 'browser-origin' | 'browser-login' | 'session-poll' | 'verification-timeout' | 'browser-close' | 'session-cleanup';
/** A trusted error carries no external message, cause, URL, token or key. */
export class BrowserAuthorizationError extends Error {
  readonly phase: BrowserPhase;
  readonly cleanupFailed: boolean;
  /** Construct a value-free terminal report. @param phase Locally controlled failing operation. @param cleanupFailed Whether owned resource/key cleanup was incomplete. @returns Trusted error. */
  constructor(phase: BrowserPhase, cleanupFailed = false) {
    super(`Browser account authorization failed at ${phase}${cleanupFailed ? ' (cleanup incomplete)' : ''}`);
    this.phase = phase; this.cleanupFailed = cleanupFailed;
  }
}

/** Require the shape of an actual external JSON response. @param input External JSON. @returns Object with unvalidated fields. */
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); return input as Record<string, unknown>;
}

/** Create, approve and consume one accepted development login session. @param expectedUserID Dedicated account identity. @param openBrowser Opens the official login URL without logging it. @param api External HTTPS fetch boundary, replaced only by synthetic server fixtures in tests. @returns Issued API key in memory for the native key manager; every error is phase-only. */
export async function authorizeBrowserAccount(expectedUserID: number,
  openBrowser: (url: string) => Promise<LoginBrowser>, api: typeof fetch = fetch): Promise<string> {
  let phase: BrowserPhase = 'session-create', token: string | null = null, browser: LoginBrowser | null = null;
  let approvedKey: string | null = null, failure: BrowserAuthorizationError | null = null, visited = false;
  const headers = { 'Zotero-API-Version': '3', 'Content-Type': 'application/json' };
  try {
    if (![22463862, 22463893].includes(expectedUserID)) throw new Error();
    const response = await api('https://api.zotero.org/keys/sessions', { method: 'POST', headers,
      body: JSON.stringify({ userID: expectedUserID }), signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (response.status !== 201) throw new Error();
    const created = object(await response.json());
    if (typeof created.sessionToken !== 'string' || !created.sessionToken) throw new Error(); token = created.sessionToken;
    phase = 'browser-origin';
    if (typeof created.loginURL !== 'string' || new URL(created.loginURL).origin !== 'https://www.zotero.org') throw new Error();
    phase = 'browser-login'; visited = true; browser = await openBrowser(created.loginURL);
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      phase = 'session-poll';
      const result = await api('https://api.zotero.org/keys/sessions/' + encodeURIComponent(token),
        { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!result.ok) throw new Error();
      const state = object(await result.json());
      if (state.status === 'completed') {
        if (typeof state.apiKey !== 'string' || !state.apiKey) throw new Error();
        approvedKey = state.apiKey; break;
      }
      if (state.status !== 'pending') throw new Error();
      phase = 'browser-login'; await browser.pump(); await delay(1000);
    }
    if (!approvedKey) { phase = 'verification-timeout'; throw new Error(); }
  } catch { failure = new BrowserAuthorizationError(phase); }
  try { if (browser) await browser.close(); }
  catch { failure ??= new BrowserAuthorizationError('browser-close'); }
  if (token) {
    try {
      if (failure && visited && !approvedKey) {
        const inspection = await api('https://api.zotero.org/keys/sessions/' + encodeURIComponent(token),
          { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (inspection.ok) {
          const state = object(await inspection.json());
          if (state.status === 'completed' && typeof state.apiKey === 'string' && state.apiKey) approvedKey = state.apiKey;
        }
      }
      const cancelled = await api('https://api.zotero.org/keys/sessions/' + encodeURIComponent(token),
        { method: 'DELETE', headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (![204, 404, 409].includes(cancelled.status)) throw new Error();
    } catch { failure = new BrowserAuthorizationError(failure?.phase ?? 'session-cleanup', true); }
  }
  if (failure && approvedKey) {
    try {
      const revoked = await api('https://api.zotero.org/keys/' + encodeURIComponent(approvedKey), {
        method: 'DELETE', headers: { ...headers, 'Zotero-API-Key': approvedKey }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (revoked.status !== 204) throw new Error();
    } catch { failure = new BrowserAuthorizationError(failure.phase, true); }
  }
  if (failure) throw failure;
  if (!approvedKey) throw new BrowserAuthorizationError('session-poll');
  return approvedKey;
}
