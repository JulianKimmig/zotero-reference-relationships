/** Actual native resources and saved authority comparisons for lifecycle resolver acceptance. */
import { check, until } from './ui-helpers.sys.mjs';
import { install, book, ref, applyOne, commits } from './rules-fixtures.sys.mjs';

/** Load exact packaged production modules through their installed addon resource root. @param {object} job XPI fixture. @param {object} api Actual platform. @returns {Promise<object>} Native gateway, projected evaluator and installed addon. */
export async function resources(job, api) {
  await install(job, api);
  const { Zotero, Services, ChromeUtils, Components } = api;
  const handler = Services.io.getProtocolHandler('resource').QueryInterface(Components.interfaces.nsIResProtocolHandler);
  handler.setSubstitution('rr-reconciliation-production', Services.io.newURI(await Zotero.Plugins.getRootURI('reference-relationships@zotero-plugins.local')));
  const { createItemGateway } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/items.mjs');
  const { evaluateProjection } = ChromeUtils.importESModule('resource://rr-reconciliation-production/src/domain/evaluate.mjs');
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  return { gateway: createItemGateway(Zotero), evaluateProjection,
    addon: await AddonManager.getAddonByID('reference-relationships@zotero-plugins.local') };
}

/** Wait for actual asynchronous plugin startup/teardown after the native addon operation. @param {object} Zotero Native platform. @param {object} addon Installed production addon. @param {boolean} enabled Requested state. @returns {Promise<void>} Native singleton/registration reaches the requested state. */
export async function setEnabled(Zotero, addon, enabled) {
  if (enabled) await addon.enable(); else await addon.disable();
  await until(Zotero, () => enabled
    ? Zotero.ReferenceRelationships?.state === 'running' && Zotero.PreferencePanes.pluginPanes.some(pane => pane.id === 'reference-relationships-rules')
    : !Object.hasOwn(Zotero, 'ReferenceRelationships'), enabled ? 'production plugin re-enabled' : 'production plugin disabled');
}

/** Resolve every distinct saved endpoint through the actual production gateway. @param {object} production Packaged gateway/evaluator. @param {object} snapshot Saved complete authority. @returns {Promise<object>} Projection and observations. */
export async function projected(production, snapshot) {
  const refs = new Map();
  for (const root of snapshot.assertions) for (const endpoint of [root.source, root.target]) refs.set(JSON.stringify(endpoint), endpoint);
  const observations = [];
  for (const endpoint of refs.values()) {
    const { original, resolved, status } = await production.gateway.resolve(endpoint);
    observations.push({ original, resolved, status });
  }
  return { ...production.evaluateProjection(snapshot, observations), observations };
}

/** Require unchanged actual saved authority and generation count after native item operations. @param {object} api Native API. @param {object} before Exact read state. @param {number} count Committed manifests. @returns {Promise<void>} */
export async function preserved(api, before, count) {
  const app = api.Zotero.ReferenceRelationships.application;
  app.invalidateAll();
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Endpoint lifecycle rewrote or erased original graph authority');
  check(await commits(api) === count, 'Read-only reconciliation published a generation');
}

/** Seed actual independent roots plus a link that collapses to a self-edge on merge. @param {object} job Marker. @param {object} api Native API. @returns {Promise<object>} Items and saved authority. */
export async function fixtures(job, api) {
  const { Zotero } = api, app = Zotero.ReferenceRelationships.application;
  const a = await book(Zotero, `${job.marker} survivor`), b = await book(Zotero, `${job.marker} original source`);
  const c = await book(Zotero, `${job.marker} original target`), d = await book(Zotero, `${job.marker} target survivor`);
  for (const source of [a, b]) await applyOne(api, await app.draftCreate({ source: ref(source), target: ref(c),
    type: 'referencing', metadata: { note: 'Shared Café 你好' } }));
  await applyOne(api, await app.draftCreate({ source: ref(a), target: ref(b), type: 'similar', metadata: { note: 'Recover on Undo' } }));
  await applyOne(api, await app.manageRules({ library: 'self', kind: 'create', rule: { id: 'lifecycle-inverse', enabled: true,
    rootType: 'referencing', inputType: 'referencing', outputType: 'referenced-by', transform: 'reverse', conditions: [],
    mapping: { note: { kind: 'root', field: 'note' } } } }));
  const before = await app.read('self'), count = await commits(api);
  return { a, b, c, d, before, count };
}
