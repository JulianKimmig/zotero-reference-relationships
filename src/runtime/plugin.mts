/** Compose the real native application and official UI registration behind stable lifecycle hooks. */
import { RelationshipApplication } from '../application/service.mts';
import { createItemGateway } from '../adapters/items.mts';
import { createRepositoryFactory } from '../adapters/repositories.mts';
import { registerInterface } from '../ui/registration.mts';
import { createPreferences } from '../ui/preferences.mts';
import type { HostResources } from '../adapters/native-contracts.mts';

/**
 * Create one plugin generation with required native resources and no hidden globals.
 * @param {object} options Actual addon identity/root plus {Zotero,DOMParser,crypto,TextEncoder}.
 * @returns {object} Application and addWindow/removeWindow/stop lifecycle hooks.
 */
export function createPlugin({ id, rootURI, Zotero, DOMParser, crypto, TextEncoder }: HostResources & { id: string; rootURI: string }) {
  const gateway = createItemGateway(Zotero);
  const repositories = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway });
  const application = new RelationshipApplication({ gateway, repositoryFor: repositories.repositoryFor,
    repositoryForEvent: repositories.repositoryForEvent,
    digest: repositories.digest,
    now: () => new Date().toISOString(), newID: () => crypto.randomUUID() });
  const report = (error: unknown) => Zotero.logError(error);
  const preferences = createPreferences({ Zotero, id, rootURI, app: application, gateway, report });
  const ui = registerInterface({ Zotero, id, rootURI, application, gateway, report,
    openRules: library => preferences.open(library), onNativeChange: () => preferences.nativeChange() });
  /** Release service/transport ownership after official UI teardown. @returns {void} */
  function stop() { preferences.stop(); ui.stop(); application.stop(); repositories.clear(); }
  return { application, preferences, paneID: ui.paneID, addWindow: ui.addWindow, removeWindow: ui.removeWindow, stop };
}
