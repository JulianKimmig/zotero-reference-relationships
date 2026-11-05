/** Native library/item resolution and commit-time bibliographic eligibility checks. */
import { ContractError, check } from '../domain/values.mts';
import { validateItemRef } from '../domain/graph-contract.mts';
import { createEndpointResolver, createEndpointInspector } from './resolve-endpoints.mts';
import type { ItemGateway, NativeItem, NativeLibrary, NativeWindow, ZoteroPlatform } from './native-contracts.mts';
import type { ItemRef, LibraryScope } from '../domain/contracts.mts';

/**
 * Bind native Zotero item operations without writing reference fields or Related links.
 * @param {object} Zotero Actual supported native platform object.
 * @returns {object} Scope/ref/resolve/inspect/describe/assertWritable/navigate gateway; inspect preserves unresolved alias states without selecting targets.
 */
export function createItemGateway(Zotero: ZoteroPlatform): ItemGateway {
  /** Resolve the actual containing library. @param {string} scope Portable scope. @returns {object} Native library. */
  function library(scope: string): NativeLibrary {
    validateItemRef({ library: scope, key: 'AAAAAAAA' });
    const value = scope === 'self' ? Zotero.Libraries.get(Zotero.Libraries.userLibraryID)
      : Zotero.Groups.get(Number(scope.slice(6)));
    check(!!value, 'The reference library is unavailable', 'endpoint');
    return value;
  }

  /** Map a native library ID to its owner-relative scope. @param {number} libraryID Native lookup aid. @returns {string} Portable scope. */
  function scope(libraryID: number): LibraryScope {
    const value = Zotero.Libraries.get(libraryID);
    check(!!value && ['user', 'group'].includes(value.libraryType), 'Only personal and group libraries are supported', 'endpoint');
    return value.libraryType === 'user' ? 'self' : `group:${Zotero.Groups.getGroupIDFromLibraryID(libraryID)}`;
  }

  /** Resolve exact identity for an actual regular reference. @param {object} item Native Zotero.Item. @returns {object} ItemRef. */
  function ref(item: Pick<NativeItem, 'libraryID' | 'key' | 'isRegularItem'> | false | null): ItemRef {
    check(!!item && item.isRegularItem(), 'Choose a regular bibliographic reference', 'endpoint');
    return validateItemRef({ library: scope(item.libraryID), key: item.key });
  }

  /** Describe actual endpoint availability and editability without inventing a replacement. @param {object} input ItemRef. @returns {Promise<object>} Detached label/status. */
  async function describe(input: ItemRef) {
    const result = await inspect(input);
    return { ref: result.original, title: result.title, status: result.status, editable: result.editable };
  }

  /** Check current ownership and every changed active bibliographic endpoint inside the write transaction. @param {string} ownerScope Scope. @param {object[]} references Added/updated endpoint refs; removed assertions need only library permission. @returns {Promise<void>} */
  async function assertWritable(ownerScope: string, references: ItemRef[]): Promise<void> {
    const owner = library(ownerScope);
    check(owner.editable && !owner.archived, 'This library is read-only', 'permission');
    for (const input of references) {
      const reference = validateItemRef(input);
      check(reference.library === ownerScope, 'References must belong to the same library');
      const description = await describe(reference);
      if (description.status !== 'active') throw new ContractError('endpoint', 'Choose an available regular bibliographic reference', { ref: reference, status: description.status });
      check(description.editable, 'A selected reference is not editable', 'permission');
    }
  }

  /** Navigate through native selection APIs to the exact active reference/library. @param {Window} window Real main window. @param {object} input ItemRef. @returns {Promise<void>} */
  async function navigate(window: NativeWindow, input: ItemRef): Promise<void> {
    const result = await resolve(input), owner = library(result.original.library);
    check(result.status === 'active', 'This reference is unavailable', 'endpoint');
    const item = await Zotero.Items.getByLibraryAndKeyAsync(owner.libraryID, result.resolved.key);
    await window.ZoteroPane.selectItem((item as NativeItem).id);
  }

  const resolve = createEndpointResolver({ Zotero, library });
  const inspect = createEndpointInspector({ Zotero, library });
  return { library, scope, ref, resolve, inspect, describe, assertWritable, navigate };
}
