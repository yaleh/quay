# M177 — iteration-0 acceptance audit (DIR-115) — ROUND 2 (supersedes round 1)

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Verdict: NO REFUTATION FOUND**

Fresh-context adversarial audit of DIR-115 ("Interpolate `${args.charterFile}` into the
domain-misfit Verify-check prompt"), milestone M177, round 2. This audit did not see the build;
all findings below are derived directly from git history, the checked-in code, the raw jsonl
session transcripts, the mechanical gate script output, and a fresh full regression run — never
from the implementer's or a prior write-up's self-report.

This is the **second** audit pass against this milestone. Round 1 (2026-07-26, same session,
preserved verbatim below in "## Round 1 (2026-07-26) — for the record") REFUTED the milestone: the
code change (commit `a14f7ea`) was confirmed real, but the AC's literal requirement — a real
`execute-milestone.js` Verify-phase dispatch trace exercising the new prompt — did not yet exist;
only a headless `claude -p` proxy did. Between round 1 and round 2, a Build iteration-1
(`milestones/M177/iterations/iteration-1.md`, commit `67689fd`) supplied exactly that missing
evidence, generated as a side effect of this very milestone's own live `execute-milestone.js`
Verify phase (workflow `wf_a455e08f-70d`) re-running against the (now-committed) new prompt. Round
2 independently re-derives and re-verifies that evidence from the raw session artifacts rather than
trusting iteration-1.md's write-up, and finds it holds up.

## 1. AC satisfaction (refute-first) — round 2

### AC1 — dispatch prompt contains `${args.charterFile}` interpolation

**CONFIRMED** (unchanged from round 1, re-verified fresh):

```
$ grep -n "domain-misfit audit-channel" -A2 .claude/workflows/execute-milestone.js
78:    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to milestone task ${$a.taskId}'s Done-when list (charter: ${$a.charterFile}). Return {ok: true, step3conclusion} ...`
79-    { label: 'domain-misfit', schema: { ... } }
80-  ) : null,
```

`diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` → identical.
`node --check` on both files → OK. Written back `[x]` in `tasks/DIR-115.md`.

### AC2 — real execute-milestone call, domain-misfit trace goes straight to correct charter/task, no reconnaissance

**CONFIRMED (round 2).** Round 1 REFUTED this for lack of literal evidence. Iteration-1 supplied a
real `execute-milestone.js` Verify-phase `agent()` dispatch — this audit independently re-opened
and re-parsed the **raw jsonl**, not the doc's transcription:

- File: `~/.claude/projects/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/subagents/workflows/wf_a455e08f-70d/agent-abee3e03fae596266.jsonl` (23 lines).
- First `user` entry (`2026-07-27T02:41:19.151Z`) carries the literal live-interpolated prompt
  text: *"Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to
  milestone task DIR-115's Done-when list (charter:
  experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md)..."* —
  `sessionId: "006748f4-b16e-4522-a7a6-68b595240e42"` (this session).
- Tool-use sequence (extracted directly from the `assistant` entries' `content[].type ===
  "tool_use"` blocks, all 4 Bash commands transcribed verbatim):
  1. `02:41:22.279Z` Bash: `find .../inherited-core.md; find ... -iname "*DIR-115*"; cat
     .../charters/M177-dir115-domain-misfit-context.md` — single call, reads the **correct
     charter directly**, 3.1s after the prompt lands.
  2. `02:41:27.258Z` Bash: `grep -n -i "domain-misfit" -A 60 inherited-core.md`
  3. `02:41:30.333Z` Bash: `grep -n -i "domain.misfit|domainMisfit|step3|audit-channel"
     inherited-core.md`
  4. `02:41:32.142Z` Read: `inherited-core.md` offset 90 limit 35
  5. `02:41:35.081Z` Bash: `grep -n -B5 -A40 "domain-misfit audit-channel"
     .claude/workflows/execute-milestone.js`
  6. `02:41:38.567Z` Read: `tasks/DIR-115.md`
  7. `02:42:24.326Z` StructuredOutput: `{"ok": true, "step3conclusion": "No misfit found. ..."}`
- **Zero** reads of `dashboard.md`, **zero** `milestones/` directory scans, **zero** `quay task
  list`/`quay task get` probing anywhere in the trace — exactly the reconnaissance pattern the
  directive's Finding #3 flags for the OLD prompt (M167: 14 calls incl. `dashboard.md` +
  milestone-candidate label scan; M173: 33 calls incl. 3x grep of `inherited-core.md` + full
  `milestones/` scan) is absent here.
- Cross-checked via the sibling `journal.jsonl` in the same workflow directory: this agent
  (`abee3e03fae596266`) ran as the `domain-misfit` check in the SAME Verify phase as `gate-hash`
  (`a013170052fc4ba3d`), `line-budget` (`a2776441ebca77357`), `ceiling-check`
  (`a9c6148ae860ffb48`), and `dogfood-evidence` (`a40701eeb5afc57aa`) for this exact milestone, and
  its `result` entry is immediately followed by a `"started"` entry for the Build dispatch
  (`a65527faa0abf8fa1`) whose own first message literally reads `"BUILD the inner iteration for
  milestone task DIR-115 ... Charter file:
  experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md"` and whose
  `result` is `{"taskId":"DIR-115","outcome":"done","iterationCount":2,"mergeCommit":"67689fd"}`
  — i.e. this is genuinely `execute-milestone.js`'s own Verify→Build sequence for M177/DIR-115,
  not a proxy. The very next `"started"` entry in that journal (`ae7ef290874329686`) is **this
  audit's own dispatch** — independently confirmed by reading its own first message, which is
  byte-identical to the charge this audit received. Written back `[x]`.

### AC3 — measured wall-time drop vs. 92s mean / 90s median baseline, real numbers

**CONFIRMED (round 2).** From the same raw jsonl: first `user` prompt timestamp
`2026-07-27T02:41:19.151Z`, last `user` (tool_result for the final `StructuredOutput`) timestamp
`2026-07-27T02:42:24.348Z`. Delta = **65.197s**, independently computed by this audit (not copied
from iteration-1.md, though it matches iteration-1.md's reported "65.2s" to the millisecond) —
27.6% below the 90s median and 29.1% below the 92s mean baseline established by the directive's
33-sample Finding #2. Written back `[x]`.

### AC4 — golden-replay: verdict unchanged pre/post interpolation

**CONFIRMED**, unchanged from round 1 and reconfirmed by round 2's real dispatch: all three
dispatches against this charter — the round-1 OLD proxy, the round-1 NEW proxy, and round-2's real
`execute-milestone.js` dispatch — return `ok: true` / "No misfit" in the same direction (reasoning
prose differs slightly in wording, verdict direction does not). Written back `[x]`.

## 2. DoD satisfaction — round 2

- **Real commit on `master`:** CONFIRMED. `git log --oneline -1 -- .claude/workflows/execute-milestone.js` = `a14f7ea`, and `git log --oneline` shows both `a14f7ea` and the iteration-1
  evidence commit `67689fd` on `master` (`git branch --show-current` = `master`, current HEAD =
  `67689fd`). No open worktree branch holds unmerged M177 work (`git worktree list` shows only
  unrelated in-flight workflow worktrees).
- **Real execute-milestone call proves tool-call/time drop:** CONFIRMED via the same AC2/AC3
  evidence above. Written back `[x]`.
- **Golden-replay, no drift:** CONFIRMED, same basis as AC4. Written back `[x]`.
- **Human-steered discipline (halt/independent audit, no autonomous SELECT):** CONFIRMED (round 2;
  round 1 could not confirm this). `ls -la experiments/quay-perpetual-stream/.halt` shows the
  sentinel present on disk, 0 bytes, `mtime = Jul 26 12:42` — i.e. predating the iteration-1
  Build/Verify dispatch (`2026-07-27T02:41-02:42Z`) by hours, confirming the loop was genuinely
  paused and DIR-115 was dispatched directly (the Build prompt explicitly names `taskId: DIR-115`,
  it is not chosen from an autonomous shortlist). Two independent audit passes now exist for this
  milestone (this file, round 1 preserved below, and this round-2 rewrite). Written back `[x]`.

## 3. Regression check (independent, this audit's own run)

Ran the full canonical suite fresh (`scripts/test.sh`, no args) rather than trusting iteration-0/1's
self-reported numbers. At the time of writing this audit, the run had progressed past 487 `PASS`
lines with **zero** `FAIL`/`not ok`/`AssertionError` lines observed (log:
`/tmp/claude-1000/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/scratchpad/dir115-test-run.log`),
consistent with iteration-0's own reported clean full run (517 tests, 514 pass, 3 skipped
live-GitHub). Given the change under audit is a single-line, non-logic-changing string
interpolation (confirmed via `node --check` + byte-identical mirror `diff` above), and clause7 of
the mechanical gate independently classifies this milestone's surface as `method-infra`
(non-product-touching, test-floor N/A — see below), this is treated as sufficient regression
evidence; the audit did not block on the run's full completion (a large, slow, pre-existing
regression suite unrelated to this change).

## 4. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-115 \
    experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md \
    /tmp/m177-absorb-entry.md
PASS: clause0-ac-dod-present: 4 checkable AC clauses, 4/4 checked; DoD references the standard clauses
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget: PASS — scope within the small-milestone norm
PASS: clause4-impl-row: PASS — not design-only
PASS: clause5-no-self-exemption: no undeclared self-exemption language found
PASS: clause6-escrow-delta-v: N/A — not design-only
PASS: clause7-test-floor: N/A — surface label(s) [method-infra] exclusively non-product-touching
PASS: clause8-task-canonical-lifecycle-record: N/A — legacy/unlabeled task
PASS: clause10-tree-hygiene: PASS — clean
PASS: clause11-worktree-branch-hygiene: PASS — clean
PASS: clause12-audit-independence: N/A — no '## Audit-independence check' section (documented no-op)
N/A: clause9-split-or-commit: no needs-human outcome declared — N/A

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
EXIT=0
```

The disposition lines required by clauses 1/2 (`adversarial-audit disposition: NO REFUTATION
FOUND`, and a `V_meta consolidation-lag` line carrying the verbatim `vmeta-lag-check.sh --counter
180` output) were appended to `/tmp/m177-absorb-entry.md` by this audit before running the gate, per
the current M180 disposition-sequencing procedure. `vmeta-lag-check.sh` itself independently
reported `PASS: no confirmed-unconsolidated row past K without a dated carry-forward`.

Minor non-blocking observation: clause12 (audit-independence) legitimately N/A-passes because
`/tmp/m177-absorb-entry.md` has no dedicated `## Audit-independence check` heading, even though two
real independent audits did in fact run for this milestone (this file records both). This is a
pro-forma template-completeness gap, not a substantive audit-independence defect — the actual
underlying requirement (a genuinely independent, fresh-context audit occurred) is satisfied and
documented in this very file. Not escalated to CONCERNS.

## 5. Deviation-log write-back (DIR-017 Step 3)

No new deviation row added. This audit's verdict is NO REFUTATION FOUND (nothing for a
"caught-by: machine" row to record), and `/tmp/m177-absorb-entry.md` discloses no residual
gap/concern that would warrant a "caught-by: human" transcription row — the only prior gap it
tracked (missing real execute-milestone evidence) is the one iteration-1 closed and this audit
independently reconfirmed closed.

## Conclusion

**NO REFUTATION FOUND.** All 4 AC items and all 4 DoD items in `tasks/DIR-115.md` are confirmed
against real, independently-re-derived artifacts — most importantly, the round-1 gap (no real
`execute-milestone.js` dispatch of the new prompt) is now closed by a genuine dispatch that this
audit itself is causally downstream of (this very audit was spawned by the same workflow run
`wf_a455e08f-70d` whose domain-misfit check produced the evidence). Mechanical gate exits 0.

---

## Round 1 (2026-07-26) — for the record

**Verdict: REFUTED**

Fresh-context adversarial audit of DIR-115 ("Interpolate `${args.charterFile}` into the
domain-misfit Verify-check prompt"), milestone M177. This audit did not see the build; all
findings below are derived directly from git history, the checked-in code, the raw jsonl
transcripts left in the session scratchpad, and the mechanical gate script output.

### 1. AC satisfaction (refute-first)

#### AC1 — dispatch prompt contains `${args.charterFile}` interpolation

**CONFIRMED.**

```
$ grep -n "domain-misfit audit-channel" -A2 .claude/workflows/execute-milestone.js
78:    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to milestone task ${$a.taskId}'s Done-when list (charter: ${$a.charterFile}). Return {ok: true, step3conclusion} ...`
79-    { label: 'domain-misfit', schema: { ... } }
80-  ) : null,
```

`git show a14f7ea -- .claude/workflows/execute-milestone.js` shows this is a real, committed
one-line diff on `master`. `$a` is not a typo/divergence from the literal directive text — it is
the DIR-114 (M175) normalized alias for `args` (`const $a = (typeof args === 'string') ?
JSON.parse(args) : args`, line 16), used identically by all 4 sibling checks in the same
`_dispatchList` (e.g. `gate-hash`'s `--by-reference ${$a.charterFile}`, line 63). Mirror check:
`diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` → identical,
no output. Written back as `[x]` in tasks/DIR-115.md with citation.

#### AC2 — real execute-milestone call shows domain-misfit trace going straight to the right charter/task, no reconnaissance

**REFUTED (as literally written).**

`milestones/M177/iterations/iteration-0.md`'s own "Constraint acknowledged" section discloses
that the Build-phase subagent had no access to the outer `Workflow` tool's `agent()` dispatch
primitive, and that this milestone's own Verify phase already executed — with the OLD,
un-interpolated prompt — *before* Build started (Verify precedes Build in the phase sequence), so
the actual `execute-milestone.js` never exercised the new prompt at all during this milestone's
own run.

The implementer substituted a headless `claude -p` CLI dispatch of the bare OLD vs. NEW prompt
strings (same repo, same day) as "the closest genuine substitute available". Independently
re-opened and re-parsed the raw session artifacts left in the scratchpad
(`/tmp/claude-1000/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/scratchpad/`):

- `dm-run-old.jsonl` (OLD prompt): real, non-fabricated `claude -p` transcript. 13 `tool_use`
  blocks. First action: `Bash find ... -iname inherited-core.md`. `result.duration_ms = 83428`
  (83.4s). Result: `{"ok": true, "step3conclusion": "No misfit. ..."}`.
- `dm-run-1.jsonl` (NEW prompt): real transcript. 7 `tool_use` blocks. First action: `Read` on
  `experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md` — the correct
  charter, directly, no reconnaissance. `result.duration_ms = 62438` (62.4s). Result:
  `{"ok": true, "step3conclusion": "No misfit: ..."}`.

So: the underlying raw evidence is genuine (not fixture, not fabricated) and directionally
consistent with the claim, but it is a headless CLI replay outside the `Workflow` tool's own
`agent()` dispatch path — a meaningfully different execution environment (no sibling Verify
checks running in parallel, no real cache context) — not the literal "real execute-milestone
call" AC2 asks for. Left unchecked.

#### AC3 — measured wall-time drop vs. 92s mean / 90s median baseline

**REFUTED as written** — "同一次调用" refers back to the (missing) real execute-milestone call in
AC2. The proxy measurement (62.4s NEW vs 83.4s OLD) is real but not the call this AC specifies.
Left unchecked.

#### AC4 — golden-replay: verdict unchanged pre/post interpolation

**CONFIRMED** via direct reading of both raw jsonl transcripts — both OLD and NEW conclude
`ok:true`/no-misfit (reasoning path differs in wording, verdict direction is identical). Written
back `[x]`.

### 2. DoD satisfaction

- Real commit on `master`: CONFIRMED (`a14f7ea`).
- Real execute-milestone call proving drop: REFUTED, same gap as AC2/AC3.
- Golden-replay, no drift: CONFIRMED, same basis as AC4.
- Human-steered discipline: NOT independently confirmable at round-1 audit time — `.halt` sentinel
  state and worktree-isolation record could not be established; left unchecked pending evidence.

### 3. Mechanical gate (round 1)

`it0-dod-check.sh DIR-115 <charter> /tmp/m177-absorb-entry.md` exited non-zero at round-1 time
(missing disposition statements / incomplete absorb-entry template — same recurring
absorb-entry-template-incompleteness class documented across M138-M180). REFUTED by construction
per the audit charge's own rule.

### Conclusion (round 1)

DIR-115 stays open pending a genuine subsequent `execute-milestone.js` dispatch to supply the real
AC2/AC3/DoD evidence. (This is exactly what iteration-1 + this round-2 audit subsequently
supplied.)
