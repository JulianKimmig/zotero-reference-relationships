/** Check JavaScript syntax and the source-size boundary using only Node. */
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectRoot } from './build.mjs';

/** Recursively list JavaScript within an owned responsibility. @param {string} path @returns {Promise<string[]>} source paths. */
async function sources(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await sources(full));
    else if (/\.(mjs|js)$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** Validate all shipped scripts, runtime sources and tests. @returns {Promise<void>} */
async function main() {
  const files = [join(projectRoot, 'bootstrap.js')];
  for (const path of ['src', 'scripts', 'tests']) files.push(...await sources(join(projectRoot, path)));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (text.trimEnd().split('\n').length > 300) throw new Error(`Source exceeds 300 lines: ${file}`);
    if (!text.startsWith('/**')) throw new Error(`Missing file docstring: ${file}`);
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  console.log(`Syntax, file documentation and size checked for ${files.length} JavaScript files`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
