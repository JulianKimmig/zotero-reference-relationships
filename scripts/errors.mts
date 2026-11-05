/** Narrow Node's externally thrown filesystem/process errors without suppressing their original failure. */

/** Read a native error code only when the thrown value supplies one. @param error External failure. @returns Actual code or absence. */
export function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
