/** Behavioral specification for the pure, bounded canonical JSON wire encoding. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { canonicalJSON } from '../src/storage/canonical.mjs';
import { ContractError } from '../src/domain/values.mjs';

/** Match a typed failure. @param {string} code Expected code. @returns {Function} Predicate. */
function failure(code) {
  return error => error instanceof ContractError && error.code === code && typeof error.details === 'object';
}

test('canonical JSON uses lexical UTF-16 keys, NFC, primitive JSON encoding and array order', () => {
  const value = { 2: 'two', 10: 'ten', z: [-0, true, null, '\n', 'e\u0301', '😀'], a: { b: 1, a: 2 } };
  assert.equal(canonicalJSON(value), '{"10":"ten","2":"two","a":{"a":2,"b":1},"z":[0,true,null,"\\n","é","😀"]}');
  assert.equal(canonicalJSON({ '\uE000': 1, '😀': 2 }), '{"😀":2,"":1}');
  assert.equal(canonicalJSON({ 'e\u0301': 'e\u0301' }), '{"é":"é"}');
  assert.equal(value.z[4], 'e\u0301');
  assert(Object.is(value.z[0], -0));
  assert.throws(() => canonicalJSON({ '__proto__': null }), failure('validation'));
  assert.equal(canonicalJSON(JSON.parse('{"__proto__":{"value":1}}')), '{"__proto__":{"value":1}}');
});

test('plain arrays and objects work across realms and shared references are not cycles', () => {
  assert.equal(canonicalJSON(runInNewContext('({b:[1,"e\\u0301"],a:2})')), '{"a":2,"b":[1,"é"]}');
  const shared = { a: 1 };
  assert.equal(canonicalJSON([shared, shared]), '[{"a":1},{"a":1}]');
});

test('rejects unsupported primitives, malformed scalar Unicode and normalized key collisions', () => {
  for (const value of [undefined, NaN, Infinity, -Infinity, 1n, Symbol('s'), () => 1,
    '\uD800', '\uDC00', 'ok\uD800', { '\uDC00': 1 }, { é: 1, 'e\u0301': 2 }]) {
    assert.throws(() => canonicalJSON(value), failure('validation'));
  }
});

test('rejects cycles, custom/null prototypes, boxed values, dates and foreign exotic containers', () => {
  const cycle = []; cycle.push(cycle);
  for (const value of [cycle, Object.create(null), Object.create({}), new Date(), new Map(),
    new Number(1), new Uint8Array([1]), runInNewContext('new Date()')]) {
    assert.throws(() => canonicalJSON(value), failure('validation'));
  }
});

test('rejects hidden/symbol/accessor properties without invoking getters or toJSON', () => {
  let calls = 0;
  const getter = Object.defineProperty({}, 'a', { enumerable: true, get() { calls++; return 1; } });
  const hidden = Object.defineProperty({}, 'a', { value: 1 });
  const symbol = { [Symbol('a')]: 1 };
  const hook = { toJSON() { calls++; return {}; } };
  for (const value of [getter, hidden, symbol, hook]) assert.throws(() => canonicalJSON(value), failure('validation'));
  assert.equal(calls, 0);
});

test('rejects sparse, extended and accessor arrays including noncanonical numeric properties', () => {
  const extended = [1]; extended.extra = 2;
  const oddIndex = [1]; oddIndex['01'] = 2;
  const accessor = [1]; Object.defineProperty(accessor, '0', { enumerable: true, get() { throw Error('invoked'); } });
  for (const value of [Array(1), [1, , 2], extended, oddIndex, accessor]) {
    assert.throws(() => canonicalJSON(value), failure('validation'));
  }
});

test('depth counts the root as zero, permits 32, rejects 33 and respects caller depth', () => {
  let value = 1;
  for (let depth = 0; depth < 32; depth++) value = [value];
  assert.equal(JSON.parse(canonicalJSON(value)).length, 1);
  assert.throws(() => canonicalJSON([value]), failure('limit'));
  assert.equal(canonicalJSON(1, { maxDepth: 0 }), '1');
  assert.throws(() => canonicalJSON([1], { maxDepth: 0 }), failure('limit'));
});

test('UTF-8 limits include JSON escapes and punctuation, with exact inclusive boundaries', () => {
  assert.equal(canonicalJSON('é', { maxBytes: 4 }), '"é"');
  assert.throws(() => canonicalJSON('é', { maxBytes: 3 }), failure('limit'));
  assert.equal(canonicalJSON('\n', { maxBytes: 4 }), '"\\n"');
  assert.throws(() => canonicalJSON('\n', { maxBytes: 3 }), failure('limit'));
  assert.equal(canonicalJSON('x'.repeat(1_048_574)).length, 1_048_576);
  assert.throws(() => canonicalJSON('x'.repeat(1_048_575)), failure('limit'));
  for (const options of [{ maxBytes: -1 }, { maxBytes: NaN }, { maxDepth: 1.5 }, { maxDepth: -1 }]) {
    assert.throws(() => canonicalJSON(null, options), failure('validation'));
  }
});
