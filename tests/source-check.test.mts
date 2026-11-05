/** Behavioral checks for TypeScript source ownership, documentation and modular file limits. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkSources } from '../scripts/source-check.mts';

/** Create one small complete source layout. @returns Temporary owned fixture. */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rr-source-check-'));
  await writeFile(join(root, 'bootstrap.ts'), '/** Native bootstrap. */\nfunction startup(): void {}\n');
  for (const path of ['src', 'scripts', 'tests', 'types']) await mkdir(join(root, path));
  await writeFile(join(root, 'src', 'value.mts'), '/** Portable module. */\nexport const value = 1;\n');
  return root;
}

test('checks TypeScript modules and classic scripts without treating static assets as code', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src', 'preferences.xhtml'), '<html/>');
  assert.equal(await checkSources(root), 2);
});

test('rejects undocumented source', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src', 'value.mts'), 'export const value = 1;');
  await assert.rejects(checkSources(root), /docstring/);
});

test('enforces the modular limit at 300 lines', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src', 'value.mts'), '/** Module. */\n' + '// line\n'.repeat(299));
  await checkSources(root);
  await writeFile(join(root, 'src', 'value.mts'), '/** Module. */\n' + '// line\n'.repeat(300));
  await assert.rejects(checkSources(root), /300 lines/);
});

test('rejects remaining handwritten JavaScript in executable source ownership', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src', 'legacy.mjs'), '/** Legacy runtime. */\nexport const value = 1;');
  await assert.rejects(checkSources(root), /JavaScript|TypeScript/);
});

test('rejects broad any and diagnostic suppression in production code', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src', 'value.mts'), '/** Module. */\nexport let value: any;');
  await assert.rejects(checkSources(root), /any/);
  await writeFile(join(root, 'src', 'value.mts'), '/** Module. */\n// @ts-nocheck\nexport const value = 1;');
  await assert.rejects(checkSources(root), /suppression/);
});
