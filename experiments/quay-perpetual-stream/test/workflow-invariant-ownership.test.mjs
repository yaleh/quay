// workflow-invariant-ownership.test.mjs — DIR-124-A3a: RED/GREEN tests for
// workflow-invariant-ownership.mjs, the invariant-ownership manifest enforcement script.
//
// Covers:
//   GREEN — valid single-authoritative-owner manifest (exit 0, ok:true, violations=[])
//   GREEN — missing manifest soft-launch (exit 0, ok:true, warnings non-empty)
//   RED   — two-owner violation (exit 1, violations[] includes duplicate-authoritative-owners)
//   RED   — missing-owner file (exit 1, violations[] includes owner-file-exists)
//   RED   — orphaned invariant (exit 1, violations[] includes orphaned invariant / no authoritative owner)
//   RED   — --require-manifest with missing manifest (exit 2, usage/env error)
//
// Run:
//   node --test experiments/quay-perpetual-stream/test/workflow-invariant-ownership.test.mjs
//   scripts/test.sh experiments/quay-perpetual-stream/test/workflow-invariant-ownership.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo root differs by test location: experiments/.../test/ (3 levels up), plugin/test/ (2 levels up).
// Use .git presence to detect the correct root for both locations.
const REPO_ROOT = (() => {
  const try2 = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(try2, ".git"))) return try2;
  const try3 = path.resolve(__dirname, "..", "..", "..");
  if (fs.existsSync(path.join(try3, ".git"))) return try3;
  throw new Error("Cannot find repo root from " + __dirname);
})();
const SCRIPT = path.resolve(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "workflow-invariant-ownership.mjs");
const FIX = path.resolve(REPO_ROOT, "experiments", "quay-perpetual-stream", "fixtures", "invariant-ownership");
const WORKSPACE_ROOT = REPO_ROOT;

function runScript(manifestPath, extraArgs = []) {
  const result = spawnSync("node", [SCRIPT, manifestPath, "--workspace-root", WORKSPACE_ROOT, ...extraArgs], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

// ── GREEN: Valid single-authoritative-owner manifest ───────────────────────────────────────────────
test("valid single-owner manifest exits 0 with ok:true", () => {
  const manifestPath = path.join(FIX, "valid-manifest.md");
  const result = runScript(manifestPath);
  assert.equal(result.status, 0, `expected exit 0, got ${result.status} — stderr: ${result.stderr}`);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.violations.length, 0);
  assert.ok(json.totalInvariants >= 1, `expected at least 1 invariant, got ${json.totalInvariants}`);
  // deletionList should collect [duplicate-to-remove] entries from the fixture
  // (valid-manifest has no duplicate-to-remove entries, so deletionList is empty)
  assert.equal(json.deletionList.length, 0);
  // mirrorList/adapterList should collect classified entries
  assert.equal(json.mirrorList.length, 0);
  assert.equal(json.adapterList.length >= 1, true, `expected adapter entries for plugin mirrors`);
});

// ── GREEN: Missing manifest soft-launch (exit 0 with warning) ─────────────────────────────────────
test("missing manifest exits 0 with ok:true and warning (soft-launch)", () => {
  const manifestPath = path.join(FIX, "does-not-exist-xyz.md");
  const result = runScript(manifestPath);
  assert.equal(result.status, 0, `expected exit 0 for soft-launch, got ${result.status}`);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.totalInvariants, 0);
  assert.ok(json.warnings && json.warnings.length > 0, "expected warnings about missing manifest");
  assert.match(json.warnings[0], /no manifest found/i);
});

// ── RED: --require-manifest with missing manifest → exit 2 ────────────────────────────────────────
test("missing manifest with --require-manifest exits 2", () => {
  const manifestPath = path.join(FIX, "does-not-exist-xyz.md");
  const result = runScript(manifestPath, ["--require-manifest"]);
  assert.equal(result.status, 2, `expected exit 2 with --require-manifest, got ${result.status}`);
  assert.match(result.stderr, /manifest file not found|require-manifest/i);
});

// ── RED: Two authoritative owners for same invariant → exit 1 ─────────────────────────────────────
test("two-owner violation exits 1 with duplicate-authoritative-owners violation", () => {
  const manifestPath = path.join(FIX, "two-owner-violation.md");
  const result = runScript(manifestPath);
  assert.equal(result.status, 1, `expected exit 1 for two-owner violation, got ${result.status}`);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, false);
  assert.ok(json.violations.length >= 1, `expected at least 1 violation, got ${json.violations.length}`);

  const dupViolation = json.violations.find((v) => v.rule === "single-authoritative-owner");
  assert.ok(dupViolation, `expected a single-authoritative-owner violation, got: ${JSON.stringify(json.violations)}`);
  assert.match(dupViolation.detail, /duplicate|2/);
});

// ── RED: Authoritative owner path does not resolve to an existing file → exit 1 ────────────────────
test("missing-owner-file exits 1 with owner-file-exists violation", () => {
  const manifestPath = path.join(FIX, "missing-owner-file.md");
  const result = runScript(manifestPath);
  assert.equal(result.status, 1, `expected exit 1 for missing-owner file, got ${result.status}`);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, false);
  assert.ok(json.violations.length >= 1, `expected at least 1 violation, got ${json.violations.length}`);

  const fileViolation = json.violations.find((v) => v.rule === "owner-file-exists");
  assert.ok(fileViolation, `expected an owner-file-exists violation, got: ${JSON.stringify(json.violations)}`);
  assert.match(fileViolation.detail, /does not resolve|not exist/i);
  assert.match(fileViolation.detail, /does-not-exist/);
});

// ── RED: Orphaned invariant (no authoritative owner line) → exit 1 ─────────────────────────────────
test("orphaned invariant exits 1 with single-authoritative-owner violation (no owner)", () => {
  const manifestPath = path.join(FIX, "orphaned-invariant.md");
  const result = runScript(manifestPath);
  assert.equal(result.status, 1, `expected exit 1 for orphaned invariant, got ${result.status}`);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, false);
  assert.ok(json.violations.length >= 1, `expected at least 1 violation, got ${json.violations.length}`);

  const orphanViolation = json.violations.find((v) => v.rule === "single-authoritative-owner" && v.detail.includes("orphaned"));
  assert.ok(orphanViolation, `expected an orphaned invariant violation, got: ${JSON.stringify(json.violations)}`);
});

// ── GREEN: stdout JSON includes structured output fields ──────────────────────────────────────────
test("stdout JSON includes all required fields", () => {
  const manifestPath = path.join(FIX, "valid-manifest.md");
  const result = runScript(manifestPath);
  assert.equal(result.status, 0);
  const json = JSON.parse(result.stdout);

  // All required top-level keys must be present.
  for (const key of ["ok", "violations", "deletionList", "mirrorList", "adapterList", "totalInvariants"]) {
    assert.ok(key in json, `missing required key: ${key}`);
  }

  // violations, deletionList, mirrorList, adapterList must be arrays.
  for (const key of ["violations", "deletionList", "mirrorList", "adapterList"]) {
    assert.ok(Array.isArray(json[key]), `${key} must be an array`);
  }

  // totalInvariants must be a non-negative integer.
  assert.ok(Number.isInteger(json.totalInvariants) && json.totalInvariants >= 0,
    `totalInvariants must be a non-negative integer, got ${JSON.stringify(json.totalInvariants)}`);
});

// ── GREEN: deletionList aggregates [duplicate-to-remove] entries ───────────────────────────────────
test("deletionList aggregates [duplicate-to-remove] entries", () => {
  const manifestPath = path.join(FIX, "two-owner-violation.md");
  const result = runScript(manifestPath);
  assert.equal(result.status, 1); // Still fails on the two-owner rule, but deletionList is still populated
  const json = JSON.parse(result.stdout);

  const deletionEntries = json.deletionList.filter(
    (e) => e.classification === "duplicate-to-remove"
  );
  assert.ok(deletionEntries.length >= 1, `expected at least 1 duplicate-to-remove entry, got ${deletionEntries.length}`);
  assert.ok(deletionEntries.every((e) => e.invariant && e.path),
    "every deletionList entry must have invariant and path");
});

// ── GREEN: Enforcement script imports extractSection from task-schema.ts (no reimplemented parser) ─
test("enforcement script uses extractSection from task-schema.ts (WIRING-CLAIM A3a-PARSE)", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");

  // Must import extractSection from task-schema.ts.
  assert.match(src, /import\s+\{[^}]*extractSection[^}]*\}\s+from\s+["']\.\/task-schema\.ts["']/,
    "must import extractSection from task-schema.ts");

  // Must NOT contain a reimplemented section parser (no new depth-aware regex parser).
  // The enforcement script must use extractSection, not write its own.
  // We check that there is no second depth-aware heading section parser beyond the import.
  const sectionParserCount = (src.match(/function\s+\w*[Ss]ection\w*/g) || []).length;
  assert.equal(sectionParserCount, 0,
    `expected 0 locally-defined section-parser functions, found ${sectionParserCount} — must reuse extractSection`);
});

// ── Forward-compat flags are no-ops ───────────────────────────────────────────────────────────────
test("--check-dsl-mirrors is a no-op (not yet implemented)", () => {
  const manifestPath = path.join(FIX, "valid-manifest.md");
  const result = runScript(manifestPath, ["--check-dsl-mirrors"]);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /not yet implemented/i);
});

test("--check-adapters is a no-op (not yet implemented)", () => {
  const manifestPath = path.join(FIX, "valid-manifest.md");
  const result = runScript(manifestPath, ["--check-adapters"]);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /not yet implemented/i);
});

// ── GREEN: Real manifest validates clean ──────────────────────────────────────────────────────────
test("real invariant-ownership.md manifest validates clean (self-hosting)", () => {
  const manifestPath = path.resolve(REPO_ROOT, "experiments", "quay-perpetual-stream", "invariant-ownership.md");
  const result = runScript(manifestPath);
  assert.equal(result.status, 0, `real manifest must validate clean, got exit ${result.status}: ${result.stderr}\nstdout: ${result.stdout.slice(0, 500)}`);
  const json = JSON.parse(result.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.violations.length, 0, `real manifest has violations: ${JSON.stringify(json.violations)}`);
  assert.ok(json.totalInvariants >= 10, `real manifest should have many invariants, got ${json.totalInvariants}`);
});
