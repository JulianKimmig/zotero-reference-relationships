/** Official preferences must mount exactly one transfer panel and retire its services on native disable/re-enable. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { resources, setEnabled } from './reconciliation-fixtures.sys.mts';
import { preferences } from './rule-preferences-helpers.sys.mts';
import { check, until } from './ui-helpers.sys.mts';

/** Exercise the installed composition rather than a separately constructed panel. @param {object} job Exact installed artifact. @param {object} api Actual host windows and addon. @returns {Promise<object>} Visible mount and teardown evidence. */
export async function transferMounted(job: ControllerJob, api: NativeAPI) {
  const production = await resources(job, api), first = await preferences(api);
  const root = await until(api.Zotero, () => first.root.querySelector<HTMLElement>('[data-rr-transfer-panel]'), 'mounted native transfer panel');
  await until(api.Zotero, () => root.dataset.rrTransferState === 'uninitialized', 'native transfer authority read');
  check(first.root.querySelectorAll('[data-rr-transfer-panel]').length === 1, 'Duplicate transfer panels mounted');
  check(root.getBoundingClientRect().width > 0 && root.getBoundingClientRect().height > 0, 'Transfer controls are not visible');
  const previous = api.Zotero.ReferenceRelationships!.controller.transfer;
  await setEnabled(api.Zotero, production.addon, false);
  let stopped = false;
  try { await previous.exportGraph('self'); } catch (error) { stopped = String(error).includes('stopped'); }
  check(stopped, 'Disabled native generation retained an active transfer service');
  await setEnabled(api.Zotero, production.addon, true);
  const second = await preferences(api);
  await until(api.Zotero, () => second.root.querySelectorAll('[data-rr-transfer-panel]').length === 1, 'single remounted transfer panel');
  check(api.Zotero.ReferenceRelationships!.controller.transfer !== previous, 'Re-enable reused retired transfer ownership');
  first.window.close(); if (second.window !== first.window) second.window.close();
  return { officiallyMounted: true, exactlyOnePanel: true, visible: true, oldServiceStopped: true, newGenerationOwned: true };
}
