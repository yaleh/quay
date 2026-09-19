// @test-group engine
// capability-catalog.test.mjs — gap-eighty-two-shipped-checks-and-none-says-what-it-answers.
// Tests for plugin/scripts/capability-catalog.sh — the catalog that makes every shipped
// check declare what QUESTION it makes askable (capability was never missing, visibility was).
//
// Coverage map (task ACs):
//   AC1a — the declaration is a machine-readable field in the shipped artifact
//          (capability-catalog-declarations.json, read by capability-catalog.ts),
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
//   AC6  — this file uses node:test and declares // @test-group engine.
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
// The renderer is IMPORTABLE (it guards its own direct invocation), so the archive/** exclusion can
// be unit-tested against a temp fixture tree instead of by dropping a probe into the live
// plugin/scripts. See the archive/** test below.
import { deriveScripts, isExcludedDirRelPath } from "../scripts/capability-catalog.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const SCRIPTS_DIR = path.join(PLUGIN_DIR, "scripts");
const CATALOG = path.join(SCRIPTS_DIR, "capability-catalog.sh");
// The catalog's declaration tables are DATA in this file (gap-arch-catalog-declarations-leave-bash):
// the .sh is a thin exec wrapper around plugin/scripts/capability-catalog.ts, which reads
// capability-catalog-declarations.json. A fixture that carries the entry but not its data exits 3
// (CAUSE=declarations-missing), which would read as "the catalog is always red" and make every
// negative control below vacuous. So the fixture builders carry the data file too, and the
// injections that used to patch the .sh source patch the data instead.
const CATALOG_DATA_NAME = "capability-catalog-declarations.json";
const CATALOG_DATA = path.join(SCRIPTS_DIR, CATALOG_DATA_NAME);
const CATALOG_EXTENSIONS = [".sh", ".ts", ".mjs"];

// The contract's exact glob, derived in the test too — never a hardcoded count.
function derivedScripts() {
  const out = new Set();
  for (const f of fs.readdirSync(SCRIPTS_DIR)) {
    if (CATALOG_EXTENSIONS.some((ext) => f.endsWith(ext))) out.add(f);
  }
  return [...out].sort();
}

// ── Amortized shared read-only baseline (gap-npm-file-copy-amortize AC2) ─────────────────────────
// 5 tests each historically copied ALL plugin/scripts (261 files) into a fresh tmp — 5×261 data
// copies (~1300+) of the same read-only content. Instead: ONE shared read-only baseline (real
// copies, built lazily ONCE) + each test materializes a WRITABLE hard-link farm from it (zero data
// copy) and patches ONLY the file(s) it needs. capability-catalog.sh is the ONE existing script a
// test writes to, so materializeScripts breaks its hard link with a real copy — a writeFileSync
// through a hard link would corrupt the shared baseline for every other test (same inode). The
// baseline is disposable (removed by after()); the real plugin/scripts is never the write source,
// so a test bug can never corrupt the repo.
const _baseline = { dir: null, files: null };
const _baselineDirs = [];
function sharedBaseline() {
  if (_baseline.dir) return _baseline;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-cat-base-"));
  _baselineDirs.push(dir);
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  const files = derivedScripts();
  for (const f of files) {
    fs.copyFileSync(path.join(SCRIPTS_DIR, f), path.join(dir, "plugin", "scripts", f));
  }
  fs.copyFileSync(CATALOG_DATA, path.join(dir, "plugin", "scripts", CATALOG_DATA_NAME));
  _baseline.dir = dir;
  _baseline.files = files;
  return _baseline;
}

// materializeScripts(tag): a fresh WRITABLE plugin/scripts tree for one test. Every script is a
// hard link to the shared baseline (no data copy), except capability-catalog.sh AND the declaration
// data file, which are real copies so a test's writeFileSync patches only its own copy. Returns the
// tmp root (plugin/ lives under it); the caller creates any non-scripts sibling dirs it needs.
function materializeScripts(tag) {
  const base = sharedBaseline();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cap-cat-${tag}-`));
  fs.mkdirSync(path.join(tmp, "plugin", "scripts"), { recursive: true });
  for (const f of [...base.files, CATALOG_DATA_NAME]) {
    const src = path.join(base.dir, "plugin", "scripts", f);
    const dst = path.join(tmp, "plugin", "scripts", f);
    if (f === "capability-catalog.sh" || f === CATALOG_DATA_NAME) fs.copyFileSync(src, dst);
    else fs.linkSync(src, dst);
  }
  return tmp;
}

/** The injection seam for the catalog's data-level negative controls: read a fixture's declaration
 *  data, let `mutate` change it, write it back. Re-serializing keeps the file valid JSON, so a
 *  control that reddens the catalog reddens it through the GATE, not through a parse failure. */
function patchDeclarations(fixtureRoot, mutate) {
  const f = path.join(fixtureRoot, "plugin", "scripts", CATALOG_DATA_NAME);
  const obj = JSON.parse(fs.readFileSync(f, "utf8"));
  mutate(obj);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + "\n");
  return f;
}
after(() => {
  for (const d of _baselineDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  _baselineDirs.length = 0;
});

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

// ── archive/** exclusion (gap-ac157-catalog-carrier-moved-criterion-stale) ───────────────────
// The enumeration moved out of the bash entry into the renderer (gap-arch-catalog-declarations-
// leave-bash) and the archive exclusion moved WITH it. The AC-157 criterion names the file that
// carries the exclusion — so the carrier states it in its own live code as a literal `archive/`
// path segment, and this test pins the BEHAVIOR, twice over:
//   ① over a temp FIXTURE tree (never a probe dropped into the live plugin/scripts) — archive dirs
//      at any depth are skipped while ordinary nested dirs ARE walked, so a red cannot come from
//      "the walk stopped seeing anything";
//   ② through the REAL entry on a materialized fixture — an archived probe neither reddens the
//      catalog nor enters its derived script set.
// ⛔ A face with no red direction is a face "wired" only on paper: flipping the exclusion's pattern
// to a non-matching form must redden BOTH this test and the criterion's own grep.
test("archive/** exclusion — archive dirs at any depth are skipped (fixture tree + real entry)", () => {
  // ① the derived script set over a fixture tree carrying archive dirs at two depths.
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), "cap-cat-archive-"));
  try {
    fs.mkdirSync(path.join(fx, "nested", "deep"), { recursive: true });
    fs.mkdirSync(path.join(fx, "archive", "2026-09-19-probe"), { recursive: true });
    fs.mkdirSync(path.join(fx, "nested", "archive"), { recursive: true });
    fs.mkdirSync(path.join(fx, "checker-mutation-cases"), { recursive: true });
    fs.writeFileSync(path.join(fx, "keep.sh"), "#!/usr/bin/env bash\n");
    fs.writeFileSync(path.join(fx, "nested", "deep", "keep.ts"), "export const x = 1;\n");
    fs.writeFileSync(path.join(fx, "readme.md"), "not a script\n");
    fs.writeFileSync(path.join(fx, "archive", "2026-09-19-probe", "probe.sh"), "#!/usr/bin/env bash\n");
    fs.writeFileSync(path.join(fx, "nested", "archive", "probe.mjs"), "export const y = 1;\n");
    fs.writeFileSync(path.join(fx, "checker-mutation-cases", "probe.ts"), "export const z = 1;\n");

    assert.deepEqual(deriveScripts(fx), ["keep.sh", "keep.ts"],
      "archive/** at ANY depth plus the fixture dir are skipped; ordinary nested dirs are walked " +
      "(keep.ts proves it) and non-scripts (readme.md) are ignored");

    // The predicate stated directly, so a regression points at the exclusion rather than the walk.
    assert.equal(isExcludedDirRelPath("archive"), true, "a top-level archive dir is excluded");
    assert.equal(isExcludedDirRelPath("a/archive/b"), true, "a nested archive dir is excluded");
    assert.equal(isExcludedDirRelPath("checker-mutation-cases"), true, "the fixture dir is excluded");
    assert.equal(isExcludedDirRelPath("myarchive"), false, "a dir merely NAMED LIKE archive is NOT excluded");
    assert.equal(isExcludedDirRelPath("nested"), false, "an ordinary dir is not excluded");
  } finally {
    fs.rmSync(fx, { recursive: true, force: true });
  }

  // ② the same guarantee through the production entry form.
  const tmp = materializeScripts("archive");
  try {
    fs.mkdirSync(path.join(tmp, "plugin", "scripts", "archive", "2026-09-19-probe"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "plugin", "scripts", "archive", "2026-09-19-probe", "probe.sh"),
      "#!/usr/bin/env bash\necho probe\n");
    const r = spawnSync("bash", [path.join(tmp, "plugin", "scripts", "capability-catalog.sh"), "--json"],
      { encoding: "utf8" });
    assert.equal(r.status, 0, `an archived probe must not redden the catalog:\n${r.stderr}`);
    const rows = JSON.parse(r.stdout);
    assert.ok(!rows.some((x) => x.file === "probe.sh"),
      "the archived probe never enters the derived script set (it is not an unclassified script — " +
      "it was not enumerated at all)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
  const tmp = materializeScripts("ac1c");
  try {
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

// ── AC5 (task): no command substitution in data values (gap-capability-catalog-backtick-command-substitution) ──
// A backtick or $( inside a bash-quoted data value was EXECUTED at load time — the data/code boundary
// punched through by a quote (round 143 red: a backtick `bash scripts/test.sh --static-checks-doc` in
// QUESTION[precommit-guard.ts] ran the whole doc-check suite on every catalog load and broke the
// tab-separated ROWS → --json IndexError). The tables are JSON now, so the value is never evaluated;
// the gate is KEPT anyway (a migrated-away hazard must not become a permanently-green check) and
// re-scoped from "source lines with a two-space indent" to "every value of every one of the ten
// tables" — the old shape-based scan missed 9 non-two-space-indented declarations entirely.
test("AC5 no-command-substitution — a data value containing a backtick or $( makes the catalog exit non-zero (negative control + restore)", () => {
  const tmp = materializeScripts("ac5cs");
  try {
    const catTmp = path.join(tmp, "plugin", "scripts", "capability-catalog.sh");

    // Baseline: the real declaration data (no injection) passes the AC5 gate.
    const base = spawnSync("bash", [catTmp, "--json"], { encoding: "utf8" });
    assert.equal(base.status, 0, `baseline catalog must pass the AC5 gate:\n${base.stderr}`);

    // Fail direction 1: a BACKTICK inside a QUESTION value (command-substitution injection).
    patchDeclarations(tmp, (d) => { d.QUESTION["capability-catalog.sh"] += " — runs `echo injected` now"; });
    const failBt = spawnSync("bash", [catTmp, "--json"], { encoding: "utf8" });
    assert.notEqual(failBt.status, 0, "a backtick in a data value must make the catalog exit non-zero (AC5 gate)");
    assert.match(failBt.stderr, /AC5 no-command-substitution/, "the gate names the AC5 failure");
    assert.match(failBt.stderr, /capability-catalog-declarations\.json/, "the gate names the data file it read");
    assert.match(failBt.stderr, /QUESTION\[capability-catalog\.sh\]/, "the gate points at the offending entry");

    // Fail direction 2: $( ) inside a QUESTION value.
    patchDeclarations(tmp, (d) => { d.QUESTION["capability-catalog.sh"] += " — computes $(echo injected) now"; });
    const failDollar = spawnSync("bash", [catTmp, "--json"], { encoding: "utf8" });
    assert.notEqual(failDollar.status, 0, "$( ) in a data value must make the catalog exit non-zero (AC5 gate)");
    assert.match(failDollar.stderr, /AC5 no-command-substitution/, "the gate names the AC5 failure");

    // Pass direction: restore the untouched data → passes again.
    fs.copyFileSync(CATALOG_DATA, path.join(tmp, "plugin", "scripts", CATALOG_DATA_NAME));
    const pass = spawnSync("bash", [catTmp, "--json"], { encoding: "utf8" });
    assert.equal(pass.status, 0, `restored catalog must pass the AC5 gate:\n${pass.stderr}`);
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
  const tmp = materializeScripts("entry");
  try {
    fs.mkdirSync(path.join(tmp, "plugin", "loop"), { recursive: true });
    fs.mkdirSync(path.join(tmp, "plugin", "skills", "demo"), { recursive: true });
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

// ── gap-crystallization-five-directions ①②③④: per-entry crystallization fields ──
test("①/②/③/④ — every declared row carries cadence, 失效前提, last-reaffirmed and matching (entry fields present)", () => {
  const rows = catalogRows();
  const declared = rows.filter((r) => r.question);
  assert.ok(declared.length > 0, "there are declared checks");
  for (const r of declared) {
    assert.ok(r.cadence && r.cadence.length > 0,
      `every declared check declares cadence: ${r.file} → ${r.cadence}`);
    assert.ok(/^(每轮|每红窗|每里程碑|冷启动|按需)$/.test(r.cadence),
      `cadence must be one of the five enumerated values: ${r.file} → ${r.cadence}`);
    assert.ok(r.invalidation && r.invalidation.length > 0,
      `every declared check carries a 失效前提 (invalidation) field: ${r.file}`);
    assert.ok(r.last_reaffirmed && /^\d{4}-\d{2}-\d{2}$/.test(r.last_reaffirmed),
      `every declared check carries a last-reaffirmed YYYY-MM-DD stamp: ${r.file} → ${r.last_reaffirmed}`);
    assert.ok(r.matching && /^(position|keyword|enumerative|n\/a)$/.test(r.matching),
      `every declared check declares a matching method: ${r.file} → ${r.matching}`);
  }
});

test("① entry gate — a declared check missing cadence/失效前提 is rejected (exit non-zero), and restoring it passes", () => {
  const tmp = materializeScripts("fields");
  try {
    // A temp copy of the whole plugin/scripts so the catalog sees every real script.
    const catTmp = path.join(tmp, "plugin", "scripts", "capability-catalog.sh");

    // Remove ONE CADENCE row for a real declared script (capability-catalog.sh itself).
    patchDeclarations(tmp, (d) => { delete d.CADENCE["capability-catalog.sh"]; });

    const fail = spawnSync("bash", [catTmp, "--json"], { encoding: "utf8" });
    assert.notEqual(fail.status, 0, "a declared check missing cadence must make the catalog exit non-zero");
    assert.match(fail.stderr, /lack cadence/, "the gate names the missing-cadence failure");

    // Restore → passes again.
    fs.copyFileSync(CATALOG_DATA, path.join(tmp, "plugin", "scripts", CATALOG_DATA_NAME));
    const pass = spawnSync("bash", [catTmp, "--json"], { encoding: "utf8" });
    assert.equal(pass.status, 0, `restored catalog must pass:\n${pass.stderr}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("① entry gate — a declared check missing 失效前提 (invalidation) is rejected", () => {
  const tmp = materializeScripts("inval");
  try {
    const catTmp = path.join(tmp, "plugin", "scripts", "capability-catalog.sh");
    // Remove the INVALIDATION row for capability-catalog.sh itself.
    patchDeclarations(tmp, (d) => { delete d.INVALIDATION["capability-catalog.sh"]; });
    const fail = spawnSync("bash", [catTmp, "--json"], { encoding: "utf8" });
    assert.notEqual(fail.status, 0, "a declared check missing 失效前提 must make the catalog exit non-zero");
    assert.match(fail.stderr, /lack 失效前提/, "the gate names the missing-invalidation failure");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

// ── Wiring: capability-catalog.sh is a plugin script (not laid down by quay-init after AC168) ──
test("Wiring — capability-catalog.sh is a plugin script (not laid down); the catalog passes standalone", () => {
  // AC168 (gap-quay-init-closure-shrink-body): quay-init writes the six-item closed set only — no
  // plugin/scripts copies. capability-catalog.sh is delivered BY THE PLUGIN, not laid into a target.
  const catalogScript = path.join(SCRIPTS_DIR, "capability-catalog.sh");
  assert.ok(fs.existsSync(catalogScript), "capability-catalog.sh must exist in plugin/scripts");

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "cap-cat-init-"));
  const wt = diskWorktreeRoot();
  try {
    const r = spawnSync("bash",
      [path.join(SCRIPTS_DIR, "quay-init.sh"), "--loop", "--root", ws, "--project", "capcat",
        "--test-command", "node --test", "--tmux-session", "capcat-0:0.0", "--worktree-root", wt],
      { encoding: "utf8", env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_DIR } });
    assert.equal(r.status, 0, `quay-init --loop must exit 0:\n${r.stderr}`);
    assert.ok(!fs.existsSync(path.join(ws, "plugin", "scripts", "capability-catalog.sh")),
      "capability-catalog.sh must NOT be laid down (AC168 closed set — no script copies)");
    // The catalog passes standalone (its table covers the whole plugin).
    const cat = spawnSync("bash", [catalogScript, "--summary"], { encoding: "utf8" });
    assert.equal(cat.status, 0, `the catalog must pass standalone:\n${cat.stderr}\n${cat.stdout}`);
    assert.match(cat.stdout, /0 unclassified/, "the catalog must report 0 unclassified");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC6: this file is node:test and declares @test-group engine (self-evident) ──
test("AC6 — this test file is node:test with an engine @test-group", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /from "node:test"/, "imports node:test");
  assert.match(src, /\bimport \{[^}]*\btest\b[^}]*\}/, "imports test from node:test");
  assert.match(src, /^\/\/ @test-group engine/m, "declares @test-group engine");
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
