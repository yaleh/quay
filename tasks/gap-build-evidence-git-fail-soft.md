---
id: gap-build-evidence-git-fail-soft
title: "Fail-closed on git failure (baseCommit/changedFiles empty)"
status: todo
labels:
  - gap
  - milestone-candidate
  - human-steered
parent: gap-build-evidence-manifest-missing
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

Split from gap-build-evidence-manifest-missing (M238) — mechanism 3, **fail-closed on git failure**.
The collector's git-derived fields (`baseCommit`, `changedFiles`) come back empty when `git
merge-base` / `git diff` fail (detached HEAD, shallow clone), and the gate's changed-files drift check
is SKIPPED when these fields are empty — a fail-soft path, not fail-closed (parent Risk 1).

### Chosen mechanism

Convert the git-failure path from fail-soft to fail-closed:

1. **Collector detects git failure** — `deriveBaseCommit` / `deriveChangedFiles` (collector lines
   67-91) distinguish "legitimately empty diff" from "git command failed". On a git failure (non-zero
   exit from `git merge-base` / `git diff`, missing refs, shallow clone), the collector returns
   `{ok: false, reason: "git-failure"}` (or a distinct stable reason code) rather than emitting a
   manifest with empty `baseCommit`/`changedFiles`.
2. **Gate fail-closed** — the gate treats empty `baseCommit`/`changedFiles` that result from a git
   failure as a hard block with a stable reason code; the drift check is no longer silently skipped on
   git failure.
3. **Distinguish empty-but-valid** — a legitimate `baseCommit == candidateCommit` (no changes) still
   yields empty `changedFiles` and must NOT be blocked; only a git-command failure fails closed.
4. **Failure behavior** — manifest missing/unparseable, candidate-commit-invalid, and now
   git-failure all block before any Audit agent dispatch, with a stable reason code.

**WIRING-CLAIM (BE-GIT-FAIL-CLOSED):** a git `merge-base`/`diff` failure surfaces as a fail-closed
collector/gate result with a distinct stable reason code — the manifest is never emitted (nor the drift
check silently skipped) with empty `baseCommit`/`changedFiles` caused by a git failure. → AC3/AC6
(mechanically derived git fields, gate blocks before Audit).

## Acceptance Criteria

- [ ] The collector distinguishes a git-command failure from a legitimately empty diff and fails
  closed with a distinct stable reason code (e.g. `git-failure`) when `git merge-base`/`git diff`
  fail.
- [ ] The gate blocks a manifest whose `baseCommit`/`changedFiles` are empty due to a git failure
  (stable reason code) instead of silently skipping the changed-files drift check.
- [ ] A legitimate `baseCommit == candidateCommit` (empty `changedFiles` with a valid diff) is NOT
  blocked (no false positive).
- [ ] Both mirrors byte-identical (`diff` exit 0); tests RED/GREEN per `scripts/test.sh`; existing
  build-evidence tests stay GREEN.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] A real or production-equivalent negative control (a git-failure state, e.g. broken refs) is
  stopped by the collector/gate before any Audit agent dispatch (real dispatch evidence).
- [ ] A fresh independent audit finds no refutation.

## Touches

- `experiments/quay-perpetual-stream/scripts/build-evidence-collector.ts`
- `plugin/scripts/build-evidence-collector.ts`
- `experiments/quay-perpetual-stream/scripts/build-evidence-gate.ts`
- `plugin/scripts/build-evidence-gate.ts`
- `experiments/quay-perpetual-stream/test/*build-evidence*`
- `plugin/test/*build-evidence*`
- `docs/plans/M265-gap-build-evidence-git-fail-soft.md`
- `milestones/M265/preparation.json`
- `milestones/M265/proposal-ledger.json`
- `milestones/M265/stage-journal.jsonl`
- `milestones/M265/receipts/*.json`
- `tasks/gap-build-evidence-git-fail-soft.md`
- `.quay/config.yml`
