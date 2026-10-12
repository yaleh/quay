---
id: gap-task-status-events-contract-v1-all-driver-writers
title: "task_trace P0: task-status-events contract v1
  (eventId/seq/epoch/cause/evidence.commit, locked append) + wire ALL driver
  status writers + git-evidenced reconcile"
status: done
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
- [x] Unit tests exit 0, covering:
  - (a) v1 record shape, with `eventId` stable across a retried append of the same transition;
  - (b) `seq` strictly increasing under two concurrent writer PROCESSES (real child processes), with no interleaved or corrupt lines;
  - (c) a failed event append does not fail the status write and is counted;
  - (d) each wired writer (promotion, fan-in done, fan-in reset, needs-human, the second `driver-filters` site) emits exactly one v1 event per status change, with `evidence.commit` when it committed;
  - (e) reconcile on a fixture repo appends `inferred:true` events only for git-evidenced transitions missing from the carrier, and is idempotent (a second run appends 0);
  - (f) a v0 line is read as v0, not rejected and not upgraded in place.
- [x] Negative controls, each in a scratch copy, pasting the red output:
  - remove the lock ⇒ (b) red, or state honestly how the race was forced;
  - drop the `eventId` determinism ⇒ (a) red.
- [ ] Coverage on real data: run reconcile in report mode on the production carrier against develop since 2026-10-08T23:30Z. Paste the per-edge table (git count / event count / missing), then the same table after this task lands and the first fan-in done has happened. The fan-in ready→done row must have events after landing. （待外部）
- [ ] Production reading: the first real ready→done fan-in after landing has a v1 event whose `evidence.commit` resolves on develop to a commit whose diff flips that task's status to done. Paste both. （待外部）
- [x] Zero model calls; no reader of the carrier makes dispatch, promotion or landing decisions (static control naming the readers).

## Evidence

**Run 1 — AC1(a)(b)(c)(f) + the kernel contract** (`node --test packages/quay/test/task-transition.test.mjs`, 13/13 pass):
```
✔ (a) appendTaskStatusEvent: the v1 record shape, and `eventId` is STABLE across a retried append (5.98ms)
✔ (b) seq is strictly increasing under two concurrent writer PROCESSES, with no corrupt line (85.21ms)
✔ (c) a failed append does not throw, is COUNTED, and never looks like a success (1.82ms)
✔ (f) a v0 line is read as v0 — not rejected, not upgraded, and the v1 lines beside it still classify (3.48ms)
ℹ tests 13  ℹ pass 13  ℹ fail 0
```
(b) spawns TWO real child processes (`spawn`, not `spawnSync`) appending 25 events each into one carrier; the assertions are `seqs === [0..49]` exactly, `corrupt === 0`, 50 distinct `eventId`s.

**Run 2 — AC1(e) reconcile** (`node --test plugin/test/task-status-events-reconcile.test.mjs`, 6/6 pass):
```
✔ collectGitTransitions: reads status changes from REAL commits, pairing each with its own commit
✔ reconcile: a v0 carrier line matches BY SHAPE; only the truly-missing transitions are reported
✔ report mode is the default and writes NOTHING (the production reading's mode)
✔ (e) --apply appends inferred:true ONLY for git-evidenced transitions, then is idempotent (2nd run appends 0)
✔ a transition with no git evidence is NEVER invented; a corrupt carrier line is counted, not fatal
✔ fail-closed boundaries: an unreadable ref, and no derivable --since, both exit 2 (never a silent empty report)
ℹ tests 6  ℹ pass 6  ℹ fail 0
```
The idempotency run reads back: `second.appended === 0`, `matchedByCommit === 2`, `matchedByShape === 1`, carrier still 3 lines.

**Run 3 — AC1(d) each wired writer emits exactly one v1 event per status change, `evidence.commit` resolving on the repo**
```
plugin/test/ready-pool-check-transition-writes.test.mjs  ℹ pass 5  ℹ fail 0
  ✔ AC(d) promotion: exactly one v1 event, and its evidence.commit RESOLVES to the flipping commit
      (evidence.commit ≠ pre-write HEAD; `git show <sha>:tasks/gap-candidate.md` → status: ready;
       evidence.statusBlobSha === `git rev-parse <sha>:tasks/gap-candidate.md`)
  ✔ AC(c) at the writer: a broken event carrier does NOT fail the status write, and the failure is counted
plugin/test/worker-fan-in.test.mjs                       ℹ pass 5  ℹ fail 0
  ✔ ③ develop target — ONE v1 event for the ready→done flip, whose evidence.commit resolves to the flipping commit
      (seq/cause.runId/actor {kind:fan-in,id:worker-fan-in flipTaskDone}; commit is an ancestor of develop)
  ✔ ③ reset shape — the 'done but not landed' rerun emits TWO events (done→ready, then ready→done)
  ✔ ③ goal target — the doc-face done write emits its own event whose commit resolves to a done flip
      (actor.id "worker-fan-in syncDoneToDocFace"; its commit is an ancestor of develop)
plugin/test/driver-filters.test.mjs                      ℹ pass 78  ℹ fail 0
  ✔ AC(d) needs-human: markNeedsHuman emits exactly ONE v1 event whose evidence.commit resolves to the flip
  ✔ AC(d) second driver-filters site: the develop↔doc status ALIGNMENT emits exactly one v1 event
  ✔ (negative controls: a refused markNeedsHuman / a no-divergence alignment write NO event)
```

**Run 4 — AC2 negative control A: remove the lock. Honest note on forcing the race.**
The lock's absence alone did NOT redden (b): two OS processes appending through a microsecond read→append window do not overlap by themselves — measured, not assumed. So the race was FORCED by widening that window inside the critical section (a 25 ms busy-wait between the `seq` read and the append) in a scratch copy, and the two arms differ only in the lock:
```
ARM A: forced window + LOCK KEPT       → ℹ pass 13  ℹ fail 0        (the window alone is not the failure)
       seqs: 0,1,2,...,49   lines: 50 | distinct seq: 50 | DUPLICATES: []
ARM B: forced window + LOCK REMOVED    → ℹ pass 12  ℹ fail 1
  ✖ (b) seq is strictly increasing under two concurrent writer PROCESSES, with no corrupt line
    AssertionError: (b) seq must be 0..N-1 with NO duplicate and NO gap — a duplicate means two writers read the same cursor
       seqs: 0,0,1,1,2,2,...,24,24   lines: 50 | distinct seq: 25 | DUPLICATES: [0..24]
```
(Arm A also reddens nothing else, so the control is specific to the lock, not a blanket breakage.)

**Run 5 — AC2 negative control B: drop the `eventId` determinism** (scratch copy, `Math.random()` salted into the id hash):
```
✖ (a) appendTaskStatusEvent: the v1 record shape, and `eventId` is STABLE across a retried append
  AssertionError: (a) a retried append of the SAME transition must compute the SAME eventId
ℹ pass 12  ℹ fail 1        (every other test stays green — the red is the intended one)
```

**Run 6 — AC3 (first half only) production coverage, report mode, read-only, against the live carrier**
`node --experimental-strip-types plugin/scripts/task-status-events-reconcile.ts --root /data/home/yale/work/quay --since 2026-10-08T23:30:00Z`
```
carrier=/data/home/yale/work/quay/.quay/task-status-events.jsonl exists=true events=146 (v0=146 v1=0 corrupt=0)
git transitions=315 matchedByCommit=0 matchedByShape=146 missing=169
edge                     git   events  byCommit  byShape  missing
-----------------------------------------------------------------
ready→done               145        0         0        0      145
done→ready                 6        0         0        0        6
needs-human→todo           6        0         0        0        6
ready→needs-human          4        0         0        0        4
todo→needs-human           2        0         0        0        2
needs-human→ready          1        0         0        0        1
ready→todo                 1        0         0        0        1
superseded→done            1        0         0        0        1
todo→done                  1        0         0        0        1
todo→ready               147      146         0      146        1
todo→superseded            1        0         0        0        1
```
This is the pre-landing reading: only `todo→ready` has events (146, all v0, matched by SHAPE — none carries a commit), and EVERY other edge is 0-event. The second half of this AC (the same table after landing, with the fan-in ready→done row non-zero) is the post-landing reading and stays （待外部）.

**Run 7 — AC5 static control: who READS the carrier**
```
$ grep -rn "readTaskStatusEventCarrier(" --include=*.ts packages/*/src plugin/scripts
packages/quay/src/kernel/task-transition.ts:624:export function readTaskStatusEventCarrier(...)   ← the definition
packages/quay/src/kernel/task-transition.ts:744:  const seq = highestSeq(readTaskStatusEventCarrier(root).lines) + 1;   ← its own seq cursor
plugin/scripts/task-status-events-reconcile.ts:162:  const carrier = readTaskStatusEventCarrier(root);   ← THE only consumer
$ grep -rln "task-status-events" --include=*.ts packages/*/src plugin/scripts
packages/quay/src/kernel/task-transition.ts      (writer + definition)
plugin/scripts/ready-pool-check.ts               (writer)
plugin/scripts/worker-fan-in.ts                  (writer)
plugin/scripts/driver-filters.ts                 (writer)
plugin/scripts/task-status-events-reconcile.ts   (reader)
```
The reader set is exactly one: `task-status-events-reconcile.ts`, whose report feeds a human/LLM reading and whose `--apply` only APPENDS inferred events — it is not on any dispatch, promotion or landing path (the gate/promotion/fan-in modules appear above as WRITERS only; `grep -c "task-status-events" packages/quay/src/gate/*.ts` = 0). Zero model calls: `grep -cE "anthropic|openai|@anthropic|claude\"|spawnSync\(\"claude|\bllm\b|fetch\(|https?://" plugin/scripts/task-status-events-reconcile.ts packages/quay/src/kernel/task-transition.ts` → `0` / `0`.

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
- plugin/test/ready-pool-check-transition-writes.test.mjs
- plugin/test/worker-fan-in.test.mjs
- plugin/test/driver-filters.test.mjs
- plugin/scripts/capability-catalog-declarations.json
- docs/carrier-registry.json

## Blocker

**2026-10-12T17:46:13.317Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: AssertionError [ERR_ASSERTION]: the artifact's totals must be ≤ the recorded clean build: measured {"files":267,"bytes":58016392,"shLines":7345} vs {"files":266,"bytes":56445117,"shLines":7345}
- run_id：wk-prod-anchor
- session_id：792a1875-111a-459b-811b-78d38ac77086
