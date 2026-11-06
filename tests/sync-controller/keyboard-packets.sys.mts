/** Native keyboard requests become visible only after their complete JSON payload has been flushed. */
import type { NativeAPI } from './native-api.mts';
import { check } from './ui-helpers.sys.mts';

/** Publish via actual same-directory native move with explicit no-overwrite semantics. @param io Real IOUtils APIs. @param path Exact new exchange packet path. @param value Serializable packet. @returns Complete packet publication; failed staging is retained as private diagnostic evidence. */
export async function publishNativeKeyboardJSON(io: NonNullable<NativeAPI['IOUtils']>, path: string, value: object): Promise<void> {
  const text = JSON.stringify(value);
  check(typeof text === 'string', 'Native keyboard packet is not serializable JSON');
  check(typeof io.move === 'function', 'Native keyboard atomic move API unavailable');
  const staging = `${path}.pending`;
  await io.writeUTF8(staging, text, { mode: 'create', flush: true });
  await io.move(staging, path, { noOverwrite: true });
}

/** Verify actual native collision behavior before using publication in the workflow. @param io Real IOUtils APIs. @param exchange Fresh owned directory. @returns A completed packet is preserved exactly and a second publication rejects. */
export async function verifyNativeKeyboardPublication(io: NonNullable<NativeAPI['IOUtils']>, exchange: string): Promise<void> {
  const path = `${exchange}/native-publication-probe.json`, value = { complete: true, payload: 'complete'.repeat(10000) };
  await publishNativeKeyboardJSON(io, path, value);
  const before = await io.readUTF8(path); check(before === JSON.stringify(value), 'Native packet publication was incomplete');
  let refused = false;
  try { await publishNativeKeyboardJSON(io, path, { complete: false }); }
  catch (error) { check(error instanceof Error && error.name === 'NoModificationAllowedError',
    `Unexpected native packet collision failure: ${error instanceof Error ? error.name : String(error)}`); refused = true; }
  check(refused && await io.readUTF8(path) === before, 'Native packet collision replaced an existing packet');
}
