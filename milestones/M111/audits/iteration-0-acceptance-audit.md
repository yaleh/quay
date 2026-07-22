# M111 Adversarial Audit — iteration-0-acceptance-audit

**Audit session id:** m111-audit-2026-07-22

**Milestone:** M111  
**Task:** exp5-M-TS-MIGRATION-P4  
**Auditor:** fresh-context (claude-sonnet-4-6)  
**Date:** 2026-07-22  
**Method:** REFUTE attempt — try to find a verdict change, broken invariant, or false claim for each AC

---

## AC1 — tsc --noEmit exits 0

**Claim:** All migrated method-infra scripts typecheck cleanly under `tsconfig.json`.

**Refutation attempt:**
- Ran `npx tsc --noEmit -p experiments/quay-perpetual-stream/scripts/tsconfig.json` directly. Exit 0, no output.
- Could there be false negatives (files excluded from tsconfig)? Checked tsconfig — it covers `scripts/*.ts`. All migrated scripts are `.ts` files in that directory.
- Could a script that runs via Node native type-stripping fail at runtime even though tsc passes? This is possible but AC1 is scoped to tsc — the selfcheck fixtures (AC2) cover runtime behavior.

**Verdict: NO REFUTATION FOUND.** tsc exit 0 is genuine.

---

## AC2 — dod-fixture-selfcheck.sh exits 0 (17/17 fixtures PASS)

**Claim:** The `it0-dod-check.ts` DoD meta-enforcer produces byte-identical verdicts on all 17 pinned fixtures post-migration from `.mjs`.

**Refutation attempt:**
- Ran `bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh` directly. Exit 0, all 17 fixtures PASS.
- Could the selfcheck script be testing the wrong file (old `.mjs` instead of `.ts`)? The script was updated in M110 (Batch 4) to invoke `it0-dod-check.ts`. The GATE-HASH-REF was rotated to `22c64fc...` in M110 to pin the `.ts` version — this is the definitive evidence that the rename + selfcheck update are coherent.
- Could there be a fixture that was added after the golden baseline was captured, producing false PASS? The fixture count (17) matches the expected count from the M110 selfcheck evidence.
- Is `dod-fixture-selfcheck.sh` itself still accurate? It computes exit codes against expected values — a byte-identical verdict check. The script was not modified in M111.

**Verdict: NO REFUTATION FOUND.** All 17 selfcheck fixtures PASS is genuine.

---

## AC3 — archguard consumer verification (needs-human)

**Claim:** No archguard tmux session was available; this leg correctly lands `needs-human` per the escape hatch.

**Refutation attempt:**
- Ran `tmux list-sessions 2>/dev/null | grep archguard`. Output: `NO ARCHGUARD SESSION`. This is objective.
- Could there be an archguard session under a different name? The check uses `grep archguard` — if an archguard session was named differently, it would be missed. However, the task AC's escape hatch is specifically "if no drivable session exists" — the check is for sessions containing "archguard" in their name, which is the conventional naming.
- Is `needs-human` a valid terminal disposition per the task AC? Yes: "If no drivable session exists, that leg lands `needs-human`" is explicitly written into the AC.

**Verdict: NO REFUTATION FOUND.** `needs-human` disposition is correctly applied.

---

## AC4 (charter) — All parent AC/DoD boxes ticked; status set correctly

**Claim:** Parent task status set to `needs-human`; AC1 and AC2 boxes ticked; AC3 and its DoD box annotated needs-human.

**Refutation attempt:**
- Read `tasks/exp5-M-TS-MIGRATION-P4.md` after edits. AC1 and AC2 show `[x]`; AC3 shows `[ ]` with needs-human annotation. DoD boxes: first two `[x]`, third `[ ]` with needs-human annotation. Status frontmatter: `needs-human`.
- Is `needs-human` the correct status when AC3 is unverified? Per the charter: "If AC1+AC2 pass and AC3 is `needs-human`: set status to `needs-human`." Correct.
- Does the parent task's extra.acceptance field now point to M111's charter/absorb entry? Yes — updated from M107 references to M111.

**Verdict: NO REFUTATION FOUND.** Task update is coherent and correctly reflects the milestone's dispositions.

---

## Summary

**OVERALL: NO REFUTATION FOUND**

All 4 ACs (3 from task + 1 charter closure check) withstand adversarial scrutiny. AC3's `needs-human` disposition is the designed escape hatch, not a defect. The P4 program is mechanically closed on the verifiable ACs; AC3 remains for a future human-steered window with a live archguard session.
