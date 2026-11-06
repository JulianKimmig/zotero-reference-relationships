/** Captured private authorities share the exact public catalog/rule transition checks without redundant graph admission. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGraph } from '../src/domain/graph-contract.mts';
import { validateTypeTransition, validateCapturedTypeTransition } from '../src/application/catalog.mts';
import { validateRuleTransition, validateCapturedRuleTransition } from '../src/application/rule-transition.mts';
import { graphFixture, inverseRule, relationshipType } from './fixtures/graph-contract.mts';
import type { Graph } from '../src/domain/contracts.mts';

/** Capture a baseline and a semantically modified valid graph, as application preview does. @param modify Actual proposed definition change. @returns Valid normalized captures and their serialized originals. */
function captured(modify: (graph: Graph) => void) {
  const before = validateGraph(graphFixture()), proposed = validateGraph(before); modify(proposed);
  return { before, after: validateGraph(proposed) };
}

test('captured and raw catalog checks accept exactly versioned no-op, new and changed definitions without mutation', () => {
  for (const modify of [() => {}, (graph: Graph) => { graph.types.push(relationshipType('new-type')); },
    (graph: Graph) => { graph.types[0].label = 'Changed'; graph.types[0].version++; }]) {
    const { before, after } = captured(modify), original = JSON.stringify([before, after]);
    validateTypeTransition(before, after); validateCapturedTypeTransition(before, after);
    assert.equal(JSON.stringify([before, after]), original);
  }
});

test('captured catalog checks retain retirement, library and exact-version guards', () => {
  for (const modify of [(graph: Graph) => { graph.types.pop(); }, (graph: Graph) => { graph.types[0].label = 'Unversioned'; },
    (graph: Graph) => { graph.types[0].version++; }, (graph: Graph) => {
      graph.library = 'group:123'; for (const root of graph.assertions) root.source.library = root.target.library = graph.library;
    }]) {
    const { before, after } = captured(modify);
    assert.throws(() => validateTypeTransition(before, after), { code: 'validation' });
    assert.throws(() => validateCapturedTypeTransition(before, after), { code: 'validation' });
  }
});

test('captured and raw rule checks preserve new/change/no-op/deletion semantics without mutation', () => {
  for (const modify of [() => {}, (graph: Graph) => { graph.rules.push(inverseRule({ id: 'extra' })); },
    (graph: Graph) => { graph.rules[0].enabled = false; graph.rules[0].version++; }, (graph: Graph) => { graph.rules = []; }]) {
    const { before, after } = captured(modify), original = JSON.stringify([before, after]);
    validateRuleTransition(before, after); validateCapturedRuleTransition(before, after);
    assert.equal(JSON.stringify([before, after]), original);
  }
});

test('captured rule checks reject changed-without-version and version-without-change independently', () => {
  for (const modify of [(graph: Graph) => { graph.rules[0].enabled = false; }, (graph: Graph) => { graph.rules[0].version++; }]) {
    const { before, after } = captured(modify);
    assert.throws(() => validateRuleTransition(before, after), { code: 'validation' });
    assert.throws(() => validateCapturedRuleTransition(before, after), { code: 'validation' });
  }
});
