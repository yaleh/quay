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

---

## Round 2 (re-audit, post Build-iteration-1 fix, 2026-07-27)

**Same audit session id (`006748f4-b16e-4522-a7a6-68b595240e42`), fresh pass** — dispatched with no
prior memory of this transcript; every claim below was independently re-derived this round, not
copied from Round 1's text (Round 1's numbers are cited only where this round's own re-run reproduced
them identically).

**Trigger:** intervening commit `7bed8c2` ("M179/DIR-070-F: Build iteration 1") tagged
`/tmp/m179-absorb-entry.md`'s `## Backlog row` with `surface:packaging`, flipping
`clause7-test-floor` FAIL→N/A. clause1/clause2 remained FAIL by design — their disposition text is
this Audit phase's own responsibility (`gap-absorb-entry-clause-disposition-sequencing`, M180/M181),
not fabricable by Build.

### Round-2 independent re-verification of AC1–AC4 / DoD1–DoD5

All 9 items re-derived fresh against live artifacts (not Round 1's text, not the task file's own
citations):

- **AC1** (leak test): `grep -rl "experiments/quay-perpetual-stream\|exp5" plugin/skills/quay-native-methodology/ plugin/skills/quay-webui-bootstrap-methodology/` → exit 1, zero matches. **CONFIRMED.**
- **AC2** (originals untouched): `git status --porcelain .claude/skills/quay-native-methodology/ .claude/skills/quay-webui-bootstrap-methodology/` → empty; `ls` on both shows `examples/`, `inventory/`, `scripts/`, `templates/`, `experiment-config.json` still present (native) and the extra `g3-visual-review-env-gap.md`/`v-meta-ceiling-two-experiment.md` reference files still present (webui-bootstrap) alongside the mirrored ones. **CONFIRMED.**
- **AC3** (`plugin.json` commands[]): `git show 6983aa6 -- plugin/.claude-plugin/plugin.json` — diff independently re-read, `commands[]` 7→9, both new SKILL.md paths added, description string updated. **CONFIRMED.**
- **AC4** (`plugin-packaging.test.mjs` passes): `node --test plugin/test/plugin-packaging.test.mjs` re-run live this round → **33 pass / 1 fail** (34 total), same single failure (`task-schema.ts` attribution-stripping). Independently confirmed `6983aa6`'s own `--stat` diff touches **zero** `task-schema.ts`/`task-schema.mjs` files anywhere in the repo (`git show 6983aa6 --stat`: 13 files, all under `plugin/skills/`, `plugin/.claude-plugin/`, `plugin/test/`, `tasks/`, milestone evidence — no schema-check module). `git log -- plugin/gate-scripts/task-schema.ts` shows its last two touches are `b310adb`/`8d1ded4`, both from before this task existed. **CONFIRMED with the same caveat as Round 1** — genuinely pre-existing and orthogonal, re-verified by lineage this round rather than by a throwaway worktree diff.
- **DoD1** (Gap-3 doc reference): `tasks/DIR-070-F.md:47` cites `docs/proposals/exp5-deliverable-improvements.md`; `grep -n "差距 3" docs/proposals/exp5-deliverable-improvements.md` → §"差距 3：方法论文本技能留在 `.claude/skills/` 中", row 6 of its table names "打包剩余的方法论文本技能" (package the remaining methodology-text skills) as the Gap-3 candidate. **CONFIRMED.**
- **DoD2** (extracted skills byte-identical): `diff -q` re-run this round on all 6 reference files (`gate-mechanics.md`, `directive-lifecycle.md`, `patterns.md`, `g3-audit-discipline.md`, `visual-review-mechanism.md`, `effectiveness-timing-corpus.md`) between `.claude/skills/.../reference/` and `plugin/skills/.../reference/` → zero output (identical) on all 6. **CONFIRMED.**
- **DoD3**: same evidence as AC3. **CONFIRMED.**
- **DoD4**: same evidence/caveat as AC4. **CONFIRMED with caveat.**
- **DoD5** (read-only touch, regression-tested): `node --test --test-name-pattern="original .claude/skills/ sources are unmodified" plugin/test/plugin-packaging.test.mjs` → 1/1 pass, re-run live this round. **CONFIRMED.**

No AC/DoD item was refuted this round. §1a checklist write-back: all 9 boxes were already `[x]` with
evidence citations (committed at `5eed42a`, the same commit Round 1 itself made) — this round's
independent re-derivation matches every citation; no un-ticking required.

### Disposition statements appended this round (charge step 2a)

Verdict reached from the re-verification above (NO REFUTATION FOUND) was written to
`/tmp/m179-absorb-entry.md` as `adversarial-audit disposition: NO REFUTATION FOUND ...` — written
only after the verdict above was actually reached, per the charge's own sequencing requirement.
`vmeta-lag-check.sh --counter 183 experiments/quay-perpetual-stream/v-meta-ledger.md` was then run
live (milestone_counter=184 at time of this audit per `dashboard.md` line 4, so counter=184-1=183 per
the charge's own arithmetic) and its **verbatim** output —

```
milestone_counter=183 K=2
  [ok] consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)
  [ok] proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson

PASS: no confirmed-unconsolidated row past K without a dated carry-forward
```

— was copied (not paraphrased) into a `V_meta consolidation-lag: ...` line in the same file.

### Round-2 mechanical gate re-run

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-070-F \
    experiments/quay-perpetual-stream/charters/M179-dir070f-methodology-skills.md \
    /tmp/m179-absorb-entry.md
PASS: clause0-ac-dod-present
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget
PASS: clause4-impl-row
PASS: clause5-no-self-exemption
PASS: clause6-escrow-delta-v (N/A)
PASS: clause7-test-floor: N/A — surface label(s) [packaging] are exclusively non-product-touching
PASS: clause8-task-canonical-lifecycle-record (N/A)
PASS: clause10-tree-hygiene
PASS: clause11-worktree-branch-hygiene
PASS: clause12-audit-independence (N/A — no '## Audit-independence check' section)
N/A:  clause9-split-or-commit

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared
self-exemption.
EXIT=0
```

**Zero exit.** Per the charge, this is no longer REFUTED-by-construction.

Note on clause12: same documented no-op as M177/M178/M181's own audits — no `## Audit-independence
check` section exists in `/tmp/m179-absorb-entry.md`, and this audit is not itself the kind of
orchestrated multi-agent dispatch that section is designed to corroborate (a single subagent
adversarial-audit invocation, not a `Workflow`-tool-dispatched pipeline stage), so the no-op reading
is accurate, not a gap this pass is refuting.

### Still-open, unresolved-by-this-round findings (not new; already logged in `dashboard.md`)

- **Lifecycle non-promotion** (dashboard.md line 525): re-checked live — `grep '^status:' tasks/DIR-070-F.md` still returns `todo`; `grep 'DIR-070-F' .quay/gate-events.jsonl` now returns **one** event (`split-or-commit`, verdict `pass`, timestamp `2026-07-26T18:04:26Z`) but **no** lifecycle-promotion (`todo→ready→done`) event exists — Round 1's stronger claim of "no gate event exists at all" is now imprecise (one exists, just not a promotion event); the underlying substance of the CONCERNS row (task never promoted, parent DIR-070 epic still open) remains true and unresolved. Not this audit's authority to fix (downstream of Build/Audit, an ABSORB/Land-phase action) — left as-is in dashboard.md.
- **Pre-existing unrelated test failure** (D1/dashboard.md line 524): still present, re-confirmed this round with an independent lineage check (git history of `task-schema.ts`), not just a parent-commit worktree diff. Non-blocking.
- **Milestone evidence path split** (D4/dashboard.md line 527): `experiments/quay-perpetual-stream/milestones/M179/iterations/iteration-0.md` (legacy path) still coexists with the top-level `milestones/M179/{audits/,iterations/iteration-1.md}` (current path) — unresolved by Build iteration 1, which added its own report at the correct top-level path without moving the legacy one. Cosmetic/process, not substance.

### Round-2 overall verdict

**NO REFUTATION FOUND.** All 4 AC + 5 DoD items independently re-confirmed fresh this round against
live artifacts/diffs/test output (AC4/DoD4 carry the same non-blocking, independently-verified
pre-existing-and-orthogonal caveat as Round 1). The mechanical gate — the sole reason Round 1
returned REFUTED — now exits 0 (12/12 clauses PASS/N/A) following the Build-phase surface-tag fix
(`7bed8c2`) and this round's own Audit-phase disposition write-back to `/tmp/m179-absorb-entry.md`,
per the now-established `gap-absorb-entry-clause-disposition-sequencing` mechanism. Remaining items
(lifecycle promotion, the pre-existing unrelated test-suite failure, the legacy-path milestone
evidence split) are unresolved but were already logged as CONCERNS in `dashboard.md` by Round 1 and
are downstream-of-this-audit process items, not AC/DoD/mechanical-gate defects — `dashboard.md`'s
Round-1 REFUTED row for M179 has been updated to `verified-eliminated` with this round's resolution
evidence; the CONCERNS rows are left open as still-accurate.
