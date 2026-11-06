/** Native Zotero note transport; owns library permissions, DOM decoding and local transactions. */
import { ContractError, check } from '../domain/values.mts';
import { renderNote } from './chunks.mts';
import { errorMessage } from '../domain/failures.mts';
import type { LibraryScope } from '../domain/contracts.mts';
import type { HostResources, NativeItem } from '../adapters/native-contracts.mts';
import type { Envelope, NoteTransport, PhysicalNote } from './contracts.mts';

/** Explicit native note boundary contains no authentication or replacement storage. */
export type NativeTransportOptions = Pick<HostResources, 'Zotero' | 'DOMParser'> & { libraryID: number };

const MARKER = 'Reference Relationships data';
const encoder = new TextEncoder();

/**
 * Bind the real Zotero platform. No authentication or native relation data is read.
 * Authority notes remain visible standalone items and are never edited in place.
 * @param {object} options Real {Zotero,DOMParser,libraryID} platform resources.
 * @returns {object} Transport with stable identity/scope, scan/get/create and transaction.
 */
export function createNativeTransport({ Zotero, DOMParser, libraryID }: NativeTransportOptions): NoteTransport {
  const library = Zotero.Libraries.get(libraryID);
  check(!!library && ['user', 'group'].includes(library.libraryType), 'Unsupported native library', 'endpoint');
  const scope: LibraryScope = library.libraryType === 'user' ? 'self' : `group:${Zotero.Groups.getGroupIDFromLibraryID(libraryID)}`;
  const known = new Set<string>();
  let createdInTransaction: string[] | null = null;

  /** Recheck actual current library ownership/editability. @returns {void} */
  function assertWritable() {
    const current = Zotero.Libraries.get(libraryID);
    check(!!current && current === library && current.editable && !current.archived, 'Library is not currently writable', 'permission');
  }

  /** Decode a marked native note, refusing malformed or moved known authority. @param {object} item Native note. @param {boolean} required Known referenced authority. @returns {Promise<object|null>} Envelope wrapper or unrelated note. */
  async function decodeBody(item: NativeItem | false | null, required: boolean): Promise<PhysicalNote | null> {
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
    let body: unknown;
    try { body = JSON.parse(blocks[0].textContent!); }
    catch (cause) { throw new ContractError('storage', `Invalid authority JSON in ${item.key}`, { key: item.key, reason: errorMessage(cause) }); }
    check(body !== null && typeof body === 'object' && 'format' in body && typeof body.format === 'string'
      && body.format.startsWith('reference-relationships/'), 'Marked authority has an invalid format', 'storage');
    known.add(item.key);
    return { key: item.key, body: body as Record<string, unknown>, html };
  }

  /** Preserve authority-key diagnostics for marker, ownership and payload failures. @param {object|null} item Native note. @param {boolean} required Known authority. @returns {Promise<object|null>} Decoded note or explicit absence. */
  async function decode(item: NativeItem | false | null, required: boolean): Promise<PhysicalNote | null> {
    try { return await decodeBody(item, required); }
    catch (error) {
      const code = error instanceof ContractError ? error.code : 'storage';
      const message = errorMessage(error);
      throw new ContractError(code, message, { ...(error instanceof ContractError ? error.details : {}), key: item ? item.key : undefined, reason: message });
    }
  }

  /** Load an exact referenced key, including detection of marker evasion. @param {string} key Native note key. @returns {Promise<object|null>} Actual note or absence. */
  async function get(key: string) {
    check(typeof key === 'string' && /^[A-Z0-9]{8}$/.test(key), 'Invalid native authority key', 'storage');
    return decode(await Zotero.Items.getByLibraryAndKeyAsync(libraryID, key), true);
  }

  /** Discover every standalone nondeleted note through an unsaved native search in the exact library, retaining known-key checks outside that candidate set. @returns {Promise<object[]>} All marked authority notes; no head selection or full-library item enumeration. */
  async function scan() {
    check(Zotero.Libraries.get(libraryID) === library, 'Library is unavailable', 'endpoint');
    const search = new Zotero.Search(); search.libraryID = libraryID;
    search.addCondition('itemType', 'is', 'note'); search.addCondition('noChildren', 'true');
    const ids = await search.search();
    const result: PhysicalNote[] = [], seen = new Set<string>();
    let bytes = 0;
    for (const id of ids) {
      const item = await Zotero.Items.getAsync(id);
      const entry = await decode(item, !!item && known.has(item.key));
      if (entry) { result.push(entry); seen.add(entry.key); bytes += encoder.encode(entry.html).byteLength; }
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
  async function create(body: Envelope): Promise<string> {
    check(Zotero.DB.inTransaction() && createdInTransaction !== null, 'Authority writes require the owned native transaction', 'storage');
    assertWritable();
    const item = new Zotero.Item('note'); item.libraryID = libraryID;
    item.setNote(renderNote(body)); await item.save();
    createdInTransaction.push(item.key);
    const saved = await decode(item, true);
    check(!!saved, 'Native save lost authority', 'storage');
    return item.key;
  }

  /** Queue and own the full native transaction; invoke only at an independent command/event boundary. @param {Function} action Actual write callback. @returns {Promise<*>} Result after our own commit/rollback. */
  async function ownTransaction<T>(action: () => Promise<T>): Promise<T> {
    const created: string[] = [];
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

  /** Reject directly enclosing transactions before starting our owned transaction. @param {Function} action Write callback. @returns {Promise<*>} Committed result. */
  async function transaction<T>(action: () => Promise<T>): Promise<T> {
    check(!Zotero.DB.inTransaction(), 'Repository cannot publish inside an external transaction', 'storage');
    return ownTransaction(action);
  }

  /** Queue a native event command behind unrelated host transactions; never call from a transaction callback. @param {Function} action Guarded writes. @returns {Promise<*>} Result after this command's own native commit. */
  async function transactionFromEvent<T>(action: () => Promise<T>): Promise<T> { return ownTransaction(action); }

  return { identity: library, scope, assertWritable, scan, get, create, transaction, transactionFromEvent };
}

/** Construct a transport for independent native event/command callbacks, using its own queued transaction. Never call writes from a database transaction callback. @param {object} options Actual {Zotero,DOMParser,libraryID}. @returns {object} Real native transport with the explicit event transaction policy. */
export function createEventTransport(options: NativeTransportOptions): NoteTransport {
  const transport = createNativeTransport(options);
  return { ...transport, transaction: transport.transactionFromEvent };
}
