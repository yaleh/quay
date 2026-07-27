# M187 iteration-0 acceptance audit — gap-halt-sentinel-path-mismatch

**Audit session id:** 13efe277-45ff-4563-bcfe-fd2c3db3e2a5

Adversarial acceptance audit, fresh context, refute-first stance. This audit did NOT read the
implementer's self-report; every finding below is backed by a command actually run against the
real repo state during this session.

## 1. AC satisfaction (refute attempts)

Task: `tasks/gap-halt-sentinel-path-mismatch.md`. Three Acceptance Criteria.

### AC1 — `restart-readiness-check.sh` checks the same repo-root path `select-preflight.ts` does

Refute attempt: read the live script on disk.

```
$ sed -n '15,19p' experiments/quay-perpetual-stream/scripts/restart-readiness-check.sh
HALT=".halt"   # repo-root-relative — matches select-preflight.ts's checkHalt() and
               # plugin/skills/loop-driver/SKILL.md's documented convention (gap-halt-sentinel-path-mismatch, M187).
```

Cross-checked against `select-preflight.ts`'s own `checkHalt()`:

```
$ sed -n '98,99p' experiments/quay-perpetual-stream/scripts/select-preflight.ts
export function checkHalt(workspaceRoot: string): { halt: boolean; reason: string } {
  const haltPath = path.join(workspaceRoot, ".halt");
```

Both resolve `.halt` relative to the repo/workspace root. `git log` confirms this fix is
landed on `master` at commit `615d4c0` (`git merge-base --is-ancestor 615d4c0 HEAD` → ancestor).
`git diff HEAD -- .../restart-readiness-check.sh` is empty (no uncommitted drift from the
committed fix). The dirty-check regex on line ~26 was also re-derived from `$HALT`
(`grep -vE "(^\?\? )?${HALT//./\\.}\$"`), closing the second hardcoded-path bug the task
description called out.

**Not refuted — CONFIRMED.**

### AC2 — `CLAUDE.md` documents the real, current code's convention

```
$ grep -n "\.halt" CLAUDE.md
57:- **`.halt` sentinel** — ... the real, mechanically-checked location is the **repo root**
  (`<repo-root>/.halt`, workspace-root-relative — matches `plugin/skills/loop-driver/SKILL.md`'s
  documented convention and `select-preflight.ts`'s actual `checkHalt()` implementation). A
  previous version of this file incorrectly documented `experiments/quay-perpetual-stream/.halt`
  ...
```

Text matches the code's actual behavior (verified directly, see AC1) and explicitly calls out the
prior wrong documentation as wrong, rather than silently rewriting history.

**Not refuted — CONFIRMED.**

### AC3 — regression-guard fixture: `.halt` at the experiments-scoped path alone → `halt: false`

```
$ grep -n "wrong-path regression guard" -A8 experiments/quay-perpetual-stream/test/select-preflight.test.mjs
65:test("checkHalt: .halt at experiments/quay-perpetual-stream/ path only → {halt: false} (wrong-path regression guard)", () => {
  ...
  fs.writeFileSync(path.join(wrongDir, ".halt"), "manual stop", "utf8");
  // No .halt at the workspace root (tmpDir) itself.
  assert.equal(r.halt, false, ...)
```

Ran the real suite (not trusted from a report):

```
$ scripts/test.sh experiments/quay-perpetual-stream/test/select-preflight.test.mjs
✔ checkHalt: .halt at experiments/quay-perpetual-stream/ path only → {halt: false} (wrong-path regression guard) (2.099934ms)
...
ℹ tests 31
ℹ pass 31
ℹ fail 0
```

31/31 pass, including this exact case. Attempted refutation by inspecting whether the test could
be vacuously true (e.g. asserting on the wrong variable, or `wrongDir` accidentally being the same
as `tmpDir`) — re-read the fixture body: `wrongDir` is
`path.join(tmpDir, "experiments", "quay-perpetual-stream")`, distinct from `tmpDir` itself, and the
assertion message embeds the real `reason` value for diagnosability. Not vacuous.

**Not refuted — CONFIRMED.**

## 1a. Checklist write-back (DIR-020)

All three AC items were already ticked `[x]` in the task file by the time this audit started.
Since DIR-020 calls for the audit's OWN evidence citation, not just trust of a pre-existing
checkmark, this audit appended per-item evidence citations (commit hash / file line / test-run
output) to `tasks/gap-halt-sentinel-path-mismatch.md`'s Acceptance Criteria and Definition of Done
sections in place, keeping each item's existing `[x]` (independently re-confirmed above and below,
not merely left as-is).

## 2. DoD satisfaction

Standard inherited-core DoD clauses, per the task's own DoD section:

- **Landed on `master`, verified via a real `select-preflight.ts` dry run, not asserted.**
  Refute attempt: run the dry run for real, against the actual on-disk `.halt` state, and check
  which path it reads.
  ```
  $ node --experimental-strip-types select-preflight.ts --json --workspace-root . --milestone-counter 0
  halt: true haltReason: .halt sentinel present (empty)
  ```
  A real, empty, repo-root `.halt` exists on disk (`ls -la .halt` → present, 0 bytes) alongside
  the known-ineffective `experiments/quay-perpetual-stream/.halt`. The dry run reports
  `halt: true` — i.e. it is genuinely reading the repo-root path, not the experiments-scoped one,
  confirming the claimed convention end-to-end, not just by source inspection.
  **CONFIRMED.**
- **`human-steered` label present** (this touches driver execution-chain files). Confirmed by
  direct read of the task frontmatter `labels:` list. **CONFIRMED.**
- Other inherited-core clauses (adversarial-audit, V_meta consolidation-lag, line-budget,
  impl-row N/A, no-self-exemption, escrow-Δv N/A, test-floor N/A, task-canonical-lifecycle-record,
  tree-hygiene, worktree-branch-hygiene, audit-independence) are covered by the mechanical gate in
  §3 below, which is the authoritative check for these (per `it0-dod-check.ts`'s own design —
  clauses 3/4/10/11/12 wrap existing scripts directly rather than being re-implemented ad hoc by
  the audit).

**DoD: satisfied**, no refutation found.

### Minor observation (not a defect, does not change verdict)

`/tmp/m187-absorb-entry.md`'s pre-existing Clause-1 text ("Neither condition applied — no
dispatched adversarial-audit subagent ran for this milestone... build-executor self-verified")
was written at/after the inner-iteration build stage, before this audit's own dispatch. Taken
literally at the moment ABSORB runs, an adversarial-audit subagent (this session) DID run for
this milestone, so that sentence is stale phrasing rather than a live-accurate claim. This audit's
own verdict line (below, appended to the same file) is the authoritative, real disposition;
`it0-dod-check.ts`'s clause1 regex is a presence check (verdict OR no-op phrase) and is satisfied
either way, so this has no mechanical or substantive effect on AC/DoD satisfaction. Flagged for
completeness only — not escalated to CONCERNS.

## 2a. Disposition append (gap-absorb-entry-clause-disposition-sequencing / M180)

Appended, BEFORE running the mechanical gate, to `/tmp/m187-absorb-entry.md`:
- `adversarial-audit disposition: NO REFUTATION FOUND` (this session's real verdict, written
  after reaching it in §1/§2 above).
- `V_meta consolidation-lag: PASS: no confirmed-unconsolidated row past K without a dated
  carry-forward` — verbatim from a real run of
  `bash experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 185
  experiments/quay-perpetual-stream/v-meta-ledger.md` (counter = dashboard.md's
  `milestone_counter: 186` minus 1 = 185). Full output:
  ```
  V_meta consolidation-lag check — .../v-meta-ledger.md
  milestone_counter=185 K=2
    [ok] consolidated | lag=- | consolidated — lag gate does not apply | domain-audit-channel≡CI-job pattern (+ per-subcommand audit exercise)
    [ok] proposed | lag=- | proposed — not past φ threshold, no lag gate | repo-root isolation-leak lesson

  PASS: no confirmed-unconsolidated row past K without a dated carry-forward
  ```

## 3. Mechanical gate

```
$ bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh gap-halt-sentinel-path-mismatch \
    experiments/quay-perpetual-stream/charters/M187-gap-halt-restart-readiness-fix.md \
    /tmp/m187-absorb-entry.md

PASS: clause0-ac-dod-present ... 3/3 checked
PASS: clause1-adversarial-audit: disposition statement present (verdict)
PASS: clause2-vmeta-lag: disposition statement present
PASS: clause3-line-budget ... PASS
PASS: clause4-impl-row ... PASS
PASS: clause5-no-self-exemption ... PASS
PASS: clause6-escrow-delta-v: N/A
PASS: clause7-test-floor: N/A — surface label(s) [method-infra]
PASS: clause8-task-canonical-lifecycle-record: N/A — legacy/unlabeled task
PASS: clause10-tree-hygiene: PASS — clean
PASS: clause11-worktree-branch-hygiene: PASS — clean
PASS: clause12-audit-independence: N/A — documented no-op
N/A: clause9-split-or-commit: N/A

PASS: DoD check passed — all clauses satisfied (12 disposition(s) confirmed), no undeclared self-exemption.
EXIT CODE: 0
```

Non-zero exit would have been REFUTED by construction; actual exit code 0.

## 4. Deviation-log write-back (DIR-017 Step 3)

No REFUTED or CONCERNS finding this pass — no new deviation row required. `dashboard.md`'s
Homeostatic variables table is left unchanged by this audit.

## Verdict

**NO REFUTATION FOUND.** All 3 Acceptance Criteria independently confirmed against real
artifacts/commands (not the implementer's self-report); Definition of Done satisfied; mechanical
gate `it0-dod-check.sh` exits 0.
