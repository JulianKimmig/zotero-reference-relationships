/** Actual containing-library and account ownership for portable exports and generation-local native import guards. */
import { check } from '../domain/values.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { validateSourceOwner } from '../transfer/format.mts';
import type { ItemGateway, ZoteroPlatform } from './native-contracts.mts';

/** Bind owner reads to actual supported Zotero APIs without consulting authentication storage. @param {object} options Actual {Zotero,gateway} resources. @returns {object} {read,capture}; capture yields detached owner and private-native assertCurrent closure. */
export function createTransferIdentity({ Zotero, gateway }: { Zotero: ZoteroPlatform; gateway: ItemGateway }) {
  check(!!Zotero && typeof gateway?.library === 'function' && typeof gateway?.scope === 'function', 'Explicit native ownership resources required');

  /** Resolve actual portable ownership and the live library instance; names and local numeric IDs are not exported. @param {string} scope Explicit personal/group scope. @returns {object} Internal {owner,library} with actual native library. */
  function current(scope: string) {
    const native = gateway.library(scope), library = Zotero.Libraries.get(native.libraryID);
    check(!!library && gateway.scope(library.libraryID) === scope, 'Native transfer owner is unavailable', 'endpoint');
    let owner;
    if (scope === 'self') {
      const userID = Zotero.Users.getCurrentUserID();
      owner = userID === undefined || userID === null
        ? { kind: 'local-user', id: Zotero.Users.getLocalUserKey() } : { kind: 'user', id: String(userID) };
    } else owner = { kind: 'group', id: String(Zotero.Groups.getGroupIDFromLibraryID(library.libraryID)) };
    return { owner: validateSourceOwner(owner, scope), library };
  }

  /** Read a detached canonical owner from actual account/library state; read-only export does not require write permission. @param {string} scope Explicit selected scope. @returns {object} Exact portable {kind,id}. */
  function read(scope: string) { return current(scope).owner; }

  /** Capture live library identity and portable owner separately from a caller-mutable display copy. @param {string} scope Explicit selected scope. @returns {object} {owner,assertCurrent}; assertions reject account or removed/replaced library ownership changes. */
  function capture(scope: string) {
    const captured = current(scope), signature = canonicalJSON(captured.owner), libraryID = captured.library.libraryID;
    /** Require this exact native owner again before use and under the eventual owned write lock. @returns {void} Throws conflict on changed ownership; permission is checked separately. */
    function assertCurrent() {
      check(Zotero.Libraries.get(libraryID) === captured.library, 'Native transfer library changed; review again', 'conflict');
      const observed = current(scope);
      check(observed.library === captured.library && canonicalJSON(observed.owner) === signature, 'Transfer owner changed; review again', 'conflict');
    }
    return { owner: validateSourceOwner(captured.owner, scope), assertCurrent };
  }
  return { read, capture };
}
