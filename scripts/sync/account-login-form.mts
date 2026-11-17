/** Perform ordinary Zotero login, remembered-account password confirmation and consent through an external browser. */
import type { DevelopmentCredentials } from './account-credentials.mts';

/** A request scoped to one owned WebDriver session; responses are untrusted browser data. */
export type BrowserRequest = (path: string, body?: object, method?: string) => Promise<unknown>;

/** Create a stateful normal-form pump without changing verification controls. @param request Owned browser-session protocol boundary. @param credentials Private normal input kept in memory. @param notify Receives only static verification guidance. @returns A bounded observation/input action for each server-pending poll. */
export function createLoginPump(request: BrowserRequest, credentials: DevelopmentCredentials,
  notify: (message: string) => void = message => console.log(message)): () => Promise<void> {
  let entered = false, submitted = false, notice = false;
  /** Resolve current elements without reading field values. @param selector Normal login/approval selector. @returns Validated external element identities. */
  async function elements(selector: string): Promise<string[]> {
    const result = await request('/elements', { using: 'css selector', value: selector });
    if (!Array.isArray(result)) throw new Error('Invalid browser elements');
    return result.map((value: unknown) => {
      if (!value || typeof value !== 'object' || !('element-6066-11e4-a52e-4f735466cecf' in value)) throw new Error('Invalid browser element');
      const id = value['element-6066-11e4-a52e-4f735466cecf'];
      if (typeof id !== 'string') throw new Error('Invalid browser element'); return id;
    });
  }
  /** Send only normal field input on the official origin; never inspect or solve verification. @returns Completion of this pump iteration. */
  return async function pump(): Promise<void> {
    const current = await request('/url', undefined, 'GET');
    if (typeof current !== 'string' || new URL(current).origin !== 'https://www.zotero.org') throw new Error('Unexpected authentication origin');
    const usernames = await elements('#username'), passwords = await elements('#password');
    if (!entered && usernames.length <= 1 && passwords.length === 1) {
      if (usernames.length) await request(`/element/${usernames[0]}/value`, { text: credentials.username });
      await request(`/element/${passwords[0]}/value`, { text: credentials.password }); entered = true;
    }
    const login = await elements('#login');
    if (entered && !submitted && login.length === 1) {
      if (await request(`/element/${login[0]}/enabled`, undefined, 'GET') === true) {
        await request(`/element/${login[0]}/click`, {}); submitted = true;
      } else if (!notice) { notify('Complete Zotero verification in the opened browser; login fields are prefilled.'); notice = true; }
    }
    if ((!passwords.length || (entered && !submitted && !login.length))) {
      for (const button of await elements('form button[type="submit"], form input[type="submit"]')) {
        const label = await request(`/element/${button}/text`, undefined, 'GET');
        const allowed = passwords.length ? /^Confirm$/i : /^(?:Authorize(?: Zotero)?|Allow|Approve|Continue)$/i;
        if (typeof label === 'string' && allowed.test(label.trim())
          && await request(`/element/${button}/enabled`, undefined, 'GET') === true) {
          await request(`/element/${button}/click`, {}); if (passwords.length) submitted = true; break;
        }
      }
    }
  };
}
