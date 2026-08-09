// @test-group governance
// halt-check.test.mjs — the THREE-LAYER UNIFIED `.halt` check point
// (orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md §2.8,
//  task gap-spec-p2-halt-three-layer-mechanical-enforcement).
//
// Pins the unified check point all three layers (outer/inner/manager) call:
//   Contract measure — `bash plugin/scripts/halt-check.sh --for <layer> --json` 的 `halted` 字段:
//     run once per layer with `.halt` present ⇒ 3 `halted` fields all true (band 3).
//   AC1  — fail-closed read shape (mirrors supervisor-preempt.sh halt-check EXACTLY):
//          ENOENT ⇒ halted=false; file present ⇒ halted=true (empty still halts); ANY other read
//          failure ⇒ halted=true (never fail open — gap-halt-sentinel-path-mismatch).
//   AC3  — combination criterion mechanized (SPEC 2.8): 无 .halt 且 最后提交 > 阈值 ⇒ stall=true;
//          .halt present ⇒ stall=false (a marked stop is not an unmarked stall).
//   AC4  — negative control: remove `.halt` ⇒ halted=false again (three layers resume).
//   AC5  — --json shape: layer label carried; last_commit_age_hours number or null.
//
// Run:
//   scripts/test.sh plugin/test/halt-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HALT_CHECK = path.join(REPO_ROOT, "plugin", "scripts", "halt-check.sh");

function runHalt(args = [], opts = {}) {
  return spawnSync("bash", [HALT_CHECK, ...args], { encoding: "utf8", ...opts });
}

function jsonRun(args = []) {
  const r = runHalt([...args, "--json"]);
  assert.equal(r.status, 0, `halt-check --json must exit 0:\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

// ── temp workspace helpers (isolation-safe: mkdtemp + after() cleanup) ───────────────────────────────
const _tmpRoots = [];
after(() => {
  for (const d of _tmpRoots) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "halt-check-"));
  _tmpRoots.push(dir);
  return dir;
}

// Make `dir` a git repo with one commit, optionally backdated (for the stale-combination case).
function makeGitRepo(dir, { backdateHours = 0 } = {}) {
  const git = (args) => spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "halt-check-test@example.com"]);
  git(["config", "user.name", "halt-check test"]);
  fs.writeFileSync(path.join(dir, "f.txt"), "x\n", "utf8");
  git(["add", "f.txt"]);
  const env = { ...process.env };
  if (backdateHours > 0) {
    const backdate = new Date(Date.now() - backdateHours * 3_600_000).toISOString();
    env.GIT_AUTHOR_DATE = backdate;
    env.GIT_COMMITTER_DATE = backdate;
  }
  const c = spawnSync("git", ["-C", dir, "commit", "-qm", "init"], { encoding: "utf8", env });
  assert.equal(c.status, 0, `git commit must succeed in ${dir}:\n${c.stderr}`);
}

// ── AC1: fail-closed read shape ──────────────────────────────────────────────────────────────────────
test("AC1 — no .halt ⇒ halted=false, reason empty (Contract measure: non-halted state)", () => {
  const root = tmpRoot();
  const d = jsonRun(["--for", "inner", "--root", root]);
  assert.equal(d.halted, false);
  assert.equal(d.halted_reason, "");
});

test("AC1 — .halt present ⇒ halted=true with its content as reason", () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, ".halt"), "manual stop | 解除: x", "utf8");
  const d = jsonRun(["--for", "inner", "--root", root]);
  assert.equal(d.halted, true);
  assert.equal(d.halted_reason, "manual stop | 解除: x");
});

test("AC1 — empty .halt still halts (the sentinel is the pause), reason names empty", () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, ".halt"), "", "utf8");
  const d = jsonRun(["--for", "inner", "--root", root]);
  assert.equal(d.halted, true);
  assert.equal(d.halted_reason, ".halt sentinel present (empty)");
});

test("AC1 — unreadable .halt is FAIL-CLOSED halted=true (never fail open)", () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, ".halt"), "stop", "utf8");
  fs.chmodSync(path.join(root, ".halt"), 0o000);
  const d = jsonRun(["--for", "inner", "--root", root]);
  assert.equal(d.halted, true);
  assert.match(d.halted_reason, /FAIL-CLOSED/);
  fs.chmodSync(path.join(root, ".halt"), 0o600);
});

test("AC1 — non-JSON output is a drop-in superset of supervisor-preempt.sh halt-check (halted=/reason= lines)", () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, ".halt"), "stop", "utf8");
  const r = runHalt(["--for", "inner", "--root", root]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^halted=true$/m);
  assert.match(r.stdout, /^reason=stop$/m);
  assert.match(r.stdout, /^layer=inner$/m);
  assert.match(r.stdout, /^stall=false$/m);
});

// ── --for validation ─────────────────────────────────────────────────────────────────────────────────
test("--for — a missing or unknown layer is a usage error (exit 2)", () => {
  const root = tmpRoot();
  const missing = runHalt(["--root", root, "--json"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--for/);
  const unknown = runHalt(["--for", "nope", "--root", root, "--json"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown layer/);
});

// ── Contract measure: three-layer halt effectiveness (band 3) ────────────────────────────────────────
test("Contract measure — with .halt present, outer/inner/manager each report halted=true (3 halted fields, band 3)", () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, ".halt"), "pause all", "utf8");
  let haltedCount = 0;
  for (const layer of ["outer", "inner", "manager"]) {
    const d = jsonRun(["--for", layer, "--root", root]);
    assert.equal(d.layer, layer, "--for label is carried into the JSON");
    assert.equal(d.halted, true, `layer ${layer} must halt when .halt present`);
    haltedCount += 1;
  }
  assert.equal(haltedCount, 3, "three-layer halt effectiveness band = 3");
});

test("Contract measure — after removing .halt, outer/inner/manager each report halted=false (AC4 resume)", () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, ".halt"), "pause all", "utf8");
  for (const layer of ["outer", "inner", "manager"]) {
    assert.equal(jsonRun(["--for", layer, "--root", root]).halted, true);
  }
  fs.rmSync(path.join(root, ".halt"));
  for (const layer of ["outer", "inner", "manager"]) {
    assert.equal(jsonRun(["--for", layer, "--root", root]).halted, false,
      `layer ${layer} must resume after .halt removal`);
  }
});

// ── AC3: combination criterion (无 .halt 且 >threshold 无产出 ⇒ unmarked stall) ─────────────────────
test("AC3 — no .halt + stale last commit (> threshold) ⇒ stall=true (unmarked stall mechanically reported)", () => {
  const root = tmpRoot();
  makeGitRepo(root, { backdateHours: 60 });
  const d = jsonRun(["--for", "outer", "--root", root]);
  assert.equal(d.halted, false);
  assert.equal(d.stall, true, "no .halt AND >24h no output ⇒ unmarked stall");
  assert.match(d.stall_reason, /unmarked stall \(SPEC 2.8\)/);
  assert.ok(typeof d.last_commit_age_hours === "number" && d.last_commit_age_hours > 24,
    `last_commit_age_hours reflects the stale commit: ${d.last_commit_age_hours}`);
});

test("AC3 — no .halt + fresh last commit ⇒ stall=false (not stalled)", () => {
  const root = tmpRoot();
  makeGitRepo(root);
  const d = jsonRun(["--for", "inner", "--root", root]);
  assert.equal(d.halted, false);
  assert.equal(d.stall, false);
});

test("AC3 — .halt present + stale commit ⇒ stall=false (a marked stop is not an unmarked stall)", () => {
  const root = tmpRoot();
  makeGitRepo(root, { backdateHours: 60 });
  fs.writeFileSync(path.join(root, ".halt"), "stop", "utf8");
  const d = jsonRun(["--for", "manager", "--root", root]);
  assert.equal(d.halted, true);
  assert.equal(d.stall, false);
});

// ── --projects (the outer/manager three-project reading) ─────────────────────────────────────────────
test("--projects — per-project .halt is read with the same fail-closed shape (absolute + relative)", () => {
  const root = tmpRoot();
  makeGitRepo(root);
  const relDir = path.join(root, "archguard");
  fs.mkdirSync(relDir);
  fs.writeFileSync(path.join(relDir, ".halt"), "guard stop", "utf8");
  const absDir = path.join(root, "meta-cc");
  fs.mkdirSync(absDir);
  fs.writeFileSync(path.join(absDir, ".halt"), "meta stop", "utf8");
  const d = jsonRun(["--for", "manager", "--root", root, "--projects", `archguard,${absDir}`]);
  assert.ok(Array.isArray(d.projects), "projects array present with --projects");
  assert.equal(d.projects.length, 2);
  const rel = d.projects.find((p) => p.name === "archguard");
  assert.ok(rel, "relative entry resolves under --root");
  assert.equal(rel.halted, true);
  assert.equal(rel.halted_reason, "guard stop");
  const abs = d.projects.find((p) => p.name === "meta-cc");
  assert.ok(abs, "absolute entry label = directory basename");
  assert.equal(abs.halted, true);
  assert.equal(abs.halted_reason, "meta stop");
});

// ── AC5: --json shape ────────────────────────────────────────────────────────────────────────────────
test("AC5 — --json is valid JSON with the declared fields; non-git root ⇒ last_commit_age_hours null, stall fail-safe", () => {
  const root = tmpRoot();
  const d = jsonRun(["--for", "inner", "--root", root]);
  assert.equal(d.halted, false);
  assert.equal(d.last_commit_age_hours, null, "non-git root cannot compute last-commit age (null, fail-safe)");
  assert.equal(d.stall, false, "cannot confirm staleness ⇒ no false stall alarm");
  assert.equal(typeof d.stall_threshold_hours, "number");
});
