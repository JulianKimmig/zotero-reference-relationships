/** Compose actual note repositories with application guards inside the owned native transaction. */
import { createNativeTransport } from '../storage/native-notes.mjs';
import { GraphRepository } from '../storage/repository.mjs';
import { check } from '../domain/values.mjs';

/**
 * Share real native transports by scope; guarded writers retain their exact library identity.
 * @param {object} options Actual {Zotero,DOMParser,crypto,TextEncoder,gateway} resources.
 * @returns {object} {repositoryFor,repositoryForEvent,digest,clear} native composition boundary.
 */
export function createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway }) {
  const transports = new Map();
  /** Use actual WebCrypto over UTF-8. @param {string} text Canonical data. @returns {Promise<string>} SHA-256 hex. */
  async function digest(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  }
  /** Compose the requested native transaction boundary and its application guard. @param {string} scope Library. @param {Function|null} guard Required writer guard or null for reads. @param {boolean} event Independent event boundary. @returns {GraphRepository} Real repository. */
  function construct(scope, guard, event) {
    check(guard === null || typeof guard === 'function', 'Explicit application guard or null is required');
    const owner = gateway.library(scope), identity = Zotero.Libraries.get(owner.libraryID);
    if (!transports.has(scope) || transports.get(scope).identity !== identity) {
      transports.set(scope, createNativeTransport({ Zotero, DOMParser, libraryID: owner.libraryID }));
    }
    const base = transports.get(scope);
    const transport = guard === null ? base : { ...base,
      /** Run real eligibility checks under the actual native DB lock. @param {Function} action Actual repository writes. @returns {Promise<*>} Committed result. */
      transaction(action) {
        const run = event ? base.transactionFromEvent : base.transaction;
        return run(async function guardedWrite() { await guard(); return action(); });
      },
    };
    return new GraphRepository({ transport, digest, now: () => new Date().toISOString() });
  }
  /** Create a strict read/writer repository that rejects enclosing transactions. @param {string} scope Library. @param {Function|null} guard Callback or null. @returns {GraphRepository} Real repository. */
  function repositoryFor(scope, guard) { return construct(scope, guard, false); }
  /** Create a guarded native-event writer that queues for its own transaction. @param {string} scope Library. @param {Function} guard Commit-time checks. @returns {GraphRepository} Real repository; never invoke in a transaction callback. */
  function repositoryForEvent(scope, guard) {
    check(typeof guard === 'function', 'Event writes require an explicit transaction guard');
    return construct(scope, guard, true);
  }
  /** Release owned transport references after application shutdown. @returns {void} */
  function clear() { transports.clear(); }
  return { repositoryFor, repositoryForEvent, digest, clear };
}
