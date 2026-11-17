/** Exercise Zotero's current browser-link protocol using synthetic external HTTP/browser resources. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeBrowserAccount } from '../scripts/sync/account-browser-session.mts';

test('browser-approved session returns the issued key only in memory and closes its browser', async () => {
  let opened = 0, closed = 0, polls = 0;
  const api: typeof fetch = async (url, options) => {
    if (options?.method === 'POST') return Response.json({ sessionToken: 'private-session', loginURL: 'https://www.zotero.org/user/login?session=private-session' }, { status: 201 });
    if (options?.method === 'DELETE') return new Response(null, { status: 409 });
    assert.ok(String(url).includes('private-session')); polls++;
    return Response.json({ status: 'completed', apiKey: 'issued-private-key' });
  };
  const key = await authorizeBrowserAccount(22463862, async url => {
    assert.equal(new URL(url).origin, 'https://www.zotero.org'); opened++;
    return { async pump() {}, async close() { closed++; } };
  }, api);
  assert.equal(key, 'issued-private-key'); assert.equal(opened, 1); assert.equal(closed, 1); assert.equal(polls, 1);
});
test('an unexpected login origin cannot receive browser credentials and cancels its session', async () => {
  let opened = false, cancelled = false;
  const api: typeof fetch = async (_url, options) => {
    if (options?.method === 'DELETE') { cancelled = true; return new Response(null, { status: 204 }); }
    return Response.json({ sessionToken: 'private-session', loginURL: 'https://example.com/login' }, { status: 201 });
  };
  await assert.rejects(authorizeBrowserAccount(22463862, async () => { opened = true; throw Error(); }, api), /browser-origin/);
  assert.equal(opened, false); assert.equal(cancelled, true);
});
test('HTTP/browser failures cannot expose session tokens or external error details', async () => {
  const api: typeof fetch = async () => { throw Error('private-session private-password'); };
  await assert.rejects(authorizeBrowserAccount(22463862, async () => { throw Error(); }, api), error => {
    assert.ok(error instanceof Error); assert.equal(error.message, 'Browser account authorization failed at session-create');
    assert.ok(!('cause' in error)); return true;
  });
});
