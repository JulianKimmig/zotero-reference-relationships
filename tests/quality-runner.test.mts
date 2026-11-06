/** Quality runner argument guards fail before creating or launching any native profile. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('quality runner requires an explicit absolute existing artifact argument', () => {
  const result = spawnSync(process.execPath, [new URL('../scripts/sync/quality.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /Usage:/);
});

test('quality runner rejects relative artifact paths before native work', () => {
  const result = spawnSync(process.execPath, [new URL('../scripts/sync/quality.mjs', import.meta.url).pathname, '--xpi', 'relative.xpi'], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /absolute|Usage:/);
});

test('quality runner requires an explicitly configured native executable', () => {
  const result = spawnSync(process.execPath, [new URL('../scripts/sync/quality.mjs', import.meta.url).pathname, '--xpi', '/tmp/quality-explicit-artifact.xpi'],
    { encoding: 'utf8', env: { ...process.env, ZOTERO_BIN: '' } });
  assert.equal(result.status, 1); assert.match(result.stderr, /ZOTERO_BIN/);
});
