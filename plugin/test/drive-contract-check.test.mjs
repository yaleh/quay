// @test-group engine
// drive-contract-check.test.mjs — tasks/gap-drive-text-carries-data-not-behavior-outer-inner-handoff
// (AC3/AC4/AC6): the drive-text contract checker.
//
// Coverage map (task ACs):
//   AC3 — the checker detects "drive text asserts an X→Y order AND the same text lacks a
//         checkTouchesPair output", judged by POSITION (order assertion + pair output coexist in
//         the same drive text), never by keyword (ruling docs necessarily contain words like
//         并发派发). The default gate is wired into scripts/test.sh run_static_checks (asserted
//         here as a regression: the REAL repo's three normative drive docs pass).
//   AC4 — the negative control: a drive text with "按 A→B 顺序" and no pair output MUST be
//         reported (+1); adding the output MUST make it clean (both directions asserted here and
//         pasted into the task body).
//   AC6 — this file uses node:test and declares // @test-group engine.
//
// No global counts are hardcoded: every assertion is relative to a fixture.
//
// Run:
//   scripts/test.sh plugin/test/drive-contract-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/drive-contract-check.ts");

/** Run the checker with args against the REAL repo; returns the spawnSync result. */
function run(...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", REPO_ROOT, ...args],
    { encoding: "utf8" },
  );
}

/** Judge one temp drive-text file (absolute path) with --judge; returns the spawnSync result. */
function judgeFile(absPath) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--judge", absPath, "--json"],
    { encoding: "utf8" },
  );
}

/** Write a temp drive text and judge it; returns { res, dir } for cleanup. */
function tmpDrive(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drive-check-"));
  const f = path.join(dir, "drive.md");
  fs.writeFileSync(f, text);
  return { res: judgeFile(f), dir };
}

test("AC4 negative control — '按 A→B 顺序' WITHOUT a pair output MUST be reported (+1)", () => {
  const { res, dir } = tmpDrive("本批实现三个任务，按 A→B 顺序。\n");
  try {
    assert.equal(res.status, 1, `expected exit 1 (flagged), got ${res.status}:\n${res.stdout}${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.violations, 1, `expected violations 1, got ${out.violations}`);
    assert.equal(out.orderAssertions.length, 1);
    assert.equal(out.hasPairOutput, false);
    assert.ok(out.orderAssertions[0].hit.includes("A→B"), `hit should contain A→B, got ${out.orderAssertions[0].hit}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 negative control — adding the checkTouchesPair output MUST make it clean (back to 0)", () => {
  const { res, dir } = tmpDrive(
    "本批实现三个任务，按 A→B 顺序。\n" +
      'checkTouchesPair 实跑：A-B: {"disjoint":true,"overlaps":[],"reason":"disjoint file-sets"}\n',
  );
  try {
    assert.equal(res.status, 0, `expected exit 0 (clean), got ${res.status}:\n${res.stdout}${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.violations, 0, `expected violations 0, got ${out.violations}`);
    assert.equal(out.hasPairOutput, true);
    assert.equal(out.orderAssertions.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 judgment is POSITIONAL, not keyword — a text with 并发派发 but no order assertion is clean", () => {
  const { res, dir } = tmpDrive(
    "派发 A、D 与 L0：并发上限 3，后台 Agent(run_in_background)，各自 worktree，内部对抗审查硬上限 2 轮。\n",
  );
  try {
    assert.equal(res.status, 0, `keyword 并发派发 without an order assertion must be clean, got ${res.status}:\n${res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.orderAssertions.length, 0, `expected no order assertion, got ${JSON.stringify(out.orderAssertions)}`);
    assert.equal(out.violations, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3 judgment is POSITIONAL, not keyword — 并发派发 + order assertion + pair output is clean; the same WITHOUT output flags", () => {
  // Same drive text, same 并发派发 keyword: the ONLY difference is the presence of the pair output.
  const without = "并发派发：按 A→D→B 顺序。\n";
  const { res: r1, dir: d1 } = tmpDrive(without);
  try {
    assert.equal(r1.status, 1, `order assertion without output must flag even with 并发派发 keyword, got ${r1.status}`);
    assert.equal(JSON.parse(r1.stdout).violations, 1);
  } finally {
    fs.rmSync(d1, { recursive: true, force: true });
  }

  const withOutput = "并发派发：按 A→D→B 顺序。\nA-D: {\"disjoint\":true,\"overlaps\":[],\"reason\":\"disjoint file-sets\"}\n";
  const { res: r2, dir: d2 } = tmpDrive(withOutput);
  try {
    assert.equal(r2.status, 0, `order assertion WITH pair output must be clean, got ${r2.status}:\n${r2.stdout}`);
    assert.equal(JSON.parse(r2.stdout).violations, 0);
  } finally {
    fs.rmSync(d2, { recursive: true, force: true });
  }
});

test("structural signature — lowercase lifecycle arrows (todo→ready) and keystrokes are NOT order assertions", () => {
  const { res, dir } = tmpDrive(
    "晋级走 status: todo → ready；发送用 C-u → 文本 → Enter；重置基线按 45 → 30 分钟。\n",
  );
  try {
    assert.equal(res.status, 0, `lowercase/digit arrows must not match, got ${res.status}:\n${res.stdout}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.orderAssertions.length, 0, `expected no order assertion, got ${JSON.stringify(out.orderAssertions)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — ruling/task docs that quote the incident carry the pair output, so by position they are clean (no self-hit)", () => {
  // The ruling doc quotes "按 A→D→B 顺序" as evidence AND carries the checkTouchesPair output.
  const ruling = run("--judge", "orchestration/outer-rulings-2026-08-04-A-F.md", "--json");
  assert.equal(ruling.status, 0, `ruling doc must be clean by position, got ${ruling.status}:\n${ruling.stdout}${ruling.stderr}`);
  const rOut = JSON.parse(ruling.stdout);
  assert.equal(rOut.violations, 0);
  assert.ok(rOut.orderAssertions.length >= 1, "ruling doc must contain the quoted order assertion");
  assert.equal(rOut.hasPairOutput, true);

  // The task body itself also quotes the incident and carries the pair-output fact.
  const task = run("--judge", "tasks/gap-drive-text-carries-data-not-behavior-outer-inner-handoff.md", "--json");
  assert.equal(task.status, 0, `task body must be clean by position, got ${task.status}:\n${task.stdout}${task.stderr}`);
  assert.equal(JSON.parse(task.stdout).violations, 0);
});

test("AC3 default gate — the REAL repo's three normative drive docs pass (violations field = 0)", () => {
  const res = run("--json");
  assert.equal(res.status, 0, `real-repo gate must pass, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.mode, "drive-contract-docs");
  assert.equal(out.scanned, 3, `expected 3 normative docs scanned, got ${out.scanned}`);
  assert.equal(out.violations, 0, `expected 0 violations, got ${out.violations}`);
  assert.equal(out.ok, true);
});
