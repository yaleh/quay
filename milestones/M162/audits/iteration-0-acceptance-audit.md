# M162 Iteration-0 Adversarial Acceptance Audit

**Audit session id:** 28186b2d-f609-457d-8a6e-0b74f410e3be

**Task:** exp5-M-STALE-DEVIATION-CLEANUP-162
**Charter:** experiments/quay-perpetual-stream/charters/M162-stale-deviation-cleanup.md
**Date:** 2026-07-26

## Verdict: CONCERNS

The core deliverable is confirmed correct and merged to master. The mechanical gate identifies pre-write-back sequential gaps and one structural gap (clause7 test-floor WAIVER for a documentation-only task). No implementation defects.

---

## 1. Acceptance Criteria

### AC: DIR-070-C deviation row status changed from "open" to "verified-eliminated"

**CONFIRMED.** Evidence:

- Commit `0570ca0` on master (HEAD): "M162 (exp5-M-STALE-DEVIATION-CLEANUP-162): update DIR-070-C stale deviation row to verified-eliminated"
- Dashboard.md line 455 (current master): `| REFUTED | machine | M139 | DIR-070-C (M139: Gap 1 Tier B — 5 parameterized gates): AC #2 (backward compatibility) broken for ``it0-impl-row-check.sh``... **Resolved by commit 4d043d3 (2026-07-25):** restored backward-compat positional arg support in it0-impl-row-check.sh. Original finding was correct at the time of the prior audit pass. | verified-eliminated | 0 |`
- Diff confirms transition: status column changed from `open | 0 |` to `verified-eliminated | 0 |`
- Summary row (a) updated: `DIR-070-C-impl-row-backward-compat machine (now verified-eliminated)`
- Summary row (b) updated: verified-eliminated count 5/35 → 6/37, added `DIR-070-C-impl-row-backward-compat` to the verified-eliminated list
- Commit also added the fix citation: "Resolved by commit 4d043d3 (2026-07-25): restored backward-compat positional arg support in it0-impl-row-check.sh"
- Fix commit `4d043d3` independently confirmed on master: `fix: restore backward-compat positional arg support in it0-impl-row-check.sh`

AC checkbox write-back completed by this audit with evidence citation.

---

## 2. Definition of Done

### DoD: Deviation row updated

**CONFIRMED.** See AC evidence above. The row at dashboard.md line 455 is now `verified-eliminated`.

DoD checkbox write-back completed by this audit with evidence citation.

### Applicable inherited-core clauses

| Clause | Status | Evidence |
|--------|--------|----------|
| 0 (AC/DoD present) | PASS (post write-back) | AC checkbox now [x]; DoD checkbox now [x] |
| 1 (adversarial audit) | PASS | This artifact |
| 3 (line budget) | PASS | Charter ~0.2K tokens, well below 2K alarm; confirmed by it0-dod-check.sh output |
| 5 (no self-exemption) | PASS | Confirmed by it0-dod-check.sh: "no undeclared self-exemption language found" |
| 10 (tree hygiene) | PASS | Confirmed by it0-dod-check.sh: "tree-hygiene: clean" |
| 11 (worktree-branch hygiene) | PASS | Confirmed by it0-dod-check.sh: "worktree-branch-hygiene: clean" |
| 2/4/6/7/8/9/12 | N/A (per task DoD) | clause2: documentation-only, Δv=0; clause4: not design-only; clause6: not design-only; clause7: documentation-only, WAIVER added; clause8: no milestone:M label; clause9: no needs-human; clause12: this artifact |

---

## 3. Mechanical Gate

`it0-dod-check.sh` exits 1 with 5 clause violations (pre-write-back state):

| Clause | Status | Resolution |
|--------|--------|------------|
| clause0 | FAIL (pre-audit) | AC checkbox unchecked → RESOLVED by audit write-back |
| clause1 | FAIL (pre-audit) | No audit disposition in absorb entry → RESOLVED by audit write-back (disposition added to /tmp/m162-absorb-entry.md) |
| clause2 | FAIL (pre-audit) | No vmeta disposition in absorb entry → RESOLVED by audit write-back |
| clause7 | FAIL | Test-floor: no coverage disposition. **CONCERN** — documentation-only task (Δv=0, no product-touching surface, zero code changes, 1-word status edit in dashboard.md). WAIVER added to absorb entry. |
| clause12 | FAIL (pre-audit) | Audit artifact didn't exist on disk → RESOLVED (this artifact created) |

---

## 4. Deviation Row (DIR-017 Step 3 write-back)

### CONCERNS: clause7 test-floor WAIVER gap

**Caught by:** machine (adversarial audit, session 28186b2d-f609-457d-8a6e-0b74f410e3be)
**Caught at:** M162
**Description:** clause7 test-floor gate fails for M162: documentation-only task (Δv=0, line-budget ~0.2K, 1-word status change in dashboard.md from "open" to "verified-eliminated"). No product-touching surface, zero code changes, no test coverage to report. Task DoD declares clause7 N/A but absorb entry lacks a WAIVER line. WAIVER added to /tmp/m162-absorb-entry.md by this audit. Non-blocking — same pattern as M157-M161 sequential gate failures that self-resolve during audit write-back.
**Status:** open
**Age:** 0

---

## 5. Summary

All AC and DoD items confirmed satisfied by concrete evidence. The implementation (commit 0570ca0) correctly updates the deviation row from "open" to "verified-eliminated" and carries the fix commit citation (4d043d3). No code defects. The mechanical gate failure is a pre-write-back sequential dependency pattern (identical to M157-M161) plus a clause7 WAIVER gap for a documentation-only task — both addressed by this audit pass.
