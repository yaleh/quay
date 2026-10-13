---
id: gap-anchor-takeover-silently-narrows-hosted-kinds-against-stale-desired-state
title: "anchor --takeover cold-start reads mutable anchor-desired.json as its
  initial kinds set with no cross-check against the old anchor's actually-hosted
  kinds — real incident: a 93min-stale desired state silently dropped worker
  from the taker, no warning logged"
status: ready
labels:
  - gap
  - defect
  - driver
parent: null
children: []
extra: {}
---
## Proposal
**Confirmed real, reproducible defect — observed first-hand during the ClaudeCodeUI anchor takeover (2026-10-13, this coordinator's own production action).** Not covered by `gap-driver-stop-kind-worker-message-does-not-name-drain-or-takeover-handoff` (that task is message/documentation only for the `stop`/`restart` path; it never touches cold-start/takeover kind selection — confirmed by reading its landed diff, which touches only `driver-runtime.ts`'s message helper, `driver-anchor.ts`'s `--takeover` flag-parse comment, and CLI help text, plus a test file; `runAnchor`'s `initial` derivation at `driver-anchor.ts:420` is untouched).

`runAnchor`'s cold-start kind selection (driver-anchor.ts:420, comment: "启动集合：显式 kinds > 盘上期望态 > 全部六个"): `const initial = opts.kinds ?? readDesired(opts.root)?.kinds ?? [...KNOWN_KINDS];`. A `--takeover <pid>` invocation (the ONLY documented path to swap a live anchor process without downtime) passes no explicit `opts.kinds`, so it falls through to whatever `anchor-desired.json` currently says — a MUTABLE file that can be written by any prior `stop`/`drain`/`start` call, from any earlier operator session, for any reason, with no expiry and no cross-check against what the OLD anchor was actually hosting.

**Before/after, real evidence (not a fixture):**
- `anchor-desired.json` was written `{"kinds":["promotion","outer","goal"], ..., "updatedBy":"quay-driver-stop","updatedAt":"2026-10-13T04:25:42Z"}` by an EARLIER, unrelated diagnostic `stop --kind worker` attempt that itself never completed (see the sibling task above for why `stop` cannot confirm for `worker`).
- ~93 minutes later, a genuine `--takeover` handoff was performed. The OLD anchor (pid 2919772) was, at the moment of takeover, actually running all 4 kinds (`anchor.json` before: `"kinds":["promotion","worker","outer","goal"]`).
- The NEW anchor's own startup log line read: `anchor: host pid=2943131 root=... kinds=[promotion,outer,goal] reconcile=500ms` — **worker silently absent**, with no warning that this differs from what the old anchor had just been running.
- No new `worker` dispatch occurred for ~36 seconds until the operator (coordinator) noticed the log line and manually ran `quay driver start --kind worker`.
- In a less closely watched handoff, this gap would have no alarm at all — `driver status` would correctly show `declaration=not-declared` for worker (an honest reading), but nothing proactively surfaces "the kind set just narrowed relative to what was running one line of log ago."

## Plan
1. At takeover time, before adopting `readDesired(root)?.kinds` as `initial`, compare it against the LAST KNOWN hosted-kinds snapshot (available two ways, pick whichever is both accurate and already-written without a new write path: the taker's own `--takeover <pid>` argument lets it read that OLD pid's last-published `anchor.json.kinds` snapshot if still present, which is a DIRECT observation of "what was running", independent of the mutable desired-state file — hard rule 4b). If the two sets differ, log an explicit WARNING naming the missing/extra kinds, so the gap is visible even in an unattended handoff (not just to an operator watching the log in real time).
2. Decide (with this task's own evidence) whether to also AUTO-RECONCILE (start the missing kinds automatically) or only WARN and leave it to the operator — recommend warn-only first, since auto-starting a kind the operator may have genuinely wanted stopped (the OTHER half of `declaration=stopped-explicitly`, a correct intentional stop) would be the wrong default.
3. No change to `stop`/`drain`/`restart` behaviour; this task only touches the cold-start/takeover kind-selection path.

## Acceptance Criteria
- [ ] AC1 (reproduce the exact incident as a test, RED before the fix): a fixture where `anchor-desired.json` excludes a kind that a (fixture) prior anchor's `anchor.json` snapshot shows as hosted; a takeover run against it. Before the fix: no warning is logged and the kind is silently dropped (pasted, matching the real incident). Negative control: the current code path, unchanged, reproduces the silent drop.
- [ ] AC2 (GREEN after): the same fixture, after the fix, logs an explicit warning naming the discrepancy (missing kind named). If step 2's auto-reconcile decision is "warn-only", the kind stays absent but the warning is unmissable in the anchor log; if "auto-reconcile", the kind is also started and the log says so. State which was chosen and why.
- [ ] AC3: a fixture where desired and the prior snapshot AGREE produces no warning (no false positives).
- [ ] AC4: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC4 checked with pasted evidence (the RED->GREEN pair is load-bearing).
- No change to `stop`/`drain`/`restart`/the message helper from the sibling task.

## Touches
- tasks/gap-anchor-takeover-silently-narrows-hosted-kinds-against-stale-desired-state.md
- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor-takeover.test.mjs
