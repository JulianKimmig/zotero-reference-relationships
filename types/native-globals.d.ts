/** Native compartment declarations for isolated Zotero lifecycle scripts; none of these globals is emitted. */
declare namespace ReferenceRelationshipsHost {
  type TestWindow = import('../tests/sync-controller/platform-contracts.mts').TestWindow;
  type ControllerJob = import('../tests/sync-controller/job-contracts.mts').ControllerJob;
  type TestItem = import('../tests/sync-controller/platform-contracts.mts').TestItem;
  type Window = import('../src/adapters/native-contracts.mts').NativeWindow;
  type Runtime = import('../src/runtime/contracts.mts').RuntimeBridge;
  type RuntimeOptions = import('../src/runtime/contracts.mts').RuntimeOptions;
  type RuntimeConstructor = import('../src/runtime/contracts.mts').RuntimeConstructor;
  interface URI { spec: string }
  interface ResourceProtocol { setSubstitution(name: string, uri: URI | null): void }
  interface ModuleLoader {
    importESModule(uri: `resource://${string}/src/runtime/plugin.mjs`): typeof import('../src/runtime/plugin.mts');
  }
}
declare var Zotero: import('../tests/sync-controller/platform-contracts.mts').TestPlatform;
declare var ChromeUtils: import('../tests/sync-controller/module-contracts.mts').NativeModuleLoader;
declare var Services: import('../tests/sync-controller/platform-contracts.mts').NativeServices;
declare var Components: { interfaces: { nsIResProtocolHandler: object } };
declare var IOUtils: {
  read(path: string, options: { maxBytes: number }): Promise<Uint8Array>;
  readUTF8(path: string): Promise<string>;
  writeUTF8(path: string, text: string, options?: { mode?: 'create' | 'overwrite'; flush?: boolean }): Promise<number>;
};
