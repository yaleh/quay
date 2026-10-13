---
id: gap-anchor-takeover-silently-narrows-hosted-kinds-against-stale-desired-state
title: "anchor --takeover cold-start reads mutable anchor-desired.json as its
  initial kinds set with no cross-check against the old anchor's actually-hosted
  kinds — real incident: a 93min-stale desired state silently dropped worker
  from the taker, no warning logged"
status: done
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
- [x] AC1 (reproduce the exact incident as a test, RED before the fix): a fixture where `anchor-desired.json` excludes a kind that a (fixture) prior anchor's `anchor.json` snapshot shows as hosted; a takeover run against it. Before the fix: no warning is logged and the kind is silently dropped (pasted, matching the real incident). Negative control: the current code path, unchanged, reproduces the silent drop. —— RED pasted in `## Evidence`: pre-fix the whole startup log carries **zero** warning lines (`worker-round.jsonl exists? false`), and the new test fails with `timed out waiting for the narrowing warning to be logged`.
- [x] AC2 (GREEN after): the same fixture, after the fix, logs an explicit warning naming the discrepancy (missing kind named). If step 2's auto-reconcile decision is "warn-only", the kind stays absent but the warning is unmissable in the anchor log; if "auto-reconcile", the kind is also started and the log says so. State which was chosen and why. —— **Chosen: warn-only.** `declaration=stopped-explicitly` is a CORRECT state (the operator may have genuinely wanted that kind stopped), so auto-starting would silently undo an intentional stop — the worse default; the warning instead names the actionable alternative (`quay driver start --kind <k>` / `--kinds`). GREEN log line pasted in `## Evidence`.
- [x] AC3: a fixture where desired and the prior snapshot AGREE produces no warning (no false positives). —— test `AC3 — 一致 ⇒ ⛔ 无 WARNING、⛔ 无「未核对」行，六个 kind 都起（对照）` ✔; the contrasting arm (that same run's `worker-round.jsonl` DOES exist) is what makes it a difference-following reading, not a vacuous one.
- [x] AC4: `scripts/test.sh --for-task <this task>` green. —— `bash scripts/test.sh --for-task gap-anchor-takeover-silently-narrows-hosted-kinds-against-stale-desired-state --allow-thin` ⇒ `tests 11 / pass 11 / fail 0` (3 new + 4 pre-existing in `driver-anchor-takeover.test.mjs`, 4 in the brother `driver-anchor.test.mjs`); sibling anchor files 30/30 and the two bundle files 8/8 also re-run green.

## Definition of Done
- AC1-AC4 checked with pasted evidence (the RED->GREEN pair is load-bearing).
- No change to `stop`/`drain`/`restart`/the message helper from the sibling task.

## Evidence

**AC1 — RED (pre-fix; `md5sum plugin/scripts/driver-anchor.ts` = `920918dcc36acdce0a4cb4f5ab499283`, i.e. the landed HEAD).** Faithful six-kind incident fixture: `anchor.json` published by the "old anchor" lists all six kinds, while the 93min-stale `anchor-desired.json` lacks `worker` AND carries an explicit stop record for it (so the pre-existing "absent from the desired set" line stays silent — that is exactly what made the real handoff alarm-free). The replacement's **entire** startup log:

```
2026-10-13T06:52:04Z anchor: takeover 2594456 exited — taking over
2026-10-13T06:52:04Z anchor: host pid=2594457 root=/tmp/repro-narrow6-QRz8tR kinds=[promotion,outer,quality,meta,goal] reconcile=100ms
2026-10-13T06:52:04Z anchor: kind=promotion loop started (pid=2594457)
2026-10-13T06:52:04Z anchor: kind=outer loop started (pid=2594457)
2026-10-13T06:52:04Z anchor: kind=quality loop started (pid=2594457)
2026-10-13T06:52:04Z anchor: kind=meta loop started (pid=2594457)
2026-10-13T06:52:04Z anchor: kind=goal loop started (pid=2594457)

worker-round.jsonl exists?  false
```

Zero warning lines; `worker` silently dropped — matching the real incident. The new test agrees:
`✖ AC1/AC2 … Error: timed out waiting for the narrowing warning to be logged (21246ms)`.

**AC2 — GREEN (post-fix; md5 `d6b6201a7f85a0faf044b0560bdf8159`).** Same fixture, same command; the replacement now logs, immediately **before** its host line (so the alarm precedes the evidence line an operator reads):

```
2026-10-13T06:52:36Z anchor: takeover 2622989 exited — taking over
2026-10-13T06:52:36Z anchor: WARNING takeover kind set differs from the old anchor's hosted set — starting=[promotion,outer,quality,meta,goal] hosted=[promotion,worker,outer,quality,meta,goal]: worker NOT started — the takeover kind set (from .quay/anchor-desired.json, a MUTABLE file written by any earlier start/stop/drain, with no expiry) is narrower than what pid=2622989 was actually hosting. No kind was auto-started (warn-only): an intentional stop (declaration=stopped-explicitly) is a CORRECT state and auto-starting would silently undo it — re-add deliberately with `quay driver start --kind <k>`, or pass --kinds to override the desired state
2026-10-13T06:52:36Z anchor: host pid=2623001 root=/tmp/repro-narrow6-ZhTSaY kinds=[promotion,outer,quality,meta,goal] reconcile=100ms
...
worker-round.jsonl exists?  false
```

Warn-only is a **direct** reading, not a promise: the dropped kind's round carrier never appears and `anchor.json.kinds` contains no `worker`.

**AC3 — no false positives (the control).** Same command, agreeing fixture: the WARNING line is absent, the "NOT cross-checked" line is absent, and `worker-round.jsonl` DOES exist ⇒ the warning tracks the actual set difference rather than firing unconditionally.

**AC4 — scoped gate.** See the AC4 line above.

**Hard rule 3b.** `readTakeoverHostedSnapshot` gives "could not cross-check" its OWN value (`missing` / `unreadable` / `malformed` / `pid-mismatch`), logged as a distinct line — never isomorphic with "checked and agreed" (which logs nothing). A pid-mismatched snapshot is not the old anchor's own reading, so it must not fabricate a warning. Pinned by `AC3(3b) — 「没能交叉核对」是**独立取值**` ✔ (direct import, no subprocess).

**Where the tests live, and why.** `plugin/test/driver-anchor-takeover.test.mjs` — the takeover-domain file, which spawns the **worktree** kernel (`ANCHOR_SCRIPT`) and therefore actually exercises this change. The originally declared `plugin/test/driver-anchor.test.mjs` resolves its anchor via `preferredAnchorKernel()` (**main checkout**) and, by its own header, structurally cannot verify an anchor-kernel change. Touches was updated through the task ABI (`task_write`, one-line delta verified) before the scoped gate ran, so the gate's selection includes this file.

## Touches
- tasks/gap-anchor-takeover-silently-narrows-hosted-kinds-against-stale-desired-state.md
- plugin/scripts/driver-anchor.ts
- plugin/test/driver-anchor-takeover.test.mjs
