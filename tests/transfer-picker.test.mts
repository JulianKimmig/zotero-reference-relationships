/** Transfer picker behavior substitutes only the external native dialog and its owning window. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransferPicker } from '../src/adapters/transfer-picker.mts';
import type { NativeFilePickerConstructor } from '../src/adapters/transfer-picker.mts';
import type { NativeWindow } from '../src/adapters/native-contracts.mts';

const window = {} as NativeWindow;
const modes = { open: 17, save: 19, ok: 21, cancel: 23, replace: 25 };
const operations = ['import', 'export', 'backup'] as const;

/** One external dialog outcome, including failures of actual native resource operations. */
interface Selection {
  result: number; path: string; pending?: Promise<void>;
  initError?: Error; filterError?: Error; showError?: Error; fileError?: Error;
}

/**
 * Supply independent external native dialog instances with observable calls and dangerous file access.
 * @param selections Ordered outcomes consumed by fresh native constructions.
 * @returns Constructor dependency plus instances for verifying configuration and resource ordering.
 */
function nativePicker(selections: Selection[]) {
  const instances: FilePicker[] = [];
  /** External FilePicker resource fixture; never replaces plugin behavior. */
  class FilePicker {
    readonly modeOpen = modes.open; readonly modeSave = modes.save;
    readonly returnOK = modes.ok; readonly returnCancel = modes.cancel; readonly returnReplace = modes.replace;
    defaultExtension = ''; defaultString = ''; fileReads = 0;
    initialized?: { window: NativeWindow; title: string; mode: number };
    filters: { title: string; pattern: string }[] = [];
    events: string[] = [];
    readonly selection: Selection;
    /** Consume one actual external selection plan. @returns Fresh resource fixture. */
    constructor() {
      const selection = selections[instances.length];
      if (!selection) throw new Error('Unexpected extra dialog construction');
      this.selection = selection; instances.push(this);
    }
    /** Record real native initialization arguments. @param owner Owning window. @param title Dialog title. @param mode Open/save constant. @returns Completion or external failure. */
    init(owner: NativeWindow, title: string, mode: number): void {
      this.events.push('init');
      if (this.selection.initError) throw this.selection.initError;
      this.initialized = { window: owner, title, mode };
    }
    /** Record supported native filter configuration. @param title Visible filter label. @param pattern Native glob. @returns Completion or external failure. */
    appendFilter(title: string, pattern: string): void {
      this.events.push('filter');
      if (this.selection.filterError) throw this.selection.filterError;
      this.filters.push({ title, pattern });
    }
    /** Await an external native result without simulating plugin decisions. @returns Native numeric result. */
    async show(): Promise<number> {
      this.events.push('show'); await this.selection.pending;
      if (this.selection.showError) throw this.selection.showError;
      return this.selection.result;
    }
    /** Expose selected path only when actually accessed. @returns Native path or original external failure. */
    get file(): string {
      this.events.push('file'); this.fileReads++;
      if (this.selection.fileError) throw this.selection.fileError;
      return this.selection.path;
    }
  }
  const Constructor: NativeFilePickerConstructor = FilePicker;
  return { Constructor, instances };
}

for (const operation of operations) {
  test(`${operation} configures the owning window, native mode and JSON selection before returning the exact path`, async () => {
    const path = '/tmp/Café 你好 😀 relationships.json';
    const fixture = nativePicker([{ result: modes.ok, path }]);
    assert.equal(await createTransferPicker(fixture.Constructor).choose(window, operation), path);
    const instance = fixture.instances[0];
    assert.equal(instance.initialized?.window, window);
    assert.equal(instance.initialized?.mode, operation === 'import' ? modes.open : modes.save);
    assert.match(instance.initialized!.title, new RegExp(operation, 'i'));
    assert.match(instance.initialized!.title, /relationship/i);
    assert.equal(instance.filters.length, 1); assert.equal(instance.filters[0].pattern, '*.json');
    assert.match(instance.filters[0].title, /json/i); assert.equal(instance.defaultExtension, 'json');
    if (operation !== 'import') {
      assert.match(instance.defaultString, /reference.*relationships/i);
      assert.match(instance.defaultString, new RegExp(operation, 'i'));
      assert.match(instance.defaultString, /\.json$/u);
    }
    assert.deepEqual(instance.events, ['init', 'filter', 'show', 'file']);
    assert.equal(instance.fileReads, 1);
  });

  test(`${operation} cancellation returns null without dereferencing a native file`, async () => {
    const fixture = nativePicker([{ result: modes.cancel, path: '', fileError: new Error('No native file on cancel') }]);
    assert.equal(await createTransferPicker(fixture.Constructor).choose(window, operation), null);
    assert.equal(fixture.instances[0].fileReads, 0);
  });

  test(`${operation} unknown result fails before dereferencing a native file`, async () => {
    const fixture = nativePicker([{ result: 404, path: '', fileError: new Error('No native file on unknown result') }]);
    await assert.rejects(() => createTransferPicker(fixture.Constructor).choose(window, operation), { code: 'validation' });
    assert.equal(fixture.instances[0].fileReads, 0);
  });

  for (const path of ['', '   ']) {
    test(`${operation} successful native result with ${JSON.stringify(path)} path fails visibly`, async () => {
      const fixture = nativePicker([{ result: modes.ok, path }]);
      await assert.rejects(() => createTransferPicker(fixture.Constructor).choose(window, operation), { code: 'validation' });
      assert.equal(fixture.instances[0].fileReads, 1);
    });
  }
}

for (const operation of ['export', 'backup'] as const) {
  test(`${operation} refuses native replacement and requests a new filename without accessing the existing file`, async () => {
    const fixture = nativePicker([{ result: modes.replace, path: '/tmp/existing.json', fileError: new Error('Do not access replace file') }]);
    await assert.rejects(() => createTransferPicker(fixture.Constructor).choose(window, operation), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /(?:new|another|different).*file(?:name)?/iu);
      return true;
    });
    assert.equal(fixture.instances[0].fileReads, 0);
  });
}

test('import accepts only returnOK and rejects returnReplace without accessing a file', async () => {
  const fixture = nativePicker([{ result: modes.replace, path: '/tmp/existing.json', fileError: new Error('Unexpected file access') }]);
  await assert.rejects(() => createTransferPicker(fixture.Constructor).choose(window, 'import'), { code: 'validation' });
  assert.equal(fixture.instances[0].fileReads, 0);
});

for (const failure of ['initError', 'filterError', 'showError', 'fileError'] as const) {
  test(`preserves original external ${failure} identity`, async () => {
    const error = new Error(`Native ${failure}`), fixture = nativePicker([{ result: modes.ok, path: '/tmp/result.json', [failure]: error }]);
    await assert.rejects(() => createTransferPicker(fixture.Constructor).choose(window, 'import'), cause => cause === error);
    if (failure !== 'fileError') assert.equal(fixture.instances[0].fileReads, 0);
  });
}

test('preserves original native constructor failure', async () => {
  const error = new Error('Native dialog unavailable');
  /** Fail only creation of an external native resource. @returns Never: original platform failure. */
  class UnavailablePicker extends nativePicker([{ result: modes.ok, path: '' }]).Constructor {
    /** Fail external construction after initializing its required base. @returns Never: original native failure. */
    constructor() { super(); throw error; }
  }
  await assert.rejects(() => createTransferPicker(UnavailablePicker).choose(window, 'import'), cause => cause === error);
});

test('each sequential selection uses a fresh dialog even after cancellation', async () => {
  const fixture = nativePicker([{ result: modes.cancel, path: '' }, { result: modes.ok, path: '/tmp/export.json' },
    { result: modes.ok, path: '/tmp/backup.json' }]);
  const picker = createTransferPicker(fixture.Constructor);
  assert.equal(await picker.choose(window, 'import'), null);
  assert.equal(await picker.choose(window, 'export'), '/tmp/export.json');
  assert.equal(await picker.choose(window, 'backup'), '/tmp/backup.json');
  assert.equal(fixture.instances.length, 3);
  assert.notEqual(fixture.instances[1], fixture.instances[2]);
});

test('concurrent selections retain their own window and path and await their actual native result', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const otherWindow = {} as NativeWindow;
  const fixture = nativePicker([{ result: modes.ok, path: '/tmp/first.json', pending },
    { result: modes.ok, path: '/tmp/second.json' }]);
  const picker = createTransferPicker(fixture.Constructor), first = picker.choose(window, 'import');
  assert.equal(await picker.choose(otherWindow, 'backup'), '/tmp/second.json');
  assert.equal(fixture.instances.length, 2); assert.equal(fixture.instances[0].fileReads, 0);
  assert.equal(fixture.instances[0].initialized?.window, window);
  assert.equal(fixture.instances[1].initialized?.window, otherWindow);
  release(); assert.equal(await first, '/tmp/first.json');
});
