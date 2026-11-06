/** Exercise the real native classic controller against explicit external failures, including falsy thrown values. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const root = new URL(import.meta.url.endsWith('.mts') ? '../' : '../../', import.meta.url);
const source = stripTypeScriptTypes(await readFile(new URL('tests/sync-controller/bootstrap.ts', root), 'utf8'));

/** Run actual dispatch, inspection, result serialization and quit with only external native APIs supplied. @param failure Optional exact value thrown by native user-identity lookup. @returns Parsed native result, write count and observed quit count. */
async function fixture(failure?: { error: unknown }) {
  const job = { action: 'inspect', state: 'pending', profile: '/test/profile', data: '/test/data', result: '/test/result.json', groups: { writable: 2, restricted: 3 } };
  const writes = new Map<string, string>(); let quits = 0;
  const scope: { run?: () => Promise<void>; Zotero: object; Services: object; IOUtils: object } = {
    Zotero: { initializationPromise: Promise.resolve(), uiReadyPromise: Promise.resolve(), version: '10.0.7',
      Profile: { dir: job.profile }, DataDirectory: { dir: job.data }, Libraries: { userLibraryID: 1 },
      Groups: { get(id: number) { return { groupID: id, libraryID: id, editable: true }; } },
      Users: { getCurrentUserID() { if (failure) throw failure.error; return 123; } },
      Sync: { Runner: { async sync() { return true; } } },
      DB: { async waitForTransaction() {} }, Utilities: { Internal: { quit() { quits++; } } } },
    Services: { prefs: { getStringPref() { return '/test/job.json'; } } },
    IOUtils: { async readUTF8() { return JSON.stringify(job); },
      async writeUTF8(path: string, value: string) { writes.set(path, value); } },
  };
  runInNewContext(source, scope, { filename: 'tests/sync-controller/bootstrap.ts' });
  assert.equal(typeof scope.run, 'function'); await scope.run!();
  const result = JSON.parse(writes.get(job.result)!);
  return { result, quits, writes: writes.size };
}

for (const error of [null, undefined, false, 0, '']) test(`native thrown ${String(error)} is a failure rather than an empty success`, async () => {
  const { result, quits, writes } = await fixture({ error });
  assert.equal(result.ok, false); assert.equal(result.report, null);
  assert.equal(result.error.name, 'NativeFailure'); assert.equal(result.error.message, String(error));
  assert.equal(quits, 1); assert.equal(writes, 2);
});

test('normal native exceptions retain a failing result and diagnostic text', async () => {
  const { result, quits } = await fixture({ error: new Error('Native resource failed') });
  assert.equal(result.ok, false); assert.match(result.error.message, /Native resource failed/); assert.equal(quits, 1);
});

test('successful native inspection retains its actual nonempty report and one normal quit', async () => {
  const { result, quits } = await fixture();
  assert.equal(result.ok, true); assert.equal(result.error, null);
  assert.equal(result.report.userID, 123); assert.equal(result.report.groups.length, 2); assert.equal(quits, 1);
});
