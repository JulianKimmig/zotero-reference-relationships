/** Compose the real native application and official UI registration behind stable lifecycle hooks. */
import { RelationshipApplication } from '../application/service.mts';
import { createItemGateway } from '../adapters/items.mts';
import { createRepositoryFactory } from '../adapters/repositories.mts';
import { registerInterface } from '../ui/registration.mts';
import { createPreferences } from '../ui/preferences.mts';
import { createTransferFiles } from '../adapters/transfer-files.mts';
import { createTransferPicker } from '../adapters/transfer-picker.mts';
import { createTransferIdentity } from '../adapters/transfer-identity.mts';
import { TransferService } from '../transfer/service.mts';
import type { HostResources } from '../adapters/native-contracts.mts';
import type { TransferFileIO } from '../transfer/file-contracts.mts';
import type { NativeFilePickerConstructor } from '../adapters/transfer-picker.mts';

/**
 * Create one plugin generation with required native resources and no hidden globals.
 * @param {object} options Actual addon identity/root plus native platform, crypto, IOUtils and FilePicker resources.
 * @returns {object} Application and addWindow/removeWindow/stop lifecycle hooks.
 */
export function createPlugin({ id, rootURI, Zotero, DOMParser, crypto, TextEncoder, IOUtils, FilePicker }: HostResources & {
  id: string; rootURI: string; IOUtils: TransferFileIO; FilePicker: NativeFilePickerConstructor;
}) {
  const gateway = createItemGateway(Zotero);
  const repositories = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway });
  const application = new RelationshipApplication({ gateway, repositoryFor: repositories.repositoryFor,
    repositoryForEvent: repositories.repositoryForEvent,
    digest: repositories.digest,
    now: () => new Date().toISOString(), newID: () => crypto.randomUUID(), yieldToHost: () => Zotero.Promise.delay(0) });
  const report = (error: unknown) => Zotero.logError(error);
  const identity = createTransferIdentity({ Zotero, gateway }), files = createTransferFiles({ io: IOUtils, digest: repositories.digest });
  const picker = createTransferPicker(FilePicker);
  const transfer = new TransferService({ gateway, identity, files, repositoryFor: repositories.repositoryFor,
    repositoryForEvent: repositories.repositoryForEvent, digest: repositories.digest, now: () => new Date().toISOString(),
    invalidate: scope => application.invalidate(scope), yieldToHost: () => Zotero.Promise.delay(0) });
  const preferences = createPreferences({ Zotero, id, rootURI, app: application, gateway, report, transfer, identity, files, picker });
  const ui = registerInterface({ Zotero, id, rootURI, application, gateway, report,
    openRules: library => preferences.open(library), onNativeChange: () => preferences.nativeChange() });
  /** Release service/transport ownership after official UI teardown. @returns {void} */
  function stop() { preferences.stop(); ui.stop(); transfer.stop(); application.stop(); repositories.clear(); }
  return { application, transfer, preferences, paneID: ui.paneID, addWindow: ui.addWindow, removeWindow: ui.removeWindow, stop };
}
