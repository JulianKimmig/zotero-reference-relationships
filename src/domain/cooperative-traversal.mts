/** Explicit host cooperation for the shared rooted stepper, with cancellation and no scheduler defaults. */
import { check } from './values.mts';

/** Caller-owned scheduling and liveness controls required for each asynchronous evaluation. */
export interface EvaluationCooperation {
  /** Yield an actual host opportunity when responsiveness is required; microtasks alone do not guarantee one. */
  yieldToHost: () => Promise<void>;
  /** Throw the caller's cancellation/lifetime error when work must stop; no partial result is published. */
  assertActive: () => void;
  /** Maximum traversal steps per host yield; a safe integer from 1 through 1000 inclusive. */
  batchSize: number;
}

/** Reject missing controls or invalid bounds before any domain work. @param cooperation Required explicit controls, including for untyped callers. @returns Nothing; throws a validation error on malformed controls. */
export function validateCooperation(cooperation: EvaluationCooperation): void {
  check(cooperation !== null && typeof cooperation === 'object', 'Explicit evaluation cooperation is required');
  check(typeof cooperation.yieldToHost === 'function', 'An explicit host scheduler is required');
  check(typeof cooperation.assertActive === 'function', 'An explicit activity check is required');
  check(Number.isSafeInteger(cooperation.batchSize) && cooperation.batchSize >= 1 && cooperation.batchSize <= 1000,
    'Evaluation batch size must be a safe integer from 1 through 1000');
}

/**
 * Drain the real traversal in bounded batches, checking activity before every step and around host yields.
 * Scheduler rejection and cancellation propagate unchanged; collectors remain private until full completion.
 * @param steps Shared rooted traversal with one bounded work unit per yielded boundary.
 * @param cooperation Validated required host scheduler, activity callback and batch size.
 * @returns Completed stepper result; no intermediate result is returned.
 */
export async function finishTraversalAsync<T>(steps: Generator<void, T, void>, cooperation: EvaluationCooperation): Promise<T> {
  let count = 0;
  while (true) {
    cooperation.assertActive();
    const step = steps.next();
    if (step.done) return step.value;
    if (++count === cooperation.batchSize) {
      cooperation.assertActive();
      await cooperation.yieldToHost();
      cooperation.assertActive();
      count = 0;
    }
  }
}
