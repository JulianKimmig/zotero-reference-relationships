/** Enforce the handwritten TypeScript boundary, file documentation and modular source-size policy. */
import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** Recursively list owned executable inputs and reject leftover JavaScript. @param path Source responsibility. @returns TypeScript paths. */
async function sources(path: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await sources(full));
    else if (/\.(mjs|js|cjs)$/.test(entry.name)) throw new Error(`Handwritten JavaScript must be migrated to TypeScript: ${full}`);
    else if (/\.(mts|ts)$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** Reject compile-check escapes while permitting narrowly asserted negative type tests. @param file Source path. @param text Bytes. @param test Whether test-owned. @returns Completion. */
function checkTypes(file: string, text: string, test: boolean): void {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  /** Inspect actual type nodes rather than string fixtures or prose. @param node Parsed source. @returns Completion. */
  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.AnyKeyword) throw new Error(`Broad any type is not permitted: ${file}`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
    if (/@ts-(?:nocheck|ignore)\b/.test(scanner.getTokenText()) || (!test && /@ts-expect-error\b/.test(scanner.getTokenText()))) {
      throw new Error(`Compiler diagnostic suppression is not permitted: ${file}`);
    }
  }
}

/** Check all handwritten executable areas without inspecting generated artifacts or static assets. @param root Plugin source root. @returns Checked file count. */
export async function checkSources(root: string): Promise<number> {
  const files = [join(root, 'bootstrap.ts')];
  for (const path of ['src', 'scripts', 'tests', 'types']) files.push(...await sources(join(root, path)));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (text.trimEnd().split('\n').length > 300) throw new Error(`Source exceeds 300 lines: ${file}`);
    if (!text.startsWith('/**')) throw new Error(`Missing file docstring: ${file}`);
    checkTypes(file, text, relative(root, file).startsWith('tests/'));
  }
  return files.length;
}
