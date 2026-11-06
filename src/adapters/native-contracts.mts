/** Supported Zotero host objects used by the plugin; portable domain code must not import these contracts. */
import type { ApplicationGateway } from '../application/contracts.mts';
import type { ItemRef, LibraryScope } from '../domain/contracts.mts';
import type { RelationshipApplication } from '../application/service.mts';
import type { RuntimeBridge } from '../runtime/contracts.mts';

/** Native library instance identity also binds shared writers and invalidation caches. */
export interface NativeLibrary {
  libraryID: number; libraryType: string; editable: boolean; archived: boolean; name: string;
}
/** Actual bibliographic item or note; kind-specific access stays behind native predicates. */
export interface NativeItem {
  id: number; key: string; libraryID: number; deleted: boolean;
  isRegularItem(): boolean; isNote(): boolean; isTopLevelItem(): boolean; isEditable(): boolean;
  loadDataType(type: string): Promise<void>; getDisplayTitle(): string;
  getNote(): string; setNote(html: string): void; save(): Promise<number | boolean>;
}
/** Native promise deferred supplied to the supported reference selection dialog. */
export interface Deferred<T = void> { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void }
/** Dialog data is mutated by the real native picker before resolving its deferred. */
export interface PickerData {
  dataIn: null; dataOut: number[] | null; deferred: Deferred;
  itemTreeID: string; filterLibraryIDs: number[]; singleSelection: boolean; multiSelect: boolean; onlyRegularItems: boolean;
}
/** Native document localization API used for required Fluent labels. */
export interface NativeDocument extends Document {
  readonly defaultView: NativeWindow & typeof globalThis;
  l10n: { formatMessages(messages: { id: string }[]): Promise<({ value: string | null } | null)[]> };
}
/** Host windows provide native selection, XUL dialog and localization integration. */
export interface NativeWindow extends Window {
  readonly document: NativeDocument;
  AbortController: typeof AbortController;
  ZoteroPane: { selectItem(id: number): Promise<void> };
  MozXULElement: { insertFTLIfNeeded(path: string): void };
  openDialog(url: string, name: string, features: string, data: PickerData): NativeWindow;
}
/** Native custom elements expose section expansion and scrolling in official item-pane integration. */
export interface CollapsibleSection extends HTMLElement { open: boolean }
/** The enclosing native item details panel owns scroll position. */
export interface ItemDetails extends HTMLElement { scrollToPane(id: string, behavior: string): Promise<void> }
/** Official per-section lifecycle callback arguments. */
export interface SectionProps {
  tabType: string; item: NativeItem; body: HTMLElement; doc: NativeDocument;
  setEnabled(enabled: boolean): void; refresh(): Promise<void>;
}
/** Native menu selection context belongs to its official registration callback. */
export interface MenuContext { items: NativeItem[]; setVisible(value: boolean): void; setEnabled(value: boolean): void }
/** Native menu events carry a privileged owner window rather than a web-page global. */
export interface MenuEvent { target: { ownerGlobal: NativeWindow } }
/** Production host capabilities, including official extension registration surfaces. */
export interface ZoteroPlatform {
  Libraries: { userLibraryID: number; get(id: number): NativeLibrary | false; getAll(): NativeLibrary[] };
  Groups: { get(id: number): NativeLibrary | false; getGroupIDFromLibraryID(id: number): number };
  Items: {
    getByLibraryAndKeyAsync(libraryID: number, key: string): Promise<NativeItem | false>;
    getAsync(id: number): Promise<NativeItem | false>; getAll(libraryID: number, topLevel: boolean, deleted: boolean): Promise<NativeItem[]>;
  };
  Item: new (kind: string) => NativeItem;
  DB: { inTransaction(): boolean; executeTransaction<T>(action: () => Promise<T>): Promise<T> };
  Relations: { replacedItemPredicate: string; getByPredicateAndObject(kind: string, predicate: string, uri: string): Promise<NativeItem[]> };
  URI: { getLibraryURI(id: number): string };
  Users: { getCurrentUserID(): number | null | undefined; getLocalUserKey(): string };
  Promise: { defer<T = void>(): Deferred<T>; delay(milliseconds: number): Promise<void> };
  debug(message: string): void; logError(error: unknown): void; getMainWindows(): NativeWindow[];
  ItemPaneManager: {
    registerSection(options: {
      paneID: string; pluginID: string; header: { l10nID: string; icon: string }; sidenav: { l10nID: string; icon: string };
      onInit(props: SectionProps): void; onDestroy(props: SectionProps): void; onItemChange(props: SectionProps): void;
      onRender(props: SectionProps): void; onAsyncRender(props: SectionProps): Promise<void> | undefined;
    }): string;
    unregisterSection(id: string): void;
  };
  MenuManager: {
    registerMenu(options: { menuID: string; pluginID: string; target: string; menus: {
      menuType: string; l10nID: string; icon: string;
      onShowing(event: MenuEvent, context: MenuContext): void; onCommand(event: MenuEvent, context: MenuContext): void;
    }[] }): string;
    unregisterMenu(id: string): void;
  };
  Notifier: { registerObserver(observer: { notify(event: string, type: string, ids: number[], extraData?: Record<string, unknown>): void }, kinds: string[], id: string): string; unregisterObserver(id: string): void };
  PreferencePanes: {
    register(options: { pluginID: string; id: string; label: string; src: string; image: string }): Promise<string>;
    unregister(id: string): void;
  };
  Utilities: { Internal: { openPreferences(id: string): NativeWindow } };
  ReferenceRelationships?: RuntimeBridge;
}
/** Native gateway adds actual owner lookup and navigation to the application port. */
export interface ItemGateway extends ApplicationGateway {
  resolve(input: ItemRef): Promise<import('../application/contracts.mts').EndpointInspection>;
  library(scope: string): NativeLibrary; scope(libraryID: number): LibraryScope;
  navigate(window: NativeWindow, input: ItemRef): Promise<void>;
}
/** Explicit composition supplies constructors from the native compartment. */
export interface HostResources {
  Zotero: ZoteroPlatform; DOMParser: typeof DOMParser; crypto: Crypto; TextEncoder: typeof TextEncoder;
}
