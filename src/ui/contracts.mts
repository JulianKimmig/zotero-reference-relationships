/** Shared native UI ownership, form and localization contracts, separate from stored graph authority. */
import type { RelationshipApplication } from '../application/service.mts';
import type { ItemGateway, NativeDocument, NativeWindow, ZoteroPlatform } from '../adapters/native-contracts.mts';

/** Synchronous lookup of previously resolved required Fluent messages. */
export type Localizer = (key: string) => string;
/** Lifecycle-owned listener/render resource. */
export interface Disposable { dispose(): void }
/** Actual editable HTML controls used by form locking and restoration. */
export type FormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;
/** Native view dependencies shared by item-pane and preference contexts. */
export interface CommonView {
  document: NativeDocument; window: NativeWindow; Zotero: ZoteroPlatform;
  app: RelationshipApplication; gateway: ItemGateway; t: Localizer; report(error: unknown): void;
}
/** Official item section composition resources, with independent refresh and dialog lifetimes. */
export interface ViewOptions extends Omit<CommonView, 'document' | 't'> {
  body: HTMLElement; dialogs: Set<NativeWindow>; refresh(): Promise<void>; openRules(library: string): Promise<void>;
}
/** Official preference fragment resources. */
export interface PreferencesOptions extends Omit<CommonView, 'document'> { root: HTMLElement }
/** A readonly rendering owner can show full impact without accessing editor internals. */
export type PreviewOwner = Pick<CommonView, 'document' | 'window' | 't' | 'app'>;
/** Resolved labels and actual HTML owner used by abortable localized controls. */
export interface ControlOwner { document: Document; t: Localizer; signal: AbortSignal }
