/** Read-only bounded native merge resolution; original graph keys and merge relations remain untouched. */
import { ContractError, check } from '../domain/values.mts';
import { validateItemRef } from '../domain/graph-contract.mts';
import type { ItemRef } from '../domain/contracts.mts';
import type { EndpointInspection } from '../application/contracts.mts';
import type { NativeItem, NativeLibrary, ZoteroPlatform } from './native-contracts.mts';

/** Resolver dependencies bind portable scope to the actual current library object. */
interface ResolverOptions { Zotero: ZoteroPlatform; library(scope: string): NativeLibrary }

const MAX_ALIAS_HOPS = 64;

/** Bind complete read-only native inspection without choosing ambiguous or cyclic targets. @param {object} options {Zotero,library}; library resolves an available native owner by portable scope. @returns {Function} Async inspect(ItemRef), including explicit cyclic/alias-limit observations. */
export function createEndpointInspector({ Zotero, library }: ResolverOptions) {
  check(!!Zotero && typeof library === 'function', 'Native endpoint resolver dependencies are required');

  /** Describe a real terminal item, loading native bibliographic title data before synchronous display access. @param {object} original Valid original ItemRef. @param {object} owner Current native library/group. @param {object|null} item Resolved actual item or none. @param {string|null} unavailable Explicit unavailable state or null for actual item classification. @returns {Promise<object>} {original,resolved,status,title,editable}. */
  async function description(original: ItemRef, owner: NativeLibrary, item: NativeItem | false | null, unavailable: 'missing' | 'ambiguous' | 'cyclic' | 'alias-limit' | null): Promise<EndpointInspection> {
    if (unavailable) {
      const titles = { missing: 'Missing', ambiguous: 'Ambiguous', cyclic: 'Cyclic alias for', 'alias-limit': 'Alias lookup limit for' };
      return { original, resolved: null, status: unavailable, title: `${titles[unavailable]} reference ${original.key}`, editable: false };
    }
    check(!!item, 'Native terminal item is unavailable', 'endpoint');
    if (item.isRegularItem()) await item.loadDataType('itemData');
    const status = !item.isRegularItem() ? 'unsupported' : item.deleted ? 'trashed' : 'active';
    return { original, resolved: { library: original.library, key: item.key }, status, title: item.getDisplayTitle(),
      editable: status === 'active' && owner.editable && !owner.archived && item.isEditable() };
  }

  /**
   * Prefer an active original, including after Undo, then follow unique same-library native aliases.
   * Ambiguity, cycles and more than 64 alias lookups are explicit unavailable states.
   * URI lookup is rebuilt from the current native library owner so first-login migration is not cached.
   * @param {object} input Exact original {library,key}.
   * @returns {Promise<object>} Detached {original,resolved,status,title,editable}; no persistence or fallback.
   */
  return async function inspect(input: ItemRef): Promise<EndpointInspection> {
    const original = validateItemRef(input), owner = library(original.library);
    let item = await Zotero.Items.getByLibraryAndKeyAsync(owner.libraryID, original.key), key = original.key;
    if (item && !item.deleted) return description(original, owner, item, null);
    const libraryURI = Zotero.URI.getLibraryURI(owner.libraryID);
    check(typeof libraryURI === 'string' && libraryURI.length > 0, 'Native library URI is unavailable', 'endpoint');
    const visited = new Set<string>();
    for (let hop = 0; hop < MAX_ALIAS_HOPS; hop++) {
      if (visited.has(key)) return description(original, owner, null, 'cyclic');
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
    return description(original, owner, null, 'alias-limit');
  };
}

/** Preserve strict resolution errors while sharing exactly the same bounded native inspection. @param {object} options Actual {Zotero,library}. @returns {Function} Async resolve(ItemRef), throwing for cyclic/over-limit aliases. */
export function createEndpointResolver(options: ResolverOptions) {
  const inspect = createEndpointInspector(options);
  /** Resolve an endpoint under the existing strict resolver contract. @param {object} input Original ItemRef. @returns {Promise<object>} Native description or visible strict failure. */
  return async function resolve(input: ItemRef): Promise<EndpointInspection> {
    const result = await inspect(input);
    if (result.status === 'cyclic') throw new ContractError('endpoint', 'Cyclic native merge aliases', { ref: result.original });
    if (result.status === 'alias-limit') throw new ContractError('limit', 'Native merge alias lookup limit exceeded', { ref: result.original, limit: MAX_ALIAS_HOPS });
    return result;
  };
}
