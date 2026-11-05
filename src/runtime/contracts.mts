/** Shared structural lifecycle contracts let native classic scripts remain outside the ES module graph. */
import type { NativeWindow } from '../adapters/native-contracts.mts';
import type { RelationshipApplication } from '../application/service.mts';
import type { createPlugin } from './plugin.mts';

/** Real application, preferences and native UI controller for one addon generation. */
export type PluginController = ReturnType<typeof createPlugin>;
/** Host singleton exposed to official preference callbacks and native controllers. */
export interface RuntimeBridge {
  id: string; version: string; state: 'running' | 'stopped'; windows: Set<NativeWindow>;
  controller: PluginController; application: RelationshipApplication;
  addWindow(window: NativeWindow): void; removeWindow(window: NativeWindow): void; stop(): void;
}
/** Installed addon identity and its composed controller. */
export interface RuntimeOptions { id: string; version: string; controller: PluginController }
/** Constructor installed into an isolated classic script scope by the native loader. */
export type RuntimeConstructor = new (options: RuntimeOptions) => RuntimeBridge;
