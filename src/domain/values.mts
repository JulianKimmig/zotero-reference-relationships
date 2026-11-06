/** Pure contract assertions and detached strict NFC JSON; no platform or test dependencies. */
import type { JsonValue } from './contracts.mts';
import { jsonTokenBytes } from './json-token-bytes.mts';

const MAX_DEPTH = 32;
const MAX_BYTES = 1_048_576;

/** A domain failure with a stable machine-readable code and diagnostic details. */
export class ContractError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  /**
   * Construct a contract failure.
   * @param {string} code Error category, including validation, limit or unsupported-schema.
   * @param {string} message Human-readable diagnostic.
   * @param {object} details Additional diagnostic data.
   * @returns {ContractError} Structured failure.
   */
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Assert a domain invariant without substituting a default on failure.
 * @param {boolean} condition Required condition.
 * @param {string} message Failure diagnostic.
 * @param {string} code Error category; defaults to validation.
 * @returns {void} Throws ContractError when the condition is false.
 */
export function check(condition: unknown, message: string, code: string = 'validation'): asserts condition {
  if (!condition) throw new ContractError(code, message);
}

/**
 * Recognize builtin object/array prototypes across compartments without invoking constructors.
 * @param {object} value Candidate container.
 * @param {boolean} array Whether the expected container is an array.
 * @returns {boolean} Whether the direct prototype belongs to the corresponding native constructor.
 */
function plain(value: object, array: boolean): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  return !!constructor && typeof constructor.value === 'function'
    && constructor.value.prototype === prototype
    && Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(array ? Array : Object);
}

/**
 * Read enumerable own data properties without executing getters, hooks or symbol coercions.
 * @param {object} value Plain container.
 * @param {boolean} array Whether the container is an array.
 * @returns {object} Own property descriptors, including array length where applicable.
 */
function dataProperties(value: object, array: boolean): Record<string, PropertyDescriptor> {
  check(plain(value, array), 'Expected a builtin plain JSON container');
  const keys = Reflect.ownKeys(value);
  check(keys.every(key => typeof key === 'string'), 'Symbol JSON properties are unsupported');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = descriptors[key as string];
    check(descriptor.enumerable && Object.hasOwn(descriptor, 'value'), 'Expected enumerable JSON data properties');
  }
  return descriptors;
}

/**
 * Assert that an ordinary object has exactly the requested enumerable data keys.
 * @param {*} value Candidate object; arrays and custom/null prototypes are rejected.
 * @param {string[]} keys Exact required own property names.
 * @returns {void} Throws ContractError for malformed object structure.
 */
export function exact<K extends string>(value: unknown, keys: readonly K[]): asserts value is Record<K, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a plain object');
  const descriptors = dataProperties(value, false);
  check(Object.keys(descriptors).length === keys.length && keys.every(key => Object.hasOwn(descriptors, key)),
    'Object must contain exactly the expected fields');
}

/**
 * Assert a stable ASCII identifier of one to 64 characters.
 * @param {*} value Identifier beginning with an ASCII letter/digit; remaining characters may include . _ : -.
 * @returns {void} Throws ContractError for malformed identifiers, including trailing line breaks.
 */
export function identifier(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(value)
    && !value.endsWith('\n'), 'Invalid stable identifier');
}

/**
 * Assert a Unicode scalar string and inclusive codepoint length bounds without mutating/normalizing it.
 * @param {*} value Candidate string; normalization belongs to jsonCopy.
 * @param {number} max Maximum codepoints.
 * @param {number} min Minimum codepoints, default zero.
 * @returns {void} Throws ContractError for invalid strings or bounds violations.
 */
export function text(value: unknown, max: number, min: number = 0): asserts value is string {
  check(typeof value === 'string', 'Expected a string');
  check(!/[\uD800-\uDFFF]/u.test(value), 'Lone UTF-16 surrogate is invalid');
  const length = [...value].length;
  check(length >= min && length <= max, `Expected ${min}..${max} Unicode codepoints`);
}

/**
 * Normalize valid Unicode without accepting replacement characters for malformed UTF-16.
 * @param {string} value String or object key.
 * @returns {string} NFC string.
 */
function normalize(value: string): string {
  check(!/[\uD800-\uDFFF]/u.test(value), 'Lone UTF-16 surrogate is invalid');
  return value.normalize('NFC');
}

/**
 * Copy strict finite JSON recursively, normalizing keys/strings and detaching shared references.
 * Objects retain builtin Object prototypes and lexical UTF-16 key insertion order; ordinary JS
 * integer-key enumeration still applies. Arrays retain their input order. Accessors, hidden/symbol keys,
 * custom/null prototypes, cycles, undefined, sparse/extended arrays and NFC key collisions fail.
 * Bounds apply to canonical serialized UTF-8 bytes (including escapes/punctuation), at most 1 MiB,
 * and root depth zero through depth 32 inclusive. These are implementation bounds, not sync limits.
 * @param {*} value Strict JSON candidate.
 * @returns {*} Detached normalized JSON value; -0 becomes 0. Throws ContractError on invalid/oversized input.
 */
export function jsonCopy<T>(value: T): T {
  const active = new Set<object>();
  let bytes = 0;
  /** Count canonical serialized bytes. @param {string} token JSON token. @returns {void} Throws on overflow. */
  function account(token: string): void {
    bytes += jsonTokenBytes(token);
    check(bytes <= MAX_BYTES, 'JSON UTF-8 byte limit exceeded', 'limit');
  }
  /** Copy a bounded node. @param {*} item Candidate. @param {number} depth Root-relative depth. @returns {*} Copy. */
  function copy(item: unknown, depth: number): JsonValue {
    check(depth <= MAX_DEPTH, 'JSON nesting limit exceeded', 'limit');
    if (item === null || typeof item === 'boolean') {
      account(String(item)); return item;
    }
    if (typeof item === 'number') {
      check(Number.isFinite(item), 'Expected a finite JSON number');
      account(JSON.stringify(item)); return Object.is(item, -0) ? 0 : item;
    }
    if (typeof item === 'string') {
      const normalized = normalize(item);
      account(JSON.stringify(normalized)); return normalized;
    }
    check(item !== null && typeof item === 'object', 'Unsupported JSON value');
    const array = Array.isArray(item);
    const descriptors = dataProperties(item, array);
    check(!active.has(item), 'Cyclic JSON value');
    active.add(item);
    let result: JsonValue;
    account(array ? '[' : '{');
    if (array) {
      const length = descriptors.length.value;
      check(Object.keys(descriptors).length === length + 1, 'Sparse or extended JSON array');
      result = [];
      for (let index = 0; index < length; index++) {
        check(Object.hasOwn(descriptors, String(index)), 'Sparse or extended JSON array');
        if (index) account(',');
        result.push(copy(descriptors[index].value, depth + 1));
      }
    } else {
      const originals = new Map<string, string>();
      for (const key of Object.keys(descriptors)) {
        const normalized = normalize(key);
        check(!originals.has(normalized), 'Colliding NFC JSON keys');
        originals.set(normalized, key);
      }
      result = {};
      let index = 0;
      for (const key of [...originals.keys()].sort()) {
        if (index++) account(',');
        account(JSON.stringify(key)); account(':');
        Object.defineProperty(result, key, {
          value: copy(descriptors[originals.get(key)!].value, depth + 1),
          enumerable: true, writable: true, configurable: true,
        });
      }
    }
    account(array ? ']' : '}');
    active.delete(item);
    return result;
  }
  return copy(value, 0) as T;
}
