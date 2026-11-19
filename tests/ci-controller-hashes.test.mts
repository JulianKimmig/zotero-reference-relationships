/** Execute the actual CI bootstrap against external native services and real hash admission logic. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { requireCIHashes } from './sync-controller/installed-artifact.sys.mts';

const root = new URL(import.meta.url.endsWith('.mts') ? './' : '../../tests/', import.meta.url);
const bootstrap = stripTypeScriptTypes(await readFile(new URL('ci-controller/bootstrap.ts', root), 'utf8'));

/** Run actual bootstrap with only external native resource mocks; the admission function remains real. @param inputs Explicit malformed job bindings. @returns Actual emitted native result and dispatched module paths. */
async function run(inputs: object) {
  const job = { state: 'pending', profile: '/owned/profile', data: '/owned/data', result: '/owned/result', ...inputs };
  const writes = new Map<string, string>(), imports: string[] = [];
  const scope: { runCI?: (rootURI: string) => Promise<void> } = {};
  runInNewContext(bootstrap, Object.assign(scope, {
    Services: { prefs: { getStringPref: () => '/owned/job' }, io: {
      getProtocolHandler: () => ({ QueryInterface: () => ({ setSubstitution() {} }) }), newURI: (spec: string) => ({ spec }),
    } },
    Components: { interfaces: { nsIResProtocolHandler: {} } },
    ChromeUtils: {
      /** Load the real admission helper through the external Gecko module-loader boundary. @param uri Requested native module. @returns Real hash guard, never a substituted source implementation. */
      importESModule(uri: string) {
        imports.push(uri);
        assert.ok(uri.endsWith('/installed-artifact.sys.mjs'), 'Incomplete hashes must fail before lifecycle dispatch');
        return { requireCIHashes };
      },
    },
    Zotero: { initializationPromise: Promise.resolve(), uiReadyPromise: Promise.resolve(),
      Profile: { dir: job.profile }, DataDirectory: { dir: job.data }, version: '10.0.8',
      DB: { async waitForTransaction() {} }, Utilities: { Internal: { quit() {} } },
    },
    IOUtils: {
      async readUTF8() { return JSON.stringify(job); },
      async writeUTF8(path: string, text: string) { writes.set(path, text); },
    },
  }));
  await scope.runCI!('file:///owned/controller/');
  return { result: JSON.parse(writes.get(job.result)!) as { ok: boolean; error: { message: string } }, imports };
}

test('CI initialization requires current hash before any native job dispatch', async () => {
  const actual = await run({ action: 'ci-release:initialize' });
  assert.equal(actual.result.ok, false); assert.match(actual.result.error.message, /SHA-256/);
  assert.equal(actual.imports.length, 1);
});

test('CI seed rejects an unbound predecessor before loading lifecycle code', async () => {
  const actual = await run({ action: 'ci-release:seed', currentSHA256: 'a'.repeat(64), previousXPI: '/old.xpi' });
  assert.equal(actual.result.ok, false); assert.match(actual.result.error.message, /predecessor/);
  assert.equal(actual.imports.length, 1);
});
