/** Narrow profiler capabilities checked against the installed Gecko140 runtime before collecting anonymous native evidence. */

/** Native profile JSON is a versioned external format, validated by evidence readers rather than assumed to match an application type. */
export interface NativeProfiler {
  /** Observe whether a recording is already active. @returns Real native profiler state. */
  IsActive(): boolean;
  /** Enumerate actual build capabilities. @returns Supported native feature names. */
  GetFeatures(): string[];
  /** Start one explicit recording. @param entries Buffer entries. @param interval Milliseconds between samples. @param features Supported features. @param threads Native thread filters. @param activeTabID Zero for this host-wide anonymous test. @param duration Zero for no time limit. @returns Native recording starts or throws. */
  StartProfiler(entries: number, interval: number, features: string[], threads: string[], activeTabID: number, duration: number): void;
  /** Stop the owned recording and release its native buffer. @returns No active recording remains. */
  StopProfiler(): void;
  /** Collect a structured native profile without assuming its JSON schema. @returns External versioned profile data. */
  getProfileDataAsync(): Promise<unknown>;
}
