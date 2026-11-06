/** JSON-token byte counts preserve native UTF-8 semantics and published strict-copy byte boundaries. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonTokenBytes } from '../src/domain/json-token-bytes.mts';
import { jsonCopy } from '../src/domain/values.mts';

test('ASCII punctuation, escaped controls, numeric and literal tokens match real UTF-8 encoding', () => {
  for (const token of ['[', ']', '{', '}', ':', ',', 'null', 'false', '-1.25e+30', JSON.stringify('quotes"\\\n\t\u0000'), JSON.stringify('ASCII '.repeat(200))]) {
    assert.equal(jsonTokenBytes(token), new TextEncoder().encode(token).byteLength);
  }
});

test('non-ASCII tokens preserve two/three/four-byte scalar widths and combining text', () => {
  for (const text of ['é', 'e\u0301', '你好', '😀', 'العربية', 'prefix😀\u2028é suffix']) {
    const token = JSON.stringify(text); assert.equal(jsonTokenBytes(token), Buffer.byteLength(token, 'utf8'));
  }
});

test('mixed strings and escaped delimiters retain exact accepted and rejected strict-copy boundaries', () => {
  for (const token of ['ASCII', 'é', '你', '😀', '\n', '"', '\\']) {
    const base = { value: token.repeat(20) }, normalized = jsonCopy(base);
    const bytes = Buffer.byteLength(JSON.stringify(normalized)), padding = 1_048_576 - bytes;
    const input = { value: `${base.value}${'x'.repeat(padding)}` };
    assert.equal(Buffer.byteLength(JSON.stringify(jsonCopy(input))), 1_048_576);
    assert.throws(() => jsonCopy({ value: `${input.value}x` }), { code: 'limit' });
  }
});
