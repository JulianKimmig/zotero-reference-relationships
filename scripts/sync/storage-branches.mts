/** Verify production repository offline conflicts, resolution, editor preservation and corruption recovery. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { nativeJob, validateConfig } from './run.mts';
import type { Graph } from '../../src/domain/contracts.mts';
import type { NativeReport } from '../contracts.mts';

/** Fork and resolution actions return complete original authority and its manifest identity. */
type StoreReport = NativeReport & { currentHead: string; current: Graph };

/** Run independent native jobs on the prior synthetic production-store fixture. @returns {Promise<void>} */
async function main() {
  assert.equal(process.argv.length, 4, 'Usage: node scripts/sync/storage-branches.mjs config.json prior-storage-result.json');
  const config = JSON.parse(await readFile(process.argv[2], 'utf8')); validateConfig(config);
  const prior = JSON.parse(await readFile(process.argv[3], 'utf8')); assert.equal(prior.ok, true);
  assert.ok(process.env.ZOTERO_BIN, 'Set ZOTERO_BIN');
  const root = await mkdtemp(join(tmpdir(), 'rr-production-branches-'));
  const manifest = JSON.parse(await readFile(new URL('../../manifest.json', import.meta.url), 'utf8'));
  const options = { config, root, executable: process.env.ZOTERO_BIN,
    updateURL: manifest.applications.zotero.update_url,
    controllerTemplate: fileURLToPath(new URL('../../tests/sync-controller/', import.meta.url)) };
  const common = { groups: config.groups, sourceURI: new URL('../../src/', import.meta.url).href };
  const reports: Record<string, object> = {};
  /** Run one step and preserve ordered native evidence. @param {string} name Step. @param {string} role Client. @param {string} action Suffix. @param {object} extra Inputs. @returns {Promise<object>} Actual report. */
  async function step<T extends object = NativeReport>(name: string, role: string, action: string, extra: NativeReport): Promise<T> {
    const report = await nativeJob<T>(options, role, { ...common, ...extra, action: `storage:${action}` });
    reports[name] = report;
    await writeFile(join(root, 'progress.json'), JSON.stringify({ reports }, null, 2));
    return report;
  }
  const base = prior.restored;
  await step('prepareB', 'b1', 'receive', base);
  const a = await step<StoreReport>('forkA', 'a1', 'fork', { ...base, branch: 'assertion' });
  const b = await step<StoreReport>('forkB', 'b1', 'fork', { ...base, branch: 'rule' });
  await step('publishA', 'a1', 'publish', a);
  const expectedHeads = [a.currentHead, b.currentHead].sort();
  await step('publishB', 'b1', 'publish', { expectedHeads });
  await step('conflictA2', 'a2', 'conflict', { expectedHeads });
  const resolvedSnapshot = JSON.parse(JSON.stringify(a.current)); resolvedSnapshot.rules = b.current.rules;
  const resolved = await step<StoreReport>('resolve', 'a1', 'resolve', { expectedHeads, resolvedSnapshot });
  await step('receivedResolution', 'a2', 'receive', resolved);
  await step('editor', 'a1', 'editor', {});
  await step('receivedEditor', 'a2', 'receive', resolved);
  await step('tamper', 'a1', 'tamper', {});
  await step('transactionGuard', 'a1', 'transaction-guard', {});
  await writeFile(join(root, 'result.json'), JSON.stringify({ ok: true, reports, resolved }, null, 2));
  console.log(JSON.stringify({ ok: true, root, head: resolved.currentHead }));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
