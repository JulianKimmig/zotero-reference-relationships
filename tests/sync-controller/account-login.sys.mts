/** Native dedicated-account setup consumes transient environment credentials and emits only public identity/permission receipts. */
import type { ControllerJob } from './job-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { authenticateDevelopmentAccount, inspectDevelopmentAccount } from './account-auth.mts';
import type { AccountHost } from './account-auth.mts';

/** Authenticate or independently verify one explicit development account through Zotero's own APIs. @param job Account action and expected public user ID. @param api Actual native resources. @returns Sanitized authentication/sync receipts; no password/key enters files or error causes. */
export async function accountLogin(job: ControllerJob, api: NativeAPI) {
  const expected = job.expectedUserID;
  if (!expected || ![22463862, 22463893].includes(expected)
    || !['account:login', 'account:browser-login', 'account:verify', 'account:status'].includes(job.action)) {
    throw new Error('Invalid dedicated-account setup job');
  }
  api.Zotero.Debug.setStore(false);
  const environment = api.Services.env as { get(name: string): string; set(name: string, value: string): void };
  const username = environment.get('RR_ACCOUNT_USERNAME'), password = environment.get('RR_ACCOUNT_PASSWORD'), apiKey = environment.get('RR_ACCOUNT_API_KEY');
  for (const name of ['RR_ACCOUNT_USERNAME', 'RR_ACCOUNT_PASSWORD', 'RR_ACCOUNT_API_KEY']) environment.set(name, '');
  const credentials = job.action === 'account:login' ? { username, password } : job.action === 'account:browser-login' ? { apiKey } : null;
  const native = api.Zotero as NativeAPI['Zotero'] & AccountHost;
  if (job.action === 'account:status') return inspectDevelopmentAccount(native, expected);
  return authenticateDevelopmentAccount(native, expected, credentials);
}
