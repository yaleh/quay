// @test-group engine
// ac-shortcircuit-develop-worktree-union.test.mjs — AC-218 (GOAL-011 退出条件①的后半):
// acShortCircuitVerdict 判 develop ref ∪ worktree 副本的并集。刚勾完但还没来得及 ff 到 develop 的 AC
// （field-aware commitTaskWrite 落地后,非 task/* 分支的纯 AC 写不再 ff develop；task/* 分支写本就落
// 任务分支）只存在于其中一侧、另一侧仍陈旧时,短路判定必须能看到【任一侧】全勾 —— 否则重演 2026-09-07
// 事故:ABI 勾满 8 条 AC 落 develop、worktree 副本仍 0/8 ⇒ 误判 exited-not-landed 烧 45 分钟。
//
// Run: node --experimental-strip-types --test plugin/test/ac-shortcircuit-develop-worktree-union.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { acShortCircuitVerdict } from "../scripts/worker-driver.ts";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** A task body whose AC lines are either all-checked or all-unchecked (DoD stays checked — a landed
 *  task's DoD is its own closeout, the AC is the field under test). */
function taskBody(checked) {
  return [
    "---", "id: gap-x", "title: union", "status: ready", "labels: []", "extra: {}", "---",
    "## Proposal", "prose", "## Plan", "plan",
    "## Touches", "- docs/feature.md",
    "## Acceptance Criteria",
    checked ? "- [x] AC1 done" : "- [ ] AC1 todo",
    checked ? "- [x] AC2 done" : "- [ ] AC2 todo",
    "## Definition of Done", "- [x] landed", "",
  ].join("\n");
}

/** A disposable git repo whose `develop` branch carries one version of the task body and whose
 *  working-tree copy carries (possibly) another — the exact "one side stale" split the union exists
 *  to see through. The working tree is the repo root itself (acShortCircuitVerdict reads
 *  `<worktree>/tasks/<id>.md` and `git -C <worktree> show develop:tasks/<id>.md`). */
function makeRepo({ developChecked, worktreeChecked }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acsc-union-"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test"]);
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", "gap-x.md"), taskBody(developChecked), "utf8");
  execFileSync("git", ["-C", root, "add", "tasks/gap-x.md"]);
  execFileSync("git", ["-C", root, "commit", "-q", "--no-verify", "-m", "develop state"]);
  execFileSync("git", ["-C", root, "branch", "-M", "develop"]);
  if (worktreeChecked !== developChecked) {
    fs.writeFileSync(path.join(root, "tasks", "gap-x.md"), taskBody(worktreeChecked), "utf8");
  }
  return root;
}

test("AC-218 union: AC ticks only on the develop ref (worktree copy stale) ⇒ shortCircuit:false", () => {
  const root = makeRepo({ developChecked: true, worktreeChecked: false });
  try {
    const v = acShortCircuitVerdict(root, "gap-x");
    assert.equal(v.shortCircuit, false, "develop ref carries all-checked ⇒ union must NOT short-circuit");
    assert.equal(v.reason, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC-218 union: AC ticks only in the worktree copy (develop ref stale) ⇒ shortCircuit:false", () => {
  const root = makeRepo({ developChecked: false, worktreeChecked: true });
  try {
    const v = acShortCircuitVerdict(root, "gap-x");
    assert.equal(v.shortCircuit, false, "worktree copy carries all-checked ⇒ union must NOT short-circuit");
    assert.equal(v.reason, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC-218 union negative control: neither develop nor worktree all-checked ⇒ shortCircuit:true", () => {
  const root = makeRepo({ developChecked: false, worktreeChecked: false });
  try {
    const v = acShortCircuitVerdict(root, "gap-x");
    assert.equal(v.shortCircuit, true, "neither source all-checked ⇒ union must still short-circuit (fail-closed, not weakened)");
    assert.match(v.reason, /AC 未全勾/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
