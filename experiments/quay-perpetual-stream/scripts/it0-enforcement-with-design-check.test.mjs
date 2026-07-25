// it0-enforcement-with-design-check.test.mjs — unit tests for the enforcement-with-design gate.
//
// Uses Node.js built-in test runner (`node --test`). Each test exercises the pure exported
// functions (parseInheritedCoreClauses, parseDodCheckClauses, runChecks) with synthetic
// fixture text — no filesystem access, fully deterministic.
//
// RED cases: situations that MUST fail (ENFORCEMENT-MISSING or PARSE-ERROR → failures.length > 0)
// GREEN cases: situations that MUST pass (all clauses enforced → failures.length === 0)
//
// Run: node --test experiments/quay-perpetual-stream/scripts/it0-enforcement-with-design-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInheritedCoreClauses,
  parseDodCheckClauses,
  runChecks,
} from "./it0-enforcement-with-design-check.ts";

// ── parseInheritedCoreClauses tests ──────────────────────────────────────────────────────────────

test("parseInheritedCoreClauses: returns empty array when no DoD section present", () => {
  const text = `
## Some other section

### Clause 0 — this is NOT in a DoD section, should not be found
`;
  const clauses = parseInheritedCoreClauses(text);
  assert.deepEqual(clauses, []);
});

test("parseInheritedCoreClauses: extracts clause numbers from canonical ### Clause N headings", () => {
  const text = `
## Definition of DoD

### Clause 0 — AC + DoD present
### Clause 1 — Per-milestone acceptance audit
### Clause 2 — V_meta consolidation-lag gate

## Next section
`;
  const clauses = parseInheritedCoreClauses(text);
  assert.deepEqual(clauses, [0, 1, 2]);
});

test("parseInheritedCoreClauses: handles multi-line heading (real inherited-core.md style)", () => {
  const text = `
## Definition of DoD (M25-dod-meta-enforcer / DIR-017 Step 1, extended by M32
/ DIR-017 Step 2)

### Clause 0 — AC + DoD present
### Clause 1 — Adversarial audit

## Next top-level section
`;
  const clauses = parseInheritedCoreClauses(text);
  assert.deepEqual(clauses, [0, 1]);
});

test("parseInheritedCoreClauses: ignores '### Clause 0's sibling' headings (not a main clause)", () => {
  const text = `
## Definition of DoD

### Clause 0 — AC + DoD present
### Clause 0's sibling — something related
### Clause 1 — Adversarial audit

## Next section
`;
  const clauses = parseInheritedCoreClauses(text);
  // "Clause 0's sibling" contains a digit after "Clause " but has "'s" not a space+digit boundary
  // However our regex uses \d+ which matches "0" — let's confirm the deduplicate behavior
  // The '0' in "Clause 0's" WON'T match '### Clause N\b' because after "0" comes "'" not \b end
  // Actually \b is a word boundary: "0" then "'" — "'" is not \w so "0" is at a word boundary.
  // This means "Clause 0's" WOULD match "### Clause 0\b" (0 is followed by word boundary before ').
  // The test verifies deduplication: even if "Clause 0's sibling" is counted as Clause 0, we
  // still get [0, 1] (Set deduplicates).
  assert.ok(clauses.includes(0), "Clause 0 should be present");
  assert.ok(clauses.includes(1), "Clause 1 should be present");
  // Result is sorted and unique
  const unique = [...new Set(clauses)].sort((a, b) => a - b);
  assert.deepEqual(clauses, unique);
});

test("parseInheritedCoreClauses: returns sorted, deduplicated clause numbers", () => {
  const text = `
## Definition of DoD

### Clause 5 — No-self-exemption
### Clause 3 — Line-budget gate
### Clause 5 — Duplicate (should be deduplicated)
### Clause 0 — AC + DoD

## Footer
`;
  const clauses = parseInheritedCoreClauses(text);
  assert.deepEqual(clauses, [0, 3, 5]); // sorted, deduplicated
});

// ── parseDodCheckClauses tests ────────────────────────────────────────────────────────────────────

test("parseDodCheckClauses: extracts clause numbers from // --- Clause N: comment blocks", () => {
  const text = `
#!/usr/bin/env node
// some comment

// --- Clause 0: AC + DoD present ---
function checkClause0() {}

// --- Clause 1: Adversarial-audit gate ---
function checkClause1() {}

// --- Clause 10: Tree-hygiene gate ---
function checkClause10() {}
`;
  const enforced = parseDodCheckClauses(text);
  assert.ok(enforced.has(0), "Clause 0 should be enforced");
  assert.ok(enforced.has(1), "Clause 1 should be enforced");
  assert.ok(enforced.has(10), "Clause 10 should be enforced");
  assert.equal(enforced.size, 3);
});

test("parseDodCheckClauses: ignores prose clause mentions (not enforcement block headers)", () => {
  const text = `
// This script implements Clause 0 and references Clause 1 but doesn't use the block format
// See Clause 3 for details.
// --- Clause 7: Product-work test-floor gate ---
`;
  const enforced = parseDodCheckClauses(text);
  // Only the "// --- Clause N:" form is an enforcement block header
  assert.ok(!enforced.has(0), "prose mention of Clause 0 is not an enforcement block");
  assert.ok(!enforced.has(1), "prose mention of Clause 1 is not an enforcement block");
  assert.ok(!enforced.has(3), "prose mention of Clause 3 is not an enforcement block");
  assert.ok(enforced.has(7), "Clause 7 block header should be found");
  assert.equal(enforced.size, 1);
});

// ── runChecks integration tests ───────────────────────────────────────────────────────────────────

test("RED: runChecks FAILs when inherited-core has a Clause 10 not in dod-check", () => {
  const inheritedCore = `
## Definition of DoD

### Clause 0 — AC + DoD present
### Clause 1 — Per-milestone acceptance audit
### Clause 10 — NEW RULE: require enforcement comment in every ADR (design-only, no enforcement)

## Next section
`;
  const dodCheck = `
// --- Clause 0: AC + DoD present ---
// --- Clause 1: Adversarial-audit gate ---
// NOTE: Clause 10 is intentionally ABSENT to trigger the RED case
`;
  const { failures, passes } = runChecks(inheritedCore, dodCheck);
  assert.ok(failures.length > 0, "should have at least one failure");
  assert.ok(
    failures.some((f) => f.includes("Clause 10") && f.includes("ENFORCEMENT-MISSING")),
    `failure message should mention Clause 10 ENFORCEMENT-MISSING, got: ${failures.join("; ")}`
  );
  assert.equal(passes.length, 0, "should have no passes when violations exist");
});

test("GREEN: runChecks PASSes when all inherited-core clauses are in dod-check", () => {
  const inheritedCore = `
## Definition of DoD

### Clause 0 — AC + DoD present
### Clause 1 — Per-milestone acceptance audit
### Clause 2 — V_meta consolidation-lag gate
### Clause 3 — Line-budget gate

## Footer
`;
  const dodCheck = `
// --- Clause 0: AC + DoD present and well-formed ---
// --- Clause 1: Adversarial-audit gate ---
// --- Clause 2: V_meta consolidation-lag gate ---
// --- Clause 3: Line-budget gate ---
`;
  const { failures, passes } = runChecks(inheritedCore, dodCheck);
  assert.equal(failures.length, 0, `should have no failures, got: ${failures.join("; ")}`);
  assert.ok(passes.length > 0, "should have at least one pass message");
  assert.ok(
    passes.some((p) => p.includes("PASS")),
    `pass message should contain PASS, got: ${passes.join("; ")}`
  );
});

test("RED: runChecks FAILs when DoD section is completely missing", () => {
  const inheritedCore = `
## Some Section

No DoD heading here.

## Another Section
`;
  const dodCheck = `
// --- Clause 0: some clause ---
`;
  const { failures } = runChecks(inheritedCore, dodCheck);
  assert.ok(failures.length > 0, "should fail when no DoD section found");
  assert.ok(
    failures.some((f) => f.includes("PARSE-ERROR")),
    `failure should be a PARSE-ERROR, got: ${failures.join("; ")}`
  );
});

test("RED: runChecks FAILs for multiple missing enforcement clauses (lists all)", () => {
  const inheritedCore = `
## Definition of DoD

### Clause 0 — AC + DoD present
### Clause 5 — No-self-exemption
### Clause 10 — New rule A (no enforcement)
### Clause 11 — New rule B (no enforcement)

## Next
`;
  const dodCheck = `
// --- Clause 0: AC + DoD present ---
// --- Clause 5: No-self-exemption meta-clause ---
// Intentionally missing Clause 10 and Clause 11
`;
  const { failures } = runChecks(inheritedCore, dodCheck);
  assert.ok(failures.length === 2, `expected 2 failures (one per missing clause), got ${failures.length}: ${failures.join("; ")}`);
  assert.ok(failures.some((f) => f.includes("Clause 10")), "should report Clause 10 missing");
  assert.ok(failures.some((f) => f.includes("Clause 11")), "should report Clause 11 missing");
});

test("RED: runChecks FAILs when dod-check enforces a clause with no design doc in inherited-core (reverse direction)", () => {
  // Bidirectional check: enforcement without design documentation also violates ADR-011.
  const inheritedCore = `
## Definition of DoD

### Clause 0 — AC + DoD present

## Next
`;
  const dodCheck = `
// --- Clause 0: AC + DoD present ---
// --- Clause 1: enforcement without design — Clause 1 is not in inherited-core ---
// --- Clause 2: another undocumented enforcement ---
`;
  const { failures, passes } = runChecks(inheritedCore, dodCheck);
  assert.ok(failures.length === 2, `expected 2 failures (Clause 1 and 2 undocumented), got ${failures.length}: ${failures.join("; ")}`);
  assert.ok(failures.some((f) => f.includes("Clause 1") && f.includes("DESIGN-MISSING")), "should flag Clause 1 as DESIGN-MISSING");
  assert.ok(failures.some((f) => f.includes("Clause 2") && f.includes("DESIGN-MISSING")), "should flag Clause 2 as DESIGN-MISSING");
  assert.equal(passes.length, 0, "should have no passes when violations exist");
});

test("GREEN: runChecks PASSes when all clauses are documented in inherited-core AND enforced in dod-check (bidirectional PASS)", () => {
  // Bidirectional: every documented clause is enforced, AND every enforced clause is documented.
  const inheritedCore = `
## Definition of DoD

### Clause 0 — AC + DoD present
### Clause 1 — Per-milestone acceptance audit

## Next
`;
  const dodCheck = `
// --- Clause 0: AC + DoD present ---
// --- Clause 1: Adversarial-audit gate ---
`;
  const { failures, passes } = runChecks(inheritedCore, dodCheck);
  assert.equal(failures.length, 0, `should have no failures, got: ${failures.join("; ")}`);
  assert.ok(passes.length > 0, "should have pass message");
  assert.ok(passes.some((p) => p.includes("bidirectional")), "pass message should mention bidirectional");
});
