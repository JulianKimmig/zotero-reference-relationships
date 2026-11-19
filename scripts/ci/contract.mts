/** Admission and evidence contracts for anonymous native CI; no build or credential inputs. */
import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';

/** Explicit immutable inputs and supported executable. */
export interface NativeArguments { xpi: string; previousXPI?: string; executable: string }

/** Parse exact CLI grammar before reading files. @param args Ordered archive options. @param environment Explicit runtime selection. @returns Absolute validated paths. */
export function parseNativeArguments(args: readonly string[], environment: { ZOTERO_BIN?: string } = process.env): NativeArguments {
  assert.ok((args.length === 2 || args.length === 4) && args[0] === '--xpi'
    && (args.length === 2 || args[2] === '--previous'), 'Usage: ci:native --xpi ABS [--previous ABS]');
  assert.ok(isAbsolute(args[1]) && (args.length === 2 || isAbsolute(args[3])), 'Artifacts require absolute paths');
  const xpi = resolve(args[1]);
  const previousXPI = args.length === 4 ? resolve(args[3]) : undefined;
  assert.notEqual(xpi, previousXPI, 'Artifacts must be distinct');
  assert.ok(environment.ZOTERO_BIN && isAbsolute(environment.ZOTERO_BIN), 'Set absolute ZOTERO_BIN to Linux Zotero 10.0.7');
  return { xpi, ...(previousXPI ? { previousXPI } : {}), executable: resolve(environment.ZOTERO_BIN) };
}

/** Enforce historical baseline policy. @param previous Explicit prior archive. @param baseline Known released baseline, null only for first-ever plugin. @returns Completion when upgrade evidence is available or legitimately unavailable. */
export function requireBaseline(previous: string | undefined, baseline: string | null): void {
  assert.ok(previous || baseline === null, `Historical baseline ${baseline} exists; --previous is required`);
}

/** Require every native phase assertion and exact runtime version. @param report Native evidence. @param version Actual current archive version. @param flags Required phase proofs. @returns Completion only for exact successful evidence. */
export function validatePhase(report: object, version: string, flags: readonly string[]): void {
  for (const flag of flags) assert.equal(Reflect.get(report, flag), true, `Missing native proof: ${flag}`);
  assert.equal(Reflect.get(report, 'currentVersion'), version);
  assert.equal(Reflect.get(report, 'preferenceRegistrationCount'), 1);
}
