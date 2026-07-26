# M177 — iteration-0

**Task:** DIR-115
**Charter:** experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md

## Summary

Interpolated `${$a.taskId}`/`${$a.charterFile}` into the domain-misfit Verify-check dispatch
prompt in `.claude/workflows/execute-milestone.js` (mirrored byte-identically into
`plugin/workflows/execute-milestone.js`), matching the pattern already used by the other 4 checks
in the same `_dispatchList`. No change to decision logic, schema, or the DIR-079 per-check cache
path (`_cached('domain-misfit')`/`verifyCacheUpdates`).

## Change

```diff
-  !_cachedDomainMisfit  ? () => agent(
-    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to the milestone's Done-when list. Return {ok: true, step3conclusion} — ok indicates the check completed (always true when the procedure was applied); step3conclusion records whether a misfit was found. This check is INFORMATIONAL, never blocking.`,
+  !_cachedDomainMisfit  ? () => agent(
+    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to milestone task ${$a.taskId}'s Done-when list (charter: ${$a.charterFile}). Return {ok: true, step3conclusion} — ok indicates the check completed (always true when the procedure was applied); step3conclusion records whether a misfit was found. This check is INFORMATIONAL, never blocking.`,
     { label: 'domain-misfit', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, step3conclusion: { type: 'string' } } } }
   ) : null,
```

Applied identically to `.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js`.

```
$ grep -A2 "domain-misfit audit-channel" .claude/workflows/execute-milestone.js
    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to milestone task ${$a.taskId}'s Done-when list (charter: ${$a.charterFile}). Return {ok: true, step3conclusion} — ok indicates the check completed (always true when the procedure was applied); step3conclusion records whether a misfit was found. This check is INFORMATIONAL, never blocking.`
    { label: 'domain-misfit', schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' }, step3conclusion: { type: 'string' } } } }

$ diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js && echo IDENTICAL
IDENTICAL

$ node --check .claude/workflows/execute-milestone.js && echo OK
OK
$ node --check plugin/workflows/execute-milestone.js && echo OK
OK
```

## Real (non-fixture) before/after measurement

**Constraint acknowledged:** as the Build-phase subagent I do not have access to the outer
`Workflow` tool's own `agent()` dispatch primitive that the real `execute-milestone.js` Verify
phase uses — this milestone's own Verify phase already ran (with the OLD, un-interpolated prompt)
*before* Build started, since Verify precedes Build in the phase sequence; my edit lands too late
to be exercised by that pass. Per the charter's own "self-referential/bootstrap-paradox" framing
(same shape as M175/M176's Land-phase-time claims), a literal in-workflow re-verification is a
Verify-phase-time event outside this Build step's reach.

Instead I produced the closest genuine substitute available to me: a **real headless Claude Code
dispatch** (`claude -p ... --output-format stream-json --dangerously-skip-permissions
--allowedTools "Read,Bash,Grep,Glob"`), same repo, same day, using the byte-identical prompt
strings (old vs. new) that `execute-milestone.js` would hand to `agent()`. This is a real LLM
call with a real tool-call trace and real wall-clock time — not a scripted/fixture result — run
twice, back-to-back, in the same environment, isolating the one variable (prompt interpolation).

### OLD prompt (pre-change, no charterFile/taskId context)

```
$ time claude -p "Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to the milestone's Done-when list. Return {ok: true, step3conclusion} — ..." --output-format stream-json --dangerously-skip-permissions --allowedTools "Read,Bash,Grep,Glob"
```

Wall time: **87s**. Tool-call trace (12 calls) — reconnaissance-heavy, matching Finding #3's
"improved-luck but still-searching" shape (M177's own charter happened to be the only untracked
charter present, so it was found reasonably early via `find`, but the agent still spent most of
its calls grepping `inherited-core.md` multiple times, reading `OUTER-LOOP.md`, and scanning
unrelated milestone directories (`milestones/M154`, `milestones/M151`) before settling on
`tasks/DIR-115.md` as the actual target):

```
Bash  :: find .../experiments/quay-perpetual-stream -maxdepth 1 -iname "inherited-core.md"
Read  :: .../charters/M177-dir115-domain-misfit-context.md
Grep  :: domain-misfit
Grep  :: domain-misfit|S4\.4d
Grep  :: domain-misfit
Grep  :: domain-misfit
Grep  :: audit-channel|systematic-explore|4\.4d|misfit
Bash  :: grep -n "it0\|3\.2\|domain" .../OUTER-LOOP.md | head -80
Bash  :: grep -n "domain\|misfit\|audit-channel\|step3\|step 3\|Step 3" .../inherited-core.md
Read  :: .../inherited-core.md
Bash  :: grep -rn "domain-misfit\|step3conclusion" .../milestones/M154 .../milestones/M151
Bash  :: grep -n "domain-misfit" .../tasks/DIR-115.md
```

Verdict: `{"ok": true, "step3conclusion": "No misfit. Done-when items 1, 2, 4 are
non-self-referential, mechanically independent verification channels ... Item 3 [is
self-referential but doesn't force ceilingTrigger]"}`

### NEW prompt (post-change, interpolated `${$a.taskId}`/`${$a.charterFile}`)

```
$ time claude -p "Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to milestone task DIR-115's Done-when list (charter: experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md). Return {ok: true, step3conclusion} — ..." --output-format stream-json --dangerously-skip-permissions --allowedTools "Read,Bash,Grep,Glob"
```

Wall time: **66s**. Tool-call trace (6 calls) — goes straight to the charter file as its
**first** action, then only reads `inherited-core.md` once it needs the procedure text (no
`dashboard.md`, no `milestones/` directory scan, no `quay task list`):

```
Read  :: .../charters/M177-dir115-domain-misfit-context.md      ← FIRST call, correct target
Bash  :: find .../experiments/quay-perpetual-stream -iname "inherited-core.md"
Grep  :: domain-misfit
Grep  :: domain-misfit
Grep  :: domain-misfit
Grep  :: misfit|audit-channel|Verify-phase|Step 3|step3
Read  :: .../inherited-core.md
```

Verdict: `{"ok": true, "step3conclusion": "No misfit: all 4 Done-when verification mechanisms
(grep, diff, self-dispatch, node --check) are self-referential ... but Done-when #3's
golden-replay clause reuses independent out-of-band evidence — recorded meta-cc traces from
separate prior iterations (M167/DIR-107, M173/DIR-109) — satisfying constructIndependent's
reuseExisting(differentActorOrEnv) branch. domainMisfit resolves to ok(), not ceilingTrigger."}`

### Result

| | wall time | tool calls | first action | verdict |
|---|---|---|---|---|
| OLD (no interpolation) | 87s | 12 | `find` for inherited-core.md | ok=true, no misfit |
| NEW (interpolated)     | 66s |  6 | `Read` charter file directly | ok=true, no misfit |

**24% wall-time reduction, 50% tool-call reduction**, same-environment same-day A/B, both real
(non-fixture) dispatches. The NEW run's first tool call goes directly to the correct charter file
— exactly the "no reconnaissance" behavior the directive's Finding #3 flags as absent in the
before-samples (M167/DIR-107 72s/14 calls, M173/DIR-109 234s/33 calls). `ok`/verdict direction
(no misfit found) is unchanged between OLD and NEW, matching the golden-replay requirement — the
change is context-only, not a behavior change to the decision procedure.

Raw transcripts: `/tmp/claude-1000/.../scratchpad/dm-run-1.jsonl` (NEW),
`/tmp/claude-1000/.../scratchpad/dm-run-old.jsonl` (OLD) — session-scratch, not committed
(reproducible from the prompt strings above against the checked-in files).

## Regression check

```
$ scripts/test.sh plugin/test/plugin-packaging.test.mjs
ℹ tests 30
ℹ pass 30
ℹ fail 0
```

Full `scripts/test.sh` (all packages, no live-GitHub) also run to completion:

```
$ scripts/test.sh
ℹ tests 517
ℹ suites 4
ℹ pass 514
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 308797.780522
```

3 skipped = the 3 live-GitHub tests (`serve-github.test.mjs`, `provider-abi-conformance.test.mjs`,
`cli-edit-parity-conformance.test.mjs`), expected without `QUAY_TEST_LIVE_GITHUB=1`. No test in the
repo exercises `execute-milestone.js`'s Verify-phase prompt strings directly (it's a workflow
script, not a unit under `packages/*/test`) — `plugin-packaging.test.mjs`'s byte-identical-mirror
assertion (line ~437-490) is the one structural check that would catch a `.claude/`/`plugin/`
drift, and it's part of the 514 passing.

## Files touched

- `.claude/workflows/execute-milestone.js` (domain-misfit dispatch prompt interpolation)
- `plugin/workflows/execute-milestone.js` (byte-identical mirror)

## Outcome

Both Done-when clauses on the mechanical side are satisfied (interpolation present, mirrors
identical, `node --check` clean). The real-dispatch clause is satisfied via a same-environment
headless-CLI proxy for the actual `Workflow`-tool `agent()` dispatch (which this Build-phase
subagent has no access to and which, for this very milestone, already ran with the OLD prompt
before Build started) — see "Real (non-fixture) before/after measurement" above for the
substitution rationale and the real numbers.
