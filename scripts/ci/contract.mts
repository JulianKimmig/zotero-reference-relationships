/** Admission and evidence contracts for anonymous native CI; no build or credential inputs. */
import assert from 'node:assert/strict';
import { isAbsolute, resolve } from 'node:path';

/** Explicit immutable inputs and supported executable. */
export interface NativeArguments {
  xpi: string; previousXPI?: string; executable: string; expectedVersion: string;
  previousRuntime?: string; previousExpectedVersion?: string; result?: string;
}
/** Runtime selection supplied by the provisioning wrapper, never inferred from a filename. */
interface Environment { ZOTERO_BIN?: string; ZOTERO_VERSION?: string; ZOTERO_PREVIOUS_VERSION?: string }

/** Parse exact CLI pairs before filesystem access. @param args Archive, host and receipt options. @param environment Explicit host expectations. @returns Validated absolute paths and versions. */
export function parseNativeArguments(args: readonly string[], environment: Environment = process.env): NativeArguments {
  const usage = 'Usage: ci:native --xpi ABS [--previous ABS] [--previous-runtime ABS] [--result ABS]';
  assert.ok(args.length >= 2 && args.length % 2 === 0 && args[0] === '--xpi', usage);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    assert.ok(['--xpi', '--previous', '--previous-runtime', '--result'].includes(key) && !values.has(key), usage);
    assert.ok(value && isAbsolute(value), 'Artifacts, runtimes and receipts require absolute paths');
    values.set(key, resolve(value));
  }
  const xpi = values.get('--xpi')!, previousXPI = values.get('--previous');
  const previousRuntime = values.get('--previous-runtime'), result = values.get('--result');
  assert.notEqual(xpi, previousXPI, 'Artifacts must be distinct');
  assert.ok(!result || (result !== xpi && result !== previousXPI), 'Receipt must be distinct from artifacts');
  assert.ok(environment.ZOTERO_BIN && isAbsolute(environment.ZOTERO_BIN), 'Set absolute ZOTERO_BIN');
  assert.match(environment.ZOTERO_VERSION ?? '', /^\d+\.\d+(?:\.\d+)?$/, 'Set resolved ZOTERO_VERSION');
  assert.ok(!previousRuntime || previousXPI, '--previous-runtime requires --previous');
  assert.ok(Boolean(previousRuntime) === Boolean(environment.ZOTERO_PREVIOUS_VERSION), 'Pair previous runtime with ZOTERO_PREVIOUS_VERSION');
  if (previousRuntime) assert.match(environment.ZOTERO_PREVIOUS_VERSION!, /^\d+\.\d+(?:\.\d+)?$/);
  return { xpi, executable: resolve(environment.ZOTERO_BIN), expectedVersion: environment.ZOTERO_VERSION!,
    ...(previousXPI ? { previousXPI } : {}), ...(result ? { result } : {}),
    ...(previousRuntime ? { previousRuntime, previousExpectedVersion: environment.ZOTERO_PREVIOUS_VERSION! } : {}) };
}

/** Enforce historical baseline policy. @param previous Explicit prior archive. @param baseline Known released baseline, null only for first-ever plugin. @returns Completion when upgrade evidence is available or legitimately unavailable. */
export function requireBaseline(previous: string | undefined, baseline: string | null): void {
  assert.ok(previous || baseline === null, `Historical baseline ${baseline} exists; --previous is required`);
}

/** Require semantic upgrade evidence rather than equal-version reinstall or downgrade. @param previous Prior stable artifact version. @param current Candidate stable version. @returns Completion only for a strictly increasing version. */
export function requireUpgrade(previous: string, current: string): void {
  const parts = [previous, current].map(version => {
    assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Upgrade requires stable semantic versions');
    const values = version.split('.').map(Number); assert.ok(values.every(Number.isSafeInteger), 'Unsafe version component'); return values;
  });
  const index = parts[0].findIndex((value, position) => value !== parts[1][position]);
  assert.ok(index >= 0 && parts[0][index] < parts[1][index], 'Upgrade requires a strictly older predecessor');
}

/** Require every native phase assertion and exact runtime version. @param report Native evidence. @param version Actual current archive version. @param flags Required phase proofs. @returns Completion only for exact successful evidence. */
export function validatePhase(report: object, version: string, flags: readonly string[]): void {
  for (const flag of flags) assert.equal(Reflect.get(report, flag), true, `Missing native proof: ${flag}`);
  assert.equal(Reflect.get(report, 'currentVersion'), version);
  assert.equal(Reflect.get(report, 'preferenceRegistrationCount'), 1);
}

/** Bind an observed installed archive digest to the immutable expected artifact. @param report Actual native phase report. @param expected Frozen artifact SHA-256. @returns Completion only for an exact installed-byte proof. */
export function validateInstalledHash(report: object, expected: string): void {
  assert.match(expected, /^[a-f0-9]{64}$/, 'Expected immutable SHA-256');
  assert.equal(Reflect.get(report, 'installedSHA256'), expected, 'Missing or substituted installed archive SHA-256');
}
