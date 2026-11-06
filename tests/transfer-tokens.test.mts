/** Actual opaque token behavior rejects foreign identities, input changes and retired generations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportTokens } from '../src/transfer/tokens.mts';

test('issued token retains private data without exposing it or accepting structural copies', () => {
  const tokens = new ImportTokens<{ value: number }>(), document = { note: 'Café' }, mapping = { target: 'self' };
  const token = tokens.issue(document, mapping, { value: 7 });
  assert.deepEqual(Object.keys(token), []); assert.ok(Object.isFrozen(token));
  assert.equal(tokens.get(token).value, 7);
  assert.throws(() => tokens.get({}), { code: 'conflict' });
  assert.throws(() => tokens.get(structuredClone(token)), { code: 'conflict' });
  assert.throws(() => new ImportTokens<{ value: number }>().get(token), { code: 'conflict' });
});

test('changes to either reviewed input reject the same opaque token', () => {
  const tokens = new ImportTokens<number>(), document = { value: 'before' }, mapping = { target: 'self' };
  const documentToken = tokens.issue(document, mapping, 1); document.value = 'after';
  assert.throws(() => tokens.get(documentToken), { code: 'conflict' });
  const mappingToken = tokens.issue(document, mapping, 2); mapping.target = 'group:123';
  assert.throws(() => tokens.get(mappingToken), { code: 'conflict' });
});

test('retiring one token preserves other issued reviews and clear retires the generation', () => {
  const tokens = new ImportTokens<number>();
  const first = tokens.issue({}, {}, 1), second = tokens.issue({}, {}, 2);
  tokens.retire(first); assert.throws(() => tokens.get(first), { code: 'conflict' });
  assert.equal(tokens.get(second), 2); tokens.clear();
  assert.throws(() => tokens.get(second), { code: 'conflict' });
});

test('canonical Unicode spelling remains semantically identical while structural mutations reject', () => {
  const tokens = new ImportTokens<number>(), document = { note: 'Cafe\u0301' }, mapping = { items: ['A'] };
  const token = tokens.issue(document, mapping, 1); document.note = 'Café'; assert.equal(tokens.get(token), 1);
  mapping.items.push('B'); assert.throws(() => tokens.get(token), { code: 'conflict' });
});

test('a rejected changed input permanently retires the review even if the caller restores it', () => {
  const tokens = new ImportTokens<number>(), document = { note: 'before' };
  const token = tokens.issue(document, {}, 1); document.note = 'after';
  assert.throws(() => tokens.get(token), { code: 'conflict' });
  document.note = 'before'; assert.throws(() => tokens.get(token), { code: 'conflict' });
});
