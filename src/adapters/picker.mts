/** Native regular-reference picker with exact library restriction and explicit cancellation. */
import { check } from '../domain/values.mts';
import type { ItemRef } from '../domain/contracts.mts';
import type { ItemGateway, NativeWindow, PickerData, ZoteroPlatform } from './native-contracts.mts';

/** Shared actual dialog resources contain no invented opposite endpoint or application eligibility policy. */
interface ReferenceDialogOptions {
  Zotero: ZoteroPlatform; gateway: ItemGateway; window: NativeWindow; library: string; dialogs: Set<NativeWindow>;
}

/**
 * Open the real native dialog for an explicit library, tracking only the caller's owned window.
 * @param {object} options Actual native platform, gateway, owning window, explicit library and dialog set.
 * @returns {Promise<object|null>} Exact regular ItemRef or null on native cancellation; eligibility belongs to outer callers.
 */
async function nativeReferenceDialog({ Zotero, gateway, window, library, dialogs }: ReferenceDialogOptions): Promise<ItemRef | null> {
  const owner = gateway.library(library);
  const io: PickerData = { dataIn: null, dataOut: null, deferred: Zotero.Promise.defer(),
    itemTreeID: 'reference-relationships-select-target', filterLibraryIDs: [owner.libraryID],
    singleSelection: true, multiSelect: false, onlyRegularItems: true };
  const dialog = window.openDialog('chrome://zotero/content/selectItemsDialog.xhtml', '',
    'chrome,dialog=no,centerscreen,resizable=yes', io);
  dialogs.add(dialog);
  try {
    await io.deferred.promise;
    if (!io.dataOut || io.dataOut.length === 0) return null;
    check(io.dataOut.length === 1, 'Choose one target reference');
    const item = await Zotero.Items.getAsync(io.dataOut[0]);
    return gateway.ref(item);
  } finally { dialogs.delete(dialog); }
}

/**
 * Choose an ordinary relationship endpoint; the opposite endpoint anchors library/exclusion and may be unavailable during repair.
 * Full pair eligibility remains enforced by application preview and its native transaction guard.
 * @param {object} options Actual native resources, opposite source ItemRef and owned dialogs.
 * @returns {Promise<object|null>} Different writable regular reference in the same library, or native cancellation.
 */
export async function chooseReference({ source, ...options }: Omit<ReferenceDialogOptions, 'library'> & { source: ItemRef }): Promise<ItemRef | null> {
  const target = await nativeReferenceDialog({ ...options, library: source.library });
  if (target === null) return null;
  check(target.library === source.library && target.key !== source.key, 'Choose a different reference in the same library');
  await options.gateway.assertWritable(source.library, [target]); return target;
}

/**
 * Choose a mapped endpoint using only the explicit target library; no opposite key is invented or excluded.
 * @param {object} options Actual native resources, selected target library and owned dialogs.
 * @returns {Promise<object|null>} Exact currently writable regular target ItemRef, or native cancellation.
 */
export async function chooseMappedReference(options: ReferenceDialogOptions): Promise<ItemRef | null> {
  const target = await nativeReferenceDialog(options); if (target === null) return null;
  check(target.library === options.library, 'Choose a reference in the selected target library');
  await options.gateway.assertWritable(options.library, [target]); return target;
}
