/** Behavioral checks for native sync-environment reports, without source mocks. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEnvironment, validateTransfer } from '../scripts/sync/protocol.mts';

/** Construct external-client report fixtures. @returns {object} Three client reports. */
function reports() {
  const full = [{ groupID: 1, editable: true }, { groupID: 2, editable: true }];
  return {
    a1: { userID: 10, groups: structuredClone(full) },
    a2: { userID: 10, groups: structuredClone(full) },
    b1: { userID: 20, groups: [{ groupID: 1, editable: true }, { groupID: 2, editable: false }] },
  };
}

test('accepts distinct users and the specified shared-library permissions', () => {
  assert.doesNotThrow(() => validateEnvironment(reports(), { writable: 1, restricted: 2 }));
});

test('rejects A2 signed into a different account', () => {
  const value = reports(); value.a2.userID = 30;
  assert.throws(() => validateEnvironment(value, { writable: 1, restricted: 2 }), /same account/);
});

test('rejects both roles signed into the same account', () => {
  const value = reports(); value.b1.userID = 10;
  assert.throws(() => validateEnvironment(value, { writable: 1, restricted: 2 }), /distinct/);
});

test('rejects missing group membership', () => {
  const value = reports(); value.b1.groups.pop();
  assert.throws(() => validateEnvironment(value, { writable: 1, restricted: 2 }), /group/);
});

test('rejects writable restricted library for B', () => {
  const value = reports(); value.b1.groups[1].editable = true;
  assert.throws(() => validateEnvironment(value, { writable: 1, restricted: 2 }), /permission/);
});

test('rejects missing authenticated user identity', () => {
  // @ts-expect-error Null user identity must fail runtime validation.
  const value = reports(); value.a1.userID = null;
  assert.throws(() => validateEnvironment(value, { writable: 1, restricted: 2 }), /user/);
});

test('accepts actual cross-client edits and a rejected restricted-library write', () => {
  assert.doesNotThrow(() => validateTransfer({ marker: 'run', personal: 'from-a2', shared: 'from-b1', restricted: 'baseline', denied: true }));
});

test('rejects missing A2 changes', () => {
  assert.throws(() => validateTransfer({ marker: 'run', personal: 'baseline', shared: 'from-b1', restricted: 'baseline', denied: true }), /personal/);
});

test('rejects a successful write to the read-only group', () => {
  assert.throws(() => validateTransfer({ marker: 'run', personal: 'from-a2', shared: 'from-b1', restricted: 'baseline', denied: false }), /denied/);
});
