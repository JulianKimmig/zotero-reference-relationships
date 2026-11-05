/** CLI failures must occur before opening signed-in profiles or a native client. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('requires a configuration path without launching a native process', () => {
  const result = spawnSync(process.execPath, ['scripts/sync/run.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test('requires an explicit native executable', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'rr-sync-cli-')), 'config.json');
  await writeFile(path, '{}');
  const result = spawnSync(process.execPath, ['scripts/sync/run.mjs', path], {
    encoding: 'utf8', env: { ...process.env, ZOTERO_BIN: '' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ZOTERO_BIN/);
});

test('rejects invalid group identifiers before touching profiles', async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'rr-sync-cli-')), 'config.json');
  await writeFile(path, JSON.stringify({ groups: { writable: 0, restricted: 2 } }));
  const result = spawnSync(process.execPath, ['scripts/sync/run.mjs', path], {
    encoding: 'utf8', env: { ...process.env, ZOTERO_BIN: process.execPath },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /group/i);
});
