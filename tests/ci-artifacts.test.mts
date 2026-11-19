/** Real archive fixtures verify dynamic identity and immutable-byte admission. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile as execute } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execute);
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifact, stable } from '../scripts/ci/artifacts.mts';

/** Create an actual small production archive. @param version Native manifest version. @returns Absolute archive path. */
async function archive(version: string, maximum = '10.0.7'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'rr-ci-unit-'));
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ version, applications: { zotero: {
    id: 'reference-relationships@zotero-plugins.local', strict_min_version: '10.0.7', strict_max_version: maximum, update_url: 'https://example.test/updates.json',
  } } }));
  await writeFile(join(root, 'bootstrap.js'), '/** Fixture bootstrap. */');
  const xpi = join(root, 'fixture.xpi');
  await execFile('zip', ['-q', xpi, 'manifest.json', 'bootstrap.js'], { cwd: root });
  return xpi;
}

test('reads actual dynamic versions, hashes and file counts including actual prior 0.1.0', async () => {
  for (const version of ['0.1.0', '0.2.3']) {
    const receipt = await artifact(await archive(version));
    assert.equal(receipt.version, version); assert.equal(receipt.files, 2);
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/); await stable([receipt]);
  }
});

test('rejects malformed versions and mutation after inspection', async () => {
  await assert.rejects(artifact(await archive('')), /version/);
  const receipt = await artifact(await archive('0.2.0'));
  await writeFile(receipt.xpi, 'changed');
  await assert.rejects(stable([receipt]), /changed/);
});

test('inspects each archive own compatibility without rewriting predecessor bounds', async () => {
  assert.deepEqual((await artifact(await archive('0.1.1', '10.*'))).compatibility, { min: '10.0.7', max: '10.*' });
  assert.deepEqual((await artifact(await archive('0.1.0'))).compatibility, { min: '10.0.7', max: '10.0.7' });
});
