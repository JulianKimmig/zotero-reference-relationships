/** Real native rule proposal, preview, cancellation, permission and restart command conformance. */
import { rootMapping, found, present, readyState } from './evidence.sys.mts';
import type { RelationshipApplication } from '../../src/application/service.mts';
import type { TestItem } from './platform-contracts.mts';
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check } from './ui-helpers.sys.mts';
import { rejects } from './ui-permissions.sys.mts';
import { install, book, ref, rule, commits, applyOne } from './rules-fixtures.sys.mts';

/** Remove the engine-owned version from an editable definition. @param {object} overrides Rule edits. @returns {object} Editable rule. */
function editable(overrides = {}) {
  const { version, ...definition } = rule('custom-command-inverse');
  return { ...definition, ...overrides };
}

/** Require a rejected proposal to leave the current native head and notes unchanged. @param {object} api Native API. @param {Function} action Actual public call. @param {string} code Error code. @returns {Promise<void>} */
async function unchanged(api: NativeAPI, action: () => unknown, code: string) {
  const app = api.Zotero.ReferenceRelationships!.application, before = await app.read('self'), count = await commits(api);
  await rejects(action, code);
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Rejected rule command changed authority');
  check(await commits(api) === count, 'Rejected rule command published notes');
}

/** Query exact materialized rows for a native endpoint. @param {object} app Public application. @param {object} item Native item. @returns {Promise<object[]>} Rows. */
async function rows(app: RelationshipApplication, item: TestItem) { return (await app.listRelationships(ref(item), 'both', null, { offset: 0, limit: 100 })).relationships; }

/** Run real application commands on installed code, never substituting a repository or gateway. @param {object} job Native phase. @param {object} api Platform. @returns {Promise<object>} Verified evidence. */
export async function ruleCommands(job: ControllerJob, api: NativeAPI) {
  const { Zotero } = api; await install(job, api);
  const app = Zotero.ReferenceRelationships!.application;
  check(typeof app.manageRules === 'function', 'Versioned rule application command is unavailable');
  if (job.action === 'rulecmd:readonly') {
    await api.synchronize();
    const group = Zotero.Groups.get(job.groups.restricted), library = `group:${found(group).groupID}` as const;
    check(!found(group).editable, 'Rule permission test requires actual read-only group');
    const before = await app.read(library);
    const draft = await app.manageRules({ library, kind: 'create', rule: editable({ id: `denied-${job.marker}` }) });
    await rejects(() => app.preview(draft.command, draft.expectedRevision), 'permission');
    await rejects(() => app.applyFromEvent(draft.command, draft.expectedRevision), 'permission');
    check(JSON.stringify(await app.read(library)) === JSON.stringify(before), 'Denied rule command changed group');
    return { realGroupPermissionDenied: true, unchanged: true };
  }
  if (job.action === 'rulecmd:create') {
    const a = await book(Zotero, `${job.marker} source`), b = await book(Zotero, `${job.marker} target`);
    const uninitialized = await app.read('self'), count = await commits(api);
    const initial = await app.manageRules({ library: 'self', kind: 'create', rule: editable() });
    check(initial.expectedRevision === null && initial.command.snapshot.rules[0].version === 1, 'First rule draft did not propose version one');
    await app.preview(initial.command, initial.expectedRevision);
    check(JSON.stringify(await app.read('self')) === JSON.stringify(uninitialized) && await commits(api) === count,
      'Draft/preview/cancel initialized native authority');
    await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(b), type: 'referencing', metadata: { note: 'Native rule command Café 你好' } }));
    const draft = await app.manageRules({ library: 'self', kind: 'create', rule: editable() });
    const review = await app.preview(draft.command, draft.expectedRevision);
    check(present(review.changeSet.derived).added.length === 1 && present(review.changeSet.derived).added[0].type === 'referenced-by', 'Rule command omitted inverse preview');
    await applyOne(api, draft);
    check((await rows(app, a)).length === 2 && readyState((await app.read('self'))).snapshot.assertions.length === 1, 'Native inverse command persisted computed assertion');
    const detached = await app.manageRules({ library: 'self', kind: 'update', rule: editable() });
    rootMapping(detached.command.snapshot.rules[0].mapping.note).field = 'unknown';
    check(rootMapping(readyState((await app.read('self'))).snapshot.rules[0].mapping.note).field === 'note', 'Rule draft aliases cached authority');
    const stale = await app.manageRules({ library: 'self', kind: 'update', rule: editable({ enabled: false }) });
    await applyOne(api, await app.draftCreate({ source: ref(b), target: ref(a), type: 'referenced-by', metadata: {} }));
    await unchanged(api, () => app.preview(stale.command, stale.expectedRevision), 'conflict');
    await unchanged(api, () => app.applyFromEvent(stale.command, stale.expectedRevision), 'conflict');
    const disabled = await app.manageRules({ library: 'self', kind: 'update', rule: editable({ enabled: false }) });
    check(disabled.command.snapshot.rules[0].version === 2, 'Disable did not increment rule version');
    const disableReview = await app.preview(disabled.command, disabled.expectedRevision);
    check(present(disableReview.changeSet.derived).removed.length === 0 && present(disableReview.changeSet.derived).updated.length === 1,
      'Disable preview lost surviving manual inverse');
    await applyOne(api, disabled);
    const inverse = (await rows(app, a)).find(edge => edge.type === 'referenced-by');
    check(present(inverse).assertions.length === 1 && present(inverse).supports.length === 0 && Object.keys(present(inverse).metadata).length === 0, 'Manual inverse did not survive disable');
    const noOp = await app.manageRules({ library: 'self', kind: 'update', rule: editable({ enabled: false }) });
    check(noOp.command.snapshot.rules[0].version === 2, 'No-op changed version');
    for (const input of [{ library: 'self', kind: 'create', rule: editable() },
      { library: 'self', kind: 'update', rule: editable({ id: 'unknown' }) }, { library: 'self', kind: 'delete', id: 'unknown' },
      { library: 'self', kind: 'create', rule: editable({ id: 'unknown-type', outputType: 'missing' }) },
      { library: 'self', kind: 'create', rule: editable({ id: 'bad-condition', conditions: [{ field: 'note', op: 'exists', value: 'yes' }] }) },
      { library: 'self', kind: 'delete', id: 'custom-command-inverse', extra: true }]) {
      // @ts-expect-error Invalid runtime command envelopes must be rejected.
      await unchanged(api, () => app.manageRules(input), 'validation');
    }
    const enabled = await app.manageRules({ library: 'self', kind: 'update', rule: editable() });
    await applyOne(api, enabled);
    return { a: a.key, b: b.key, snapshot: readyState((await app.read('self'))).snapshot, uninitializedCancel: true,
      customInverse: true, manualSurvival: true, staleRejected: true, invalidRejected: true, detachedDraft: true };
  }
  check(job.action === 'rulecmd:restart', 'Unknown rule command phase');
  const state = await app.read('self');
  check(JSON.stringify(readyState(state).snapshot) === JSON.stringify(job.snapshot), 'Restart changed rule command authority');
  const a = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, present(job.a));
  check(present((await rows(app, found(a))).find(edge => edge.type === 'referenced-by')).supports[0].version === 3, 'Restart lost enabled rule version');
  const retype = await app.manageRules({ library: 'self', kind: 'update', rule: editable({ outputType: 'similar' }) });
  const review = await app.preview(retype.command, retype.expectedRevision);
  check(present(review.changeSet.derived).added[0].type === 'similar' && present(review.changeSet.derived).updated[0].after.assertions.length === 1,
    'Retype preview omitted new output or manual inverse');
  await applyOne(api, retype);
  const deleted = await app.manageRules({ library: 'self', kind: 'delete', id: 'custom-command-inverse' });
  await applyOne(api, deleted);
  check(readyState((await app.read('self'))).snapshot.rules.length === 0 && (await rows(app, found(a))).length === 2, 'Delete removed manual authority or left generated edge');
  return { restarted: true, retypePreview: true, deleteRetracted: true, manualAuthorityPreserved: true };
}
