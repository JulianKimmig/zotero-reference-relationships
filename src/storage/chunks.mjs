/** Canonical graph fragments and exact inert HTML note rendering, with conservative editor headroom. */
import { check } from '../domain/values.mjs';
import { validateGraph } from '../domain/graph-contract.mjs';
import { canonicalJSON } from './canonical.mjs';
import { makeRecord, verifyEnvelope } from './envelopes.mjs';

const encoder = new TextEncoder();
const PREFIX = '<div data-schema-version="9"><h1>Reference Relationships data</h1><pre>';
const SUFFIX = '</pre></div>';
const TARGET = 30_000;

/** Escape inert pre text. @param {string} text Canonical JSON. @returns {string} HTML text. */
function escape(text) { return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

/**
 * Render the exact production wrapper, counting UTF-8 after escaping and including every overhead byte.
 * @param {object} body Envelope; cryptographic verification is the caller's responsibility.
 * @returns {string} Note HTML, throwing limit above 32000 bytes or typed canonical validation failures.
 */
export function renderNote(body) {
  const html = PREFIX + escape(canonicalJSON(body)) + SUFFIX;
  check(encoder.encode(html).byteLength <= 32_000, 'Rendered authority note exceeds 32000 UTF-8 bytes', 'limit');
  return html;
}

/**
 * Validate and serialize the entire graph, splitting scalar Unicode only, targeting 30000 rendered bytes.
 * Every returned record is verified and rendered before publication; fragment strings need not be JSON.
 * No platform digest, library selection, native I/O or computed relationship data is introduced here.
 * @param {object} snapshot Complete graph accepted by validateGraph, at most 1 MiB canonical UTF-8.
 * @param {Function} digest Explicit real SHA-256 provider over UTF-8 text.
 * @returns {Promise<object>} Exact {snapshotHash,bytes,records}; records are signed bodies in index order.
 */
export async function chunkSnapshot(snapshot, digest) {
  check(typeof digest === 'function', 'Explicit SHA-256 digest provider required');
  const text = canonicalJSON(validateGraph(snapshot));
  const bytes = encoder.encode(text).byteLength;
  const snapshotHash = await digest(text);
  check(typeof snapshotHash === 'string' && snapshotHash.length === 64 && /^[a-f0-9]{64}$/u.test(snapshotHash),
    'Expected lowercase SHA-256 hex');
  const records = [];
  let fragment = '', used = overhead(0);
  /** Count empty envelope/wrapper bytes. @param {number} index Record position. @returns {number} Bytes. */
  function overhead(index) {
    return encoder.encode(renderNote({ format: 'reference-relationships/record', schema: 1,
      index, data: '', hash: '0'.repeat(64) })).byteLength;
  }
  /** Verify and render a completed fragment. @returns {Promise<void>} Appends only a complete valid body. */
  async function flush() {
    const record = await makeRecord(records.length, fragment, digest);
    await verifyEnvelope(record, digest);
    renderNote(record);
    records.push(record);
    fragment = ''; used = overhead(records.length);
  }
  for (const point of text) {
    const cost = encoder.encode(escape(JSON.stringify(point).slice(1, -1))).byteLength;
    if (used + cost > TARGET) await flush();
    fragment += point; used += cost;
  }
  if (fragment) await flush();
  return { snapshotHash, bytes, records };
}
