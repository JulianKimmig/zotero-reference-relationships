/** Exact sparse, cyclic and maximum-work graphs for native quality measurements and deterministic behavioral checks. */
import { graphFixture, assertion, inverseRule } from './graph-contract.mts';
import type { Graph, Rule } from '../../src/domain/contracts.mts';

/** Measurement shapes identify actual rule work, independently of timing thresholds. */
export type QualityShape = 'sparse' | 'cycle' | 'dense' | 'over-limit';

/** Build a valid bounded star with unique originals; dense performs 100 transitions per root, over-limit 102. @param {string} shape Explicit measured rule shape. @param {number} count Integer original count 1..1000. @returns {Graph} Detached authority with no generated supports. */
export function qualityGraph(shape: QualityShape, count: number): Graph {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('Quality fixture requires 1..1000 originals');
  if (!['sparse', 'cycle', 'dense', 'over-limit'].includes(shape)) throw new Error('Unknown quality workload');
  const rules: Rule[] = shape === 'sparse' ? [] : shape === 'cycle'
    ? [inverseRule(), inverseRule({ id: 'back', inputType: 'referenced-by', outputType: 'referencing' })]
    : Array.from({ length: shape === 'dense' ? 50 : 51 }, (_, index) => inverseRule({
      id: `dense-${String(index).padStart(2, '0')}`, outputType: 'referencing',
    }));
  return graphFixture({ rules, assertions: Array.from({ length: count }, (_, index) => assertion({
    id: `quality-${String(index).padStart(4, '0')}`, source: { library: 'self', key: `A${String(index).padStart(7, '0')}` },
    target: { library: 'self', key: 'ZZZZZZZZ' },
  })) });
}
