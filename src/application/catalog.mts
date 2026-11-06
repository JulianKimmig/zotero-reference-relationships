/** Pure versioned catalog proposals with explicit metadata migration and no persistence. */
import { check, exact, jsonCopy } from '../domain/values.mts';
import { validateType } from '../domain/metadata.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import type { Graph, Metadata, RelationshipType } from '../domain/contracts.mts';
import type { TypeChange } from './contracts.mts';

/** Compare validated type definitions without their separately governed version. @param {object} type Valid type. @returns {string} Stable definition signature. */
function signature(type: RelationshipType): string {
  const { version, ...definition } = type;
  return JSON.stringify(definition);
}

/** Detect schema changes whose old values/constraints require explicit migration review. @param {object} before Old type. @param {object} after Proposed type. @returns {boolean} Explicit migration required. */
function destructive(before: RelationshipType, after: RelationshipType): boolean {
  const old = new Map(before.fields.map(field => [field.id, field]));
  const next = new Map(after.fields.map(field => [field.id, field]));
  for (const field of before.fields) {
    const replacement = next.get(field.id);
    if (!replacement || field.kind !== replacement.kind) return true;
    if (field.kind === 'enum' && field.options.some(option => !replacement.options.includes(option))) return true;
  }
  return after.fields.some(field => field.required && !old.get(field.id)?.required);
}

/**
 * Reject destructive catalog identity deletion and inconsistent caller-controlled versions.
 * Every definition edit, including labels or retirement, advances exactly one version.
 * @param {object} before Valid current graph.
 * @param {object} after Valid proposed complete graph.
 * @returns {void} Throws before publication on an invalid transition.
 */
export function validateTypeTransition(before: unknown, after: unknown): void {
  validateCapturedTypeTransition(validateGraph(before), validateGraph(after));
}

/** Check definitions over application-owned validateGraph outputs without mutating or retaining them. @param current Private normalized current authority. @param proposed Private normalized proposal. @returns Identical catalog identity/version guards to the raw admission entry. */
export function validateCapturedTypeTransition(current: Graph, proposed: Graph): void {
  check(current.library === proposed.library, 'Catalog transition crosses libraries');
  const old = new Map(current.types.map(type => [type.id, type]));
  const next = new Map(proposed.types.map(type => [type.id, type]));
  for (const type of current.types) check(next.has(type.id), 'Existing types must be retired rather than deleted');
  for (const type of proposed.types) {
    const previous = old.get(type.id);
    const expected = previous ? previous.version + (signature(previous) === signature(type) ? 0 : 1) : 1;
    check(type.version === expected && Number.isSafeInteger(expected), 'Type version must match its definition transition');
  }
}

/**
 * Construct an independent graph for an explicit create/update with reviewed replacements.
 * No field is silently dropped or coerced. Migration entries replace complete metadata
 * only for existing assertions of this type; unchanged values retain their timestamps.
 * @param {object} snapshot Current complete validated authority or proposed seed.
 * @param {object} input Exact {kind,type,migration}; type omits version; migration null or [{id,metadata}].
 * @param {string} now Explicit current UTC timestamp used only for changed assertion values.
 * @returns {object} Valid complete graph; caller separately previews and commits it.
 */
export function proposeTypeChange(snapshot: unknown, input: TypeChange, now: string): Graph {
  const graph = validateGraph(snapshot), change = jsonCopy(input);
  exact(change, ['kind', 'type', 'migration']);
  check(['create', 'update'].includes(change.kind), 'Unknown catalog change kind');
  exact(change.type, ['id', 'label', 'description', 'retired', 'fields']);
  const candidate = validateType({ ...change.type, version: 1 });
  const index = graph.types.findIndex(type => type.id === candidate.id), previous = graph.types[index];
  check(change.kind === 'create' ? index < 0 : index >= 0,
    change.kind === 'create' ? 'Duplicate type identity' : 'Unknown type identity');
  check(change.migration === null || Array.isArray(change.migration), 'Migration must be null or an explicit array');
  if (change.kind === 'create') check(change.migration === null, 'A new type has no existing metadata to migrate');
  if (previous) {
    check(!destructive(previous, candidate) || change.migration !== null,
      'Destructive schema change requires an explicit metadata migration review');
    candidate.version = previous.version + (signature(previous) === signature(candidate) ? 0 : 1);
    graph.types[index] = validateType(candidate);
  } else graph.types.push(candidate);
  const replacements = new Map<string, Metadata>();
  for (const row of change.migration ?? []) {
    exact(row, ['id', 'metadata']);
    check(!replacements.has(row.id), 'Duplicate migration assertion identity');
    check(graph.assertions.some(assertion => assertion.id === row.id && assertion.type === candidate.id),
      'Migration must name an existing assertion of this type');
    replacements.set(row.id, row.metadata);
  }
  for (const assertion of graph.assertions) {
    if (!replacements.has(assertion.id)) continue;
    const metadata = replacements.get(assertion.id)!;
    if (JSON.stringify(assertion.metadata) !== JSON.stringify(metadata)) {
      assertion.metadata = metadata; assertion.updatedAt = now;
    }
  }
  const proposed = validateGraph(graph);
  validateTypeTransition(snapshot, proposed);
  return proposed;
}
