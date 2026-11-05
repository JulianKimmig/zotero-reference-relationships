/** Orchestrate actual native immutable-publication assertions in separate client jobs. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { nativeJob, validateConfig } from './run.mts';
import type { NativeReport } from '../contracts.mts';

/** Every publication phase reports the current synthetic fixture identities for restart/resume. */
type PublicationReport = NativeReport & { fixtures: Record<string, string> };

/** Execute the native suite using explicit existing test-client configuration.
 * @returns {Promise<void>} Writes sanitized evidence; nativeJob owns profile cleanup.
 */
async function main() {
  const resume = process.argv.length === 5 && process.argv[3] === '--resume';
  assert.ok(process.argv.length === 3 || resume,
    'Usage: node scripts/sync/publication.mjs config.json [--resume /absolute/evidence-root]');
  const executable = process.env.ZOTERO_BIN;
  assert.ok(executable, 'Set ZOTERO_BIN');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  validateConfig(config);
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const root = resume ? process.argv[4] : await mkdtemp(join(tmpdir(), 'rr-storage-publication-'));
  const prior = resume ? JSON.parse(await readFile(join(root, 'progress.json'), 'utf8')) : null;
  const options = { config, root, executable, updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const common = { groups: config.groups, marker: prior ? prior.marker : `RR synthetic publication ${randomUUID()}` };
  const reports: Record<string, PublicationReport> = prior ? prior.reports : {};
  let fixtures = prior ? prior.fixtures : {};
  /** Preserve ordered evidence while passing only synthetic fixture identities.
   * @param {string} name Unique evidence step. @param {string} role Native client alias.
   * @param {string} action Publication suffix. @param {object} extra Explicit branch/keys.
   * @returns {Promise<object>} Actual native report.
   */
  async function step(name: string, role: string, action: string, extra: NativeReport = {}): Promise<PublicationReport> {
    if (Object.hasOwn(reports, name)) return reports[name];
    const report = await nativeJob<PublicationReport>(options, role, { ...common, fixtures, ...extra, action: `publication:${action}` });
    fixtures = { ...fixtures, ...report.fixtures };
    reports[name] = report;
    await writeFile(join(root, 'progress.json'), JSON.stringify({ marker: common.marker, fixtures, reports }, null, 2));
    return report;
  }
  await step('seed', 'a1', 'seed');
  await step('partial', 'a1', 'partial');
  await step('pending', 'a2', 'pending');
  await step('pendingAfterRestart', 'a2', 'pending');
  await step('complete', 'a1', 'complete');
  await step('ready', 'a2', 'ready');
  await step('prepareB1', 'b1', 'ready');
  const base = { ...reports.prepareB1.fixtures };
  await step('deleteFork', 'a1', 'fork', { branch: 'delete', fixtures: base });
  await step('editFork', 'b1', 'fork', { branch: 'edit', fixtures: base });
  await step('publishDelete', 'a1', 'publish', { branch: 'delete', fixtures: reports.deleteFork.fixtures });
  await step('publishEdit', 'b1', 'publish', { branch: 'edit' });
  await step('conflict', 'a2', 'conflict');
  await step('resolve', 'a1', 'resolve');
  await step('resolved', 'a2', 'resolved');
  await step('resolvedAfterRestart', 'a2', 'resolved');
  await step('failedLocalTransaction', 'b1', 'failed-local-transaction');
  await step('resolvedAfterFailure', 'a2', 'resolved');
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, marker: common.marker, fixtures, reports }, null, 2));
  console.log(JSON.stringify({ ok: true, root, fixtures }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
