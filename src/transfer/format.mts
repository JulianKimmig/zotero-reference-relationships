/** Owner-bound portable authority envelopes with independent file/graph limits and canonical SHA-256 integrity. */
import { ContractError, check, exact, jsonCopy } from '../domain/values.mts';
import { validateGraph, validateTimestamp } from '../domain/graph-contract.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import type { Digest } from '../domain/contracts.mts';
import type { ExportEnvelope, SourceOwner } from './contracts.mts';

const FORMAT = 'reference-relationships/export';
const MAX_BYTES = 2_097_152;
const encoder = new TextEncoder();

/** Copy strict normalized envelope data using its own byte bound, without applying the graph's smaller bound to the wrapper. @param {*} value Untrusted ordinary JSON. @returns {*} Detached canonical NFC JSON. */
function copy<T>(value: T): T { return JSON.parse(canonicalJSON(value, { maxBytes: MAX_BYTES })); }

/** Validate canonical source identity and its exact containing graph scope. @param {object} input Exact {kind,id}. @param {string} library Validated graph scope. @returns {object} Detached source owner. */
export function validateSourceOwner(input: unknown, library: string): SourceOwner {
  const source = jsonCopy(input); exact(source, ['kind', 'id']);
  check(typeof source.kind === 'string' && ['user', 'local-user', 'group'].includes(source.kind) && typeof source.id === 'string', 'Invalid export source owner');
  const pattern = source.kind === 'local-user' ? /^[A-Za-z0-9]{8}$/u : /^[1-9][0-9]{0,14}$/u;
  check(pattern.exec(source.id)?.[0] === source.id, 'Export owner ID must be canonical');
  check(source.kind === 'group' ? library === `group:${source.id}` : library === 'self', 'Export source does not own the snapshot scope');
  return source as SourceOwner;
}

/** Validate exact export inputs and retain all original entities/versions without generated state. @param {object} input Detached exact {source,snapshot,exportedAt}. @returns {object} Complete unsigned envelope. */
function unsigned(input: unknown): Omit<ExportEnvelope, 'hash'> {
  exact(input, ['source', 'snapshot', 'exportedAt']); validateTimestamp(input.exportedAt);
  const snapshot = validateGraph(input.snapshot), source = validateSourceOwner(input.source, snapshot.library);
  return { format: FORMAT, schema: 1, source, snapshot, exportedAt: input.exportedAt };
}

/** Require a real canonical SHA-256 value at the cryptographic boundary. @param {*} value Hash result or untrusted field. @returns {void} */
function hashValue(value: unknown): asserts value is string { check(typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/u.test(value), 'Invalid export SHA-256'); }

/** Construct a portable complete snapshot without native reads or writes. @param {object} input Exact {source,snapshot,exportedAt}. @param {Function} digest Explicit async SHA-256 over canonical UTF-8. @returns {Promise<object>} Detached exact hashed schema-1 envelope. */
export async function createExport(input: unknown, digest: Digest): Promise<ExportEnvelope> {
  check(typeof digest === 'function', 'Explicit export SHA-256 provider required');
  const value = unsigned(copy(input)), hash = await digest(canonicalJSON(value, { maxBytes: MAX_BYTES })); hashValue(hash);
  return copy({ ...value, hash });
}

/** Validate all envelope/graph fields and its canonical unsigned content hash. @param {*} input Untrusted ordinary JSON document. @param {Function} digest Explicit actual SHA-256 provider. @returns {Promise<object>} Detached complete validated export; no computed edges are accepted. */
export async function verifyExport(input: unknown, digest: Digest): Promise<ExportEnvelope> {
  check(typeof digest === 'function', 'Explicit export SHA-256 provider required');
  const value = copy(input); exact(value, ['format', 'schema', 'source', 'snapshot', 'exportedAt', 'hash']);
  check(value.format === FORMAT && value.schema === 1, 'Unsupported export schema or format', 'unsupported-schema');
  const body = unsigned({ source: value.source, snapshot: value.snapshot, exportedAt: value.exportedAt }); hashValue(value.hash);
  const expected = await digest(canonicalJSON(body, { maxBytes: MAX_BYTES })); hashValue(expected);
  check(expected === value.hash, 'Export content hash does not match');
  return copy({ ...body, hash: value.hash });
}

/** Parse a raw UTF-8-decoded file with byte accounting before JSON parsing, then verify complete authority integrity. @param {string} input Untrusted file text. @param {Function} digest Explicit actual SHA-256 provider. @returns {Promise<object>} Detached validated envelope. */
export async function parseExport(input: string, digest: Digest): Promise<ExportEnvelope> {
  check(typeof input === 'string', 'Expected export file text');
  check(encoder.encode(input).byteLength <= MAX_BYTES, 'Export file UTF-8 byte limit exceeded', 'limit');
  let value: unknown;
  try { value = JSON.parse(input); }
  catch (cause) { throw new ContractError('validation', 'Malformed export JSON', { reason: cause instanceof Error ? cause.name : typeof cause }); }
  return verifyExport(value, digest);
}
