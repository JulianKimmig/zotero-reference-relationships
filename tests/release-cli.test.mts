/** Release CLI admission must fail before native initialization or packaging work. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseReleaseArguments } from '../scripts/sync/release.mts';

test('accepts two explicit frozen absolute XPIs and an explicit native executable', () => {
  assert.deepEqual(parseReleaseArguments(['--xpi', '/frozen/current.xpi', '--previous', '/frozen/prior.xpi'], { ZOTERO_BIN: '/native/zotero' }),
    { xpi: '/frozen/current.xpi', previousXPI: '/frozen/prior.xpi', executable: '/native/zotero' });
});

test('rejects missing, duplicate, reordered and extra CLI arguments before any native work', () => {
  for (const args of [[], ['--xpi', '/frozen/current.xpi'],
    ['--xpi', '/frozen/current.xpi', '--xpi', '/frozen/prior.xpi'],
    ['--previous', '/frozen/prior.xpi', '--xpi', '/frozen/current.xpi'],
    ['--xpi', '/frozen/current.xpi', '--previous', '/frozen/prior.xpi', '--build']]) {
    assert.throws(() => parseReleaseArguments(args, { ZOTERO_BIN: '/native/zotero' }), /Usage:/);
  }
});

test('requires distinct absolute current and prior artifact paths', () => {
  for (const [xpi, previous] of [['relative.xpi', '/frozen/prior.xpi'], ['/frozen/current.xpi', 'relative.xpi'],
    ['/frozen/same.xpi', '/frozen/same.xpi'], ['/frozen/current.xpi', '/frozen/sub/../current.xpi']]) {
    assert.throws(() => parseReleaseArguments(['--xpi', xpi, '--previous', previous], { ZOTERO_BIN: '/native/zotero' }), /absolute|distinct/i);
  }
});

test('requires absolute ZOTERO_BIN instead of searching PATH or choosing a default', () => {
  for (const executable of [undefined, '', 'zotero']) {
    assert.throws(() => parseReleaseArguments(['--xpi', '/frozen/current.xpi', '--previous', '/frozen/prior.xpi'], { ZOTERO_BIN: executable }), /ZOTERO_BIN/);
  }
});
