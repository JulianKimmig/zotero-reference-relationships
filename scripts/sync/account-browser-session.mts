/** Use Zotero's current browser-approved session protocol without persisting URLs, tokens or issued keys. */
import { setTimeout as delay } from 'node:timers/promises';

/** Owned browser performs only ordinary login/approval actions and leaves verification challenges to the user. */
export interface LoginBrowser { pump(): Promise<void>; close(): Promise<void> }

/** Require the shape of an actual external JSON response. @param input External JSON. @returns Object with unvalidated fields. */
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(); return input as Record<string, unknown>;
}

/** Create, approve and consume one accepted development login session. @param expectedUserID Dedicated account identity. @param openBrowser Opens the official login URL without logging it. @param api External HTTPS fetch boundary, replaced only by synthetic server fixtures in tests. @returns Issued API key in memory for the native key manager; every error is phase-only. */
export async function authorizeBrowserAccount(expectedUserID: number,
  openBrowser: (url: string) => Promise<LoginBrowser>, api: typeof fetch = fetch): Promise<string> {
  let phase = 'session-create', token: string | null = null, browser: LoginBrowser | null = null;
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
    phase = 'browser-login'; browser = await openBrowser(created.loginURL);
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      await browser.pump(); phase = 'session-poll';
      const result = await api('https://api.zotero.org/keys/sessions/' + encodeURIComponent(token),
        { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!result.ok) throw new Error();
      const state = object(await result.json());
      if (state.status === 'completed') {
        if (typeof state.apiKey !== 'string' || !state.apiKey) throw new Error();
        return state.apiKey;
      }
      if (state.status !== 'pending') throw new Error();
      phase = 'browser-login'; await delay(1000);
    }
    phase = 'verification-timeout'; throw new Error();
  } catch { throw new Error(`Browser account authorization failed at ${phase}`); }
  finally {
    try { if (browser) await browser.close(); }
    finally {
      if (token) {
        const cancelled = await api('https://api.zotero.org/keys/sessions/' + encodeURIComponent(token),
          { method: 'DELETE', headers, signal: AbortSignal.timeout(15000), redirect: 'error' }).catch(() => null);
        if (!cancelled || ![204, 404, 409].includes(cancelled.status)) throw new Error('Browser account session cleanup failed');
      }
    }
  }
}
