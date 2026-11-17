/** Dedicated native account authentication uses real Zotero storage, exact identities and secret-free results/errors. */

/** Only the public identity fields needed from the actual server response. */
interface AccountInfo { userID: number; username: string; displayName?: string; emails?: string[] }
/** Native API client is an external authentication/server boundary, not a plugin-source replacement. */
interface AccountClient {
  createAPIKeyFromCredentials(username: string, password: string): Promise<(AccountInfo & { key: string }) | false>;
  getKeyInfo(): Promise<AccountInfo | false>; getGroupVersions(userID: number): Promise<Record<string, number>>;
  deleteAPIKey(): Promise<void>;
}
/** Explicit supported native capabilities for dedicated-account setup and persistence verification. */
export interface AccountHost {
  Users: { getCurrentUserID(): number | null | undefined };
  Libraries: { userLibraryID: number };
  Groups: { get(id: number): { libraryID: number; editable: boolean; archived: boolean } | false };
  getMainWindow(): object;
  Sync: {
    Data: { Local: {
      getAPIKey(): Promise<string | false>; setAPIKey(key: string): Promise<void>;
      checkUser(window: object, userID: number, username: string, name?: string, emails?: string[]): Promise<boolean>;
    } };
    Runner: {
      getAPIClient(options?: { apiKey: string }): AccountClient;
      sync(options: { background: boolean; fileLibraries: number[]; fullTextLibraries: number[]; onError(error: Error): void }): Promise<boolean | void>;
    };
  };
}

/** Inspect only native identity and stored-key presence before deciding whether a new browser session is necessary. @param native Actual native account surface. @param expectedUserID Accepted development account. @returns Public identity/presence only; no network, key creation or synchronization. */
export async function inspectDevelopmentAccount(native: AccountHost, expectedUserID: number) {
  try {
    if (![22463862, 22463893].includes(expectedUserID)) throw new Error();
    const userID = native.Users.getCurrentUserID() || null;
    if (userID !== null && userID !== expectedUserID) throw new Error();
    return { userID, keyPresent: !!await native.Sync.Data.Local.getAPIKey() };
  } catch { throw new Error('Dedicated native account status unavailable'); }
}

/** Sign in only the two accepted development identities, or verify/reuse their stored login. @param native Actual native account/server surface. @param expectedUserID Explicit accepted account A/B ID. @param credentials Transient optional login fields; null forbids new login. @returns Public identity/group permission receipts; every thrown error is sanitized and has no original cause. */
export async function authenticateDevelopmentAccount(native: AccountHost, expectedUserID: number,
  credentials: { username: string; password: string } | { apiKey: string } | null) {
  let phase = 'account-policy', issuedKey: string | null = null, stored = false;
  try {
    if (![22463862, 22463893].includes(expectedUserID)) throw new Error();
    phase = 'existing-account';
    const existing = native.Users.getCurrentUserID();
    if (existing && existing !== expectedUserID) throw new Error();
    const local = native.Sync.Data.Local, runner = native.Sync.Runner;
    phase = 'stored-login'; let key = await local.getAPIKey();
    const reusedStoredLogin = !!key;
    if (!key) {
      phase = 'credentials-required'; if (!credentials) throw new Error();
      if ('apiKey' in credentials) {
        if (!credentials.apiKey) throw new Error(); key = issuedKey = credentials.apiKey;
      } else {
        if (!credentials.username || !credentials.password) throw new Error();
        phase = 'login-request';
        const created = await runner.getAPIClient().createAPIKeyFromCredentials(credentials.username, credentials.password);
        phase = 'login-rejected'; if (created === false) throw new Error();
        phase = 'login-response';
        if (typeof created.key !== 'string' || !created.key) throw new Error();
        issuedKey = created.key;
        phase = `login-identity-${Number.isSafeInteger(created.userID) ? created.userID : 'invalid'}`;
        if (created.userID !== expectedUserID) throw new Error();
        key = created.key;
      }
    }
    phase = 'verify-login';
    const client = runner.getAPIClient({ apiKey: key }), info = await client.getKeyInfo();
    if (!info || info.userID !== expectedUserID || typeof info.username !== 'string' || !info.username) throw new Error();
    phase = 'group-membership';
    const membership = await client.getGroupVersions(expectedUserID);
    if (JSON.stringify(Object.keys(membership).sort()) !== JSON.stringify(['6749379', '6749388'])) throw new Error();
    if (!reusedStoredLogin) { phase = 'native-key-storage'; await local.setAPIKey(key); stored = true; }
    phase = 'native-identity';
    if (!await local.checkUser(native.getMainWindow(), info.userID, info.username, info.displayName, info.emails)) throw new Error();
    phase = 'metadata-sync'; let syncFailed = false;
    const outcome = await runner.sync({ background: true, fileLibraries: [], fullTextLibraries: [],
      /** Retain only failure presence, never a server error message or authentication material. @returns Nothing. */
      onError() { syncFailed = true; } });
    if (outcome === false || syncFailed || native.Users.getCurrentUserID() !== expectedUserID) throw new Error();
    phase = 'group-permissions';
    const groups = [6749379, 6749388].map(groupID => {
      const group = native.Groups.get(groupID);
      if (!group || group.archived || group.editable !== (groupID === 6749379 || expectedUserID === 22463862)) throw new Error();
      return { groupID, libraryID: group.libraryID, editable: group.editable };
    });
    return { userID: expectedUserID, reusedStoredLogin, groups, metadataSyncComplete: true, fileSyncRequested: false };
  } catch {
    if (issuedKey && !stored) {
      try { await native.Sync.Runner.getAPIClient({ apiKey: issuedKey }).deleteAPIKey(); }
      catch { phase += '-key-cleanup-failed'; }
    }
    throw new Error(`Development account setup failed at ${phase}`);
  }
}
