/** Measure the actual production contract validator inside the supported native runtime. */

/**
 * Validate known portable workload fixtures using their real domain module.
 * No persistence or sync capacity is inferred from these CPU validation timings.
 * @param {object} job Explicit file URI of domain directory and snapshots.
 * @param {object} api Actual native Services and ChromeUtils.
 * @returns {Promise<object>} Warm validation samples, encoded sizes and relative budgets.
 */
export async function contractBaseline(job, api) {
  if (!job.domainURI.startsWith('file:') || !Array.isArray(job.workloads)) throw new Error('Explicit native contract fixtures required');
  const handler = api.Services.io.getProtocolHandler('resource')
    .QueryInterface(api.Components.interfaces.nsIResProtocolHandler);
  handler.setSubstitution('rr-domain-contract', api.Services.io.newURI(job.domainURI));
  const { validateGraph } = api.ChromeUtils.importESModule('resource://rr-domain-contract/graph-contract.mjs');
  const results = [];
  for (const graph of job.workloads) {
    validateGraph(graph);
    const samplesMs = [];
    for (let sample = 0; sample < 7; sample++) {
      const start = Date.now();
      for (let repetition = 0; repetition < 3; repetition++) {
        const validated = validateGraph(graph);
        if (validated.assertions.length !== graph.assertions.length) throw new Error('Validation dropped assertions');
      }
      samplesMs.push((Date.now() - start) / 3);
    }
    const p95Ms = [...samplesMs].sort((a, b) => a - b)[6];
    results.push({ assertions: graph.assertions.length,
      bytes: new api.TextEncoder().encode(JSON.stringify(validateGraph(graph))).length,
      samplesMs, p95Ms, regressionBudgetMs: Math.max(1, p95Ms * 4) });
  }
  return { validator: 'src/domain/graph-contract.mjs', clock: 'Date.now milliseconds, three repetitions per sample',
    workload: 'portable graph validation only; no rule closure or persistence', results };
}
