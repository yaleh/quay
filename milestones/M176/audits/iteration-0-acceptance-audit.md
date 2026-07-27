# M176 — iteration-0 acceptance audit (gap-absorb-charter-audit-not-committed)

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Stance:** adversarial / refute-first. Fresh context — no prior exposure to this build (round 4 of
this task's own audit history; round 1's REFUTED verdict and round 2/round 3's re-audits are
preserved in full inline in `tasks/gap-absorb-charter-audit-not-committed.md`, not repeated here
except where this round's own independent re-verification bears on them).

## 0. What this round actually did

Independently re-ran, from git/live commands only (never trusting the task file's or dashboard's
self-report), every structural claim the task's AC/DoD/prior-audit-rounds make, plus the mechanical
gate and the two disposition commands (step 2a). Found one genuine, previously-uncorrected
inaccuracy in the task's own AC evidence (see §1 row 7) and corrected it in place, with full
citation, rather than silently re-confirming a stale claim.

## 1. AC satisfaction (refute-first, this round's own independent re-derivation)

| # | AC | Verdict | Evidence (this round, live-verified) |
|---|---|---|---|
| 1 | OUTER-LOOP.md charter step explicitly `git add`s the new charter file | **CONFIRMED** | Live `grep -n "git add.*charter" experiments/quay-perpetual-stream/OUTER-LOOP.md` → line 60: `⊨ commit: git add experiments/quay-perpetual-stream/charters/M<NN>-*.md as part of THIS milestone's...`. |
| 2 | `execute-milestone.js` Audit phase commits its own output, OR Land phase mechanically stages `milestones/M<NN>/audits/*` | **CONFIRMED (both)** | Live `grep` of both `.claude/workflows/execute-milestone.js` and `plugin/workflows/execute-milestone.js` shows "4a. STAGE THE AUDIT FILE" in the Audit phase, and unconditional `git add` of `$MILESTONE_ROOT/{audits,iterations}/*` in the Land-phase CAPTURE step (both serial and concurrent instances, both file mirrors). `diff .claude/workflows/execute-milestone.js plugin/workflows/execute-milestone.js` exits 0 (byte-identical). `node --check` clean on both. |
| 3 | Single authoritative path-prefix rule used by both the Audit-phase write and the dogfood-evidence-gate lookup | **CONFIRMED** | `gate_resolve_milestone_root()` present and byte-identical in `experiments/quay-perpetual-stream/scripts/gate-script-lib.sh` and `plugin/scripts/gate-script-lib.sh` (`diff` exit 0). `it0-dogfood-evidence-gate.sh` calls it directly (line 52). Live-ran `source .../gate-script-lib.sh && gate_resolve_milestone_root 176` → `milestones/M176`. `grep -rn "\-ge 130"` across scripts/workflows: the numeric boundary exists in exactly one place. |
| 4 | A fresh milestone run lands with charter AND audit-file committed by the pipeline itself, no manual sweep needed | **CONFIRMED (revised wording, round 3, re-verified this round)** | The literal "identical single commit" reading is structurally unsatisfiable by design (Audit is a separate, later pipeline phase from Build/Land) — this round independently re-verified the revised, achievable claim: re-checked every commit hash in the round-3 5-milestone evidence table (`a14f7ea`, `0b9255a`, `3f28b4e`, `b2e1e1e`, `6983aa6`, `5eed42a`, `c201b4c`, `3b90ef5`, `a8b3c0f`, `e5c19b5`) via `git log -1 --format="%ci %s" <hash>` — all real, all dated as claimed, none fabricated. Live `git status --short` on this working tree shows **zero** untracked charter/audit/iteration files anywhere (only the unrelated `experiments/quay-perpetual-stream/.halt` sentinel). |
| 5 | `tree-hygiene-check.sh` surfaces an untracked charter/audit file at Gate time as at least a WARNING | **CONFIRMED** | Live `grep -n "charters/M\|audits/\*\|WARN" tree-hygiene-check.sh` confirms the WARN block matching `charters/M[0-9]+-.*\.md` / `milestones/M[0-9]+/(audits|iterations)/.*\.md`, explicitly non-blocking (documented in the script's own comment). |
| 6 | Existing it0 selfchecks + gate hashes stay green | **PARTIALLY CONFIRMED / left unticked** (unchanged from round 1-3) | Independently reproduced: `touches-orthogonality-selfcheck.sh`, `routine-scheduler-selfcheck.sh`, `serial-fanin-absorb-selfcheck.sh`, `concurrent-batch-scheduler-selfcheck.sh` all **FAIL** on live `master`. Independently reproduced the **identical** failures in a disposable worktree pinned at the pre-M176 commit `3054ca7` — confirms these are genuinely pre-existing, not caused by this milestone. |
| 7 | No regression to the serial or concurrent execution paths | **CONCERNS — evidence corrected this round** | `node --check` clean on both workflow mirrors; mirrors byte-identical; Land-phase CAPTURE edits structurally parallel across serial/concurrent code paths — all CONFIRMED. But the previously-cited "`plugin/test/plugin-packaging.test.mjs` passes 30/30" is **false**: live run → 34 tests, 33 pass, **1 fail** ("shipped schema-check modules are byte-identical to their exp5 canonical source"). Root-caused to M178 (`3f28b4e`, 2026-07-26 17:22:53Z) editing `experiments/quay-perpetual-stream/scripts/task-schema.ts` without syncing `plugin/scripts/task-schema.ts` (last touched at `b310adb`, M136) — confirmed via `git log -1` on both file paths. This failure was **already present** at the exact commit (`6a822a6`) where the "30/30" claim was written (independently reproduced in a disposable worktree pinned at that commit — the extra 2 failures seen there are worktree/npm-install environment artifacts, not real; the `task-schema.ts` failure is not environment-dependent and is real in both environments). Unrelated to this milestone's own Touches list. Already independently noted in `dashboard.md`'s M179 CONCERNS row (line 524) as a pre-existing, unrelated drift — but never previously corrected in THIS task's own AC text. Corrected in place in `tasks/gap-absorb-charter-audit-not-committed.md` this round (AC line `[x]` → `[~]`). |

## 2. DoD satisfaction

All DoD items independently re-verified consistent with the AC findings above:
- Charter-commit DoD item: CONFIRMED (same evidence as AC1).
- Audit-phase/Land-phase DoD item: CONFIRMED per round-3's revised wording, re-verified this round
  (same evidence as AC4).
- Path-prefix single-source DoD item: CONFIRMED (same evidence as AC3).
- "All it0 selfchecks green" DoD item: PARTIALLY CONFIRMED, same 4 pre-existing failures as AC6.
- "No new backlog over next 5 milestones" DoD item: CONFIRMED per round-3, re-verified this round
  (same evidence as AC4 — full M177-M181 table, zero backlog).

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
    gap-absorb-charter-audit-not-committed \
    experiments/quay-perpetual-stream/charters/M176-gap-absorb-charter-audit-commit.md \
    /tmp/m176-absorb-entry.md
...
PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
EXIT=0
```

Re-run live by this audit AFTER its own §1 write-back edit to the task file (AC row 7 `[x]`→`[~]`)
and AFTER appending this round's own clause1/clause2 disposition lines to
`/tmp/m176-absorb-entry.md` — confirmed still exits 0 (clause0 counts 5/5 checked top-level AC
items; the corrected row remains counted as satisfied at the checklist-structure level, its
substance is downgraded and cited above, not silently hidden).

## 4. V_meta consolidation-lag (step 2a-ii)

```
$ bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 182 \
    experiments/quay-perpetual-stream/v-meta-ledger.md
V_meta consolidation-lag check — experiments/quay-perpetual-stream/v-meta-ledger.md
milestone_counter=182 K=2
  [ok] consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)
  [ok] proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson

PASS: no confirmed-unconsolidated row past K without a dated carry-forward
```

(`--counter 182` = dashboard.md's live `milestone_counter: 183` minus 1, per this audit's
instructions.)

## 5. Verdict

**CONCERNS.**

The actual gap this task was filed to close (silent, unbounded ABSORB-pipeline evidence-file
backlog — 16 charters + 19 audit files swept once by hand across M144-M166) is genuinely and
durably resolved: every structural claim about the fix itself (charter `git add` instruction,
Audit-phase mechanical staging, single-sourced `gate_resolve_milestone_root()`, tree-hygiene WARN
path, zero backlog across all 5 real subsequent milestones M177-M181, mechanical gate green)
independently re-verified true via live git/command output, not self-report, by this round.

Not a clean PASS/NO REFUTATION FOUND because this round caught a previously-uncorrected
inaccuracy: the task's own "No regression" AC line cited a "30/30" packaging-test pass that was
already false at the moment it was written (a real, currently-live, unrelated packaging drift
introduced by M178, sitting uncorrected through 3 prior audit rounds of this same task). This does
not undermine the task's core claim — this milestone's own edits introduce no regression, confirmed
independently via `node --check` and mirror-diff — but it is exactly the kind of "hard check over
prose that gets paraphrased away" (ADR-004) this repo's audit discipline exists to catch. Corrected
in place in the task file and logged as a machine-caught deviation row in `dashboard.md`'s
Homeostatic variables table. Recommend filing the `task-schema.ts` sync drift as its own separate
gap task (not scoped to re-open here — it predates and is unrelated to M176's own Touches).
