/** Publish complete JSON keyboard packets atomically without replacing an existing packet or another attempt's staging file. */
import { open, link, unlink } from 'node:fs/promises';

/** Finish and sync an owned staging file before atomically creating the reader-visible name. @param path Exact new packet path within the owned exchange. @param value Serializable packet object. @returns Complete packet publication; rejects collisions/serialization/I/O failures and removes only the staging file opened by this call. */
export async function publishKeyboardJSON(path: string, value: object): Promise<void> {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') throw new Error('Keyboard packet is not serializable JSON');
  const staged = `${path}.pending`, handle = await open(staged, 'wx', 0o600);
  try {
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); }
    finally { await handle.close(); }
    await link(staged, path);
  } finally { await unlink(staged); }
}
