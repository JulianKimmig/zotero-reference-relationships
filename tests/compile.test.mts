/** Behavioral coverage for checked TypeScript emission and native script/module boundaries. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { compileProject } from '../scripts/compile.mts';

/** Create a minimal strict project with a native bootstrap and ES module. @returns {Promise<string>} Source root. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rr-typescript-test-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, noEmitOnError: true, types: [], rootDir: '.', outDir: '.build' },
    include: ['src/**/*.mts'],
  }));
  await writeFile(join(root, 'bootstrap.ts'), '/** Native entrypoint. */\nvar generation: number = 1;\nfunction startup(): number { return generation; }\n');
  await writeFile(join(root, 'src', 'value.mts'), '/** Typed module. */\nexport const value: number = 42;\n');
  return root;
}

test('emits executable modules and exposes classic lifecycle globals without module wrappers', async () => {
  const root = await fixture();
  const output = await compileProject(root);
  const module = await import(pathToFileURL(join(output, 'src', 'value.mjs')).href);
  assert.equal(module.value, 42);
  const scope: { startup?: () => number } = {};
  runInNewContext(await readFile(join(output, 'bootstrap.js'), 'utf8'), scope);
  assert.ok(scope.startup);
  assert.equal(scope.startup(), 1);
});

test('type errors prevent emission rather than producing an unchecked release', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src', 'value.mts'), '/** Invalid module. */\nexport const value: number = "wrong";\n');
  await assert.rejects(compileProject(root), /not assignable|TS2322/);
  await assert.rejects(readFile(join(root, '.build', 'src', 'value.mjs')), /ENOENT/);
});

test('type errors in classic entrypoints fail compilation too', async () => {
  const root = await fixture();
  await writeFile(join(root, 'bootstrap.ts'), '/** Invalid bootstrap. */\nvar generation: number = "wrong";\n');
  await assert.rejects(compileProject(root), /not assignable|TS2322/);
});

test('module imports retain the extensions required by the native module loader', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src', 'consumer.mts'), '/** Module consumer. */\nimport { value } from "./value.mjs";\nexport const doubled: number = value * 2;\n');
  const output = await compileProject(root);
  const module = await import(pathToFileURL(join(output, 'src', 'consumer.mjs')).href);
  assert.equal(module.doubled, 84);
});

test('a fresh compile removes obsolete generated modules', async () => {
  const root = await fixture();
  const output = await compileProject(root);
  await writeFile(join(output, 'obsolete.mjs'), 'throw new Error("stale");');
  await compileProject(root);
  await assert.rejects(readFile(join(output, 'obsolete.mjs')), /ENOENT/);
});

test('classic scripts can use ambient contracts for ES modules while keeping their lifecycle globals', async () => {
  const root = await fixture();
  await mkdir(join(root, 'types'));
  await writeFile(join(root, 'types', 'host.d.ts'), '/** Actual module export contract. */\ndeclare namespace Host { type Value = typeof import("../src/value.mjs").value; }\n');
  await writeFile(join(root, 'bootstrap.ts'), '/** Native typed lifecycle. */\nvar generation: Host.Value = 3;\nfunction startup(): number { return generation; }\n');
  const output = await compileProject(root), scope: { startup?: () => number } = {};
  runInNewContext(await readFile(join(output, 'bootstrap.js'), 'utf8'), scope);
  assert.ok(scope.startup); assert.equal(scope.startup(), 3);
  const module = await import(pathToFileURL(join(output, 'src', 'value.mjs')).href);
  assert.equal(module.value, 42);
});
