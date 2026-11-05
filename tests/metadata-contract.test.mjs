/** Behavioral contracts for pure JSON values, relationship types and metadata. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { ContractError, check, exact, identifier, text, jsonCopy } from '../src/domain/values.mjs';
import { validateType, validateMetadata, validateFieldValue } from '../src/domain/metadata.mjs';

/** Make a field fixture. @param {string} kind Kind. @param {object} changes Overrides. @returns {object} Field. */
function field(kind = 'string', changes = {}) {
  return { id: 'note', label: 'Note', kind, required: false, options: [], ...changes };
}
/** Make a type fixture. @param {object[]} fields Definitions. @param {object} changes Overrides. @returns {object} Type. */
function type(fields = [field()], changes = {}) {
  return { id: 'referencing', label: 'Referencing', description: '', version: 1, retired: false, fields, ...changes };
}
/** Assert a public error code. @param {Function} action Operation. @param {string} code Code. @returns {void} */
function fails(action, code = 'validation') {
  assert.throws(action, /** @param {Error} error Failure. @returns {boolean} Correct public error. */ error => {
    assert.ok(error instanceof ContractError); assert.equal(error.code, code); return true;
  });
}

/** Public errors preserve diagnostic fields; checks support caller-selected codes. */
test('structured errors and check expose stable API', () => {
  const error = new ContractError('validation', 'Bad input', { field: 'note' });
  assert.ok(error instanceof Error); assert.equal(error.name, 'ContractError');
  assert.equal(error.message, 'Bad input'); assert.deepEqual(error.details, { field: 'note' });
  assert.deepEqual(new ContractError('limit', 'Too big').details, {});
  assert.equal(check(true, 'ok'), undefined);
  fails(() => check(false, 'Bad')); fails(() => check(false, 'Large', 'limit'), 'limit');
  fails(() => check(false, 'New schema', 'unsupported-schema'), 'unsupported-schema');
});

/** Exact objects reject extra, inherited and non-data properties without invoking getters. */
test('exact accepts only ordinary objects with exactly the specified data keys', () => {
  exact({ a: 1 }, ['a']); exact(runInNewContext('({a:1})'), ['a']);
  for (const value of [null, [], { a: 1, b: 2 }, {}, Object.create({ a: 1 }), Object.create(null),
    Object.defineProperty({}, 'a', { enumerable: true, get() { throw Error('getter executed'); } }),
    Object.defineProperty({ a: 1 }, 'hidden', { value: 1 }), { a: 1, [Symbol('x')]: 2 }]) {
    fails(() => exact(value, ['a']));
  }
});

/** Identifier validation uses opaque ASCII IDs, including exact start/end and length bounds. */
test('identifier handles valid IDs and separate malformed boundaries', () => {
  for (const value of ['a', '0', 'A.b_c:d-9', 'a'.repeat(64)]) identifier(value);
  for (const value of ['', '_a', '-a', 'a/b', 'é', 'a b', 'a\n', 'a'.repeat(65), null, 12]) fails(() => identifier(value));
});

for (const [name, terminator] of [['LF', '\n'], ['CR', '\r'], ['U+2028', '\u2028'], ['U+2029', '\u2029']]) {
  /** Reject a final line terminator after short and maximum-length IDs. @returns {void} */
  test(`identifier rejects final ${name}`, () => {
    fails(() => identifier(`a${terminator}`));
    fails(() => identifier(`${'a'.repeat(64)}${terminator}`));
  });
}

/** Text counts Unicode codepoints, accepts empty optional strings and rejects malformed Unicode. */
test('text enforces string and codepoint bounds', () => {
  text('', 0); text('😀'.repeat(128), 128, 1); text('e\u0301', 2);
  for (const value of [null, 1, true, '\ud800', '\udfff']) fails(() => text(value, 10));
  fails(() => text('', 128, 1)); fails(() => text('😀'.repeat(129), 128));
});

/** JSON copies normalize nested keys/values, preserve array order and detach every container. */
test('jsonCopy normalizes and detaches plain JSON across native-style realms', () => {
  const input = { z: [true, null, -0, { 'e\u0301': 'A\u030a' }], a: 'e\u0301' };
  const output = jsonCopy(input);
  assert.deepEqual(output, { a: 'é', z: [true, null, 0, { é: 'Å' }] });
  assert.deepEqual(Object.keys(output), ['a', 'z']); assert.equal(Object.is(output.z[2], -0), false);
  output.z[3].é = 'changed'; assert.equal(input.z[3]['e\u0301'], 'A\u030a');
  assert.deepEqual(jsonCopy(runInNewContext('({a:[1,{b:"e\\u0301"}]})')), { a: [1, { b: 'é' }] });
  const shared = { a: 1 }; const copied = jsonCopy([shared, shared]);
  assert.notEqual(copied[0], copied[1]); assert.deepEqual(copied[0], copied[1]);
  assert.deepEqual(jsonCopy(JSON.parse('{"__proto__":{"safe":true}}')), JSON.parse('{"__proto__":{"safe":true}}'));
});

/** Ordinary objects insert normalized keys lexically and retain JavaScript integer-key enumeration rules. */
test('jsonCopy inserts normalized keys lexically with ordinary integer-key enumeration', () => {
  const output = jsonCopy({ 2: 'two', 10: 'ten', '\ue000': 1, '😀': 2, nest: { z: 0, a: 1 } });
  assert.deepEqual(Object.keys(output), ['2', '10', 'nest', '😀', '\ue000']);
  assert.equal(JSON.stringify(jsonCopy({ 2: 'two', 10: 'ten' })), '{"2":"two","10":"ten"}');
  assert.deepEqual(Object.keys(output.nest), ['a', 'z']);
});

/** Detached objects remain ordinary cloneable JSON containers for native bridges. */
test('jsonCopy returns structured-cloneable ordinary containers throughout nested input', () => {
  const output = jsonCopy({ 2: [{ nested: 'e\u0301' }], a: { flag: true } });
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.equal(Object.getPrototypeOf(output.a), Object.prototype);
  const cloned = structuredClone(output);
  assert.deepEqual(cloned, { 2: [{ nested: 'é' }], a: { flag: true } });
  cloned[2][0].nested = 'changed'; assert.equal(output[2][0].nested, 'é');
});

/** Strict JSON rejects every unsupported primitive and non-builtin container. */
test('jsonCopy rejects unsupported values and prototypes', () => {
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, Symbol('x'), () => 1, new Date(),
    new Map(), new Set(), /x/, new Number(1), new Uint8Array(1), Object.create(null),
    Object.create({ a: 1 }), new (class Example {})(), runInNewContext('new Date()'),
    runInNewContext('new (class Example {})()'), Object.setPrototypeOf([], {})]) fails(() => jsonCopy(value));
});

/** All own properties must be enumerable data; arrays must be dense and free of extension properties. */
test('jsonCopy rejects accessors, hidden keys, symbols and sparse or extended arrays', () => {
  const accessor = Object.defineProperty({}, 'a', { enumerable: true, get() { throw Error('getter executed'); } });
  const arrayAccessor = Object.defineProperty([1], '0', { enumerable: true, get() { throw Error('getter executed'); } });
  for (const value of [accessor, arrayAccessor, Object.defineProperty({}, 'x', { value: 1 }),
    { [Symbol('x')]: 1 }, Object.assign([], { extra: 1 }), [1, , 3], { a: undefined }, [undefined],
    Object.defineProperty({}, 'toJSON', { get() { throw Error('hook executed'); } })]) fails(() => jsonCopy(value));
});

/** NFC key collisions, invalid scalar sequences and active cycles fail; DAG sharing is valid. */
test('jsonCopy rejects cycles, colliding normalized keys and lone surrogates', () => {
  const cycle = {}; cycle.self = cycle;
  for (const value of [cycle, { é: 1, 'e\u0301': 2 }, '\ud800', '\udfff', 'x\ud800y',
    { '\ud800': 1 }, ['\udfff'], { nested: { é: 1, 'e\u0301': 2 } }]) fails(() => jsonCopy(value));
});

/** Depth uses root depth zero; canonical byte limits include UTF-8, escapes and JSON punctuation. */
test('jsonCopy bounds depth and exact UTF-8 serialized size', () => {
  let nested = null;
  for (let i = 0; i < 32; i++) nested = [nested];
  assert.deepEqual(jsonCopy(nested), nested); fails(() => jsonCopy([nested]), 'limit');
  assert.equal(jsonCopy('x'.repeat(1_048_574)).length, 1_048_574);
  fails(() => jsonCopy('x'.repeat(1_048_575)), 'limit');
  assert.equal(jsonCopy('é'.repeat(524_287)).length, 524_287);
  fails(() => jsonCopy('é'.repeat(524_288)), 'limit');
  fails(() => jsonCopy('\n'.repeat(524_288)), 'limit');
});

/** Types retain stable IDs while normalizing labels/options and accepting retired definitions. */
test('validateType returns a detached exact NFC type including retired types', () => {
  const input = type([field('enum', { options: ['e\u0301', '😀'] })], { label: 'Cafe\u0301', retired: true });
  const result = validateType(input);
  assert.deepEqual(result, { ...input, label: 'Café', fields: [{ ...input.fields[0], options: ['é', '😀'] }] });
  result.fields[0].options.push('new'); assert.equal(input.fields[0].options.length, 2);
  assert.equal(input.label, 'Cafe\u0301');
});

/** Version, labels, flags and exact envelopes are validated independently. */
test('validateType rejects malformed envelope fields and preserves numeric version policy', () => {
  for (const changes of [{ id: 'bad id' }, { label: '' }, { label: '😀'.repeat(129) },
    { description: 'x'.repeat(4097) }, { version: 0 }, { version: -1 }, { version: 1.5 },
    { version: Number.MAX_SAFE_INTEGER + 1 }, { version: '1' }, { retired: 1 }, { extra: true }, { fields: {} }]) {
    fails(() => validateType(type([], changes)));
  }
  const missing = type(); delete missing.description; fails(() => validateType(missing));
  validateType(type([], { version: Number.MAX_SAFE_INTEGER, label: '😀'.repeat(128), description: '😀'.repeat(4096) }));
});

/** Field count, IDs, exact schemas, kind, labels and required flags have explicit bounds. */
test('validateType checks field definitions and unique IDs', () => {
  const fields = Array.from({ length: 16 }, (_, i) => field('string', { id: `f${i}` }));
  validateType(type(fields)); fails(() => validateType(type([...fields, field()])));
  fails(() => validateType(type([field(), field()])));
  for (const changes of [{ id: 'bad id' }, { label: '' }, { label: 'x'.repeat(129) }, { kind: 'html' },
    { required: 'yes' }, { options: ['bad'] }, { options: null }, { extra: 1 }]) {
    fails(() => validateType(type([field('string', changes)])));
  }
  const missing = field(); delete missing.options; fails(() => validateType(type([missing])));
});

/** Enums normalize before checking uniqueness, allow 64 bounded strings and reject malformed options. */
test('validateType enforces enum option values, normalization and count bounds', () => {
  validateType(type([field('enum', { options: Array.from({ length: 64 }, (_, i) => `${i}`) })]));
  validateType(type([field('enum', { options: ['😀'.repeat(1024)] })]));
  for (const options of [[], [''], ['x', 'x'], ['é', 'e\u0301'], ['x'.repeat(1025)], [1],
    Array.from({ length: 65 }, (_, i) => `${i}`)]) fails(() => validateType(type([field('enum', { options })])));
});

/** Every supported kind accepts its primitive and empty optional metadata stays empty. */
test('validateMetadata validates all kinds, false, zero, empty text and omitted optional fields', () => {
  const fields = ['string', 'number', 'boolean', 'date', 'enum'].map(kind => field(kind, {
    id: kind, required: true, options: kind === 'enum' ? ['é', 'other'] : [],
  }));
  const input = { string: '', number: 0, boolean: false, date: '2000-02-29', enum: 'e\u0301' };
  assert.deepEqual(validateMetadata(type(fields), input), { ...input, enum: 'é' });
  assert.equal(input.enum, 'e\u0301'); assert.deepEqual(validateMetadata(type(), {}), {});
  assert.deepEqual(validateMetadata(type([], { retired: true }), {}), {});
  const output = validateMetadata(type(), { note: 'e\u0301' }); output.note = 'changed';
  assert.deepEqual(validateMetadata(type(), { note: 'e\u0301' }), { note: 'é' });
});

/** Unknown names, absent required values and null are rejected regardless of field kind. */
test('validateMetadata rejects unknown fields, null, missing requirements and non-object inputs', () => {
  fails(() => validateMetadata(type(), { unknown: 'x' }));
  fails(() => validateMetadata(type([field('string', { required: true })]), {}));
  for (const kind of ['string', 'number', 'boolean', 'date', 'enum']) {
    fails(() => validateMetadata(type([field(kind, { options: kind === 'enum' ? ['x'] : [] })]), { note: null }));
  }
  for (const value of [null, [], 'text', 1]) fails(() => validateMetadata(type(), value));
  fails(() => validateMetadata(type([], { version: 0 }), {}));
  fails(() => validateMetadata(type(), { note: undefined }));
});

/** Standalone validation serves rule constants without requiring unrelated root metadata. */
test('validateFieldValue detaches and normalizes one primitive using the complete field contract', () => {
  assert.equal(validateFieldValue(field('string', { required: true }), 'e\u0301'), 'é');
  assert.equal(validateFieldValue(field('number'), 0), 0);
  assert.equal(Object.is(validateFieldValue(field('number'), -0), -0), false);
  assert.equal(validateFieldValue(field('boolean'), false), false);
  assert.equal(validateFieldValue(field('enum', { options: ['e\u0301'] }), 'é'), 'é');
  fails(() => validateFieldValue(field('unknown'), 'x'));
  fails(() => validateFieldValue(field('enum', { options: ['é', 'e\u0301'] }), 'é'));
  fails(() => validateFieldValue(field('string', { extra: true }), 'x'));
});

/** Primitive bounds are behavioral, with separate cases for invalid types and overflow. */
test('field primitives enforce text, number, boolean and enum boundaries', () => {
  assert.equal(validateFieldValue(field(), '😀'.repeat(1024)).length, 2048);
  assert.equal(validateFieldValue(field(), '<script>alert(1)</script>'), '<script>alert(1)</script>');
  for (const value of [1e12, -1e12, 0.125]) assert.equal(validateFieldValue(field('number'), value), value);
  for (const value of ['x'.repeat(1025), null, 1, {}, []]) fails(() => validateFieldValue(field(), value));
  for (const value of [1e12 + 1, -1e12 - 1, NaN, Infinity, '1', null]) fails(() => validateFieldValue(field('number'), value));
  for (const value of [0, 1, 'false', null]) fails(() => validateFieldValue(field('boolean'), value));
  for (const value of ['X', '', 1]) fails(() => validateFieldValue(field('enum', { options: ['x'] }), value));
});

/** Dates use the proleptic Gregorian calendar without timezone parsing or rollover. */
test('date fields accept valid Gregorian boundaries and reject invalid dates and formats', () => {
  for (const value of ['0001-01-01', '9999-12-31', '2000-02-29', '2024-02-29', '1900-02-28']) {
    assert.equal(validateFieldValue(field('date'), value), value);
  }
  for (const value of ['0000-01-01', '10000-01-01', '1900-02-29', '2100-02-29', '2023-02-29',
    '2024-04-31', '2024-00-01', '2024-13-01', '2024-01-00', '2024-01-32', '2024-1-01',
    '2024-01-1', '2024-01-01\n', '2024-01-01Z', '2024-01-01T00:00:00Z', 20240101]) {
    fails(() => validateFieldValue(field('date'), value));
  }
});
