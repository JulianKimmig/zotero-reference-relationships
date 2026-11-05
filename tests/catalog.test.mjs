/** Behavioral catalog proposals, explicit metadata migrations and immutable schema transitions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeTypeChange, validateTypeTransition } from '../src/application/catalog.mjs';
import { initialGraph } from '../src/application/seed.mjs';
import { assertion } from './fixtures/graph-contract.mjs';

const clock = '2026-11-05T15:00:00.000Z';

/** Define a stable editable type without a caller-controlled version. @param {object} overrides Changed definition fields. @returns {object} Exact command type. */
function type(overrides = {}) {
  return { id: 'custom', label: 'Custom', description: 'A user-defined relationship', retired: false,
    fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }], ...overrides };
}

/** Make a valid current catalog and one referenced metadata value. @returns {object} Detached graph. */
function current() {
  const graph = initialGraph('self');
  graph.types.push({ ...type(), version: 1 });
  graph.assertions.push(assertion({ type: 'custom', metadata: { note: 'Preserve me' } }));
  return graph;
}

/** Build an explicit update proposal. @param {object} definition Editable type. @param {Array|null} migration Explicit replacement metadata or null. @returns {object} Command. */
function update(definition, migration = null) { return { kind: 'update', type: definition, migration }; }

test('create is detached, starts version one and preserves catalog and references', () => {
  const before = initialGraph('self'), change = { kind: 'create', type: type(), migration: null };
  const after = proposeTypeChange(before, change, clock);
  assert.equal(after.types.at(-1).version, 1);
  assert.deepEqual(after.types.at(-1), { ...type(), version: 1 });
  assert.deepEqual(after.types.slice(0, -1), before.types);
  after.types.at(-1).fields[0].label = 'Changed clone';
  assert.equal(change.type.fields[0].label, 'Note');
  assert.equal(before.types.length, 3);
});

test('duplicate labels remain distinct identities and duplicate create IDs fail', () => {
  const before = current();
  const after = proposeTypeChange(before, { kind: 'create', type: type({ id: 'another' }), migration: null }, clock);
  assert.equal(after.types.filter(value => value.label === 'Custom').length, 2);
  assert.throws(() => proposeTypeChange(before, { kind: 'create', type: type(), migration: null }, clock), { code: 'validation' });
});

test('rename type and field labels preserves IDs and every existing value and timestamp', () => {
  const before = current(), definition = type({ label: 'Renamed type' });
  definition.fields[0].label = 'Renamed note';
  const after = proposeTypeChange(before, update(definition), clock);
  assert.equal(after.types.at(-1).id, 'custom'); assert.equal(after.types.at(-1).version, 2);
  assert.equal(after.types.at(-1).fields[0].id, 'note');
  assert.deepEqual(after.assertions, before.assertions);
  assert.deepEqual(before.types.at(-1), { ...type(), version: 1 });
});

test('a no-op keeps version and retirement preserves referenced assertions', () => {
  const before = current();
  assert.deepEqual(proposeTypeChange(before, update(type()), clock), before);
  const after = proposeTypeChange(before, update(type({ retired: true })), clock);
  assert.equal(after.types.at(-1).retired, true); assert.equal(after.types.at(-1).version, 2);
  assert.deepEqual(after.assertions, before.assertions);
});

test('new optional fields and enum option expansion do not require migrations', () => {
  const before = current(), definition = type();
  definition.fields.push({ id: 'choice', label: 'Choice', kind: 'enum', required: false, options: ['first'] });
  const added = proposeTypeChange(before, update(definition), clock);
  definition.fields[1].options.push('second');
  const expanded = proposeTypeChange(added, update(definition), clock);
  assert.equal(expanded.types.at(-1).version, 3);
  assert.deepEqual(expanded.assertions, before.assertions);
});

test('field removal never silently discards old values without explicit migration', () => {
  const before = current(), original = structuredClone(before);
  assert.throws(() => proposeTypeChange(before, update(type({ fields: [] })), clock), { code: 'validation' });
  assert.throws(() => proposeTypeChange(before, update(type({ fields: [] }), []), clock), { code: 'validation' });
  assert.deepEqual(before, original);
});

test('explicit reviewed removal changes only replaced metadata and its update timestamp', () => {
  const before = current(), old = before.assertions[0];
  const after = proposeTypeChange(before, update(type({ fields: [] }), [{ id: old.id, metadata: {} }]), clock);
  assert.deepEqual(after.assertions[0], { ...old, metadata: {}, updatedAt: clock });
  assert.deepEqual(before.assertions[0].metadata, { note: 'Preserve me' });
  assert.equal(after.types.at(-1).version, 2);
});

test('kind changes and newly required fields require explicit valid replacements', () => {
  const before = current(), definition = type({ fields: [{ id: 'note', label: 'Count', kind: 'number', required: true, options: [] }] });
  assert.throws(() => proposeTypeChange(before, update(definition), clock), { code: 'validation' });
  const after = proposeTypeChange(before, update(definition, [{ id: before.assertions[0].id, metadata: { note: 0 } }]), clock);
  assert.equal(after.assertions[0].metadata.note, 0);
  const optional = proposeTypeChange(initialGraph('self'), { kind: 'create', type: type(), migration: null }, clock);
  const required = type(); required.fields[0].required = true;
  assert.throws(() => proposeTypeChange(optional, update(required), clock), { code: 'validation' });
  assert.equal(proposeTypeChange(optional, update(required, []), clock).types.at(-1).version, 2);
});

test('enum narrowing requires migration even when the retained option is valid', () => {
  const before = current(); before.types.at(-1).fields[0] = { id: 'note', label: 'Choice', kind: 'enum', required: false, options: ['Preserve me', 'other'] };
  const definition = type({ fields: [{ ...before.types.at(-1).fields[0], options: ['Preserve me'] }] });
  assert.throws(() => proposeTypeChange(before, update(definition), clock), { code: 'validation' });
  const after = proposeTypeChange(before, update(definition, []), clock);
  assert.deepEqual(after.assertions, before.assertions);
});

test('explicit no-change replacement preserves assertion timestamps and absent optional values', () => {
  const before = current(), definition = type({ label: 'Reviewed' });
  const after = proposeTypeChange(before, update(definition, [{ id: before.assertions[0].id, metadata: before.assertions[0].metadata }]), clock);
  assert.deepEqual(after.assertions, before.assertions);
});

test('all approved field kinds retain false zero empty text and Gregorian leap date', () => {
  const fields = [['text', 'string'], ['count', 'number'], ['flag', 'boolean'], ['date', 'date'], ['choice', 'enum']]
    .map(([id, kind]) => ({ id, label: id, kind, required: true, options: kind === 'enum' ? ['é', 'other'] : [] }));
  const before = current(), metadata = { text: '', count: 0, flag: false, date: '2000-02-29', choice: 'e\u0301' };
  const after = proposeTypeChange(before, update(type({ fields }), [{ id: before.assertions[0].id, metadata }]), clock);
  assert.deepEqual(after.assertions[0].metadata, { ...metadata, choice: 'é' });
  for (const invalid of [{ ...metadata, count: 1e13 }, { ...metadata, date: '1900-02-29' }, { ...metadata, flag: null },
    { ...metadata, choice: 'missing' }, { ...metadata, text: 'x'.repeat(1025) }]) {
    assert.throws(() => proposeTypeChange(before, update(type({ fields }), [{ id: before.assertions[0].id, metadata: invalid }]), clock), { code: 'validation' });
  }
});

test('migration identities cannot duplicate or target unrelated or missing assertions', () => {
  const before = current(), row = { id: before.assertions[0].id, metadata: {} };
  before.assertions.push(assertion({ id: 'unrelated', type: 'similar' }));
  for (const migration of [[row, row], [{ ...row, id: 'unknown' }], [{ ...row, id: 'unrelated' }]]) {
    assert.throws(() => proposeTypeChange(before, update(type({ fields: [] }), migration), clock), { code: 'validation' });
  }
});

test('commands reject unsupported keys kinds IDs and invalid catalog definitions', () => {
  const before = current();
  const invalid = [update(type({ id: 'unknown' })), { ...update(type()), extra: true }, { ...update(type()), kind: 'delete' },
    update({ ...type(), version: 99 }), update(type({ fields: [type().fields[0], type().fields[0]] })),
    update(type({ fields: [{ id: 'enum', label: 'Enum', kind: 'enum', required: false, options: ['same', 'same'] }] }))];
  for (const change of invalid) assert.throws(() => proposeTypeChange(before, change, clock), { code: 'validation' });
});

test('invalid migration timestamps never escape the proposal or mutate old records', () => {
  const before = current(), original = structuredClone(before);
  const change = update(type({ fields: [] }), [{ id: before.assertions[0].id, metadata: {} }]);
  assert.throws(() => proposeTypeChange(before, change, 'invalid'), { code: 'validation' });
  assert.deepEqual(before, original);
});

test('general snapshot transition rejects existing type deletion and caller-controlled version reuse', () => {
  const before = current(), removed = structuredClone(before); removed.types.pop(); removed.assertions = [];
  assert.throws(() => validateTypeTransition(before, removed), { code: 'validation' });
  for (const version of [1, 3]) {
    const after = structuredClone(before); after.types.at(-1).label = 'Renamed'; after.types.at(-1).version = version;
    assert.throws(() => validateTypeTransition(before, after), { code: 'validation' });
  }
  const next = proposeTypeChange(before, update(type({ label: 'Renamed' })), clock);
  assert.doesNotThrow(() => validateTypeTransition(before, next));
  assert.doesNotThrow(() => validateTypeTransition(before, before));
});

test('general transition requires new type version one and no version-only updates', () => {
  const before = current(), after = structuredClone(before);
  after.types.push({ ...type({ id: 'new-type' }), version: 2 });
  assert.throws(() => validateTypeTransition(before, after), { code: 'validation' });
  const bumped = structuredClone(before); bumped.types.at(-1).version = 2;
  assert.throws(() => validateTypeTransition(before, bumped), { code: 'validation' });
});
