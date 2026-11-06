/** Count serialized JSON-token UTF-8 bytes without allocating encoded arrays for ASCII tokens. */
const ascii = /^[\x00-\x7f]*$/;
const encoder = new TextEncoder();

/** Count one serialized token using exact ASCII widths or the native UTF-8 encoder. @param token JSON punctuation, literal, number or already-escaped string token. @returns Encoded byte length; strict input/Unicode validation remains with the calling serializer. */
export function jsonTokenBytes(token: string): number {
  return ascii.test(token) ? token.length : encoder.encode(token).byteLength;
}
