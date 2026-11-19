/** Installed archive evidence hashes real file bytes through the external native URI/File/IO boundary. */
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { installedSHA256, requireCIHashes } from './sync-controller/installed-artifact.sys.mts';
import type { InstalledArtifactAPI } from './sync-controller/installed-artifact.sys.mts';

/** Construct only external native API resources backed by actual separate installed/input files. @returns Native boundary, addon URI, real installed bytes and expected hashes. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rr installed '));
  const input = join(root, 'input.xpi'), installed = join(root, 'installed addon.xpi');
  const bytes = Buffer.from('real installed archive bytes');
  await writeFile(input, 'different frozen input bytes'); await writeFile(installed, bytes);
  const reads: string[] = [];
  const stats = await lstat(installed), uri = `jar:${pathToFileURL(installed).href}!/`;
  const file = { path: installed, fileSize: stats.size,
    /** Model external nsIFile regular-file inspection. @returns Actual fixture file kind. */
    isFile(): boolean { return stats.isFile(); },
    /** Model external nsIFile symlink inspection. @returns Actual fixture link kind. */
    isSymlink(): boolean { return stats.isSymbolicLink(); },
  };
  const iid = {}, api: InstalledArtifactAPI = {
    Components: { interfaces: { nsIFileURL: iid } },
    Services: { io: {
      /** Resolve URI through the external platform boundary. @param spec Actual installed file URI. @returns Native file URL capabilities. */
      newURI(spec: string) {
        assert.equal(fileURLToPath(spec), installed);
        return { spec,
          /** Resolve the platform file interface, never infer a path from the input archive. @param requested Native interface identity. @returns Actual installed file. */
          QueryInterface(requested: object) { assert.equal(requested, iid); return { file }; },
        };
      },
    } },
    IOUtils: {
      /** Read actual selected native archive bytes. @param path Resolved installed path. @param options Native read bound. @returns Real bytes, limited to the native request. */
      async read(path: string, options: { maxBytes: number }): Promise<Uint8Array> {
        reads.push(path); return (await readFile(path)).subarray(0, options.maxBytes);
      },
    },
    crypto: webcrypto as Pick<Crypto, 'subtle'>,
  };
  const addon = {
    /** Read the actual addon resource root. @returns Packed installed archive URI. */
    getResourceURI() { return { spec: uri }; },
  };
  return { api, addon, reads, installed, input, file, expected: createHash('sha256').update(bytes).digest('hex') };
}

test('hashes only the regular archive resolved from the installed addon URI, including path spaces', async () => {
  const f = await fixture();
  assert.equal(await installedSHA256(f.api, f.addon, f.expected), f.expected);
  assert.deepEqual(f.reads, [f.installed]);
  assert.notEqual(createHash('sha256').update(await readFile(f.input)).digest('hex'), f.expected);
});

test('rejects installed byte substitution even when expected input still matches', async () => {
  const f = await fixture(); await writeFile(f.input, await readFile(f.installed));
  await writeFile(f.installed, 'changed installed archive bytes');
  f.file.fileSize = (await lstat(f.installed)).size;
  await assert.rejects(installedSHA256(f.api, f.addon, f.expected), /installed.*SHA-256/);
});

for (const uri of ['file:///tmp/unpacked/', 'https://example.test/addon.xpi', 'jar:https://example.test/addon.xpi!/',
  'jar:file://server/share/addon.xpi!/', 'jar:file:relative.xpi!/', 'jar:file:///tmp/addon.xpi!/nested/', 'jar:jar:file:///tmp/addon.xpi!/other.xpi!/', 'jar:file:///tmp/addon.xpi?query!/']) {
  test(`rejects nonlocal, unpacked or nonroot installed URI ${uri}`, async () => {
    const f = await fixture();
    await assert.rejects(installedSHA256(f.api, { getResourceURI: () => ({ spec: uri }) }, f.expected), /installed.*archive|installed.*URI/);
    assert.deepEqual(f.reads, []);
  });
}

test('rejects nonregular files and native symlinks before reading archive bytes', async () => {
  for (const kind of ['directory', 'symlink']) {
    const f = await fixture();
    f.file.isFile = () => kind !== 'directory'; f.file.isSymlink = () => kind === 'symlink';
    await assert.rejects(installedSHA256(f.api, f.addon, f.expected), /regular|symlink/);
    assert.deepEqual(f.reads, []);
  }
});

test('rejects a changed native file size and propagates read failure', async () => {
  const f = await fixture(); f.file.fileSize += 1;
  await assert.rejects(installedSHA256(f.api, f.addon, f.expected), /size|truncated/);
  const broken = await fixture(), error = new Error('native IO failure');
  broken.api.IOUtils = { async read(): Promise<never> { throw error; } };
  await assert.rejects(installedSHA256(broken.api, broken.addon, broken.expected), caught => caught === error);
});

test('requires a valid expected hash and native IO rather than reporting an unbound digest', async () => {
  const f = await fixture();
  for (const expected of [undefined, '', 'not-a-hash', 'A'.repeat(64)]) {
    await assert.rejects(installedSHA256(f.api, f.addon, expected), /SHA-256/);
  }
  await assert.rejects(installedSHA256({ ...f.api, IOUtils: undefined }, f.addon, f.expected), /native.*IO/);
  assert.deepEqual(f.reads, []);
});

test('schema 2 dispatch requires current hash and pairs the predecessor with its hash', () => {
  const hash = 'a'.repeat(64);
  assert.doesNotThrow(() => requireCIHashes({ currentSHA256: hash }));
  for (const job of [{}, { currentSHA256: '' }, { currentSHA256: hash, previousXPI: '/previous' },
    { currentSHA256: hash, previousSHA256: hash }]) assert.throws(() => requireCIHashes(job), /SHA-256|predecessor/);
  assert.doesNotThrow(() => requireCIHashes({ currentSHA256: hash, previousXPI: '/previous', previousSHA256: hash }));
});
