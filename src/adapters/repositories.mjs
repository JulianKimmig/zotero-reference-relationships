/** Compose actual note repositories with application guards inside the owned native transaction. */
import { createNativeTransport } from '../storage/native-notes.mjs';
import { GraphRepository } from '../storage/repository.mjs';
import { check } from '../domain/values.mjs';

/**
 * Share real native transports by scope; guarded writers retain their exact library identity.
 * @param {object} options Actual {Zotero,DOMParser,crypto,TextEncoder,gateway} resources.
 * @returns {object} {repositoryFor,clear} composition boundary.
 */
export function createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway }) {
  const transports = new Map();
  /** Use actual WebCrypto over UTF-8. @param {string} text Canonical data. @returns {Promise<string>} SHA-256 hex. */
  async function digest(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  }
  /** Construct a real repository with an optional declared application transaction guard. @param {string} scope Containing scope. @param {Function|null} guard Null for unguarded reads, callback for application writes. @returns {GraphRepository} Actual repository. */
  function repositoryFor(scope, guard) {
    check(guard === null || typeof guard === 'function', 'Explicit application guard or null is required');
    if (!transports.has(scope)) {
      transports.set(scope, createNativeTransport({ Zotero, DOMParser, libraryID: gateway.library(scope).libraryID }));
    }
    const base = transports.get(scope);
    const transport = guard === null ? base : { ...base,
      /** Run real eligibility checks under the actual native DB lock. @param {Function} action Actual repository writes. @returns {Promise<*>} Committed result. */
      transaction(action) {
        return base.transaction(async function guardedWrite() { await guard(); return action(); });
      },
    };
    return new GraphRepository({ transport, digest, now: () => new Date().toISOString() });
  }
  /** Release owned transport references after application shutdown. @returns {void} */
  function clear() { transports.clear(); }
  return { repositoryFor, clear };
}
