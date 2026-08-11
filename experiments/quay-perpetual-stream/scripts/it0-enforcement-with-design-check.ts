#!/usr/bin/env node
// it0-enforcement-with-design-check.ts — Enforcement-WITH-design invariant gate (ADR-011 / M-CRYST-INV)
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
// <!-- enforcement: scripts/it0-enforcement-with-design-check.ts -->
//   (this file IS its own enforcement pointer, self-referential but intentional — the check IS
//   the gate; adding it here satisfies ADR-011's "fixture + enforcement in same milestone" bar)
//
// Usage:
//   node it0-enforcement-with-design-check.ts <workspace-root>
//   node it0-enforcement-with-design-check.ts --selftest
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
export function parseInheritedCoreClauses(inheritedCoreText: string): number[] {
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
  const clauseNums = new Set<number>();

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
export function parseDodCheckClauses(dodCheckText: string): Set<number> {
  const enforcedNums = new Set<number>();

  // Match "// --- Clause N:" lines (the enforcement block headers in it0-dod-check.mjs).
  for (const m of dodCheckText.matchAll(/^\/\/\s*---\s*Clause\s+(\d+):/gm)) {
    enforcedNums.add(parseInt(m[1], 10));
  }

  return enforcedNums;
}

export interface ChecksResult {
  failures: string[];
  passes: string[];
  coreClauses: number[];
  enforcedClauses: Set<number>;
}

// ── runChecks — pure function: given the text of both files, returns {failures, passes} ────────────
// Bidirectional check (both halves of ADR-011):
//   1. ENFORCEMENT-MISSING: every clause in inherited-core.md must have an enforcement block in dod-check
//   2. DESIGN-MISSING: every enforcement block in dod-check must have a clause heading in inherited-core.md
// Both directions are required: enforcement-without-design violates ADR-011 just as much as
// design-without-enforcement. The check is the current-state invariant: all clauses aligned in both files.
export function runChecks(inheritedCoreText: string, dodCheckText: string): ChecksResult {
  const failures: string[] = [];
  const passes: string[] = [];

  const coreClauses = parseInheritedCoreClauses(inheritedCoreText);
  const enforcedClauses = parseDodCheckClauses(dodCheckText);

  if (coreClauses.length === 0) {
    failures.push(
      "PARSE-ERROR: no DoD clause headings found in inherited-core.md '## Definition of Done' section — section may be missing or malformed"
    );
    return { failures, passes, coreClauses: [], enforcedClauses };
  }

  // Direction 1: design → enforcement (every documented clause must be enforced)
  const unenforced = coreClauses.filter((n) => !enforcedClauses.has(n));
  for (const n of unenforced) {
    failures.push(
      `ENFORCEMENT-MISSING: Clause ${n} is declared in inherited-core.md '## Definition of Done' ` +
      `but has NO corresponding '// --- Clause ${n}:' enforcement block in it0-dod-check.mjs ` +
      `— violates ADR-011 (enforcement must land WITH design in the same milestone)`
    );
  }

  // Direction 2: enforcement → design (every enforced clause must be documented)
  const coreSet = new Set(coreClauses);
  const undocumented = [...enforcedClauses].filter((n) => !coreSet.has(n)).sort((a, b) => a - b);
  for (const n of undocumented) {
    failures.push(
      `DESIGN-MISSING: Clause ${n} has an enforcement block in it0-dod-check.mjs ` +
      `but NO corresponding '### Clause ${n}' heading in inherited-core.md '## Definition of Done' ` +
      `— enforcement without design documentation violates ADR-011`
    );
  }

  if (failures.length === 0) {
    passes.push(
      `PASS: all ${coreClauses.length} DoD clause(s) (Clauses ${coreClauses.join(", ")}) are ` +
      `documented in inherited-core.md AND have enforcement blocks in it0-dod-check.mjs (bidirectional)`
    );
  }

  return { failures, passes, coreClauses, enforcedClauses };
}

// ── selftest — RED+GREEN fixture cases using synthetic file content ────────────────────────────────
// RED fixture: inherited-core has a "Clause 10" not in it0-dod-check → FAIL
// GREEN fixture: all clauses in inherited-core are in it0-dod-check → PASS
export function selftest(): boolean {
  let allPassed = true;

  // Helper: run one fixture and report
  function runFixture(name: string, inheritedCoreText: string, dodCheckText: string, expectFail: boolean): void {
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

  // ── RED fixture (reverse direction): dod-check enforces Clause 10 not documented in inherited-core ─
  const RED_UNDOCUMENTED_ENFORCEMENT_CORE = `
## Definition of Done

### Clause 0 — AC + DoD present
### Clause 1 — Per-milestone acceptance audit

## Next section
`;
  const RED_UNDOCUMENTED_ENFORCEMENT_CHECK = `
// --- Clause 0: AC + DoD present ---
function checkClause0() {}
// --- Clause 1: Adversarial-audit gate ---
function checkClause1() {}
// --- Clause 10: New enforcement without design ---
function checkClause10() {}
`;
  runFixture("red-enforcement-without-design", RED_UNDOCUMENTED_ENFORCEMENT_CORE, RED_UNDOCUMENTED_ENFORCEMENT_CHECK, true /* expect FAIL */);

  if (allPassed) {
    console.log("SELFTEST: all fixture cases PASS.");
    return true;
  } else {
    console.error("SELFTEST: one or more fixture cases FAILED.");
    return false;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error("usage: node it0-enforcement-with-design-check.ts [--root <dir>] [--inherited-core <path>] [--dod-check <path>] <workspace-root>");
  console.error("       node it0-enforcement-with-design-check.ts --selftest");
  process.exit(2);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "it0-enforcement-with-design-check";
if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }

  // --root <dir>: workspace root for path defaults
  let resolvedRoot = "";
  // --inherited-core <path>: path to inherited-core.md
  let inheritedCoreOverride: string | undefined;
  // --dod-check <path>: path to it0-dod-check.ts
  let dodCheckOverride: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { resolvedRoot = args[++i]; continue; }
    if (args[i] === "--inherited-core") { inheritedCoreOverride = args[++i]; continue; }
    if (args[i] === "--dod-check") { dodCheckOverride = args[++i]; continue; }
    // positional wsRoot (backward compat)
    if (!args[i].startsWith("--")) {
      resolvedRoot = resolvedRoot || args[i];
    }
  }

  if (!resolvedRoot) usage();
  const resolved = path.resolve(process.cwd(), resolvedRoot);

  const inheritedCorePath = inheritedCoreOverride
    ? path.resolve(process.cwd(), inheritedCoreOverride)
    : path.join(resolved, "inherited-core.md");
  const dodCheckPath = dodCheckOverride
    ? path.resolve(process.cwd(), dodCheckOverride)
    : path.join(resolved, "scripts/it0-dod-check.ts");

  if (!fs.existsSync(inheritedCorePath)) {
    console.error(`ERROR: inherited-core.md not found: ${inheritedCorePath}`);
    process.exit(2);
  }
  if (!fs.existsSync(dodCheckPath)) {
    console.error(`ERROR: it0-dod-check.ts not found: ${dodCheckPath}`);
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
