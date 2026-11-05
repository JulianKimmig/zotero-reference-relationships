/** Temporarily attach a sync probe to an existing signed-in client without reading authentication files. */
import { constants } from 'node:fs';
import { chmod, cp, link, lstat, mkdir, mkdtemp, open, readFile, rename, rm, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { errorCode } from '../errors.mts';
import { errorMessage } from '../../src/domain/failures.mts';
import type { BigIntStats } from 'node:fs';
import type { ClientProfile, NativeReport } from '../contracts.mts';

/** Exact owned filesystem identity and bytes, used to reject external modifications on restoration. */
interface OwnedFile { info: BigIntStats; bytes: Buffer }

const controllerID = 'rr-sync-probe@example.test';

/** Inspect existence without reading contents. @param {string} path filesystem entry. @returns {Promise<object|null>} bigint stat or absence. */
async function inspect(path: string) {
  try { return await lstat(path, { bigint: true }); }
  catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

/** Require an existing entry of the specified type. @param {string} path entry. @param {boolean} directory directory versus regular file. @returns {Promise<void>} */
async function requireEntry(path: string, directory: boolean) {
  const info = await inspect(path);
  if (!info || !(directory ? info.isDirectory() : info.isFile())) {
    throw new Error(`Required existing ${directory ? 'directory' : 'regular file'}: ${path}`);
  }
}

/** Read only an owned preference/proxy candidate, refusing symlinks. @param {string} path candidate. @returns {Promise<object|null>} exact bytes and identity. */
async function snapshot(path: string) {
  const info = await inspect(path);
  if (!info) return null;
  if (!info.isFile()) throw new Error(`Expected regular file, refusing symlink or other entry: ${path}`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat({ bigint: true });
    if (info.dev !== actual.dev || info.ino !== actual.ino) throw new Error(`File changed externally: ${path}`);
    return { info: actual, bytes: await handle.readFile() };
  } finally { await handle.close(); }
}

/** Compare exact bytes and inode ownership. @param {object|null} actual current snapshot. @param {object|null} expected owned snapshot. @returns {boolean} equality. */
function matches(actual: OwnedFile | null, expected: OwnedFile | null): boolean {
  if (!actual || !expected) return actual === expected;
  return actual.info.dev === expected.info.dev && actual.info.ino === expected.info.ino
    && actual.bytes.equals(expected.bytes);
}

/** Refuse clobbering a preference changed by another writer. @param {string} path user.js. @param {object|null} expected previous snapshot. @returns {Promise<void>} */
async function requireUnchanged(path: string, expected: OwnedFile | null): Promise<void> {
  let current;
  try { current = await snapshot(path); }
  catch (cause) { throw new Error(`user.js changed externally: ${path}`, { cause }); }
  if (!matches(current, expected)) throw new Error(`user.js changed externally: ${path}`);
}

/** Stage bytes beside user.js and publish atomically after checking ownership. @param {string} path destination. @param {Buffer} bytes content. @param {object|null} expected current snapshot. @param {number} mode permissions. @returns {Promise<object>} installed snapshot. */
async function atomicPreferences(path: string, bytes: Buffer, expected: OwnedFile | null, mode: number): Promise<OwnedFile> {
  const temporary = join(dirname(path), `.rr-sync-user-${randomUUID()}`);
  const handle = await open(temporary, 'wx', mode);
  let info;
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
      info = await handle.stat({ bigint: true });
    } finally { await handle.close(); }
    await requireUnchanged(path, expected);
    if (expected) await rename(temporary, path);
    else await link(temporary, path);
    return { info, bytes };
  } finally { await rm(temporary, { force: true }); }
}

/** Report every cleanup failure after attempting all independent cleanup actions. @param {Error[]} errors collected errors. @returns {void} throws when incomplete. */
function report(errors: unknown[]): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, errors.map(errorMessage).join('; '));
}

/**
 * Prepare a bounded job in an existing dedicated signed-in profile; never launch Zotero.
 * Call restore() after the client exits, including on launch/job failure. It is idempotent
 * after success. External preference/proxy changes are preserved and reported, while
 * independent cleanup continues. Evidence (job, result, logs, user.js.original) remains.
 * @param {{profile:string,data:string}} client existing profile and data directories.
 * @param {object} job JSON-serializable controller payload; paths below override payload paths.
 * @param {{controllerTemplate:string,updateURL:string}} options complete external controller and actual HTTPS production update manifest.
 * @returns {Promise<{root:string,profile:string,data:string,jobFile:string,result:string,restore:()=>Promise<void>}>} private evidence paths and cleanup callback.
 */
export async function prepareSignedSession({ profile, data }: ClientProfile, job: NativeReport, { controllerTemplate, updateURL }: { controllerTemplate: string; updateURL: string }) {
  let secure = false;
  try { secure = new URL(updateURL).protocol === 'https:'; }
  catch (cause) { throw new Error('An explicit HTTPS update URL is required', { cause }); }
  if (!secure) throw new Error('An explicit HTTPS update URL is required');
  profile = resolve(profile);
  data = resolve(data);
  controllerTemplate = resolve(controllerTemplate);
  await requireEntry(profile, true);
  await requireEntry(data, true);
  await requireEntry(join(profile, 'prefs.js'), false);
  await requireEntry(join(data, 'zotero.sqlite'), false);
  await requireEntry(join(controllerTemplate, 'manifest.json'), false);
  await requireEntry(join(controllerTemplate, 'bootstrap.js'), false);
  const manifest = JSON.parse(await readFile(join(controllerTemplate, 'manifest.json'), 'utf8'));
  if (manifest.applications?.zotero?.id !== controllerID) {
    throw new Error(`Controller identity must be ${controllerID}`);
  }
  manifest.applications.zotero.update_url = updateURL;
  const userFile = join(profile, 'user.js');
  const original = await snapshot(userFile);
  const extensions = join(profile, 'extensions');
  const extensionsInfo = await inspect(extensions);
  if (extensionsInfo && !extensionsInfo.isDirectory()) throw new Error(`Expected extensions directory: ${extensions}`);
  const proxy = join(extensions, manifest.applications.zotero.id);
  if (await inspect(proxy)) throw new Error(`Controller proxy already exists: ${proxy}`);
  const root = await mkdtemp(join(tmpdir(), 'reference-relationships-signed-'));
  const controller = join(root, 'controller');
  const jobFile = join(root, 'job.json');
  const result = join(root, 'result.json');
  let userOwner: OwnedFile | null = null;
  let proxyOwner: OwnedFile | null = null;
  let controllerOwned = false;

  /** Restore exact original preferences only while still owned. @returns {Promise<void>} */
  async function restorePreferences() {
    if (!userOwner) return;
    await requireUnchanged(userFile, userOwner);
    if (original) await atomicPreferences(userFile, original.bytes, userOwner, Number(original.info.mode & 0o777n));
    else await unlink(userFile);
    userOwner = null;
  }

  /** Remove only our unmodified exclusive proxy. @returns {Promise<void>} */
  async function removeProxy() {
    if (!proxyOwner) return;
    let current;
    try { current = await snapshot(proxy); }
    catch (cause) { throw new Error(`Controller proxy changed externally: ${proxy}`, { cause }); }
    if (current) {
      if (!matches(current, proxyOwner)) throw new Error(`Controller proxy changed externally: ${proxy}`);
      await unlink(proxy);
    }
    proxyOwner = null;
  }

  /** Delete the private controller copy so retained jobs cannot replay. @returns {Promise<void>} */
  async function removeController() {
    if (!controllerOwned) return;
    await rm(controller, { recursive: true, force: true });
    controllerOwned = false;
  }

  /** Clean each owned launch hook, retaining evidence and reporting conflicts. @returns {Promise<void>} */
  async function restore() {
    const errors = [];
    for (const action of [removeProxy, removeController, restorePreferences]) {
      try { await action(); }
      catch (error) { errors.push(error); }
    }
    report(errors);
  }

  try {
    await chmod(root, 0o700);
    if (original) await writePrivate(join(root, 'user.js.original'), original.bytes);
    await writePrivate(jobFile, Buffer.from(`${JSON.stringify({ ...job, profile, data, result }, null, 2)}\n`));
    controllerOwned = true;
    await cp(controllerTemplate, controller, { recursive: true, errorOnExist: true, force: false });
    const manifestHandle = await open(join(controller, 'manifest.json'), 'w');
    try { await manifestHandle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`); }
    finally { await manifestHandle.close(); }
    await mkdir(extensions, { recursive: true });
    const proxyBytes = Buffer.from(controller);
    const handle = await open(proxy, 'wx', 0o600);
    try {
      proxyOwner = { info: await handle.stat({ bigint: true }), bytes: Buffer.alloc(0) };
      await handle.writeFile(proxyBytes);
      proxyOwner = { info: await handle.stat({ bigint: true }), bytes: proxyBytes };
    } finally { await handle.close(); }
    const preferences = {
      'extensions.referenceRelationships.sync.job': jobFile,
      'extensions.startupScanScopes': 15,
      'extensions.enabledScopes': 15,
      'extensions.autoDisableScopes': 0,
    };
    const lines = Object.entries(preferences).map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
    const bytes = Buffer.concat([original ? original.bytes : Buffer.alloc(0), Buffer.from(`\n${lines.join('\n')}\n`)]);
    userOwner = await atomicPreferences(userFile, bytes, original, original ? Number(original.info.mode & 0o777n) : 0o600);
    return { root, profile, data, jobFile, result, restore };
  } catch (error) {
    try { await restore(); }
    catch (cleanupError) { throw Object.assign(new AggregateError([error, cleanupError], `${errorMessage(error)}; ${errorMessage(cleanupError)}`), { root }); }
    throw Object.assign(error instanceof Error ? error : new Error(errorMessage(error)), { root });
  }
}

/** Write a new evidence file without overwriting anything. @param {string} path destination. @param {Buffer} bytes content. @returns {Promise<void>} */
async function writePrivate(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); }
  finally { await handle.close(); }
}
