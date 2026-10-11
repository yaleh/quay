#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/it0-enforcement-with-design-check.ts
import fs from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage2) {
  process.stdout.write(usage2.endsWith("\n") ? usage2 : usage2 + "\n");
  process.exit(0);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/it0-enforcement-with-design-check.ts
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
function parseInheritedCoreClauses(inheritedCoreText) {
  const dodStart = inheritedCoreText.search(/^## Definition of DoD\b/m);
  if (dodStart < 0) return [];
  const headingLineEnd = inheritedCoreText.indexOf("\n", dodStart);
  const nextH2 = inheritedCoreText.indexOf("\n## ", headingLineEnd + 1);
  const dodSection = nextH2 < 0 ? inheritedCoreText.slice(dodStart) : inheritedCoreText.slice(dodStart, nextH2);
  const clauseNums = /* @__PURE__ */ new Set();
  for (const m of dodSection.matchAll(/^###\s+Clause\s+(\d+)\b/gm)) {
    clauseNums.add(parseInt(m[1], 10));
  }
  for (const m of dodSection.matchAll(/^clause(\d+)\s*::/gm)) {
    clauseNums.add(parseInt(m[1], 10));
  }
  return Array.from(clauseNums).sort((a, b) => a - b);
}
function parseDodCheckClauses(dodCheckText) {
  const enforcedNums = /* @__PURE__ */ new Set();
  for (const m of dodCheckText.matchAll(/^\/\/\s*---\s*Clause\s+(\d+):/gm)) {
    enforcedNums.add(parseInt(m[1], 10));
  }
  return enforcedNums;
}
function runChecks(inheritedCoreText, dodCheckText) {
  const failures = [];
  const passes = [];
  const coreClauses = parseInheritedCoreClauses(inheritedCoreText);
  const enforcedClauses = parseDodCheckClauses(dodCheckText);
  if (coreClauses.length === 0) {
    failures.push(
      "PARSE-ERROR: no DoD clause headings found in inherited-core.md '## Definition of DoD' section \u2014 section may be missing or malformed"
    );
    return { failures, passes, coreClauses: [], enforcedClauses };
  }
  const unenforced = coreClauses.filter((n) => !enforcedClauses.has(n));
  for (const n of unenforced) {
    failures.push(
      `ENFORCEMENT-MISSING: Clause ${n} is declared in inherited-core.md '## Definition of DoD' but has NO corresponding '// --- Clause ${n}:' enforcement block in it0-dod-check.mjs \u2014 violates ADR-011 (enforcement must land WITH design in the same milestone)`
    );
  }
  const coreSet = new Set(coreClauses);
  const undocumented = [...enforcedClauses].filter((n) => !coreSet.has(n)).sort((a, b) => a - b);
  for (const n of undocumented) {
    failures.push(
      `DESIGN-MISSING: Clause ${n} has an enforcement block in it0-dod-check.mjs but NO corresponding '### Clause ${n}' heading in inherited-core.md '## Definition of DoD' \u2014 enforcement without design documentation violates ADR-011`
    );
  }
  if (failures.length === 0) {
    passes.push(
      `PASS: all ${coreClauses.length} DoD clause(s) (Clauses ${coreClauses.join(", ")}) are documented in inherited-core.md AND have enforcement blocks in it0-dod-check.mjs (bidirectional)`
    );
  }
  return { failures, passes, coreClauses, enforcedClauses };
}
function selftest() {
  let allPassed = true;
  function runFixture(name, inheritedCoreText, dodCheckText, expectFail) {
    const { failures, passes } = runChecks(inheritedCoreText, dodCheckText);
    const didFail = failures.length > 0;
    if (didFail === expectFail) {
      console.log(
        `SELFTEST PASS: ${name} \u2014 ${expectFail ? `correctly detected ${failures.length} violation(s)` : "correctly found no violations"}`
      );
      if (failures.length > 0) {
        for (const f of failures) console.log(`  violation: ${f}`);
      }
    } else {
      console.error(
        `SELFTEST FAIL: ${name} \u2014 expected ${expectFail ? "FAIL" : "PASS"} but got ${didFail ? "FAIL" : "PASS"}`
      );
      if (failures.length > 0) {
        for (const f of failures) console.error(`  violation: ${f}`);
      }
      allPassed = false;
    }
  }
  const RED_INHERITED_CORE = `
## Definition of DoD

### Clause 0 \u2014 AC + DoD present
Clause 0 is enforced by it0-dod-check.mjs.

### Clause 1 \u2014 Per-milestone acceptance audit
Clause 1 is enforced.

### Clause 2 \u2014 V_meta consolidation-lag gate
Clause 2 is enforced.

### Clause 10 \u2014 NEW RULE: require enforcement comment in every ADR
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
  runFixture(
    "red-clause10-no-enforcement",
    RED_INHERITED_CORE,
    RED_DOD_CHECK,
    true
    /* expect FAIL */
  );
  const GREEN_INHERITED_CORE = `
## Definition of DoD

### Clause 0 \u2014 AC + DoD present
### Clause 1 \u2014 Per-milestone acceptance audit
### Clause 2 \u2014 V_meta consolidation-lag gate
### Clause 3 \u2014 Line-budget gate
### Clause 4 \u2014 Design-only-milestone impl-row gate

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
  runFixture(
    "green-all-clauses-enforced",
    GREEN_INHERITED_CORE,
    GREEN_DOD_CHECK,
    false
    /* expect PASS */
  );
  const RED_NO_DOD_SECTION = `
## Some other section

### Clause 0 \u2014 this is NOT in a DoD section
`;
  runFixture(
    "red-no-dod-section",
    RED_NO_DOD_SECTION,
    GREEN_DOD_CHECK,
    true
    /* expect FAIL */
  );
  const RED_UNDOCUMENTED_ENFORCEMENT_CORE = `
## Definition of DoD

### Clause 0 \u2014 AC + DoD present
### Clause 1 \u2014 Per-milestone acceptance audit

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
  runFixture(
    "red-enforcement-without-design",
    RED_UNDOCUMENTED_ENFORCEMENT_CORE,
    RED_UNDOCUMENTED_ENFORCEMENT_CHECK,
    true
    /* expect FAIL */
  );
  if (allPassed) {
    console.log("SELFTEST: all fixture cases PASS.");
    return true;
  } else {
    console.error("SELFTEST: one or more fixture cases FAILED.");
    return false;
  }
}
function findWorkspaceFile(root, filename) {
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name === filename) return path2.join(dir, entry.name);
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        queue.push(path2.join(dir, entry.name));
      }
    }
  }
  return null;
}
function usage() {
  console.error("usage: node it0-enforcement-with-design-check.ts [--root <dir>] [--inherited-core <path>] [--dod-check <path>] <workspace-root>");
  console.error("       node it0-enforcement-with-design-check.ts --selftest");
  process.exit(2);
}
var isDirect = isDirectEntry(import.meta, process.argv[1], "it0-enforcement-with-design-check");
if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node it0-enforcement-with-design-check.ts [--root <dir>] [--inherited-core <path>] [--dod-check <path>] <workspace-root>");
  if (args.includes("--selftest")) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }
  let resolvedRoot = "";
  let inheritedCoreOverride;
  let dodCheckOverride;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      resolvedRoot = args[++i];
      continue;
    }
    if (args[i] === "--inherited-core") {
      inheritedCoreOverride = args[++i];
      continue;
    }
    if (args[i] === "--dod-check") {
      dodCheckOverride = args[++i];
      continue;
    }
    if (!args[i].startsWith("--")) {
      resolvedRoot = resolvedRoot || args[i];
    }
  }
  if (!resolvedRoot) usage();
  const resolved = path2.resolve(process.cwd(), resolvedRoot);
  const inheritedCorePath = inheritedCoreOverride ? path2.resolve(process.cwd(), inheritedCoreOverride) : findWorkspaceFile(resolved, "inherited-core.md");
  const dodCheckPath = dodCheckOverride ? path2.resolve(process.cwd(), dodCheckOverride) : findWorkspaceFile(resolved, "it0-dod-check.ts");
  if (!inheritedCorePath || !fs.existsSync(inheritedCorePath)) {
    console.error(`ERROR: inherited-core.md not found: ${inheritedCorePath ?? "searched under workspace root"}`);
    process.exit(2);
  }
  if (!dodCheckPath || !fs.existsSync(dodCheckPath)) {
    console.error(`ERROR: it0-dod-check.ts not found: ${dodCheckPath ?? "searched under workspace root"}`);
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
export {
  parseDodCheckClauses,
  parseInheritedCoreClauses,
  runChecks,
  selftest
};
