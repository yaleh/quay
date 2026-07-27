# M177 — iteration-1

**Task:** DIR-115
**Charter:** experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md

## Context: why iteration-1

`iteration-0.md` landed the actual code change (commit `a14f7ea`, interpolating
`${$a.taskId}`/`${$a.charterFile}` into the domain-misfit dispatch prompt in both
`.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js`) but could
not produce the literal evidence AC2/AC3 and the matching DoD item require: a real
`execute-milestone.js` Verify-phase `agent()` dispatch trace exercising the NEW prompt. Its own
"Constraint acknowledged" section explained why — that milestone's own Verify phase had already
run (with the OLD prompt) *before* Build started, so the Build-phase subagent had no way to
trigger a fresh Verify pass from inside itself. It substituted a headless `claude -p` CLI replay
of the bare prompt strings instead.

`milestones/M177/audits/iteration-0-acceptance-audit.md` independently re-verified that
substitute evidence as genuine (not fabricated) but REFUTED it as non-compliant with the AC's
literal text — a headless CLI replay outside the `Workflow` tool's own `agent()` dispatch path,
with no sibling Verify checks running in parallel and no real cache context, is "a meaningfully
different execution environment." The subsequent verification pass in the same run explicitly
declined to mark `DIR-115` `needs-human` (ADR-014: an in-project phase-ordering gap is not a
legitimate needs-human reason) and recommended completing AC2/AC3 for real in a follow-up
milestone pass — i.e., exactly this one.

## No code change in this iteration

Re-confirmed the `a14f7ea` change is still intact and unregressed before doing anything else:

```
$ grep -n "domain-misfit audit-channel" -A2 .claude/workflows/execute-milestone.js
78:    `Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to milestone task ${$a.taskId}'s Done-when list (charter: ${$a.charterFile}). Return {ok: true, step3conclusion} ...`
79-    { label: 'domain-misfit', schema: { ... } }
80-  ) : null,

$ diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js && echo IDENTICAL
IDENTICAL

$ node --check .claude/workflows/execute-milestone.js && echo OK
OK
$ node --check plugin/workflows/execute-milestone.js && echo OK
OK
```

This iteration's job is purely evidentiary: close the AC2/AC3/DoD "real call" gap left open by
iteration-0.

## The real evidence: this very milestone's own live Verify phase

This Build dispatch is itself a step inside a genuine, currently-running `execute-milestone.js`
workflow invocation for M177/DIR-115 — session `006748f4-b16e-4522-a7a6-68b595240e42`, workflow
run `wf_a455e08f-70d` (the most recently created workflow directory under
`~/.claude/projects/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/subagents/workflows/`
at the time of writing). Its `journal.jsonl` shows the standard Verify-phase check sequence
(`gate-hash`, `line-budget`, `ceiling-check`, `dogfood-evidence`, `domain-misfit`) all resolving
for M177's own charter, immediately followed by a `"started"` entry for the next agent — which is
this Build dispatch. Because `a14f7ea` was already committed to `master` before this workflow run
started, **the domain-misfit check in this run's own Verify phase used the NEW, interpolated
prompt** — this is the literal "real execute-milestone dispatch" the directive and AC2/AC3 ask
for, not a proxy.

### Raw trace: `agent-abee3e03fae596266.jsonl`

Prompt actually dispatched (confirms the interpolation fired at runtime, not just in the source
file):

```
Apply the domain-misfit audit-channel decision procedure (inherited-core.md) to milestone task
DIR-115's Done-when list (charter:
experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md). Return {ok:
true, step3conclusion} — ...
```

Full tool-call trace with real wall-clock timestamps (from the raw jsonl, not rounded until the
summary table below):

| # | timestamp (UTC) | tool | action |
|---|---|---|---|
| — | 2026-07-27T02:41:19.151Z | (prompt received) | — |
| 1 | 2026-07-27T02:41:22.279Z | Bash | `find ... -name "inherited-core.md"; find ... -iname "*DIR-115*"; cat .../charters/M177-dir115-domain-misfit-context.md` — **first action, single call: locates inherited-core.md, locates `tasks/DIR-115.md`, AND reads the full correct charter, all at once** |
| 2 | 2026-07-27T02:41:27.258Z | Bash | `grep -n -i "domain-misfit" -A 60 inherited-core.md` |
| 3 | 2026-07-27T02:41:30.333Z | Bash | `grep -n -i "domain.misfit\|domainMisfit\|step3\|audit-channel" inherited-core.md` |
| 4 | 2026-07-27T02:41:32.142Z | Read | `inherited-core.md` offset 90 limit 35 |
| 5 | 2026-07-27T02:41:35.081Z | Bash | `grep -n -B5 -A40 "domain-misfit audit-channel" .claude/workflows/execute-milestone.js` |
| 6 | 2026-07-27T02:41:38.567Z | Read | `tasks/DIR-115.md` |
| 7 | 2026-07-27T02:42:24.326Z | StructuredOutput | `{"ok": true, "step3conclusion": "No misfit found. ..."}` |
| — | 2026-07-27T02:42:24.348Z | (result recorded) | — |

**Wall time: 65.197s** (02:41:19.151Z → 02:42:24.348Z). **6 substantive tool calls** (Bash x4,
Read x2) plus the final `StructuredOutput`.

**No reconnaissance calls of the kind Finding #3 (of the original directive) flags as the
pre-change failure mode**: zero reads of `dashboard.md`, zero `milestones/` directory scans, zero
`quay task list`/`quay task get` probing. Tool call #1 goes directly to the correct charter file
(read in full) and locates the correct task file path, 3.1s after the prompt arrives — because
the prompt itself now carries `${$a.taskId}`/`${$a.charterFile}`, the agent never has to guess
which milestone it is checking; all subsequent calls (2-6) are spent applying the actual
`domainMisfit` decision procedure from `inherited-core.md` to the four Done-when items, which is
the intended use of its runtime.

Verdict returned: `{"ok": true, "step3conclusion": "No misfit found. Applying
domainMisfit(mechanisms, doneWhen) to the charter's 4-item Done-when list ... items 1/2/4 were
each independently confirmed by the M177 iteration-0 acceptance audit ... Item 3 specifically was
REFUTED by that same audit ... but that gap was caught precisely by the independent audit channel
doing its job, so it is an AC-completeness finding, not a domain-misfit ..."}` — `ok: true`, no
misfit, matching the direction of every prior domain-misfit run against this same charter
(iteration-0's OLD/NEW proxy dispatches, and this real dispatch).

### Comparison to baseline

| run | environment | wall time | tool calls | first action |
|---|---|---|---|---|
| M167/DIR-107 (directive Finding #3, "normal") | real execute-milestone, OLD prompt | 72s | 14 | reads `inherited-core.md`, then `dashboard.md` |
| M173/DIR-109 (directive Finding #3, "messy") | real execute-milestone, OLD prompt | 234s | 33 | greps `inherited-core.md` x3, scans `milestones/` |
| 33-sample historical baseline (directive) | real execute-milestone, OLD prompt | mean 92s / median 90s | — | — |
| iteration-0 proxy OLD (`dm-run-old.jsonl`) | headless `claude -p`, OLD prompt | 83.4s | 13 | `find` for `inherited-core.md` |
| iteration-0 proxy NEW (`dm-run-1.jsonl`) | headless `claude -p`, NEW prompt | 62.4s | 7 | `Read` on correct charter |
| **this iteration — real dispatch** | **real execute-milestone.js Verify phase, NEW prompt** | **65.2s** | **7** (6 substantive + StructuredOutput) | **Bash call that reads the correct charter directly** |

**65.2s is a 27.6% reduction vs. the 90s baseline median and a 29.1% reduction vs. the 92s baseline
mean** — a real, measured wall-time drop from a genuine `execute-milestone.js` Verify-phase
`agent()` dispatch, not an estimate and not a proxy. It also closely matches iteration-0's proxy
NEW number (62.4s/7 calls vs. 65.2s/7 calls), confirming the proxy substitute was a reasonable
predictor even though it wasn't the literal required evidence — this run supplies the literal
evidence.

Raw source: `~/.claude/projects/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/subagents/workflows/wf_a455e08f-70d/agent-abee3e03fae596266.jsonl` (and sibling `journal.jsonl` in the same
directory, showing this agent's `result` entry immediately preceding the `"started"` entry for
this Build dispatch). Session-local, not committed (reproducible: any future `execute-milestone.js`
Verify pass against a charter with a committed `${$a.charterFile}` interpolation will produce the
same shape of trace).

## AC / DoD disposition (evidence only — write-back left to the audit pass, per DIR-026
audit-independence: the Build implementer should not self-tick its own AC/DoD boxes)

- AC2 ("real tool-call trace goes straight to the correct charter/task, no reconnaissance"): the
  evidence above is now the literal thing requested — a real `execute-milestone.js` Verify-phase
  `agent()` dispatch, not a proxy.
- AC3 ("measured wall-time drop vs. 92s/90s baseline, real numbers"): 65.2s, real, measured,
  27.6-29.1% below baseline.
- DoD "real execute-milestone call proves tool-call/time drop": same evidence satisfies this.
- DoD "human-steered discipline (halt/independent audit, no autonomous SELECT)": the on-disk
  `.halt` sentinel (`experiments/quay-perpetual-stream/.halt`) is present in the working tree at
  the time of this iteration, consistent with the ABSORB entry's description of this milestone as
  one of a serial run of human-steered directive milestones this session; a prior independent
  audit artifact now also exists (`milestones/M177/audits/iteration-0-acceptance-audit.md`). Left
  for the audit pass to independently confirm rather than self-certified here.

## Regression check

No source changed in this iteration (evidence-only), so the iteration-0 regression run still
applies: full `scripts/test.sh` (517 tests, 514 pass, 3 skipped live-GitHub) and
`plugin-packaging.test.mjs` (30/30) both passed as recorded in iteration-0. Re-ran `node --check`
on both touched files above (both `OK`) and the byte-identical mirror `diff` (both `IDENTICAL`) as
a fresh confirmation for this iteration.

## Files touched

- None (code unchanged since `a14f7ea`; this iteration is evidence-gathering only).
- `milestones/M177/iterations/iteration-1.md` (this file).
- `/tmp/m177-absorb-entry.md` — added `surface:method-infra` token to the Backlog row (Touches are
  `.claude/workflows/execute-milestone.js` / `plugin/workflows/execute-milestone.js`, not
  `packages/quay*` product code).

## Outcome

The literal AC2/AC3/DoD "real call" evidence gap left open by iteration-0 and REFUTED by the
iteration-0 acceptance audit is now closed with a genuine, non-proxy `execute-milestone.js`
Verify-phase `agent()` dispatch trace: 65.2s wall time (below the 90s/92s baseline), 6 substantive
tool calls with the first call reading the correct charter directly, zero reconnaissance calls,
and an unchanged `ok:true`/no-misfit verdict direction. AC/DoD checkbox write-back is left to the
next independent audit pass.
