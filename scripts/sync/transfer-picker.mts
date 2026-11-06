/** Verify actual native picker cancellation and exact path selection with real keys on owned anonymous Xvfb clients. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeJob } from './run.mts';
import { freshUIClient } from './fresh-ui.mts';
import { pickerVisible, pickerKeys } from './x11-picker.mts';
import type { NativeReport, SyncConfig } from '../contracts.mts';

/** Run a dialog once and stop on any report/process/key failure rather than substitute a fake result. @returns {Promise<void>} */
async function main(): Promise<void> {
  assert.ok(process.argv.length === 3 && isAbsolute(process.argv[2]), 'Usage: node .build/scripts/sync/transfer-picker.mjs /absolute/current.xpi');
  const executable = process.env.ZOTERO_BIN; assert.ok(executable, 'Set ZOTERO_BIN');
  const root = await mkdtemp('/tmp/rr-native-picker-'), xpi = process.argv[2];
  const sha256 = createHash('sha256').update(await readFile(xpi)).digest('hex');
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const config: SyncConfig = { groups: { writable: 9000991, restricted: 9000992 }, clients: {} };
  const options = { root, config, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const reports: Record<string, NativeReport> = {};
  for (const role of ['cancel', 'open'] as const) {
    const client = await freshUIClient({ ...options, xpi, groups: config.groups, id: manifest.applications.zotero.id, version: manifest.version });
    config.clients[role] = client;
    await writeFile(join(root, `${role}-client.json`), JSON.stringify(client));
    const pickerPath = `/tmp/rr-native-picker-${randomUUID()}.json`;
    let completed = false;
    const pending = nativeJob(options, role, { action: `transfer:picker-${role}`, xpi, groups: config.groups, pickerPath,
      marker: 'RR actual native picker', sync: false }).then(report => { completed = true; return { report }; },
      (error: unknown) => { completed = true; return { error }; });
    const deadline = Date.now() + 60000; let display: string | null = null, authority: string | null = null;
    while (!completed && Date.now() < deadline) {
      try {
        const ready = JSON.parse(await readFile(join(client.data, 'picker-ready.json'), 'utf8'));
        assert.equal(ready.path, pickerPath); assert.equal(typeof ready.display, 'string'); assert.equal(typeof ready.authority, 'string');
        if (await pickerVisible(ready.display, ready.authority)) { display = ready.display; authority = ready.authority; break; }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      await delay(100);
    }
    if (!completed) {
      assert.ok(display && authority, 'Actual owned native FilePicker never appeared');
      await pickerKeys(display, authority, role === 'cancel' ? 'cancel' : 'location');
      if (role === 'open') {
        await delay(200); await pickerKeys(display, authority, 'path', pickerPath);
        await delay(500); if (!completed && await pickerVisible(display, authority)) await pickerKeys(display, authority, 'accept');
      }
    }
    const outcome = await pending; if ('error' in outcome) throw outcome.error;
    reports[role] = outcome.report;
  }
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, xpi, sha256, reports }, null, 2));
  console.log(JSON.stringify({ ok: true, root, sha256 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
