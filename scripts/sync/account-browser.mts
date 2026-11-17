/** Control an owned visible Chromium through its installed native WebDriver; never solve or alter verification challenges. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, chmod } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import type { DevelopmentCredentials } from './account-credentials.mts';
import type { LoginBrowser } from './account-browser-session.mts';
import { errorCode } from '../errors.mts';

/** Validate one untrusted WebDriver object without including its values in exceptions. @param value External JSON. @returns Object whose fields need checking. */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid browser protocol result');
  return value as Record<string, unknown>;
}

/** Start only an owned visible browser and attach the installed driver over loopback. @param url Official Zotero login URL. @param credentials Transient normal form input. @param options Explicit browser/driver binaries and private browser profile. @returns Pump/close handle; authentication data is neither printed nor written by this controller. */
export async function openLoginBrowser(url: string, credentials: DevelopmentCredentials,
  options: { browser: string; driver: string; profile: string }): Promise<LoginBrowser> {
  if (!process.env.DISPLAY || new URL(url).origin !== 'https://www.zotero.org') throw new Error('A visible official Zotero login is required');
  await mkdir(options.profile, { recursive: true, mode: 0o700 }); await chmod(options.profile, 0o700);
  const reservation = createServer(); await new Promise<void>(done => reservation.listen(0, '127.0.0.1', done));
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('Browser port unavailable');
  const port = address.port; await new Promise<void>((done, reject) => reservation.close(error => error ? reject(error) : done()));
  const chrome = spawn(options.browser, ['--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${options.profile}`, 'about:blank'],
  { detached: true, stdio: 'ignore' });
  let driver: ChildProcess | null = null, base = '', session = '', closed = false, browserFailed = false;
  chrome.once('error', () => { browserFailed = true; });
  /** Send a standard WebDriver request while discarding its raw error response. @param path Driver resource. @param body Command fields. @param method HTTP method. @returns Untrusted result requiring caller validation. */
  async function request(path: string, body?: object, method = 'POST'): Promise<unknown> {
    const response = await fetch(base + path, { method, signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = object(await response.json());
    if (!response.ok || (result.value && typeof result.value === 'object' && 'error' in result.value)) throw new Error('Browser command failed');
    return result.value;
  }
  /** Close only this driver session/browser process group; never touch another browser. @returns Completion after owned cleanup requests. */
  async function close(): Promise<void> {
    if (closed) return; closed = true;
    try { if (session) await request(`/session/${session}`, undefined, 'DELETE'); }
    finally {
      driver?.kill();
      if (chrome.pid) {
        const exited = chrome.exitCode !== null || chrome.signalCode !== null ? Promise.resolve() : new Promise<void>((done, reject) => {
          const timer = setTimeout(() => reject(new Error('Owned browser close timeout')), 10000);
          chrome.once('exit', () => { clearTimeout(timer); done(); });
        });
        try { process.kill(-chrome.pid, 'SIGTERM'); }
        catch (error) { if (errorCode(error) !== 'ESRCH') throw new Error('Owned browser cleanup failed'); }
        await exited;
      }
    }
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80 && !browserFailed; attempt++) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).ok; }
      catch { ready = false; }
      if (ready) break; await delay(250);
    }
    if (!ready) throw new Error('Owned browser startup failed');
    driver = spawn(options.driver, ['--port=0', '--allowed-ips=127.0.0.1'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const startedDriver = driver;
    const driverPort = await new Promise<string>((done, reject) => {
      let header = ''; const timer = setTimeout(() => reject(new Error('Browser driver startup timeout')), 15000);
      /** Consume only the nonsecret startup header, then drain/discard all driver output. @param chunk Startup bytes. @returns Nothing. */
      function startup(chunk: Buffer): void {
        header = (header + chunk.toString()).slice(-8192); const match = /started successfully on port (\d+)/.exec(header);
        if (match) { clearTimeout(timer); startedDriver.stdout!.off('data', startup); startedDriver.stdout!.resume(); done(match[1]); }
      }
      startedDriver.stdout!.on('data', startup);
      startedDriver.once('error', () => { clearTimeout(timer); reject(new Error('Browser driver unavailable')); });
      startedDriver.once('exit', () => { clearTimeout(timer); reject(new Error('Browser driver stopped')); });
    });
    base = `http://127.0.0.1:${driverPort}`;
    const started = object(await request('/session', { capabilities: { alwaysMatch: { browserName: 'chrome',
      'goog:chromeOptions': { debuggerAddress: `127.0.0.1:${port}` } } } }));
    if (typeof started.sessionId !== 'string') throw new Error('Missing owned browser session'); session = started.sessionId;
    await request(`/session/${session}/timeouts`, { pageLoad: 30000, script: 10000 });
    await request(`/session/${session}/url`, { url });
    let entered = false, submitted = false, notice = false;
    /** Resolve current native browser elements without reading form values or page text. @param selector Owned login/approval selector. @returns Actual element identities. */
    async function elements(selector: string): Promise<string[]> {
      const result = await request(`/session/${session}/elements`, { using: 'css selector', value: selector });
      if (!Array.isArray(result)) throw new Error('Invalid browser elements');
      return result.map(value => { const id = object(value)['element-6066-11e4-a52e-4f735466cecf']; if (typeof id !== 'string') throw new Error(); return id; });
    }
    return { close,
      /** Fill normal account fields once and click only enabled login/approval controls. Verification/MFA is completed by the user in the visible window. @returns Completion of this bounded UI observation/action. */
      async pump(): Promise<void> {
        const current = await request(`/session/${session}/url`, undefined, 'GET');
        if (typeof current !== 'string' || new URL(current).origin !== 'https://www.zotero.org') throw new Error('Unexpected authentication origin');
        const usernames = await elements('#username'), passwords = await elements('#password');
        if (!entered && usernames.length === 1 && passwords.length === 1) {
          await request(`/session/${session}/element/${usernames[0]}/value`, { text: credentials.username });
          await request(`/session/${session}/element/${passwords[0]}/value`, { text: credentials.password }); entered = true;
        }
        const login = await elements('#login');
        if (entered && !submitted && login.length === 1) {
          if (await request(`/session/${session}/element/${login[0]}/enabled`, undefined, 'GET') === true) {
            await request(`/session/${session}/element/${login[0]}/click`, {}); submitted = true;
          } else if (!notice) { console.log('Complete Zotero verification in the opened browser; login fields are prefilled.'); notice = true; }
        }
        if (!passwords.length) for (const button of await elements('form button[type="submit"], form input[type="submit"]')) {
          const label = await request(`/session/${session}/element/${button}/text`, undefined, 'GET');
          if (typeof label === 'string' && /^(?:Authorize(?: Zotero)?|Allow|Approve|Continue)$/i.test(label.trim())
            && await request(`/session/${session}/element/${button}/enabled`, undefined, 'GET') === true) {
            await request(`/session/${session}/element/${button}/click`, {}); break;
          }
        }
      },
    };
  } catch { await close(); throw new Error('Owned Zotero browser startup failed'); }
}
