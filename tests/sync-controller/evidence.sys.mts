/** Portable evidence assertions stay inside the independently provisioned native controller. */
import type { RepositoryState } from '../../src/storage/contracts.mts';
import type { CompleteProjectionReport, ProjectionReport } from '../../src/domain/projection-contracts.mts';
import type { ContractError } from '../../src/domain/values.mts';
import type { MappingExpression } from '../../src/domain/contracts.mts';

/** Require a real observed value before inspecting it. @param value Actual result. @returns Present value. */
export function present<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) throw new Error('Required native test evidence is missing');
  return value;
}
/** Require a native object lookup, whose API uses false for absence. @param value Actual lookup. @returns Observed object. */
export function found<T extends object | false | null | undefined>(value: T): Exclude<T, false | null | undefined> {
  if (value === false || value === null || value === undefined) throw new Error('Required native test object is unavailable');
  return value as Exclude<T, false | null | undefined>;
}
/** Require actual complete stored authority. @param state Observed generation. @returns Ready state. */
export function readyState(state: RepositoryState): Extract<RepositoryState, { state: 'ready' }> {
  if (state.state !== 'ready') throw new Error(`Expected ready authority, observed ${state.state}`);
  return state;
}
/** Require complete cluster evidence including metadata conflicts. @param report Actual inspection. @returns Complete report. */
export function completeProjection(report: ProjectionReport): CompleteProjectionReport {
  if (report.state === 'endpoint-conflict') throw new Error('Expected complete projected cluster evidence');
  return report;
}
/** Read diagnostics across native compartments without assuming a shared Error prototype. @param error Actual failure. @returns Literal message. */
export function errorMessage(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error);
}
/** Require a real production contract failure rather than accepting an unrelated native exception. @param error Caught failure. @returns Structured domain error. */
export function contractFailure(error: unknown): ContractError {
  if (error === null || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string'
    || !('details' in error) || error.details === null || typeof error.details !== 'object') {
    throw new Error(`Expected production contract failure: ${errorMessage(error)}`);
  }
  return error as ContractError;
}

/** Require an actual root expression before inspecting its source field. @param expression Validated mapping. @returns Root mapping. */
export function rootMapping(expression: MappingExpression): Extract<MappingExpression, { kind: 'root' }> {
  if (expression.kind !== 'root') throw new Error('Expected explicit-root mapping evidence');
  return expression;
}

/** Require an actual constant expression before inspecting its value. @param expression Validated mapping. @returns Constant mapping. */
export function constantMapping(expression: MappingExpression): Extract<MappingExpression, { kind: 'constant' }> {
  if (expression.kind !== 'constant') throw new Error('Expected constant mapping evidence');
  return expression;
}

/** Require literal string evidence instead of coercing an unexpected metadata primitive. @param value Actual observation. @returns Verified string. */
export function textValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected literal text evidence');
  return value;
}
/** Require an actual item reference inside a structured diagnostic. @param value Actual diagnostic detail. @returns Scoped identity. */
export function itemReference(value: unknown): import('../../src/domain/contracts.mts').ItemRef {
  if (value === null || typeof value !== 'object' || !('library' in value) || typeof value.library !== 'string'
    || !('key' in value) || typeof value.key !== 'string') throw new Error('Expected scoped item diagnostic');
  return value as import('../../src/domain/contracts.mts').ItemRef;
}
