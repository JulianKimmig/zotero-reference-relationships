/** Build a production-only XPI with native zip and Node built-ins. */
import { constants } from 'node:fs';
import { copyFile, lstat, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from './compile.mts';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.mts') ? '..' : '../..');

/** Collect regular production files, rejecting symbolic links. @param {string} root @param {string} path @returns {Promise<string[]>} */
async function collect(root: string, path: string): Promise<string[]> {
  const info = await lstat(join(root, path));
  if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
  if (info.isFile()) return [path];
  if (!info.isDirectory()) throw new Error(`Not a regular package input: ${path}`);
  const entries = [`${path}/`];
  for (const name of (await readdir(join(root, path))).sort()) {
    entries.push(...await collect(root, join(path, name)));
  }
  return entries;
}

/** Build a new XPI without overwriting artifacts. @param {string} root @param {string} output @returns {Promise<string>} absolute artifact path. */
export async function buildProject(root: string, output: string): Promise<string> {
  for (const path of ['manifest.json', 'bootstrap.ts', 'src', 'locale']) await collect(root, path);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (!manifest.applications?.zotero?.id || !manifest.version) throw new Error('Manifest needs Zotero id and version');
  if (!manifest.applications.zotero.update_url) throw new Error('Manifest needs applications.zotero.update_url');
  if (new URL(manifest.applications.zotero.update_url).protocol !== 'https:') {
    throw new Error('Zotero requires an HTTPS update_url');
  }
  const compiled = await compileProject(root);
  const files: string[] = [];
  for (const path of ['manifest.json', 'bootstrap.js', 'src', 'locale']) files.push(...await collect(compiled, path));
  const staging = await mkdtemp(join(tmpdir(), 'rr-zip-'));
  const artifact = resolve(output);
  try {
    const archive = join(staging, 'plugin.xpi');
    execFileSync('zip', ['-q', '-X', archive, ...files], { cwd: compiled, stdio: 'pipe' });
    await copyFile(archive, artifact, constants.COPYFILE_EXCL);
  } finally {
    await rm(staging, { recursive: true });
  }
  return artifact;
}

/** Build from the CLI with a fresh temporary destination by default. @returns {Promise<void>} */
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output')) {
    throw new Error('Usage: node scripts/build.mjs [--output /tmp/new-plugin.xpi]');
  }
  const output = args.length ? resolve(args[1])
    : join(await mkdtemp(join(tmpdir(), 'reference-relationships-build-')), 'reference-relationships.xpi');
  console.log(await buildProject(projectRoot, output));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
