/** Valid owner-bound export inputs and exact byte-boundary graphs for portable transfer behavior. */
import { initialGraph } from '../../src/application/seed.mjs';
import { assertion, inverseRule } from './graph-contract.mjs';

export const exportedAt = '2026-11-05T12:00:00.000Z';

/** Build a complete graph retaining foreign catalog/rule versions and literal Unicode metadata. @param {string} library Explicit source scope. @returns {object} Valid original authority. */
export function transferGraph(library = 'self') {
  const graph = initialGraph(library); graph.types[0].version = 7; graph.types[1].version = 4;
  graph.assertions.push(assertion({ source: { library, key: 'AAAAAAAB' }, target: { library, key: 'BBBBBBBC' },
    metadata: { note: 'Café 你好 😀 <b>literal</b>' } }));
  graph.rules.push(inverseRule({ version: 9, mapping: { note: { kind: 'root', field: 'note' } } })); return graph;
}

/** Build an exactly 1 MiB graph using valid bounded primitive values and unique physical triples. @returns {object} Strict graph at its inclusive serialized byte limit. */
export function maximumGraph() {
  const graph = initialGraph('self');
  for (let index = 0; index < 1000; index++) graph.assertions.push(assertion({ id: `root-${index}`,
    source: { library: 'self', key: `A${index.toString(36).toUpperCase().padStart(7, '0')}` },
    target: { library: 'self', key: 'ZZZZZZZZ' }, metadata: { note: '' } }));
  let remaining = 1_048_576 - new TextEncoder().encode(JSON.stringify(graph)).byteLength;
  for (const root of graph.assertions) {
    const length = Math.min(1024, remaining); root.metadata.note = 'x'.repeat(length); remaining -= length;
  }
  if (remaining !== 0) throw new Error('Fixture cannot reach the graph byte boundary');
  return graph;
}
