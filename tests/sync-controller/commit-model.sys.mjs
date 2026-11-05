/**
 * Bounded note-store experiment, shared unchanged by Node and Mozilla ES modules.
 * No runtime integration or platform globals. Supply digest(text): Promise<string>
 * using real SHA-256 over UTF-8 text; hashes are lowercase hexadecimal.
 * Each commit owns a complete snapshot, including an empty snapshot for deletion.
 * Limits are experiment guards: 4096 observed notes, 64 JSON nesting levels,
 * and 1 Mi UTF-16 code units of canonical JSON per operation/input batch.
 */
const RECORD = 'rr-feasibility-record/v1';
const COMMIT = 'rr-feasibility-commit/v1';
const MAX_JSON = 1_048_576;
const MAX_NOTES = 4096;
const HEX = /^[a-f0-9]{64}$/;

/** Existing invalid data, ambiguous identities or violated experiment limits. */
export class IntegrityError extends Error {
  /** Construct an explicit failure. @param {string} message Diagnostic. @returns {IntegrityError} Error. */
  constructor(message) { super(message); this.name = 'IntegrityError'; }
}

/** An envelope whose schema this experiment cannot interpret. */
export class UnsupportedSchemaError extends Error {
  /** Construct an unsupported-schema failure. @param {string} message Diagnostic. @returns {UnsupportedSchemaError} Error. */
  constructor(message) { super(message); this.name = 'UnsupportedSchemaError'; }
}

/** Require a protocol invariant. @param {boolean} condition Invariant. @param {string} message Failure. @returns {void} */
function requireValid(condition, message) {
  if (!condition) throw new IntegrityError(message);
}

/** Recognize builtin prototypes across realms. @param {object} value Object/array. @param {boolean} array Kind. @returns {boolean} Plain JSON container. */
function plainContainer(value, array) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  return !!descriptor && typeof descriptor.value === 'function'
    && descriptor.value.prototype === prototype
    && Function.prototype.toString.call(descriptor.value) === Function.prototype.toString.call(array ? Array : Object);
}

/**
 * Encode strict plain JSON with sorted NFC keys and NFC string values.
 * Reject undefined, nonfinite numbers, cycles, sparse/extended arrays, custom
 * prototypes, accessors, symbols, hidden properties and colliding normalized keys.
 * @param {*} value JSON value. @returns {string} Canonical JSON, with -0 as 0.
 */
export function canonicalJSON(value) {
  const active = new Set();
  let length = 0;
  /** Account for emitted tokens. @param {string} text Token. @returns {string} Token. */
  function emit(text) {
    length += text.length;
    requireValid(length <= MAX_JSON, 'Canonical JSON size limit exceeded');
    return text;
  }
  /** Encode a value without executing user hooks. @param {*} item Value. @param {number} depth Nesting. @returns {string} JSON. */
  function encode(item, depth) {
    requireValid(depth <= 64, 'Canonical JSON nesting limit exceeded');
    if (item === null) return emit('null');
    if (typeof item === 'string') return emit(JSON.stringify(item.normalize('NFC')));
    if (typeof item === 'boolean') return emit(String(item));
    if (typeof item === 'number') {
      requireValid(Number.isFinite(item), 'Nonfinite JSON number');
      return emit(JSON.stringify(item));
    }
    requireValid(typeof item === 'object', 'Unsupported JSON value');
    const array = Array.isArray(item);
    requireValid(plainContainer(item, array), 'Unsupported JSON prototype');
    requireValid(!active.has(item), 'Cyclic JSON value');
    const keys = Reflect.ownKeys(item);
    requireValid(keys.every(key => typeof key === 'string'), 'Symbol JSON property');
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of keys) {
      if (array && key === 'length') continue;
      requireValid(descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'), 'Non-data JSON property');
    }
    active.add(item);
    let result;
    if (array) {
      requireValid(keys.length === item.length + 1, 'Sparse or extended JSON array');
      const parts = [];
      emit('[');
      for (let i = 0; i < item.length; i++) {
        requireValid(Object.hasOwn(descriptors, String(i)), 'Sparse or extended JSON array');
        if (i) emit(',');
        parts.push(encode(descriptors[i].value, depth + 1));
      }
      result = `[${parts.join(',')}${emit(']')}`;
    } else {
      const normalized = keys.map(key => [key.normalize('NFC'), key]).sort(compareKeys);
      requireValid(new Set(normalized.map(([key]) => key)).size === keys.length, 'Duplicate normalized JSON keys');
      emit('{');
      const parts = normalized.map(([key, original], index) => {
        if (index) emit(',');
        return `${emit(JSON.stringify(key))}${emit(':')}${encode(descriptors[original].value, depth + 1)}`;
      });
      result = `{${parts.join(',')}${emit('}')}`;
    }
    active.delete(item);
    return result;
  }
  return encode(value, 0);
}

/** Compare pairs by key without locale dependence. @param {Array} a Pair. @param {Array} b Pair. @returns {number} Order. */
function compareKeys(a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }

/** Normalize and detach input before asynchronous work. @param {*} value JSON. @returns {*} Plain normalized JSON. */
function snapshot(value) { return JSON.parse(canonicalJSON(value)); }

/** Validate exact object fields. @param {*} value Object. @param {string[]} fields Keys. @returns {void} */
function exact(value, fields) {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key)), 'Malformed envelope fields');
}

/** Validate a native note identity. @param {*} key Candidate. @returns {void} */
function noteKey(key) { requireValid(typeof key === 'string' && key.length > 0, 'Invalid note key'); }

/** Require an external digest implementation. @param {*} digest Provider. @returns {void} */
function provider(digest) { requireValid(typeof digest === 'function', 'Explicit SHA-256 digest provider required'); }

/** Hash canonical JSON through the external provider. @param {*} value JSON. @param {Function} digest Provider. @returns {Promise<string>} SHA-256 hex. */
async function hash(value, digest) {
  const result = await digest(canonicalJSON(value));
  requireValid(typeof result === 'string' && HEX.test(result), 'Invalid SHA-256 digest result');
  return result;
}

/** Validate unique parent and record references. @param {object} input Snapshot reference sets. @returns {void} */
function references(input) {
  requireValid(Array.isArray(input.parents) && Array.isArray(input.records), 'Malformed commit references');
  input.parents.forEach(noteKey);
  requireValid(new Set(input.parents).size === input.parents.length, 'Duplicate parent key');
  for (const ref of input.records) {
    exact(ref, ['key', 'hash']);
    noteKey(ref.key);
    requireValid(typeof ref.hash === 'string' && HEX.test(ref.hash), 'Invalid record reference hash');
  }
  requireValid(new Set(input.records.map(ref => ref.key)).size === input.records.length, 'Duplicate record reference key');
}

/** Create a detached normalized record. @param {*} payload Strict JSON. @param {Function} digest Required SHA-256 provider. @returns {Promise<object>} Record body; hash covers payload only. */
export async function makeRecord(payload, digest) {
  provider(digest);
  const normalized = snapshot(payload);
  return { format: RECORD, hash: await hash(normalized, digest), payload: normalized };
}

/** Create a snapshot commit. @param {object} input {parents:string[],records:{key,hash}[]}. @param {Function} digest Required provider. @returns {Promise<object>} Body; hash covers format, parents and records. */
export async function makeCommit(input, digest) {
  provider(digest);
  const normalized = snapshot(input);
  exact(normalized, ['parents', 'records']);
  references(normalized);
  normalized.parents.sort();
  normalized.records.sort((a, b) => compareKeys([a.key], [b.key]));
  const body = { format: COMMIT, ...normalized };
  return { ...body, hash: await hash(body, digest) };
}

/** Validate a stored body, including unreachable records. @param {*} body Envelope. @param {boolean} record Kind. @param {Function} digest Provider. @returns {Promise<void>} Verified. */
async function validate(body, record, digest) {
  requireValid(body !== null && typeof body === 'object' && !Array.isArray(body), 'Malformed note body');
  if (body.format !== (record ? RECORD : COMMIT)) throw new UnsupportedSchemaError(`Unsupported note schema: ${body.format}`);
  exact(body, record ? ['format', 'hash', 'payload'] : ['format', 'hash', 'parents', 'records']);
  requireValid(typeof body.hash === 'string' && HEX.test(body.hash), 'Invalid stored hash');
  if (!record) references(body);
  const unsigned = record ? body.payload : { format: body.format, parents: body.parents, records: body.records };
  requireValid(body.hash === await hash(unsigned, digest), 'Stored note hash mismatch');
}

/**
 * Evaluate a bounded, library-scoped observation of immutable notes, without I/O.
 * Every supplied note is validated. Missing ancestry blocks descendants; existing
 * corrupt data throws, even if another branch is pending. Keys share one native
 * note namespace. Call again after downloads/restart; no hidden state is retained.
 * @param {Array<{key:string,body:object}>} commits Commit notes for one library.
 * @param {Array<{key:string,body:object}>} records Record notes for that library.
 * @param {Function} digest Required digest(canonicalText): Promise<SHA256 hex>.
 * @returns {Promise<object>} ready {head,payloads}, conflict {heads}, or pending
 * {missing,previousHeads}. Key lists and ready payloads are ordered by note key.
 */
export async function evaluate(commits, records, digest) {
  provider(digest);
  requireValid(Array.isArray(commits) && Array.isArray(records), 'Expected note arrays');
  requireValid(commits.length + records.length <= MAX_NOTES, 'Observed note count limit exceeded');
  const batch = snapshot({ commits, records });
  const all = new Set(), commitMap = new Map(), recordMap = new Map();
  for (const [notes, map, isRecord] of [[batch.commits, commitMap, false], [batch.records, recordMap, true]]) {
    for (const note of notes) {
      exact(note, ['key', 'body']); noteKey(note.key);
      requireValid(!all.has(note.key), `Duplicate note key: ${note.key}`);
      all.add(note.key);
      await validate(note.body, isRecord, digest);
      map.set(note.key, note.body);
    }
  }
  const missing = new Set(), children = new Map(), remaining = new Map(), complete = new Set();
  for (const [key, body] of commitMap) {
    for (const parent of body.parents) {
      requireValid(!recordMap.has(parent), `Parent key is a record: ${parent}`);
      if (!commitMap.has(parent)) missing.add(parent);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(key);
    }
    remaining.set(key, body.parents.filter(parent => commitMap.has(parent)).length);
    for (const ref of body.records) {
      requireValid(!commitMap.has(ref.key), `Record key is a commit: ${ref.key}`);
      if (!recordMap.has(ref.key)) missing.add(ref.key);
      else requireValid(recordMap.get(ref.key).hash === ref.hash, `Record reference hash mismatch: ${ref.key}`);
    }
  }
  const queue = [...remaining].filter(([, count]) => count === 0).map(([key]) => key);
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index], body = commitMap.get(key);
    if (body.parents.every(parent => complete.has(parent)) && body.records.every(ref => recordMap.has(ref.key))) complete.add(key);
    for (const child of children.get(key) || []) {
      remaining.set(child, remaining.get(child) - 1);
      if (remaining.get(child) === 0) queue.push(child);
    }
  }
  requireValid(queue.length === commitMap.size, 'Commit graph cycle detected');
  const heads = [...commitMap.keys()].filter(key => !children.has(key)).sort();
  if (!heads.length || missing.size) {
    const previousHeads = [...complete].filter(key => !(children.get(key) || []).some(child => complete.has(child))).sort();
    return { state: 'pending', missing: [...missing].sort(), previousHeads };
  }
  if (heads.length > 1) return { state: 'conflict', heads };
  const head = heads[0];
  const payloads = [...commitMap.get(head).records].sort((a, b) => compareKeys([a.key], [b.key])).map(ref => recordMap.get(ref.key).payload);
  return { state: 'ready', head, payloads };
}
