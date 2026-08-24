// @test-group governance
// spec-declaration-point-check.test.mjs — SPEC 声明点机械检查测试
// (tasks/gap-spec-declaration-point-mechanical-check).
//
// AC1 (falsifiable, negative control produced by the implementer): a new orchestration/SPEC-*.md
// that is missing from ANY declaration point ⇒ the checker goes RED (exit 1). AC2 (grep-derived,
// NOT hardcoded): the declaration-point set is derived by searching plugin/skills/** for files
// referencing `orchestration/SPEC-` — a THIRD declaration point is picked up automatically, and a
// SPEC missing from it goes RED. Hard rule 3b: zero SPECs / zero declaration points ⇒ NOT-EVALUATED
// (exit 2), never conflated with green.
//
// This file pins:
//   (a) the pure logic (listSpecBasenames / findDeclarationPoints / checkSpecDeclarations);
//   (b) the REAL repo is GREEN (every on-disk SPEC declared at each real declaration point);
//   (c) the NEGATIVE CONTROL — a temp repo missing one declaration ⇒ exit 1;
//   (d) AC2 — a third declaration point is derived, not hardcoded;
//   (e) NOT-EVALUATED — zero declaration points ⇒ exit 2.
//
// Run:
//   scripts/test.sh plugin/test/spec-declaration-point-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  SPEC_FILE_RE,
  listSpecBasenames,
  findDeclarationPoints,
  checkSpecDeclarations,
} from "../scripts/spec-declaration-point-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const CLI = path.join(repoRoot, "plugin", "scripts", "spec-declaration-point-check.ts");

// ── pure logic ──────────────────────────────────────────────────────────────────────────────────────

test("SPEC_FILE_RE matches orchestration/SPEC-*.md and nothing else", () => {
  assert.ok(SPEC_FILE_RE.test("SPEC-unified-driver-architecture-2026-08-23.md"));
  assert.ok(SPEC_FILE_RE.test("SPEC-cut-the-waiting.md"));
  assert.ok(!SPEC_FILE_RE.test("SYNTHESIS-four-gaps-2026-08-05.md"));
  assert.ok(!SPEC_FILE_RE.test("manager-tick-core.md"));
});

test("listSpecBasenames — returns sorted SPEC basenames, empty when dir absent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spc-list-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "orchestration"));
  fs.writeFileSync(path.join(dir, "orchestration", "SPEC-b.md"), "b");
  fs.writeFileSync(path.join(dir, "orchestration", "SPEC-a.md"), "a");
  fs.writeFileSync(path.join(dir, "orchestration", "NOT-A-SPEC.md"), "x");
  assert.deepEqual(listSpecBasenames(dir), ["SPEC-a.md", "SPEC-b.md"]);
  assert.deepEqual(listSpecBasenames(path.join(dir, "no-such-root")), []);
});

test("findDeclarationPoints — grep-derives only files referencing orchestration/SPEC-", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spc-find-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "skills", "a"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin", "skills", "b"), { recursive: true });
  fs.mkdirSync(path.join(dir, "plugin", "skills", "c"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "skills", "a", "SKILL.md"), "index: orchestration/SPEC-x.md\n");
  fs.writeFileSync(path.join(dir, "plugin", "skills", "b", "SKILL.md"), "<!-- reference-doc: orchestration/SPEC-x.md -->\n");
  fs.writeFileSync(path.join(dir, "plugin", "skills", "c", "SKILL.md"), "no spec reference here\n");
  const points = findDeclarationPoints(dir).map((p) => path.relative(dir, p));
  assert.deepEqual(points, [
    path.join("plugin", "skills", "a", "SKILL.md"),
    path.join("plugin", "skills", "b", "SKILL.md"),
  ]);
  assert.deepEqual(findDeclarationPoints(path.join(dir, "no-such-root")), []);
});

// ── real repo ───────────────────────────────────────────────────────────────────────────────────────

test("real repo is GREEN — every on-disk SPEC declared at each real declaration point", () => {
  const res = checkSpecDeclarations(repoRoot);
  assert.equal(res.evaluated, true, "the real repo must be evaluable (SPECs + declaration points present)");
  assert.ok(res.specs.length >= 20, `expected ≥20 on-disk SPECs, got ${res.specs.length}`);
  assert.ok(res.declarationPoints.length >= 2, `expected ≥2 declaration points, got ${res.declarationPoints.length}`);
  const rel = res.declarationPoints.map((d) => path.relative(repoRoot, d.path));
  assert.ok(rel.includes(path.join("plugin", "skills", "manager", "SKILL.md")), "manager SKILL index is a declaration point");
  assert.ok(rel.includes(path.join("plugin", "skills", "init", "SKILL.md")), "init SKILL reference-doc is a declaration point");
  for (const d of res.declarationPoints) {
    assert.deepEqual(d.missingSpecs, [], `real declaration point must be complete: ${d.path}`);
  }
  assert.equal(res.ok, true, "the real repo must be green");
});

// ── fixture helper ───────────────────────────────────────────────────────────────────────────────────

/** Build a temp repo: `specs` SPEC basenames + `points` declaration-point files, each a map of which SPECs it declares. */
function buildFixture(tag, specs, points) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `spc-${tag}-`));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
  for (const s of specs) fs.writeFileSync(path.join(dir, "orchestration", s), `# ${s}\n`);
  for (const [relPoint, declared] of Object.entries(points)) {
    const full = path.join(dir, relPoint);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const body = declared.map((s) => `- \`orchestration/${s}\` — declared\n`).join("");
    fs.writeFileSync(full, body);
  }
  return dir;
}

function runCli(root) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, "--json"], {
    encoding: "utf8",
  });
}

// ── negative control (AC1) ───────────────────────────────────────────────────────────────────────────

test("AC1 — a SPEC missing from ONE declaration point ⇒ RED (exit 1, names the point + spec)", () => {
  const dir = buildFixture("neg1", ["SPEC-alpha.md", "SPEC-beta.md"], {
    "plugin/skills/a/SKILL.md": ["SPEC-alpha.md", "SPEC-beta.md"],
    "plugin/skills/b/SKILL.md": ["SPEC-alpha.md"], // beta missing here
  });
  const r = runCli(dir);
  assert.equal(r.status, 1, `checker must exit 1 on a missing declaration:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.ok, false);
  const b = res.declarationPoints.find((d) => d.path.endsWith(path.join("plugin", "skills", "b", "SKILL.md")));
  assert.ok(b, "result must carry the incomplete declaration point");
  assert.deepEqual(b.missingSpecs, ["SPEC-beta.md"], "must name the exact missing spec");
});

test("AC1 — fully declared fixture ⇒ GREEN (exit 0)", () => {
  const dir = buildFixture("pos1", ["SPEC-alpha.md", "SPEC-beta.md"], {
    "plugin/skills/a/SKILL.md": ["SPEC-alpha.md", "SPEC-beta.md"],
    "plugin/skills/b/SKILL.md": ["SPEC-alpha.md", "SPEC-beta.md"],
  });
  const r = runCli(dir);
  assert.equal(r.status, 0, `a fully-declared fixture must be green:\n${r.stdout}\n${r.stderr}`);
});

// ── AC2: declaration-point set is grep-derived, not hardcoded ────────────────────────────────────────

test("AC2 — a THIRD declaration point is auto-detected; a SPEC missing from it ⇒ RED", () => {
  const dir = buildFixture("third", ["SPEC-alpha.md", "SPEC-beta.md"], {
    "plugin/skills/a/SKILL.md": ["SPEC-alpha.md", "SPEC-beta.md"],
    "plugin/skills/b/SKILL.md": ["SPEC-alpha.md", "SPEC-beta.md"],
    "plugin/skills/c/SKILL.md": ["SPEC-alpha.md"], // a brand-new third declaration point, missing beta
  });
  const r = runCli(dir);
  assert.equal(r.status, 1, "a third declaration point must be enforced without any hardcoded list");
  const res = JSON.parse(r.stdout);
  assert.equal(res.declarationPoints.length, 3, "the grep-derived set must include all three points");
  const c = res.declarationPoints.find((d) => d.path.endsWith(path.join("plugin", "skills", "c", "SKILL.md")));
  assert.deepEqual(c.missingSpecs, ["SPEC-beta.md"], "the third point's missing spec must be reported");
});

// ── NOT-EVALUATED (hard rule 3b) ──────────────────────────────────────────────────────────────────────

test("zero declaration points ⇒ NOT-EVALUATED (exit 2), never conflated with green", () => {
  const dir = buildFixture("ne", ["SPEC-alpha.md"], {});
  const r = runCli(dir);
  assert.equal(r.status, 2, `no declaration points must be NOT-EVALUATED, not green:\n${r.stdout}\n${r.stderr}`);
  const res = JSON.parse(r.stdout);
  assert.equal(res.evaluated, false);
  assert.ok(res.notEvaluatedReason, "NOT-EVALUATED must carry a reason");
});

test("zero on-disk SPECs ⇒ NOT-EVALUATED (exit 2)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spc-ne2-"));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "plugin", "skills", "a"), { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin", "skills", "a", "SKILL.md"), "- `orchestration/SPEC-x.md`\n");
  const r = runCli(dir);
  assert.equal(r.status, 2, `no SPECs must be NOT-EVALUATED, not green:\n${r.stdout}\n${r.stderr}`);
});
