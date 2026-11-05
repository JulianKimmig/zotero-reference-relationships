/** Portable v1 authority types; untrusted values must still pass the runtime contract validators. */

/** JSON primitives supported by metadata and synchronized envelopes. */
export type JsonPrimitive = string | number | boolean | null;
/** Recursive finite JSON shape; runtime validation enforces prototypes, Unicode and byte bounds. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
/** Metadata preserves absent optional fields and present false, zero and empty text. */
export type Metadata = Record<string, string | number | boolean>;
/** Owner-relative scope survives first sign-in and excludes local numeric library identifiers. */
export type LibraryScope = 'self' | `group:${number}`;
/** Persisted bibliographic endpoint identity; native availability belongs to adapters. */
export interface ItemRef { library: LibraryScope; key: string }
/** Supported scalar field kinds; enum options are validated at runtime. */
export type FieldKind = 'string' | 'number' | 'boolean' | 'date' | 'enum';
/** Versioned type's metadata-field declaration. */
export interface MetadataField {
  id: string; label: string; kind: FieldKind; required: boolean; options: string[];
}
/** User-owned, versioned relationship definition. */
export interface RelationshipType {
  id: string; label: string; description: string; version: number; retired: boolean; fields: MetadataField[];
}
/** Original explicit authority, never replaced by generated or alias-projected edges. */
export interface Assertion {
  id: string; source: ItemRef; target: ItemRef; type: string; metadata: Metadata;
  createdAt: string; updatedAt: string;
}
/** Root predicate's operation controls its allowed operand. */
export type RuleCondition = { field: string; op: 'exists'; value: boolean }
  | { field: string; op: 'eq' | 'ne'; value: string | number | boolean };
/** Mapping expressions may read immutable root metadata or supply a scalar constant. */
export type MappingExpression = { kind: 'root'; field: string }
  | { kind: 'constant'; value: string | number | boolean };
/** Bounded rooted declaration; generated values never become persisted authority. */
export interface Rule {
  id: string; version: number; enabled: boolean; rootType: string; inputType: string; outputType: string;
  transform: 'same' | 'reverse'; conditions: RuleCondition[]; mapping: Record<string, MappingExpression>;
}
/** Exact v1 synchronized graph snapshot. */
export interface Graph {
  schema: 1; library: LibraryScope; types: RelationshipType[]; assertions: Assertion[]; rules: Rule[];
}
/** Ordering and identity of a relationship independent of its contributors. */
export interface Edge { source: ItemRef; target: ItemRef; type: string }
/** Portable digest is provided by the host rather than a domain dependency. */
export type Digest = (text: string) => Promise<string>;
