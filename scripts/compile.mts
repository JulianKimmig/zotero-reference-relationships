/** Check and emit TypeScript modules and isolated native classic scripts, then stage static assets. */
import ts from 'typescript';
import { cp, lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Report compiler errors with source locations. @param diagnostics Compiler findings. @returns Never on error. */
function assertValid(diagnostics: readonly ts.Diagnostic[]): void {
  const errors = diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getCanonicalFileName: path => path,
    getNewLine: () => '\n',
  }));
}

/** Discover native scripts and static assets without following symlinks. @param root Project. @returns Relative input paths. */
async function inputs(root: string): Promise<string[]> {
  const found: string[] = [];
  /** Walk only owned input trees. @param relative Project-relative path. @returns Completion. */
  async function visit(relative: string): Promise<void> {
    const path = join(root, relative);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${relative}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(relative, name));
    } else if (info.isFile()) found.push(relative);
    else throw new Error(`Not a regular compiler input: ${relative}`);
  }
  for (const name of (await readdir(root)).sort()) {
    if (['src', 'tests', 'locale', 'types', 'LICENSE', 'THIRD-PARTY-NOTICES.md'].includes(name) || /^(bootstrap\.ts|manifest\.json|package\.json)$/.test(name)) {
      await visit(name);
    }
  }
  return found;
}

/**
 * Validate all inputs before replacing task-owned generated output.
 * @param root Source package containing tsconfig.json.
 * @param checkOnly Check without writing emitted files or assets.
 * @returns Absolute generated tree; native script programs remain isolated from one another.
 */
export async function compileProject(root: string, checkOnly = false): Promise<string> {
  root = resolve(root);
  const configFile = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  if (configFile.error) assertValid([configFile.error]);
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  assertValid(config.errors);
  const output = join(root, '.build');
  if (resolve(config.options.outDir ?? '') !== output) throw new Error('Compiler outDir must be .build');
  const files = await inputs(root);
  const options = { ...config.options, noEmit: false, noEmitOnError: true };
  const programs = [ts.createProgram(config.fileNames, options)];
  const declarations = files.filter(path => path.endsWith('.d.ts')).map(path => join(root, path));
  for (const file of files.filter(path => path.endsWith('.ts') && !path.endsWith('.d.ts'))) {
    programs.push(ts.createProgram([join(root, file), ...declarations], {
      ...options, module: ts.ModuleKind.None, moduleResolution: ts.ModuleResolutionKind.Node10,
      moduleDetection: ts.ModuleDetectionKind.Legacy,
    }));
  }
  for (const program of programs) assertValid(ts.getPreEmitDiagnostics(program));
  if (checkOnly) return output;
  await rm(output, { recursive: true, force: true });
  await mkdir(output);
  assertValid(programs[0].emit().diagnostics);
  // Type-only imports are checked in each native program, but their modules were
  // already emitted with NodeNext. Emit only this program's classic entrypoint.
  for (const program of programs.slice(1)) {
    const entrypoint = program.getRootFileNames().find(path => !path.endsWith('.d.ts'))!;
    assertValid(program.emit(program.getSourceFile(entrypoint)).diagnostics);
  }
  for (const file of files.filter(path => !/\.(mts|ts)$/.test(path))) {
    await mkdir(dirname(join(output, file)), { recursive: true });
    await cp(join(root, file), join(output, file), { errorOnExist: true });
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.mts') ? '..' : '../..');
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Usage: compile [--check]');
  compileProject(root, args[0] === '--check').then(path => console.log(path))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
