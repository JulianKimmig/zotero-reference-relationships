/** Generation-local ownership of actual recovery reviews and private all-branch command/native bindings. */
import { ContractError, check, exact, jsonCopy } from '../domain/values.mts';
import { validateGraph } from '../domain/graph-contract.mts';
import { canonicalJSON } from '../storage/canonical.mts';
import type { Graph, ItemRef } from '../domain/contracts.mts';
import type { ResolutionReview } from './contracts.mts';

/** Only privately captured complete authorities and eligibility facts may guard publication. */
interface ResolutionBinding {
  snapshot: Graph; before: Graph[]; expectedHeads: string[]; endpointRevision: string; refs: ItemRef[]; signature: string;
}

/** Weak ownership preserves discarded-review collection and expires all receipts on teardown. */
export class IssuedResolutionReviews {
  #issued = new WeakMap<ResolutionReview, ResolutionBinding>();

  /** Recognize only actual issued objects, never a caller-supplied discriminator. @param review Candidate receipt. @returns Whether this owner issued the exact object. */
  owns(review: object): review is ResolutionReview { return this.#issued.has(review as ResolutionReview); }

  /** Detach the complete command and all branch/native facts from public display data. @param review Issued public review. @param before Complete branch graphs in head order. @param refs Native write-eligibility union. @returns Completion. */
  issue(review: ResolutionReview, before: Graph[], refs: ItemRef[]): void {
    const snapshot = validateGraph(review.snapshot);
    this.#issued.set(review, { snapshot, before: before.map(validateGraph), expectedHeads: [...review.expectedHeads],
      endpointRevision: review.endpointRevision, refs: jsonCopy(refs), signature: canonicalJSON(snapshot) });
  }

  /** Reject foreign, expired or command-mutated reviews; display deltas never become authority. @param review Actual issued receipt. @returns Private captured command, branch and guard binding. */
  get(review: ResolutionReview): ResolutionBinding {
    const binding = this.#issued.get(review);
    check(!!binding, 'Resolution review is not issued by this application; preview again', 'conflict');
    try {
      exact(review, ['expectedHeads', 'snapshot', 'branches', 'endpointRevision']);
      check(canonicalJSON(review.expectedHeads) === canonicalJSON(binding.expectedHeads)
        && canonicalJSON(review.snapshot) === binding.signature && review.endpointRevision === binding.endpointRevision,
      'Reviewed resolution changed; preview again', 'conflict');
    } catch (error) {
      if (error instanceof ContractError && error.code === 'conflict') throw error;
      throw new ContractError('conflict', 'Reviewed resolution changed; preview again');
    }
    return binding;
  }

  /** Permanently retire this generation's issued recovery receipts. @returns Completion. */
  clear(): void { this.#issued = new WeakMap(); }
}
