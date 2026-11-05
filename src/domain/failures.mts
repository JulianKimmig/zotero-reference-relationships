/** Preserve useful diagnostics for unknown thrown values, including native errors from another compartment. */

/** Read an actual error message without assuming a shared native Error prototype. @param error Thrown value. @returns Literal diagnostic. */
export function errorMessage(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error);
}
