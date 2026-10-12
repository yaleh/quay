---
id: gap-quay-task-log-trace-read-surface
title: "task_trace P1: read-only 'quay task log --since <cursor>' and 'quay task
  trace <id>' with enumerated coverage, epoch rebase, at-least-once"
status: done
labels:
  - gap
  - task-trace
  - observability
parent: null
children: []
extra: {}
depends_on:
  - gap-task-status-events-contract-v1-all-driver-writers
---
## Proposal
Consumers need a supported read surface for `.quay/task-status-events.jsonl`, not a parse of the raw file. The consumers are ClaudeCodeUI's `changes` feed (GOAL-042, achieved) and Quay's own semantic discovery loop. ClaudeCodeUI's draft (`docs/proposals/cloudcli-mcp-control-observability-2026-10.md` §4 2b′) proposes exactly two read-only verbs in the `task list --json` family.

## Plan
1. **`quay task log --since <ISO8601|cursor> [--until <ISO8601>] [--limit <n≤500>] --json [--root]`**
   → `{transitions, nextCursor, complete, coverage, generatedAt}`
   - Cursor: opaque `{v:1, carrierEpoch, seq}`.
   - A cursor from another epoch ⇒ `{rebase:true, reason}` and replay from seq 0 of the current epoch. Never a silent skip.
   - Delivery is at-least-once. Consumers dedupe by `eventId`, documented in `--help`.
2. **`quay task trace <task-id> --json`** → `{taskId, status, transitions, generatedAt, coverage}`.
3. **`coverage` is ENUMERATED, not boolean (hard rule 3):**
   - which writer classes are wired (from a declared list in the kernel, kept in sync by a test against the actual call sites);
   - which are not (e.g. the GitHub provider);
   - the reconcile watermark (the last develop commit reconciled).
   `complete:true` only when the page reached the carrier end AND every in-scope writer class is wired AND reconcile is current. Otherwise `false` with the reasons.
4. Each transition exposes `source` = `"task-status-events"` for written events, and for reconciled ones `"git"` with `inferred:true`. Commit titles are never a source.
5. The `--help` text documents the contract fields, the retention rule (append-only, epoch on rotation) and replay. Register the verbs in all CLI verb-surface registries: a new CLI verb touches four registries; read the repo's verb-surface parity checks.

## Acceptance Criteria
- [x] Tests exit 0, covering:
  - (a) paging with `--limit` returns every event exactly once across pages on a fixture, plus at-least-once on a resumed cursor (the overlap is deduped by `eventId`);
  - (b) an epoch-mismatched cursor ⇒ `rebase:true`, not an empty page;
  - (c) `complete:false` with reasons when a writer class is unwired or reconcile lags;
  - (d) `trace` on a task with mixed v0, v1 and inferred events orders them by `seq` and labels sources;
  - (e) an unknown task ⇒ a distinct not-found exit, not an empty success;
  - (f) verb-surface parity checks green.
- [x] Negative control: make the epoch check a no-op in a scratch copy ⇒ (b) red. Paste the output.
- [x] Real reading: `quay task log --since 2026-10-12T00:00:00Z --json` and `quay task trace gap-discovery-portfolio-append-only-correction-fold --json` on the main checkout. Paste them, including `coverage` and `complete`.
- [x] Cross-project: ClaudeCodeUI's consumer change (switching its `changes` Quay source to `task log`) is NOT done here. Paste the exact contract JSON excerpt from `--help` that a later cross-project acceptance can pin.

## Evidence

**Why this round exists — the two REDs the prior round exited on, both deltas against develop.**
(1) The fan-in ts-typecheck gate exited 1 on two `TS2339`s in `task-log.ts` — `Property 'reason' does
not exist on … 'LimitArg'` / `… 'TaskLogReading'`. Cause: the root `tsconfig.json` is `strict: false`,
under which the NEGATIVE branch of a boolean-discriminant union is NOT narrowed, so `if (!x.ok)`
leaves `x` the full union and `x.reason` is not a member of it. Fixed with the repo's established
idiom, `x.ok === false` (the same note `packages/quay/src/branch-model.ts:430` carries inline).
(2) After merging develop, test (h) went RED — `packages/quay-native/src/store.ts` calls
`appendTaskStatusEvent` and no declared writer class owned it. `gap-task-status-events-abi-writes-and-creation`
(which landed AFTER this registry was first written) had closed exactly the gap the `cli` / `mcp`
entries enumerated as open, so those two are now `wired: true` naming that one call site. Neither
change touches the published contract; both are recorded under (c) and (h) below.

**AC1 — tests exit 0** (`node --test --experimental-strip-types packages/quay/test/task-log.test.mjs`, in the task worktree):
```
✔ (a) paging by --limit covers every event; a resumed cursor is AT-LEAST-ONCE (dedup by eventId)
✔ (b) an epoch-mismatched cursor ⇒ rebase:true + a reason + a REPLAY, never an empty page
✔ (b) a legacy v0-only carrier's PRE_EPOCH cursor rebases once the first v1 append rotates it
✔ (c) complete:false names the UNWIRED in-scope writer classes and the carrier census
✔ (c) complete:false when reconcile LAGS, complete:true when every in-scope class is wired AND reconcile is current
✔ (d) trace orders a mixed v0/v1/inferred carrier by position and labels every source
✔ (e) trace on an unknown task exits 3 (distinct from 0), never an empty success
✔ log: the real CLI publishes the contract document, and an unparseable --since is a usage error
✔ (f) `quay --help` Usage synopsis lists `quay task log` and `quay task trace`
✔ (h) the declared writer-class registry is IN SYNC with every real appendTaskStatusEvent call site
✔ (g) NEGATIVE CONTROL: with the epoch check no-op'd in a scratch copy, (b)'s rebase is NOT reported
ℹ tests 11  ℹ pass 11  ℹ fail 0
```
(a) asserts the raw page boundaries are `[[0,1,2],[2,3,4],[4,5,6],[6]]` (10 raw deliveries, 7 distinct), that every page after the first re-delivers the previous page's LAST event (at-least-once), and that the union DEDUPED by `eventId` is exactly the written set — no loss, no invention.
(b) is asserted on both rotations this repo can produce: a full carrier replaced under a new epoch, and a legacy v0-only carrier whose declared `PRE_EPOCH` literal the first v1 append rotates.
(c) has three arms. The unwired-naming arm is driven through the injectable `writerClasses` SEAM — an in-scope class flipped to `wired:false` in a fixture registry — and deliberately NOT through the real registry: an arm pinned to the real registry's open gaps goes silent at exactly the moment the last one closes, which is what happened here (`gap-task-status-events-abi-writes-and-creation` wired the Provider ABI write path, so the `cli` and `mcp` classes this task originally enumerated as unwired are wired today). The same test therefore also asserts the real registry's `unwiredInScope` is `[]` as a READING of the declaration — not an omission; that the declaration still matches the tree is (h)'s job. The other two arms are a lagging reconcile watermark, and — the falsifiability control — an all-wired registry over a current carrier, where `complete` DOES reach `true` with `reasons:[]`, so `complete:false` is a measurement rather than a constant.
(d) asserts `order=[0,1,2]`, `schema=["v0","v1","v1"]`, `source=["task-status-events","task-status-events","git"]`, `seq=[null,0,1]` and that the v1 subset is in ascending `seq` order (carrier position and `seq` agree on an append-only carrier; a v0 record has no `seq` and gets none — never a fabricated one).
(e) runs the real CLI against a real native-provider workspace.
(h) is the "kept in sync with the actual call sites" check: it enumerates every non-test `.ts` under `plugin/` + `packages/` that calls `appendTaskStatusEvent(` (comments stripped, so a prose mention is not a call site) and requires each file to be owned by a declared writer class, and each `wired:true` class to name an existing call site that still calls it. ⛔ It is the check that caught the merge-time drift: `packages/quay-native/src/store.ts` was a real call site with no owner, and it is now owned by `cli` and `mcp` — two ids for one implementation, kept separate because the front doors can regress independently (which door a write came through is carried per-event as `actor.kind`, not as a separate writer).

**AC2 — negative control** (test (g); the mutation is applied to a scratch COPY of the CLI's module graph, never to the checked-in file):
```
[negative-control] real module  : rebase=true transitions=2
[negative-control] mutant module: rebase=false transitions=2 (epoch check no-op'd) → (b) would be RED
```
The control is non-vacuous by construction: it asserts the mutation ANCHOR line exists before replacing it, and asserts the real module reports `rebase:true` on the same fixture before the mutant is run. With the epoch comparison replaced by `if (false)`, the mutant reads the stale cursor as honourable and never reports the rebase — exactly the silent skip (b) forbids.

**AC3 — real readings** (worktree CLI, `--root /data/home/yale/work/quay`; re-taken this round, so they read the post-`083b4a644` tree. The transition array is elided with `…`).

`quay task log --since 2026-10-12T00:00:00Z --json`:
```json
{
  "transitions": [ … 55 total ],
  "nextCursor": { "v": 1, "carrierEpoch": "f0abc6d11b8c4c6aefdd687eb6b308dc", "seq": 166 },
  "complete": false,
  "rebase": false,
  "rebaseReason": null,
  "coverage": {
    "carrier": { "path": "/data/home/yale/work/quay/.quay/task-status-events.jsonl", "exists": true,
                 "epoch": "f0abc6d11b8c4c6aefdd687eb6b308dc", "lines": 167, "v0": 150, "v1": 17, "corrupt": 0 },
    "unwiredInScope": [],
    "reconcile": { "ref": "develop", "watermark": null, "newestWrittenAt": "2026-10-12T18:59:40.439Z",
                   "state": "not-run",
                   "reason": "no reconcile-inferred event is present — either no reconcile pass has run against develop, or one ran and found no gap. The carrier alone cannot tell these apart (硬规则 3b), so this is reported as not-run rather than as \"current\"." },
    "reasons": [
      "reconcile is not current (not-run): no reconcile-inferred event is present — either no reconcile pass has run against develop, or one ran and found no gap. The carrier alone cannot tell these apart (硬规则 3b), so this is reported as not-run rather than as \"current\"." ] },
  "generatedAt": "2026-10-12T19:02:20.578Z"
}
```
`complete:false` with exactly ONE reason: the reconcile watermark has never been stamped on this carrier (`state: "not-run"` — honestly distinct from both `lagging` and `current`). `unwiredInScope` is EMPTY: the two in-scope classes that this task originally reported as unwired (`cli`, `mcp`) were wired by `gap-task-status-events-abi-writes-and-creation`, so no in-scope gap remains. The census shows the epoch rotation has occurred — 167 lines = 150 legacy v0 + 17 v1 records under epoch `f0abc6d1…`, no longer `pre-epoch` — which is the carrier reading the earlier round could not produce.

`quay task trace gap-discovery-portfolio-append-only-correction-fold --json`:
```json
{ "taskId": "gap-discovery-portfolio-append-only-correction-fold", "status": "done",
  "transitions": [ { "order": 134, "schema": "v0", "seq": null, "eventId": null, "carrierEpoch": null,
                     "taskId": "gap-discovery-portfolio-append-only-correction-fold",
                     "from": "todo", "to": "ready", "kind": "promote", "at": "2026-10-12T15:32:16.074Z",
                     "recordedAt": null,
                     "actor": { "kind": "unknown", "id": "ready-pool-check --apply" },
                     "source": "task-status-events", "inferred": false, "commit": null } ],
  "generatedAt": "2026-10-12T19:02:29.965Z",
  "coverage": { "carrier": { "path": "/data/home/yale/work/quay/.quay/task-status-events.jsonl", "exists": true,
                             "epoch": "f0abc6d11b8c4c6aefdd687eb6b308dc", "lines": 167, "v0": 150, "v1": 17, "corrupt": 0 },
                "unwiredInScope": [], "reconcile": { "ref": "develop", "watermark": null, "state": "not-run" },
                "reasons": [ …the one reconcile reason above… ] } }
```
`status:"done"` comes from the Provider ABI (the authority), while the carrier holds only the `todo→ready` transition (a v0 record — this task pre-dates the epoch) — the honest gap between "what the writers recorded" and "what the task store says", which is precisely what `coverage.reasons` exists to expose.

A second trace, on a task whose whole life is post-rotation, shows the v1 path reading in PRODUCTION (the mixed v0/v1/inferred arm of (d) was previously only exercised on a fixture): `quay task trace gap-driver-round-carriers-unbounded-growth-retention-design --json` ⇒ `status:"done"` with three `schema:"v1"` transitions in ascending `seq` — `seq 4 create from:null→todo`, `seq 6 todo→ready`, `seq 15 ready→done` — every one `source:"task-status-events"`, `inferred:false`.

The unknown-task arm, same workspace: exit **3**, empty stdout, `quay task trace: no such task: NO-SUCH-TASK-ZZZ (exit 3 — NOT an empty success)` on stderr.

**AC4 — the contract excerpt a cross-project acceptance can pin** (`quay --help`, verbatim):
```
The published CONTRACT (task log --json; task trace --json is the same document minus
transitions/nextCursor/complete/rebase, plus its own taskId/status):
  {
    "transitions": [ { "order": 0, "schema": "v1", "seq": 0, "eventId": "<sha256[0:32]>",
                       "carrierEpoch": "<epoch>", "taskId": "<id>", "from": "todo", "to": "ready",
                       "kind": "promote", "at": "<ISO>", "recordedAt": "<ISO>",
                       "actor": { "kind": "promotion-driver|worker-driver|fan-in|goal-driver|cli|mcp|human|unknown", "id": "<entry point>" },
                       "cause": { "runId?": "…", "dispatchId?": "…", "sessionId?": "…", "correlationId?": "…" },
                       "evidence": { "commit": "<sha|null>", "statusBlobSha": "<sha>", "commitAbsentReason?": "…" },
                       "reason": "…",
                       "source": "task-status-events|git", "inferred": false, "commit": "<sha|null>" } ],
    "nextCursor": { "v": 1, "carrierEpoch": "<epoch>", "seq": 3 },
    "complete": false,
    "coverage": { "carrier": { "path": "…", "exists": true, "epoch": "…", "lines": 0, "v0": 0, "v1": 0, "corrupt": 0 },
                  "writerClasses": [ { "id": "<class>", "wired": true, "inScope": true, "callSites": ["…"], "reason": "…" } ],
                  "unwiredInScope": [ "<class>" ],
                  "reconcile": { "ref": "develop", "watermark": { "commit": "<sha>", "at": "<ISO>" },
                                 "newestWrittenAt": "<ISO|null>", "state": "current|lagging|not-run|not-evaluated",
                                 "reason": "…" },
                  "reasons": [ "…" ] },
    "generatedAt": "<ISO>", "rebase": false, "rebaseReason": null
  }
```
The same help block carries the cursor/at-least-once rule ("DEDUPE BY `eventId`"), the `rebase` rule, the meaning of `order`/`source`/`coverage`, and `RETENTION: the carrier is APPEND-ONLY — no truncation in v1`. The `actor.kind` enum in that excerpt is DERIVED from the kernel's `TASK_STATUS_EVENT_ACTOR_KINDS` (⛔ not re-typed in help.ts), the same single-source rule the driver block already follows. ClaudeCodeUI's own consumer change is deliberately NOT in this task's delta.

**AC(f) — verb-surface parity.** `node --experimental-strip-types packages/quay/test/cli.test.mjs` ends `All QN-033 bin/quay.js CLI dispatch tests passed.` — that script's `block14` (the `--help` Usage synopsis verb set == the dispatch table set) and `block28` (the fallback `usage: quay <…>` line's command set == the dispatch-table command set, derived from every `cmd === "X"` and `cmd === "X" && sub === "Y"` route) run unconditionally, and the script prints `N test(s) FAILED` if any assertion throws. The new `task log` / `task trace` routes therefore had to appear in the synopsis AND in the fallback usage line's bare-`task` token run (`task list|view|create|edit|check|log|trace`) — both were widened in this change. `capability-manifest-check` (the fourth registry, the `delivery-manifest.json` capabilities array) reads only the TOP-LEVEL `cmd === "…"` set, which is unchanged: `PASS — no unregistered capability, no stale registration` (`[cli-command] ok: source=22 manifest=22`).

**DoD — `scripts/test.sh --for-task gap-quay-task-log-trace-read-surface --allow-thin`** (after `git merge develop` in the worktree): exit **0**, `ℹ tests 115  ℹ pass 115  ℹ fail 0`, and `packages/quay/test/task-log.test.mjs` is in the selected set. `anti-drift-touches-check.ts --task gap-quay-task-log-trace-read-surface --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK: 6 actual file(s), all within declared Touches (6 glob(s)) (the 5 source files plus this task file, which after the body update no longer matches develop's copy)`. The fan-in ts-typecheck gate (`for d in packages/*/; do npx tsc --noEmit -p "$d"; done`) is green across all four packages. Zero model calls; the new module never writes a carrier and never creates the epoch sidecar it reads (`readCarrierEpoch` is the read-only counterpart of the writer's read-or-create).
## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-quay-task-log-trace-read-surface` green.
- Zero model calls; read-only.

## Touches
- tasks/gap-quay-task-log-trace-read-surface.md
- packages/quay/bin/quay.ts
- packages/quay/src/cli/task-log.ts
- packages/quay/src/cli/help.ts
- packages/quay/src/kernel/task-transition.ts
- packages/quay/test/task-log.test.mjs

## Blocker

**2026-10-12T18:37:11.188Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=typecheck: fan-in-ts-typecheck-gate: task gap-quay-task-log-trace-read-surface — Touches cover new/moved .ts files (1); type graph changed
fan-in-ts-typecheck-gate: running ts-typecheck gate in worktree /data/home/yale/work/quay-worktrees/gap-quay-task-log-trace-read-surface...
fan-in-ts-typecheck-gate: command [the workspace's own declaration (name: ts-typecheck)]: for d in packages/*/; do npx tsc --noEmit -p "$d" || exit 1; done
fan-in-ts-typecheck-gate: typecheck RED — BLOCKED (exit 1); do NOT fan in on scoped-green alone
fan-in-ts-typecheck-gate: last lines:
packages/quay/src/cli/task-log.ts(483,50): error TS2339: Property 'reason' does not exist on type 'LimitArg'.
  Property 'reason' does not exist on type '{ ok: true; limit: number; }'.
packages/quay/src/cli/task-log.ts(498,37): error TS2339: Property 'reason' does not exist on type 'TaskLogReading'.
  Property 'reason' does not exist on type '{ ok: true; document: TaskLogDocument; }'.
- run_id：wk-prod-anchor
- session_id：fdcdb86c-85bd-4015-bc8b-72655c30488d
