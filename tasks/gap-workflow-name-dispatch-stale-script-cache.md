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

## Root-cause research (2026-07-26)

Two independent research passes, both real (not speculation):

1. **WebSearch** for public Claude Code documentation/changelog mentions of this behavior — found
   nothing specific (only generic prompt-caching articles about the unrelated Anthropic API
   prompt-cache TTL, not this tool's `name:`-resolution behavior).
2. **`claude-code-guide` agent** (a subagent specifically resourced to answer Claude-Code-tooling
   questions) independently checked Claude Code's own docs (`workflows.md`, `tools-reference.md`)
   and changelog — confirmed: **zero documented mention of `name:`-based caching, memoization, or
   mid-session script freshness** anywhere in official materials. The tools-reference page doesn't
   even give `Workflow` the detailed behavior section it gives other tools.

**Conclusion: this is undocumented behavior** — either an unadvertised caching optimization or an
actual bug, but not something this repo can distinguish from the outside, and not something a
repo-side code change can fix (the cache — if that's what it is — lives in the Workflow tool's own
runtime, not in anything checked into this repo). The `claude-code-guide` agent's own recommendation:
report via `/feedback` with repro steps; treat `scriptPath:` as the confirmed-sound workaround in
the meantime.

**Precedent found, per the user's own instruction to check**: this is NOT the first time this
class of problem has been hit. `CLAUDE.md` already carried a "Workflow resume anti-pattern (M144,
2026-07-25)" section describing a related-but-distinct issue: `resumeFromRunId`'s cache keys on
each individual `agent()` call's `(prompt, opts)`, and can't see EXTERNAL file-state changes (a
gap-list.md/charter/script edit) — so resuming after such a fix replays the stale cached failure.
This directive's finding is different in trigger (a fresh `name:` call, zero `resumeFromRunId`
involved) but same in shape (stale content served across a script edit within one session) — folded
into the SAME CLAUDE.md section as an explicit extension, rather than a duplicate separate rule.

## Requested action

1. ~~Root-cause whether this is deterministic or intermittent~~ — superseded by the research above:
   the exact trigger conditions for the underlying caching mechanism aren't independently
   verifiable from outside the tool's implementation; what IS established is that `scriptPath:`
   reliably avoids it (tested 2x this session, both succeeded) while `name:` failed 1x for real —
   sufficient to act on without needing to fully characterize the tool-internal mechanism.
2. **DONE**: documented the standing operational rule directly in `CLAUDE.md` (extending the
   existing M144 section) — always `scriptPath:` to the real checked-in file when a workflow
   script may have changed mid-session, never `name:`.
3. Escalation to Claude Code support (`/feedback`) is a human decision, not something this session
   can do on its own authority — flagged, not actioned.

## Definition of Done

- [x] Root cause characterized as far as externally possible: **undocumented tool behavior,
  confirmed via two independent research passes (WebSearch + claude-code-guide agent) that it is
  not documented anywhere in Claude Code's own materials.** Full internal mechanism unknowable from
  outside the tool — this is the ceiling of what "root cause" means for a closed-source dependency.
  Ticked M-DIR119-C-CANARY (2026-07-27): the "Root-cause research (2026-07-26)" section above IS
  this evidence (two independent research passes, both real, both already landed in this task file
  before this milestone) — no new research performed here, only the checkbox reconciled with the
  prose that already described it as done.
- [x] A documented, followed operational rule ensures this repo's own directive-execution practice
  never hits this again — landed directly in `CLAUDE.md`'s "Workflow resume anti-pattern" section
  (extended, not duplicated), 2026-07-26. Already followed successfully 3x since (M176's real
  dispatch, plus two deliberate string-args probes on `drain-directives.js` and
  `execute-milestone.js`, all via `scriptPath:`, all crash-free).
- [ ] Escalation to Claude Code support: NOT YET DONE — this is a human decision (whether/how to
  file `/feedback`), left open for the user, not self-closed.
