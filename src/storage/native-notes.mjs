/** Native Zotero note transport; owns library permissions, DOM decoding and local transactions. */
import { ContractError, check } from '../domain/values.mjs';
import { renderNote } from './chunks.mjs';

const MARKER = 'Reference Relationships data';
const encoder = new TextEncoder();

/**
 * Bind the real Zotero platform. No authentication or native relation data is read.
 * Authority notes remain visible standalone items and are never edited in place.
 * @param {object} options Real {Zotero,DOMParser,libraryID} platform resources.
 * @returns {object} Transport with stable identity/scope, scan/get/create and transaction.
 */
export function createNativeTransport({ Zotero, DOMParser, libraryID }) {
  const library = Zotero.Libraries.get(libraryID);
  check(!!library && ['user', 'group'].includes(library.libraryType), 'Unsupported native library', 'endpoint');
  const scope = library.libraryType === 'user' ? 'self' : `group:${Zotero.Groups.getGroupIDFromLibraryID(libraryID)}`;
  const known = new Set();
  let createdInTransaction = null;

  /** Recheck actual current library ownership/editability. @returns {void} */
  function assertWritable() {
    const current = Zotero.Libraries.get(libraryID);
    check(current === library && current.editable && !current.archived, 'Library is not currently writable', 'permission');
  }

  /** Decode a marked native note, refusing malformed or moved known authority. @param {object} item Native note. @param {boolean} required Known referenced authority. @returns {Promise<object|null>} Envelope wrapper or unrelated note. */
  async function decodeBody(item, required) {
    if (!item || item.deleted) return null;
    check(item.libraryID === libraryID, 'Authority belongs to another library', 'storage');
    if (!item.isNote()) {
      check(!required, 'Referenced authority is not a note', 'storage'); return null;
    }
    await item.loadDataType('note');
    const html = item.getNote();
    if (!required && !html.includes(MARKER)) return null;
    const document = new DOMParser().parseFromString(html, 'text/html');
    const headings = [...document.querySelectorAll('h1')].filter(node => node.textContent === MARKER);
    if (!headings.length && !required) return null;
    check(headings.length === 1 && item.isTopLevelItem(), 'Authority marker or standalone ownership changed', 'storage');
    check(encoder.encode(html).byteLength <= 32000, 'Stored authority note exceeds the HTML byte limit', 'limit');
    const blocks = document.querySelectorAll('pre');
    check(blocks.length === 1, 'Authority must contain exactly one payload block', 'storage');
    let body;
    try { body = JSON.parse(blocks[0].textContent); }
    catch (cause) { throw new ContractError('storage', `Invalid authority JSON in ${item.key}`, { key: item.key, reason: cause.message }); }
    check(body !== null && typeof body === 'object' && typeof body.format === 'string'
      && body.format.startsWith('reference-relationships/'), 'Marked authority has an invalid format', 'storage');
    known.add(item.key);
    return { key: item.key, body, html };
  }

  /** Preserve authority-key diagnostics for marker, ownership and payload failures. @param {object|null} item Native note. @param {boolean} required Known authority. @returns {Promise<object|null>} Decoded note or explicit absence. */
  async function decode(item, required) {
    try { return await decodeBody(item, required); }
    catch (error) {
      const code = error instanceof ContractError ? error.code : 'storage';
      throw new ContractError(code, error.message, { ...error.details, key: item?.key, reason: error.message });
    }
  }

  /** Load an exact referenced key, including detection of marker evasion. @param {string} key Native note key. @returns {Promise<object|null>} Actual note or absence. */
  async function get(key) {
    check(typeof key === 'string' && /^[A-Z0-9]{8}$/.test(key), 'Invalid native authority key', 'storage');
    return decode(await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key), true);
  }

  /** Discover complete actual observations in one library; never select a subset of heads. @returns {Promise<object[]>} Marked authority notes. */
  async function scan() {
    check(Zotero.Libraries.get(libraryID) === library, 'Library is unavailable', 'endpoint');
    const notes = (await Zotero.Items.getAll(libraryID, true, false)).filter(item => item.isNote());
    const result = [], seen = new Set();
    let bytes = 0;
    for (const item of notes) {
      const entry = await decode(item, known.has(item.key));
      if (entry) { result.push(entry); seen.add(item.key); bytes += encoder.encode(entry.html).byteLength; }
      check(result.length <= 4096 && bytes <= 33_554_432, 'Authority observation exceeds bounded history', 'limit');
    }
    for (const key of known) {
      if (seen.has(key)) continue;
      const entry = await get(key);
      if (entry) { result.push(entry); bytes += encoder.encode(entry.html).byteLength; }
      check(result.length <= 4096 && bytes <= 33_554_432, 'Authority observation exceeds bounded history', 'limit');
    }
    return result;
  }

  /** Create one actual immutable note inside our owned transaction. @param {object} body Encoded envelope. @returns {Promise<string>} New native key. */
  async function create(body) {
    check(Zotero.DB.inTransaction() && createdInTransaction !== null, 'Authority writes require the owned native transaction', 'storage');
    assertWritable();
    const item = new Zotero.Item('note'); item.libraryID = libraryID;
    item.setNote(renderNote(body)); await item.save();
    createdInTransaction.push(item.key);
    const saved = await decode(item, true);
    check(!!saved, 'Native save lost authority', 'storage');
    return item.key;
  }

  /** Own the full transaction so publication cannot precede an outer rollback. @param {Function} action Asynchronous write callback. @returns {Promise<*>} Committed result. */
  async function transaction(action) {
    check(!Zotero.DB.inTransaction(), 'Repository cannot publish inside an external transaction', 'storage');
    const created = [];
    try {
      return await Zotero.DB.executeTransaction(async function writeAuthority() {
        createdInTransaction = created;
        assertWritable();
        return action();
      });
    } catch (error) {
      for (const key of created) known.delete(key);
      throw error;
    } finally { createdInTransaction = null; }
  }

  return { identity: library, scope, assertWritable, scan, get, create, transaction };
}
