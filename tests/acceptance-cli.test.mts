/** Validate final signed acceptance inputs without opening native clients or reading account material. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAcceptanceArguments } from '../scripts/sync/acceptance.mts';

test('acceptance selects explicit existing artifact, durable configuration and native runtime', () => {
  assert.deepEqual(parseAcceptanceArguments(['--xpi', '/tmp/candidate.xpi', '--config', '/tmp/clients.json'], '/tmp/zotero'),
    { xpi: '/tmp/candidate.xpi', configPath: '/tmp/clients.json', executable: '/tmp/zotero' });
});
test('missing or additional acceptance arguments fail before any native setup', () => {
  for (const args of [[], ['--xpi', '/tmp/candidate.xpi'], ['--xpi', '/tmp/candidate.xpi', '--config', '/tmp/clients.json', '--extra']]) {
    assert.throws(() => parseAcceptanceArguments(args, '/tmp/zotero'));
  }
});
test('relative artifact or profile configuration paths are refused', () => {
  assert.throws(() => parseAcceptanceArguments(['--xpi', 'candidate.xpi', '--config', '/tmp/clients.json'], '/tmp/zotero'));
  assert.throws(() => parseAcceptanceArguments(['--xpi', '/tmp/candidate.xpi', '--config', 'clients.json'], '/tmp/zotero'));
});
test('missing or relative native executables cannot start acceptance', () => {
  for (const runtime of [undefined, '', 'zotero']) {
    assert.throws(() => parseAcceptanceArguments(['--xpi', '/tmp/candidate.xpi', '--config', '/tmp/clients.json'], runtime));
  }
});
