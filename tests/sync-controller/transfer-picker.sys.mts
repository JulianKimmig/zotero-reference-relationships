/** Real native FilePicker dialog selection/cancellation, driven externally on this client's private X11 display. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { resources } from './reconciliation-fixtures.sys.mts';
import { present } from './evidence.sys.mts';
import { check } from './ui-helpers.sys.mts';

/** Open an actual GTK native dialog and require its observed adapter result. @param {object} job Exact input path and cancel/open action. @param {object} api Actual platform and native file resources. @returns {Promise<object>} Native dialog outcome and unchanged graph state. */
export async function transferPicker(job: ControllerJob, api: NativeAPI) {
  const production = await resources(job, api);
  const app = api.Zotero.ReferenceRelationships!.application, before = await app.read('self');
  const { FilePicker } = api.ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
  const { createTransferPicker } = api.ChromeUtils.importESModule('resource://rr-reconciliation-production/src/adapters/transfer-picker.mjs');
  const io = present(api.IOUtils), path = present(job.pickerPath);
  check(job.action === 'transfer:picker-open' || job.action === 'transfer:picker-cancel', 'Unknown native picker action');
  if (job.action === 'transfer:picker-open') await io.writeUTF8(path, '{"nativePickerFixture":true}', { mode: 'create', flush: true });
  await io.writeUTF8(`${job.data}/picker-ready.json`, JSON.stringify({ display: api.Services.env.get('DISPLAY'), authority: api.Services.env.get('XAUTHORITY'), path,
    action: job.action, state: 'opening' }));
  const selected = await createTransferPicker(FilePicker).choose(api.Zotero.getMainWindow(), 'import');
  check(job.action === 'transfer:picker-open' ? selected === path : selected === null, 'Native picker did not return exact selection/cancellation');
  check(JSON.stringify(await app.read('self')) === JSON.stringify(before), 'Native path selection changed graph authority');
  check(!!production.gateway, 'Actual production resources were not installed');
  return { actualNativeDialog: true, selected, canceled: selected === null, noAuthorityWrites: true };
}
