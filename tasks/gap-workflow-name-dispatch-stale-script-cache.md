---
id: gap-workflow-name-dispatch-stale-script-cache
title: Workflow({name:...}) can dispatch a stale, pre-fix script body within an
  already-running session — even 22+ minutes after the checked-in source changed
  on master
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
## Finding

During M175/M176 (this session, 2026-07-26), `Workflow({name:"execute-milestone", args:{...}})`
was dispatched twice using the `name:` form (not `scriptPath:`), both times AFTER commit `f663857`
(DIR-114's args-normalization fix) had already landed on `master`:

1. First `name:`-based dispatch for M176 (targeting `gap-absorb-charter-audit-not-committed`):
   crashed instantly (`durationMs: 31`) with the exact original bug —
   `Error: undefined is not an object (evaluating 'args.charterFile.match')`. Real artifact:
   `~/.claude/projects/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/workflows/wf_9ce5f73c-d25.json`,
   dispatched at `2026-07-26T15:24:49Z` — **22+ minutes after** the fix commit (`15:02:07Z`) and
   after the M175 milestone that landed it had already merged (`7af7e1e`, `15:23:13Z`).
2. `args` was delivered as a JSON string (the buggy form) in this dispatch — but the crash happened
   regardless, because the materialized script itself
   (`~/.claude/projects/.../workflows/scripts/execute-milestone-wf_9ce5f73c-d25.js`) does **not**
   contain the `$a =` normalization at all — `diff` against the current checked-in
   `.claude/workflows/execute-milestone.js` confirms it is the OLD, pre-fix script body, raw
   `args.xxx` throughout.
3. **Switching to `Workflow({scriptPath: "/home/yale/work/quay/.claude/workflows/execute-
   milestone.js", args:{...}})`** (pointing directly at the real checked-in file, same session,
   immediately after) succeeded — ran the full 13-agent pipeline to completion with no crash
   (`wf_558bd42f-ac5`).

This means: within an already-running session, `Workflow({name:...})` does not reliably re-read
the current on-disk content of a checked-in workflow script for a given name — it appears to reuse
a materialized/cached script body from earlier in the same session (the first `name:"execute-
milestone"` dispatch in this session happened at M175, BEFORE the fix landed). `scriptPath:`
pointing at the real file bypasses this and works correctly.

This is very likely a Workflow-tool platform behavior, not a bug in this repo's own scripts — no
amount of source-file fixing (like DIR-114) can protect against it, since the stale cached copy
simply never re-reads the fixed source. It's a distinct, separately-observed reliability gap from
`gap-drain-dispose-body-corruption.md` (a different phase of the same general "workflow dispatch
machinery has rough edges" theme surfaced this session), though both surfaced from the same
DIR-114 verification effort.

## Requested action

1. Root-cause whether this is deterministic (any repeat `name:` dispatch within a session after the
   first always reuses the first materialization) or intermittent — test with a few more same-
   session `name:` dispatches of a script edited mid-session.
2. If deterministic and a platform limitation: document it as a standing operational rule for this
   repo's own directive-authoring/execution practice — **always use `scriptPath:` pointing at the
   real checked-in file for a workflow script that may have changed since session start, never
   `name:`, when dispatching from a long-running orchestrating session** (matching what already
   worked here). Consider whether the `quay:execute-milestone`/other skills that wrap `Workflow()`
   calls should be updated to always pass `scriptPath:` rather than `name:`.
3. If this is genuinely a Claude Code platform bug (not something this repo can work around
   completely), it may be worth reporting upstream separately from this repo's own task-tracking
   (this repo's `gap-*` tasks track repo-side issues; a platform bug report is a different channel)
   — flagged here for a human decision on whether/how to escalate.

## Definition of Done

- [ ] Root cause characterized (deterministic vs intermittent, and why) from direct experimentation,
  not speculation.
- [ ] A documented, followed operational rule (or an actual skill/workflow-dispatch-wrapper change)
  ensures this repo's own directive-execution practice never hits this again — e.g. always
  `scriptPath:` for same-session repeat dispatches of a possibly-changed script.
- [ ] If reported upstream, a reference/link recorded here; if not, an explicit decision recorded
  for why not.
