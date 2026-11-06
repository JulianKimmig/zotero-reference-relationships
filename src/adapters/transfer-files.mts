/** Bounded strict UTF-8 graph files with exclusive flushed creation and verified complete readback. */
import { check } from '../domain/values.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import { parseExport, verifyExport } from '../transfer/format.mts';
import type { ExportEnvelope } from '../transfer/contracts.mts';
import type { TransferFileDependencies, TransferFiles } from '../transfer/file-contracts.mts';

const MAX_BYTES = 2_097_152;
const encoder = new TextEncoder();

/**
 * Bind explicit file I/O and SHA-256 resources without observing native accounts or graph state.
 * @param dependencies Bounded byte reader, exclusive flushed writer and actual canonical SHA-256 provider.
 * @returns Read and create-only write operations; external errors propagate without cleanup or fallback.
 */
export function createTransferFiles({ io, digest }: TransferFileDependencies): TransferFiles {
  /**
   * Detect oversized prefixes before strict decoding and validate the complete portable envelope.
   * @param path Explicit caller-selected input file.
   * @returns Detached verified authority; original I/O/decoder/codec errors propagate.
   */
  async function read(path: string): Promise<ExportEnvelope> {
    const bytes = await io.read(path, { maxBytes: MAX_BYTES + 1 });
    check(bytes.byteLength <= MAX_BYTES, 'Export file UTF-8 byte limit exceeded', 'limit');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return parseExport(text, digest);
  }

  /**
   * Validate full authority, exclusively create and flush it, then verify actual bounded file contents.
   * @param path Explicit new destination; the I/O port must reject existing or racing destinations.
   * @param document Untrusted export candidate, detached and fully verified before any I/O.
   * @returns Completion only for a correct byte count and canonically identical verified readback.
   */
  async function writeNew(path: string, document: unknown): Promise<void> {
    const verified = await verifyExport(document, digest);
    const text = canonicalJSON(verified, { maxBytes: MAX_BYTES });
    const expectedBytes = encoder.encode(text).byteLength;
    const written = await io.writeUTF8(path, text, { mode: 'create', flush: true });
    check(Number.isSafeInteger(written) && written === expectedBytes, 'Export file write byte count does not match');
    const actual = await read(path);
    check(canonicalJSON(actual, { maxBytes: MAX_BYTES }) === text, 'Export file readback does not match');
  }

  return { read, writeNew };
}
