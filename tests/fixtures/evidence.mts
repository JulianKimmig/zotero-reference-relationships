/** Portable test evidence assertions narrow actual observed values without replacing production behavior. */
import type { RepositoryState } from '../../src/storage/contracts.mts';
import type { CompleteProjectionReport, ProjectionReport } from '../../src/domain/projection-contracts.mts';
import type { MappingExpression } from '../../src/domain/contracts.mts';

/** Require an observed member rather than assuming a lookup succeeded. @param value Actual lookup result. @returns Present result. */
export function present<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) throw new Error('Required test evidence is missing');
  return value;
}

/** Require a native object lookup, whose API uses false for absence. @param value Actual lookup. @returns Observed object. */
export function found<T>(value: T): Exclude<T, false | null | undefined> {
  if (value === false || value === null || value === undefined) throw new Error('Required native test object is unavailable');
  return value as Exclude<T, false | null | undefined>;
}

/** Require a complete actual repository generation before inspecting its saved payload. @param state Observed state. @returns Ready generation. */
export function readyState(state: RepositoryState): Extract<RepositoryState, { state: 'ready' }> {
  if (state.state !== 'ready') throw new Error(`Expected ready authority, observed ${state.state}`);
  return state;
}

/** Require complete cluster evidence, including a fully reported metadata conflict. @param report Actual projection. @returns Complete report. */
export function completeProjection(report: ProjectionReport): CompleteProjectionReport {
  if (report.state === 'endpoint-conflict') throw new Error('Expected complete projected cluster evidence');
  return report;
}

/** Require unresolved original evidence before inspecting withheld aggregates. @param report Actual endpoint inspection. @returns Original-only report. */
export function originalProjection(report: ProjectionReport): Extract<ProjectionReport, { state: 'endpoint-conflict' }> {
  if (report.state !== 'endpoint-conflict') throw new Error('Expected unresolved original endpoint evidence');
  return report;
}

/** Require a root mapping before inspecting its selected source field. @param expression Actual validated mapping. @returns Root expression. */
export function rootMapping(expression: MappingExpression): Extract<MappingExpression, { kind: 'root' }> {
  if (expression.kind !== 'root') throw new Error('Expected explicit-root mapping evidence');
  return expression;
}

/** Require a constant mapping before inspecting its literal value. @param expression Actual validated mapping. @returns Constant expression. */
export function constantMapping(expression: MappingExpression): Extract<MappingExpression, { kind: 'constant' }> {
  if (expression.kind !== 'constant') throw new Error('Expected constant mapping evidence');
  return expression;
}
