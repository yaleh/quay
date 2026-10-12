---
id: gap-quay-task-log-trace-read-surface
title: "task_trace P1: read-only 'quay task log --since <cursor>' and 'quay task
  trace <id>' with enumerated coverage, epoch rebase, at-least-once"
status: ready
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
- [ ] Tests exit 0, covering:
  - (a) paging with `--limit` returns every event exactly once across pages on a fixture, plus at-least-once on a resumed cursor (the overlap is deduped by `eventId`);
  - (b) an epoch-mismatched cursor ⇒ `rebase:true`, not an empty page;
  - (c) `complete:false` with reasons when a writer class is unwired or reconcile lags;
  - (d) `trace` on a task with mixed v0, v1 and inferred events orders them by `seq` and labels sources;
  - (e) an unknown task ⇒ a distinct not-found exit, not an empty success;
  - (f) verb-surface parity checks green.
- [ ] Negative control: make the epoch check a no-op in a scratch copy ⇒ (b) red. Paste the output.
- [ ] Real reading: `quay task log --since 2026-10-12T00:00:00Z --json` and `quay task trace gap-discovery-portfolio-append-only-correction-fold --json` on the main checkout. Paste them, including `coverage` and `complete`.
- [ ] Cross-project: ClaudeCodeUI's consumer change (switching its `changes` Quay source to `task log`) is NOT done here. Paste the exact contract JSON excerpt from `--help` that a later cross-project acceptance can pin.

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
