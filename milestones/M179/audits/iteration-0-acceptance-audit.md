# M179 (DIR-070-F) — Adversarial Acceptance Audit — iteration 0

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Task:** DIR-070-F — Gap 3: extract reusable methodology skills to `plugin/skills/`
**Charter:** `experiments/quay-perpetual-stream/charters/M179-dir070f-methodology-skills.md`
**Implementation commit:** `6983aa6` (DIR-070-F: extract reusable methodology skills to plugin/skills/ (M179, Gap 3))
**Stance:** refute-first — every AC/DoD claim was independently re-derived from artifacts/diffs/test
output, not taken from the implementer's self-report or the pre-ticked checkboxes already present
in `tasks/DIR-070-F.md` (the same commit that shipped the feature also ticked all 9 boxes itself —
see Deviation D3 below; this is the M163 "preticked-checkboxes" pattern recurring).

## 1. Acceptance Criteria — refute-first verification

### AC1 — "Extracted skills pass leak test (no `experiments/quay-perpetual-stream` or `exp5`)"
**Attempted refutation:** `grep -rl "experiments/quay-perpetual-stream\|exp5" plugin/skills/quay-native-methodology/ plugin/skills/quay-webui-bootstrap-methodology/` → zero matches (grep exit 1).
**Verdict: CONFIRMED.** No leak in either of the 6 shipped reference files or 2 SKILL.md files.

### AC2 — "Original `.claude/skills/` still contain experiment-specific context"
**Attempted refutation:** checked whether the extraction quietly stripped the originals down to
just the mirrored reference files (which would falsify "still contain experiment-specific
context").
- `git status --porcelain .claude/skills/quay-native-methodology/ .claude/skills/quay-webui-bootstrap-methodology/` → empty (untouched by the commit).
- `ls .claude/skills/quay-native-methodology/` → `SKILL.md examples/ experiment-config.json inventory/ reference/ scripts/ templates/` — experiment-specific dirs (`examples`, `inventory`, `scripts`, `templates`, `experiment-config.json`) all still present, none extracted.
**Verdict: CONFIRMED.**

### AC3 — "`plugin.json` commands[] updated"
**Attempted refutation:** `git show 6983aa6 -- plugin/.claude-plugin/plugin.json` — diff shows
`commands[]` grew from 7 to 9 entries (`./skills/quay-native-methodology/SKILL.md`,
`./skills/quay-webui-bootstrap-methodology/SKILL.md` added) and the top-level `description` string
updated to list all 9 skills by name.
**Verdict: CONFIRMED.**

### AC4 — "`plugin-packaging.test.mjs` passes"
**Attempted refutation:** ran `node --test plugin/test/plugin-packaging.test.mjs` directly (not the
commit message's self-report). Result: **33 pass / 1 fail** (34 total) — NOT a clean pass as
literally worded.
- The 1 failure (`shipped schema-check modules are byte-identical to their exp5 canonical source,
  modulo attribution-only sanitization`, `task-schema.ts`) does **not** touch any DIR-070-F file.
- Independently reproduced against the pre-DIR-070-F parent commit (`git worktree add
  /tmp/wt-parent 6983aa6^`, symlinked `node_modules`, ran the same single test by name) — **fails
  identically**, byte-for-byte the same actual/expected diff. This confirms the failure predates
  and is unrelated to this task (task-schema.ts attribution-stripping drift, independent of
  methodology-skill extraction).
- All 4 tests DIR-070-F itself added (leak/fidelity/originals-unmodified/out-of-scope-confirmation)
  pass cleanly.
**Verdict: CONFIRMED with caveat** — the literal AC text ("passes") is not true of the whole file
(exit code 1), but the sole failure is proven pre-existing and orthogonal. Logged as a non-blocking
deviation (D1) rather than silently accepted.

## 1a. Checklist write-back (DIR-020)

`tasks/DIR-070-F.md`'s Acceptance Criteria were already `[x]` before this audit (self-ticked by the
implementer's own commit — see Deviation D3). This audit re-confirms all 4 independently; no
un-ticking required for AC1–AC3. AC4 is ticked with a caveat citation added (see file diff below).

## 2. Definition of Done — verification

### DoD1 — "Reference to `docs/proposals/exp5-deliverable-improvements.md` Gap 3"
`tasks/DIR-070-F.md:47` cites it. `docs/proposals/exp5-deliverable-improvements.md` §"差距
3：方法论文本技能留在 `.claude/skills/` 中" ("Gap 3: methodology-text skills remain in
`.claude/skills/`") lists exactly `quay-native-methodology` and `quay-webui-bootstrap-methodology`
as the reusable candidates, matching this task's scope verbatim.
**Verdict: CONFIRMED.**

### DoD2 — "Extracted methodology skills in `plugin/skills/`"
`plugin/skills/quay-native-methodology/{SKILL.md,reference/{gate-mechanics,directive-lifecycle,patterns,g3-audit-discipline}.md}`
and `plugin/skills/quay-webui-bootstrap-methodology/{SKILL.md,reference/{visual-review-mechanism,effectiveness-timing-corpus}.md}`
all present on disk; `diff -q` against their `.claude/skills/` sources reports **zero differences**
for all 6 reference files (byte-identical).
**Verdict: CONFIRMED.**

### DoD3 — "`plugin.json` updated"
Same evidence as AC3.
**Verdict: CONFIRMED.**

### DoD4 — "Plugin packaging test passes"
Same evidence/caveat as AC4.
**Verdict: CONFIRMED with caveat** (see D1).

### DoD5 — "Human-steered: touches `.claude/skills/`... read-only touch: confirmed by dedicated regression test that originals are unmodified"
`node --test --test-name-pattern="original .claude/skills/ sources are unmodified" plugin/test/plugin-packaging.test.mjs`
→ 1/1 pass. Independently re-verified via `git status --porcelain` (empty) + `diff -q` on all 6
files (empty) as in AC2.
**Verdict: CONFIRMED.**

## 3. Mechanical gate — `it0-dod-check.sh`

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-F \
    experiments/quay-perpetual-stream/charters/M179-dir070f-methodology-skills.md \
    /tmp/m179-absorb-entry.md
PASS: clause0-ac-dod-present  (4/4 AC checked)
PASS: clause3-line-budget
PASS: clause4-impl-row
PASS: clause5-no-self-exemption
PASS: clause6-escrow-delta-v (N/A)
PASS: clause8-task-canonical-lifecycle-record (N/A)
PASS: clause10-tree-hygiene
PASS: clause11-worktree-branch-hygiene
PASS: clause12-audit-independence (N/A)
N/A:  clause9-split-or-commit
FAIL: clause1-adversarial-audit — NO disposition statement found in ABSORB-entry text
FAIL: clause2-vmeta-lag — NO disposition statement found in ABSORB-entry text
FAIL: clause7-test-floor — NEITHER a >=80% coverage disposition NOR a WAIVER line

FAIL: DoD check failed — 3 clause violation(s) found.
EXIT=1
```

**Non-zero exit = REFUTED by construction** (per this audit's governing charge). The 3 failing
clauses are all absent-disposition-statement failures in `/tmp/m179-absorb-entry.md` — the same
recurring "absorb-entry-template-incompleteness" pattern already logged for M138/M139/M142/M144/
M145/M165/M168/M173/M176/M177/M178 in `dashboard.md`'s deviation table. `/tmp/m179-absorb-entry.md`
as it exists is a backlog-row + value-hypothesis stub with no adversarial-audit disposition, no
V_meta-lag disposition, and no test-floor disposition/WAIVER — none of which this audit is
authorized to originate (charge 4(ii): the audit *transcribes* an ABSORB disclosure the outer loop
already drafted; it does not originate one). No such disposition exists yet anywhere for M179, so
this is a genuine, fresh, machine-caught gap, not a transcription of a pre-existing human
disclosure.

## 4. Additional deviations found (machine, this pass)

**D1 (CONCERNS)** — `plugin-packaging.test.mjs` does not cleanly pass as AC4/DoD4 literally state
(1 of 34 tests fails). Verified pre-existing (reproduces identically on the pre-DIR-070-F parent
commit `6983aa6^`) and unrelated to this task's files (`task-schema.ts` attribution-stripping
drift, untouched by DIR-070-F). Non-blocking to this task's substance but the AC wording should be
read as "the 4 new tests pass and no *new* regression is introduced," not literally "the whole file
is green."

**D2 (CONCERNS)** — Task lifecycle incomplete: `tasks/DIR-070-F.md` is still `status: todo` on
master (`grep '^status:'` → `todo`) despite the implementation being merged (`6983aa6`) and content
substantively satisfying all AC/DoD items. No gate event for `DIR-070-F` exists in
`.quay/gate-events.jsonl` (grep returns empty) — the task was never promoted through
todo→ready→done. All 4 DIR-070 siblings (A–E) are `status: done`; F is the only child left at
`todo`, meaning the parent epic DIR-070 also cannot close. Recurring pattern (same class as
DIR-070-C/D, DIR-085, DIR-093 rows already in `dashboard.md`).

**D3 (CONCERNS)** — AC/DoD checkboxes in `tasks/DIR-070-F.md` were pre-ticked `[x]` by the
implementer's own commit (`6983aa6`, `git show -- tasks/DIR-070-F.md` shows all 9 boxes flipped
`[ ]`→`[x]` in the same commit that ships the feature), not left unticked for the audit's DIR-020
write-back as designed. Matches the recurring M163 "preticked-checkboxes" deviation class already
in `dashboard.md`. Content is independently re-confirmed true by this audit (see §1/§2), so this is
a process-hygiene deviation, not a substance defect.

**D4 (CONCERNS)** — Milestone evidence for M179 (`≥130` per the `gate_resolve_milestone_root`
single-sourced rule, ADR-004/M176) is filed under the **legacy** path
`experiments/quay-perpetual-stream/milestones/M179/` (charter + `iterations/iteration-0.md`)
instead of the **current** top-level path `milestones/M179/` that the rule requires for any
milestone number ≥130. Confirmed: `milestones/M175`, `M176`, `M177`, `M178` (the immediately
preceding milestones) all correctly live at the top-level path; `milestones/M179` does not exist at
all before this audit created the `audits/` subdirectory. M179's own charter/iteration artifacts
violate the very rule that M176 (an earlier child of this same DIR-070-F build sequence) itself
established. This audit's own output is written to the top-level `milestones/M179/audits/` path per
the authoritative `gate_resolve_milestone_root` function, deliberately not mirroring the
pre-existing misplacement.

## 5. Overall verdict

**REFUTED** — driven entirely by the mechanical gate (§3), which is non-zero by construction per
this audit's governing charge, and by D2 (lifecycle never promoted). The underlying implementation
substance (AC1–AC3, DoD1–DoD3, DoD5, and AC4/DoD4 with the D1 caveat) is genuinely sound: every
checkable claim was independently re-derived from artifacts, byte-diffs, and test output, not
self-report. Nothing in this task's own product code or extracted skill content was refuted. The
refutation is entirely process/governance-layer (missing ABSORB-entry disposition statements,
un-promoted lifecycle, misplaced milestone evidence directory) — the same class of finding this
dashboard has now logged for 11 consecutive prior milestones (M138 onward).
