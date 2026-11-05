/** Complete contributor inspection for native projection conflicts; no guessed aggregate is published. */
import { Contributions } from './contributions.mts';
import type { Assertion, Metadata } from './contracts.mts';
import type { CompleteProjectionReport, ContributorIdentity, Diagnostic, EdgeAccumulator } from './projection-contracts.mts';

/** Collect all metadata witnesses while retaining the normal edge/support identity rules. */
export class ProjectionContributions extends Contributions {
  readonly manualMetadata: Map<string, Metadata>;
  /** Initialize independent original-root metadata alongside inherited native edge grouping. */
  constructor() { super(); this.manualMetadata = new Map(); }

  /** Retain every present primitive contributor rather than throwing at the first mismatch. @param {object} edge Internal accumulator. @param {object} metadata Validated values. @param {object} identity Original assertion or producing support descriptor. @returns {void} */
  metadata(edge: EdgeAccumulator, metadata: Metadata, identity: ContributorIdentity): void {
    for (const [field, value] of Object.entries(metadata)) {
      const contributor = { ...identity, value }, previous = edge.fields.get(field);
      if (previous) previous.contributors!.push(contributor);
      else edge.fields.set(field, { value, contributor, contributors: [contributor] });
    }
  }

  /** Preserve each original manual value independently of equal-value union or conflicting neighbors. @param {object} root Valid projected traversal root with original ID. @returns {void} */
  manual(root: Assertion): void { super.manual(root); this.manualMetadata.set(root.id, { ...root.metadata }); }

  /** Publish a complete diagnostic report, withholding all aggregate relationships on any conflict. @param {number} transitions Completed bounded traversal attempts. @param {object[]} diagnostics Endpoint/self-edge diagnostics. @returns {object} {state,relationships,clusters,transitions,diagnostics}. */
  inspect(transitions: number, diagnostics: Diagnostic[]): CompleteProjectionReport {
    const edges = [...this.edges.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const clusters = edges.map(edge => ({ key: edge.key, source: { ...edge.source }, type: edge.type, target: { ...edge.target },
      assertions: [...edge.assertions].sort().map(id => ({ id, metadata: { ...this.manualMetadata.get(id) } })),
      supports: [...edge.supports.values()].sort((a, b) => a.root < b.root ? -1 : a.root > b.root ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)
        .map(support => ({ ...support, source: { ...support.source }, target: { ...support.target }, metadata: { ...support.metadata } })),
      conflicts: [...edge.fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .filter(([, entry]) => entry.contributors!.some(contributor => contributor.value !== entry.value))
        .map(([field, entry]) => ({ field, contributors: entry.contributors!.map(value => ({ ...value })) })),
    }));
    const conflicted = clusters.some(cluster => cluster.conflicts.length > 0);
    return conflicted ? { state: 'conflict', relationships: null, clusters, transitions, diagnostics }
      : { state: 'ready', relationships: super.relationships(), clusters, transitions, diagnostics };
  }
}
