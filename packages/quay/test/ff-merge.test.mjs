// @test-group engine
// ff-merge.test.mjs — direct-import unit coverage of `packages/quay/src/fan-in/ff-merge.ts`'s ff SOURCE
// resolver (gap-goal-branch-ff-merge-source-param). The 持锁段 as a whole is integration-tested via a
// CLI subprocess in `plugin/test/fan-in-ff-merge.test.mjs`; THIS file pins the one pure rule all four
// source call sites share (the `--source-ref` default/override), so a drift in that rule is caught
// without spawning git. The basename also follows the repo's `<source>.test.mjs` convention that
// `select-tests-for-touches.ts` pairs on (the older `fan-in-ff-merge.test.mjs` does not pair with
// `ff-merge.ts`, so it alone left the task-scoped selection thin).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sourceRefOf, cleanTreeCheck } from "../src/fan-in/ff-merge.ts";

test("sourceRefOf — absent/blank --source-ref falls back to the task branch; a ref or SHA overrides", () => {
  // Default (the existing task path, byte-for-byte unchanged): the task branch.
  assert.equal(sourceRefOf({ task: "t1" }), "refs/heads/task/t1", "absent --source-ref ⇒ task branch");
  assert.equal(sourceRefOf({ task: "t1", sourceRef: null }), "refs/heads/task/t1", "null ⇒ task branch");
  assert.equal(sourceRefOf({ task: "t1", sourceRef: "" }), "refs/heads/task/t1", "empty ⇒ task branch");
  assert.equal(sourceRefOf({ task: "t1", sourceRef: "   " }), "refs/heads/task/t1", "blank ⇒ task branch");
  // Override: an explicit ref or a raw commit SHA is used verbatim (trimmed).
  assert.equal(sourceRefOf({ task: "t1", sourceRef: "refs/heads/goal/g1" }), "refs/heads/goal/g1", "an explicit ref overrides");
  const sha = "a".repeat(40);
  assert.equal(sourceRefOf({ task: "t1", sourceRef: sha }), sha, "a raw merge-commit SHA overrides");
  assert.equal(sourceRefOf({ task: "t1", sourceRef: `  ${sha}  ` }), sha, "surrounding whitespace is trimmed");
});

// ── gap-goal-driver-hardcoded-120s-spawn-kill-preempts-record-timeout-and-orphans-goal-locks AC4 ──
// 一条孤儿 frontmatter-store 锁（`goals/<id>.lock`，由 withFileLock 写下、被 driver 的 SIGKILL 遗落）
// 是 quay 的运行产物（在 `quay-runtime-artifacts.txt` 里）⇒ cleanTreeCheck 必须放行，⛔ 不得挡住
// 每个任务的 fan-in ff。负控制：同一形状但路径【不在】manifest ⇒ 仍必须拒（证明放行来自 manifest 模式，
// 不是无条件放行）。真实 temp git 树 + 真跑 touches 判官（不是注入 seam）。
test("cleanTreeCheck — goals/<id>.lock 是 manifest 运行产物 ⇒ clean；非 manifest 的未跟踪文件仍拒", () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(testDir, "..", "..", "..");
  const scriptsDir = path.join(repoRoot, "plugin", "scripts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ff-clean-tree-"));
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
  const git = (...args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: gitEnv });
  try {
    assert.equal(git("init", "-b", "main").status, 0, "前置：temp git 根");
    fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
    // 一个非空的 ## Touches（判官的保守前置：无/空 Touches ⇒ 一律 NOT-BENIGN）。
    fs.writeFileSync(path.join(root, "tasks", "T-1.md"), "---\nid: T-1\n---\n## Touches\n- plugin/scripts/foo.ts\n", "utf8");
    // goals/ 里有一条 TRACKED 记录（生产里 goals/*.md 是数据）：⛔ 这不是装饰——git 把一个只含
    // 未跟踪文件的目录折叠成 `?? goals/`，而 manifest 模式 `goals/*.lock` 匹配的是**文件**形态
    // (`?? goals/AC-001.lock`)，即生产里 goals/*.md 已跟踪时的形态。不先提交它就测的是另一种形状。
    fs.mkdirSync(path.join(root, "goals"), { recursive: true });
    fs.writeFileSync(path.join(root, "goals", "GOAL-001.md"), "---\nid: GOAL-001\ntitle: t\nstatus: active\nkind: goal\norigin: t\n---\nbody\n", "utf8");
    assert.equal(git("add", "tasks/T-1.md", "goals/GOAL-001.md").status, 0, "前置：把任务文件与 goals 记录加进索引");
    assert.equal(git("commit", "--no-verify", "-q", "-m", "t").status, 0, "前置：提交（否则任务文件本身也是未跟踪脏路径）");

    // 正向：唯一未跟踪文件 = goals/AC-001.lock（manifest 模式 goals/*.lock）⇒ clean。
    fs.writeFileSync(path.join(root, "goals", "AC-001.lock"), "12345", "utf8");
    let r = cleanTreeCheck({ task: "T-1", scriptsDir }, root);
    assert.equal(r.ok, true, `goals/*.lock 是 manifest 运行产物 ⇒ 必须放行；实测拒因：${r.stderrLines.join(" | ")}`);

    // 负控制：同一内容、路径不在 manifest ⇒ 必须拒（否则「放行」只是无条件放行）。
    fs.rmSync(path.join(root, "goals", "AC-001.lock"));
    fs.writeFileSync(path.join(root, "residue.lock"), "12345", "utf8");
    r = cleanTreeCheck({ task: "T-1", scriptsDir }, root);
    assert.equal(r.ok, false, "非 manifest 的未跟踪文件必须仍然拒绝 ff");
    assert.ok(r.stderrLines.some((l) => l.includes("residue.lock")), `拒因须点名该路径；实测 ${r.stderrLines.join(" | ")}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
