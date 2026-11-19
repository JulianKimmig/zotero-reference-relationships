/** Platform-native launches and bounded termination for exclusively owned CI profiles. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import type { ClientProfile } from '../contracts.mts';

/** Literal executable and argv; no shell quoting or command interpolation. */
export interface Command { executable: string; args: string[] }
/** Choose the real desktop adapter. @param executable Absolute host. @param client Owned directories. @param platform Native OS. @returns Literal launch command. */
export function command(executable: string, client: ClientProfile, platform: NodeJS.Platform = process.platform): Command {
  assert.ok(['linux', 'win32', 'darwin'].includes(platform), 'Unsupported native OS');
  const args = ['-no-remote', '-profile', client.profile, '-datadir', client.data];
  return platform === 'linux' ? { executable: 'xvfb-run', args: ['-a', executable, ...args] } : { executable, args };
}
/** Encode action names as portable filenames. @param role Controlled profile role. @param action Controlled action. @returns Windows-valid evidence basename. */
export function evidenceName(role: string, action: string): string {
  assert.match(role, /^[a-z][a-z0-9-]*$/);
  assert.match(action, /^[a-z][a-z0-9:-]*$/);
  return `${role}-${action.replaceAll(':', '-')}.json`;
}
/** Run a bounded owned process and drain logs after exit, including cancellation. @param launch Literal command. @param logPath New log. @param timeoutMs Deadline. @returns Completion only on native zero exit. */
export async function runProcess(launch: Command, logPath: string, timeoutMs = 240000): Promise<void> {
  const log = createWriteStream(logPath, { flags: 'wx', mode: 0o600 });
  const child = spawn(launch.executable, launch.args, { detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(process.platform === 'linux' ? { TMPDIR: '/tmp' } : {}), MOZ_NO_REMOTE: '1', MOZ_CRASHREPORTER_DISABLE: '1' } });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let failure: Error | undefined;
  /** Kill only the process tree launched above. @param reason Timeout, signal or output failure. @returns Completion after issuing native tree termination. */
  function terminate(reason: string): void {
    if (failure) return;
    failure = new Error(reason);
    if (!child.pid) return;
    if (process.platform === 'win32') {
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], error => {
        if (error) { failure = new Error(`${reason}; taskkill failed`, { cause: error }); child.kill(); }
      });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure = new Error(reason, { cause: error }); }
    }
  }
  /** Terminate on parent cancellation before returning control to the caller. @returns Completion. */
  function interrupted(): void { terminate('Native process interrupted'); }
  const timer = setTimeout(() => terminate('Native process timed out'), timeoutMs);
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  log.on('error', interrupted);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => {
        if (failure) reject(failure);
        else if (code === 0) resolve();
        else reject(new Error(`Native process exited ${code}`));
      });
    });
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
    log.end(); await finished(log);
  }
}
