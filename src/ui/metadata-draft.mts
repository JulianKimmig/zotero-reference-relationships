/** Data-only metadata drafts retain presence and native-sanitized values without retaining offscreen controls. */
import type { Metadata, RelationshipType } from '../domain/contracts.mts';
import { metadataControl } from './metadata-control.mts';

/** Raw editable value and explicit presence, preserving intentional empty strings separately from absence. */
export interface MetadataValueDraft { value: string; present: boolean }
/** One owned draft has exactly one entry per proposed schema field. */
export type MetadataDraft = Record<string, MetadataValueDraft>;

/** Initialize complete logical replacements using one reusable real native widget per field, independent of row count. @param document Native widget owner. @param type Proposed schema. @param values Original metadata, including removed or changed-kind fields. @returns Detached per-row drafts with the same native sanitization as visible forms; no original data is modified. */
export function metadataDrafts(document: Document, type: Pick<RelationshipType, 'fields'>, values: Metadata[]): MetadataDraft[] {
  const controls = type.fields.map(field => ({ field, control: metadataControl(document, field) }));
  return values.map(metadata => {
    const draft: MetadataDraft = {};
    for (const { field, control } of controls) {
      control.value = Object.hasOwn(metadata, field.id) ? String(metadata[field.id]) : '';
      draft[field.id] = { value: control.value, present: field.required || Object.hasOwn(metadata, field.id) };
    }
    return draft;
  });
}

/** Collect present typed primitives without native widgets or persistence; domain validation still owns requirements and limits. @param type Proposed field schema. @param draft Owned field values and presence. @returns Fresh complete typed metadata with removed fields excluded. */
export function readMetadataDraft(type: Pick<RelationshipType, 'fields'>, draft: MetadataDraft): Metadata {
  const metadata: Metadata = {};
  for (const field of type.fields) {
    const state = draft[field.id];
    if (!state.present || (field.kind !== 'string' && state.value === '')) continue;
    metadata[field.id] = field.kind === 'number' ? Number(state.value)
      : field.kind === 'boolean' ? state.value === 'true' : state.value;
  }
  return metadata;
}
