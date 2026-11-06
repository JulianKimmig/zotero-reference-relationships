/** Native transfer path selection with explicit cancellation and refusal to replace existing output. */
import { check } from '../domain/values.mts';
import type { NativeWindow } from './native-contracts.mts';

/** Supported Zotero FilePicker instance surface; the bootstrap supplies the actual native constructor. */
export interface NativeFilePicker {
  readonly modeOpen: number;
  readonly modeSave: number;
  readonly returnOK: number;
  readonly returnCancel: number;
  readonly returnReplace: number;
  file: string;
  defaultExtension: string;
  defaultString: string;
  /**
   * Initialize a native picker for its actual owning window.
   * @param window Native dialog owner.
   * @param title Visible operation title.
   * @param mode Native modeOpen or modeSave constant.
   * @returns Completion; native failures propagate.
   */
  init(window: NativeWindow, title: string, mode: number): void;
  /**
   * Append a supported native file filter.
   * @param title Visible filter label.
   * @param pattern Native filename glob.
   * @returns Completion; this filter does not validate file contents.
   */
  appendFilter(title: string, pattern: string): void;
  /** Await selection or cancellation. @returns Native returnOK, returnCancel or returnReplace result. */
  show(): Promise<number>;
}

/** Constructor imported by bootstrap from Zotero's supported native filePicker module. */
export interface NativeFilePickerConstructor {
  /** Construct an independent native dialog resource. @returns Fresh FilePicker instance. */
  new (): NativeFilePicker;
}

const titles = {
  import: 'Import Reference Relationships',
  export: 'Export Reference Relationships',
  backup: 'Backup Reference Relationships',
};

/**
 * Bind the explicit native picker constructor without native imports, globals or filesystem access.
 * @param FilePicker Actual supported native constructor supplied by bootstrap.
 * @returns Path selection operation; UI owns lifecycle checks after the awaited selection.
 */
export function createTransferPicker(FilePicker: NativeFilePickerConstructor) {
  /**
   * Choose an import file or fresh output path using a new dialog for every call.
   * @param window Actual owning native window.
   * @param operation Import opens a file; export and backup require a new filename.
   * @returns Exact nonempty native path, or null on cancellation before file access. Other failures propagate.
   */
  async function choose(window: NativeWindow, operation: 'import' | 'export' | 'backup'): Promise<string | null> {
    const picker = new FilePicker(), importing = operation === 'import';
    picker.init(window, titles[operation], importing ? picker.modeOpen : picker.modeSave);
    picker.appendFilter('JSON files', '*.json');
    picker.defaultExtension = 'json';
    if (!importing) picker.defaultString = `reference-relationships-${operation}.json`;
    const result = await picker.show();
    if (result === picker.returnCancel) return null;
    check(importing || result !== picker.returnReplace, 'Choose a new filename; existing output cannot be replaced');
    check(result === picker.returnOK, 'Unexpected native file picker result');
    const path = picker.file;
    check(typeof path === 'string' && path.trim().length > 0, 'Native file picker returned an empty path');
    return path;
  }

  return { choose };
}
