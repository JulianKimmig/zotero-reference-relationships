/** Bounded deterministic rooted closure; computed relationships are never persisted authority. */
import { validateGraph } from './graph-contract.mts';
import { Contributions } from './contributions.mts';
import { projectRoots } from './project-roots.mts';
import { ProjectionContributions } from './projection-contributions.mts';
import { traverseRoots, finishTraversal } from './rooted-traversal.mts';
import { validateCooperation, finishTraversalAsync } from './cooperative-traversal.mts';
import type { EvaluationCooperation } from './cooperative-traversal.mts';
import type { CompleteProjectionReport, Diagnostic, Relationship } from './projection-contracts.mts';

export type { EvaluationCooperation } from './cooperative-traversal.mts';

/** Validate complete physical authority and recompute its unchanged v1 closure contract. @param {object} input Strict complete schema-1 graph. @returns {object} Detached {relationships,transitions}; no partial result on failure. */
export function evaluateGraph(input: unknown): { relationships: Relationship[]; transitions: number } {
  const graph = validateGraph(input), contributions = new Contributions();
  const transitions = finishTraversal(traverseRoots(graph.assertions, graph.rules, contributions));
  return { relationships: contributions.relationships(), transitions };
}

/** Recompute active native endpoint projections while preserving original assertion and support ownership. @param {object} snapshot Strict original authority. @param {object[]} resolutions Exact complete endpoint observations. @returns {object} Detached {relationships,transitions,diagnostics}; projected roots never pass through stored-snapshot validation. */
export function evaluateProjection(snapshot: unknown, resolutions: unknown): { relationships: Relationship[]; transitions: number; diagnostics: Diagnostic[] } {
  const { graph, roots, diagnostics } = projectRoots(snapshot, resolutions), contributions = new Contributions();
  const transitions = finishTraversal(traverseRoots(roots, graph.rules, contributions));
  return { relationships: contributions.relationships(), transitions, diagnostics };
}

/** Inspect every projected contributor without inventing metadata for conflicting aggregates. @param {object} snapshot Strict original authority. @param {object[]} resolutions Complete native endpoint observations. @returns {object} {state,relationships,clusters,transitions,diagnostics}; relationships is null for a complete conflicted report. */
export function inspectProjection(snapshot: unknown, resolutions: unknown): CompleteProjectionReport {
  const { graph, roots, diagnostics } = projectRoots(snapshot, resolutions), contributions = new ProjectionContributions();
  const transitions = finishTraversal(traverseRoots(roots, graph.rules, contributions));
  return contributions.inspect(transitions, diagnostics);
}

/**
 * Evaluate strict physical authority using the same traversal as evaluateGraph with explicit host cooperation.
 * Validation and final relationship assembly remain synchronous; batchSize bounds traversal work units,
 * not elapsed milliseconds or final support sorting/copying. Checks bracket those synchronous phases.
 * @param input Strict complete schema-1 graph, validated and detached before the first suspension.
 * @param cooperation Required host scheduler, throwing activity check and safe integer batch size 1..1000.
 * @returns Complete detached strict closure, or rejection without any partial result.
 */
export async function evaluateGraphAsync(input: unknown, cooperation: EvaluationCooperation): Promise<{ relationships: Relationship[]; transitions: number }> {
  validateCooperation(cooperation); cooperation.assertActive();
  const graph = validateGraph(input), contributions = new Contributions();
  cooperation.assertActive();
  const transitions = await finishTraversalAsync(traverseRoots(graph.assertions, graph.rules, contributions), cooperation);
  cooperation.assertActive();
  const result = { relationships: contributions.relationships(), transitions };
  cooperation.assertActive();
  return result;
}

/**
 * Inspect every projected contributor through the shared resumable rooted traversal.
 * Original authority validation, endpoint projection and final report assembly remain synchronous,
 * including potentially large contributor sorting/copying; cooperation cannot bound those phases in time.
 * Activity checks bracket them and every traversal step; cancellation never returns a partial report.
 * @param snapshot Strict original authority, validated and detached before the first suspension.
 * @param resolutions Exact complete native endpoint observations, detached before suspension.
 * @param cooperation Required host scheduler, throwing activity check and safe integer batch size 1..1000.
 * @returns Complete ready/conflict report identical to inspectProjection, or rejection on failure/cancellation.
 */
export async function inspectProjectionAsync(snapshot: unknown, resolutions: unknown, cooperation: EvaluationCooperation): Promise<CompleteProjectionReport> {
  validateCooperation(cooperation); cooperation.assertActive();
  const { graph, roots, diagnostics } = projectRoots(snapshot, resolutions), contributions = new ProjectionContributions();
  cooperation.assertActive();
  const transitions = await finishTraversalAsync(traverseRoots(roots, graph.rules, contributions), cooperation);
  cooperation.assertActive();
  const result = contributions.inspect(transitions, diagnostics);
  cooperation.assertActive();
  return result;
}
