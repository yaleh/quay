#!/usr/bin/env node
// it0-enforcement-with-design-check.mjs — Enforcement-WITH-design invariant gate (ADR-011 / exp5-M-CRYST-INV)
//
// Checks that every DoD clause in `inherited-core.md`'s "## Definition of Done" section has a
// matching mechanical enforcement in `scripts/it0-dod-check.mjs`. A clause present in
// inherited-core.md but NOT referenced in it0-dod-check.mjs is "design-only" — a direct violation
// of ADR-011's invariant ("a new rule/clause/method-step is NOT done without its executable
// enforcement landing in the same milestone").
//
// What "referenced" means here:
//   it0-dod-check.mjs contains a `// --- Clause N: ...` comment block for each clause it enforces.
//   The gate extracts clause numbers from BOTH files and reports any clause in inherited-core.md
//   that has no corresponding enforcement comment in it0-dod-check.mjs.
//
// Design principle (practical/honest, per the milestone task's own note):
//   Since it0-dod-check.mjs IS the standing mechanical enforcement for all DoD clauses, the check
//   cross-references the two files structurally: "is every clause the doc names also named in the
//   script?" This is runnable NOW on the real corpus, prevents FUTURE bare-clause additions (the
//   checker fails as soon as a new unenforced clause appears), and validates the existing clauses
//   are actually linked — all three properties the task's AC/DoD require.
//
// <!-- enforcement: scripts/it0-enforcement-with-design-check.mjs -->
//   (this file IS its own enforcement pointer, self-referential but intentional — the check IS
//   the gate; adding it here satisfies ADR-011's "fixture + enforcement in same milestone" bar)
//
// Usage:
//   node it0-enforcement-with-design-check.mjs <workspace-root>
//   node it0-enforcement-with-design-check.mjs --selftest
//
// Exit codes:
//   0 = PASS — all DoD clauses in inherited-core.md have a matching enforcement block in it0-dod-check.mjs
//   1 = FAIL — at least one DoD clause in inherited-core.md has no matching enforcement block
//   2 = usage/environment error (missing args, files not found)

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── parseInheritedCoreClauses — extract Clause numbers from the DoD section of inherited-core.md ──
// Scans the "## Definition of Done" section for lines matching "### Clause N" or "Clause N —"
// headings (the canonical DoD clause format in inherited-core.md).
// Returns a sorted array of unique clause numbers found (e.g. [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).
export function parseInheritedCoreClauses(inheritedCoreText) {
  // Find the DoD section: starts at "## Definition of Done" heading, ends at the next top-level
  // "## " heading (a two-character sequence after a real newline). Use a non-greedy match that
  // stops at the next \n## boundary — NOTE: do NOT use the `m` flag with a `$` alternative in the
  // lookahead, as `$` in multiline mode matches end-of-line, which prematurely stops the match at
  // the first heading line when the heading itself spans two physical lines.
  const dodStart = inheritedCoreText.search(/^## Definition of Done\b/m);
  if (dodStart < 0) return [];

  // Advance past the DoD heading to the section body.
  // Find the next \n## boundary after the heading's own first line.
  const headingLineEnd = inheritedCoreText.indexOf("\n", dodStart);
  const nextH2 = inheritedCoreText.indexOf("\n## ", headingLineEnd + 1);
  const dodSection = nextH2 < 0
    ? inheritedCoreText.slice(dodStart)
    : inheritedCoreText.slice(dodStart, nextH2);

  // Match any of these patterns (all appear in the real inherited-core.md):
  //   "### Clause 0 — ..."          (standard clause heading)
  //   "### Clause 0's sibling ..."   (sibling variant — NOT a main clause, skip)
  //   "Clause N" anywhere in text   (fallback — but filter out prose references)
  //
  // The canonical DoD clause headings use "### Clause N" where N is an integer.
  // "Clause 0's sibling" is documented as "Clause 8" separately, so we parse the
  // named clause headings and deduplicate.
  const clauseNums = new Set();

  // Primary: "### Clause N" headings — the authoritative clause declarations.
  for (const m of dodSection.matchAll(/^###\s+Clause\s+(\d+)\b/gm)) {
    clauseNums.add(parseInt(m[1], 10));
  }

  return Array.from(clauseNums).sort((a, b) => a - b);
}

// ── parseDodCheckClauses — extract Clause numbers enforced in it0-dod-check.mjs ──────────────────
// Scans for `// --- Clause N:` comment lines — the canonical "here is where Clause N is enforced"
// marker in it0-dod-check.mjs.
// Returns a Set of enforced clause numbers.
export function parseDodCheckClauses(dodCheckText) {
  const enforcedNums = new Set();

  // Match "// --- Clause N:" lines (the enforcement block headers in it0-dod-check.mjs).
  for (const m of dodCheckText.matchAll(/^\/\/\s*---\s*Clause\s+(\d+):/gm)) {
    enforcedNums.add(parseInt(m[1], 10));
  }

  return enforcedNums;
}

// ── runChecks — pure function: given the text of both files, returns {failures, passes, unenforced} ─
// This is the core gate logic, testable without touching the filesystem.
export function runChecks(inheritedCoreText, dodCheckText) {
  const failures = [];
  const passes = [];

  const coreClauses = parseInheritedCoreClauses(inheritedCoreText);
  const enforcedClauses = parseDodCheckClauses(dodCheckText);

  if (coreClauses.length === 0) {
    failures.push(
      "PARSE-ERROR: no DoD clause headings found in inherited-core.md '## Definition of Done' section — section may be missing or malformed"
    );
    return { failures, passes, coreClauses: [], enforcedClauses };
  }

  const unenforced = [];
  for (const n of coreClauses) {
    if (!enforcedClauses.has(n)) {
      unenforced.push(n);
    }
  }

  if (unenforced.length > 0) {
    for (const n of unenforced) {
      failures.push(
        `ENFORCEMENT-MISSING: Clause ${n} is declared in inherited-core.md '## Definition of Done' ` +
        `but has NO corresponding '// --- Clause ${n}:' enforcement block in it0-dod-check.mjs ` +
        `— violates ADR-011 (enforcement must land WITH design in the same milestone)`
      );
    }
  } else {
    passes.push(
      `PASS: all ${coreClauses.length} DoD clause(s) in inherited-core.md ` +
      `(Clauses ${coreClauses.join(", ")}) have a corresponding enforcement block in it0-dod-check.mjs`
    );
  }

  return { failures, passes, coreClauses, enforcedClauses };
}

// ── selftest — RED+GREEN fixture cases using synthetic file content ────────────────────────────────
// RED fixture: inherited-core has a "Clause 10" not in it0-dod-check → FAIL
// GREEN fixture: all clauses in inherited-core are in it0-dod-check → PASS
export function selftest() {
  let allPassed = true;

  // Helper: run one fixture and report
  function runFixture(name, inheritedCoreText, dodCheckText, expectFail) {
    const { failures, passes } = runChecks(inheritedCoreText, dodCheckText);
    const didFail = failures.length > 0;
    if (didFail === expectFail) {
      console.log(
        `SELFTEST PASS: ${name} — ${expectFail
          ? `correctly detected ${failures.length} violation(s)`
          : "correctly found no violations"}`
      );
      if (failures.length > 0) {
        for (const f of failures) console.log(`  violation: ${f}`);
      }
    } else {
      console.error(
        `SELFTEST FAIL: ${name} — expected ${expectFail ? "FAIL" : "PASS"} but got ${didFail ? "FAIL" : "PASS"}`
      );
      if (failures.length > 0) {
        for (const f of failures) console.error(`  violation: ${f}`);
      }
      allPassed = false;
    }
  }

  // ── RED fixture: inherited-core has Clause 0-2 + a NEW Clause 10 not in dod-check ────────────────
  const RED_INHERITED_CORE = `
## Definition of Done

### Clause 0 — AC + DoD present
Clause 0 is enforced by it0-dod-check.mjs.

### Clause 1 — Per-milestone acceptance audit
Clause 1 is enforced.

### Clause 2 — V_meta consolidation-lag gate
Clause 2 is enforced.

### Clause 10 — NEW RULE: require enforcement comment in every ADR
A newly invented rule about ADR enforcement. This one has NO enforcement yet.

## Next section
`;

  const RED_DOD_CHECK = `
#!/usr/bin/env node
// it0-dod-check.mjs stub for selftest

// --- Clause 0: AC + DoD present and well-formed in the TASK ---
function checkClause0() {}

// --- Clause 1: Adversarial-audit gate ---
function checkClause1() {}

// --- Clause 2: V_meta consolidation-lag gate ---
function checkClause2() {}
`;

  runFixture("red-clause10-no-enforcement", RED_INHERITED_CORE, RED_DOD_CHECK, true /* expect FAIL */);

  // ── GREEN fixture: all clauses in inherited-core are in dod-check ────────────────────────────────
  const GREEN_INHERITED_CORE = `
## Definition of Done

### Clause 0 — AC + DoD present
### Clause 1 — Per-milestone acceptance audit
### Clause 2 — V_meta consolidation-lag gate
### Clause 3 — Line-budget gate
### Clause 4 — Design-only-milestone impl-row gate

## Next section heading
`;

  const GREEN_DOD_CHECK = `
#!/usr/bin/env node
// it0-dod-check.mjs stub for selftest

// --- Clause 0: AC + DoD present and well-formed in the TASK ---
function checkClause0() {}

// --- Clause 1: Adversarial-audit gate ---
function checkClause1() {}

// --- Clause 2: V_meta consolidation-lag gate ---
function checkClause2() {}

// --- Clause 3: Line-budget gate ---
function checkClause3() {}

// --- Clause 4: Design-only-milestone impl-row gate ---
function checkClause4() {}
`;

  runFixture("green-all-clauses-enforced", GREEN_INHERITED_CORE, GREEN_DOD_CHECK, false /* expect PASS */);

  // ── RED fixture: missing DoD section entirely ─────────────────────────────────────────────────────
  const RED_NO_DOD_SECTION = `
## Some other section

### Clause 0 — this is NOT in a DoD section
`;

  runFixture("red-no-dod-section", RED_NO_DOD_SECTION, GREEN_DOD_CHECK, true /* expect FAIL */);

  if (allPassed) {
    console.log("SELFTEST: all fixture cases PASS.");
    return true;
  } else {
    console.error("SELFTEST: one or more fixture cases FAILED.");
    return false;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  console.error("usage: node it0-enforcement-with-design-check.mjs <workspace-root>");
  console.error("       node it0-enforcement-with-design-check.mjs --selftest");
  process.exit(2);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }
  const wsRoot = args.find((a) => !a.startsWith("--"));
  if (!wsRoot) usage();

  const resolvedRoot = path.resolve(process.cwd(), wsRoot);

  const inheritedCorePath = path.join(
    resolvedRoot,
    "experiments/quay-perpetual-stream/inherited-core.md"
  );
  const dodCheckPath = path.join(
    resolvedRoot,
    "experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs"
  );

  if (!fs.existsSync(inheritedCorePath)) {
    console.error(`ERROR: inherited-core.md not found: ${inheritedCorePath}`);
    process.exit(2);
  }
  if (!fs.existsSync(dodCheckPath)) {
    console.error(`ERROR: it0-dod-check.mjs not found: ${dodCheckPath}`);
    process.exit(2);
  }

  const inheritedCoreText = fs.readFileSync(inheritedCorePath, "utf8");
  const dodCheckText = fs.readFileSync(dodCheckPath, "utf8");

  const { failures, passes } = runChecks(inheritedCoreText, dodCheckText);

  if (failures.length > 0) {
    console.log(`FAIL: ${failures.length} enforcement-with-design violation(s) found:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  } else {
    for (const p of passes) console.log(p);
    process.exit(0);
  }
}
