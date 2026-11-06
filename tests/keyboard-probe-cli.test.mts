/** Behavioral guards for the bounded native keyboard probe; these tests never launch Zotero or send OS input. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const runner = new URL(`../scripts/sync/keyboard-probe.${import.meta.url.endsWith('.mts') ? 'mts' : 'mjs'}`, import.meta.url).pathname;
const owned = { display: ':123', authority: '/tmp/xvfb-run.A1b2C3/Xauthority', windowMarker: '123e4567-e89b-42d3-a456-426614174000' };

/** Execute only rejected arguments in a real source CLI process. @param args CLI tokens. @param executable Explicit native executable or absence. @returns Captured bounded process result. */
function cli(args: string[], executable = '') {
  return spawnSync(process.execPath, ['--experimental-strip-types', runner, ...args], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, ZOTERO_BIN: executable },
  });
}

for (const args of [[], ['artifact.xpi'], ['--xpi', 'relative.xpi'], ['--xpi', '/tmp/a.xpi', '--replay'], ['--build']]) {
  test(`CLI rejects unsupported or nonabsolute arguments ${JSON.stringify(args)}`, () => {
    const result = cli(args);
    assert.equal(result.status, 1); assert.match(result.stderr, /Usage:.*--xpi/);
  });
}

for (const executable of ['', 'zotero', './zotero']) {
  test(`CLI requires explicit absolute ZOTERO_BIN ${JSON.stringify(executable)}`, () => {
    const result = cli(['--xpi', '/tmp/keyboard-probe-does-not-exist.xpi'], executable);
    assert.equal(result.status, 1); assert.match(result.stderr, /absolute ZOTERO_BIN/);
  });
}

test('CLI rejects an absent supplied XPI before creating a native client', () => {
  const result = cli(['--xpi', '/tmp/keyboard-probe-does-not-exist.xpi'], '/usr/bin/true');
  assert.equal(result.status, 1); assert.match(result.stderr, /ENOENT/); assert.equal(result.stdout, '');
});

test('CLI rejects a directory as XPI and a nonexecutable binary before native work', async () => {
  const root = await mkdtemp('/tmp/rr-keyboard-cli-test-');
  try {
    const directory = cli(['--xpi', root], '/usr/bin/true');
    assert.equal(directory.status, 1); assert.match(directory.stderr, /XPI.*regular file/);
    const xpi = join(root, 'fixture.xpi'), binary = join(root, 'no-execute');
    await writeFile(xpi, 'CLI validation fixture'); await writeFile(binary, 'not executable', { mode: 0o600 });
    const denied = cli(['--xpi', xpi], binary);
    assert.equal(denied.status, 1); assert.match(denied.stderr, /EACCES/); assert.equal(denied.stdout, '');
  } finally { await rm(root, { recursive: true }); }
});

test('parser accepts exactly the explicit XPI and executable without reading ambient display', async () => {
  const { parseKeyboardProbeArguments } = await import('../scripts/sync/keyboard-probe.mts');
  assert.deepEqual(parseKeyboardProbeArguments(['--xpi', '/tmp/current.xpi'], { ZOTERO_BIN: '/opt/zotero/zotero' }),
    { xpi: '/tmp/current.xpi', executable: '/opt/zotero/zotero' });
  assert.throws(() => parseKeyboardProbeArguments(['--xpi', '/tmp/a\0.xpi'], { ZOTERO_BIN: '/opt/zotero/zotero' }), /Usage:/);
});

test('backend accepts only local private display and xvfb-run authority path', async () => {
  const { validateX11KeyboardInput } = await import('../scripts/sync/x11-keyboard.mts');
  assert.doesNotThrow(() => validateX11KeyboardInput(owned, [{ key: 'a', modifiers: [] }, { key: 'Tab', modifiers: [] }, { key: 'space', modifiers: [] }]));
});

test('backend rejects trailing line terminators synchronously before subprocess delivery', async () => {
  const { validateX11KeyboardInput } = await import('../scripts/sync/x11-keyboard.mts');
  const newline = String.fromCharCode(10);
  for (const target of [{ ...owned, display: owned.display + newline }, { ...owned, authority: owned.authority + newline }]) {
    assert.throws(() => validateX11KeyboardInput(target, [{ key: 'a', modifiers: [] }]), /DISPLAY|XAUTHORITY/);
  }
});

for (const display of [':0', ':123.0', 'localhost:123', ':123;echo bad', '', ':123\n']) {
  test(`backend rejects unowned display syntax ${JSON.stringify(display)} before any process`, async () => {
    const { sendX11Keys, validateX11KeyboardInput } = await import('../scripts/sync/x11-keyboard.mts');
    assert.throws(() => validateX11KeyboardInput({ ...owned, display }, [{ key: 'a', modifiers: [] }]), /private.*DISPLAY/);
    await assert.rejects(sendX11Keys({ ...owned, display }, [{ key: 'a', modifiers: [] }]), /private.*DISPLAY/);
  });
}

for (const authority of ['/home/user/.Xauthority', '/tmp/Xauthority', '/tmp/xvfb-run.a/../Xauthority', '/tmp/xvfb-run.a/Xauthority\n']) {
  test(`backend rejects authority outside owned xvfb-run path ${JSON.stringify(authority)}`, async () => {
    const { sendX11Keys, validateX11KeyboardInput } = await import('../scripts/sync/x11-keyboard.mts');
    assert.throws(() => validateX11KeyboardInput({ ...owned, authority }, [{ key: 'a', modifiers: [] }]), /XAUTHORITY path/);
    await assert.rejects(sendX11Keys({ ...owned, authority }, [{ key: 'a', modifiers: [] }]), /XAUTHORITY path/);
  });
}

test('backend rejects unknown keys, modifiers, and unbounded or empty sequences without spawning', async () => {
  const { validateX11KeyboardInput } = await import('../scripts/sync/x11-keyboard.mts');
  for (const strokes of [[], [{ key: 'Return', modifiers: [] }], [{ key: 'a', modifiers: ['Control_L'] }],
    [{ key: 'a', modifiers: ['unknown'] }], [{ key: 'a' }], Array.from({ length: 4 }, () => ({ key: 'a', modifiers: [] }))]) {
    assert.throws(() => validateX11KeyboardInput(owned, strokes), /key|modifier|sequence/i);
  }
});

test('ready receipt must match exact owned exchange, action, and unique marker', async () => {
  const { validateKeyboardReady } = await import('../scripts/sync/keyboard-probe.mts');
  const expected = { data: '/tmp/rr-owned/data', marker: owned.windowMarker };
  const receipt = { ...owned, ...expected, action: 'quality:keyboard-probe', state: 'ready' };
  assert.deepEqual(validateKeyboardReady(receipt, expected), owned);
  for (const changed of [{ data: '/tmp/other/data' }, { marker: 'stale-marker' }, { action: 'quality:pure' },
    { state: 'opening' }, { display: 'remote:10' }, { authority: '/tmp/unowned/Xauthority' }]) {
    assert.throws(() => validateKeyboardReady({ ...receipt, ...changed }, expected));
  }
  for (const bad of [null, [], 'ready']) assert.throws(() => validateKeyboardReady(bad, expected));
});

test('ready wait reads only the exact owned file and fails within its deadline', async () => {
  const { waitKeyboardReady } = await import('../scripts/sync/keyboard-probe.mts');
  const root = await mkdtemp('/tmp/rr-keyboard-ready-test-'), expected = { data: root, marker: 'test' };
  try {
    await assert.rejects(waitKeyboardReady(join(root, 'ready.json'), expected, () => false, 20), /ready.*timed out/);
    await assert.rejects(waitKeyboardReady(join(root, 'ready.json'), expected, () => true, 20), /ended before.*ready/);
    await writeFile(join(root, 'ready.json'), '{invalid');
    await assert.rejects(waitKeyboardReady(join(root, 'ready.json'), expected, () => false, 20), /JSON/);
  } finally { await rm(root, { recursive: true }); }
});

test('sender failure still awaits and observes the native job failure', async () => {
  const { observeKeyboardJob } = await import('../scripts/sync/keyboard-probe.mts');
  let observed = false;
  const pending = new Promise<never>((_resolve, reject) => {
    setTimeout(() => { observed = true; reject(new Error('native deadline')); }, 20);
  });
  await assert.rejects(observeKeyboardJob(pending, async () => { throw new Error('sender unavailable'); }),
    /sender unavailable.*native deadline/);
  assert.equal(observed, true);
});

test('successful delivery returns the ordinary native report after process completion', async () => {
  const { observeKeyboardJob } = await import('../scripts/sync/keyboard-probe.mts');
  const report = { trusted: true };
  assert.equal(await observeKeyboardJob(Promise.resolve(report), async () => {}), report);
});

/** Build validator input representing all six observed OS key transitions. @returns Complete trusted observation DTO. */
function observations() {
  return {
    keys: [
      { type: 'keydown', key: 'a', target: 'input', focused: 'input', isTrusted: true, repeat: false },
      { type: 'keyup', key: 'a', target: 'input', focused: 'input', isTrusted: true, repeat: false },
      { type: 'keydown', key: 'Tab', target: 'input', focused: 'input', isTrusted: true, repeat: false },
      { type: 'keyup', key: 'Tab', target: 'button', focused: 'button', isTrusted: true, repeat: false },
      { type: 'keydown', key: ' ', target: 'button', focused: 'button', isTrusted: true, repeat: false },
      { type: 'keyup', key: ' ', target: 'button', focused: 'button', isTrusted: true, repeat: false },
    ],
    inputs: [{ isTrusted: true, value: 'a' }], clicks: [{ isTrusted: true }],
    value: 'a', focused: 'button', windowFocused: true,
  };
}

test('native validator requires all trusted OS transitions, actual text, Tab focus and one click', async () => {
  const { validateKeyboardObservations } = await import('./sync-controller/quality-keyboard-probe.sys.mts');
  assert.doesNotThrow(() => validateKeyboardObservations(observations()));
  const untrustedKey = observations(); untrustedKey.keys[0].isTrusted = false;
  const wrongTarget = observations(); wrongTarget.keys[3].target = 'input';
  const repeat = observations(); repeat.keys[0].repeat = true;
  for (const bad of [untrustedKey, wrongTarget, repeat, { ...observations(), keys: observations().keys.slice(0, 5) },
    { ...observations(), inputs: [] }, { ...observations(), inputs: [{ isTrusted: false, value: 'a' }] },
    { ...observations(), clicks: [{ isTrusted: false }] }, { ...observations(), clicks: [{ isTrusted: true }, { isTrusted: true }] },
    { ...observations(), value: '' }, { ...observations(), focused: 'input' }, { ...observations(), windowFocused: false }]) {
    assert.throws(() => validateKeyboardObservations(bad), /keyboard probe/i);
  }
});
