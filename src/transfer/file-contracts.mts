/** Bounded byte input and exclusive new-file output ports for verified portable graph authority. */
import type { Digest } from '../domain/contracts.mts';
import type { ExportEnvelope } from './contracts.mts';

/** Native IOUtils-compatible operations; implementations must preserve failures and exclusive creation. */
export interface TransferFileIO {
  /**
   * Read at most the requested bytes without decoding or substituting missing data.
   * @param path Explicit caller-selected file path.
   * @param options Inclusive maximum number of bytes to return.
   * @returns Actual file bytes; rejects with the original I/O failure.
   */
  read(path: string, options: { maxBytes: number }): Promise<Uint8Array>;
  /**
   * Exclusively create the destination directly, encode text as UTF-8 and request an OS buffer flush.
   * @param path New destination; an existing/racing destination must cause rejection.
   * @param text Complete canonical document to write without staging or moving.
   * @param options Required create-only mode and buffer flushing.
   * @returns Reported written byte count; failures may leave visible partial output.
   */
  writeUTF8(path: string, text: string, options: { mode: 'create'; flush: true }): Promise<number>;
}

/** Explicit external resources; no native globals or account/configuration access is required. */
export interface TransferFileDependencies { io: TransferFileIO; digest: Digest }

/** Portable transfer-file boundary; no graph publication or file deletion is performed. */
export interface TransferFiles {
  /**
   * Bound raw bytes before strict UTF-8 decoding and complete envelope verification.
   * @param path Explicit input file path.
   * @returns Detached verified authority; preserves I/O, decoding and codec failures.
   */
  read(path: string): Promise<ExportEnvelope>;
  /**
   * Validate untrusted authority before writing and acknowledge only matching verified actual readback.
   * @param path Explicit new output path; existing output is never overwritten.
   * @param document Untrusted complete export envelope; validated before any file I/O.
   * @returns Completion only after byte count and bounded canonical readback match. Failed output remains visible.
   */
  writeNew(path: string, document: unknown): Promise<void>;
}
