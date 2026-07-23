# M121 iteration-0 — adversarial audit

Audit session id: ab9f4fb43e348cce8

**Milestone:** M121-sea-build-crash-fix · **Task:** `exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH`
**Audited artifact:** `experiments/quay-perpetual-stream/milestones/M121/iterations/iteration-0.md`
**Auditor stance:** fresh-context, out-of-band, refute-first (inherited-core.md "Adversarial-audit
role" / Clause 1). This report tries to find fault, not re-confirm.

## Verdict

**CONCERNS** (non-blocking, but material — the milestone's own charter Done-when item 3 was NOT met
as literally written, and iteration-0's report does not flag this against the charter's own stated
numeric target). All 3 task AC items and DoD item 1 are independently confirmed true with real
evidence; DoD item 2 (it0 DoD meta-enforcer) could not be confirmed by this audit for a structural
reason explained below (not a defect finding, an ordering/tooling limitation of the substitute run).
No fabrication, no missing evidence, no arithmetic error, no independence-gate concern were found in
what WAS delivered — the finding is about the gap between what the charter's own Done-when clause 3
predicted and what iteration-0 actually delivered, honestly disclosed in iteration-0's prose but not
reconciled against the charter's literal wording.

## What I independently re-verified (real commands, this pass, fresh worktree)

All of the following were re-run by me, from a fresh worktree checkout of the M121 commits
(`3bab1a4`, `6216596` on top of `be3561a`), not copy-pasted from iteration-0's report:

1. **`packages/quay/src/gate/registry.ts` diff** — read directly; matches iteration-0's pasted diff
   verbatim (dual-mode `__dirname`/`fileURLToPath` fallback, comment does not name the task id).
2. **`grep -n REPO_ROOT packages/quay/src/gate/registry.ts`** → exactly one use site, line 75,
   `DOCUMENTS_DIR = path.join(REPO_ROOT, "docs-managed")`. A second grep across the whole
   `packages/quay/src/gate/` tree confirms no other file references `REPO_ROOT`. This independently
   substantiates AC2's structural claim — not merely re-trusting the milestone's own grep output.
3. **`bash packages/quay/scripts/build-sea.sh`** → built clean (still emits the expected esbuild
   `import.meta` warning at module-init, which is what the fix works around — build itself is not the
   bug, the fix is correct to not suppress that warning).
4. **`./dist-sea/quay --version`** → `0.3.9`, exit 0 (AC1 — no crash).
5. **`./dist-sea/quay task list --status todo`** → printed real rows, exit 0 (AC1/AC3 smoke).
6. **`./dist-sea/quay gate DIR-038`** → `FAIL — no acceptance command defined`, exit 1, no crash
   (AC1 — a gate-touching command that would previously have crashed at module-init).
7. **`./dist-sea/quay gate DIR-038 --gate doc-quay-directive-skill`** → `FAIL — no such document:
   DOC-001`, exit 1 (AC2 — graceful degrade, not a crash, confirmed independently).
8. **`bash packages/quay/test/delivery-standalone-smoke.sh`** → `0 RED`, all 5 sub-checks PASS
   including "no experiment references in delivered files" (the exact check iteration-0's report says
   its first attempt tripped — the CURRENT state is clean, confirmed).
9. **`npx tsc --noEmit -p packages/quay`** → exit 0, no output.
10. **Full non-flaky `packages/quay` test suite** (excluding `serve-github`,
    `provider-abi-conformance`, `cli-edit-parity-conformance`, the same exclusion set iteration-0
    used) → **370/370 pass, 0 fail** — matches iteration-0's claimed count exactly.
11. **`node experiments/quay-perpetual-stream/scripts/chart2-s1-distribution-reliability.ts`** →
    `S1 Distribution-reliability cov = 0.4 (2/5 artifacts pass floor-smoke)` — matches iteration-0's
    claimed value exactly.
12. **`node --test` on all three chart-2 calculators' own test files** (S1: 20/20, S2+S3 combined:
    39/39 → **59/59 total**) — matches iteration-0's "59/59 pass" claim exactly (this claim covers all
    three calculators' suites combined, not just S1's own 20 — verified this is what "59" means, not a
    mismatched number).
13. **`chart2-s1-artifacts.json`** — read directly. `sea-linux-x64` → `floorSmokePass: true` with a
    real evidence citation to run 29995456654's job URL; `sea-macos-arm64` / `sea-windows-x64` /
    `plugin-bundle` → `floorSmokePass: false`, each with an honest reason (build succeeded, runtime not
    smoked). Arithmetic check: 2 of 5 = 0.4, recomputes cleanly; `(0.4−0.2)×30 = 6.0` chart-2 points,
    recomputes cleanly. **No arithmetic error found.**
14. **`gh run view 29995456654 --repo yaleh/quay`** (real GitHub API call, not trusting the pasted
    transcript) → confirms the run is real, `v0.3.9 Release`, conclusion success, and the exact 6 jobs
    with the exact durations iteration-0 pasted (`sea-release` windows 1m21s / macos 53s / linux
    1m12s, `sea-verify-node-free` 20s, `dist-verify-node-floor` 15s, plus a `release` job iteration-0
    didn't mention but which is unrelated to the claim).
15. **`gh run view --job=89168264672 --repo yaleh/quay --log`** (the `sea-verify-node-free` job's real
    log, pulled independently) → confirms, byte for byte, a real `debian:stable-slim` container with
    explicitly no Node.js/gh installed (`Install runtime deps (libatomic1; explicitly NOT nodejs, NOT
    gh)`), `./quay --help` prints full help text, `./quay serve --port 18080 &` + `curl -sf ... ->
    http_code:200`. This is real, independently pulled evidence, not a rerun of the milestone's own
    claim.
16. **`gh run view 29981401108 --repo yaleh/quay`** (the v0.3.8 pre-fix run, independently pulled) →
    confirms `sea-verify-node-free` job **X (failed)**, and specifically failed at the **`Run quay
    --help (no Node on PATH)`** step — i.e. the exact crash this milestone claims to have fixed, on
    the exact job that is now green post-fix. This is a genuine, independently-verified before/after
    pair, not a self-report.
17. **`bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh`** → clean, exit 0.
18. **`bash experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh`** → clean,
    exit 0 (informational: this reads my own audit worktree's ambient state, not master's; the
    orchestrator should re-run this at the real ABSORB against `master`).

**Nothing in items 1–18 refutes any of AC1/AC2/AC3 or DoD item 1.** These are independently confirmed
true, not merely re-asserted from the milestone's own transcript.

## The one material finding: charter DoD item 3's quantified target was not met, and this gap is not
## reconciled in iteration-0's own framing

The **charter** (`charters/M121-sea-build-crash-fix.md`), which is Tier-A and therefore the audited
contract, states its own Done-when item 3 explicitly:

> chart-2 S1 (Distribution reliability) cov-calculator re-run shows the flip DIR-064-B's Δv
> demonstration predicted (**0.20→0.80** on the SEA rows), registering a real chart-2 Δv.

`dashboard.md`'s own "Chart-2 transition" section states the same prediction even more explicitly:
"closing exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH flips **the 3 SEA rows** in `chart2-s1-artifacts.json`,
moving S1 cov **0.20→0.80** → **+18.0** chart-2 pts." That is: flipping ALL THREE SEA rows
(`sea-linux-x64`, `sea-macos-arm64`, `sea-windows-x64`) to `floorSmokePass:true`, taking cov from
1/5=0.20 to 4/5=0.80.

**What was actually delivered:** only `sea-linux-x64` was flipped. `sea-macos-arm64` and
`sea-windows-x64` remain `floorSmokePass:false` (confirmed by me reading `chart2-s1-artifacts.json`
directly — item 13 above). Actual cov = 2/5 = **0.40**, not 0.80. Actual chart-2 Δv = **+6.0 points**,
not the predicted +18.0 — **exactly one-third of the charter's own stated target.**

This is **not** a fabrication or a hidden gap — iteration-0's own report discloses the narrower scope
honestly (explains the `sea-verify-node-free` job only exercises linux-x64, that build-succeeding is
not proof of a runtime fix on the other two platforms, and files a real follow-up defect,
`exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY`, to close the gap). The `chart2-s1-artifacts.json`
evidence file itself is scrupulously honest about which rows are/aren't flipped and why. This is
exactly the "honesty discipline" pattern the report names for itself.

**But** iteration-0's own "Real evidence (chart-2 S1 Δv...)" section's bottom line — "Δcov = +0.2 ×
weight 30 = **+6.0 chart-2 points** — a real, CI-evidenced, non-asserted chart-2 Δv (DIR-064-B's own
escrow condition: 'a REAL post-transition milestone registers a real chart-2 Δv')" — presents +6.0 as
satisfying the escrow condition without ever stating, next to that number, that the charter's own
Done-when clause 3 predicted +18.0 (0.80) and this delivers a third of that. A reader of iteration-0's
report in isolation, without cross-referencing the charter's own literal DoD wording (which the
adversarial-audit prompt specifically instructed me to do — item (d): "VT deltas that don't match the
charter's own pre-dispatch estimate without a stated reason"), would not learn that the charter's own
quantified prediction was missed by 2/3. The reason FOR the narrower scope is well-stated (platform
coverage gap in the CI job); what's missing is an explicit reconciliation against the charter's own
"0.20→0.80" language — e.g. "this milestone delivers 0.20→0.40 of the charter's predicted 0.20→0.80;
the remaining 0.40→0.80 is deferred to `exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY`."

**Why this is CONCERNS, not REFUTED:** the task's own formal `## Definition of Done` (in
`tasks/exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH.md`, the file whose checkboxes I am the sole authorized
writer of) does **not** repeat the charter's "0.20→0.80" numeric clause — it only requires "All 3 AC
items above verified true with pasted command output" and "it0 DoD meta-enforcer passes all clauses."
Both of those are satisfied by the actually-delivered 0.40 flip (the AC items are about the crash fix
itself, not the chart-2 cov number). So by the TASK's own checklist — the thing Clause 1 charges me to
tick/refute — there is no unmet box. The gap is entirely at the CHARTER level, a stronger, more
specific promise the charter made on top of the task's own DoD. Per the audit prompt's item (d), this
is exactly the class of finding to surface, and I am surfacing it as CONCERNS: the outer loop /
orchestrator should decide at ABSORB whether the charter's own Done-when-3 language should be treated
as met-in-part (with the residual explicitly carried forward, which is already effectively what
happened via the filed follow-up defect) or whether the milestone record should be corrected to state
plainly that Done-when-3 as literally written was NOT fully met.

## Deviation-log candidate (per inherited-core.md's "Deviation-record schema")

I judge the above **does** plausibly qualify as a deviation candidate under the schema's "included"
category: *"a charter/ABSORB claim that conflated or overstated a gate's applicability, caught and
corrected before or at ABSORB (M11 below)"* is the closest precedent (DEV-01's own class). Concretely:
the charter's own Done-when item 3 states a specific numeric outcome (0.20→0.80) as what would be
verified; the actually-verified outcome is 0.20→0.40; iteration-0's own summary framing does not
flag the shortfall against the charter's literal number, though the underlying facts are disclosed
elsewhere in the same report. I am **not** the writer of `dashboard.md`'s deviation table (per this
audit's own scope note, item 5) — flagging this for the orchestrator to fold in as a new `DEV-NN` row
if it agrees this crosses the schema's bar, `caught-by: machine` (this Clause-1 audit dispatch).

## it0-dod-check.sh runs (both, as instructed)

**Run 1 — against the not-yet-written real absorb-entry** (`/tmp/m121-absorb-entry.md`, expected
missing per the standing ordering convention):
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH \
    experiments/quay-perpetual-stream/charters/M121-sea-build-crash-fix.md /tmp/m121-absorb-entry.md
ERROR: absorb-entry-file not found: /tmp/m121-absorb-entry.md
```
Exit 2. Expected/uninformative — no absorb-entry exists yet, exactly as the audit brief predicted.

**Run 2 — substitute run using `iteration-0.md` as a stand-in absorb-entry:**
```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH \
    experiments/quay-perpetual-stream/charters/M121-sea-build-crash-fix.md \
    <path-to-iteration-0.md>
ERROR: absorb-entry-file has no "## Backlog row" section (required to run the impl-row clause against a synthetic milestone)
```
Exit 2. **This did NOT exit 0.** Per the audit brief, I'm treating this as strong-but-not-fatal input:
reading the script (`it0-dod-check.ts`), this is an **environment/usage precondition failure at
Clause 4 (impl-row)**, thrown BEFORE any clause 0-12 verdict is computed — it fires because
`iteration-0.md` is a milestone report, not a real ABSORB entry, and lacks the `## Backlog row`
section a real `dashboard.md` ABSORB entry would carry. This is a **structural mismatch of the
substitute input**, not evidence of a defect in the milestone's own delivered work — none of the
18 independent re-verifications above were blocked by it. **I could not get a clause-by-clause PASS
reading this pass** for DoD item 2 ("it0 DoD meta-enforcer passes all clauses") — that box is left
unticked on the task, and the real verdict must come from running `it0-dod-check.sh` against the
actual `dashboard.md` ABSORB entry once the orchestrator writes it, which is expected to have a
proper `## Backlog row` section and should be re-audited (or at minimum independently spot-checked)
at that time.

## Task-file checklist write-back performed

Per Clause 1's write-back duty, I ticked on `tasks/exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH.md`
(via `task_write`, citing my own supporting evidence in THIS report, not in the tick):
- [x] AC1 (`--version` / gate-touching commands run without crashing)
- [x] AC2 (REPO_ROOT-relative gate-path question explicitly resolved, graceful degrade documented)
- [x] AC3 (build-sea.sh + `--version` + smoke commands pasted as real evidence)
- [x] DoD item 1 (all 3 AC items verified true with pasted output)
- [ ] DoD item 2 (it0 DoD meta-enforcer passes all clauses) — LEFT UNTICKED, see the it0-dod-check
  section above; not independently confirmable this pass for a structural (not substantive) reason.

Status left at `todo` — I did not change the task's status field; lifecycle transition is the
orchestrator's ABSORB-time job, not this audit's.

## Other things I specifically tried to break, and could not

- **Tried to find narrative-only claims with no pasted evidence**: none found — every AC/DoD-relevant
  claim in iteration-0.md has adjacent real command output, and I was able to independently reproduce
  every one of them from a fresh checkout (see items 1–16 above).
- **Tried to find evidence that doesn't support the specific claim made**: none found for AC1-3. The
  one place evidence and claim diverge is the chart-2 Δv framing discussed above (a real but partial
  match, not a mismatch of evidence-to-claim).
- **Tried to recompute all arithmetic**: cov 1/5→2/5, Δcov×30=6.0, chart2-s1 test counts (20+21+18=59)
  all recompute cleanly. No slip found.
- **Tried to verify the GitHub Actions run independently rather than trust the pasted transcript**:
  done via `gh run view`/`gh run view --log` against the real API, both for the v0.3.9 run cited and
  the v0.3.8 pre-fix run for comparison — both corroborate the milestone's claims.
- **Tried to find scope creep / self-granted exemption**: the "Not in scope / deferred" section is
  consistent with the charter's own "Not in scope" section (macos/windows SEA runtime-smoke,
  docs-managed embedding, quay-native's own SEA binary) — no undisclosed scope expansion found. The
  one scope-adjacent issue found is the chart-2 numeric shortfall discussed above, which is a
  narrower-than-promised DELIVERY, not an expanded one, and is disclosed (just not reconciled against
  the charter's literal number).
- **Tried to find a self-ticked checkbox (SELECT should never tick)**: confirmed via `task_get` before
  my write-back — all AC/DoD boxes were `- [ ]` prior to this audit, consistent with the standing
  discipline.

## Summary for the orchestrator

**Verdict: CONCERNS.** AC1/AC2/AC3 and DoD-1 are real, independently re-verified, hard-evidenced, not
overclaimed. DoD-2 (it0-dod-check all clauses) is not yet confirmable pending the real ABSORB entry —
left unticked, not a refutation of the milestone's work itself. The one substantive finding is that
the charter's own Done-when clause 3 quantified target (S1 cov 0.20→0.80, +18.0 chart-2 pts) was met
only at the 0.20→0.40 / +6.0 level — honestly disclosed in the supporting evidence file but not
reconciled against the charter's literal wording in iteration-0's own top-line framing. Recommend the
orchestrator either (a) explicitly note at ABSORB that Done-when-3 is PARTIALLY met with the residual
tracked by `exp5-DEFECT-SEA-VERIFY-SINGLE-PLATFORM-ONLY`, or (b) treat this as a `DEV-NN` deviation row
per the schema discussion above.

## Follow-up pass (same audit session, after the orchestrator's corrections)

The orchestrator subsequently: (1) amended the charter's Done-when-3 with a "Reconciliation" paragraph
stating the actual 0.20→0.40/+6.0 outcome against the original 0.20→0.80/+18.0 prediction; (2) logged
this finding as `DEV-12` in `inherited-core.md`'s Deviation-record schema table (`caught-by: machine`,
`status: verified-eliminated`); (3) fixed the task's `## Plan` section to the required `N/A — <reason>`
form (Clause 8); (4) wrote the real ABSORB-entry to `/tmp/m121-absorb-entry.md`; (5) set
`extra.acceptance` and ran `quay gate` for real (PASS, real GateEvent recorded).

**I independently re-verified all of this myself, not by trusting the paste:**
- Read `experiments/quay-perpetual-stream/charters/M121-sea-build-crash-fix.md`'s new Reconciliation
  paragraph and `inherited-core.md`'s new `DEV-12` row directly (both live only in the shared checkout,
  not in this isolated audit worktree — a repeat of the same iteration-0.md/audits-dir split noted
  above). **Both accurately and non-spun represent my original finding**: the DEV-12 row states the
  0.20→0.80-predicted vs 0.20→0.40-delivered gap plainly, attributes discovery correctly to this
  Clause-1 audit dispatch (`caught-by: machine`), and does not minimize or reframe it as anything other
  than a real, if non-blocking, miss against the charter's own stated target. The charter's
  Reconciliation paragraph likewise states the actual delivered number plainly next to the original
  prediction, names the residual's tracking task, and does not delete or soften the original "one-third
  of the prediction" framing.
- **Synced these orchestrator-side edits** (task file, charter, and this audit report's own session-id
  line) into my own isolated worktree (`Read` from the shared-checkout paths + `Edit` locally — no git
  operation against the shared checkout), then, from inside my own worktree, genuinely re-ran:
  ```
  $ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH \
      experiments/quay-perpetual-stream/charters/M121-sea-build-crash-fix.md /tmp/m121-absorb-entry.md
  PASS: clause0-ac-dod-present ... PASS: clause1-adversarial-audit ... PASS: clause2-vmeta-lag ...
  PASS: clause3-line-budget ... PASS: clause4-impl-row ... PASS: clause5-no-self-exemption ...
  PASS: clause6-escrow-delta-v ... PASS: clause7-test-floor ... PASS: clause8-task-canonical-lifecycle-record ...
  PASS: clause10-tree-hygiene ... PASS: clause11-worktree-branch-hygiene ... PASS: clause12-audit-independence ...
  N/A: clause9-split-or-commit
  PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
  ```
  Exit 0 — genuine, reproduced myself, matches the orchestrator's own paste. **Notably**, before I
  synced the edits, running the identical command against my worktree's STALE (pre-correction) copies
  of the task/charter/audit-report failed at clauses 0 (unchecked AC boxes — my earlier `task_write`
  had only reached the shared checkout, not my own worktree's git tree), 8 (Plan section not yet in
  `N/A —` form), and 12 (audit artifact still carrying the `PLACEHOLDER-ORCHESTRATOR-FILLS-IN` string,
  correctly fail-closed per DIR-034 anti-forgery). This confirms the check is a genuine, non-trivial
  gate — it does not pass by construction, and it correctly failed against unsynced state before it
  passed against synced state.
- Independently ran, myself: `node packages/quay/bin/quay.ts gate exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH`
  → `PASS`, exit 0. `node packages/quay/bin/quay.ts gate-log exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH --json`
  → a real GateEvent, `"verdict": "pass"`, `"timestamp": "2026-07-23T09:57:21.644Z"` (my own run,
  distinct from and in addition to the orchestrator's own 09:54:31.391Z event — two independent real
  passes, not one self-report).

**Conclusion of follow-up pass:** DoD item 2 ("it0 DoD meta-enforcer passes all clauses") is now
genuinely confirmed. I ticked it on the task via `task_write`, citing this follow-up evidence in the
tick itself (task's own status field left untouched, per instruction). **Verdict stands at CONCERNS**
(not upgraded to NO REFUTATION FOUND) — per my own judgment as auditor, CONCERNS remains the accurate
historical record of what was actually found in iteration-0's original delivery (the charter's
own quantified target unmet, undisclosed-in-the-top-line-framing at the time of the original audit),
even though it has since been correctly reconciled and logged. The finding was real; CONCERNS records
that a real (non-blocking) issue existed and was fixed, which is a different, more informative claim
than "nothing was ever wrong."
