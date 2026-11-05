/** Native regular-reference picker with exact library restriction and explicit cancellation. */
import { check } from '../domain/values.mjs';

/**
 * Open the supported native picker and track only this plugin's dialog for teardown.
 * The opposite endpoint anchors library/exclusion only; it may be unavailable during repair.
 * Full pair eligibility is enforced by application preview and its native transaction guard.
 * @param {object} options Actual {Zotero,gateway,window,source,dialogs}; source is the opposite endpoint anchor.
 * @returns {Promise<object|null>} Exact selected ItemRef or null on user cancellation.
 */
export async function chooseReference({ Zotero, gateway, window, source, dialogs }) {
  const owner = gateway.library(source.library);
  const io = { dataIn: null, dataOut: null, deferred: Zotero.Promise.defer(),
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
    const target = gateway.ref(item);
    check(target.library === source.library && target.key !== source.key,
      'Choose a different reference in the same library');
    await gateway.assertWritable(source.library, [target]);
    return target;
  } finally { dialogs.delete(dialog); }
}
