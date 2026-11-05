/** Official Zotero section/menu registration and per-window localization ownership. */
import { check } from '../domain/values.mts';
import { RelationshipView } from './view.mts';
import type { CollapsibleSection, ItemDetails, ItemGateway, NativeItem, NativeWindow, SectionProps, ZoteroPlatform } from '../adapters/native-contracts.mts';
import type { RelationshipApplication } from '../application/service.mts';

/**
 * Register official native extension points, with explicit teardown and shared application.
 * @param {object} options Actual {Zotero,id,rootURI,application,gateway,report,openRules,onNativeChange} resources.
 * @returns {object} Window lifecycle hooks and owned section identifier.
 */
export function registerInterface({ Zotero, id, rootURI, application, gateway, report, openRules, onNativeChange }: {
  Zotero: ZoteroPlatform; id: string; rootURI: string; application: RelationshipApplication; gateway: ItemGateway;
  report(error: unknown): void; openRules(library: string): Promise<void>; onNativeChange(): void;
}) {
  const views = new Map<HTMLElement, RelationshipView>(), windows = new Set<NativeWindow>(), dialogs = new Set<NativeWindow>();
  let stopped = false;
  const paneID = 'reference-relationships', icon = rootURI + 'src/ui/relationships.svg';
  /** Determine whether the official section applies to the current selection. @param {object} props Native section args. @returns {boolean} Eligible library item. */
  function eligible(props: SectionProps): boolean {
    const library = props.item && Zotero.Libraries.get(props.item.libraryID);
    return props.tabType === 'library' && !!props.item && props.item.isRegularItem()
      && !!library && ['user', 'group'].includes(library.libraryType);
  }
  const registeredPane = Zotero.ItemPaneManager.registerSection({
    paneID, pluginID: id,
    header: { l10nID: 'reference-relationships-section', icon },
    sidenav: { l10nID: 'reference-relationships-sidenav', icon },
    /** Own one native section view. @param props Mounted section resources. @returns Completion. */
    onInit(props) {
      views.set(props.body, new RelationshipView({ body: props.body, window: props.doc.defaultView,
        Zotero, app: application, gateway, dialogs, refresh: props.refresh, report, openRules }));
    },
    /** Release a removed section. @param body Native section root. @returns Completion. */
    onDestroy({ body }) { const view = views.get(body); if (view) view.dispose(); views.delete(body); },
    /** Apply native selection eligibility. @param props Current selection and section controls. @returns Completion. */
    onItemChange(props) { const enabled = eligible(props); props.setEnabled(enabled); views.get(props.body)?.select(enabled ? props.item : null); },
    /** Render the immediate selection skeleton. @param props Current native section. @returns Completion. */
    onRender(props) { if (eligible(props)) { const view = views.get(props.body)!; view.select(props.item); view.skeleton(); } },
    /** Load the eligible relationship view. @param props Current native section. @returns Pending render if eligible. */
    onAsyncRender(props) { if (eligible(props)) return views.get(props.body)!.render(); },
  });
  check(!!registeredPane, 'Native relationship section registration failed', 'storage');

  /** Open an editor through supported native selection/section refresh. @param {Window} window Actual main window. @param {object} item Selected native item. @returns {Promise<void>} */
  async function open(window: NativeWindow, item: NativeItem): Promise<void> {
    await window.ZoteroPane.selectItem(item.id);
    const entry = [...views.values()].find(view => view.window === window && view.item?.id === item.id);
    check(!!entry, 'Relationships section is unavailable', 'endpoint');
    const section = entry.body.closest('item-pane-custom-section')!;
    section.querySelector<CollapsibleSection>('collapsible-section')!.open = true;
    await section.closest<ItemDetails>('item-details')!.scrollToPane(registeredPane, 'instant');
    await entry.refresh(); await entry.openEditor('create', null);
  }
  const registeredMenu = Zotero.MenuManager.registerMenu({ menuID: 'reference-relationships-add', pluginID: id,
    target: 'main/library/item', menus: [{ menuType: 'menuitem', l10nID: 'reference-relationships-add-menu', icon,
      /** Show creation for editable regular items. @param event Native menu event. @param context Selected items and menu controls. @returns Completion. */
    onShowing(event, context) {
        const valid = context.items.length === 1 && context.items[0].isRegularItem();
        context.setVisible(valid); context.setEnabled(valid && context.items[0].isEditable());
      },
      /** Open creation for the selected reference. @param event Owning native window event. @param context Native selection. @returns Completion. */
    onCommand(event, context) { open(event.target.ownerGlobal, context.items[0]).catch(report); },
    }] });
  check(!!registeredMenu, 'Native relationship menu registration failed', 'storage');
  const observer = Zotero.Notifier.registerObserver({
    /** Invalidate views after native item or group notifications. @returns Completion. */
    notify() {
      if (stopped) return;
      application.invalidateAll();
      onNativeChange();
      for (const view of views.values()) if (view.item && !view.disposed) view.nativeChange();
    },
  }, ['item', 'group'], 'reference-relationships-ui');

  /** Insert owned Fluent resources before native section localization. @param {Window} window Main window. @returns {void} */
  function addWindow(window: NativeWindow): void {
    window.MozXULElement.insertFTLIfNeeded('reference-relationships.ftl'); windows.add(window);
  }
  /** Release a closing window without touching other addons' nodes. @param {Window} window Closing main window. @returns {void} */
  function removeWindow(window: NativeWindow): void {
    for (const [body, view] of views) if (view.window === window) { view.dispose(); views.delete(body); }
    window.document.querySelector('link[rel="localization"][href="reference-relationships.ftl"]')?.remove();
    windows.delete(window);
  }
  /** Remove all native hooks, owned dialogs and view/window references. @returns {void} */
  function stop() {
    if (stopped) return; stopped = true;
    Zotero.Notifier.unregisterObserver(observer);
    Zotero.MenuManager.unregisterMenu(registeredMenu); Zotero.ItemPaneManager.unregisterSection(registeredPane);
    for (const dialog of dialogs) if (!dialog.closed) dialog.close(); dialogs.clear();
    for (const window of [...windows]) removeWindow(window);
    for (const view of views.values()) view.dispose(); views.clear();
  }
  return { paneID: registeredPane, addWindow, removeWindow, stop };
}
