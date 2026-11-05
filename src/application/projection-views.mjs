/** Detached bounded pages over complete native projection inspections and their effective indexes. */
import { check, exact, jsonCopy } from '../domain/values.mjs';
import { indexRelationships, queryRelationships } from './relationship-index.mjs';

/** Bind a completed inspection to a private ready index, never indexing a conflicted partial graph. @param {object} snapshot Original authority. @param {object} observation Native rows, binding and complete report. @returns {object} Private observation/index bundle. */
export function indexProjection(snapshot, observation) {
  return { ...observation, index: observation.report.state === 'ready'
    ? indexRelationships(snapshot, observation.report.relationships, observation.report.transitions) : null };
}

/** Query the complete ready projected graph through the established detached page contract. @param {object} projection Private bundle. @param {object} ref Active canonical ItemRef. @param {string} direction Direction. @param {string|null} typeFilter Type ID or all. @param {object} page Exact pagination. @param {string} revision Manifest key. @returns {object} Public bounded relationship page. */
export function projectedPage(projection, ref, direction, typeFilter, page, revision) {
  check(projection.report.state !== 'endpoint-conflict', 'Native aliases are unresolved; inspect original relationships and choose an explicit repair', 'endpoint');
  check(projection.report.state === 'ready', 'Projected relationships have conflicting contributors; inspect and repair them', 'conflict');
  const result = queryRelationships(projection.index, ref, direction, typeFilter, page);
  return { revision, ...result, diagnostics: jsonCopy(projection.report.diagnostics) };
}

/** Detach all original manual metadata, supports and conflict witnesses for one inspected cluster. @param {object} cluster Private validated contributor cluster. @returns {object} Independent public cluster. */
function copyCluster(cluster) {
  return { ...cluster, source: { ...cluster.source }, target: { ...cluster.target },
    assertions: cluster.assertions.map(root => ({ id: root.id, metadata: { ...root.metadata } })),
    supports: cluster.supports.map(support => ({ ...support, source: { ...support.source }, target: { ...support.target }, metadata: { ...support.metadata } })),
    conflicts: cluster.conflicts.map(conflict => ({ field: conflict.field, contributors: conflict.contributors.map(value => ({ ...value })) })),
  };
}

/** Return bounded clusters or explicit original assertions when aggregate resolution is unavailable. @param {object} projection Private observation/report bundle. @param {object} input Exact {offset,limit}. @param {string} revision Current manifest key. @returns {object} {revision,state,diagnostics,clusters,total,nextOffset}, plus originals on endpoint-conflict with clusters:null. */
export function inspectionPage(projection, input, revision) {
  const page = jsonCopy(input); exact(page, ['offset', 'limit']);
  check(Number.isSafeInteger(page.offset) && page.offset >= 0 && Number.isSafeInteger(page.limit) && page.limit >= 1 && page.limit <= 100, 'Invalid inspection page');
  const { report } = projection;
  if (report.state === 'endpoint-conflict') {
    const total = report.originals.length, originals = jsonCopy(report.originals.slice(page.offset, page.offset + page.limit));
    return { revision, state: report.state, diagnostics: jsonCopy(report.diagnostics), clusters: null, originals, total,
      nextOffset: page.offset + originals.length < total ? page.offset + originals.length : null };
  }
  const total = report.clusters.length;
  const clusters = report.clusters.slice(page.offset, page.offset + page.limit).map(copyCluster);
  return { revision, state: report.state, diagnostics: jsonCopy(report.diagnostics), clusters, total,
    nextOffset: page.offset + clusters.length < total ? page.offset + clusters.length : null };
}
