/** Exercise development sign-in against external native/API resources, including secret-safe failures and reuse. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateDevelopmentAccount, inspectDevelopmentAccount } from './sync-controller/account-auth.mts';
import type { AccountHost } from './sync-controller/account-auth.mts';

/** Provide a controllable external Zotero/account-server boundary; no plugin source is replaced. @returns Native fixture and operation receipts. */
function fixture() {
  let userID: number | null = null, stored = '', creations = 0, syncs = 0;
  let returnedID = 22463862, failure: Error | null = null, refused = false;
  const client = {
    async createAPIKeyFromCredentials() { creations++; if (failure) throw failure; if (refused) return false as const; return { key: 'secret-api-key', userID: returnedID, username: 'test-a' }; },
    async getKeyInfo() { return { userID: returnedID, username: 'test-a' }; },
    async getGroupVersions() { return { '6749379': 1, '6749388': 1 }; },
    async deleteAPIKey() {},
  };
  const native: AccountHost = {
    Users: { getCurrentUserID: () => userID },
    Libraries: { userLibraryID: 1 },
    Groups: { get: id => ({ libraryID: id, editable: id === 6749379 || returnedID === 22463862, archived: false }) },
    getMainWindow: () => ({}),
    Sync: {
      Data: { Local: {
        async getAPIKey() { return stored || false; },
        async setAPIKey(key) { stored = key; },
        async checkUser(_window, id) { userID = id; return true; },
      } },
      Runner: {
        getAPIClient: () => client,
        async sync() { syncs++; return true; },
      },
    },
  };
  return { native, receipts: () => ({ userID, stored, creations, syncs }),
    existing(id: number) { userID = id; stored = 'existing-key'; },
    returned(id: number) { returnedID = id; }, fail(error: Error) { failure = error; }, refuse() { refused = true; } };
}

test('new sign-in binds the expected account, syncs only accepted memberships and reports no secrets', async () => {
  const f = fixture(), report = await authenticateDevelopmentAccount(f.native, 22463862, { username: 'test-a', password: 'private-password' });
  assert.equal(report.userID, 22463862); assert.equal(report.reusedStoredLogin, false);
  assert.deepEqual(f.receipts(), { userID: 22463862, stored: 'secret-api-key', creations: 1, syncs: 1 });
  assert.ok(!JSON.stringify(report).includes('secret-api-key') && !JSON.stringify(report).includes('private-password'));
});
test('an existing signed profile reuses native storage without supplied credentials or a new key', async () => {
  const f = fixture(); f.existing(22463862);
  const report = await authenticateDevelopmentAccount(f.native, 22463862, null);
  assert.equal(report.reusedStoredLogin, true); assert.equal(f.receipts().creations, 0);
});
test('a different existing account is never switched or reset', async () => {
  const f = fixture(); f.existing(22463893);
  await assert.rejects(authenticateDevelopmentAccount(f.native, 22463862, null), /existing-account/);
  assert.equal(f.receipts().syncs, 0); assert.equal(f.receipts().userID, 22463893);
});
test('credentials resolving to the wrong dedicated account never reach native key storage or sync', async () => {
  const f = fixture(); f.returned(22463893);
  await assert.rejects(authenticateDevelopmentAccount(f.native, 22463862, { username: 'test-a', password: 'private-password' }), /login-identity/);
  assert.equal(f.receipts().stored, ''); assert.equal(f.receipts().syncs, 0);
});
test('native/server errors cannot leak credentials through thrown messages or causes', async () => {
  const f = fixture(); f.fail(new Error('private-password secret-api-key'));
  await assert.rejects(authenticateDevelopmentAccount(f.native, 22463862, { username: 'test-a', password: 'private-password' }), error => {
    assert.ok(error instanceof Error); assert.equal(error.message, 'Development account setup failed at login-request');
    assert.ok(!('cause' in error)); return true;
  });
});
test('a profile without stored authentication cannot use verification as an implicit login', async () => {
  const f = fixture(); await assert.rejects(authenticateDevelopmentAccount(f.native, 22463862, null), /credentials-required/);
  assert.equal(f.receipts().creations, 0);
});
test('a server credential refusal is distinguishable from a returned wrong identity without revealing values', async () => {
  const f = fixture(); f.refuse();
  await assert.rejects(authenticateDevelopmentAccount(f.native, 22463862, { username: 'test-a', password: 'private-password' }), /login-rejected/);
  assert.equal(f.receipts().stored, ''); assert.equal(f.receipts().syncs, 0);
});
test('account B is accepted only with writable shared and readonly restricted group permissions', async () => {
  const f = fixture(); f.returned(22463893);
  const report = await authenticateDevelopmentAccount(f.native, 22463893, { username: 'test-b', password: 'private-password' });
  assert.deepEqual(report.groups.map(group => group.editable), [true, false]);
});
test('a browser-issued key uses native identity checks and storage without a legacy password request', async () => {
  const f = fixture();
  const report = await authenticateDevelopmentAccount(f.native, 22463862, { apiKey: 'browser-issued-key' });
  assert.equal(report.userID, 22463862); assert.equal(f.receipts().creations, 0); assert.equal(f.receipts().stored, 'browser-issued-key');
});
test('native setup status reports only public identity/key presence and performs no login or sync', async () => {
  const f = fixture();
  assert.deepEqual(await inspectDevelopmentAccount(f.native, 22463862), { userID: null, keyPresent: false });
  f.existing(22463862);
  assert.deepEqual(await inspectDevelopmentAccount(f.native, 22463862), { userID: 22463862, keyPresent: true });
  assert.equal(f.receipts().creations, 0); assert.equal(f.receipts().syncs, 0);
});
