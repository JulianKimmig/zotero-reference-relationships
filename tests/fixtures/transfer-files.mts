/** Real bounded/exclusive filesystem port and actual SHA-256 fixtures for transfer-file behavior. */
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createTransferFiles } from '../../src/adapters/transfer-files.mts';
import { createExport } from '../../src/transfer/format.mts';
import { exportedAt, transferGraph } from './transfer.mts';
import type { TransferFileIO } from '../../src/transfer/file-contracts.mts';
import type { ExportEnvelope } from '../../src/transfer/contracts.mts';

/** Inclusive envelope limit and one extra byte for detecting a truncated oversized prefix. */
export const maxBytes = 2_097_152;

/** Hash canonical UTF-8 using actual Node crypto. @param input Canonical text. @returns Lowercase SHA-256. */
export async function digest(input: string): Promise<string> {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Build a valid complete owner-bound authority. @returns Verified portable document. */
export async function document(): Promise<ExportEnvelope> {
  return createExport({ source: { kind: 'user', id: '123' }, snapshot: transferGraph(), exportedAt }, digest);
}

/**
 * Create an isolated real filesystem port; cleanup removes only this fixture's new temporary directory.
 * @param context Test lifetime owning the temporary files.
 * @returns Adapter, external port, requested options and disposable target paths.
 */
export async function filesystem(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'rr-transfer-files-'));
  context.after(() => rm(directory, { recursive: true }));
  const reads: { path: string; options: { maxBytes: number } }[] = [];
  const writes: { path: string; text: string; options: { mode: 'create'; flush: true } }[] = [];
  const io: TransferFileIO = {
    /** Read through a capped file handle without stat/truncation assumptions. @param path Input file. @param options Byte cap. @returns At most the requested bytes. */
    async read(path, options) {
      reads.push({ path, options });
      const handle = await open(path, 'r');
      try {
        const bytes = new Uint8Array(options.maxBytes);
        let length = 0;
        while (length < bytes.byteLength) {
          const result = await handle.read(bytes, length, bytes.byteLength - length, null);
          if (result.bytesRead === 0) break;
          length += result.bytesRead;
        }
        return bytes.slice(0, length);
      } finally { await handle.close(); }
    },
    /** Exclusively create and flush the actual destination. @param path New file. @param text UTF-8 content. @param options Native create/flush semantics. @returns Written UTF-8 bytes. */
    async writeUTF8(path, text, options) {
      writes.push({ path, text, options });
      if (options.mode !== 'create' || options.flush !== true || Object.keys(options).length !== 2) {
        throw new Error('Expected only direct exclusive creation and flushing');
      }
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
        return Buffer.byteLength(text, 'utf8');
      } finally { await handle.close(); }
    },
  };
  return { io, files: createTransferFiles({ io, digest }), reads, writes,
    path: join(directory, 'export.json'), otherPath: join(directory, 'other.json') };
}
