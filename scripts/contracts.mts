/** Node-side native-session and synchronization protocol contracts; authentication data has no place here. */

/** Explicit dedicated native client directories. */
export interface ClientProfile { profile: string; data: string }
/** Disposable lifecycle session owns both process paths and its JSON result destination. */
export interface NativeSession extends ClientProfile { root: string; result: string }
/** Only these two synthetic groups participate in permission acceptance. */
export interface TestGroups { writable: number; restricted: number }
/** Additional anonymous/specialized client aliases may be attached by an individual suite. */
export interface SyncConfig { groups: TestGroups; clients: Record<string, ClientProfile> }
/** Shared per-suite native invocation resources. */
export interface NativeOptions {
  config: SyncConfig; root: string; executable: string; updateURL: string; controllerTemplate: string;
}
/** Different native actions produce independently checked report DTOs. */
export type NativeReport = Record<string, unknown>;
/** Only the controller routing field is shared between heterogeneous action payloads. */
export type NativeJob = NativeReport & { action: string };
/** Signed-client identity and permission proof. */
export interface EnvironmentReport { userID: number | null; groups: { groupID: number; editable: boolean }[] }
/** Native round-trip test outputs, checked by the sync protocol validator. */
export interface TransferReport { marker: string; personal: string; shared: string; restricted: string; denied: boolean }
/** Original synthetic native fixture identities used by the sync prerequisite. */
export interface FixtureKeys { personal: string; shared: string; restricted: string }
/** A native report wrapper binds its payload to process/profile identity. */
export interface NativeResult<T> { ok: boolean; profile: string; data: string; version: string; report: T; error?: unknown }
