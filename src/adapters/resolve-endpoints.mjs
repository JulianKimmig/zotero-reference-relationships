/** Read-only bounded native merge resolution; original graph keys and merge relations remain untouched. */
import { ContractError, check } from '../domain/values.mjs';
import { validateItemRef } from '../domain/graph-contract.mjs';

const MAX_ALIAS_HOPS = 64;

/** Bind native identity queries without changing stored assertions or host merge history. @param {object} options {Zotero,library}; library resolves an available native owner by portable scope. @returns {Function} Async resolve(ItemRef) returning detached availability/permission data. */
export function createEndpointResolver({ Zotero, library }) {
  check(!!Zotero && typeof library === 'function', 'Native endpoint resolver dependencies are required');

  /** Describe a real terminal item or a known missing/ambiguous original. @param {object} original Valid original ItemRef. @param {object} owner Current native library/group. @param {object|null} item Resolved actual item or none. @param {string|null} unavailable Explicit missing/ambiguous state or null for actual item classification. @returns {object} {original,resolved,status,title,editable}. */
  function description(original, owner, item, unavailable) {
    if (unavailable) return { original, resolved: null, status: unavailable,
      title: `${unavailable === 'missing' ? 'Missing' : 'Ambiguous'} reference ${original.key}`, editable: false };
    const status = !item.isRegularItem() ? 'unsupported' : item.deleted ? 'trashed' : 'active';
    return { original, resolved: { library: original.library, key: item.key }, status, title: item.getDisplayTitle(),
      editable: status === 'active' && owner.editable && !owner.archived && item.isEditable() };
  }

  /**
   * Prefer an active original, including after Undo, then follow unique same-library native aliases.
   * Ambiguity is explicit; cycles and more than 64 alias lookups fail without choosing a target.
   * URI lookup is rebuilt from the current native library owner so first-login migration is not cached.
   * @param {object} input Exact original {library,key}.
   * @returns {Promise<object>} Detached {original,resolved,status,title,editable}; no persistence or fallback.
   */
  return async function resolve(input) {
    const original = validateItemRef(input), owner = library(original.library);
    let item = await Zotero.Items.getByLibraryAndKeyAsync(owner.libraryID, original.key), key = original.key;
    if (item && !item.deleted) return description(original, owner, item, null);
    const libraryURI = Zotero.URI.getLibraryURI(owner.libraryID);
    check(typeof libraryURI === 'string' && libraryURI.length > 0, 'Native library URI is unavailable', 'endpoint');
    const visited = new Set();
    for (let hop = 0; hop < MAX_ALIAS_HOPS; hop++) {
      if (visited.has(key)) throw new ContractError('endpoint', 'Cyclic native merge aliases', { ref: original });
      visited.add(key);
      const candidates = await Zotero.Relations.getByPredicateAndObject('item', Zotero.Relations.replacedItemPredicate,
        `${libraryURI}/items/${key}`);
      check(Array.isArray(candidates), 'Native merge lookup returned invalid candidates', 'endpoint');
      const aliases = candidates.filter(candidate => candidate.libraryID === owner.libraryID);
      if (aliases.length > 1) return description(original, owner, null, 'ambiguous');
      if (!aliases.length) return description(original, owner, item, item ? null : 'missing');
      item = aliases[0]; key = item.key;
      if (!item.deleted) return description(original, owner, item, null);
    }
    throw new ContractError('limit', 'Native merge alias lookup limit exceeded', { ref: original, limit: MAX_ALIAS_HOPS });
  };
}
