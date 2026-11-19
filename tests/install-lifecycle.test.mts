/** Execute the actual stripped native bootstrap against external read-only installation APIs. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const root = new URL(import.meta.url.endsWith('.mts') ? '../' : '../../', import.meta.url);
const bootstrap = stripTypeScriptTypes(await readFile(new URL('bootstrap.ts', root), 'utf8'));
const manifest = await readFile(new URL('manifest.json', root), 'utf8');
const descriptor = { id: 'reference-relationships@zotero-plugins.local', version: (JSON.parse(manifest) as { version: string }).version,
  rootURI: 'file:///tmp/rr-install-fixture/' };
const resources = new Map(await Promise.all([
  ['src/runtime/lifecycle.js', 'src/runtime/lifecycle.ts'],
  ['src/runtime/plugin.mjs', 'src/runtime/plugin.mts'],
  ['src/ui/preferences.xhtml', 'src/ui/preferences.xhtml'],
  ['locale/en-US/reference-relationships.ftl', 'locale/en-US/reference-relationships.ftl'],
].map(async ([resource, source]) => [resource!, await readFile(new URL(source!, root), 'utf8')] as const)));
resources.set('manifest.json', manifest);

/** Native addon descriptors are an external boundary, including malformed negative cases. */
type Install = (addon: unknown, reason?: number) => Promise<void>;

/**
 * Provide only the real native local-resource read API; trap all writes and runtime API access.
 * @param options External native version, resource responses, root and preexisting singleton.
 * @returns Actual VM lifecycle hooks, read requests and forbidden side effects.
 */
function fixture(options: { version?: string; rootURI?: string; files?: Map<string, string>;
  singleton?: object; reader?: boolean; comparator?: boolean; essential?: boolean } = {}) {
  const reads: string[] = [], effects: string[] = [];
  const files = options.files ?? resources, rootURI = options.rootURI ?? descriptor.rootURI;
  /** Reject source attempts to write authority or touch runtime APIs. @param operation Forbidden action. @returns Never. */
  function forbidden(operation: string): never {
    effects.push(operation); throw new Error(`Unexpected install side effect: ${operation}`);
  }
  /** Guard an external native object without replacing any production code. @param target Native surface. @param label Diagnostic path. @returns Guarded surface. */
  function guard<T extends object>(target: T, label: string): T {
    return new Proxy(target, {
      /** Read only explicitly supplied external APIs. @param object API object. @param key Capability name. @returns Declared external value. */
      get(object, key) {
        if (!Object.hasOwn(object, key)) return forbidden(`${label}.${String(key)}`);
        return Reflect.get(object, key);
      },
      /** Trap native state publication. @param _object API object. @param key Written property. @returns Never. */
      set(_object, key) { return forbidden(`set ${label}.${String(key)}`); },
      /** Trap native state removal. @param _object API object. @param key Removed property. @returns Never. */
      deleteProperty(_object, key) { return forbidden(`delete ${label}.${String(key)}`); },
      /** Trap native property publication. @param _object API object. @param key Defined property. @returns Never. */
      defineProperty(_object, key) { return forbidden(`define ${label}.${String(key)}`); },
    });
  }
  const file = options.reader === false ? { getResourceAsync: undefined } : {
    /** Read a packaged resource through the external native API. @param uri Local addon URI. @returns Resource bytes or the native read failure. */
    async getResourceAsync(uri: string): Promise<string> {
      reads.push(uri);
      assert.ok(uri.startsWith(rootURI), 'Resource read must stay inside the supplied addon root');
      const name = uri.slice(rootURI.length);
      if (!files.has(name)) throw new Error(`Missing native resource: ${name}`);
      return files.get(name)!;
    },
  };
  const native = {
    version: options.version ?? '10.0.7', File: guard(file, 'Zotero.File'),
    getMainWindows: options.essential === false ? undefined : () => [],
    ItemPaneManager: { registerSection() {}, unregisterSection() {} },
    PreferencePanes: { register() {}, unregister() {} },
    Notifier: { registerObserver() {}, unregisterObserver() {} },
    ReferenceRelationships: options.singleton,
  };
  if (!options.singleton) Reflect.deleteProperty(native, 'ReferenceRelationships');
  const scope: { install?: Install; relationshipRuntime?: object; relationshipResource?: string;
    Zotero: typeof native; URL: typeof URL; Services: object; ChromeUtils: object; IOUtils: object } = {
    Zotero: guard(native, 'Zotero'), URL, Services: guard({ vc: options.comparator === false ? undefined : {
      /** Model only the external Mozilla comparator boundary for these host fixtures. */
      compare(a: string, b: string): number {
        const order = ['10.0.6', '10.0.7-beta.1', '10.0.7', '10.0.8', '10.9.1', '10.*', '11.0'];
        assert.ok(order.includes(a) && order.includes(b), `Unexpected comparator input ${a}, ${b}`);
        return Math.sign(order.indexOf(a) - order.indexOf(b));
      },
    } }, 'Services'),
    ChromeUtils: guard({}, 'ChromeUtils'), IOUtils: guard({}, 'IOUtils'),
  };
  runInNewContext(bootstrap, scope, { filename: 'bootstrap.ts' });
  /** Call the actual exported lifecycle entrypoint. @param addon Native descriptor. @param reason Zotero lifecycle reason. @returns Installation validation completion. */
  async function install(addon: unknown = descriptor, reason = 5): Promise<void> {
    assert.equal(typeof scope.install, 'function', 'Native bootstrap must expose install');
    await scope.install!(addon, reason);
  }
  /** Verify no authority access, runtime publication or resource registration. @returns Completion. */
  function unchanged(): void {
    assert.deepEqual(effects, []);
    assert.equal(scope.relationshipRuntime, undefined); assert.equal(scope.relationshipResource, undefined);
    assert.equal(native.ReferenceRelationships, options.singleton);
    assert.equal(Object.hasOwn(native, 'ReferenceRelationships'), options.singleton !== undefined);
  }
  return { install, unchanged, reads, effects };
}

test('exposes an install hook that validates local resources without writes or runtime publication', async () => {
  const f = fixture();
  await f.install(); f.unchanged();
  assert.deepEqual([...f.reads].sort(), [...resources.keys()].map(name => descriptor.rootURI + name).sort());
});

test('supports native packed XPI roots and repeated install, upgrade and downgrade validation', async () => {
  const rootURI = 'jar:file:///tmp/reference%20relationships.xpi!/';
  const f = fixture({ rootURI });
  for (const reason of [5, 7, 8, 5]) await f.install({ ...descriptor, rootURI }, reason);
  assert.equal(f.reads.length, resources.size * 4); f.unchanged();
});

test('installation preserves an existing runtime without taking ownership', async () => {
  const f = fixture({ singleton: Object.freeze({ state: 'running' }) });
  await f.install(); f.unchanged();
});

test('installation validates the supplied release version rather than a fixed development version', async () => {
  for (const version of ['0.2.0', '1.0.0']) {
    const files = new Map(resources);
    files.set('manifest.json', JSON.stringify({ ...JSON.parse(manifest), version }));
    const f = fixture({ files });
    await f.install({ ...descriptor, version }); f.unchanged();
    await assert.rejects(f.install({ ...descriptor, version: '9.9.9' }), /identity\/version/);
  }
});

const invalidMetadata: [string, unknown][] = [
  ['null descriptor', null], ['primitive descriptor', 'addon'], ['missing metadata', {}],
  ['wrong identity', { ...descriptor, id: 'another@plugin.local' }],
  ['missing version', { ...descriptor, version: undefined }],
  ['numeric version', { ...descriptor, version: 1 }],
  ['empty version', { ...descriptor, version: '' }],
  ['padded version', { ...descriptor, version: ' 0.1.0' }],
  ['missing root', { ...descriptor, rootURI: undefined }],
  ['empty root', { ...descriptor, rootURI: '' }],
  ...['relative/', 'https://example.test/plugin/', 'jar:https://example.test/plugin.xpi!/',
    'file://server/plugin/', 'file:///tmp/plugin', 'file:///tmp/plugin/?query',
    'file:///tmp/plugin/#fragment', 'file:///tmp/plugin/\n', 'jar:file:///tmp/plugin.xpi!/nested/',
    'jar:file:///tmp/plugin.xpi', 'jar:file:///tmp/plugin.xpi?query!/',
  ].map(rootURI => [`invalid root ${JSON.stringify(rootURI)}`, { ...descriptor, rootURI }] as [string, unknown]),
];
for (const [name, addon] of invalidMetadata) {
  test(`rejects ${name} before native resource access`, async () => {
    const f = fixture();
    await assert.rejects(f.install(addon), /identity|metadata|version|rootURI/);
    assert.deepEqual(f.reads, []); f.unchanged();
  });
}

for (const version of ['10.0.6', '10.0.7-beta.1', '11.0', '']) {
  test(`rejects unsupported native version ${JSON.stringify(version)} without runtime mutation`, async () => {
    const f = fixture({ version });
    await assert.rejects(f.install(), /Zotero.*10\.0\.7/);
    f.unchanged();
  });
}

test('rejects a supplied addon version that disagrees with its packaged manifest', async () => {
  const f = fixture();
  await assert.rejects(f.install({ ...descriptor, version: `${descriptor.version}.different` }), /manifest|version/);
  assert.deepEqual(f.reads, [descriptor.rootURI + 'manifest.json']); f.unchanged();
});

test('rejects a missing native resource reader without fallback or side effects', async () => {
  const f = fixture({ reader: false });
  await assert.rejects(f.install(), /native.*resource|resource.*reader/);
  assert.deepEqual(f.reads, []); f.unchanged();
});

const invalidManifests: [string, string][] = [
  ['malformed JSON', '{'], ['null manifest', 'null'], ['missing application', '{}'],
  ['missing compatibility', JSON.stringify({ version: descriptor.version, applications: { zotero: {} } })],
  ['wrong identity', manifest.replace(descriptor.id, 'another@plugin.local')],
  ['wrong addon version', JSON.stringify({ ...JSON.parse(manifest), version: `${descriptor.version}.different` })],
  ['unsupported compatibility', manifest.replaceAll('10.0.7', '10.0.8')],
  ['reversed bounds', manifest.replace('"strict_min_version": "10.0.7"', '"strict_min_version": "11.0"')],
  ['missing maximum', manifest.replace('"strict_max_version": "10.*",', '')],
];
for (const [name, contents] of invalidManifests) {
  test(`rejects ${name} without initializing runtime or authority`, async () => {
    const files = new Map(resources); files.set('manifest.json', contents);
    const f = fixture({ files });
    await assert.rejects(f.install(), /JSON|manifest|compatibility/);
    assert.deepEqual(f.reads, [descriptor.rootURI + 'manifest.json']); f.unchanged();
  });
}

for (const resource of resources.keys()) {
  test(`propagates a missing packaged resource: ${resource}`, async () => {
    const files = new Map(resources); files.delete(resource);
    const f = fixture({ files });
    await assert.rejects(f.install(), /Missing native resource/); f.unchanged();
  });
  test(`rejects an empty packaged resource: ${resource}`, async () => {
    const files = new Map(resources); files.set(resource, ' \n');
    const f = fixture({ files });
    await assert.rejects(f.install(), /resource|JSON/); f.unchanged();
  });
}

for (const version of ['10.0.7', '10.0.8', '10.9.1']) {
  test(`accepts native comparator admitted runtime ${version}`, async () => {
    const f = fixture({ version }); await f.install(); f.unchanged();
  });
}
test('requires native comparator and essential registration APIs', async () => {
  await assert.rejects(fixture({ comparator: false }).install(), /comparator/);
  await assert.rejects(fixture({ essential: false }).install(), /essential|API/);
});
test('uses the artifact own exact bounds for a historical manifest', async () => {
  const files = new Map(resources); files.set('manifest.json', manifest.replace('10.*', '10.0.7'));
  await fixture({ files }).install();
  await assert.rejects(fixture({ files, version: '10.0.8' }).install(), /compatibility/);
});
