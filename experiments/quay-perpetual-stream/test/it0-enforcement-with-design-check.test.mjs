// @test-group engine
// Unit tests for it0-enforcement-with-design-check.ts — the ADR-011 bidirectional invariant gate
// (every DoD clause documented in inherited-core.md must have a matching enforcement block in
// it0-dod-check.ts, and vice versa). Written to close the ADR-001 clause 2 gap: this load-bearing
// script (wrapped/registered as the `enforcement-with-design` `.quay/gates.yml` testPass gate) had
// no sibling test until now — flagged by `loadbearing-test-gate.mjs` and the real `adr-001` gate
// FAILing against this repo's own tree.
// RED-first (ADR-001 / DIR-019 discipline): the fix for any failing case belongs in the MODULE,
// never in the fixtures.
// Run:
//   node --test experiments/quay-perpetual-stream/test/it0-enforcement-with-design-check.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/it0-enforcement-with-design-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseInheritedCoreClauses,
  parseDodCheckClauses,
  runChecks,
  selftest,
} from "../scripts/it0-enforcement-with-design-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "it0-enforcement-with-design-check.ts");
const REPO_ROOT = path.resolve(__dirname, "..", "..", ".."); // experiments/quay-perpetual-stream/test → repo root

// ── parseInheritedCoreClauses ────────────────────────────────────────────────────────────────────
test("parseInheritedCoreClauses: extracts '### Clause N' headings from the DoD section", () => {
  const text = "## Definition of DoD\n\n### Clause 0 — foo\nbody\n\n### Clause 1 — bar\nbody\n\n## Next section\n### Clause 2 — outside DoD, must NOT be counted\n";
  assert.deepEqual(parseInheritedCoreClauses(text), [0, 1]);
});

test("parseInheritedCoreClauses: dedupes and sorts numerically (not lexically)", () => {
  const text = "## Definition of DoD\n### Clause 10 — x\n### Clause 2 — y\n### Clause 2 — y again\n";
  assert.deepEqual(parseInheritedCoreClauses(text), [2, 10]);
});

test("parseInheritedCoreClauses: no DoD section at all → empty array", () => {
  assert.deepEqual(parseInheritedCoreClauses("## Some other section\n### Clause 0 — not in DoD\n"), []);
});

test("parseInheritedCoreClauses: DoD section is the LAST section (no trailing ## boundary)", () => {
  const text = "## Intro\ntext\n## Definition of DoD\n### Clause 0 — foo\n### Clause 1 — bar\n";
  assert.deepEqual(parseInheritedCoreClauses(text), [0, 1]);
});

// ── parseDodCheckClauses ─────────────────────────────────────────────────────────────────────────
test("parseDodCheckClauses: extracts '// --- Clause N:' enforcement markers", () => {
  const text = "// --- Clause 0: foo ---\nfunction a(){}\n// --- Clause 3: bar ---\nfunction b(){}\n";
  assert.deepEqual([...parseDodCheckClauses(text)].sort((a, b) => a - b), [0, 3]);
});

test("parseDodCheckClauses: no markers → empty Set", () => {
  assert.equal(parseDodCheckClauses("// just a regular comment, no clause marker").size, 0);
});

test("parseDodCheckClauses: ignores prose mentions of 'Clause N' that aren't the marker format", () => {
  const text = "// This relates to Clause 5 somehow, but isn't a real marker.\n// --- Clause 1: real one ---\n";
  assert.deepEqual([...parseDodCheckClauses(text)], [1]);
});

// ── runChecks — bidirectional (design→enforcement AND enforcement→design) ──────────────────────────
test("runChecks: all clauses aligned in both directions → PASS, no failures", () => {
  const core = "## Definition of DoD\n### Clause 0 — a\n### Clause 1 — b\n";
  const dod = "// --- Clause 0: a ---\n// --- Clause 1: b ---\n";
  const r = runChecks(core, dod);
  assert.deepEqual(r.failures, []);
  assert.equal(r.passes.length, 1);
  assert.deepEqual(r.coreClauses, [0, 1]);
});

test("runChecks: clause documented but NOT enforced → ENFORCEMENT-MISSING failure", () => {
  const core = "## Definition of DoD\n### Clause 0 — a\n### Clause 1 — b\n";
  const dod = "// --- Clause 0: a ---\n";
  const r = runChecks(core, dod);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /ENFORCEMENT-MISSING/);
  assert.match(r.failures[0], /Clause 1/);
});

test("runChecks: clause enforced but NOT documented → DESIGN-MISSING failure", () => {
  const core = "## Definition of DoD\n### Clause 0 — a\n";
  const dod = "// --- Clause 0: a ---\n// --- Clause 7: undocumented ---\n";
  const r = runChecks(core, dod);
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /DESIGN-MISSING/);
  assert.match(r.failures[0], /Clause 7/);
});

test("runChecks: both directions can fail simultaneously, both reported", () => {
  const core = "## Definition of DoD\n### Clause 0 — a\n### Clause 1 — unenforced\n";
  const dod = "// --- Clause 0: a ---\n// --- Clause 9: undocumented ---\n";
  const r = runChecks(core, dod);
  assert.equal(r.failures.length, 2);
  assert.ok(r.failures.some((f) => f.startsWith("ENFORCEMENT-MISSING") && f.includes("Clause 1")));
  assert.ok(r.failures.some((f) => f.startsWith("DESIGN-MISSING") && f.includes("Clause 9")));
});

test("runChecks: no DoD clause headings found at all → PARSE-ERROR failure", () => {
  const r = runChecks("## Definition of DoD\nno clause headings here\n", "// --- Clause 0: a ---\n");
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /PARSE-ERROR/);
  assert.deepEqual(r.coreClauses, []);
});

// ── selftest() — the module's own embedded RED+GREEN fixture suite ─────────────────────────────────
test("selftest(): the module's own RED+GREEN fixture cases all behave as designed", () => {
  assert.equal(selftest(), true);
});

// ── CLI (isDirect block) — real subprocess invocation ───────────────────────────────────────────
function spawnCli(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

test("CLI: --selftest → exit 0", () => {
  assert.equal(spawnCli(["--selftest"]).status, 0);
});

test("CLI: no args → usage, exit 2", () => {
  assert.equal(spawnCli([]).status, 2);
});

test("CLI: workspace root missing inherited-core.md → exit 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enforcement-with-design-no-core-"));
  const r = spawnCli([dir]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /inherited-core\.md not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: workspace root has inherited-core.md but missing it0-dod-check.ts → exit 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enforcement-with-design-no-dodcheck-"));
  fs.mkdirSync(path.join(dir, "experiments/quay-perpetual-stream/scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "experiments/quay-perpetual-stream/inherited-core.md"),
    "## Definition of DoD\n### Clause 0 — a\n"
  );
  const r = spawnCli([dir]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /it0-dod-check\.ts not found/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: real workspace, aligned clauses → PASS, exit 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enforcement-with-design-cli-pass-"));
  fs.mkdirSync(path.join(dir, "experiments/quay-perpetual-stream/scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "experiments/quay-perpetual-stream/inherited-core.md"),
    "## Definition of DoD\n### Clause 0 — a\n"
  );
  fs.writeFileSync(
    path.join(dir, "experiments/quay-perpetual-stream/scripts/it0-dod-check.ts"),
    "// --- Clause 0: a ---\n"
  );
  const r = spawnCli([dir]);
  assert.equal(r.status, 0, `expected PASS; got stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: real workspace, unenforced clause → FAIL, exit 1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "enforcement-with-design-cli-fail-"));
  fs.mkdirSync(path.join(dir, "experiments/quay-perpetual-stream/scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "experiments/quay-perpetual-stream/inherited-core.md"),
    "## Definition of DoD\n### Clause 0 — a\n### Clause 1 — unenforced\n"
  );
  fs.writeFileSync(
    path.join(dir, "experiments/quay-perpetual-stream/scripts/it0-dod-check.ts"),
    "// --- Clause 0: a ---\n"
  );
  const r = spawnCli([dir]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ENFORCEMENT-MISSING/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: against THIS repo's own real inherited-core.md + it0-dod-check.ts (D1 real-object demonstration) → PASS, exit 0", () => {
  const r = spawnCli([REPO_ROOT]);
  assert.equal(r.status, 0, `expected PASS against the real repo; got stdout=${r.stdout} stderr=${r.stderr}`);
});
