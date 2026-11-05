/** Pure bounded canonical NFC JSON; UTF-16 lexical keys and UTF-8 accounting, independent of native APIs. */
import { check } from '../domain/values.mts';

const encoder = new TextEncoder();

/** Normalize scalar Unicode. @param {string} value String/key. @returns {string} NFC text. */
function normalized(value: string) {
  check(!/[\uD800-\uDFFF]/u.test(value), 'Lone UTF-16 surrogate is invalid');
  return value.normalize('NFC');
}

/** Recognize builtins across compartments. @param {object} value Container.
 * @param {boolean} array Expected kind. @returns {boolean} Plain builtin prototype. */
function plain(value: object, array: boolean): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  return !!descriptor && typeof descriptor.value === 'function' && descriptor.value.prototype === prototype
    && Function.prototype.toString.call(descriptor.value) === Function.prototype.toString.call(array ? Array : Object);
}

/**
 * Encode strict plain JSON without executing accessors, toJSON or coercion hooks.
 * Shared references are copied; cycles, hidden/symbol keys, nonfinite numbers,
 * exotic containers, malformed Unicode, sparse arrays and NFC key collisions fail.
 * @param {*} value JSON candidate; root depth is zero.
 * @param {object} options Inclusive maxBytes (UTF-8, default 1 MiB) and maxDepth (default 32).
 * @returns {string} Canonical NFC JSON; throws ContractError with validation or limit.
 */
export function canonicalJSON(value: unknown, { maxBytes = 1_048_576, maxDepth = 32 } = {}): string {
  check(Number.isSafeInteger(maxBytes) && maxBytes >= 0, 'Invalid canonical byte bound');
  check(Number.isSafeInteger(maxDepth) && maxDepth >= 0, 'Invalid canonical depth bound');
  const active = new Set<object>();
  let bytes = 0;
  /** Count one emitted token. @param {string} token Encoded token. @returns {string} Token. */
  function emit(token: string) {
    bytes += encoder.encode(token).byteLength;
    check(bytes <= maxBytes, 'Canonical JSON UTF-8 limit exceeded', 'limit');
    return token;
  }
  /** Encode one node. @param {*} item Candidate. @param {number} depth Root-relative nesting. @returns {string} JSON. */
  function encode(item: unknown, depth: number): string {
    check(depth <= maxDepth, 'Canonical JSON nesting limit exceeded', 'limit');
    if (item === null || typeof item === 'boolean') return emit(String(item));
    if (typeof item === 'string') return emit(JSON.stringify(normalized(item)));
    if (typeof item === 'number') {
      check(Number.isFinite(item), 'Expected finite JSON number');
      return emit(JSON.stringify(item));
    }
    check(item !== null && typeof item === 'object', 'Unsupported JSON value');
    const array = Array.isArray(item);
    check(plain(item, array), 'Expected builtin plain JSON container');
    check(!active.has(item), 'Cyclic JSON value');
    const keys = Reflect.ownKeys(item);
    check(keys.every(key => typeof key === 'string'), 'Symbol JSON properties are unsupported');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of keys) {
      if (array && key === 'length') continue;
      check(descriptors[key as string].enumerable && Object.hasOwn(descriptors[key as string], 'value'), 'Expected enumerable data properties');
    }
    active.add(item);
    const parts = [];
    emit(array ? '[' : '{');
    if (array) {
      const length = descriptors.length.value;
      check(keys.length === length + 1, 'Sparse or extended JSON array');
      for (let index = 0; index < length; index++) {
        check(Object.hasOwn(descriptors, String(index)), 'Sparse or extended JSON array');
        if (index) emit(',');
        parts.push(encode(descriptors[index].value, depth + 1));
      }
    } else {
      const originals = new Map<string, string>();
      for (const key of keys) {
        check(typeof key === 'string', 'Symbol JSON properties are unsupported');
        const nfc = normalized(key);
        check(!originals.has(nfc), 'Colliding NFC JSON keys');
        originals.set(nfc, key);
      }
      for (const key of [...originals.keys()].sort()) {
        if (parts.length) emit(',');
        parts.push(emit(JSON.stringify(key)) + emit(':') + encode(descriptors[originals.get(key)!].value, depth + 1));
      }
    }
    active.delete(item);
    return (array ? '[' : '{') + parts.join(',') + emit(array ? ']' : '}');
  }
  return encode(value, 0);
}
