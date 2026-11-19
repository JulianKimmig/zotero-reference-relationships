/** Opt-in flat native diagnostics export; only explicit owned job files cross the upload boundary. */
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { evidenceName } from './platform.mts';

/** Exact directories created by the native CI client; no external profile discovery is performed. */
interface OwnedClient { root: string; profile: string; data: string }

/** Admit an existing real upload directory without following its final symlink. @param directory Explicit optional runner setting. @returns Canonical absolute directory, or undefined when disabled. */
export async function diagnosticsDirectory(directory: string | undefined): Promise<string | undefined> {
  if (directory === undefined) return undefined;
  assert.ok(isAbsolute(directory), 'ZOTERO_CI_DIAGNOSTICS must be absolute');
  assert.ok((await lstat(directory)).isDirectory(), 'Diagnostics must be a real directory, not a symlink');
  return realpath(directory);
}

/** Read only a regular owned evidence file, checking handle identity before reading. @param path Explicit log/result path. @returns UTF-8 evidence, or undefined only when absent. */
async function readEvidence(path: string): Promise<string | undefined> {
  let info;
  try { info = await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  assert.ok(info.isFile(), 'Diagnostics source must be a regular file, not a symlink');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const actual = await handle.stat();
    assert.ok(actual.isFile() && actual.dev === info.dev && actual.ino === info.ino, 'Diagnostics source changed externally');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

/** Redact supplied local paths in both log text and JSON-escaped representations. @param text Owned anonymous diagnostics. @param client Owned path identities. @param inputs Explicit artifact/host paths. @returns Text retaining native failures and fixture proof without known private paths. */
function sanitize(text: string, client: OwnedClient, inputs: readonly string[]): string {
  const paths: [string, string][] = [[client.profile, '<profile>'], [client.data, '<data>'], [client.root, '<client-root>'],
    ...inputs.filter(Boolean).map(path => [path, '<input>'] as [string, string])];
  const replacements = paths.flatMap(([path, label]) => {
    const variants = [path, path.replaceAll('\\', '/')];
    return variants.flatMap(value => [[value, label], [JSON.stringify(value).slice(1, -1), label]] as [string, string][]);
  }).sort(([left], [right]) => right.length - left.length);
  for (const [path, label] of replacements) text = text.replaceAll(path, label);
  return text;
}

/** Export only the two explicit job files into exclusive flat regular .log targets. @param directory Optional upload directory. @param client Exclusively owned job root/profile/data. @param action Controlled native action. @param inputs Additional explicit host/archive paths to redact. @returns Completion without traversing any profile or controller directory. */
export async function exportDiagnostics(directory: string | undefined, client: OwnedClient, action: string, inputs: readonly string[] = []): Promise<void> {
  if (directory === undefined) return;
  const destination = (await diagnosticsDirectory(directory))!;
  const root = await realpath(client.root);
  assert.ok((await lstat(client.root)).isDirectory(), 'Owned client root must be a real directory');
  assert.ok(destination !== root && !destination.startsWith(root + (process.platform === 'win32' ? '\\' : '/')), 'Diagnostics must be outside the owned client root');
  const name = evidenceName('release', action), prefix = basename(client.root);
  assert.match(prefix, /^[a-zA-Z0-9_-]+$/, 'Invalid diagnostics client basename');
  for (const suffix of ['.log', '']) {
    const text = await readEvidence(join(client.root, name + suffix));
    if (text === undefined) continue;
    const kind = suffix === '.log' ? 'process' : 'result';
    const target = resolve(destination, `${prefix}-${name}.${kind}.log`);
    assert.equal(dirname(target), destination, 'Diagnostics target escapes upload directory');
    assert.equal(await diagnosticsDirectory(destination), destination, 'Diagnostics directory changed externally');
    const handle = await open(target, 'wx', 0o600);
    try {
      assert.ok((await handle.stat()).isFile(), 'Diagnostics target must be a regular file');
      await handle.writeFile(sanitize(text, client, inputs), 'utf8');
    } finally { await handle.close(); }
  }
}

/** Always attempt export after a native operation, preserving its original failure if export also fails. @param directory Optional upload directory. @param client Owned job directories. @param action Native action. @param inputs Explicit paths to redact. @param operation Actual native execution and envelope validation. @returns Original successful result, or original native rejection. */
export async function withDiagnostics<T>(directory: string | undefined, client: OwnedClient, action: string, inputs: readonly string[], operation: () => Promise<T>): Promise<T> {
  let failed = false;
  try { return await operation(); }
  catch (error) { failed = true; throw error; }
  finally {
    try { await exportDiagnostics(directory, client, action, inputs); }
    catch (error) {
      if (!failed) throw error;
      console.error(`Native diagnostics export also failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
