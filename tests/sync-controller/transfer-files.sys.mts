/** Native IOUtils conformance for portable graph files; external fault injections are reported separately. */
import { contractFailure, errorMessage, present } from './evidence.sys.mts';
import { resources, preserved } from './reconciliation-fixtures.sys.mts';
import { commits } from './rules-fixtures.sys.mts';
import { check } from './ui-helpers.sys.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { NativeModuleLoader } from './module-contracts.mts';
import type { TransferFileIO } from '../../src/transfer/file-contracts.mts';

/** Extra real native operations used only to create/check integration fixtures. */
type NativeFileIO = NonNullable<NativeAPI['IOUtils']> & {
  /** Write actual undecoded fixture bytes. @param path New fixture. @param bytes Raw bytes. @param options Exclusive flushed output. @returns Native byte count. */
  write(path: string, bytes: Uint8Array, options: { mode: 'create'; flush: true }): Promise<number>;
  /** Observe actual path presence without replacing failed data. @param path Fixture path. @returns Whether the native path exists. */
  exists(path: string): Promise<boolean>;
};

/** Local source-path overload keeps shared loader contracts under the routing owner's control. */
type FileModuleLoader = NativeModuleLoader & {
  /** Load the actual installed canonical encoder. @param uri Exact production module. @returns Production exports. */
  importESModule(uri: `resource://${string}/src/storage/canonical.mjs`): typeof import('../../src/storage/canonical.mts');
};

/**
 * Require a real rejection, optionally checking its production contract category across compartments.
 * @param action Native/file adapter operation that must not acknowledge success.
 * @param code Expected production validation category, when the failure is not native I/O.
 * @returns Original rejection for observing native diagnostics or external error identity.
 */
async function rejected(action: () => Promise<unknown>, code?: string): Promise<unknown> {
  try { await action(); }
  catch (error) {
    check(error !== null && error !== undefined, 'Native file rejection omitted its reason');
    if (code) check(contractFailure(error).code === code, `Expected ${code}: ${errorMessage(error)}`);
    return error;
  }
  throw new Error('Unsafe native file operation unexpectedly acknowledged success');
}

/** Read a native exception name without cross-compartment prototype assumptions. @param error Observed rejection. @returns Literal platform name. */
function errorName(error: unknown): string {
  check(error !== null && typeof error === 'object' && 'name' in error && typeof error.name === 'string', 'File failure omitted its exception name');
  return error.name;
}

/**
 * Exercise the installed file adapter using actual anonymous-profile paths and native file resources.
 * @param job transfer:files job with an existing disposable data directory and production XPI.
 * @param api Actual privileged platform; no source modules, authority writers or dialog resources are mocked.
 * @returns Native core evidence, explicitly separated external I/O fault evidence and unchanged authority.
 */
export async function transferFiles(job: ControllerJob, api: NativeAPI) {
  check(job.action === 'transfer:files', 'Unknown native transfer file phase');
  check(!api.Zotero.Users.getCurrentUserID(), 'File conformance requires a fresh unsigned-in profile');
  const data = present(job.data); check(data.length > 0, 'Native file fixture directory is required');
  const production = await resources(job, api), loader = api.ChromeUtils as FileModuleLoader;
  const { createTransferFiles } = loader.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-files.mjs');
  const { createRepositoryFactory } = loader.importESModule('resource://rr-reconciliation-production/src/adapters/repositories.mjs');
  const { createTransferIdentity } = loader.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-identity.mjs');
  const { createExport } = loader.importESModule('resource://rr-reconciliation-production/src/transfer/format.mjs');
  const { initialGraph } = loader.importESModule('resource://rr-reconciliation-production/src/application/seed.mjs');
  const { canonicalJSON } = loader.importESModule('resource://rr-reconciliation-production/src/storage/canonical.mjs');
  const io = present(api.IOUtils) as NativeFileIO;
  check(typeof io.write === 'function' && typeof io.exists === 'function', 'Real native raw byte write and exists methods are required');
  const factory = createRepositoryFactory({ Zotero: api.Zotero, DOMParser: api.DOMParser,
    crypto: api.crypto, TextEncoder: api.TextEncoder, gateway: production.gateway });
  try {
    const files = createTransferFiles({ io, digest: factory.digest }), encoder = new api.TextEncoder(), maxBytes = 2_097_152;
    const app = present(api.Zotero.ReferenceRelationships).application;
    const before = await app.read('self'), count = await commits(api);
    const source = createTransferIdentity({ Zotero: api.Zotero, gateway: production.gateway }).read('self');
    check(source.kind === 'local-user', 'File fixture owner is not the actual anonymous owner');
    const snapshot = initialGraph('self'), exportedAt = '2026-11-05T12:00:00.000Z';
    snapshot.types[0].version = 7; snapshot.types[1].version = 4;
    snapshot.assertions.push({ id: 'portable-file-root', source: { library: 'self', key: 'AAAAAAAB' },
      target: { library: 'self', key: 'BBBBBBBC' }, type: 'referencing', metadata: { note: 'Cafe\u0301 你好 😀 <b>literal</b>' },
      createdAt: exportedAt, updatedAt: exportedAt });
    snapshot.rules.push({ id: 'portable-file-inverse', version: 9, enabled: true, rootType: 'referencing', inputType: 'referencing',
      outputType: 'referenced-by', transform: 'reverse', conditions: [], mapping: { note: { kind: 'root', field: 'note' } } });
    const document = await createExport({ source, snapshot, exportedAt }, factory.digest);
    const canonical = canonicalJSON(document, { maxBytes }), byteCount = encoder.encode(canonical).byteLength;
    const other = await createExport({ source, snapshot, exportedAt: '2026-11-06T12:00:00.000Z' }, factory.digest);
    const otherCanonical = canonicalJSON(other, { maxBytes });
    /** Keep every fixture exclusively within the supplied disposable data directory. @param name Fixed fixture basename. @returns Native path. */
    function path(name: string): string { return `${data}/transfer-files-${name}`; }
    /** Check actual state and immutable note count after each case. @returns No authority changes. */
    async function unchanged(): Promise<void> { await preserved(api, before, count); }

    const unicodePath = path('Café-你好-😀.json');
    await files.writeNew(unicodePath, document);
    check(await io.readUTF8(unicodePath) === canonical, 'Native UTF-8 output is not the exact canonical document');
    check((await io.read(unicodePath, { maxBytes: maxBytes + 1 })).byteLength === byteCount, 'Native UTF-8 byte count differs');
    const roundtrip = await files.read(unicodePath);
    check(canonicalJSON(roundtrip, { maxBytes }) === canonical && roundtrip.snapshot.rules[0].version === 9
      && roundtrip.snapshot.types[0].version === 7 && roundtrip.snapshot.assertions[0].metadata.note === 'Café 你好 😀 <b>literal</b>',
    'Native Unicode/NFC roundtrip changed complete authority');
    await unchanged();

    const existingPath = path('existing.json'), existingText = 'Existing Café 你好 😀\n';
    await io.writeUTF8(existingPath, existingText, { mode: 'create', flush: true });
    const existingBytes = await io.read(existingPath, { maxBytes: maxBytes + 1 });
    const existingError = await rejected(() => files.writeNew(existingPath, document));
    check(errorName(existingError) !== 'ContractError', 'Existing path failed before native exclusive creation');
    const remainingBytes = await io.read(existingPath, { maxBytes: maxBytes + 1 });
    check(remainingBytes.byteLength === existingBytes.byteLength && remainingBytes.every((value, index) => value === existingBytes[index]),
      'Existing destination bytes changed'); await unchanged();

    const racingPath = path('racing.json');
    const race = await Promise.allSettled([files.writeNew(racingPath, document), files.writeNew(racingPath, other)]);
    check(race.filter(result => result.status === 'fulfilled').length === 1, 'Native concurrent create did not have exactly one winner');
    const winner = race[0].status === 'fulfilled' ? canonical : otherCanonical;
    check(canonicalJSON(await files.read(racingPath), { maxBytes }) === winner, 'Native race file differs from the acknowledged complete winner');
    const loser = present(race.find(result => result.status === 'rejected'));
    check(loser.status === 'rejected' && errorName(loser.reason) !== 'ContractError', 'Race loser did not expose actual native I/O refusal');
    await unchanged();

    const boundaryPath = path('boundary.json'), padding = ' '.repeat(maxBytes - byteCount);
    await io.writeUTF8(boundaryPath, canonical + padding, { mode: 'create', flush: true });
    check(canonicalJSON(await files.read(boundaryPath), { maxBytes }) === canonical, 'Inclusive native 2 MiB input was rejected or changed');
    const oversizedPath = path('oversized.json');
    await io.writeUTF8(oversizedPath, canonical + padding + ' ', { mode: 'create', flush: true });
    check((await io.read(oversizedPath, { maxBytes: maxBytes + 1 })).byteLength === maxBytes + 1, 'Native read did not expose the sentinel byte');
    await rejected(() => files.read(oversizedPath), 'limit'); await unchanged();

    const invalidUTF8Path = path('invalid-utf8.json');
    check(await io.write(invalidUTF8Path, Uint8Array.of(0xff), { mode: 'create', flush: true }) === 1, 'Native raw fixture write count differs');
    check(errorName(await rejected(() => files.read(invalidUTF8Path))) === 'TypeError', 'Invalid native UTF-8 did not fail strict decoding');
    await unchanged();

    const invalidFiles = [
      { name: 'malformed', text: '{', code: 'validation' },
      { name: 'unknown-schema', text: JSON.stringify({ ...document, schema: 2 }), code: 'unsupported-schema' },
      { name: 'invalid-hash', text: JSON.stringify({ ...document, hash: '0'.repeat(64) }), code: 'validation' },
    ];
    for (const invalid of invalidFiles) {
      const target = path(`${invalid.name}.json`);
      await io.writeUTF8(target, invalid.text, { mode: 'create', flush: true });
      await rejected(() => files.read(target), invalid.code);
      check(await io.readUTF8(target) === invalid.text, 'Rejected input file was altered'); await unchanged();
    }

    const invalidDocuments = [
      { name: 'bad-envelope', value: {}, code: 'validation' },
      { name: 'bad-schema', value: { ...document, schema: 2 }, code: 'unsupported-schema' },
      { name: 'bad-hash', value: { ...document, hash: '0'.repeat(64) }, code: 'validation' },
      { name: 'bad-content', value: { ...document, exportedAt: other.exportedAt }, code: 'validation' },
    ];
    for (const invalid of invalidDocuments) {
      const target = path(`${invalid.name}-not-created.json`);
      check(!await io.exists(target), 'Validation fixture path already exists');
      await rejected(() => files.writeNew(target, invalid.value), invalid.code);
      check(!await io.exists(target), 'Invalid envelope created a native file'); await unchanged();
    }

    const missingPath = path('missing.json'); check(!await io.exists(missingPath), 'Missing-file fixture already exists');
    const readError = await rejected(() => files.read(missingPath));
    check(errorName(readError) !== 'ContractError', 'Missing input did not surface actual native I/O failure');
    const writeError = await rejected(() => files.writeNew(`${unicodePath}/cannot-create.json`, document));
    check(errorName(writeError) !== 'ContractError', 'Invalid native destination did not surface actual I/O failure');
    check(await io.readUTF8(unicodePath) === canonical, 'Failed native child-path write altered its existing parent file');
    await unchanged();

    const shortPath = path('injected-short-count.json');
    const shortIO: TransferFileIO = {
      /** Read actual native bytes if requested. @param target Native path. @param options Byte bound. @returns Actual bytes. */
      read(target, options) { return io.read(target, options); },
      /** Inject only a misreported external byte count after a real successful write. @param target New file. @param text Canonical text. @param options Create/flush. @returns Short reported count. */
      async writeUTF8(target, text, options) { return await io.writeUTF8(target, text, options) - 1; },
    };
    await rejected(() => createTransferFiles({ io: shortIO, digest: factory.digest }).writeNew(shortPath, document), 'validation');
    check(await io.readUTF8(shortPath) === canonical, 'Short-count failure removed or altered visible output'); await unchanged();

    const readbackPath = path('injected-readback-error.json'), readbackError = new Error('Injected external readback failure');
    const readbackIO: TransferFileIO = {
      /** Inject only external read failure after an actual native write. @returns Original external failure. */
      async read() { throw readbackError; },
      /** Perform the actual native exclusive flushed write. @param target New path. @param text Canonical output. @param options Create/flush. @returns Actual byte count. */
      writeUTF8(target, text, options) { return io.writeUTF8(target, text, options); },
    };
    check(await rejected(() => createTransferFiles({ io: readbackIO, digest: factory.digest }).writeNew(readbackPath, document)) === readbackError,
      'Failed readback acknowledged output or replaced the external error');
    check(await io.readUTF8(readbackPath) === canonical, 'Failed readback removed or altered visible output'); await unchanged();

    const tamperedPath = path('injected-readback-tamper.json');
    const tamperedIO: TransferFileIO = {
      /** Inject external replacement by another valid document before actual bounded readback. @param target Just-written file. @param options Byte bound. @returns Actual changed native bytes. */
      async read(target, options) {
        await io.writeUTF8(target, otherCanonical, { mode: 'overwrite', flush: true });
        return io.read(target, options);
      },
      /** Perform actual native exclusive creation before the external replacement. @param target New path. @param text Canonical output. @param options Create/flush. @returns Actual native byte count. */
      writeUTF8(target, text, options) { return io.writeUTF8(target, text, options); },
    };
    await rejected(() => createTransferFiles({ io: tamperedIO, digest: factory.digest }).writeNew(tamperedPath, document), 'validation');
    check(canonicalJSON(await files.read(tamperedPath), { maxBytes }) === otherCanonical, 'Readback mismatch removed the externally changed file');
    await unchanged();

    return { before, count, noAuthorityWrites: true,
      nativeCore: { unicodePath, unicodeNFC: true, foreignVersions: true, exactCanonicalBytes: byteCount,
        existingPath, existingUnchanged: true, existingError: { name: errorName(existingError), message: errorMessage(existingError) },
        racingPath, exactlyOneNativeCreator: true, raceWinner: race[0].status === 'fulfilled' ? 0 : 1,
        raceError: { name: errorName(loser.reason), message: errorMessage(loser.reason) },
        inclusive2MiB: true, oversizedPrefixRejected: true, invalidUTF8Rejected: true, malformedUnknownHashRejected: true,
        validationBeforeCreation: true, missingReadRejected: { name: errorName(readError), message: errorMessage(readError) },
        newFileWriteRejected: { name: errorName(writeError), message: errorMessage(writeError) } },
      externalIOFaults: { shortCount: { path: shortPath, notAcknowledged: true, visibleOutputPreserved: true },
        readbackFailure: { path: readbackPath, notAcknowledged: true, originalErrorPreserved: true, visibleOutputPreserved: true },
        readbackTamper: { path: tamperedPath, differentValidDocumentRejected: true, visibleOutputPreserved: true } } };
  } finally { factory.clear(); }
}
