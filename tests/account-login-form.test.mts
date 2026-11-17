/** Exercise normal Zotero login and password confirmation through synthetic external WebDriver responses. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginPump } from '../scripts/sync/account-login-form.mts';
import type { BrowserRequest } from '../scripts/sync/account-login-form.mts';

/** Model only the external browser protocol; the production login pump remains real. @param options Current public form shape. @returns Browser boundary and observed normal input/actions. */
function browser(options: { username: boolean; enabled: boolean; confirm?: boolean; origin?: string }) {
  const values: Record<string, string> = {}, clicks: string[] = [], notices: string[] = [];
  const request: BrowserRequest = async (path, body) => {
    if (path === '/url') return (options.origin ?? 'https://www.zotero.org') + '/user/login';
    if (path === '/elements') {
      const selector = (body as { value: string }).value;
      const ids = selector === '#username' ? (options.username ? ['username'] : [])
        : selector === '#password' ? ['password'] : selector === '#login' ? (options.confirm ? [] : ['login'])
          : selector === 'form button[type="submit"], form input[type="submit"]' ? ['confirm', 'unrelated'] : [];
      return ids.map(id => ({ 'element-6066-11e4-a52e-4f735466cecf': id }));
    }
    const match = /^\/element\/([^/]+)\/(value|enabled|click|text)$/.exec(path);
    assert.ok(match, 'Unexpected browser operation');
    const [, id, action] = match;
    if (action === 'value') { values[id] = (body as { text: string }).text; return null; }
    if (action === 'enabled') return options.enabled;
    if (action === 'text') return id === 'confirm' ? 'Confirm' : 'Delete account';
    clicks.push(id); return null;
  };
  return { request, values, clicks, notices, notify: (message: string) => { notices.push(message); } };
}

test('normal login fills both fields and submits an enabled login once', async () => {
  const b = browser({ username: true, enabled: true });
  const pump = createLoginPump(b.request, { username: 'fixture-account', password: 'fixture-password' }, b.notify);
  await pump(); await pump();
  assert.deepEqual(b.values, { username: 'fixture-account', password: 'fixture-password' });
  assert.deepEqual(b.clicks, ['login']);
});
test('remembered-account confirmation fills password without requiring a username input', async () => {
  const b = browser({ username: false, enabled: true, confirm: true });
  const pump = createLoginPump(b.request, { username: 'fixture-account', password: 'fixture-password' }, b.notify);
  await pump(); await pump();
  assert.deepEqual(b.values, { password: 'fixture-password' });
  assert.deepEqual(b.clicks, ['confirm']);
});
test('disabled login leaves verification to the user and emits one value-free notice', async () => {
  const b = browser({ username: true, enabled: false });
  const pump = createLoginPump(b.request, { username: 'fixture-account', password: 'fixture-password' }, b.notify);
  await pump(); await pump();
  assert.deepEqual(b.clicks, []); assert.equal(b.notices.length, 1);
  assert.ok(!b.notices[0].includes('fixture-account') && !b.notices[0].includes('fixture-password'));
});
test('an unexpected origin receives no login input or clicks', async () => {
  const b = browser({ username: true, enabled: true, origin: 'https://example.com' });
  await assert.rejects(createLoginPump(b.request, { username: 'fixture-account', password: 'fixture-password' }, b.notify)());
  assert.deepEqual(b.values, {}); assert.deepEqual(b.clicks, []);
});
