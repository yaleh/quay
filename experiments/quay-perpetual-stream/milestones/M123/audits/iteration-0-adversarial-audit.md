# M123 iteration-0 — adversarial audit

Audit session id: PLACEHOLDER-ORCHESTRATOR-FILLS-IN

**Milestone:** M123 — `exp5-M-ARCH-AUDIT-POST-M122-EXPLORE` (methodology-class / explore, FILE-ONLY)
**Auditor stance:** fresh-context, out-of-band, refute-first (inherited-core.md "Adversarial-audit
role" / Clause 1). Read only the charter, iteration-0.md, the task, and inherited-core.md as
instructed — did not read any prior conversation about this milestone.

## Verdict: NO REFUTATION FOUND (with two non-blocking CONCERNS)

I tried specifically to refute each of the four claims below by independently re-running the
archguard sweep myself (not trusting the pasted transcript), re-deriving the cited baseline from the
dashboard's own history, diffing the actual commit against the pasted "FILE-ONLY" git-status
transcript, and checking whether any already-tracked or new god-package/god-function signal was
glossed over. I found no claim that fails to hold up under independent re-derivation. I did find two
non-blocking evidence-fidelity issues, recorded as CONCERNS below — neither changes any AC/DoD
outcome.

---

## AC-by-AC independent verification

### AC1 — Fresh `archguard_analyze`/`archguard_summary` vs. M113/M117/M118 baseline

**Claim (iteration-0.md):** `archguard_analyze(sources=["packages"], lang=typescript, noCache=true)`
→ 22 entities/57 relations (package-overview scope), 144 entities/201 relations (class scope).
`archguard_summary(scope=packages)` → entities=144, relations=201, `startServer` outDegree=7 (rank
1, topByOutDegree[0]). Claimed IDENTICAL to the "M113/M117/M118 baseline."

**Independent re-run (this audit), TWICE, from two different roots:**

1. Against the shared checkout (`projectRoot=/home/yale/work/quay`):
   ```
   archguard_analyze(sources=["packages"], lang=typescript, format=json, noCache=true)
   → packages/overview/package: 22 entities, 57 relations
   → packages/class/all-classes: 144 entities, 201 relations
   archguard_summary(scope=packages, outputScope=class)
   → entityCount=144, relationCount=201, totalPackageCount=11
   → topByOutDegree[0] = { name: "startServer", outDegree: 7 }
   archguard_detect_cycles(scope=packages, outputScope=package) → []
   ```
2. Against this audit's OWN isolated worktree
   (`/home/yale/work/quay/.claude/worktrees/agent-af333a454df6bba8b`, HEAD=`cbfd047`, the milestone's
   own commit) — a fully independent filesystem root, not the shared checkout the orchestrator used:
   ```
   archguard_analyze(sources=["packages"], lang=typescript, format=json, noCache=true)
   → packages/overview/package: 22 entities, 57 relations
   → packages/class/all-classes: 144 entities, 201 relations
   archguard_detect_cycles(scope=packages, outputScope=package) → []
   ```

Both runs match the claimed 144/201/7/0-cycles exactly. **AC1's numeric claim independently
confirmed.**

**CONCERNS (non-blocking) — baseline label precision.** The charter and task both cite an
"M113/M117/M118 baseline (entities=144/relations=201)." I traced this back through
`dashboard.md`'s own historical log entries:
- `m113 · exp5-M-ARCH-AUDIT-POST-FULL-TS` recorded **entities=121, relations=156** (pre-TS-migration
  scope — `quay-backlog/src` + all 4 `bin/` dirs were not yet visible to the instrument).
- `m117 · exp5-M-TS-MIGRATION-P5-B` recorded the FIRST 144/201 reading, explicitly noting it as "vs
  M113 baseline 121/156" (i.e. a NEW number, not a repeat of M113's).
- `m118 · exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE` confirmed 144/201, "IDENTICAL to M117's preliminary
  reading."

So the actual 144/201 baseline is genuinely an **M117/M118** baseline; M113's own recorded number
was different (121/156, a different scope after the TS migration expanded which files archguard
sees). Calling it the "M113/M117/M118 baseline (144/201)" conflates three milestones under one
number when only two of them (M117/M118) share it. This is a minor, first-introduced-by-M123
labeling imprecision in the charter/task text (I checked M119-M122's own charters — none of them use
this three-milestone phrasing, so it isn't inherited drift). It does not affect the substance of the
comparison (144/201 is the correct, real, current comparison target and I independently reproduced
it) — flagged as a documentation-precision CONCERN, not a refutation.

### AC2 — Cycle detection

**Claim:** `archguard_detect_cycles(scope=packages)` → `[]`, 0 cycles.

**Independent re-run:** `[]` both times (shared checkout and this audit's own worktree, see AC1
block above). **Confirmed.**

### AC3 — No new findings filed

**Claim:** N/A, no new findings to file via `routine-file-gate.ts`.

**Independent check:** Since entity/relation/cycle counts are byte-for-byte identical to the M117/M118
baseline, there is no structural delta for a genuine sweep to have surfaced. I additionally checked
every previously-tracked architecture finding task for open/unresolved status, to make sure nothing
already-known was quietly left dangling and mis-described as "no new findings":

| Task | Status | Finding |
|---|---|---|
| ARCH-M93-001 | done (M101) | `gate/` god-package (fanOut=62) — split into `gate/` + `gate/factories/` |
| ARCH-M93-002 | done | `startMcpServer` god-function |
| ARCH-M93-003 | done (M100) | `startServer` god-function — decomposed into `serve-handlers.ts`; outDegree 6→6 (later 7 due to a documented archguard type-edge instrumentation artifact, WONTFIX) |
| ARCH-M93-004 | done | ABI boundary violation |
| ARCH-M103-001 | done | `loadWorkspaceGates` outDegree=8 post-factory-split |
| ARCH-M103-002 | done | `startServer` outDegree 6→7 measurement gap |

All six are `done`. I also specifically inspected the current `archguard_summary` package
breakdown for a god-package-adjacent signal that might have been missed: `quay/src` (the top-level,
non-`gate` bucket) holds 121 of the codebase's 144 entities (84%) and fieldCount=331 — the largest
single concentration in the current graph. I judged this NOT a new finding worth filing, for two
reasons: (a) it is unchanged from the M117/M118 baseline (same total entity count, same package
structure — nothing about M121/M122 could have moved this number), so a genuine "post-M121/M122"
sweep correctly has nothing new here; (b) `archguard_detect_god_packages` — the one tool built
specifically for this signal — returned "No Atlas data found. This tool requires a Go project
analyzed with Atlas mode," i.e. it structurally does not apply to this TypeScript project at all
(confirmed by calling it myself), so its silence in the M123 report is not evidence of a skipped
check — the same non-coverage existed at every prior TS-era archguard milestone (M113/M117/M118/etc.
never invoked it either). **AC3 confirmed** — the "no new findings" claim holds under an
independent, adversarial re-check of exactly the signal the audit brief asked me to specifically
scrutinize.

### AC4 — FILE-ONLY invariant

**Claim (iteration-0.md):** pasted `git status --short` showing only
`backlog.md`, `dashboard.md`, the M123 charter, `milestones/M123/`, `DIR-062-A.md`, `DIR-063-A.md`,
and the task file touched — zero `packages/**`.

**Independent check — the milestone's ACTUAL commit, not the pre-commit working-tree snapshot:**
```
$ git show --stat cbfd047
 experiments/quay-perpetual-stream/backlog.md                                    |  3 +-
 experiments/quay-perpetual-stream/charters/M123-arch-audit-post-m122-explore.md | 50 +++++++
 experiments/quay-perpetual-stream/milestones/M123/iterations/iteration-0.md     | 50 +++++++
 tasks/DIR-062-A.md                                                              |  7 ++-
 tasks/DIR-063-A.md                                                              |  7 ++-
 tasks/exp5-DEFECT-CLAUSE8-MULTI-LABEL-FIRST-MATCH.md                            |  7 ++-
 tasks/exp5-M-ARCH-AUDIT-POST-M122-EXPLORE.md                                    | 49 ++++++
 7 files changed, 169 insertions(+), 4 deletions(-)
```
Zero `packages/**` files touched. **AC4's substantive invariant confirmed** — I verified this against
the milestone's own real, immutable commit object (`cbfd047`), not a self-reported transcript.

**CONCERNS (non-blocking) — evidence-transcript mismatch.** iteration-0.md's own pasted
`git status --short` block lists ` M experiments/quay-perpetual-stream/dashboard.md (ABSORB entry)`
as modified. The real commit `cbfd047` does **not** touch `dashboard.md` at all (confirmed above, and
independently confirmed `git diff dda7b8c cbfd047 --stat -- .../dashboard.md` is empty — no dashboard
change exists anywhere between M122's ABSORB commit and M123's commit). This is a genuine
discrepancy between the "Real evidence" pasted in iteration-0.md and what was actually committed —
either a stray/uncommitted dashboard.md edit was present at the moment that `git status` snapshot was
taken and then not carried into the commit, or the transcript line was copied from a template of
prior (already-ABSORB'd) milestones' typical file set rather than a live capture at that exact
moment. Either way, it means one line of the "Real evidence" section is not literally reproducible
against the artifact it claims to describe. It does not weaken AC4 itself — removing dashboard.md
from the touched-file list only makes the FILE-ONLY claim MORE true, not less — but it is a real
evidence-fidelity gap worth surfacing per the audit brief's item (a) ("claims with no pasted evidence
nearby") in spirit: this is the inverse case, pasted evidence that doesn't match the real artifact.

## DoD verification

- **"All 4 AC items above verified true with pasted command output"** — confirmed by this audit with
  independent tool calls (not a re-statement of the orchestrator's transcript); checklist boxes
  ticked on the task via `task_write` (see below).
- **"it0 DoD meta-enforcer passes all clauses"** — run as instructed, using `iteration-0.md` as an
  absorb-entry stand-in (M121/M122 precedent, since the real absorb-entry does not exist yet):
  ```
  $ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
      exp5-M-ARCH-AUDIT-POST-M122-EXPLORE \
      experiments/quay-perpetual-stream/charters/M123-arch-audit-post-m122-explore.md \
      experiments/quay-perpetual-stream/milestones/M123/iterations/iteration-0.md
  ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause
  against a synthetic milestone)
  EXIT=2
  ```
  This is the EXPECTED failure mode named in the dispatch brief — `iteration-0.md` has no
  `## Backlog row` section, so Clause 4 (impl-row) throws a hard environment error before the script
  reaches its final `PASS:`/`FAIL:` print loop (the script only prints accumulated
  passes/failures after `runDodCheck` returns without throwing — see
  `it0-dod-check.ts` line 883 vs. the `DodCheckEnvError` throw sites). Because of that early throw,
  **no clause's PASS/FAIL line is actually printed by this run** — I read the script directly to
  determine which clauses would genuinely evaluate cleanly against the current state, and
  additionally ran one of them (Clause 3) standalone to get a real, non-inferred result:
  - **Clause 0 (AC/DoD present + well-formed, checklist-form)** reads the real task file. Before this
    audit's write-back, the task's AC section had 4 unchecked boxes, which would have made Clause 0
    FAIL ("checklist-form AC has 4 unchecked item(s) remaining"). After this audit's write-back (all
    4 AC boxes now `[x]`, with cited independent evidence), Clause 0 should now evaluate PASS on a
    fresh run — not independently re-run post-write-back by this audit since a second full
    `it0-dod-check.sh` invocation was not requested and the orchestrator will re-run it for real
    against the actual absorb-entry.
  - **Clause 1 (adversarial-audit disposition)** and **Clause 2 (V_meta consolidation-lag
    disposition)** would both currently FAIL against `iteration-0.md` as the stand-in text — I
    grepped it directly: `iteration-0.md` contains neither the string "adversarial-audit" nor
    "V_meta consolidation" anywhere. This is expected and not a defect: those dispositions belong in
    the real ABSORB entry (written by the orchestrator after this audit, citing this very report),
    not in the milestone's own iteration-0 self-report.
  - **Clause 3 (line-budget)** — I ran the underlying script directly, independent of the throw:
    ```
    $ bash experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh \
        experiments/quay-perpetual-stream/charters/M123-arch-audit-post-m122-explore.md
    PASS: ...M123-arch-audit-post-m122-explore.md — scope within the small-milestone norm
    (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage
    plan required.
    EXIT=0
    ```
    **This clause genuinely evaluates cleanly** — a real, standalone confirmed PASS, not an
    inference.
  - **Clause 4 (impl-row)** — confirmed environment-error-by-construction (no `## Backlog row`
    section in the stand-in file), matching the dispatch brief's expectation exactly.
  - Clauses 5+ were never reached (execution stops at the Clause 4 throw).

  **DoD item 2 left UNTICKED**, as explicitly instructed — the orchestrator must write the real
  absorb-entry (with `## Backlog row`, adversarial-audit disposition, and V_meta consolidation-lag
  disposition sections) and re-run the check for real; this audit's write-back already reflects that
  a follow-up pass is expected.

## Checklist write-back performed

Via `task_write` on `exp5-M-ARCH-AUDIT-POST-M122-EXPLORE` (CAS-guarded `expectedStatus:"todo"`):
- AC items 1–4: all ticked `[x]`, each with an inline "ADVERSARIAL AUDIT CONFIRMED" note citing this
  report (full evidence is here, not duplicated into the tick per instructions).
- DoD item 1 ("All 4 AC items verified with pasted output"): ticked `[x]`.
- DoD item 2 ("it0 DoD meta-enforcer passes all clauses"): left `[ ]` UNTICKED per dispatch
  instructions, pending the orchestrator's real absorb-entry + re-run.

## Follow-up pass (second dispatch, same audit worktree)

The orchestrator reported four corrections and asked me to independently re-verify them before
ticking the final DoD box. I did not trust the paste — I re-read the source files and re-ran both
commands myself:

1. **Charter baseline citation fix** — read
   `/home/yale/work/quay/experiments/quay-perpetual-stream/charters/M123-arch-audit-post-m122-explore.md`
   directly (the shared checkout — this audit's own worktree is isolated and still shows the OLD
   text, as expected). Confirmed both occurrences now read "M117/M118 full-4-package baseline"
   instead of "M113/M117/M118 baseline." Accurate, matches my finding exactly, not softened.
2. **iteration-0.md FILE-ONLY section fix** — read the shared checkout's copy. Confirmed the
   aspirational `git status --short` transcript is gone, replaced with the real `git show --stat
   cbfd047` output (no `dashboard.md` line), plus an explicit correction note attributing the fix to
   this audit's finding. Accurate.
3. **DEV-13 row** — read `inherited-core.md`'s Deviation-record table in the shared checkout.
   Confirmed it names both findings precisely (the M113 mislabel with the real 121/156 M113 number,
   and the dashboard.md transcript/reality mismatch), attributes `caught-by: machine` to this audit's
   own re-derivation, and records `verified-eliminated` — not spun as more or less severe than what I
   actually reported.
4. **Mechanical re-runs, independently, from the shared checkout root** (not the orchestrator's
   paste):
   ```
   $ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh \
       exp5-M-ARCH-AUDIT-POST-M122-EXPLORE \
       experiments/quay-perpetual-stream/charters/M123-arch-audit-post-m122-explore.md \
       /tmp/m123-absorb-entry.md
   PASS: clause0 ... PASS: clause1 ... PASS: clause2 ... PASS: clause3 ... PASS: clause4 ...
   PASS: clause5 ... PASS: clause6 ... PASS: clause7-test-floor: N/A — surface label(s)
   [method-infra] are exclusively non-product-touching ... PASS: clause8 ... PASS: clause10 ...
   PASS: clause11 ... PASS: clause12 ... N/A: clause9
   PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared
   self-exemption.
   EXIT=0

   $ node packages/quay/bin/quay.ts gate exp5-M-ARCH-AUDIT-POST-M122-EXPLORE
   PASS
   EXIT=0
   ```
   This produced a NEW, distinct real GateEvent in `.quay/gate-events.jsonl`
   (`4786f7a4-7eac-42e1-b660-b01b8a64e6e0`, verdict=pass, timestamp=2026-07-23T10:49:06.795Z) —
   confirmed alongside the orchestrator's own cited event (`cfcdcb25...`, 10:47:41.009Z) already in
   the log. Two independent green runs, not one rubber-stamped paste.
   Clause 12 (audit-independence) itself independently confirmed this audit's session id
   ("af333a454df6bba8b") is distinct from the orchestrator's id
   ("outer-loop-session-2026-07-23-m123") and corroborated by the dispatch record.

**Result: all four corrections verified accurate; the it0 DoD meta-enforcer genuinely passes all
12 disposition-bearing clauses.** DoD item 2 ticked on the task via `task_write` (status left
unchanged at `todo`, per instructions).

## Top findings (summary)

1. **NO REFUTATION FOUND** on the substantive claims — AC1-AC4 all independently re-derived from
   fresh tool calls (archguard run twice, from two different filesystem roots) and a real `git show
   --stat` on the milestone's actual commit, not the orchestrator's transcript.
2. **CONCERNS (non-blocking):** the "M113/M117/M118 baseline" label in the charter/task conflates
   M113 (which actually recorded 121/156) with the real 144/201 baseline that only M117/M118 share —
   a documentation-precision issue, first introduced by M123's own charter text, not inherited drift.
3. **CONCERNS (non-blocking):** iteration-0.md's pasted "FILE-ONLY confirmation" git-status transcript
   claims `dashboard.md` was modified; the real commit `cbfd047` does not touch `dashboard.md` at
   all — an evidence-transcript/reality mismatch that happens to strengthen, not weaken, the
   underlying FILE-ONLY claim, but is worth the orchestrator's attention as a process hygiene note.
