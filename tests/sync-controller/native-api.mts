/** Complete privileged test resources, supplied by the real native controller rather than fabricated source replacements. */
import type { NativeServices, TestPlatform } from './platform-contracts.mts';
import type { NativeModuleLoader } from './module-contracts.mts';

/** Runtime-owned test API passed between native controller modules. */
export interface NativeAPI {
  Zotero: TestPlatform; Services: NativeServices; ChromeUtils: NativeModuleLoader;
  Components: { interfaces: { nsIResProtocolHandler: object } };
  DOMParser: typeof DOMParser; crypto: Crypto; TextEncoder: typeof TextEncoder;
  IOUtils?: {
    read(path: string, options: { maxBytes: number }): Promise<Uint8Array>;
    readUTF8(path: string): Promise<string>;
    writeUTF8(path: string, text: string, options?: { mode?: 'create' | 'overwrite'; flush?: boolean }): Promise<number>;
  };
  synchronize(): Promise<void>;
}
