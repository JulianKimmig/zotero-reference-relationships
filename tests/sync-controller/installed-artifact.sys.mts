/** Bind persistent addon evidence to the real installed regular XPI selected by Gecko's resource URI. */
import type { NativeServices, NativeAddon } from './platform-contracts.mts';
import type { NativeAPI } from './native-api.mts';
import { check } from './ui-helpers.sys.mts';

/** Minimum real native APIs used to resolve and hash an installed archive; no input path is accepted. */
export interface InstalledArtifactAPI {
  Services: { io: Pick<NativeServices['io'], 'newURI'> };
  Components: { interfaces: Pick<NativeAPI['Components']['interfaces'], 'nsIFileURL'> };
  IOUtils?: Pick<NonNullable<NativeAPI['IOUtils']>, 'read'>;
  crypto: Pick<Crypto, 'subtle'>;
}
/** CI-only binding inputs, optional at the legacy public controller boundary. */
interface HashInputs { currentSHA256?: string; previousSHA256?: string; previousXPI?: string }

/** Require schema 2 hash bindings before any native job dispatch. @param job Explicit current and optional predecessor bindings. @returns Completion only for complete lowercase SHA-256 bindings. */
export function requireCIHashes(job: HashInputs): void {
  check(typeof job.currentSHA256 === 'string' && /^[a-f0-9]{64}$/.test(job.currentSHA256), 'CI current SHA-256 is required');
  check(Boolean(job.previousXPI) === (job.previousSHA256 !== undefined), 'CI predecessor path and SHA-256 must be paired');
  if (job.previousXPI) check(typeof job.previousSHA256 === 'string' && /^[a-f0-9]{64}$/.test(job.previousSHA256), 'CI predecessor SHA-256 is required');
}

/** Hash the installed regular archive identified by addon.getResourceURI(), never the supplied input XPI. @param api Real Gecko URI/File, native IO and WebCrypto APIs. @param addon Actual persistent addon instance. @param expected Immutable expected archive digest. @returns Observed installed SHA-256 after exact comparison; missing APIs or mismatches fail. */
export async function installedSHA256(api: InstalledArtifactAPI, addon: Pick<NativeAddon, 'getResourceURI'>, expected: string | undefined): Promise<string> {
  check(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected), 'Expected installed SHA-256 is required');
  const root = addon.getResourceURI().spec;
  check(typeof root === 'string' && root.startsWith('jar:file:///') && root.endsWith('!/') && !/[\s?#]/.test(root)
    && root.indexOf('!/') === root.length - 2, 'Installed addon must resolve to a local packed installed archive root URI');
  const uri = api.Services.io.newURI(root.slice(4, -2));
  const file = uri.QueryInterface(api.Components.interfaces.nsIFileURL).file;
  check(file.isFile() && !file.isSymlink(), 'Installed archive must be a regular file, not a symlink');
  const size = file.fileSize;
  check(Number.isSafeInteger(size) && size > 0 && size < Number.MAX_SAFE_INTEGER, 'Invalid installed archive size');
  check(typeof api.IOUtils?.read === 'function', 'Missing native archive IO reader');
  const bytes = await api.IOUtils.read(file.path, { maxBytes: size + 1 });
  check(bytes.byteLength === size && file.fileSize === size && file.isFile() && !file.isSymlink(), 'Installed archive size changed or read was truncated');
  const digest = await api.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  check(actual === expected, 'Native installed archive SHA-256 differs from expected immutable artifact');
  return actual;
}
