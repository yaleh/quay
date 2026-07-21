# M67 Acceptance Audit — exp5-M-CRYST-INV

**Auditor:** outer-loop adversarial audit (Explore-type, read-only, REFUTE-FIRST)
**Build commits:** 7c9f9ed (BUILD), 0af390f (fix)
**Verdict:** NO REFUTATION FOUND

## Initial audit finding (blocking)

The gate implementation was one-directional: checked design→enforcement (every clause in
inherited-core.md must have enforcement in it0-dod-check.mjs) but NOT enforcement→design
(every enforcement in it0-dod-check.mjs must be documented in inherited-core.md).

Clauses 10 (tree-hygiene), 11 (worktree-branch-hygiene), 12 (audit-independence) had
enforcement blocks in it0-dod-check.mjs but NO `### Clause N` headings in inherited-core.md's
`## Definition of Done` section — a pre-existing design drift and exactly the violation ADR-011
was written to prevent.

## Fix applied (outer loop)

1. `it0-enforcement-with-design-check.mjs`: `runChecks()` made bidirectional — Direction 2
   checks that every enforcement block in it0-dod-check.mjs has a design heading in inherited-core.md;
   DESIGN-MISSING failures reported for undocumented enforcement clauses.
2. `inherited-core.md`: Added `### Clause 10`, `### Clause 11`, `### Clause 12` entries to
   the `## Definition of Done` section with proper design documentation referencing their
   enforcement scripts.
3. Test suite updated: reverse-direction RED fixture added (DESIGN-MISSING); 13/13 tests pass.
4. Selftest: added reverse-direction fixture case; 4/4 selftest cases pass.

## Post-fix verification

**AC1 — Gate RED/GREEN cases:** CONFIRMED (bidirectional)
- RED: `### Clause 10` in inherited-core, no enforcement block in dod-check → FAIL (ENFORCEMENT-MISSING)
- RED: enforcement block `// --- Clause 10:` in dod-check, no `### Clause 10` in inherited-core → FAIL (DESIGN-MISSING)
- GREEN: all clauses aligned in both directions → PASS
- 13 tests, 13 pass

**AC2 (pre-done) — ADR-011 + governing invariant:** CONFIRMED (pre-existing, not revalidated)

**DoD1 — Gate on real corpus:** CONFIRMED
- `quay gate exp5-M-CRYST-INV --gate enforcement-with-design` → PASS
- All 13 clauses (0-12) bidirectionally aligned; inherited-core.md now documents all three
  previously undocumented clauses

**DoD2 (pre-done) — Governance established:** CONFIRMED (pre-existing)

**Task checkboxes:** CONFIRMED — both previously-unchecked boxes ticked [x], status=done

## Final verdict

NO REFUTATION FOUND — bidirectional gate passes on 13-clause real corpus. Audit finding fixed
before ABSORB (pre-existing design drift in Clauses 10-12 also resolved as side effect).
