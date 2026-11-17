/** External note/transaction/native-item resources around the real production graph repository and application. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { RelationshipApplication } from '../../src/application/service.mts';
import { GraphRepository } from '../../src/storage/repository.mts';
import { chunkSnapshot, renderNote } from '../../src/storage/chunks.mts';
import { makeCommit } from '../../src/storage/envelopes.mts';
import { canonicalJSON } from '../../src/storage/canonical.mts';
import { initialGraph } from '../../src/application/seed.mts';
import { ContractError } from '../../src/domain/values.mts';
import { assertion, inverseRule } from './graph-contract.mts';
import type { Graph, ItemRef } from '../../src/domain/contracts.mts';
import type { ApplicationGateway, EndpointInspection, RepositoryFactory, WriteGuard } from '../../src/application/contracts.mts';
import type { Envelope, NoteTransport, PhysicalNote } from '../../src/storage/contracts.mts';

export const timestamp = '2026-11-17T12:00:00.000Z';

/** Hash actual canonical text without replacing any internal source behavior. @param text UTF-8 input. @returns SHA-256. */
export async function digest(text: string): Promise<string> { return createHash('sha256').update(text).digest('hex'); }

/** Create divergent complete branches, including endpoints removed by the proposed replacement. @returns Independent branch and replacement graphs. */
export function resolutionGraphs() {
  const left = initialGraph('self');
  left.assertions = [assertion({ metadata: { note: 'left' } })];
  left.rules = [inverseRule({ version: 4, mapping: { note: { kind: 'root', field: 'note' } } })];
  const right = structuredClone(left);
  right.assertions[0].metadata.note = 'right'; right.rules[0].version = 7; right.rules[0].enabled = false;
  right.assertions.push(assertion({ id: 'branch-only', type: 'similar',
    source: { library: 'self', key: 'CCCCCCCD' }, target: { library: 'self', key: 'DDDDDDDE' } }));
  return { left, right, proposed: structuredClone(left) };
}

/** External storage resource with atomic rollback, separately selectable native transaction boundaries and observable staged keys. */
export class ResolutionNotes {
  notes = new Map<string, PhysicalNote>(); serial = 0; inLock = false; enclosing = false; writable = true;
  failManifest = false; staged: string[] = []; boundaries: string[] = [];
  beforeLock: (() => Promise<void>) | null = null; afterCommit: (() => void) | null = null;

  /** Materialize externally delivered note data. @param body Complete envelope. @returns Unique native-style key. */
  async create(body: Envelope): Promise<string> {
    if (this.failManifest && body.format === 'reference-relationships/commit') throw Error('External note save failed');
    const key = `N${String(++this.serial).padStart(7, '0')}`;
    this.notes.set(key, { key, body: { ...structuredClone(body) }, html: renderNote(body) }); this.staged.push(key); return key;
  }

  /** Simulate independent complete remote delivery using actual production codecs. @param snapshot Complete graph. @param parents Delivered ancestry. @returns Manifest key. */
  async deliver(snapshot: Graph, parents: string[] = []): Promise<string> {
    const prepared = await chunkSnapshot(snapshot, digest), records = [];
    for (const body of prepared.records) records.push({ key: await this.create(body), hash: body.hash, index: body.index });
    return this.create(await makeCommit({ parents, records, snapshotHash: prepared.snapshotHash, bytes: prepared.bytes, createdAt: timestamp }, digest));
  }

  /** Own an external transaction and restore every staged note on failure. @param action Guarded production operation. @param event Whether independently scheduled. @returns Committed operation result. */
  async transaction<T>(action: () => Promise<T>, event: boolean): Promise<T> {
    this.boundaries.push(event ? 'event' : 'strict');
    if (this.enclosing && !event) throw new ContractError('storage', 'External transaction');
    if (this.beforeLock) await this.beforeLock();
    const checkpoint = structuredClone(this.notes); this.inLock = true;
    let result: T;
    try { result = await action(); }
    catch (error) { this.notes = checkpoint; throw error; }
    finally { this.inLock = false; }
    this.afterCommit?.(); return result;
  }

  /** Compose the application's guard at the actual external lock boundary. @param guard Application write guard or null for reads. @param event Independent event boundary. @returns Real GraphRepository. */
  repository(guard: WriteGuard | null = null, event = false): GraphRepository {
    const transport: NoteTransport = {
      identity: this, scope: 'self', scan: async () => structuredClone([...this.notes.values()]),
      get: async key => structuredClone(this.notes.get(key) ?? null), create: body => this.create(body),
      transaction: action => this.transaction(async () => { if (guard) await guard(); return action(); }, event),
      transactionFromEvent: action => this.transaction(action, true),
      assertWritable: () => { if (!this.writable) throw new ContractError('permission', 'External library is read-only'); },
    };
    return new GraphRepository({ transport, digest, now: () => timestamp });
  }
}

/** Compose actual application/storage code with mutable external native facts. @param graphs Independent complete branch inputs. @returns Application, resources, branch heads and mutable external controls. */
export async function resolutionFixture(graphs = resolutionGraphs()) {
  const notes = new ResolutionNotes(), heads = [await notes.deliver(graphs.left), await notes.deliver(graphs.right)].sort();
  const inspected: string[] = [], permissions: { locked: boolean; refs: ItemRef[] }[] = [];
  const facts = new Map<string, Partial<EndpointInspection>>();
  const controls: { yield: (() => Promise<void>) | null; inspect: (() => void) | null } = { yield: null, inspect: null };
  /** Resolve one external bibliographic fact. @param original Portable identity. @returns Detached native observation. */
  function fact(original: ItemRef): EndpointInspection {
    return structuredClone({ original, resolved: original, status: 'active', editable: true, title: original.key, ...facts.get(original.key) }) as EndpointInspection;
  }
  const gateway: ApplicationGateway = {
    ref() { throw Error('Unused external selection API'); },
    async inspect(original) { inspected.push(original.key); controls.inspect?.(); return fact(original); },
    async resolve(original) { const { resolved, status } = fact(original); return { original, resolved, status } as Awaited<ReturnType<ApplicationGateway['resolve']>>; },
    async describe(ref) { const value = fact(ref); return { ref, title: value.title, status: value.status, editable: value.editable }; },
    async assertWritable(scope, refs) {
      permissions.push({ locked: notes.inLock, refs: structuredClone(refs) });
      if (!notes.writable) throw new ContractError('permission', 'External library is read-only');
      for (const ref of refs) {
        assert.equal(ref.library, scope); const value = fact(ref);
        if (value.status !== 'active') throw new ContractError('endpoint', 'External endpoint unavailable');
        if (!value.editable) throw new ContractError('permission', 'External endpoint read-only');
      }
    },
  };
  const repositoryFor: RepositoryFactory = (_scope, guard) => notes.repository(guard);
  const repositoryForEvent: RepositoryFactory = (_scope, guard) => notes.repository(guard, true);
  const app = new RelationshipApplication({ gateway, repositoryFor, repositoryForEvent, digest, now: () => timestamp,
    newID: () => 'new-root', async yieldToHost() { if (controls.yield) await controls.yield(); } });
  return { app, notes, heads, graphs, inspected, permissions, facts, controls, gateway };
}

/** Assert both complete branches and all original notes survive a refused application operation. @param fixture External fixture. @param operation Public application call. @param code Expected error category. @returns Assertion completion. */
export async function refused(fixture: Awaited<ReturnType<typeof resolutionFixture>>, operation: () => Promise<unknown>, code: string): Promise<void> {
  const before = structuredClone(fixture.notes.notes);
  await assert.rejects(operation, { code }); assert.deepEqual(fixture.notes.notes, before);
  const repository = fixture.notes.repository();
  for (const [index, head] of fixture.heads.entries()) {
    assert.deepEqual((await repository.readHead(head)).snapshot, index === 0 ? fixture.graphs.left : fixture.graphs.right);
  }
}

/** Hash independently enumerated fixture facts in the contract's stable union order. @param keys Original endpoint keys. @returns Complete expected semantic native binding. */
export async function unionDigest(keys: string[]): Promise<string> {
  return digest(canonicalJSON(keys.sort().map(key => ({ original: { library: 'self', key }, resolved: { library: 'self', key }, status: 'active', editable: true }))));
}
