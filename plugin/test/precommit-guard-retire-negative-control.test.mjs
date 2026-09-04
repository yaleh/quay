// @test-group engine
// precommit-guard-retire-negative-control.test.mjs — AC64 ② 退役的负控制 fixture
// (gap-ac64-precommit-guard-clause2-retire).
//
// ② 拒绝「轮 running 且触及断言面」的写入（覆盖全部写入者）已退役（AC64 2026-08-14）：
//   它保护的危险随 AC42 结构性消失——per-task suite 跑在各自 worktree、读 worktree 的文件副本，
//   改共享检出的 develop 完全不影响正在跑的 worktree suite（退役条款 + 三条立条教训 →
//   orchestration/archive/AC58-retired-clauses.md#R27）。
//
// 这条 fixture 是【负控制】：它钉死「② 不再生效」——【曾经会被 ② 拒的写入形状】现在必须放行。
// 判据：guard 现在只做 ① 文档类检查（AC51 断言面拆分），不再读 .quay/full-suite-state.json、
// 不再有 fail-loud、不再写拒绝台账。
//
// Coverage map（对 AC64 判据的负控制配对）：
//   AC1（② 退役）—— running round + 断言面类文件（tasks/**）提交 ⇒ ALLOW（曾拒）。
//   AC2（fail-loud 退役）—— 无 state 文件 ⇒ ALLOW（曾拒 state-file-missing）。
//   AC3（不再写拒绝台账）—— 一次曾触 ② 的提交不产生 .quay/precommit-guard-rejections.jsonl。
//   AC4（① 保留）—— 文档类检查失败仍拒（doc-check-failed）——② 退役不带走 ①。
//
// Run: scripts/test.sh plugin/test/precommit-guard-retire-negative-control.test.mjs
// Scoped: scripts/test.sh --for-task gap-ac64-precommit-guard-clause2-retire

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(REPO_ROOT, "plugin", "scripts", "precommit-guard.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function run(cmd, args, cwd, env = {}) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}

function makeGitRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pcg64-"));
  run("git", ["init", "-q", "-b", "main"], root);
  run("git", ["config", "user.email", "test@test"], root);
  run("git", ["config", "user.name", "test"], root);
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "hello\n", "utf8");
  fs.writeFileSync(path.join(root, "tasks", "existing.md"), "x\n", "utf8");
  const init = run("git", ["add", "."], root);
  assert.equal(init.status, 0, "git add init");
  const commit = run("git", ["commit", "-q", "-m", "init"], root);
  assert.equal(commit.status, 0, `git commit init: ${commit.stderr}`);
  return root;
}

/** 一个 running 轮的 state 文件（② 当年读它做轮窗口判定；AC64 后 guard 不读它）。 */
const RUNNING_STATE = {
  state: "running",
  runner: "inner",
  startedAt: "2026-08-12T21:00:00.000Z",
  laneCount: 4,
  scope: "worktree",
  runId: "fixture-run-63",
  pid: 12345,
  finishedAt: null,
  durationMs: null,
};

function writeState(root, state) {
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify(state), "utf8");
}

function stage(root, rel, content = "new\n") {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  const add = run("git", ["add", rel], root);
  assert.equal(add.status, 0, `git add ${rel}`);
}

function runGuard(root, args = [], env = {}) {
  return run("node", ["--no-warnings", "--experimental-strip-types", GUARD, "--root", root, "--json", ...args], root, env);
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── AC64 负控制：② 退役 ⇒ 曾拒的写入形状现在放行 ────────────────────────────────────────────────────

test("AC64 — ② retired: a running round + a tasks/** commit (the exact shape ② used to reject) is now ALLOWED", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE); // a round IS running (runId fixture-run-63)
    stage(root, "tasks/gap-some-body-update.md"); // ② 's round-63 shape: inner commits a task file
    const res = runGuard(root);
    assert.equal(res.status, 0, `② must be retired — running round + task file must ALLOW, got ${res.status}: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.verdict, "allow");
    assert.equal(out.reason, "doc-checks-pass");
  } finally {
    cleanup(root);
  }
});

test("AC64 — ② retired: fail-loud is gone — a MISSING state file now ALLOWS (was state-file-missing reject)", () => {
  const root = makeGitRepo();
  try {
    // no .quay/full-suite-state.json at all — ② 's fail-loud used to reject this
    stage(root, "tasks/new.md", "body\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `missing state must ALLOW after ② retirement, got ${res.status}: ${res.stdout}`);
    assert.equal(JSON.parse(res.stdout).reason, "doc-checks-pass");
  } finally {
    cleanup(root);
  }
});

test("AC64 — ② retired: no rejection ledger is written (the reject path is gone)", () => {
  const root = makeGitRepo();
  try {
    writeState(root, RUNNING_STATE);
    stage(root, "tasks/new.md", "body\n");
    const res = runGuard(root);
    assert.equal(res.status, 0, `guard must allow, got ${res.status}`);
    const ledgerPath = path.join(root, ".quay", "precommit-guard-rejections.jsonl");
    assert.ok(!fs.existsSync(ledgerPath), "no precommit-guard-rejections.jsonl is written (② reject path removed)");
  } finally {
    cleanup(root);
  }
});

// ── AC64 正对照：① 保留不动 —— 文档类检查仍是唯一闸门 ───────────────────────────────────────────────

// A quay-shaped fixture whose run_doc_checks() fails (fake-doc-check exits 1).
function makeFailingDocFixture() {
  const root = makeGitRepo();
  const scriptsDir = path.join(root, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptsDir, "test.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"',
      "run_doc_checks() {",
      "  echo '== doc-class fixture =='",
      "  # @static-class doc",
      "  # @static-object orchestration/manager-tick-core.md CLAUDE.md",
      '  bash "${repo_root}/plugin/scripts/fake-doc-check.sh" "${repo_root}"',
      "}",
      'if [ "${1:-}" = "--static-checks-doc" ]; then',
      "  run_doc_checks",
      "  exit 0",
      "fi",
      "",
    ].join("\n"),
    "utf8",
  );
  const pkgDir = path.join(root, "plugin", "scripts");
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, "fake-doc-check.sh"), "#!/usr/bin/env bash\nexit 1\n", "utf8");
  return root;
}

test("AC64 — ① preserved: a FAILING doc check still rejects (② retirement does not take away ①)", () => {
  const root = makeFailingDocFixture();
  try {
    writeState(root, RUNNING_STATE); // even with a running round, the doc gate is the gate
    stage(root, "README.md", "changed\n");
    const res = runGuard(root);
    assert.equal(res.status, 1, `doc-check failure must still reject, got ${res.status}`);
    assert.equal(JSON.parse(res.stdout).reason, "doc-check-failed");
  } finally {
    cleanup(root);
  }
});

// ── Real-repo smoke: the guard runs against THIS repo without crashing ───────────────────────────────

test("real-repo smoke — the retired guard runs against the real repo (no crash, readable verdict)", () => {
  const res = runGuard(REPO_ROOT);
  assert.notEqual(res.status, 2, `guard must not crash on the real repo: ${res.stderr} ${res.stdout}`);
  const out = JSON.parse(res.stdout);
  assert.ok(["allow", "reject"].includes(out.verdict), "verdict is allow or reject");
});
