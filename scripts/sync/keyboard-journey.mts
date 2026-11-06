/** Run an immutable-XPI keyboard workflow in one fresh anonymous native client, persisting every OS delivery before continuing. */
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeJob } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';
import { parseKeyboardProbeArguments, observeKeyboardJob } from './keyboard-probe.mts';
import { validateJourneyRequest } from './keyboard-exchange.mts';
import { sendX11JourneyKeys } from './x11-journey.mts';
import { errorCode } from '../errors.mts';
import { publishKeyboardJSON } from './keyboard-packets.mts';
import type { SyncConfig } from '../contracts.mts';
import type { qualityKeyboardJourney } from '../../tests/sync-controller/quality-keyboard-journey.sys.mts';

/** Serve only the next exact own-file packet until the native job ends; malformed or stale packets fail closed. @param exchange Fresh own directory. @param identity Exact job/data identity. @param completed Actual process completion flag. @returns Completes after all observed deliveries or fails within the global deadline. */
async function deliver(exchange: string, identity: { marker: string; data: string }, completed: () => boolean): Promise<void> {
  const deadline = Date.now() + 230000;
  for (let step = 0; step < 400; step++) {
    let packet: unknown;
    while (packet === undefined) {
      assert.ok(Date.now() < deadline, 'Native keyboard journey delivery deadline exceeded');
      try { packet = JSON.parse(await readFile(join(exchange, `request-${step}.json`), 'utf8')); }
      catch (error) { if (errorCode(error) !== 'ENOENT') throw error; }
      if (packet === undefined) { if (completed()) return; await delay(25); }
    }
    const request = validateJourneyRequest(packet, { ...identity, step });
    try {
      const sender = await sendX11JourneyKeys(request.target, request.strokes, request.focus);
      await publishKeyboardJSON(join(exchange, `delivery-${step}.json`), { request: packet, sender });
      await publishKeyboardJSON(join(exchange, `reply-${step}.json`), { ...identity, step, ok: true });
    } catch (error) {
      await publishKeyboardJSON(join(exchange, `reply-${step}.json`), { ...identity, step, ok: false,
        error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
  throw new Error('Native keyboard journey exceeded400 bounded packets');
}

/** Validate explicit inputs, create a new unsigned-in client and observe both native process and OS sender. @returns Complete artifact-bound evidence or failing process status, without builds/replay/account access. */
async function main(): Promise<void> {
  const { xpi, executable } = parseKeyboardProbeArguments(process.argv.slice(2), { ZOTERO_BIN: process.env.ZOTERO_BIN });
  assert.ok((await stat(xpi)).isFile(), 'XPI must be a regular file'); await access(xpi, constants.R_OK);
  assert.ok((await stat(executable)).isFile(), 'ZOTERO_BIN must be a regular executable file'); await access(executable, constants.X_OK);
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const root = await mkdtemp('/tmp/rr-keyboard-journey-'), marker = randomUUID();
  const config: SyncConfig = { groups: { writable: 9000991, restricted: 9000992 }, clients: {} };
  const options = { root, config, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  await writeFile(join(root, 'artifact.json'), JSON.stringify({ xpi, sha256 }, null, 2), { mode: 0o600, flag: 'wx' });
  const client = await freshUIClient({ ...options, xpi, groups: config.groups, id: manifest.applications.zotero.id, version: manifest.version });
  config.clients.keyboard = client;
  await writeFile(join(root, 'client.json'), JSON.stringify(client, null, 2), { mode: 0o600, flag: 'wx' });
  const exchange = join(client.data, 'keyboard-journey'); await mkdir(exchange, { mode: 0o700 });
  let completed = false;
  const pending = nativeJob<Awaited<ReturnType<typeof qualityKeyboardJourney>>>(options, 'keyboard', {
    action: 'quality:keyboard-journey', xpi, groups: config.groups, marker, sync: false,
  }).finally(() => { completed = true; });
  const report = await observeKeyboardJob(pending, () => deliver(exchange, { data: client.data, marker }, () => completed));
  assert.equal(report.actualNativeKeyboard, true); assert.equal(report.unsignedIn, true); assert.equal(report.stages.length, 4);
  assert.equal(createHash('sha256').update(await readFile(xpi)).digest('hex'), sha256, 'Supplied XPI changed during journey');
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, report }, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
