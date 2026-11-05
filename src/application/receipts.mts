/** Generation-local review ownership and immutable command/native-state bindings for user-confirmed saves. */
import { check, exact, jsonCopy } from '../domain/values.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import type { Graph, ItemRef } from '../domain/contracts.mts';
import type { Review } from './contracts.mts';

/** Private immutable binding is never accepted from callers or serialized as authority. */
interface Binding { snapshot: Graph; before: Graph; signature: string; expectedRevision: string | null; endpointRevision: string; refs: ItemRef[] }

/** Own actual issued review objects without retaining discarded editor receipts. */
export class IssuedReviews {
  issued: WeakMap<Review, Binding>;
  /** Initialize weak generation-local ownership. */
  constructor() { this.issued = new WeakMap(); }

  /** Bind the exact displayed command, native revision and guarded eligibility privately. @param {object} review Public complete preview result. @param {object} before Private validated current authority. @param {object[]} refs Reviewed commit-time eligibility references. @returns {void} */
  issue(review: Review, before: Graph, refs: ItemRef[]): void {
    const snapshot = validateGraph(review.snapshot);
    this.issued.set(review, { snapshot, before, signature: canonicalJSON(snapshot),
      expectedRevision: review.expectedRevision, endpointRevision: review.endpointRevision, refs: jsonCopy(refs) });
  }

  /** Reject foreign, expired or command-mutated receipts instead of applying an unreviewed proposal. @param {object} review Actual issued review object. @returns {object} Private immutable command binding. */
  get(review: Review): Binding {
    const binding = this.issued.get(review); check(!!binding, 'Review is not issued by this application; preview again', 'conflict');
    exact(review, ['expectedRevision', 'snapshot', 'changeSet', 'projection', 'endpointRevision']);
    check(review.expectedRevision === binding.expectedRevision && review.endpointRevision === binding.endpointRevision
      && canonicalJSON(review.snapshot) === binding.signature, 'Reviewed command changed; preview again', 'conflict');
    return binding;
  }

  /** Release all receipts permanently on application teardown. @returns {void} */
  clear() { this.issued = new WeakMap(); }
}
