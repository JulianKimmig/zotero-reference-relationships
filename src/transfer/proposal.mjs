/** Complete import proposals preserve foreign histories and reject any ambiguous merge before native review/publication. */
import { ContractError, check } from '../domain/values.mjs';
import { validateGraph, edgeKey } from '../domain/graph-contract.mjs';
import { canonicalJSON } from '../storage/canonical.mjs';

/** Merge complete normalized entities by stable identity without version resets or implicit conflict choices. @param {object[]} current Detached current entities. @param {object[]} incoming Detached imported entities. @param {string} kind Entity collection diagnostic. @returns {object[]} Current order followed by new imported identities. */
function entities(current, incoming, kind) {
  const known = new Map(current.map(entity => [entity.id, entity])), result = [...current];
  for (const entity of incoming) {
    const previous = known.get(entity.id);
    if (previous) {
      if (canonicalJSON(previous) !== canonicalJSON(entity)) throw new ContractError('conflict',
        'Imported identity has a different complete payload', { kind, id: entity.id });
    } else { known.set(entity.id, entity); result.push(entity); }
  }
  return result;
}

/** Propose one complete same-scope graph using explicit merge/replace semantics; null represents genuinely uninitialized authority. @param {object|null} currentGraph Actual current graph or uninitialized null. @param {object} incomingGraph Complete explicitly mapped foreign graph. @param {string} operation Explicit merge or replace. @returns {object} Detached validated GraphSnapshot preserving imported versions/timestamps; no native mutation or acceptance. */
export function mergeSnapshots(currentGraph, incomingGraph, operation) {
  check(['merge', 'replace'].includes(operation), 'Choose merge or replace explicitly');
  const incoming = validateGraph(incomingGraph);
  if (currentGraph === null) return incoming;
  const current = validateGraph(currentGraph); check(current.library === incoming.library, 'Cannot import graphs from different scopes');
  if (operation === 'replace') return incoming;
  const proposed = { schema: 1, library: current.library,
    types: entities(current.types, incoming.types, 'types'), assertions: entities(current.assertions, incoming.assertions, 'assertions'),
    rules: entities(current.rules, incoming.rules, 'rules') };
  const triples = new Map();
  for (const root of proposed.assertions) {
    const key = edgeKey(root), previous = triples.get(key);
    if (previous) throw new ContractError('conflict', 'Imported ordered relationship triple has a different original identity',
      { kind: 'assertions', ids: [previous, root.id], key });
    triples.set(key, root.id);
  }
  return validateGraph(proposed);
}
