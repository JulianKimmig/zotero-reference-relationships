/** Pure, detached NFC relationship-type and metadata validation, shared with rule field constants. */
import { check, exact, identifier, text, jsonCopy } from './values.mts';
import type { Metadata, MetadataField, RelationshipType } from './contracts.mts';

const TYPE_KEYS = ['id', 'label', 'description', 'version', 'retired', 'fields'] as const;
const FIELD_KEYS = ['id', 'label', 'kind', 'required', 'options'] as const;
const KINDS = new Set(['string', 'number', 'boolean', 'date', 'enum']);

/**
 * Validate an already detached, normalized metadata-field definition.
 * @param {object} field Exact definition with id, label, kind, required and options.
 * @returns {void} Throws ContractError for unsupported kinds, invalid bounds or duplicate options.
 */
function validateField(field: unknown): asserts field is MetadataField {
  exact(field, FIELD_KEYS);
  identifier(field.id);
  text(field.label, 128, 1);
  check(typeof field.kind === 'string' && KINDS.has(field.kind), 'Unsupported metadata field kind');
  check(typeof field.required === 'boolean', 'Field required flag must be boolean');
  check(Array.isArray(field.options), 'Field options must be an array');
  if (field.kind === 'enum') {
    check(field.options.length >= 1 && field.options.length <= 64, 'Enum requires 1..64 options');
    for (const option of field.options) text(option, 1024, 1);
    check(new Set(field.options).size === field.options.length, 'Enum options must be unique after NFC normalization');
  } else {
    check(field.options.length === 0, 'Only enum fields may declare options');
  }
}

/**
 * Normalize and validate an exact relationship-type definition without changing caller data.
 * Retirement is accepted here; the application controls whether a type may be used in a command.
 * @param {*} type Candidate with id, label, description, version, retired and fields.
 * @returns {object} Detached NFC type with at most 16 unique, validated fields.
 */
export function validateType(type: unknown): RelationshipType {
  const result = jsonCopy(type);
  exact(result, TYPE_KEYS);
  identifier(result.id);
  text(result.label, 128, 1);
  text(result.description, 4096);
  check(typeof result.version === 'number' && Number.isSafeInteger(result.version) && result.version > 0, 'Type version must be a positive safe integer');
  check(typeof result.retired === 'boolean', 'Type retired flag must be boolean');
  check(Array.isArray(result.fields) && result.fields.length <= 16, 'Type requires at most 16 fields');
  const identifiers = new Set<string>();
  for (const field of result.fields) {
    validateField(field);
    check(!identifiers.has(field.id), 'Duplicate metadata field ID');
    identifiers.add(field.id);
  }
  return result as RelationshipType;
}

/**
 * Assert a strict Gregorian date without platform date parsing, rollover or timezone interpretation.
 * @param {*} value Date string with exactly YYYY-MM-DD, year 0001 through 9999.
 * @returns {void} Throws ContractError on invalid dates, including non-leap February 29.
 */
function date(value: unknown): void {
  check(typeof value === 'string' && value.length === 10 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value),
    'Date must use exactly YYYY-MM-DD');
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  check(year >= 1 && month >= 1 && month <= 12, 'Invalid Gregorian year or month');
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  check(day >= 1 && day <= days[month - 1], 'Invalid Gregorian day');
}

/**
 * Validate a normalized JSON primitive against an already validated field definition.
 * Strings are plain text with no executable or HTML interpretation in this layer.
 * @param {object} field Validated metadata-field definition.
 * @param {*} value Detached normalized candidate primitive; null is always invalid.
 * @returns {string|number|boolean} Validated primitive, including false, zero or empty text.
 */
function fieldValue(field: MetadataField, value: unknown): Metadata[string] {
  check(value !== null, 'Metadata values cannot be null');
  switch (field.kind) {
    case 'string': text(value, 1024); break;
    case 'number':
      check(typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12,
        'Metadata number must be finite with absolute value at most 1e12');
      break;
    case 'boolean': check(typeof value === 'boolean', 'Metadata value must be boolean'); break;
    case 'date': date(value); break;
    case 'enum':
      check(typeof value === 'string' && field.options.includes(value), 'Metadata value must match an enum option');
      break;
  }
  return value as Metadata[string];
}

/**
 * Validate a single rule constant/predicate value independently of unrelated required root fields.
 * @param {*} field Complete metadata-field definition, validated after strict JSON normalization.
 * @param {*} value Candidate metadata primitive.
 * @returns {string|number|boolean} Detached NFC primitive obeying the same metadata limits.
 */
export function validateFieldValue(field: unknown, value: unknown): Metadata[string] {
  const definition = jsonCopy(field);
  const normalized = jsonCopy(value);
  validateField(definition);
  return fieldValue(definition, normalized);
}

/**
 * Normalize and validate metadata using an exact type, preserving caller objects on success/failure.
 * Unknown keys, null and absent required fields fail; absent optional fields remain absent.
 * @param {*} type Complete relationship-type definition; retired types remain valid for reading.
 * @param {*} metadata Plain object containing only known field IDs and supported primitive values.
 * @returns {object} Detached NFC metadata with the same present fields and validated primitive values.
 */
export function validateMetadata(type: unknown, metadata: unknown): Metadata {
  const definition = validateType(type);
  const result = jsonCopy(metadata);
  const fields = new Map(definition.fields.map(field => [field.id, field]));
  check(result !== null && typeof result === 'object' && !Array.isArray(result), 'Metadata must be a plain object');
  exact(result, Object.keys(result));
  for (const key of Object.keys(result)) {
    check(fields.has(key), `Unknown metadata field: ${key}`);
    fieldValue(fields.get(key)!, result[key]);
  }
  for (const field of definition.fields) {
    check(!field.required || Object.hasOwn(result, field.id), `Missing required metadata field: ${field.id}`);
  }
  return result as Metadata;
}
