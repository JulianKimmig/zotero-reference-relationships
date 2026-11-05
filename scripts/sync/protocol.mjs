/** Validate non-secret observations from the real signed-in Zotero clients. */
import assert from 'node:assert/strict';

/**
 * Verify account separation and both library permission matrices.
 * @param {object} reports Native reports indexed by a1/a2/b1.
 * @param {{writable:number, restricted:number}} groups Server group identifiers.
 * @returns {void} Throws when a prerequisite is not established.
 */
export function validateEnvironment(reports, groups) {
  for (const role of ['a1', 'a2', 'b1']) {
    assert.ok(Number.isSafeInteger(reports[role]?.userID) && reports[role].userID > 0,
      `Missing authenticated user identity for ${role}`);
  }
  assert.equal(reports.a1.userID, reports.a2.userID, 'A1 and A2 must use the same account');
  assert.notEqual(reports.a1.userID, reports.b1.userID, 'A and B must be distinct users');
  for (const role of ['a1', 'a2', 'b1']) {
    for (const [kind, groupID] of Object.entries(groups)) {
      const group = reports[role].groups.find(value => value.groupID === groupID);
      assert.ok(group, `Missing group ${groupID} for ${role}`);
      assert.equal(group.editable, role !== 'b1' || kind !== 'restricted',
        `Unexpected permission for ${role} in ${kind} group`);
    }
  }
}

/**
 * Verify round-trip values instead of treating sync completion as success.
 * @param {object} report Final fixture values and actual denied-write outcome.
 * @returns {void} Throws on absent cross-client changes or denied-write proof.
 */
export function validateTransfer(report) {
  assert.ok(typeof report.marker === 'string' && report.marker.length > 0, 'Missing fixture marker');
  assert.equal(report.personal, 'from-a2', 'Missing personal-library edit from A2');
  assert.equal(report.shared, 'from-b1', 'Missing shared-library edit from B1');
  assert.equal(report.restricted, 'baseline', 'Unexpected restricted-library change');
  assert.equal(report.denied, true, 'Restricted-library write was not denied');
}
