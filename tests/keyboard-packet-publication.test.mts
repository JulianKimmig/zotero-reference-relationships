/** Real-filesystem regression for readers observing a complete keyboard packet or no packet, never a partially written JSON file. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { publishKeyboardJSON } from '../scripts/sync/keyboard-packets.mts';

test('a concurrent reader sees the complete packet on its first successful read', async () => {
  const root = await mkdtemp('/tmp/rr-packet-publication-'), path = join(root, 'reply.json');
  try {
    const expected = { step: 17, payload: 'complete packet '.repeat(200000) };
    const writer = publishKeyboardJSON(path, expected);
    const reader = (async () => {
      for (let attempts = 0; attempts < 1000; attempts++) {
        try { return JSON.parse(await readFile(path, 'utf8')); }
        catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
        await delay(1);
      }
      throw new Error('Published packet never appeared');
    })();
    const results = await Promise.allSettled([writer, reader]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'fulfilled');
    if (results[1].status === 'fulfilled') assert.deepEqual(results[1].value, expected);
    assert.deepEqual(await readdir(root), ['reply.json']);
  } finally { await rm(root, { recursive: true }); }
});

test('publication refuses to overwrite an existing packet and removes only its own staging file', async () => {
  const root = await mkdtemp('/tmp/rr-packet-collision-'), path = join(root, 'reply.json');
  try {
    await writeFile(path, '{"original":true}', { flag: 'wx' });
    await assert.rejects(publishKeyboardJSON(path, { original: false }), { code: 'EEXIST' });
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { original: true });
    assert.deepEqual(await readdir(root), ['reply.json']);
  } finally { await rm(root, { recursive: true }); }
});

test('publication preserves a pre-existing staging file and fails before serializing invalid JSON', async () => {
  const root = await mkdtemp('/tmp/rr-packet-staging-'), path = join(root, 'reply.json');
  try {
    await writeFile(`${path}.pending`, 'another attempt', { flag: 'wx' });
    await assert.rejects(publishKeyboardJSON(path, { step: 1 }), { code: 'EEXIST' });
    assert.equal(await readFile(`${path}.pending`, 'utf8'), 'another attempt');
    const circular: { self?: object } = {}; circular.self = circular;
    await assert.rejects(publishKeyboardJSON(join(root, 'invalid.json'), circular), /circular/i);
    assert.deepEqual(await readdir(root), ['reply.json.pending']);
  } finally { await rm(root, { recursive: true }); }
});
