/** Complete conflict inspection must preserve every contributor and never publish a partial graph. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProjection, evaluateProjection } from '../src/domain/evaluate.mjs';
import { initialGraph } from '../src/application/seed.mjs';
import { assertion, inverseRule } from './fixtures/graph-contract.mjs';
import { workGraph } from './fixtures/rules.mjs';

const a = { library: 'self', key: 'AAAAAAAB' }, b = { library: 'self', key: 'BBBBBBBC' };
const c = { library: 'self', key: 'CCCCCCCD' }, d = { library: 'self', key: 'DDDDDDDE' };

/** Build original authority with independently owned metadata. @param {string[]} notes Root values. @returns {object} Complete valid graph. */
function graph(notes = ['first', 'second', 'second']) {
  return { ...initialGraph('self'), assertions: notes.map((note, index) => assertion({ id: `root-${index}`,
    source: index === 0 ? a : index === 1 ? c : d, metadata: { note } })),
  rules: [inverseRule({ mapping: { note: { kind: 'root', field: 'note' } } })] };
}

/** Observe an actual-shaped merge where all original sources resolve to A. @param {object} snapshot Authority. @returns {object[]} Complete endpoint table. */
function merged(snapshot) {
  const refs = new Map();
  for (const root of snapshot.assertions) for (const ref of [root.source, root.target]) refs.set(ref.key, ref);
  return [...refs.values()].map(original => ({ original, resolved: original.key === b.key ? b : a, status: 'active' }));
}

test('ready inspection matches strict closure and retains complete manual and generated clusters', () => {
  const input = graph(['same', 'same', 'same']), rows = merged(input), result = inspectProjection(input, rows);
  assert.equal(result.state, 'ready'); assert.deepEqual(result.relationships, evaluateProjection(input, rows).relationships);
  assert.equal(result.clusters.length, 2); assert.equal(result.transitions, 3); assert.deepEqual(result.diagnostics, []);
  const manual = result.clusters.find(cluster => cluster.type === 'referencing');
  assert.deepEqual(manual.assertions, input.assertions.map(root => ({ id: root.id, metadata: root.metadata })));
  assert.deepEqual(manual.conflicts, []);
  assert.deepEqual(result.clusters.find(cluster => cluster.type === 'referenced-by').supports.map(value => value.root), ['root-0', 'root-1', 'root-2']);
});

test('conflict inspection finishes all roots and reports every witness including equal-valued contributors', () => {
  const input = graph(), result = inspectProjection(input, merged(input));
  assert.equal(result.state, 'conflict'); assert.equal(result.relationships, null); assert.equal(result.transitions, 3);
  const manual = result.clusters.find(cluster => cluster.type === 'referencing');
  assert.deepEqual(manual.conflicts, [{ field: 'note', contributors: [
    { kind: 'assertion', id: 'root-0', value: 'first' }, { kind: 'assertion', id: 'root-1', value: 'second' },
    { kind: 'assertion', id: 'root-2', value: 'second' },
  ] }]);
  const generated = result.clusters.find(cluster => cluster.type === 'referenced-by');
  assert.equal(generated.supports.length, 3);
  assert.deepEqual(generated.conflicts[0].contributors.map(value => [value.kind, value.root, value.value]),
    [['support', 'root-0', 'first'], ['support', 'root-1', 'second'], ['support', 'root-2', 'second']]);
  assert.throws(() => evaluateProjection(input, merged(input)), { code: 'conflict' });
});

test('unrelated valid clusters remain available for repair inspection without masquerading as a partial graph', () => {
  const input = graph(); input.assertions.push(assertion({ id: 'unrelated', source: b, target: c, type: 'similar', metadata: { note: 'independent' } }));
  const result = inspectProjection(input, merged(input));
  assert.equal(result.state, 'conflict'); assert.equal(result.relationships, null);
  assert.equal(result.clusters.length, 3);
  assert.deepEqual(result.clusters.find(cluster => cluster.type === 'similar').assertions, [{ id: 'unrelated', metadata: { note: 'independent' } }]);
});

test('explicit repair preserves independent IDs and produces a complete valid after closure', () => {
  const before = graph(), after = structuredClone(before); after.assertions[0].metadata.note = 'second';
  assert.equal(inspectProjection(before, merged(before)).state, 'conflict');
  const report = inspectProjection(after, merged(after)); assert.equal(report.state, 'ready');
  assert.deepEqual(report.relationships.find(edge => edge.type === 'referencing').assertions, ['root-0', 'root-1', 'root-2']);
  assert.deepEqual(before.assertions.map(root => root.metadata.note), ['first', 'second', 'second']);
});

test('reports are stable across arrival order and detached from roots, mappings and observations', () => {
  const input = graph(), rows = merged(input), first = inspectProjection(input, rows);
  const reversed = structuredClone(input); reversed.assertions.reverse(); reversed.rules.reverse();
  assert.deepEqual(inspectProjection(reversed, [...rows].reverse()), first);
  first.clusters[0].source.key = 'EEEEEEEF'; first.clusters[0].assertions[0].metadata.note = 'caller';
  first.clusters[1].supports[0].metadata.note = 'caller'; first.clusters[1].conflicts[0].contributors[0].value = 'caller';
  assert.equal(input.assertions[0].metadata.note, 'first'); assert.equal(rows[0].resolved.key, a.key);
  assert.equal(inspectProjection(input, rows).clusters[0].conflicts[0].contributors[0].value, 'first');
});

test('absence and empty text stay distinct, while inactive and self roots keep their diagnostics', () => {
  const input = graph(['', '', '']); input.assertions[0].metadata = {};
  let rows = merged(input), report = inspectProjection(input, rows);
  assert.deepEqual(report.relationships.find(edge => edge.type === 'referencing').metadata, { note: '' });
  assert.deepEqual(report.clusters[0].assertions[0].metadata, {});
  rows = rows.map(row => row.original.key === b.key ? { ...row, resolved: null, status: 'missing' } : row);
  report = inspectProjection(input, rows); assert.equal(report.state, 'ready'); assert.deepEqual(report.relationships, []);
  assert.equal(report.diagnostics[0].details.status, 'missing');
  rows = merged(input).map(row => ({ ...row, resolved: a }));
  report = inspectProjection(input, rows); assert.deepEqual(report.clusters, []); assert.equal(report.diagnostics.length, 3);
});

test('malformed and ambiguous observations remain failures rather than a successful inspection', () => {
  const input = graph();
  assert.throws(() => inspectProjection(input, []), { code: 'validation' });
  const rows = merged(input).map(row => row.original.key === b.key ? { ...row, status: 'ambiguous', resolved: null } : row);
  assert.throws(() => inspectProjection(input, rows), { code: 'endpoint' });
});

test('conflict collection still enforces the complete global rule work bound', () => {
  const input = workGraph(64, 782), rows = merged(input).map(row => ({ ...row, resolved: row.original.key === a.key ? a : b }));
  assert.throws(() => inspectProjection(input, rows), { code: 'limit' });
});
