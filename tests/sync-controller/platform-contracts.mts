/** Privileged native test capabilities extending the production host surface with real fixture and GUI operations. */
import type { NativeItem, NativeLibrary, NativeWindow, ZoteroPlatform } from '../../src/adapters/native-contracts.mts';

/** Actual saved bibliographic/note fixtures expose native mutations used by lifecycle acceptance. */
export interface TestItem extends NativeItem {
  version: number; synced: boolean; parentID: number | false; parentKey: string | false; relatedItems: string[];
  setField(field: string, value: string | number): void; getField(field: string): string;
  saveTx(options?: { skipNotifier?: boolean }): Promise<number | boolean>; eraseTx(): Promise<void>; loadPrimaryData(): Promise<void>;
  clone(libraryID?: number): TestItem; addRelatedItem(item: TestItem): void;
  addRelation(predicate: string, uri: string): void; removeRelation(predicate: string, uri: string): void;
  getNotes(): number[]; getLinkedItem(libraryID: number, bidirectional: boolean): Promise<TestItem | false>;
  getRelations(): Record<string, string[]>;
}
/** Anonymous local group fixtures are actual database libraries, never fabricated server memberships. */
export interface TestLibrary extends NativeLibrary { groupID: number; saveTx(): Promise<number | boolean>; erase(): Promise<void>; eraseTx(): Promise<void> }
/** Real item/collection trees are awaited through their load APIs. */
export interface NativeTree {
  initialized: boolean; rowCount: number; collectionTreeRows: { id: number; ref: TestItem }[];
  getRowIndexByID(id: string): number | false;
  getRow(index: number): { ref: { libraryID: number } };
  _copyItem(options: { item: TestItem; targetLibraryID: number; targetTreeRow: { ref: { libraryID: number } }; options: { tags: boolean; childNotes: boolean; childLinks: boolean; childFileAttachments: boolean; annotations: boolean } }): Promise<number>;
  waitForLoad(): Promise<void>; selectItem(id: number): Promise<boolean>;
  getSortedItems(asIDs: true): number[]; getSelectedItems(asIDs: true): number[];
}
/** XUL dialogs/popups provide APIs absent from web HTMLElement. */
export interface XULPopup extends HTMLElement { openPopupAtScreen(x: number, y: number, context: boolean): void; hidePopup(): void; open: boolean }
/** Real native menu entry, invoked only after visibility and permission checks. */
export interface XULMenu extends HTMLElement { disabled: boolean; doCommand(): void }
/** Native dialog acceptance is owned by its XUL root. */
export interface XULDialog extends HTMLElement { acceptDialog(): void }
/** Actual note editor instance exercised by the native serialization experiment. */
export interface NativeEditor {
  _initPromise: Promise<void>; _tabID: string | false;
  _iframeWindow: { wrappedJSObject: { getDataSync(save: boolean): { html: string } } };
  _save(snapshot: { html: string }): Promise<void>;
}
/** Test windows expose the real native tree APIs and compartment constructors. */
export interface TestWindow extends NativeWindow {
  DOMParser: typeof DOMParser; TextEncoder: typeof TextEncoder; Event: typeof Event; MutationObserver: typeof MutationObserver; loaded: boolean;
  itemsView: NativeTree; collectionsView: NativeTree;
  Zotero_Tabs: { close(id: string): void };
  ZoteroPane: NativeWindow['ZoteroPane'] & { loaded: boolean; itemsView: NativeTree; collectionsView: NativeTree; buildItemContextMenu(): Promise<void>; getSelectedItems(): TestItem[] };
}
/** Actual Gecko addon instance, including asynchronous lifecycle changes. */
export interface NativeAddon {
  id: string; isActive: boolean; updateURL: string;
  enable(): Promise<void>; disable(): Promise<void>; uninstall(): Promise<void>;
}
/** Real native addon manager module capabilities. */
export interface AddonManagerModule {
  AddonManager: { installTemporaryAddon(file: object): Promise<NativeAddon>; getAddonByID(id: string): Promise<NativeAddon | null> };
}
/** Real non-secret native client state required by the dedicated test controller. */
export interface TestPlatform extends ZoteroPlatform {
  version: string; initializationPromise: Promise<void>; uiReadyPromise: Promise<void>;
  Profile: { dir: string }; DataDirectory: { dir: string };
  Item: new (kind: string) => TestItem;
  Group: new (options: { groupID: number; name: string; description: string; version: number; editable: boolean; filesEditable: boolean }) => TestLibrary;
  Items: Omit<ZoteroPlatform['Items'], 'getAll' | 'getAsync' | 'getByLibraryAndKeyAsync'> & {
    getByLibraryAndKeyAsync(libraryID: number, key: string): Promise<TestItem | false>;
    getAsync(id: number): Promise<TestItem | false>; getAll(libraryID: number, topLevel?: boolean, deleted?: boolean): Promise<TestItem[]>;
  };
  Libraries: Omit<ZoteroPlatform['Libraries'], 'get' | 'getAll'> & { get(id: number): TestLibrary | false; getAll(): TestLibrary[] };
  Groups: Omit<ZoteroPlatform['Groups'], 'get'> & { get(id: number): TestLibrary | false };
  DB: ZoteroPlatform['DB'] & { waitForTransaction(): Promise<void>; valueQueryAsync(query: string, values?: (string | number)[]): Promise<number> };
  URI: ZoteroPlatform['URI'] & { getItemURI(item: NativeItem): string };
  Promise: ZoteroPlatform['Promise'] & { delay(milliseconds: number): Promise<void> };
  PreferencePanes: ZoteroPlatform['PreferencePanes'] & { pluginPanes: { id: string }[] };
  Utilities: Omit<ZoteroPlatform['Utilities'], 'Internal'> & { isValidObjectKey(key: string): boolean; Internal: Omit<ZoteroPlatform['Utilities']['Internal'], 'openPreferences'> & { quit(): void; openPreferences(paneID: string): TestWindow } };
  File: { pathToFile(path: string): object }; Plugins: { getRootURI(id: string): Promise<string> };
  DataObjectUtilities: { generateKey(): string }; Prefs: { get(key: string): string | number | boolean };
  Sync: { Runner: { syncInProgress: boolean; sync(options: { background: boolean; libraries: number[]; fileLibraries: number[]; fullTextLibraries: number[]; onError(error: Error): void }): Promise<boolean | void> } };
  UndoHistory: { undo(): Promise<void>; redo(): Promise<void> };
  Notes: { open(itemID: number): Promise<NativeEditor> }; Debug: { setStore(enabled: boolean): void; get(): string };
  getMainWindow(): TestWindow; getMainWindows(): TestWindow[]; openMainWindow(): void;
}
/** Actual privileged service registry passed to test modules, with no credential access. */
export interface NativeServices {
  io: { offline: boolean; getProtocolHandler(protocol: string): { QueryInterface(id: object): { setSubstitution(name: string, uri: { spec: string } | null): void } }; newURI(uri: string): { spec: string } };
  prefs: { getStringPref(key: string): string }; startup: { eForceQuit: number; quit(flags: number): void };
  uuid: { generateUUID(): { toString(): string } }; scriptloader: { loadSubScript(uri: string, scope: object): void };
  wm: { getEnumerator(type: string | null): Iterable<TestWindow> }; console: { getMessageArray(): { message: string }[] };
}
