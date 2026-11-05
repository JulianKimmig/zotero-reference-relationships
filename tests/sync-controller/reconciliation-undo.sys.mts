/** Observe actual native Undo outcomes and retained original ownership without guessing why a merge step was declined. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import type { ItemRef } from '../../src/domain/contracts.mts';
import { check } from './ui-helpers.sys.mts';
import { readyState, errorMessage } from './evidence.sys.mts';
import { resources, fixtures, projected, preserved } from './reconciliation-fixtures.sys.mts';
import { ref, commits } from './rules-fixtures.sys.mts';

/** Require the actual host to apply an Undo/Redo step; retain its public action labels and native debug evidence on refusal. @param api Real native platform resources. @param kind Requested history operation. @returns Actual applied-step evidence; no retry or substitute mutation. */
export async function requireHistoryStep(api: NativeAPI, kind: 'undo' | 'redo') {
  const { Zotero } = api, action = kind === 'undo' ? Zotero.UndoHistory.getUndoAction() : Zotero.UndoHistory.getRedoAction();
  const applied = await Zotero.UndoHistory[kind]();
  const diagnostics = (await Zotero.Debug.get()).split('\n').filter(line => /UndoHistory|stale|rollback|Error:/u.test(line)).slice(-30);
  check(applied === true, `Native ${kind} was not applied: ${JSON.stringify({ action, applied, diagnostics })}`);
  return { action, applied };
}

/** Prove that the new guard rejects a real empty native history without modifying authority. @param job Fresh anonymous profile/artifact. @param api Actual native platform. @returns Separate refusal-path evidence; no fabricated host response. */
async function emptyHistory(job: ControllerJob, api: NativeAPI) {
  check(!api.Zotero.Users.getCurrentUserID(), 'Empty Undo history test requires an anonymous profile');
  await resources(job, api);
  const app = api.Zotero.ReferenceRelationships!.application, before = await app.read('self'), count = await commits(api);
  check(api.Zotero.UndoHistory.getUndoAction() === null, 'Refusal test requires actual empty native history');
  let declined = false;
  try { await requireHistoryStep(api, 'undo'); }
  catch (error) {
    check(errorMessage(error).includes('Native undo was not applied:') && errorMessage(error).includes('"applied":false'), 'Empty Undo failed for an unrelated reason');
    declined = true;
  }
  check(declined, 'Native Undo refusal was accepted as an applied history step');
  await preserved(api, before, count);
  return { nativeRefusalRejected: true, noFalseAppliedStep: true, noAuthorityWrites: true };
}

/** Inspect the original endpoints and native deletion flags after a failed journey, without replaying a mutation. @param job Exact existing disposable fixture/artifact. @param api Actual platform. @returns Non-writing clean-restart evidence. */
async function readback(job: ControllerJob, api: NativeAPI) {
  const production = await resources(job, api), app = api.Zotero.ReferenceRelationships!.application;
  const state = readyState(await app.read('self')), count = await commits(api), originals = new Map<string, ItemRef>();
  for (const root of state.snapshot.assertions) for (const endpoint of [root.source, root.target]) originals.set(endpoint.key, endpoint);
  const rows = [];
  for (const original of originals.values()) {
    const item = await api.Zotero.Items.getByLibraryAndKeyAsync(api.Zotero.Libraries.userLibraryID, original.key);
    rows.push({ original, nativeDeleted: item ? item.deleted : null, inspection: await production.gateway.inspect(original) });
  }
  await preserved(api, state, count);
  return { state, count, rows, cleanReadback: true, noReplay: true, noAuthorityWrites: true };
}

/** Repeat the failing first-Undo sequence without Debug storage or an intervening diagnostic await; capture actual endpoint and persisted flags after that observation. @param job Fresh anonymous fixture/artifact. @param api Actual native platform. @returns Direct history/endpoint/database evidence; a refusal remains a failed positive journey. */
async function unloggedProbe(job: ControllerJob, api: NativeAPI) {
  const { Zotero, ChromeUtils } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Unlogged Undo probe requires an anonymous profile');
  const production = await resources(job, api), { a, b, before, count } = await fixtures(job, api);
  const { mergeItems } = ChromeUtils.importESModule('chrome://zotero/content/mergeItems.mjs');
  check((await projected(production, readyState(before).snapshot)).relationships.length === 5, 'Unlogged initial closure differs');
  await mergeItems(a, [b]);
  const merged = await production.gateway.resolve(ref(b));
  check(merged.resolved?.key === a.key, 'Unlogged merge did not resolve to survivor');
  check((await projected(production, readyState(before).snapshot)).relationships.length === 2, 'Unlogged merged closure differs');
  await preserved(api, before, count);
  const action = Zotero.UndoHistory.getUndoAction(), applied = await Zotero.UndoHistory.undo();
  const restored = await production.gateway.resolve(ref(b)), originalDeleted = b.deleted;
  const persistedDeleted = await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM deletedItems WHERE itemID=?', [b.id]);
  const evidence = { action, applied, merged, restored, originalDeleted, persistedDeleted };
  await preserved(api, before, count);
  check(applied === true && restored.status === 'active' && restored.resolved?.key === b.key && !originalDeleted && persistedDeleted === 0,
    `Unlogged native Undo evidence: ${JSON.stringify(evidence)}`);
  return { ...evidence, noDebugStore: true, noDiagnosticAwaitBeforeObservation: true, noAuthorityWrites: true };
}

/** Exercise one actual merge/Undo after the same application reads as the failing foundation journey; native refusal is never counted as a completed Undo. @param job Fresh anonymous fixture/artifact. @param api Actual platform. @returns Explicit native return and endpoint evidence, or a diagnostic failure. */
export async function reconciliationUndo(job: ControllerJob, api: NativeAPI) {
  if (job.action === 'reconcile:undo-unlogged') return unloggedProbe(job, api);
  if (job.action === 'reconcile:undo-empty') return emptyHistory(job, api);
  if (job.action === 'reconcile:undo-readback') return readback(job, api);
  check(job.action === 'reconcile:undo-probe', 'Unknown native Undo evidence phase');
  const { Zotero, ChromeUtils } = api;
  check(!Zotero.Users.getCurrentUserID(), 'Native Undo probe requires a fresh anonymous profile');
  const production = await resources(job, api), { a, b, before, count } = await fixtures(job, api);
  const { mergeItems } = ChromeUtils.importESModule('chrome://zotero/content/mergeItems.mjs');
  Zotero.Debug.setStore(true);
  await projected(production, readyState(before).snapshot);
  await mergeItems(a, [b]);
  const merged = await production.gateway.resolve(ref(b));
  await projected(production, readyState(before).snapshot); await preserved(api, before, count);
  const step = await requireHistoryStep(api, 'undo'), restored = await production.gateway.resolve(ref(b));
  const diagnostics = (await Zotero.Debug.get()).split('\n').filter(line => /UndoHistory|stale|rollback|Error:/u.test(line)).slice(-30);
  check(restored.status === 'active' && restored.resolved?.key === b.key,
    `Native Undo evidence: ${JSON.stringify({ ...step, merged, restored, originalDeleted: b.deleted, diagnostics })}`);
  await preserved(api, before, count);
  return { ...step, merged, restored, originalDeleted: b.deleted, diagnostics, originalOwnershipRestored: true, noAuthorityWrites: true };
}
