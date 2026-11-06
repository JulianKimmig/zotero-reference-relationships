/** Native process success requires an explicit object report bound to the requested client and verified runtime. */
import assert from 'node:assert/strict';
import type { ClientProfile, NativeResult } from '../contracts.mts';

/** Check the common native envelope; callers still validate their action-specific report DTOs. @param input Parsed external native JSON. @param client Exact dedicated profile/data identity. @returns Original object report after envelope validation; missing/null/scalar reports are rejected even when ok is true. */
export function validateNativeJobResult<T extends object>(input: unknown, client: ClientProfile): T {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input), 'Native result must be an object');
  const result = input as Partial<NativeResult<T>>;
  assert.equal(result.profile, client.profile, 'Profile isolation mismatch');
  assert.equal(result.data, client.data, 'Data isolation mismatch');
  assert.equal(result.version, '10.0.7', 'Unverified native version');
  assert.equal(result.ok, true, `Native job failed: ${JSON.stringify(result.error)}`);
  assert.ok(result.report !== null && typeof result.report === 'object', 'Native job omitted its object report');
  return result.report;
}
