/** Generation-local opaque reviews retain private bindings and reject mutations to the exact reviewed inputs. */
import { check } from '../domain/values.mts';
import { canonicalJSON } from '../storage/canonical.mts';

/** One private token table owns review identity independently of serializable display data. */
export class ImportTokens<T> {
  #entries = new WeakMap<object, { document: unknown; mapping: unknown; documentSignature: string; mappingSignature: string; value: T }>();

  /** Capture the exact caller references and canonical signatures without exposing private review state. @param {unknown} document Reviewed external document. @param {unknown} mapping Reviewed mapping. @param {T} value Private binding. @returns {object} Empty frozen identity token. */
  issue(document: unknown, mapping: unknown, value: T): object {
    const token = Object.freeze({});
    this.#entries.set(token, { document, mapping, documentSignature: canonicalJSON(document, { maxBytes: 2_097_152 }),
      mappingSignature: canonicalJSON(mapping), value });
    return token;
  }

  /** Require an actual issued token and unchanged normalized reviewed inputs. @param {object} token Caller supplied identity. @returns {T} Private binding; never return this binding through a public service result. */
  get(token: object): T {
    const entry = this.#entries.get(token);
    check(!!entry, 'Import review is foreign, expired or already consumed; review again', 'conflict');
    try {
      check(canonicalJSON(entry.document, { maxBytes: 2_097_152 }) === entry.documentSignature
        && canonicalJSON(entry.mapping) === entry.mappingSignature, 'Import inputs changed; review again', 'conflict');
      return entry.value;
    } catch (error) { this.#entries.delete(token); throw error; }
  }

  /** Consume or explicitly cancel exactly one issued review. @param {object} token Issued identity. @returns {void} */
  retire(token: object): void { this.#entries.delete(token); }

  /** Retire every review on generation teardown. @returns {void} */
  clear(): void { this.#entries = new WeakMap(); }
}
