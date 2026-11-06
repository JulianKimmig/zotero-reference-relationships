/** Behavioral transfer-file tests use actual files and substitute only external failure/race boundaries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createTransferFiles } from '../src/adapters/transfer-files.mts';
import { canonicalJSON } from '../src/storage/canonical.mts';
import { createExport, verifyExport } from '../src/transfer/format.mts';
import { maximumGraph, exportedAt } from './fixtures/transfer.mts';
import { digest, document, filesystem, maxBytes } from './fixtures/transfer-files.mts';
import type { TransferFileIO } from '../src/transfer/file-contracts.mts';

test('writes canonical NFC Unicode with direct create/flush and acknowledges verified actual readback', async context => {
  const fixture = await filesystem(context), original = await document();
  original.snapshot.assertions[0].metadata.note = 'Cafe\u0301 你好 😀 <b>literal</b>';
  const before = structuredClone(original), expected = await verifyExport(original, digest);
  assert.equal(await fixture.files.writeNew(fixture.path, original), undefined);
  const text = await readFile(fixture.path, 'utf8');
  assert.equal(text, canonicalJSON(expected, { maxBytes }));
  assert.ok(Buffer.byteLength(text) > text.length);
  assert.deepEqual(fixture.writes, [{ path: fixture.path, text, options: { mode: 'create', flush: true } }]);
  assert.deepEqual(fixture.reads, [{ path: fixture.path, options: { maxBytes: maxBytes + 1 } }]);
  const roundtrip = await fixture.files.read(fixture.path);
  assert.deepEqual(roundtrip, expected); assert.equal(roundtrip.snapshot.types[0].version, 7);
  assert.equal(roundtrip.snapshot.rules[0].version, 9); assert.deepEqual(original, before);
});

test('reads noncanonical valid Unicode JSON and returns detached verified authority', async context => {
  const fixture = await filesystem(context), original = await document();
  original.snapshot.assertions[0].metadata.note = 'Cafe\u0301 你好 😀 <b>literal</b>';
  await writeFile(fixture.path, JSON.stringify(original, null, 2));
  const result = await fixture.files.read(fixture.path);
  assert.equal(result.snapshot.assertions[0].metadata.note, 'Café 你好 😀 <b>literal</b>');
  result.source.id = '999'; assert.equal((await fixture.files.read(fixture.path)).source.id, '123');
});

test('accepts a complete file at the inclusive 2 MiB raw UTF-8 boundary', async context => {
  const fixture = await filesystem(context), original = await document(), text = JSON.stringify(original);
  const padded = text + ' '.repeat(maxBytes - Buffer.byteLength(text));
  assert.equal(Buffer.byteLength(padded), maxBytes); await writeFile(fixture.path, padded);
  assert.deepEqual(await fixture.files.read(fixture.path), original);
});

for (const excess of [1, maxBytes]) {
  test(`rejects a real file ${excess} bytes over limit even with a valid truncated JSON prefix`, async context => {
    const fixture = await filesystem(context), text = JSON.stringify(await document());
    await writeFile(fixture.path, text + ' '.repeat(maxBytes + excess - Buffer.byteLength(text)));
    await assert.rejects(() => fixture.files.read(fixture.path), { code: 'limit' });
    assert.deepEqual(fixture.reads, [{ path: fixture.path, options: { maxBytes: maxBytes + 1 } }]);
  });
}

test('rejects oversized external bytes before UTF-8 decoding or parsing', async context => {
  const fixture = await filesystem(context);
  const io: TransferFileIO = { ...fixture.io, read: async () => new Uint8Array(maxBytes + 1).fill(255) };
  await assert.rejects(() => createTransferFiles({ io, digest }).read(fixture.path), { code: 'limit' });
});

for (const bytes of [Uint8Array.of(0xc0, 0xaf), Uint8Array.of(0xe2, 0x82), Uint8Array.of(0xff)]) {
  test(`rejects invalid UTF-8 ${Buffer.from(bytes).toString('hex')} without replacement decoding`, async context => {
    const fixture = await filesystem(context), original = await document();
    original.snapshot.assertions[0].metadata.note = '\ufffd';
    const valid = Buffer.from(JSON.stringify(await createExport({ source: original.source,
      snapshot: original.snapshot, exportedAt }, digest)));
    const index = valid.indexOf(Buffer.from('\ufffd'));
    const corrupted = Buffer.concat([valid.subarray(0, index), bytes, valid.subarray(index + 3)]);
    const io: TransferFileIO = { ...fixture.io, read: async () => corrupted };
    await assert.rejects(() => createTransferFiles({ io, digest }).read(fixture.path), { name: 'TypeError' });
  });
}

for (const text of ['', '{', 'null', '{}']) {
  test(`rejects malformed/incomplete file ${JSON.stringify(text)}`, async context => {
    const fixture = await filesystem(context); await writeFile(fixture.path, text);
    await assert.rejects(() => fixture.files.read(fixture.path), { code: 'validation' });
  });
}

test('preserves native missing-file failures', async context => {
  const fixture = await filesystem(context);
  await assert.rejects(() => fixture.files.read(fixture.path), { code: 'ENOENT' });
});

test('preserves denied external read error identity and details', async context => {
  const fixture = await filesystem(context), denied = new DOMException('Access denied at selected path', 'NotAllowedError');
  const io: TransferFileIO = { ...fixture.io, read: async () => { throw denied; } };
  await assert.rejects(() => createTransferFiles({ io, digest }).read(fixture.path), error => error === denied);
});

for (const kind of ['schema', 'graph', 'owner', 'content', 'hash', 'oversized'] as const) {
  test(`rejects ${kind} document before creating a file`, async context => {
    const fixture = await filesystem(context), original = await document();
    const candidates = {
      schema: { ...original, schema: 2 }, graph: { ...original, snapshot: {} },
      owner: { ...original, source: { kind: 'group', id: '123' } },
      content: { ...original, exportedAt: '2026-11-06T12:00:00.000Z' },
      hash: { ...original, hash: '0'.repeat(64) }, oversized: { ...original, extra: 'x'.repeat(maxBytes) },
    };
    await assert.rejects(() => fixture.files.writeNew(fixture.path, candidates[kind]),
      { code: kind === 'schema' || kind === 'graph' ? 'unsupported-schema' : kind === 'oversized' ? 'limit' : 'validation' });
    assert.equal(fixture.writes.length, 0); assert.equal(fixture.reads.length, 0);
    await assert.rejects(() => access(fixture.path), { code: 'ENOENT' });
  });
}

test('validates source without invoking an untrusted getter or creating output', async context => {
  const fixture = await filesystem(context); let called = false;
  const input = { get source() { called = true; throw new Error('must not execute'); } };
  await assert.rejects(() => fixture.files.writeNew(fixture.path, input), { code: 'validation' });
  assert.equal(called, false); assert.equal(fixture.writes.length, 0);
  await assert.rejects(() => access(fixture.path), { code: 'ENOENT' });
});

test('preserves crypto resource failures without creating output', async context => {
  const fixture = await filesystem(context), original = await document(), error = new Error('SHA-256 unavailable');
  const files = createTransferFiles({ io: fixture.io, digest: async () => { throw error; } });
  await assert.rejects(() => files.writeNew(fixture.path, original), cause => cause === error);
  assert.equal(fixture.writes.length, 0); await assert.rejects(() => access(fixture.path), { code: 'ENOENT' });
});

test('writes a complete maximum 1 MiB graph inside its independently bounded larger envelope', async context => {
  const fixture = await filesystem(context), original = await createExport({ source: { kind: 'user', id: '123' },
    snapshot: maximumGraph(), exportedAt }, digest);
  await fixture.files.writeNew(fixture.path, original);
  assert.ok((await readFile(fixture.path)).byteLength > 1_048_576);
  assert.deepEqual(await fixture.files.read(fixture.path), original);
});

test('existing output remains byte-for-byte intact and is never acknowledged as a new backup', async context => {
  const fixture = await filesystem(context), original = await document(), bytes = Buffer.from('existing output\0\xff');
  await writeFile(fixture.path, bytes);
  await assert.rejects(() => fixture.files.writeNew(fixture.path, original), { code: 'EEXIST' });
  assert.deepEqual(await readFile(fixture.path), bytes); assert.equal(fixture.reads.length, 0);
});

test('an external creator winning immediately before exclusive open keeps its file intact', async context => {
  const fixture = await filesystem(context), original = await document(), winner = 'external creator wins';
  const io: TransferFileIO = { ...fixture.io, async writeUTF8(path, text, options) {
    await writeFile(path, winner, { flag: 'wx' });
    return fixture.io.writeUTF8(path, text, options);
  } };
  await assert.rejects(() => createTransferFiles({ io, digest }).writeNew(fixture.path, original), { code: 'EEXIST' });
  assert.equal(await readFile(fixture.path, 'utf8'), winner); assert.equal(fixture.reads.length, 0);
});

test('denied write preserves external error identity without reading or creating output', async context => {
  const fixture = await filesystem(context), original = await document(), error = new DOMException('Denied', 'NotAllowedError');
  const io: TransferFileIO = { ...fixture.io, writeUTF8: async () => { throw error; } };
  await assert.rejects(() => createTransferFiles({ io, digest }).writeNew(fixture.path, original), cause => cause === error);
  assert.equal(fixture.reads.length, 0); await assert.rejects(() => access(fixture.path), { code: 'ENOENT' });
});

test('failed partial write remains visible and preserves the original external error', async context => {
  const fixture = await filesystem(context), original = await document(), error = new Error('Disk full');
  const io: TransferFileIO = { ...fixture.io, async writeUTF8(path, text) {
    await writeFile(path, text.slice(0, 19), { flag: 'wx' }); throw error;
  } };
  await assert.rejects(() => createTransferFiles({ io, digest }).writeNew(fixture.path, original), cause => cause === error);
  assert.equal((await readFile(fixture.path)).byteLength, 19); assert.equal(fixture.reads.length, 0);
});

for (const count of ['short', 'long', 'NaN', 'fraction'] as const) {
  test(`rejects ${count} external write byte count without acknowledging output`, async context => {
    const fixture = await filesystem(context), original = await document();
    const io: TransferFileIO = { ...fixture.io, async writeUTF8(path, text, options) {
      const actual = await fixture.io.writeUTF8(path, text, options);
      return { short: actual - 1, long: actual + 1, NaN: Number.NaN, fraction: actual - 0.5 }[count];
    } };
    await assert.rejects(() => createTransferFiles({ io, digest }).writeNew(fixture.path, original), { code: 'validation' });
    assert.equal(await readFile(fixture.path, 'utf8'), canonicalJSON(original, { maxBytes }));
  });
}

for (const failure of ['short', 'tampered', 'different-valid', 'oversized', 'invalid-utf8', 'denied'] as const) {
  test(`rejects ${failure} actual readback and leaves the visible output untouched`, async context => {
    const fixture = await filesystem(context), original = await document(), denied = new Error('Readback denied');
    const other = await createExport({ source: original.source, snapshot: original.snapshot,
      exportedAt: '2026-11-06T12:00:00.000Z' }, digest);
    const expected = canonicalJSON(original, { maxBytes }); let output = expected;
    const io: TransferFileIO = { ...fixture.io, async writeUTF8(path, text, options) {
      const count = await fixture.io.writeUTF8(path, text, options);
      output = failure === 'short' ? text.slice(0, -1) : failure === 'tampered' ? text.replace('Café', 'Fake')
        : failure === 'different-valid' ? canonicalJSON(other, { maxBytes })
        : failure === 'oversized' ? text + ' '.repeat(maxBytes + 1 - Buffer.byteLength(text)) : text;
      if (failure === 'invalid-utf8') await writeFile(path, Uint8Array.of(0xff));
      else if (failure !== 'denied') await writeFile(path, output);
      return count;
    }, async read(path, options) {
      if (failure === 'denied') throw denied;
      return fixture.io.read(path, options);
    } };
    const attempt = () => createTransferFiles({ io, digest }).writeNew(fixture.path, original);
    if (failure === 'denied') await assert.rejects(attempt, cause => cause === denied);
    else await assert.rejects(attempt, failure === 'invalid-utf8' ? { name: 'TypeError' }
      : { code: failure === 'oversized' ? 'limit' : 'validation' });
    if (failure === 'invalid-utf8') assert.deepEqual(await readFile(fixture.path), Buffer.from([0xff]));
    else assert.equal(await readFile(fixture.path, 'utf8'), output);
  });
}
