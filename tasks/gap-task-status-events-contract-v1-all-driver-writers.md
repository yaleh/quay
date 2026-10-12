---
id: gap-task-status-events-contract-v1-all-driver-writers
title: "task_trace P0: task-status-events contract v1
  (eventId/seq/epoch/cause/evidence.commit, locked append) + wire ALL driver
  status writers + git-evidenced reconcile"
status: ready
labels:
  - gap
  - task-trace
  - observability
parent: null
children: []
extra: {}
depends_on:
  - gap-open-semantic-discovery-routine-track
---
## Proposal
Quay already has a task status-transition event writer, `packages/quay/src/kernel/task-transition.ts` `appendTaskStatusEvent`, writing to carrier `.quay/task-status-events.jsonl` (owner registered in `docs/carrier-registry.json`; built by the done tasks `gap-goal030-kernel-task-transition-and-status-event` / `gap-goal030-promotion-writes-via-kernel-transition`). It is the right single carrier. Two measured problems make it unusable as a transition source.

**1. Coverage (2026-10-12 reading, git on develop, non-merge commits since the first event 2026-10-08T23:30Z):**
- **Measured from git:** 137 todo→ready, 139 ready→done, 6 needs-human→todo, 6 done→ready, 4 ready→needs-human, 2 todo→needs-human, plus 4 others.
- **Measured from the carrier:** 136 records, ALL `actor:"ready-pool-check --apply"` / `kind:"promote"`. The one live caller is `ready-pool-check.ts:3700`.
- **⇒ Every non-promotion transition has zero events:**
  - fan-in `worker-fan-in.ts` :1462/:1470/:1477/:1516 (ready→done, the done→ready "未落地" reset);
  - `driver-filters.ts` :586/:931 (needs-human and other driver flips).

**2. Contract.** A record is `{ts, taskId, from, to, kind, actor, reason?, writerModule, entry, pid}`, which leaves out what a consumer needs:
- no transition id (idempotent dedup);
- no sequence/cursor (resume, replay);
- no commit carrying the status change (the evidence);
- no cause (run / session / correlation);
- no schema version;
- an unlocked `appendFileSync` (interleaving risk with several driver processes).

The **cross-project need** is the ClaudeCodeUI proposal `docs/proposals/cloudcli-mcp-control-observability-2026-10.md` §4 2b′. It explicitly leaves the Quay-side `task_trace` export unfiled, and its GOAL-042 `changes` feed still infers Quay progress from cached snapshots or commit titles. The **in-repo need** is the semantic-first continuous discovery loop (`gap-open-semantic-discovery-routine-track`): it benefits from reliable "what actually changed" context.

**Scope guard: record only.** This is a reliable OBSERVATION record:
- no scheduler, no wake executor, no new orchestration layer;
- nothing reads it to make a dispatch or promotion decision;
- zero model calls.
Semantic problem discovery stays the LLM's own source exploration.

## Plan
1. **Contract v1** (`schema:"task-status-event/v1"`), extending the existing record. Old v0 lines stay as written and are read as v0.

   | Field | Meaning |
   |---|---|
   | `eventId` | Deterministic hash of (taskId, from, to, commit ?? at, writer), so a retried write produces the same id |
   | `seq` | Monotonic per carrier, assigned under the lock |
   | `carrierEpoch` | Set at carrier creation and never reused; changes on rotation so consumers detect a rebase |
   | `taskId`, `from`, `to`, `kind` | As today (`kind` from `LIFECYCLE_EDGES`) |
   | `at` | Time the status write happened |
   | `recordedAt` | Time the event line was appended |
   | `actor` | `{kind: promotion-driver \| worker-driver \| fan-in \| goal-driver \| cli \| mcp \| human, id}` |
   | `cause` | `{runId?, dispatchId?, sessionId?, correlationId?}`; only what the writer actually has, otherwise absent (never guessed) |
   | `evidence` | `{commit?: sha carrying the status line change, statusBlobSha?: git hash-object of the written file}` |
   | `producer` | `{writerModule, entry, pid, host, codeRev}` |

2. **Write semantics: at-least-once, idempotent.**
   - The event is appended AFTER the status write is durable. When the writer commits, the commit sha goes in `evidence.commit`. If the writer has no commit yet, `commit:null` plus a reason.
   - A crash between write and append leaves a gap. It is closed by step 4, never by guessing.
   - The append happens under an exclusive-create lock: port `acquireLock`/`withLock` from `packages/quay-native/src/store.ts`, as `gate-event-store.ts`'s own M161 note recommends.
   - An event-append failure never fails or reverts the status write. It is logged (stderr plus a counter) and left for reconcile, because the record must not become a new gate.
3. **Wire every driver-layer status writer through the kernel writer:** promotion (already), fan-in (all four sites), and `driver-filters.ts` (both sites).
4. **Reconciliation** (`plugin/scripts/task-status-events-reconcile.ts`, report-only by default, `--apply` appends):
   - compare the carrier against `git log -p` status-line changes on develop since a given point;
   - for each git-evidenced transition with no event, append one with `source:"git"`, `inferred:true`, `evidence.commit`, `actor.kind:"unknown"` unless the commit or its trailers establish the writer;
   - never invent `cause` or `at` beyond the commit time;
   - transitions without git evidence are never created.
   History before the carrier existed is reconciled the same way, `inferred:true` only.
5. **Retention.** Append-only with no truncation in v1. Any future rotation must bump `carrierEpoch` and keep the old file readable (documented, not built).

## Acceptance Criteria
- [ ] Unit tests exit 0, covering:
  - (a) v1 record shape, with `eventId` stable across a retried append of the same transition;
  - (b) `seq` strictly increasing under two concurrent writer PROCESSES (real child processes), with no interleaved or corrupt lines;
  - (c) a failed event append does not fail the status write and is counted;
  - (d) each wired writer (promotion, fan-in done, fan-in reset, needs-human, the second `driver-filters` site) emits exactly one v1 event per status change, with `evidence.commit` when it committed;
  - (e) reconcile on a fixture repo appends `inferred:true` events only for git-evidenced transitions missing from the carrier, and is idempotent (a second run appends 0);
  - (f) a v0 line is read as v0, not rejected and not upgraded in place.
- [ ] Negative controls, each in a scratch copy, pasting the red output:
  - remove the lock ⇒ (b) red, or state honestly how the race was forced;
  - drop the `eventId` determinism ⇒ (a) red.
- [ ] Coverage on real data: run reconcile in report mode on the production carrier against develop since 2026-10-08T23:30Z. Paste the per-edge table (git count / event count / missing), then the same table after this task lands and the first fan-in done has happened. The fan-in ready→done row must have events after landing. （待外部）
- [ ] Production reading: the first real ready→done fan-in after landing has a v1 event whose `evidence.commit` resolves on develop to a commit whose diff flips that task's status to done. Paste both. （待外部）
- [ ] Zero model calls; no reader of the carrier makes dispatch, promotion or landing decisions (static control naming the readers).

## Definition of Done
- All AC ticked with output pasted (production AC may stay （待外部）).
- `scripts/test.sh --for-task gap-task-status-events-contract-v1-all-driver-writers` green.
- `import-graph-check` kernel boundary still clean.

## Touches
- tasks/gap-task-status-events-contract-v1-all-driver-writers.md
- packages/quay/src/kernel/task-transition.ts
- packages/quay/test/task-transition.test.mjs
- plugin/scripts/ready-pool-check.ts
- plugin/scripts/worker-fan-in.ts
- plugin/scripts/driver-filters.ts
- plugin/scripts/task-status-events-reconcile.ts
- plugin/test/task-status-events-reconcile.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json
