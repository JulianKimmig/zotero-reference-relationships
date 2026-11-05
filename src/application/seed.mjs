/** Proposed initial explicit relationship catalog; creation never performs persistence. */
import { validateGraph } from '../domain/graph-contract.mjs';

/**
 * Build an independent schema-1 catalog for an explicitly requested library.
 * @param {string} scope Containing library: self or group:<id>.
 * @returns {object} Valid detached graph with no assertions or inference declarations.
 */
export function initialGraph(scope) {
  const catalog = [
    ['referencing', 'Referencing', 'The source reference cites or refers to the target reference.'],
    ['referenced-by', 'Referenced by', 'The source reference is cited or referred to by the target reference.'],
    ['similar', 'Similar', 'The source reference is similar to the target reference.'],
  ];
  return validateGraph({ schema: 1, library: scope, assertions: [], rules: [],
    types: catalog.map(([id, label, description]) => ({ id, label, description, version: 1, retired: false,
      fields: [{ id: 'note', label: 'Note', kind: 'string', required: false, options: [] }] })) });
}
