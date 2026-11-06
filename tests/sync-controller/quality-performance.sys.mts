/** Exact packaged validation and rooted evaluation measurements retain actual work counts and UI-thread delay samples. */
import type { NativeAPI } from './native-api.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { Graph } from '../../src/domain/contracts.mts';
import type { QualityShape } from '../fixtures/quality-workloads.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { measureNative } from './quality-measure.sys.mts';
import { check } from './ui-helpers.sys.mts';
import { present } from './evidence.sys.mts';

/** Public controlled workload DTOs contain synthetic authority, never native handles or credentials. */
export interface QualityWorkload { shape: QualityShape; graph: Graph }
/** Measurement jobs carry original validation fixtures separately from closure shapes. */
export type QualityJob = ControllerJob & { qualityWorkloads: QualityWorkload[] };

/** Measure current validators against the exact original workload/thresholds and separately inspect closure stalls. @param {object} job Actual artifact plus synthetic bounded graphs. @param {object} api Actual unsigned-in native host. @returns {Promise<object>} Verified work/output sizes and raw timing distributions; threshold failure is explicit. */
export async function qualityPerformance(job: QualityJob, api: NativeAPI) {
  check(!api.Zotero.Users.getCurrentUserID(), 'Quality measurements require an unsigned-in isolated profile');
  await resources(job, api);
  const { validateGraph } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/domain/graph-contract.mjs');
  const { evaluateGraph } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/domain/evaluate.mjs');
  const thresholds = new Map([[10, 24], [100, 48], [1000, 604]]), validation = [], closure = [];
  for (const graph of present(job.workloads)) {
    const count = graph.assertions.length, threshold = present(thresholds.get(count)); validateGraph(graph);
    const samples = await measureNative(api, () => {
      for (let repetition = 0; repetition < 3; repetition++) check(validateGraph(graph).assertions.length === count, 'Validator dropped originals');
    });
    const samplesMs = samples.samples.map(sample => sample.durationMs / 3).sort((a, b) => a - b), p95Ms = samplesMs[6];
    validation.push({ assertions: count, bytes: new api.TextEncoder().encode(JSON.stringify(validateGraph(graph))).length,
      samplesMs, p95Ms, thresholdMs: threshold, passes: p95Ms <= threshold, maximumHeartbeatGapMs: samples.maximumHeartbeatGapMs });
  }
  for (const { shape, graph } of job.qualityWorkloads) {
    const count = graph.assertions.length, expectedTransitions = shape === 'sparse' ? 0 : shape === 'cycle' ? count * 2 : count * 100;
    let rejected = false;
    const samples = await measureNative(api, () => {
      if (shape === 'over-limit') {
        try { evaluateGraph(graph); } catch (error) {
          check(error !== null && typeof error === 'object' && 'code' in error && error.code === 'limit'
            && 'details' in error && error.details !== null && typeof error.details === 'object'
            && 'attempts' in error.details && error.details.attempts === 100001, 'Work bound failed at another boundary');
          rejected = true; return;
        }
        throw new Error('Over-limit quality graph published partial results');
      }
      const result = evaluateGraph(graph);
      check(result.transitions === expectedTransitions && result.relationships.length === count * (shape === 'sparse' ? 1 : 2), 'Measured closure has unexpected behavior');
    }, shape === 'over-limit' ? 1 : 7);
    closure.push({ shape, assertions: count, rules: graph.rules.length, transitions: shape === 'over-limit' ? 100001 : expectedTransitions,
      explicitLimitRejection: rejected, ...samples });
  }
  const report = { clock: 'Date.now milliseconds', timer: 'native window interval 10ms; 25ms drain before/after',
    validation, closure, validationBudgetsPass: validation.every(value => value.passes), noAuthorityWrites: true };
  await present(api.IOUtils).writeUTF8(`${present(job.data)}/quality-performance.json`, JSON.stringify(report), { mode: 'create', flush: true });
  check(report.validationBudgetsPass, 'Current native validation exceeds the frozen TASK-004 engineering thresholds; see saved quality-performance.json');
  return report;
}
