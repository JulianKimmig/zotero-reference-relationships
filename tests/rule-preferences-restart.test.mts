/** Restart verification reads real application authority and treats a deleted rule's absence as required evidence. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { initialGraph } from '../src/application/seed.mts';
import { assertion, inverseRule } from './fixtures/graph-contract.mts';
import { resolutionFixture } from './fixtures/resolution.mts';
import { verifyRestartRules } from './sync-controller/rule-preferences-helpers.sys.mts';
import type { Graph } from '../src/domain/contracts.mts';
import type { RelationshipApplication } from '../src/application/service.mts';

/** Build complete self-contained authority after disabling the conditional rule and deleting the symmetric rule. @returns Valid graph with the required surviving declaration. */
function restartGraph(): Graph {
  const graph = initialGraph('self');
  graph.assertions = [assertion()];
  graph.rules = [inverseRule({ id: 'conditional-ui', version: 2, enabled: false })];
  return graph;
}

/** Publish and read through the real application/repository using only external note and native-resource fixtures; verification must leave authority untouched. @param graph Complete fixture authority. @param verify Behavioral assertion using the actual application. @returns Assertion completion with application teardown. */
async function withAuthority(graph: Graph, verify: (app: RelationshipApplication) => Promise<void>): Promise<void> {
  const fixture = await resolutionFixture();
  try {
    const result = await fixture.app.applyResolution(graph, fixture.heads);
    assert.deepEqual(await fixture.app.read('self'), { state: 'ready', head: result.revision, snapshot: graph });
    const before = structuredClone(fixture.notes.notes);
    await verify(fixture.app);
    assert.deepEqual(fixture.notes.notes, before);
    assert.deepEqual(await fixture.app.read('self'), { state: 'ready', head: result.revision, snapshot: graph });
  } finally { fixture.app.stop(); }
}

test('restart accepts a disabled conditional rule and the absent deleted symmetric rule', async () => {
  await withAuthority(restartGraph(), verifyRestartRules);
});

test('restart labels a missing required conditional rule', async () => {
  const graph = restartGraph(); graph.rules = [];
  await withAuthority(graph, async app => {
    await assert.rejects(verifyRestartRules(app), { message: 'Missing rule preference evidence: restart.conditional-ui' });
  });
});

test('restart rejects a conditional rule that is still enabled', async () => {
  const graph = restartGraph(); graph.rules[0].enabled = true;
  await withAuthority(graph, async app => {
    await assert.rejects(verifyRestartRules(app), { message: 'Restart lost disable/delete state' });
  });
});

test('restart rejects a symmetric rule that survived deletion', async () => {
  const graph = restartGraph();
  graph.rules.push(inverseRule({ id: 'symmetric-ui', rootType: 'similar', inputType: 'similar', outputType: 'similar' }));
  await withAuthority(graph, async app => {
    await assert.rejects(verifyRestartRules(app), { message: 'Restart lost disable/delete state' });
  });
});
