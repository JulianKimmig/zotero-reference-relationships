/** Compile-time regression checks for portable authority contracts and rejected invalid declarations. */
import type { Graph, ItemRef, RuleCondition, MappingExpression } from '../src/domain/contracts.mts';

/** Exercise assignability without running an invalid authority through application code. @returns Nothing. */
function authorityContracts(): void {
  const ref: ItemRef = { library: 'self', key: 'AAAAAAAA' };
  const graph: Graph = { schema: 1, library: 'self', types: [], assertions: [], rules: [] };
  const condition: RuleCondition = { field: 'present', op: 'exists', value: false };
  const expression: MappingExpression = { kind: 'root', field: 'source' };
  void [ref, graph, condition, expression];
  // @ts-expect-error Local numeric library IDs are not portable identities.
  const local: ItemRef = { library: 1, key: 'AAAAAAAA' };
  // @ts-expect-error The existence predicate requires a boolean operand.
  const predicate: RuleCondition = { field: 'present', op: 'exists', value: 'yes' };
  // @ts-expect-error Mappings cannot read generated relationship metadata.
  const generated: MappingExpression = { kind: 'generated', field: 'source' };
  // @ts-expect-error No storage schema change is authorized by a language migration.
  const schema: Graph = { ...graph, schema: 2 };
  void [local, predicate, generated, schema];
}
void authorityContracts;
