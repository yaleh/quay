// @test-group lowconc
// capability-catalog.test.mjs — gap-eighty-two-shipped-checks-and-none-says-what-it-answers.
// Tests for plugin/scripts/capability-catalog.sh — the catalog that makes every shipped
// check declare what QUESTION it makes askable (capability was never missing, visibility was).
//
// Coverage map (task ACs):
//   AC1a — the declaration is a machine-readable field in a script (capability-catalog.sh),
//          never the README; --json emits a top-level array the contract's jq pipes can read.
//   AC1b — one command lists "what you installed and what each answers"; the check count is
//          DERIVED from the filesystem glob, never a hardcoded "82"/"87".
//   AC1c — entry-point gate: a new script entering plugin/scripts WITHOUT a declared question
//          is reported unclassified and the catalog exits non-zero (negative control + restore).
//   AC2  — the three named exp5-legacy families (codex-stage1-selfcheck,
//          it0-enforcement-with-design-check, audit-independence-check) are judged ships:false
//          (do not ship with the artifact) — and quay-init actually does not lay them down.
//   AC5  — negative control: a random sample of 5 delivered checks each answers a SPECIFIC
//          question (never the generic "checks correctness" — a catalog of empties is no catalog).
//   AC6  — this file uses node:test and declares // @test-group lowconc.
//   Wiring — capability-catalog.sh is in quay-init.sh's shipped script set and lands in a real
//          `quay-init --loop` target, where it passes (self-declared, installed subset declared).
//
// Run:
//   scripts/test.sh plugin/test/capability-catalog.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const SCRIPTS_DIR = path.join(PLUGIN_DIR, "scripts");
const CATALOG = path.join(SCRIPTS_DIR, "capability-catalog.sh");
const CATALOG_EXTENSIONS = [".sh", ".ts", ".mjs"];

// The contract's exact glob, derived in the test too — never a hardcoded count.
function derivedScripts() {
  const out = new Set();
  for (const f of fs.readdirSync(SCRIPTS_DIR)) {
    if (CATALOG_EXTENSIONS.some((ext) => f.endsWith(ext))) out.add(f);
  }
  return [...out].sort();
}

function runCatalog(args = [], opts = {}) {
  return spawnSync("bash", [CATALOG, ...args], { encoding: "utf8", ...opts });
}

function catalogRows() {
  // The catalog is a pure read-only fs reader, but under the full suite a CONCURRENT test can
  // briefly create/remove a script in plugin/scripts (its own temp fixture) — the catalog would
  // then see a transient undeclared file and exit non-zero (AC1c gate). That is the reported
  // concurrency flake (isolated 8/8 green). Retry the read-only catalog a few times before
  // declaring it red — a transient file disappears; a real undeclared entry persists.
  let r;
  for (let attempt = 0; ; attempt++) {
    r = runCatalog(["--json"]);
    if (r.status === 0) break;
    if (attempt >= 2) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  assert.equal(r.status, 0, `catalog --json must exit 0:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

// mulberry32 — a tiny seeded PRNG so the AC5 "random" sample is reproducible across runs.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── AC1a/AC1b: the catalog is machine-readable and one command lists installed + answers ──
test("AC1a/AC1b — --json emits a top-level array; every row is {file, question, ships}", () => {
  const rows = catalogRows();
  assert.ok(Array.isArray(rows), "--json emits a top-level array (the contract's jq pipes expect it)");
  assert.ok(rows.length > 0, "the catalog is not empty");
  for (const row of rows) {
    assert.equal(typeof row.file, "string", "every row has a file");
    assert.ok(row.file.length > 0, "file is non-empty");
    assert.ok("question" in row, "every row has a question key (may be null for an undeclared script)");
    assert.equal(typeof row.ships, "boolean", "every row has a ships boolean");
  }
});

test("AC1b — the check count is DERIVED from the filesystem, never a hardcoded '82'/'87'", () => {
  const rows = catalogRows();
  const derived = derivedScripts();
  assert.equal(rows.length, derived.length,
    `catalog count must equal the filesystem glob (derived), got ${rows.length} vs ${derived.length}`);
  const files = rows.map((r) => r.file).sort();
  assert.deepEqual(files, derived, "the catalog's file set must be exactly the filesystem script set");
  assert.ok(rows.some((r) => r.file === "capability-catalog.sh"),
    "the catalog is self-describing — it declares its own question (else it becomes the 83rd undeclared script)");
});

// ── AC5/band: unclassified == 0 and no entry is the empty "checks correctness" ──
test("AC5/band — unclassified == 0 (every shipped check declares its question), and answers are specific", () => {
  const rows = catalogRows();
  const unclassified = rows.filter((r) => r.question === null || !String(r.question).trim());
  assert.equal(unclassified.length, 0, "band unclassified = 0 — no shipped check is undeclared");
  // AC5 negative control: a catalog where every entry says "checks correctness" is
  // indistinguishable from no catalog. Vague-answer patterns are exactly what must fail.
  const vague = /(^|\W)(checks?|validates?|verifies?)\s+(the\s+)?(correct(ness)?|validity|soundness)\b/i;
  for (const r of rows) {
    assert.ok(r.question.length >= 20,
      `question must be a specific sentence, not a label: ${r.file} → "${r.question}"`);
    assert.ok(!vague.test(r.question),
      `question must not be the empty 'checks correctness': ${r.file} → "${r.question}"`);
  }
});

// ── AC1c: entry-point gate — a field-less script entering the artifact is rejected ──
test("AC1c — a new script without a declared question is unclassified and the catalog exits non-zero (negative control + restore)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cap-cat-"));
  try {
    fs.mkdirSync(path.join(tmp, "plugin", "scripts"), { recursive: true });
    for (const f of derivedScripts()) {
      fs.copyFileSync(path.join(SCRIPTS_DIR, f), path.join(tmp, "plugin", "scripts", f));
    }
    // fail direction: a new script enters the artifact with NO declaration line.
    fs.writeFileSync(path.join(tmp, "plugin", "scripts", "ghost-check.sh"),
      "#!/usr/bin/env bash\n# a brand-new checker with no declared question\necho hi\n");
    const fail = spawnSync("bash", [path.join(tmp, "plugin", "scripts", "capability-catalog.sh"), "--json"],
      { encoding: "utf8" });
    assert.notEqual(fail.status, 0, "an undeclared script must make the catalog exit non-zero (AC1c gate)");
    const rows = JSON.parse(fail.stdout);
    const ghost = rows.find((r) => r.file === "ghost-check.sh");
    assert.ok(ghost, "the undeclared script is enumerated (the gate sees it)");
    assert.equal(ghost.question, null, "the undeclared script has question: null");
    // pass direction: once declared/removed, the catalog passes again.
    fs.rmSync(path.join(tmp, "plugin", "scripts", "ghost-check.sh"));
    const pass = spawnSync("bash", [path.join(tmp, "plugin", "scripts", "capability-catalog.sh"), "--json"],
      { encoding: "utf8" });
    assert.equal(pass.status, 0, `without the undeclared script the catalog passes again:\n${pass.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC1/AC3: delivery-form entry surface (gap-shipped-artifact-carries-86-loose-shell-scripts-as-the-delivery-form) ──
test("AC1/AC3 — --entry-surface passes at baseline: every consumer-doc-referenced .sh is a declared public entry point", () => {
  const r = runCatalog(["--entry-surface"]);
  assert.equal(r.status, 0, `entry-surface gate must pass at baseline:\n${r.stderr}\n${r.stdout}`);
  assert.match(r.stdout,
    /AC3 gate: every consumer-doc-referenced \.sh is a declared public entry point/);
  // The classification is exhaustive: shipped = public + internal (every plugin/scripts .sh is one or the other).
  const m = r.stdout.match(/delivery form \(\.sh\): (\d+) shipped \| (\d+) declared consumer-facing \| (\d+) internal/);
  assert.ok(m, "summary line reports shipped/public/internal");
  const shipped = parseInt(m[1], 10);
  const pub = parseInt(m[2], 10);
  const internal = parseInt(m[3], 10);
  assert.equal(shipped, pub + internal, "shipped = public + internal (every shipped .sh is classified)");
  assert.ok(pub >= 20, `the argued consumer-facing .sh set is declared and non-trivial (${pub})`);
});

test("AC1/AC3 — --json rows carry the surface field: .sh classified public/internal, non-.sh null", () => {
  const rows = catalogRows();
  for (const r of rows) {
    if (r.file.endsWith(".sh")) {
      assert.ok(r.surface === "public" || r.surface === "internal",
        `every shipped .sh is classified public/internal: ${r.file} → ${r.surface}`);
    } else {
      assert.equal(r.surface, null, `non-.sh surface is null (the .ts/.mjs axis is the sibling task's): ${r.file}`);
    }
  }
  const publicSh = rows.filter((r) => r.surface === "public");
  assert.ok(publicSh.length >= 20, `the argued consumer-facing .sh set is declared (${publicSh.length})`);
});

test("AC3 — negative control: an internal .sh referenced by a consumer-facing doc makes the gate exit non-zero", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cap-entry-surface-"));
  try {
    fs.mkdirSync(path.join(tmp, "plugin", "scripts"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "plugin", "loop"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "plugin", "skills", "demo"), { recursive: true });
    for (const f of derivedScripts()) {
      fs.copyFileSync(path.join(SCRIPTS_DIR, f), path.join(tmp, "plugin", "scripts", f));
    }
    // Fail direction: a consumer-facing doc references an INTERNAL script (one not in PUBLIC_ENTRYPOINTS).
    fs.writeFileSync(path.join(tmp, "plugin", "loop", "tick.md"),
      "run: bash plugin/scripts/checker-cost-lib.sh --record\n");
    const fail = spawnSync("bash", [path.join(tmp, "plugin", "scripts", "capability-catalog.sh"), "--entry-surface"],
      { encoding: "utf8" });
    assert.notEqual(fail.status, 0, "an internal .sh referenced in consumer docs must fail the AC3 gate");
    assert.match(fail.stderr, /checker-cost-lib\.sh/, "the gate names the violating internal script");
    // Pass direction: once the reference is removed, the gate passes again.
    fs.rmSync(path.join(tmp, "plugin", "loop", "tick.md"));
    const pass = spawnSync("bash", [path.join(tmp, "plugin", "scripts", "capability-catalog.sh"), "--entry-surface"],
      { encoding: "utf8" });
    assert.equal(pass.status, 0, `without the stray reference the gate passes again:\n${pass.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC1/AC3 — --entry-surface --json is machine-readable and reports ok:true at baseline", () => {
  const r = runCatalog(["--entry-surface", "--json"]);
  assert.equal(r.status, 0, `--entry-surface --json must exit 0 at baseline:\n${r.stderr}`);
  const obj = JSON.parse(r.stdout);
  assert.equal(typeof obj.sh_shipped, "number");
  assert.equal(typeof obj.public_sh, "number");
  assert.equal(typeof obj.internal_sh, "number");
  assert.ok(Array.isArray(obj.violations));
  assert.equal(obj.violations.length, 0);
  assert.equal(obj.ok, true);
  assert.equal(obj.sh_shipped, obj.public_sh + obj.internal_sh);
});

// ── AC2: the three named exp5-legacy families are judged NOT shipped ──
test("AC2 — the three named exp5-legacy families are ships:false (do not ship with the artifact)", () => {
  const rows = catalogRows();
  const byFile = new Map(rows.map((r) => [r.file, r]));
  const named = [
    "codex-stage1-selfcheck.sh",
    "it0-enforcement-with-design-check.sh",
    "it0-enforcement-with-design-check.ts",
    "audit-independence-check.sh",
    "audit-independence-check.ts",
  ];
  for (const f of named) {
    assert.ok(byFile.has(f), `exp5-legacy script is enumerated: ${f}`);
    assert.equal(byFile.get(f).ships, false, `${f} must be judged not-shipped (AC2)`);
    assert.ok(byFile.get(f).question, `${f} still declares the question it answers (it is a repo capability, just not shipped)`);
  }
});

// ── AC5: a random sample of 5 delivered checks each answers a SPECIFIC question ──
test("AC5 — a random sample of 5 delivered checks each answers a specific question", () => {
  const rows = catalogRows();
  const seeded = mulberry32(20260804); // reproducible "random"
  const sample = [...rows].sort(() => seeded() - 0.5).slice(0, 5);
  assert.equal(sample.length, 5, "exactly 5 sampled");
  const vague = /(^|\W)(checks?|validates?|verifies?)\s+(the\s+)?(correct(ness)?|validity|soundness)\b/i;
  for (const r of sample) {
    assert.ok(r.question && r.question.trim().length >= 20,
      `sampled check answers a specific question: ${r.file} → "${r.question}"`);
    assert.ok(!vague.test(r.question), `sampled check must not be the empty answer: ${r.file}`);
    assert.match(r.question, /\?/, `answers are phrased as QUESTIONS (a capability = a question made askable): ${r.file}`);
  }
});

// ── Wiring: capability-catalog.sh ships with quay-init --loop and passes in the target ──
test("Wiring — capability-catalog.sh is in quay-init.sh's shipped set and lands+passes in a real --loop target", () => {
  const initSrc = fs.readFileSync(path.join(SCRIPTS_DIR, "quay-init.sh"), "utf8");
  assert.match(initSrc, /capability-catalog\.sh/,
    "quay-init.sh must reference capability-catalog.sh in its shipped script set");

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "cap-cat-init-"));
  const wt = diskWorktreeRoot();
  try {
    const r = spawnSync("bash",
      [path.join(SCRIPTS_DIR, "quay-init.sh"), "--loop", "--root", ws, "--project", "capcat",
        "--test-command", "node --test", "--tmux-session", "capcat-0:0.0", "--worktree-root", wt],
      { encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_DIR } });
    assert.equal(r.status, 0, `quay-init --loop must exit 0:\n${r.stderr}`);
    const installed = path.join(ws, "plugin", "scripts", "capability-catalog.sh");
    assert.ok(fs.existsSync(installed), "capability-catalog.sh must be laid down by quay-init --loop");
    // The laid-down catalog must pass in the target: it declares its own question and every
    // laid-down check has a declaration (the catalog's table covers the whole plugin, so the
    // installed subset — which is ⊆ the plugin — is fully declared).
    const cat = spawnSync("bash", [installed, "--summary"], { encoding: "utf8" });
    assert.equal(cat.status, 0, `the laid-down catalog must pass in the target project:\n${cat.stderr}\n${cat.stdout}`);
    assert.match(cat.stdout, /0 unclassified/, "the laid-down catalog must report 0 unclassified");
    // AC2 consistency: the exp5-legacy families are NOT laid down (they are not in the derived
    // LOOP_SCRIPTS, matching the catalog's ships:false judgment).
    for (const f of ["codex-stage1-selfcheck.sh", "it0-enforcement-with-design-check.ts",
      "audit-independence-check.ts"]) {
      assert.ok(!fs.existsSync(path.join(ws, "plugin", "scripts", f)),
        `exp5-legacy must not ship into a target: ${f}`);
    }
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC6: this file is node:test and declares @test-group lowconc (self-evident) ──
test("AC6 — this test file is node:test with a lowconc @test-group", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /from "node:test"/, "imports node:test");
  assert.match(src, /\bimport \{[^}]*\btest\b[^}]*\}/, "imports test from node:test");
  assert.match(src, /^\/\/ @test-group lowconc/m, "declares @test-group lowconc");
});

// diskWorktreeRoot: a real (non-tmpfs) directory for quay-init's --worktree-root, which
// fails closed on tmpfs (gap-the-shipped-tick-doc-...). /var/tmp is disk-backed on Linux.
// The dirs land in a carrier array cleaned by an after() hook (the quay-init-loop pattern),
// so a thrown test never leaks a worktree root.
const _wtRoots = [];
after(() => {
  for (const d of _wtRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
function diskWorktreeRoot() {
  let dir = null;
  for (const base of ["/var/tmp", os.tmpdir()]) {
    try {
      const t = spawnSync("stat", ["-f", "-c", "%T", base], { encoding: "utf8" });
      if (t.status === 0 && t.stdout.trim() !== "tmpfs") {
        dir = fs.mkdtempSync(path.join(base, "quay-capcat-wt-"));
        break;
      }
    } catch { /* try next base */ }
  }
  if (!dir) dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-capcat-wt-"));
  _wtRoots.push(dir);
  return dir;
}
