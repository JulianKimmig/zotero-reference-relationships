/** Deliver real OS keyboard input to one fresh unsigned-in Gecko/Zotero client using an exact existing XPI. */
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeJob } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';
import { sendX11Keys, validateX11KeyboardInput } from './x11-keyboard.mts';
import { errorCode } from '../errors.mts';
import type { SyncConfig } from '../contracts.mts';
import type { X11KeyboardTarget, X11KeyboardReport } from './x11-keyboard.mts';
import type { qualityKeyboardProbe } from '../../tests/sync-controller/quality-keyboard-probe.sys.mts';

/** Receipt identity binds the exchange to exactly one new data directory and native job. */
interface ExchangeIdentity { data: string; marker: string }

/** Reject unsupported journeys before reading files or creating a client. @param args Exactly --xpi and an absolute existing artifact path. @param environment Only the explicit executable setting is consulted. @returns Validated artifact and executable paths. */
export function parseKeyboardProbeArguments(args: string[], environment: { ZOTERO_BIN?: string }): { xpi: string; executable: string } {
  assert.ok(args.length === 2 && args[0] === '--xpi' && isAbsolute(args[1]) && !args[1].includes('\0'),
    'Usage: node keyboard-probe.mjs --xpi /absolute/existing.xpi');
  const executable = environment.ZOTERO_BIN;
  assert.ok(executable && isAbsolute(executable) && !executable.includes('\0'), 'Set absolute ZOTERO_BIN');
  return { xpi: args[1], executable };
}

/** Validate the exact own-file receipt before exposing its paths to the sender. @param receipt Parsed untrusted exchange JSON. @param expected Owned data path and unique job marker. @returns Only validated private DISPLAY and XAUTHORITY path. */
export function validateKeyboardReady(receipt: unknown, expected: ExchangeIdentity): X11KeyboardTarget {
  assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'Missing keyboard probe ready receipt');
  assert.ok('data' in receipt && receipt.data === expected.data, 'Keyboard ready data isolation mismatch');
  assert.ok('marker' in receipt && receipt.marker === expected.marker, 'Keyboard ready marker mismatch');
  assert.ok('action' in receipt && receipt.action === 'quality:keyboard-probe', 'Keyboard ready action mismatch');
  assert.ok('state' in receipt && receipt.state === 'ready', 'Keyboard probe is not ready');
  assert.ok('display' in receipt && typeof receipt.display === 'string', 'Missing private DISPLAY');
  assert.ok('authority' in receipt && typeof receipt.authority === 'string', 'Missing XAUTHORITY path');
  const target = { display: receipt.display, authority: receipt.authority, windowMarker: expected.marker };
  validateX11KeyboardInput(target, [{ key: 'a', modifiers: [] }]);
  return target;
}

/** Wait for only the exact new client's ready file, bounded by startup and process completion. @param path Exact controller exchange file. @param expected Owned receipt identity. @param completed Whether the observed native process has ended. @param timeoutMs Explicit startup bound. @returns Validated sender target or the original read/validation failure. */
export async function waitKeyboardReady(path: string, expected: ExchangeIdentity, completed: () => boolean, timeoutMs = 60000): Promise<X11KeyboardTarget> {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000, 'Invalid keyboard ready timeout');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert.ok(!completed(), 'Native keyboard job ended before ready receipt');
    try { return validateKeyboardReady(JSON.parse(await readFile(path, 'utf8')), expected); }
    catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
    await delay(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  throw new Error('Keyboard probe ready wait timed out');
}

/** Observe both external delivery and the ordinary native process even when either fails. @param pending Already running bounded native job. @param deliver Bounded ready wait and OS sender. @returns Native report after both settle, or all available failure diagnostics. */
export async function observeKeyboardJob<T>(pending: Promise<T>, deliver: () => Promise<void>): Promise<T> {
  const [native, sender] = await Promise.allSettled([pending, Promise.resolve().then(deliver)]);
  const errors: unknown[] = [];
  if (sender.status === 'rejected') errors.push(sender.reason);
  if (native.status === 'rejected') errors.push(native.reason);
  if (errors.length) throw new AggregateError(errors, errors.map(error => error instanceof Error ? error.message : String(error)).join('; '));
  assert.ok(native.status === 'fulfilled');
  return native.value;
}

/** Run one artifact-bound backend probe without builds, replay, signed clients or product UI changes. @returns Complete proof file and ordinary native process evidence, or a failing CLI exit. */
async function main(): Promise<void> {
  const { xpi, executable } = parseKeyboardProbeArguments(process.argv.slice(2), { ZOTERO_BIN: process.env.ZOTERO_BIN });
  assert.ok((await stat(xpi)).isFile(), 'XPI must be a regular file');
  await access(xpi, constants.R_OK);
  assert.ok((await stat(executable)).isFile(), 'ZOTERO_BIN must be a regular executable file');
  await access(executable, constants.X_OK);
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const root = await mkdtemp('/tmp/rr-keyboard-probe-'), marker = randomUUID();
  const config: SyncConfig = { groups: { writable: 9000991, restricted: 9000992 }, clients: {} };
  const options = { root, config, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  await writeFile(join(root, 'artifact.json'), JSON.stringify({ xpi, sha256 }, null, 2), { mode: 0o600, flag: 'wx' });
  const client = await freshUIClient({ ...options, xpi, groups: config.groups,
    id: manifest.applications.zotero.id, version: manifest.version });
  config.clients.keyboard = client;
  await writeFile(join(root, 'client.json'), JSON.stringify(client, null, 2), { mode: 0o600, flag: 'wx' });
  const exchange = join(client.data, 'keyboard-probe');
  // The controller writes create-only receipts here; no existing profile, replay or external exchange is accepted.
  await mkdir(exchange, { mode: 0o700 });
  let completed = false;
  const pending = nativeJob<Awaited<ReturnType<typeof qualityKeyboardProbe>>>(options, 'keyboard', {
    action: 'quality:keyboard-probe', xpi, groups: config.groups, marker, sync: false,
  }).finally(() => { completed = true; });
  let sender: X11KeyboardReport | undefined;
  const report = await observeKeyboardJob(pending, async () => {
    const target = await waitKeyboardReady(join(exchange, 'ready.json'), { data: client.data, marker }, () => completed);
    sender = await sendX11Keys(target, [{ key: 'a', modifiers: [] }, { key: 'Tab', modifiers: [] }, { key: 'space', modifiers: [] }]);
  });
  assert.ok(sender, 'Missing actual XTEST delivery report');
  assert.equal(sender.windowMarker, report.windowMarker, 'Sender and native window identities differ');
  assert.equal(report.actualNativeKeyboard, true); assert.equal(report.unsignedIn, true);
  assert.deepEqual(report.after, report.before, 'Native keyboard probe changed authority');
  assert.equal(report.manifestCountAfter, report.manifestCountBefore, 'Native keyboard probe published authority');
  assert.equal(createHash('sha256').update(await readFile(xpi)).digest('hex'), sha256, 'Supplied XPI changed during probe');
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, sender, report }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
