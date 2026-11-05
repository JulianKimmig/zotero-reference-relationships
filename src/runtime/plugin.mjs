/** Compose the real native application and official UI registration behind stable lifecycle hooks. */
import { RelationshipApplication } from '../application/service.mjs';
import { createItemGateway } from '../adapters/items.mjs';
import { createRepositoryFactory } from '../adapters/repositories.mjs';
import { registerInterface } from '../ui/registration.mjs';

/**
 * Create one plugin generation with required native resources and no hidden globals.
 * @param {object} options Actual addon identity/root plus {Zotero,DOMParser,crypto,TextEncoder}.
 * @returns {object} Application and addWindow/removeWindow/stop lifecycle hooks.
 */
export function createPlugin({ id, rootURI, Zotero, DOMParser, crypto, TextEncoder }) {
  const gateway = createItemGateway(Zotero);
  const repositories = createRepositoryFactory({ Zotero, DOMParser, crypto, TextEncoder, gateway });
  const application = new RelationshipApplication({ gateway, repositoryFor: repositories.repositoryFor,
    repositoryForEvent: repositories.repositoryForEvent,
    now: () => new Date().toISOString(), newID: () => crypto.randomUUID() });
  const ui = registerInterface({ Zotero, id, rootURI, application, gateway, report: error => Zotero.logError(error) });
  /** Release service/transport ownership after official UI teardown. @returns {void} */
  function stop() { ui.stop(); application.stop(); repositories.clear(); }
  return { application, paneID: ui.paneID, addWindow: ui.addWindow, removeWindow: ui.removeWindow, stop };
}
