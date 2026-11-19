/** Bind native envelopes to the owned profile and version actually observed by Zotero. */
import assert from 'node:assert/strict';
import type { ClientProfile } from '../contracts.mts';

/** Normalize only a missing patch component. @param version Resolved or observed host version. @returns Comparable version without accepting aliases or prereleases. */
export function normalizeVersion(version: string): string {
  assert.match(version, /^\d+\.\d+(?:\.\d+)?$/, 'Expected resolved stable host version');
  return version.split('.').length === 2 ? `${version}.0` : version;
}
/** Validate an untrusted native result. @param input Native JSON. @param client Owned directories. @param expected Provisioned version. @returns Observed version and original report. */
export function validateEnvelope(input: unknown, client: ClientProfile, expected: string): { version: string; report: object } {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'Missing native envelope');
  const value = input as { ok?: unknown; profile?: unknown; data?: unknown; version?: unknown; report?: unknown; error?: unknown };
  assert.equal(value.profile, client.profile, 'Profile isolation mismatch');
  assert.equal(value.data, client.data, 'Data isolation mismatch');
  assert.equal(typeof value.version, 'string', 'Missing observed native version');
  assert.equal(normalizeVersion(value.version as string), normalizeVersion(expected), 'Observed host version differs from resolved runtime');
  assert.equal(value.ok, true, `Native failure: ${JSON.stringify(value.error)}`);
  assert.ok(value.report && typeof value.report === 'object' && !Array.isArray(value.report), 'Missing native report');
  return { version: value.version as string, report: value.report };
}
