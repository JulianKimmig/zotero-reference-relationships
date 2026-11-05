/** Reversible endpoint projection retains original authority and independent rooted contributions. */
import { present } from './fixtures/evidence.mts';
import type { ItemRef } from '../src/domain/contracts.mts';
import { ContractError } from '../src/domain/values.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGraph, evaluateProjection } from '../src/domain/evaluate.mts';
import { validateGraph } from '../src/domain/graph-contract.mts';
import { initialGraph } from '../src/application/seed.mts';
import { assertion, inverseRule } from './fixtures/graph-contract.mts';
import { workGraph } from './fixtures/rules.mts';
import type { Graph } from '../src/domain/contracts.mts';

/** Observation fixtures deliberately include malformed combinations for runtime validator tests. */
interface ResolutionFixture { original: ItemRef; resolved: ItemRef | null; status: string }

const a: ItemRef = { library: 'self', key: 'AAAAAAAB' }, b: ItemRef = { library: 'self', key: 'BBBBBBBC' };
const c: ItemRef = { library: 'self', key: 'CCCCCCCD' }, d: ItemRef = { library: 'self', key: 'DDDDDDDE' };

/** Build real validated authority, keeping original source/target identities. @param {object[]} roots Assertions. @param {object[]} rules Declarations. @returns {object} Complete graph. */
function graph(roots = [assertion()], rules = [inverseRule({ mapping: { note: { kind: 'root', field: 'note' } } })]) {
  return { ...initialGraph('self'), assertions: roots, rules };
}

/** Enumerate explicit endpoint observations, applying only supplied native-state examples. @param {object} input Complete graph. @param {object[]} overrides Replacement rows. @returns {object[]} Resolution table. */
function resolutions(input: Graph, overrides: ResolutionFixture[] = []): ResolutionFixture[] {
  const refs = new Map<string, ItemRef>();
  for (const root of input.assertions) for (const ref of [root.source, root.target]) refs.set(JSON.stringify(ref), ref);
  return [...refs.values()].map(original => overrides.find(row => row.original.key === original.key)
    ?? { original, resolved: original, status: 'active' });
}

/** Make a specific observed resolution. @param {object} original Stored endpoint. @param {object|null} resolved Current native endpoint or none. @param {string} status Availability. @returns {object} Exact row. */
function row(original: ItemRef, resolved: ItemRef | null, status: string = 'active'): ResolutionFixture { return { original, resolved, status }; }

test('identity projection matches the complete physical closure without mutating input', () => {
  const input = graph([assertion({ metadata: { note: 'Original Café 你好' } })]);
  const before = structuredClone(input), observed = resolutions(input), copy = structuredClone(observed);
  assert.deepEqual(evaluateProjection(input, observed), { ...evaluateGraph(input), diagnostics: [] });
  assert.deepEqual(input, before); assert.deepEqual(observed, copy);
});

test('projecting either endpoint changes manual and generated views while retaining root identity', () => {
  const input = graph([assertion({ metadata: { note: 'Original metadata' } })]);
  for (const original of [a, b]) {
    const result = evaluateProjection(input, resolutions(input, [row(original, c)]));
    assert.equal(result.relationships.length, 2);
    const manual = result.relationships.find(edge => edge.type === 'referencing');
    assert.deepEqual(present(manual).source, original === a ? c : a);
    assert.deepEqual(present(manual).target, original === b ? c : b);
    assert.deepEqual(present(manual).assertions, ['assertion-a']);
    const generated = result.relationships.find(edge => edge.type === 'referenced-by');
    assert.deepEqual(present(generated).source, present(manual).target); assert.deepEqual(present(generated).target, present(manual).source);
    assert.equal(present(generated).supports[0].root, 'assertion-a');
    assert.deepEqual(present(generated).metadata, { note: 'Original metadata' });
  }
  assert.deepEqual(input.assertions[0].source, a); assert.deepEqual(input.assertions[0].target, b);
});

test('merge undo redo projects the same saved authority deterministically in both directions', () => {
  const input = graph([assertion(), assertion({ id: 'second', source: c, type: 'similar' })]);
  const original = structuredClone(input), merged = resolutions(input, [row(c, a)]);
  const first = evaluateProjection(input, merged);
  assert.deepEqual(evaluateProjection(input, resolutions(input)), { ...evaluateGraph(input), diagnostics: [] });
  assert.deepEqual(evaluateProjection(input, [...merged].reverse()), first);
  assert.deepEqual(input, original);
  assert.deepEqual(validateGraph(input), input);
});

test('colliding triples retain every original manual assertion and producing support', () => {
  const input = graph([assertion({ id: 'first', metadata: { note: 'Same' } }),
    assertion({ id: 'second', source: c, metadata: { note: 'Same' } })]);
  const result = evaluateProjection(input, resolutions(input, [row(c, a)]));
  assert.equal(result.relationships.length, 2);
  const manual = result.relationships.find(edge => edge.type === 'referencing');
  assert.deepEqual(present(manual).assertions, ['first', 'second']);
  const generated = result.relationships.find(edge => edge.type === 'referenced-by');
  assert.deepEqual(present(generated).supports.map(support => support.root), ['first', 'second']);
  assert.equal(result.transitions, 2);
  assert.equal(input.assertions.length, 2); assert.deepEqual(input.assertions[1].source, c);
});

test('projected collisions use equal-present union without changing independent root metadata', () => {
  const input = graph([assertion({ id: 'absent' }), assertion({ id: 'present', source: c, metadata: { note: '' } })]);
  const result = evaluateProjection(input, resolutions(input, [row(c, a)]));
  assert.deepEqual(present(result.relationships.find(edge => edge.type === 'referencing')).metadata, { note: '' });
  const supports = present(result.relationships.find(edge => edge.type === 'referenced-by')).supports;
  assert.deepEqual(supports.map(support => support.metadata), [{}, { note: '' }]);
  assert.deepEqual(input.assertions[0].metadata, {});
});

test('different projected values conflict with original root witnesses and leave authority unchanged', () => {
  const input = graph([assertion({ id: 'first', metadata: { note: 'First value' } }),
    assertion({ id: 'second', source: c, metadata: { note: 'Second value' } })]);
  const before = structuredClone(input);
  assert.throws(() => evaluateProjection(input, resolutions(input, [row(c, a)])), error => {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, 'conflict'); assert.equal(error.details.field, 'note');
    assert.deepEqual(error.details.contributors, [{ kind: 'assertion', id: 'first', value: 'First value' },
      { kind: 'assertion', id: 'second', value: 'Second value' }]);
    return true;
  });
  assert.deepEqual(input, before);
  assert.equal(evaluateProjection(input, resolutions(input)).relationships.length, 4);
});

test('merged self edges hide all rooted effects and retain exact recoverable ownership', () => {
  const input = graph([assertion({ id: 'collapsed', metadata: { note: 'Keep on Undo' } })]);
  const result = evaluateProjection(input, resolutions(input, [row(b, a)]));
  assert.deepEqual(result.relationships, []); assert.equal(result.transitions, 0);
  assert.deepEqual(result.diagnostics, [{ code: 'self-edge', message: 'Relationship collapsed by a native merge',
    details: { id: 'collapsed', source: a, target: b, resolved: a } }]);
  assert.deepEqual(present(evaluateProjection(input, resolutions(input)).relationships.find(edge => edge.type === 'referencing')).metadata, { note: 'Keep on Undo' });
});

test('trash suppresses rooted traversal until restoration and reports all affected roots', () => {
  const input = graph([assertion({ id: 'first' }), assertion({ id: 'second', source: c })]);
  const result = evaluateProjection(input, resolutions(input, [row(b, d, 'trashed')]));
  assert.deepEqual(result.relationships, []); assert.equal(result.transitions, 0);
  assert.deepEqual(result.diagnostics, [{ code: 'endpoint', message: 'Relationship endpoint is trashed',
    details: { ref: b, resolved: d, status: 'trashed', assertions: ['first', 'second'] } }]);
  assert.equal(evaluateProjection(input, resolutions(input)).relationships.length, 4);
});

test('permanent erase and unsupported kinds report unresolved roots without deleting unrelated edges', () => {
  const input = graph([assertion({ id: 'orphan', metadata: { note: 'Retain erased endpoint' } }),
    assertion({ id: 'unrelated', source: c, target: d })]);
  for (const [status, resolved] of [['missing', null], ['unsupported', b]] as const) {
    const result = evaluateProjection(input, resolutions(input, [row(b, resolved, status)]));
    assert.equal(result.relationships.length, 2);
    assert.deepEqual(present(result.relationships.find(edge => edge.type === 'referencing')).assertions, ['unrelated']);
    assert.deepEqual(result.diagnostics[0].details, { ref: b, resolved, status, assertions: ['orphan'] });
    assert.deepEqual(input.assertions[0].metadata, { note: 'Retain erased endpoint' });
  }
});

test('inactivity diagnostics are stable under root and resolution arrival order', () => {
  const input = graph([assertion({ id: 'z' }), assertion({ id: 'a', source: c, target: d })]);
  const observed = resolutions(input, [row(b, null, 'missing'), row(c, c, 'trashed')]);
  const result = evaluateProjection(input, observed);
  const reordered = structuredClone(input); reordered.assertions.reverse();
  assert.deepEqual(evaluateProjection(reordered, [...observed].reverse()), result);
  assert.deepEqual(result.diagnostics.map(value => value.details.ref), [b, c]);
});

test('ambiguous aliases are an explicit endpoint error with no successful partial graph', () => {
  const input = graph();
  assert.throws(() => evaluateProjection(input, resolutions(input, [row(b, null, 'ambiguous')])), error => {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, 'endpoint'); assert.deepEqual(error.details.ref, b); return true;
  });
});

test('resolution tables require complete unique exact observations and same-library endpoints', () => {
  const input = graph(), valid = resolutions(input), foreign: ItemRef = { library: 'group:123', key: c.key };
  const invalid = [null, {}, [], valid.slice(1), [...valid, valid[0]], [...valid, row(c, c)],
    [row(a, foreign), valid[1]], [row(foreign, a), valid[1]], [row(a, null), valid[1]],
    [row(a, a, 'missing'), valid[1]], [row(a, null, 'trashed'), valid[1]], [row(a, a, 'invented'), valid[1]],
    [{ ...valid[0], extra: true }, valid[1]]];
  for (const observed of invalid) assert.throws(() => evaluateProjection(input, observed), { code: 'validation' });
  assert.equal(evaluateProjection(input, valid).relationships.length, 2);
});

test('projection never relaxes physical graph validation for duplicates or stored self-links', () => {
  for (const input of [graph([assertion(), assertion({ id: 'duplicate' })]), graph([assertion({ target: a })])]) {
    assert.throws(() => evaluateProjection(input, resolutions(input)), { code: 'validation' });
  }
});

test('empty authority requires an empty observation table and returns a complete empty projection', () => {
  assert.deepEqual(evaluateProjection(graph([], []), []), { relationships: [], transitions: 0, diagnostics: [] });
  assert.throws(() => evaluateProjection(graph([], []), [row(a, a)]), { code: 'validation' });
});

test('returned projected edges, supports and diagnostics never alias observations or authority', () => {
  const input = graph([assertion(), assertion({ id: 'inactive', source: c, target: d })]);
  const observed = resolutions(input, [row(a, c), row(d, null, 'missing')]);
  const result = evaluateProjection(input, observed);
  result.relationships[0].source.key = 'EEEEEEEF';
  present(result.relationships.find(edge => edge.supports.length)).supports[0].target.key = 'EEEEEEEF';
  (result.diagnostics[0].details.ref as ItemRef).key = 'EEEEEEEF'; (result.diagnostics[0].details.assertions as string[]).push('caller');
  assert.deepEqual(input.assertions[0].source, a); assert.deepEqual(present(observed.find(value => value.original.key === a.key)).resolved, c);
  assert.equal(present(observed.find(value => value.status === 'missing')).original.key, d.key);
  assert.equal((evaluateProjection(input, observed).diagnostics[0].details.assertions as string[]).length, 1);
});

test('colliding projected roots still consume the global matching-rule budget independently', () => {
  const input = workGraph(64, 782), original = structuredClone(input);
  const observed = resolutions(input).map(value => row(value.original, value.original.key === a.key ? a : b));
  assert.throws(() => evaluateProjection(input, observed), error => {
    assert.ok(error instanceof ContractError);
    assert.equal(error.code, 'limit'); assert.deepEqual(error.details, { limit: 100000, attempts: 100001 }); return true;
  });
  assert.deepEqual(input, original);
});
