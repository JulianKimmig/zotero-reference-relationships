/** Native-note helpers for the feasibility experiments, not a production store. */
import * as model from './commit-model.sys.mjs';

/**
 * Bind actual platform resources without substituting source implementations.
 * @param {object} api Native APIs supplied by the privileged controller.
 * @returns {object} JSON-note, digest and model operations.
 */
export function noteTools(api) {
  const { Zotero, DOMParser, crypto, TextEncoder } = api;
  /** Assert experimental behavior. @param {boolean} value Condition. @param {string} message Error. @returns {void} */
  function check(value, message) { if (!value) throw new Error(message); }
  /** Hash real UTF-8 data. @param {string} text Canonical JSON. @returns {Promise<string>} SHA-256 hex. */
  async function digest(text) {
    const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('');
  }
  /** Render canonical JSON in a visible metadata note. @param {object} body Envelope. @returns {string} HTML. */
  function html(body) {
    const text = model.canonicalJSON(body).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return `<div data-schema-version="9"><h1>Reference Relationships storage experiment</h1><pre>${text}</pre></div>`;
  }
  /** Decode the actual stored/editor HTML. @param {string} value Note HTML. @returns {object} Parsed envelope. */
  function parse(value) {
    const doc = new DOMParser().parseFromString(value, 'text/html');
    const block = doc.querySelector('pre');
    check(!!block, 'Metadata code block was lost');
    return JSON.parse(block.textContent);
  }
  /** Create a complete standalone metadata item. @param {number} libraryID Local library. @param {object} body Envelope. @param {string|undefined} key Explicit future key, when testing partial delivery. @returns {Promise<object>} Native note. */
  async function writeNote(libraryID, body, key) {
    const note = new Zotero.Item('note');
    note.libraryID = libraryID;
    if (key !== undefined) {
      check(!await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key), 'Refusing to replace an existing immutable note');
      note.key = key;
      await note.loadPrimaryData();
      check(!note.id, 'Explicit experiment key already exists');
    }
    note.setNote(html(body));
    await note.saveTx();
    check(note.isTopLevelItem(), 'Metadata authority must be independent of endpoint parents');
    return note;
  }
  /** Load an exact library-scoped record. @param {number} libraryID Local library. @param {string} key Native item key. @returns {Promise<object|null>} Key/body wrapper or absent payload. */
  async function readNote(libraryID, key) {
    const item = await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key);
    if (!item || item.deleted) return null;
    check(item.isNote(), 'Expected a metadata note');
    await item.loadDataType('note');
    return { key, body: parse(item.getNote()) };
  }
  /** Read only explicitly identified experimental notes. @param {number} libraryID Local library. @param {string[]} keys Expected keys. @returns {Promise<object[]>} Present records, allowing actual partial delivery. */
  async function readMany(libraryID, keys) {
    const entries = await Promise.all(keys.map(key => readNote(libraryID, key)));
    return entries.filter(entry => entry !== null);
  }
  /** Seal an opaque prototype snapshot. @param {object} payload Snapshot. @returns {Promise<object>} Envelope. */
  const makeRecord = payload => model.makeRecord(payload, digest);
  /** Seal a complete snapshot manifest. @param {object} input Parents and references. @returns {Promise<object>} Manifest. */
  const makeCommit = input => model.makeCommit(input, digest);
  /** Evaluate actual received records. @param {object[]} commits Manifests. @param {object[]} records Payloads. @returns {Promise<object>} Ready, pending or conflict. */
  const evaluate = (commits, records) => model.evaluate(commits, records, digest);
  return { check, digest, html, parse, writeNote, readNote, readMany, makeRecord, makeCommit,
    evaluate, canonicalJSON: model.canonicalJSON };
}
