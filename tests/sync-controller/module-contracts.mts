/** Native imports are typed against the real source modules whose compiled files the controller loads. */
import type { AddonManagerModule, NativeAddon, TestItem } from './platform-contracts.mts';

/** Only actual native imports used by the production and test loaders are declared. */
export interface NativeModuleLoader {
  importESModule(uri: `resource://${string}/release.sys.mjs`): typeof import('./release.sys.mts');
  importESModule(uri: `resource://${string}/src/application/changes.mjs`): typeof import('../../src/application/changes.mts');
  importESModule(uri: `resource://${string}/src/application/projection-views.mjs`): typeof import('../../src/application/projection-views.mts');
  importESModule(uri: `resource://${string}/quality.sys.mjs`): typeof import('./quality.sys.mts');
  importESModule(uri: `resource://${string}/quality-performance.sys.mjs`): typeof import('./quality-performance.sys.mts');
  importESModule(uri: `resource://${string}/quality-lifetimes.sys.mjs`): typeof import('./quality-lifetimes.sys.mts');
  importESModule(uri: `resource://${string}/quality-postcommit.sys.mjs`): typeof import('./quality-postcommit.sys.mts');
  importESModule(uri: `resource://${string}/src/domain/graph-contract.mjs`): typeof import('../../src/domain/graph-contract.mts');
  importESModule(uri: `resource://${string}/src/transfer/service.mjs`): typeof import('../../src/transfer/service.mts');
  importESModule(uri: `resource://${string}/src/application/seed.mjs`): typeof import('../../src/application/seed.mts');
  importESModule(uri: `resource://${string}/src/transfer/format.mjs`): typeof import('../../src/transfer/format.mts');
  importESModule(uri: `resource://${string}/src/adapters/transfer-files.mjs`): typeof import('../../src/adapters/transfer-files.mts');
  importESModule(uri: `resource://${string}/transfer-service.sys.mjs`): typeof import('./transfer-service.sys.mts');
  importESModule(uri: `resource://${string}/transfer-mounted.sys.mjs`): typeof import('./transfer-mounted.sys.mts');
  importESModule(uri: `resource://${string}/transfer-ui.sys.mjs`): typeof import('./transfer-ui.sys.mts');
  importESModule(uri: 'chrome://zotero/content/modules/filePicker.mjs'): { FilePicker: import('../../src/adapters/transfer-picker.mts').NativeFilePickerConstructor };
  importESModule(uri: `resource://${string}/transfer-files.sys.mjs`): typeof import('./transfer-files.sys.mts');
  importESModule(uri: `resource://${string}/transfer-picker.sys.mjs`): typeof import('./transfer-picker.sys.mts');
  importESModule(uri: `resource://${string}/transfer-sync.sys.mjs`): typeof import('./transfer-sync.sys.mts');
  importESModule(uri: `resource://${string}/src/adapters/transfer-picker.mjs`): typeof import('../../src/adapters/transfer-picker.mts');
  importESModule(uri: `resource://${string}/transfer-service-edges.sys.mjs`): typeof import('./transfer-service-edges.sys.mts');
  importESModule(uri: 'resource://gre/modules/AddonManager.sys.mjs'): AddonManagerModule;
  importESModule(uri: 'resource://gre/modules/addons/AddonUpdateChecker.sys.mjs'): { AddonUpdateChecker: {
    checkForUpdates(id: string, url: string, listener: { onUpdateCheckComplete(updates: object[]): void; onUpdateCheckError(status: number): void }): void;
  } };
  importESModule(uri: 'chrome://zotero/content/mergeItems.mjs'): { mergeItems(master: TestItem, others: TestItem[]): Promise<void> };
  importESModule(uri: `resource://${string}/src/runtime/plugin.mjs`): typeof import('../../src/runtime/plugin.mts');
  importESModule(uri: `resource://${string}/src/adapters/items.mjs`): typeof import('../../src/adapters/items.mts');
  importESModule(uri: `resource://${string}/src/adapters/repositories.mjs`): typeof import('../../src/adapters/repositories.mts');
  importESModule(uri: `resource://${string}/src/adapters/transfer-identity.mjs`): typeof import('../../src/adapters/transfer-identity.mts');
  importESModule(uri: `resource://${string}/src/domain/evaluate.mjs`): typeof import('../../src/domain/evaluate.mts');
  importESModule(uri: `resource://${string}/graph-contract.mjs`): typeof import('../../src/domain/graph-contract.mts');
  importESModule(uri: `resource://${string}/src/application/service.mjs`): typeof import('../../src/application/service.mts');
  importESModule(uri: `resource://${string}/src/application/lifecycle.mjs`): typeof import('../../src/application/lifecycle.mts');
  importESModule(uri: `resource://${string}/src/transfer/review.mjs`): typeof import('../../src/transfer/review.mts');
  importESModule(uri: `resource://${string}/storage/repository.mjs`): typeof import('../../src/storage/repository.mts');
  importESModule(uri: `resource://${string}/storage/native-notes.mjs`): typeof import('../../src/storage/native-notes.mts');
  importESModule(uri: `resource://${string}/storage/canonical.mjs`): typeof import('../../src/storage/canonical.mts');
  importESModule(uri: `resource://${string}/storage/chunks.mjs`): typeof import('../../src/storage/chunks.mts');
  importESModule(uri: `resource://${string}/storage/envelopes.mjs`): typeof import('../../src/storage/envelopes.mts');
  importESModule(uri: `resource://${string}/transfer-review.sys.mjs`): typeof import('./transfer-review.sys.mts');
  importESModule(uri: `resource://${string}/transfer-identity.sys.mjs`): typeof import('./transfer-identity.sys.mts');
  importESModule(uri: `resource://${string}/reconciliation.sys.mjs`): typeof import('./reconciliation.sys.mts');
  importESModule(uri: `resource://${string}/rule-preferences.sys.mjs`): typeof import('./rule-preferences.sys.mts');
  importESModule(uri: `resource://${string}/rule-commands.sys.mjs`): typeof import('./rule-commands.sys.mts');
  importESModule(uri: `resource://${string}/rules-journey.sys.mjs`): typeof import('./rules-journey.sys.mts');
  importESModule(uri: `resource://${string}/catalog-journey.sys.mjs`): typeof import('./catalog-journey.sys.mts');
  importESModule(uri: `resource://${string}/ui-journey.sys.mjs`): typeof import('./ui-journey.sys.mts');
  importESModule(uri: `resource://${string}/repository.sys.mjs`): typeof import('./repository.sys.mts');
  importESModule(uri: `resource://${string}/contracts.sys.mjs`): typeof import('./contracts.sys.mts');
  importESModule(uri: `resource://${string}/native-experiments.sys.mjs`): typeof import('./native-experiments.sys.mts');
}
