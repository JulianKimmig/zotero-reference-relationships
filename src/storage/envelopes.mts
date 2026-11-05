/** Strict production record/commit envelopes with explicit external SHA-256 and immutable normalized inputs. */
import { ContractError, check, exact } from '../domain/values.mts';
import { canonicalJSON } from './canonical.mts';
import type { Digest } from '../domain/contracts.mts';
import type { CommitEnvelope, CommitFields, Envelope, RecordEnvelope } from './contracts.mts';

const RECORD = 'reference-relationships/record';
const COMMIT = 'reference-relationships/commit';
const HEX = /^[a-f0-9]{64}$/u;

/** Assert a native key. @param {*} key Candidate. @returns {void} Throws validation. */
function noteKey(key: unknown): asserts key is string {
  check(typeof key === 'string' && key.length === 8 && /^[A-Z0-9]{8}$/u.test(key), 'Invalid native note key');
}

/** Assert a lowercase hash. @param {*} value Candidate. @returns {void} Throws validation. */
function hashValue(value: unknown): asserts value is string {
  check(typeof value === 'string' && value.length === 64 && HEX.test(value), 'Expected lowercase SHA-256 hex');
}

/** Require external hashing. @param {*} digest Provider. @returns {void} Throws validation. */
function provider(digest: unknown): asserts digest is Digest { check(typeof digest === 'function', 'Explicit SHA-256 digest provider required'); }

/** Hash all unsigned fields. @param {object} body Fields. @param {Function} digest Provider.
 * @returns {Promise<object>} Signed normalized body. */
async function sign<T extends object>(body: T, digest: Digest): Promise<T & { hash: string }> {
  const hash = await digest(canonicalJSON(body));
  hashValue(hash);
  return { ...body, hash };
}

/** Assert a record payload. @param {object} body Unsigned/signed envelope. @returns {void} Throws validation. */
function recordFields(body: Record<string, unknown>): asserts body is Record<string, unknown> & { index: number; data: string } {
  check(typeof body.index === 'number' && Number.isSafeInteger(body.index) && body.index >= 0, 'Invalid record index');
  check(typeof body.data === 'string', 'Expected snapshot fragment string');
}

/** Assert a timestamp. @param {*} value UTC millisecond timestamp. @returns {void} Throws validation. */
function timestamp(value: unknown): asserts value is string {
  check(typeof value === 'string' && value.length === 24
    && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u.test(value), 'Invalid UTC timestamp');
  const date = new Date(value);
  check(Number.isFinite(date.getTime()) && date.toISOString() === value && !value.startsWith('0000'), 'Invalid Gregorian timestamp');
}

/** Validate references and full snapshot descriptor. @param {object} body Commit fields.
 * @param {boolean} sort Sort constructor references; verification requires supplied order. @returns {void} Throws typed failure. */
function commitFields(body: Record<string, unknown>, sort: boolean): asserts body is Record<string, unknown> & CommitFields {
  check(Array.isArray(body.parents) && Array.isArray(body.records), 'Expected commit reference arrays');
  const parents = body.parents;
  parents.forEach(noteKey);
  check(new Set(parents).size === parents.length, 'Duplicate parent key');
  if (sort) parents.sort();
  check(parents.every((key, index) => index === 0 || parents[index - 1] < key), 'Parents must be canonically sorted');
  check(body.records.length >= 1, 'A complete snapshot requires at least one record');
  const keys = new Set<string>();
  for (const ref of body.records) {
    exact(ref, ['key', 'hash', 'index']);
    noteKey(ref.key); hashValue(ref.hash);
    check(!keys.has(ref.key), 'Duplicate record key'); keys.add(ref.key);
    check(typeof ref.index === 'number' && Number.isSafeInteger(ref.index) && ref.index >= 0, 'Invalid referenced record index');
  }
  if (sort) body.records.sort((a, b) => a.index - b.index);
  check(body.records.every((ref, index) => ref.index === index), 'Record indices must be contiguous and sorted from zero');
  hashValue(body.snapshotHash);
  check(typeof body.bytes === 'number' && Number.isSafeInteger(body.bytes) && body.bytes >= 1, 'Invalid snapshot byte count');
  check(body.bytes <= 1_048_576, 'Snapshot UTF-8 limit exceeded', 'limit');
  timestamp(body.createdAt);
}

/**
 * Construct a detached NFC record. Rendering separately enforces the stored-note limit.
 * @param {number} index Nonnegative safe contiguous position within its snapshot.
 * @param {string} data Unicode scalar snapshot fragment, not necessarily standalone JSON.
 * @param {Function} digest Required real SHA-256 provider over UTF-8 canonical text.
 * @returns {Promise<object>} Exact signed record; malformed construction throws validation.
 */
export async function makeRecord(index: number, data: string, digest: Digest): Promise<RecordEnvelope> {
  provider(digest);
  const body: Omit<RecordEnvelope, 'hash'> = JSON.parse(canonicalJSON({ format: RECORD, schema: 1, index, data }));
  recordFields(body);
  return sign(body, digest);
}

/**
 * Construct a complete-generation commit, sorting unique parent and record references.
 * @param {object} input Exact {parents,records,snapshotHash,bytes,createdAt}; refs are {key,hash,index}.
 * @param {Function} digest Required real SHA-256 UTF-8 provider.
 * @returns {Promise<object>} Exact signed commit; rendering enforces the actual HTML size bound.
 */
export async function makeCommit(input: unknown, digest: Digest): Promise<CommitEnvelope> {
  provider(digest);
  const fields: unknown = JSON.parse(canonicalJSON(input));
  exact(fields, ['parents', 'records', 'snapshotHash', 'bytes', 'createdAt']);
  commitFields(fields, true);
  return sign({ format: COMMIT, schema: 1 as const, ...fields }, digest);
}

/**
 * Verify every field and the hash of an observed production envelope, without reordering references.
 * @param {*} input Candidate body; detached and NFC-normalized before asynchronous hashing.
 * @param {Function} digest Required real SHA-256 UTF-8 provider.
 * @returns {Promise<object>} Detached normalized verified body. Unknown format/schema throws
 * unsupported-schema; existing malformed/hash-invalid data throws storage; bounds throw limit.
 */
export function verifyEnvelope(input: RecordEnvelope, digest: Digest): Promise<RecordEnvelope>;
/** Verify a known manifest. @param input Manifest candidate. @param digest Real SHA-256 provider. @returns Verified detached manifest. */
export function verifyEnvelope(input: CommitEnvelope, digest: Digest): Promise<CommitEnvelope>;
/** Verify untrusted note data. @param input Unknown wire envelope. @param digest Real SHA-256 provider. @returns Verified record or manifest. */
export function verifyEnvelope(input: unknown, digest: Digest): Promise<Envelope>;
/** Validate normalized fields and content identity. @param input Candidate note body. @param digest Real SHA-256 provider. @returns Detached verified envelope. */
export async function verifyEnvelope(input: unknown, digest: Digest): Promise<Envelope> {
  provider(digest);
  try {
    const body: unknown = JSON.parse(canonicalJSON(input));
    check(body !== null && typeof body === 'object' && !Array.isArray(body), 'Expected envelope object');
    check('format' in body && typeof body.format === 'string' && Object.hasOwn(body, 'schema'), 'Missing envelope format/schema');
    check((body.format === RECORD || body.format === COMMIT) && (body as { schema?: unknown }).schema === 1,
      'Unsupported authority format/schema', 'unsupported-schema');
    exact(body, body.format === RECORD ? ['format', 'schema', 'index', 'data', 'hash']
      : ['format', 'schema', 'parents', 'records', 'snapshotHash', 'bytes', 'createdAt', 'hash']);
    hashValue(body.hash);
    if (body.format === RECORD) recordFields(body); else commitFields(body, false);
    const { hash, ...unsigned } = body;
    const verified = await sign(unsigned, digest);
    check(hash === verified.hash, 'Envelope SHA-256 mismatch');
    return body as Envelope;
  } catch (error) {
    if (error instanceof ContractError && ['limit', 'unsupported-schema'].includes(error.code)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new ContractError('storage', message, { reason: message });
  }
}
