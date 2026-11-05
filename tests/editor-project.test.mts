/** Open real native entrypoints through TypeScript's editor server to verify configured project discovery and diagnostics. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/** Server responses contain heterogeneous protocol bodies that are inspected by each assertion. */
interface Response { type: string; request_seq: number; success: boolean; message?: string; body?: unknown }
/** One outstanding real editor request, released by the server response or a process failure. */
interface Pending { resolve(value: unknown): void; reject(error: Error): void }

/** Connect to the installed editor server without replacing compiler or filesystem behavior. @param root Actual plugin root. @param signal Test cancellation. @returns Request and teardown operations. */
function editor(root: string, signal: AbortSignal) {
  const child = spawn(process.execPath, [join(root, 'node_modules/typescript/lib/tsserver.js'),
    '--disableAutomaticTypingAcquisition'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], signal });
  const pending = new Map<number, Pending>();
  let sequence = 0, bytes = Buffer.alloc(0), stderr = '';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  /** Reject outstanding requests on a real server failure. @param error Actual process/protocol error. @returns Completion. */
  function fail(error: Error): void { for (const request of pending.values()) request.reject(error); pending.clear(); }
  child.on('error', fail);
  child.on('exit', code => fail(new Error(`TypeScript editor exited ${code}: ${stderr}`)));
  child.stdout.on('data', (chunk: Buffer) => {
    bytes = Buffer.concat([bytes, chunk]);
    while (true) {
      const boundary = bytes.indexOf('\r\n\r\n'); if (boundary < 0) return;
      const length = /Content-Length: (\d+)/i.exec(bytes.subarray(0, boundary).toString());
      if (!length) { fail(new Error('Missing editor response length')); return; }
      const end = boundary + 4 + Number(length[1]); if (bytes.length < end) return;
      const response: Response = JSON.parse(bytes.subarray(boundary + 4, end).toString());
      bytes = bytes.subarray(end);
      if (response.type !== 'response') continue;
      const request = pending.get(response.request_seq); if (!request) continue;
      pending.delete(response.request_seq);
      if (response.success) request.resolve(response.body);
      else request.reject(new Error(response.message));
    }
  });
  /** Send an actual protocol command. @param command Editor command. @param args Command arguments. @returns Sequence identity. */
  function send(command: string, args: object): number {
    const seq = ++sequence;
    child.stdin.write(JSON.stringify({ seq, type: 'request', command, arguments: args }) + '\n');
    return seq;
  }
  /** Await an actual editor answer. @param command Editor command. @param args Command arguments. @returns Server body. */
  function request(command: string, args: object): Promise<unknown> {
    return new Promise((resolve, reject) => { pending.set(send(command, args), { resolve, reject }); });
  }
  /** Close the owned process and all native file watchers. @returns Confirmed process exit. */
  async function close(): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const stopped = once(child, 'exit'); child.kill(); await stopped;
  }
  return { send, request, close };
}

test('editors discover strict native projects with complete ambient types and no diagnostics', { timeout: 30000 }, async context => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith('.mts') ? '..' : '../..');
  const server = editor(root, context.signal);
  try {
    for (const entry of ['bootstrap.ts', 'src/runtime/lifecycle.ts', 'tests/controller/bootstrap.ts', 'tests/sync-controller/bootstrap.ts']) {
      const file = join(root, entry); server.send('open', { file });
      const info = await server.request('projectInfo', { file, needFileNameList: false });
      assert.ok(info && typeof info === 'object' && 'configFileName' in info);
      assert.equal(info.configFileName, join(root, 'tsconfig.json'), `${entry} must belong to the configured project`);
      assert.deepEqual(await server.request('syntacticDiagnosticsSync', { file }), [], entry);
      assert.deepEqual(await server.request('semanticDiagnosticsSync', { file }), [], entry);
    }
  } finally { await server.close(); }
});
