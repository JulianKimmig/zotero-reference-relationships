/** Unknown native aliases retain complete original evidence without inventing aggregate relationships. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectEndpoints } from '../src/domain/inspect-endpoints.mjs';
import { inspectProjection } from '../src/domain/evaluate.mjs';
import { inspectionPage, indexProjection, projectedPage } from '../src/application/projection-views.mjs';
import { initialGraph } from '../src/application/seed.mjs';
import { assertion, inverseRule } from './fixtures/graph-contract.mjs';

const a = { library: 'self', key: 'AAAAAAAB' }, b = { library: 'self', key: 'BBBBBBBC' }, c = { library: 'self', key: 'CCCCCCCD' };

/** Build strict original authority including literal Unicode metadata. @returns {object} Valid graph. */
function graph() {
  return { ...initialGraph('self'), assertions: [assertion({ metadata: { note: 'Original Café 你好 <b>literal</b>' } })],
    rules: [inverseRule({ mapping: { note: { kind: 'root', field: 'note' } } })] };
}

/** Describe each original endpoint exactly once. @param {string} status Source state. @returns {object[]} Complete observation table. */
function rows(status = 'active') {
  return [{ original: a, resolved: status === 'active' ? a : null, status }, { original: b, resolved: b, status: 'active' }];
}

test('ready and metadata-conflict inspection preserve the established complete projection contract', () => {
  const input = graph(); assert.deepEqual(inspectEndpoints(input, rows()), inspectProjection(input, rows()));
  input.assertions.push(assertion({ id: 'other', source: c, metadata: { note: 'Different' } }));
  const observations = [...rows(), { original: c, resolved: a, status: 'active' }];
  assert.deepEqual(inspectEndpoints(input, observations), inspectProjection(input, observations));
  assert.equal(inspectEndpoints(input, observations).state, 'conflict');
});

for (const status of ['ambiguous', 'cyclic', 'alias-limit']) test(`${status} keeps all original values and withholds every aggregate`, () => {
  const input = graph(), report = inspectEndpoints(input, rows(status));
  assert.equal(report.state, 'endpoint-conflict'); assert.equal(report.relationships, null);
  assert.equal(report.clusters, null); assert.equal(report.transitions, null);
  assert.deepEqual(report.originals, input.assertions);
  assert.deepEqual(report.diagnostics, [{ code: 'endpoint-conflict', message: `Native endpoint is ${status}; choose an explicit repair`,
    details: { ref: a, resolved: null, status, assertions: ['assertion-a'] } }]);
});

test('known missing endpoints retain the existing inactive-root semantics', () => {
  const input = graph(), observations = rows('missing');
  assert.deepEqual(inspectEndpoints(input, observations), inspectProjection(input, observations));
  assert.equal(inspectEndpoints(input, observations).state, 'ready');
  assert.deepEqual(inspectEndpoints(input, observations).relationships, []);
});

test('unknown endpoints do not hide other originals or pretend their derived effects are known', () => {
  const input = graph(); input.assertions.push(assertion({ id: 'independent', source: b, target: c, type: 'similar', metadata: { note: 'Independent' } }));
  const report = inspectEndpoints(input, [...rows('ambiguous'), { original: c, resolved: c, status: 'active' }]);
  assert.deepEqual(report.originals.map(root => root.id), ['assertion-a', 'independent']);
  assert.equal(report.relationships, null); assert.equal(report.clusters, null);
  report.originals[0].metadata.note = 'caller'; report.originals[1].source.key = a.key;
  report.diagnostics[0].details.ref.key = c.key;
  assert.equal(input.assertions[0].metadata.note, 'Original Café 你好 <b>literal</b>');
  assert.equal(input.assertions[1].source.key, b.key); assert.equal(a.key, 'AAAAAAAB');
});

test('inspection remains strict about exact, complete, same-library observations even when unresolved', () => {
  for (const observations of [[], rows('unknown'), rows('cyclic').slice(0, 1), [...rows('ambiguous'), rows('active')[0]],
    [...rows('cyclic'), { original: c, resolved: c, status: 'active' }],
    rows('cyclic').map(row => ({ ...row, unexpected: true })),
    rows('cyclic').map(row => row.original.key === a.key ? { ...row, resolved: a } : row),
    rows().map(row => row.original.key === a.key ? { ...row, resolved: { ...a, library: 'group:123' } } : row)]) {
    assert.throws(() => inspectEndpoints(graph(), observations), { code: 'validation' });
  }
});

test('bounded unresolved inspection pages originals explicitly and never constructs a queryable partial index', () => {
  const input = graph(); input.assertions.push(assertion({ id: 'second', source: b, target: c, type: 'similar' }));
  const report = inspectEndpoints(input, [...rows('cyclic'), { original: c, resolved: c, status: 'active' }]);
  const projection = indexProjection(input, { report }); assert.equal(projection.index, null);
  const first = inspectionPage(projection, { offset: 0, limit: 1 }, 'AAAAAAAA');
  assert.equal(first.state, 'endpoint-conflict'); assert.equal(first.clusters, null);
  assert.equal(first.total, 2); assert.equal(first.nextOffset, 1); assert.deepEqual(first.originals, [input.assertions[0]]);
  first.originals[0].metadata.note = 'caller';
  assert.equal(inspectionPage(projection, { offset: 0, limit: 1 }, 'AAAAAAAA').originals[0].metadata.note, input.assertions[0].metadata.note);
  assert.equal(inspectionPage(projection, { offset: 1, limit: 1 }, 'AAAAAAAA').nextOffset, null);
  assert.throws(() => inspectionPage(projection, { offset: 0, limit: 101 }, 'AAAAAAAA'), { code: 'validation' });
  assert.throws(() => projectedPage(projection, b, 'both', null, { offset: 0, limit: 1 }, 'AAAAAAAA'), { code: 'endpoint' });
});

test('empty authorities still require an exact empty endpoint table', () => {
  assert.deepEqual(inspectEndpoints(initialGraph('self'), []), inspectProjection(initialGraph('self'), []));
  assert.throws(() => inspectEndpoints(initialGraph('self'), rows('ambiguous')), { code: 'validation' });
});
