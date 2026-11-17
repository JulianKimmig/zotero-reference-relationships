/** Validate real dotenv input and filesystem protection without exposing actual development credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readDevelopmentCredentials } from '../scripts/sync/account-credentials.mts';

/** Create an owned nonsecret fixture with explicit permissions. @param text Dotenv fixture. @returns Private path. */
async function fixture(text: string) {
  const path = join(await mkdtemp(join(tmpdir(), 'rr-credential-input-')), 'credentials.env');
  await writeFile(path, text, { mode: 0o600 }); return path;
}
const complete = 'ZOTERO_ACCOUNT_A_USERNAME="a"\nZOTERO_ACCOUNT_A_PASSWORD="a # $ password"\nZOTERO_ACCOUNT_B_USERNAME="b"\nZOTERO_ACCOUNT_B_PASSWORD="b password"\n';
test('builtin dotenv parsing preserves quoted password characters and account separation', async () => {
  const value = await readDevelopmentCredentials(await fixture(complete));
  assert.deepEqual(value, { a: { username: 'a', password: 'a # $ password' }, b: { username: 'b', password: 'b password' } });
});
test('empty required fields are refused without echoing supplied secret values', async () => {
  const path = await fixture(complete.replace('"b password"', '""'));
  await assert.rejects(readDevelopmentCredentials(path), error => {
    assert.ok(error instanceof Error); assert.ok(!error.message.includes('a # $ password')); return true;
  });
});
test('group-readable credential files and symlink paths are refused', async () => {
  const path = await fixture(complete); await chmod(path, 0o640);
  await assert.rejects(readDevelopmentCredentials(path)); await chmod(path, 0o600);
  const link = path + '.link'; await symlink(path, link); await assert.rejects(readDevelopmentCredentials(link));
});
