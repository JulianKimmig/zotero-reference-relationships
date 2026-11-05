/** Exact bounded pagination shared by stored and computed relationship readers. */
import { check, exact, jsonCopy } from './values.mts';

/** Public detached page request. */
export interface Page { offset: number; limit: number }

/** Validate and detach an untrusted page without coercion. @param input Exact offset/limit. @returns Valid bounded page. */
export function validatePage(input: unknown): Page {
  const page = jsonCopy(input); exact(page, ['offset', 'limit']);
  check(typeof page.offset === 'number' && Number.isSafeInteger(page.offset) && page.offset >= 0
    && typeof page.limit === 'number' && Number.isSafeInteger(page.limit) && page.limit >= 1 && page.limit <= 100,
  'Invalid relationship page');
  return { offset: page.offset, limit: page.limit };
}
