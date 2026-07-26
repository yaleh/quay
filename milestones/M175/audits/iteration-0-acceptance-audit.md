# M175 (DIR-114) — iteration 0 acceptance audit

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Verdict: REFUTED**

Fresh-context adversarial audit of DIR-114 (M175 — args-normalization defense for the 5
checked-in `.claude/workflows/*.js` dynamic workflow scripts). Refute-first stance: every claim
below is checked against a concrete artifact (grep output, `git show`, a real `wf_*.json` /
`journal.jsonl` record, or a mechanical script's exit code) — never the implementer's self-report
alone.

## AC satisfaction

### AC #1 — all 5 checked-in scripts contain the `$a` normalization, zero raw `args.` refs

**CONFIRMED.** Ran `grep -n 'args\.' <file>` directly against all 5 checked-in files:

```
=== .claude/workflows/execute-milestone.js ===        (no matches)
=== .claude/workflows/drain-directives.js ===          (no matches)
=== .claude/workflows/diagnose-verify-failure.js ===   (no matches)
=== .claude/workflows/run-routines.js ===              (no matches)
=== .claude/workflows/select-preflight.js ===          (no matches)
```

Each file's `typeof args` check confirmed present:

```
.claude/workflows/execute-milestone.js:16:       const $a = (typeof args === 'string') ? JSON.parse(args) : args
.claude/workflows/drain-directives.js:14:         const $a = (typeof args === "string") ? JSON.parse(args) : args
.claude/workflows/diagnose-verify-failure.js:13:  const $a = (typeof args === 'string') ? JSON.parse(args) : args
.claude/workflows/run-routines.js:12:             const $a = (typeof args === 'string') ? JSON.parse(args) : args
.claude/workflows/select-preflight.js:12:         const $a = (typeof args === 'string') ? JSON.parse(args) : args
```

`node --check` passes on all 5 files plus the 3 `plugin/workflows/*.js` mirrors
(`execute-milestone.js`, `drain-directives.js`, `run-routines.js`), and `diff` confirms those
mirrors are byte-identical to their `.claude/workflows/` sources. **Ticked in `tasks/DIR-114.md`.**

### AC #2 — real (non-fixture) `Workflow()` call verifying both scripts, both args-delivery forms

**REFUTED.** The implementer's own `milestones/M175/iterations/iteration-0.md` states plainly
that the build session "has no `Workflow` tool in its own toolset" and built a non-Workflow
harness that "reproduces the Workflow runtime's exact args-delivery contract" instead — explicitly
NOT a literal `Workflow()` call, and explicitly NOT what this AC asks for ("贴出真实调用记录
（workflow run id + 结果，同 `wf_*.json` 这类真实产物）").

This audit went further and searched every session's real `~/.claude/projects/**/workflows/wf_*.json`
records for genuine post-fix evidence. Result:

- **One real `wf_*.json` exists for this exact code path** — `wf_ed780e0e-497`
  (`~/.claude/projects/-home-yale-work-quay/006748f4-b16e-4522-a7a6-68b595240e42/workflows/wf_ed780e0e-497.json`),
  the actual `execute-milestone` dispatch **for this very milestone** (`taskId: "DIR-114"`,
  `charterFile: ".../M175-dir114-args-normalization.md"`). Its `args` field is a JSON-encoded
  **string** (`"args":"{\"workspaceRoot\": ...}"` — the value is a string, not an object),
  independently confirming the bug's own root-cause claim. Recorded result:
  `"status":"failed"`, `"error":"Error: undefined is not an object (evaluating
  'args.charterFile.match')"`, timestamp `2026-07-26T14:50:15.631Z` — **before** the fix commit
  `f663857` (authored `2026-07-26T15:02:07Z`). It crashed.
- That same run's `subagents/workflows/wf_ed780e0e-497/journal.jsonl` shows it later continued
  (Verify checks passing, Build completing with `mergeCommit: f663857`) — but only because the
  session hand-patched its own **private materialized script copy**
  (`~/.claude/projects/.../workflows/scripts/execute-milestone-wf_ed780e0e-497.js`; `diff` against
  the adjacent `.js.bak` shows the normalization block and comment rewording were added in place)
  and resumed dispatch under the **same runId**. This is the identical ephemeral-patch anti-pattern
  DIR-114's own Finding #4 was filed to eliminate ("那次修复只打在会话私有临时副本上，没有落到仓库")
  — it is not a fresh `Workflow()` dispatch against the checked-in, fixed master scripts.
- **No real `wf_*.json` for `drain-directives.js` post-fix exists anywhere** under
  `~/.claude/projects/` (searched all sessions). The only `drain-directives.js` real runs on record
  (`wf_25dd9c40-fe8` failed / `wf_6772fd6c-b12` succeeded, session `80ae3423`) both **predate** this
  fix and are the exact instability the Finding cites as evidence of the bug, not evidence of a fix.
- No real call in either "args is object" form was found anywhere for either script.

Net: zero genuine `Workflow()` evidence that the checked-in fix works, in either script, in either
delivery form. **Left unticked in `tasks/DIR-114.md`**, with the above evidence inlined.

### AC #3 — a real `/loop` cold-start no longer shows this crash class

**REFUTED.** The real, live cold-start that dispatched this very milestone (`wf_ed780e0e-497`,
above) is the most current evidence available, and it shows the opposite of what the AC requires:
it **crashed** with exactly `Error: undefined is not an object (evaluating
'args.charterFile.match')`. There is no subsequent fresh cold-start record (post `f663857`)
proving a clean run. **Left unticked**, with the above evidence inlined.

### AC write-back (DIR-020)

Applied directly to `tasks/DIR-114.md`: AC #1 ticked `[x]` with evidence; AC #2 and AC #3 left
`[ ]` with inline REFUTED evidence citations (not just left blank — the refutation itself is now
recorded in the task file per DIR-020's intent that unconfirmed items still carry a trail).

## DoD satisfaction

- **DoD item 1** ("real commit on `master`, not a session-private copy") — **CONFIRMED.**
  `git show --stat f663857` shows the 5 `.claude/workflows/*.js` files (+ 3
  `plugin/workflows/*.js` mirrors) changed on `master` HEAD, commit
  `f663857df92da46b2f334c9fc4e058d7449acb39`. Ticked.
- **DoD item 2** ("normalization actually verified by ≥1 real workflow call, both forms, not just
  an assertion") — **REFUTED**, same evidence as AC #2. Left unticked.
- **DoD item 3** ("human-steered discipline: halt/golden-replay/independent audit, no autonomous
  SELECT") — **CONFIRMED.** `experiments/quay-perpetual-stream/.halt` exists (mtime
  `2026-07-26T12:42:43Z`), predating the M175 charter's own creation (mtime
  `2026-07-26T14:49:58Z`) and the build dispatch (`14:50:15Z`) — the loop was already paused before
  this milestone was authored/selected. `tasks/DIR-114.md`'s own frontmatter already carries
  `label: human-steered`. Audit independence is satisfied structurally: this audit runs as a
  fresh-context subagent (`agent-a7538cfb9f2f846da`) dispatched by the workflow's own Audit phase,
  distinct from the build agent (`agent-a926d4069f0345a2e`) — same audit agent performing this
  write-back, no split timing. Ticked.

## Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-114 \
    experiments/quay-perpetual-stream/charters/M175-dir114-args-normalization.md \
    /tmp/m175-absorb-entry.md
...
FAIL: clause0-ac-dod-present: checklist-form AC has 3 unchecked item(s) remaining (REFUTED-equivalent,
  HARD-blocks exactly as an unmet criterion does): "5 个 checked-in workflow 脚本...", "对至少
  execute-milestone.js 和 drain-directives.js 两个脚本...", "一次真实的 `/loop` 冷启动..." [tasks/DIR-114.md]
FAIL: clause1-adversarial-audit: NO disposition statement found in ABSORB-entry text
FAIL: clause2-vmeta-lag: NO disposition statement found in ABSORB-entry text
FAIL: clause7-test-floor: FAIL — ... NEITHER a ≥80% test-coverage disposition NOR a matching waiver

FAIL: DoD check failed — 4 clause violation(s) found (see above).
EXIT CODE: 1
```

Non-zero exit — **REFUTED by construction** per the audit charge. (Note: the script was run
against the task file *before* this audit's own AC write-back landed the `[x]` for AC #1, so
clause0's "3 unchecked" count reflects the pre-write-back state; after write-back only 2 AC items
— #2 and #3 — remain genuinely unresolved, which is consistent with this audit's own findings, not
a discrepancy. The 3 remaining clause failures — clause1/clause2/clause7 — are `/tmp/m175-absorb-
entry.md` not existing yet, expected at this pipeline stage since Land has not run.)

## Deviation-log write-back (DIR-017 Step 3)

Two `REFUTED` / `machine` rows appended to `dashboard.md`'s "Homeostatic variables (DIR-017 Step
3)" deviation table for M175/DIR-114 (AC#2/DoD#2 lack-of-real-verification; AC#3 cold-start
crash-not-absence-of-crash), both `status: open`, `age: 0`. No `caught-by: human` row was added —
no ABSORB entry exists yet at `/tmp/m175-absorb-entry.md` for this audit to transcribe a
disclosure from (Land phase has not run).

## Bottom line

The mechanical substitution itself (AC #1, DoD #1) is real and correctly done — verified directly,
not from self-report. But the milestone's own explicitly-required verification bar — a real,
non-fixture `Workflow()` call proving the fix works, for at least `execute-milestone.js` and
`drain-directives.js`, in both args-delivery shapes — was not met. Worse, the one genuine, real
`Workflow()` artifact this audit found for this exact code path is a **live crash** on the very
cold-start dispatching this milestone, recovered only via the same session-private ephemeral-patch
pattern the directive's own Finding #4 named as the problem to eliminate. That is direct evidence
counter to AC #3's claim, not merely "unconfirmed." Verdict: **REFUTED**.
