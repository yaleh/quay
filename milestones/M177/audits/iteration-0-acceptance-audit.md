# M177 — iteration-0 acceptance audit (DIR-115)

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Verdict: REFUTED**

Fresh-context adversarial audit of DIR-115 ("Interpolate `${args.charterFile}` into the
domain-misfit Verify-check prompt"), milestone M177. This audit did not see the build; all
findings below are derived directly from git history, the checked-in code, the raw jsonl
transcripts left in the session scratchpad, and the mechanical gate script output.

## 1. AC satisfaction (refute-first)

### AC1 — dispatch prompt contains `${args.charterFile}` interpolation

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
no output. **Written back as `[x]` in tasks/DIR-115.md with citation.**

### AC2 — real execute-milestone call shows domain-misfit trace going straight to the right charter/task, no reconnaissance

**REFUTED (as literally written).**

`milestones/M177/iterations/iteration-0.md`'s own "Constraint acknowledged" section discloses
that the Build-phase subagent had no access to the outer `Workflow` tool's `agent()` dispatch
primitive, and that this milestone's own Verify phase already executed — with the OLD,
un-interpolated prompt — *before* Build started (Verify precedes Build in the phase sequence), so
the actual `execute-milestone.js` never exercised the new prompt at all during this milestone's
own run.

The implementer substituted a **headless `claude -p` CLI dispatch** of the bare OLD vs. NEW prompt
strings (same repo, same day) as "the closest genuine substitute available". I independently
re-opened and re-parsed the raw session artifacts left in the scratchpad
(`/tmp/claude-1000/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/scratchpad/`):

- `dm-run-old.jsonl` (OLD prompt): real, non-fabricated `claude -p` transcript. 13 `tool_use`
  blocks (not 12 as the write-up's abbreviated list shows — one `Grep` call was omitted from the
  doc's list; the raw trace has an extra `files_with_matches` grep). First action: `Bash find ...
  -iname inherited-core.md`. `result.duration_ms = 83428` (83.4s, not the write-up's rounded
  "87s"). Result: `{"ok": true, "step3conclusion": "No misfit. ..."}`.
- `dm-run-1.jsonl` (NEW prompt): real transcript. 7 `tool_use` blocks (the write-up's own prose
  says "(6 calls)" but then lists 7 lines — an internal off-by-one in the doc itself). First
  action: `Read` on `experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md`
  — the correct charter, directly, no reconnaissance. `result.duration_ms = 62438` (62.4s, not the
  write-up's rounded "66s"). Result: `{"ok": true, "step3conclusion": "No misfit: ..."}`.

So: the underlying raw evidence is genuine (not fixture, not fabricated) and directionally
supports the claim (NEW prompt → first action correct, fewer tool calls, less wall time). But it
is **not** what this AC (or the directive's Requested-action #3, "用真实的下一次 `/loop` 冷启动跑
一次 execute-milestone") asks for: a real `execute-milestone.js` Verify-phase `agent()` dispatch,
inside the actual workflow, with its own `agent-*.jsonl` trace. A same-day headless-CLI replay of
the prompt text, run by a different harness path (`claude -p` vs. the `Workflow` tool's internal
`agent()` call), with no other Verify-phase checks running in parallel and no real
`cacheFingerprints`/`priorVerifyCache` context, is a meaningfully different execution environment.
**Left unticked in tasks/DIR-115.md**, with the above cited as the reason.

### AC3 — measured wall-time drop vs. the 92s mean / 90s median baseline, real numbers not estimates

**REFUTED as written** — this AC's "同一次调用" (the same call) refers back to AC2's missing real
execute-milestone call. The proxy numbers (83.4s → 62.4s, independently re-derived above from
`result.duration_ms`, both below the 90-92s baseline) are real measurements, not estimates, but
they measure the substitute dispatch, not the call this AC specifies. **Left unticked**, same
citation as AC2.

### AC4 — golden-replay: same `ok`/`step3conclusion` verdict direction before/after

**CONFIRMED**, on a basis independent of the AC2/AC3 gap. I directly read the full `result` text
of both transcripts (not just the write-up's summary):

- OLD: `{"ok": true, "step3conclusion": "No misfit. Done-when items 1, 2, 4 are non-self-referential, mechanically independent verification channels ... Item 3 [is self-referential but doesn't force ceilingTrigger]"}`
- NEW: `{"ok": true, "step3conclusion": "No misfit: all 4 Done-when verification mechanisms ... are self-referential ... but Done-when #3's golden-replay clause reuses independent out-of-band evidence ... domainMisfit resolves to ok(), not ceilingTrigger."}`

Both conclude `ok: true` / no misfit for the same M177 charter under the OLD and NEW prompt text —
the reasoning paths differ in which sub-clause of the decision procedure they invoke, but the
verdict direction is unchanged. This satisfies the substance of "prompt-context-only, no behavior
drift" even though it is drawn from the same non-compliant proxy dispatch. **Written back as
`[x]` with citation** (flagging the shared caveat).

## 1a. Checklist write-back (DIR-020)

Applied directly to `tasks/DIR-115.md`:

- AC1 (`${args.charterFile}` interpolation present) → `[x]`, evidence cited inline.
- AC2 (real execute-milestone trace) → left `[ ]`, reason cited inline.
- AC3 (measured wall-time drop on that same real call) → left `[ ]`, reason cited inline.
- AC4 (golden-replay verdict stability) → `[x]`, evidence cited inline.
- DoD "committed to master" → `[x]`, evidence cited inline (commit `a14f7ea`).
- DoD "real execute-milestone call proves tool-call/time drop" → left `[ ]`, same reason as AC2.
- DoD "golden-replay proves no drift" → `[x]`, same basis as AC4.
- DoD "human-steered discipline (halt/golden-replay/independent audit), no autonomous SELECT" →
  left `[ ]` — not independently confirmable from available evidence (task carries
  `label:human-steered`, and the ABSORB entry describes this as one of "5 sequential human-steered
  milestones this session", but no committed halt-window or worktree-isolation record was found;
  the on-disk `.halt` sentinel is present but untracked/empty at audit time, and no prior
  independent-audit artifact existed before this one).

## 2. DoD satisfaction

Not satisfied. Per the task's own text: "Per DIR-026 Reading A：prompt 改了不算数，必须有真实调用
的前后耗时对比" (changing the prompt doesn't count — there must be a real-call before/after timing
comparison). The code change is real and committed, and the golden-replay clause is satisfied, but
the load-bearing DoD item — "至少一次真实 execute-milestone 调用证明了 tool-call 数下降 + 耗时下降"
— is unmet for the same reason as AC2/AC3 above: a headless-CLI proxy dispatch was substituted for
a real `execute-milestone.js` call, and the directive is explicit that this exact kind of
near-miss substitution is what it means to guard against.

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-115 experiments/quay-perpetual-stream/charters/M177-dir115-domain-misfit-context.md /tmp/m177-absorb-entry.md
PASS: clause3-line-budget
PASS: clause4-impl-row
PASS: clause5-no-self-exemption
PASS: clause6-escrow-delta-v (N/A)
PASS: clause8-task-canonical-lifecycle-record (N/A)
PASS: clause10-tree-hygiene
PASS: clause11-worktree-branch-hygiene
PASS: clause12-audit-independence (N/A — documented no-op)
N/A: clause9-split-or-commit
FAIL: clause0-ac-dod-present — checklist-form AC has 4 unchecked item(s) remaining (REFUTED-equivalent)
FAIL: clause1-adversarial-audit — NO disposition statement found in ABSORB-entry text
FAIL: clause2-vmeta-lag — NO disposition statement found in ABSORB-entry text
FAIL: clause7-test-floor — neither a ≥80% coverage disposition NOR a matching WAIVER line

FAIL: DoD check failed — 4 clause violation(s) found (see above).
Exit code: 1
```

Note: this was run BEFORE this audit's own checklist write-back changed `tasks/DIR-115.md` (4 of
8 items ticked), so clause0's "4 unchecked" count reflects the pre-audit state referenced by the
task's checklist form; even after write-back 4 items remain genuinely unticked (AC2, AC3, DoD
"real call", DoD "human-steered discipline"), so clause0 would still FAIL on a re-run. clause1/
clause2/clause7 fail independently of the checklist state — `/tmp/m177-absorb-entry.md` is a
minimal stub (value hypothesis + backlog row only, no adversarial-audit/V_meta/test-floor
disposition sections), the same recurring absorb-entry-template-incompleteness pattern already
logged against M138/M139/M142/M144/M145/M165/M168/M173/M176 in `dashboard.md`.

**Non-zero exit → REFUTED by construction**, per this audit's charge.

## 4. Deviation-log write-back (DIR-017 Step 3)

Two new rows appended to `dashboard.md`'s "Homeostatic variables" deviation table, both
`caught-by: machine` (this same audit pass; no separate writer/timing split):

1. `REFUTED | machine | M177` — mechanical gate exit 1 / 4 clause violations (clause0/1/2/7),
   stub ABSORB entry.
2. `REFUTED | machine | M177` — the code change is real and correct, but the central AC/DoD
   requirement (a real execute-milestone call demonstrating the improvement) was substituted with
   a headless-CLI proxy dispatch; substitute evidence independently re-verified as genuine but not
   the literal thing required.

No `caught-by: human` row was added — `/tmp/m177-absorb-entry.md` contains no disclosure/deviation
section for the outer loop to have drafted (it is a 2-section stub: value hypothesis + backlog
row only), so there was nothing to transcribe.

## Summary

The product change itself — interpolating `${$a.taskId}`/`${$a.charterFile}` into the
domain-misfit Verify-check dispatch prompt — is real, correctly implemented, committed to
`master` (`a14f7ea`), mirrored byte-identically into `plugin/workflows/execute-milestone.js`, and
consistent with the pattern already used by the other 4 checks in `_dispatchList`. The golden-
replay requirement (no behavior drift) is genuinely satisfied. But the milestone's central,
DIR-026-Reading-A-flagged evidentiary requirement — a real `execute-milestone.js` call
demonstrating the tool-call/wall-time reduction — was not met; a headless `claude -p` proxy
dispatch was substituted instead, a substitution the implementer disclosed but that does not
satisfy the AC/DoD as written. The mechanical gate independently confirms REFUTED (exit 1, 4
clause violations, incomplete ABSORB entry).

**Verdict: REFUTED.**
