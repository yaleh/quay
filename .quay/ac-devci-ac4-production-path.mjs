// ac-devci-ac4-production-path.mjs — tasks/gap-develop-ci-first-decisive-green AC4 取证。
//
// ⛔ 这不是「手工 node 跑采集器 CLI 再把一行贴进载体」——那正是 AC4 排除的形态。
// 本脚本跑的是**生产调用路径本身**：runGoalRound()（goal-driver 的每轮入口）→ 它内部的
// ciRuns 采集步 → ci-runs-collect 的 collectForRound() → 真 gh → writeCarrier()。
// 载体记录由那条路径写出，不是本脚本拼的。
//
// 根用一次性夹具（不扰动共享检出的 .quay/），但**每一步都是生产实现**：
//   · 夹具 root 有真的 `origin` remote（指向本项目的 GitHub 仓库）⇒ repoFromRemote 解析得出
//   · 夹具 root 的 plugin/scripts/drivers.yml 置位 ci_runs_collect: true ⇒ goalCiRunsCollect 读到 true
//   · 除 gaps spawn / 充分性 / 业务目标三层判官用 `true` / 空数组关掉（它们与本 AC 无关且要 LLM）外，
//     没有注入任何 seam —— ⛔ 没有 ciRunsCollectFn，采集走的就是默认实现。
//
// 跑法（worktree 根，Node 直接跑 .mjs）：
//   node .quay/ac-devci-ac4-production-path.mjs <quay-code-root>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const codeRoot = process.argv[2];
if (!codeRoot) {
  console.error("用法: node ac-devci-ac4-production-path.mjs <quay-code-root>");
  process.exit(2);
}

const { runGoalRound } = await import(path.join(codeRoot, "plugin/scripts/goal-driver.ts"));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "devci-ac4-"));
const say = (s) => process.stdout.write(s + "\n");

function writeGoal({ id, status, kind, goal, criterion }) {
  const lines = ["---", `id: ${id}`, "title: t", `status: ${status}`, `kind: ${kind}`];
  if (goal) lines.push(`goal: ${goal}`);
  if (criterion !== undefined) lines.push("criterion: |", `  ${criterion}`);
  lines.push("origin: ac4 fixture", "---", "", "## body", "x", "");
  fs.writeFileSync(path.join(tmp, "goals", `${id}-t.md`), lines.join("\n"), "utf8");
}

try {
  fs.mkdirSync(path.join(tmp, "goals"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "plugin", "scripts"), { recursive: true });
  writeGoal({ id: "GOAL-001", status: "active", kind: "goal" });
  writeGoal({ id: "AC-001", status: "active", kind: "criterion", goal: "GOAL-001", criterion: "true" });

  // 真 origin remote ⇒ repoFromRemote(root) 解析得出 owner/name。
  const git = (args) => spawnSync("git", ["-C", tmp, ...args], { encoding: "utf8" });
  git(["init", "-q"]);
  git(["remote", "add", "origin", "https://github.com/yaleh/quay"]);

  // 生产开关真源：drivers.yml 的 kinds.goal.ci_runs_collect。
  fs.writeFileSync(
    path.join(tmp, "plugin", "scripts", "drivers.yml"),
    "version: 1\nkinds:\n  goal:\n    ci_runs_collect: true\n",
    "utf8",
  );

  const t0 = Date.now();
  const { fact } = await runGoalRound(tmp, {
    scriptRoot: codeRoot,
    gapWorkerCmd: "true", // 不 spawn LLM（与本 AC 无关）
    resourceGateArgv: ["true"],
    sufficiencyCmd: [], // ⇒ not-evaluated（不可用），不 spawn 判官
    objectiveCmd: [],
    ciRunsThrottleMs: 0, // 首轮必采（生产节流缺省 10 分钟）
  });
  const wall = Date.now() - t0;

  say(`root=${tmp}`);
  say(`wall_ms=${wall}`);
  say(`round.fact.state=${fact.state}`);
  say(`round.fact.value.ciRuns=${JSON.stringify(fact.value.ciRuns, null, 1)}`);
  say(`round.fact.reason 含调用痕: ${/ciRuns=/.test(fact.reason)}`);
  say(`  reason=${fact.reason.split("frozenSweep")[0]}frozenSweep…`);

  const carrier = path.join(tmp, ".quay", "ci-runs.jsonl");
  say(`carrier_exists=${fs.existsSync(carrier)} path=${carrier}`);
  if (fs.existsSync(carrier)) {
    const lines = fs.readFileSync(carrier, "utf8").trim().split("\n").filter(Boolean);
    say(`carrier_lines=${lines.length}`);
    say(`carrier_first=${lines[0]}`);
    // 落痕：把这条由生产路径写出的记录存到 worktree 的 .quay/ 下作为证据副本。
    fs.writeFileSync(path.join(codeRoot, ".quay", "ac-devci-ac4-carrier-written-by-round.jsonl"), lines.join("\n") + "\n", "utf8");
    say("copied -> .quay/ac-devci-ac4-carrier-written-by-round.jsonl");
  }
  const state = path.join(tmp, ".quay", "ci-runs-collect-state.json");
  say(`state_exists=${fs.existsSync(state)} state=${fs.existsSync(state) ? fs.readFileSync(state, "utf8").trim() : "-"}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
