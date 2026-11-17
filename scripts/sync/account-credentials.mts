/** Read explicitly supplied private development credentials as dotenv data without shell evaluation or diagnostic values. */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';

/** One dedicated account's transient sign-in input, never a job/report field. */
export interface DevelopmentCredentials { username: string; password: string }

/** Parse an owner-only regular file through the builtin dotenv parser. @param path Absolute user-authorized input. @returns Both credential pairs in process memory; errors omit source text and values. */
export async function readDevelopmentCredentials(path: string): Promise<{ a: DevelopmentCredentials; b: DevelopmentCredentials }> {
  if (!isAbsolute(path)) throw new Error('An absolute credential-file path is required');
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 65536) throw new Error('Invalid private credential file');
      const values = parseEnv(await file.readFile('utf8'));
      /** Require the requested nonempty field without including it in diagnostics. @param name Expected dotenv name. @returns Literal parsed value. */
      function field(name: string): string {
        const value = values[name]; if (typeof value !== 'string' || !value.length) throw new Error('Missing development credentials');
        return value;
      }
      return { a: { username: field('ZOTERO_ACCOUNT_A_USERNAME'), password: field('ZOTERO_ACCOUNT_A_PASSWORD') },
        b: { username: field('ZOTERO_ACCOUNT_B_USERNAME'), password: field('ZOTERO_ACCOUNT_B_PASSWORD') } };
    } finally { await file.close(); }
  } catch { throw new Error('Cannot read complete owner-only development credentials'); }
}
