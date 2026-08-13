// @test-group engine
// outer-tick-log-check.test.mjs — gap-no-action-requires-evidence-mechanical-check: the outer's
// `no-action` verdict must carry evidence AND the checker is a RE-MEASURING JUDGE, not a line-format
// linter. Layers:
//   L1 行内自洽（始终）：no-action 行必须带五条读数且全假；任一 `[当前真` 或缺失 ⇒ FAIL。
//   L2 重新测量（仅当新鲜）：--truth 注入真值（测试接缝）；no-action 但实测任一为真 ⇒ FAIL；
//      动作类型（escalate/correct/unblock）但实测仍有真值且无 git 痕迹 ⇒ FAIL（欺骗输入）。
//   L3 新鲜度上界：行陈旧（mtime 超上界）⇒ 只判 L1，不重测 ⇒ 不因量变误报。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKER = join(import.meta.dirname, "..", "scripts", "outer-tick-log-check.sh");

function runChecker({ log, truth, freshMinutes, root, ageMinutes, logMtime }) {
  const dir = mkdtempSync(join(tmpdir(), "na-check-"));
  const logPath = join(dir, "tick-log.md");
  writeFileSync(logPath, log);
  // 若指定 ageMinutes：把 fixture 的 mtime 回拨，模拟「20 分钟前的行」。
  if (ageMinutes) spawnSync("touch", ["-d", `-${ageMinutes} minutes`, logPath], { encoding: "utf8" });
  // 若指定 logMtime（epoch 秒）：把 log mtime 固定到该时刻——L2 trace 窗口的 --until 锚点，
  // 使「证据提交时间」与「log 写入时间」可被 fixture 精确控制（无真实时间竞态）。
  if (logMtime) spawnSync("touch", ["-d", `@${logMtime}`, logPath], { encoding: "utf8" });
  const args = [CHECKER, "--log", logPath, "--json"];
  if (truth) args.push("--truth", truth);
  if (freshMinutes) args.push("--fresh-minutes", String(freshMinutes));
  if (root) args.push("--root", root);
  const r = spawnSync("bash", args, { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout.trim() };
}

// 构造一个真实 git 仓库，含一条提交时刻受控的空提交（act-then-log 的「证据提交」）。
function makeGitRepoWithCommit({ epoch }) {
  const dir = mkdtempSync(join(tmpdir(), "na-repo-"));
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: `@${epoch} +0000`,
    GIT_COMMITTER_DATE: `@${epoch} +0000`,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const git = (args) => spawnSync("git", args, { encoding: "utf8", cwd: dir, env });
  git(["init", "-q"]);
  git(["config", "commit.gpgsign", "false"]);
  const r = git(["commit", "--allow-empty", "-m", "evidence"]);
  if (r.status !== 0) throw new Error(`git commit failed: ${r.stderr}`);
  return dir;
}

const FIVE_FALSE = "①in_flight<cap且recommended非空→派发到cap [当前假:in_flight==cap]; ②pool<floor→晋级补池 [当前假:pool≥floor]; ③nyf>0且work落地→翻done [当前假:nyf=0]; ④integration领先develop且suite绿→批量合 [当前假:develop==integration]; ⑤suite red→分诊 [当前假:green]";

function row(verdict, ineq, extra = "") {
  return `- \`15:21Z\` \`tick\` — fixture（2026-08-13 锚点按现实改 bullet 形态）
- 类型: ${verdict}（测试）
${ineq ? `- 五条不等式: ${ineq}\n` : ""}${extra}- 动作分类: ${verdict}
`;
}

const NO_ROOT = "/tmp/nonexistent-outer-root";

// ── L1 行内自洽 ───────────────────────────────────────────────────────────────────────

test("AC2 — no-action 行缺五条读数 ⇒ FAIL", () => {
  const r = runChecker({ log: row("no-action", ""), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 1, `expect FAIL: ${r.stdout}`);
  assert.match(r.stdout, /no-inequality-evidence/);
});

test("AC2 — no-action 行带 ①真 ⇒ FAIL（L1 自洽）", () => {
  const ineq = "①in_flight<cap且recommended非空→派发到cap [当前真:recommended=[gap-x]]; ②pool<floor→晋级补池 [当前假]; ③nyf>0且work落地→翻done [当前假]; ④integration领先develop且suite绿→批量合 [当前假]; ⑤suite red→分诊 [当前假]";
  const r = runChecker({ log: row("no-action", ineq), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no-action-inequality-true/);
});

// ── L2 重新测量（--truth 接缝）────────────────────────────────────────────────────────

test("AC2 — 重新测量：no-action 行带全假读数但实测①真 ⇒ FAIL（读数撒谎/漏报）", () => {
  const r = runChecker({ log: row("no-action", FIVE_FALSE), truth: "10000", root: NO_ROOT });
  assert.equal(r.status, 1, `expect FAIL: ${r.stdout}`);
  assert.match(r.stdout, /no-action-but-remeasured-true/);
});

test("AC2 — 欺骗输入：escalate + 实测①真 + 无 git 痕迹 ⇒ FAIL（说动了却没动）", () => {
  const ineq = "①in_flight<cap且recommended非空→派发到cap [当前真:recommended=[gap-x]]; ②pool<floor→晋级补池 [当前假]; ③nyf>0且work落地→翻done [当前假]; ④integration领先develop且suite绿→批量合 [当前假]; ⑤suite red→分诊 [当前假]";
  // epoch=<ts> 让 trace 窗口起点可解析（锚定该 tick 起点）；root 指向不存在仓库 ⇒ git 失败
  // ⇒ TRACE_EMPTY ⇒ 仍 FAIL（欺骗输入不因窗口修正而漏网，AC3 不削弱）。
  const r = runChecker({ log: row("escalate", ineq, "- 做了什么: escalate（声称已派发）\n- epoch=1700000000\n"), truth: "10000", root: NO_ROOT });
  assert.equal(r.status, 1, `expect FAIL: ${r.stdout}`);
  assert.match(r.stdout, /action-claimed-but-no-git-trace/);
});

// ── AC3 合法路径不误报 ────────────────────────────────────────────────────────────────

test("AC3 — no-action + 五条全假 + 实测全假 ⇒ PASS", () => {
  const r = runChecker({ log: row("no-action", FIVE_FALSE), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 0, `expect PASS: ${r.stdout}`);
});

test("AC3 — escalate + 实测无真值（00000）+ 无痕迹 ⇒ PASS（无动作需要）", () => {
  const r = runChecker({ log: row("escalate", FIVE_FALSE), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 0);
});

test("AC3 — correct 行不误报", () => {
  const r = runChecker({ log: row("correct", "", "- 做了什么: 已派发 gap-install-config\n"), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 0);
});

test("AC3 — unblock 行不误报", () => {
  const r = runChecker({ log: row("unblock", ""), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 0);
});

// ── AC4 新鲜度上界 ───────────────────────────────────────────────────────────────────

test("AC4 — 陈旧行（mtime 超上界）+ 实测真值已变 ⇒ 不误报（只判 L1 自洽）", () => {
  // fixture mtime 回拨 20 分钟；fresh-minutes 10 ⇒ 行视为陈旧 ⇒ 跳过 L2 重测。
  const r = runChecker({ log: row("no-action", FIVE_FALSE), truth: "10000", freshMinutes: 10, root: NO_ROOT, ageMinutes: 20 });
  // fresh=0 ⇒ 不重测 ⇒ 即使 truth ①真也不报（自洽即过）。
  assert.equal(r.status, 0, `expect PASS (stale): ${r.stdout}`);
  assert.match(r.stdout, /"fresh":0/);
});

// ── 边界 ─────────────────────────────────────────────────────────────────────────────

test("AC2 — 日志缺失 NOT-EVALUATED（exit 0）——fresh worktree 合法缺 gitignored tick-log，不 FAIL", () => {
  const r = spawnSync("bash", [CHECKER, "--log", "/nonexistent/tick-log.md", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, `expect exit 0: ${r.stdout}`);
  assert.match(r.stdout, /no-log/);
  assert.match(r.stdout, /"evaluated":false/, "missing log must report evaluated:false (NOT-EVALUATED), not FAIL");
});

test("AC2 — 无 tick 段 fail-closed", () => {
  const r = runChecker({ log: "# 只有表头，无 ### tick 段\n", truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no-tick-section/);
});

// ── NOT-EVALUATED（manager 2026-08-13）：真实 tick-log 在 step 2 前无 `- 动作分类:` 行 ⇒
// ACTION 恒空 ⇒ 每条检查（L1/L2）都跳过。此时必须如实报 NOT-EVALUATED（exit 0，可区分于 PASS），
// 不得输出 "PASS / self-consistent"——一个结构上不可能报红的 checker 的绿与「一切正常」同形
// （硬规则 4），会把「没检查」伪装成「在检查」。step 2 的验收 = NOT-EVALUATED 从输出消失。──────
test("NOT-EVALUATED — 行无 `- 动作分类:` 字段 ⇒ 如实报 not-evaluated（exit 0），不是 PASS", () => {
  const r = runChecker({
    log: "- `15:21Z` `tick` — 无动作分类行的 fixture\n- 类型: no-action（测试）\n",
    truth: "00000",
    root: NO_ROOT,
  });
  assert.equal(r.status, 0, `expect exit 0: ${r.stdout}`);
  // runChecker uses --json; the NOT-EVALUATED JSON carries evaluated:false + reason:no-action-classification
  assert.match(r.stdout, /"evaluated":false/, "must report evaluated:false (not PASS), so the un-evaluated state is distinguishable");
  assert.match(r.stdout, /no-action-classification/, "the reason must name the un-classified action state");
  assert.doesNotMatch(r.stdout, /"checked":true/, "a checker that cannot parse ACTION must not print the PASS checked:true form");
});

// ── L2 trace 窗口锚定该 tick 起点（gap-outer-tick-log-check-trace-window-anchored-at-log-mtime）
// 旧代码窗口起点 = log mtime（--since=@<mtime>）：act-then-log 下证据提交严格在 log 前 ⇒ 永远在
// 窗外 ⇒ 动作行假红。新代码窗口 = [该 tick 起点, log 写入时刻]：证据必然落窗，log 后无关提交被
// --until 排除 ⇒ 任意时刻跑结果一致。以下 fixture 均为真实 git 仓库 + 受控提交时刻。────────────────

test("AC1/AC4 — 证据提交在 log 写入前 + 无后续提交 ⇒ PASS（不再假红）", () => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const evidenceEpoch = nowEpoch - 300;       // 动作行证据提交（act-then-log 的 act）
  const tickStartEpoch = evidenceEpoch - 60;  // 该 tick 起点（行内 epoch 锚定窗口起点）
  const repo = makeGitRepoWithCommit({ epoch: evidenceEpoch });
  const log = row("escalate", FIVE_FALSE, `- epoch=${tickStartEpoch}\n- 做了什么: escalate（证据提交在 log 前）\n`);
  const r = runChecker({ log, truth: "10000", root: repo, logMtime: nowEpoch });
  assert.equal(r.status, 0, `expect PASS (trace found in tick window): ${r.stdout}`);
  rmSync(repo, { recursive: true, force: true });
});

test("AC4 — 可复现：log 写入后无关提交落地，动作行结果不变（--until 锚定 log mtime）", () => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const evidenceEpoch = nowEpoch - 300;
  const tickStartEpoch = evidenceEpoch - 60;
  const repo = makeGitRepoWithCommit({ epoch: evidenceEpoch });
  // log 写入后的无关提交：旧代码会因它落入窗口而变绿（运气判据）；新代码 --until=@log mtime 排除。
  const laterEpoch = nowEpoch + 60;
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: `@${laterEpoch} +0000`,
    GIT_COMMITTER_DATE: `@${laterEpoch} +0000`,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  const later = spawnSync("git", ["commit", "--allow-empty", "-m", "later-unrelated"], { encoding: "utf8", cwd: repo, env });
  assert.equal(later.status, 0, `later commit failed: ${later.stderr}`);
  const log = row("escalate", FIVE_FALSE, `- epoch=${tickStartEpoch}\n`);
  const r = runChecker({ log, truth: "10000", root: repo, logMtime: nowEpoch });
  assert.equal(r.status, 0, `expect PASS (deterministic): ${r.stdout}`);
  rmSync(repo, { recursive: true, force: true });
});

test("AC3 — 欺骗输入：仓库有更早提交但本 tick 窗口内无 ⇒ 仍 FAIL（不削弱原判据）", () => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const oldCommitEpoch = nowEpoch - 7200;  // 2h 前提交，落在 tick 窗口外
  const tickStartEpoch = nowEpoch - 300;   // 本 tick 起点
  const repo = makeGitRepoWithCommit({ epoch: oldCommitEpoch });
  const log = row("escalate", FIVE_FALSE, `- epoch=${tickStartEpoch}\n- 做了什么: escalate（声称已派发但本 tick 无提交）\n`);
  const r = runChecker({ log, truth: "10000", root: repo, logMtime: nowEpoch });
  assert.equal(r.status, 1, `expect FAIL (deception caught): ${r.stdout}`);
  assert.match(r.stdout, /action-claimed-but-no-git-trace/);
  rmSync(repo, { recursive: true, force: true });
});

test("AC2 — 窗口回退：无 epoch= 时用上一 tick 表头锚定该 tick 起点 ⇒ PASS", () => {
  const nowMs = Date.now();
  const anchor = new Date(nowMs);
  anchor.setMinutes(anchor.getMinutes() - 2); // 上一 tick 表头 ≈ 2 分钟前
  const hh = String(anchor.getHours()).padStart(2, "0");
  const mm = String(anchor.getMinutes()).padStart(2, "0");
  const prevRow = `### ${hh}:${mm}Z\n- 类型: no-action（五条全假）\n- 五条不等式: ${FIVE_FALSE}\n- 动作分类: no-action\n`;
  const evidenceEpoch = Math.floor(nowMs / 1000) - 30; // 30s 前，必在 (表头-120s, log mtime) 内
  const repo = makeGitRepoWithCommit({ epoch: evidenceEpoch });
  const log = prevRow + row("escalate", FIVE_FALSE, "- 做了什么: escalate（证据在表头后）\n");
  const r = runChecker({ log, truth: "10000", root: repo, logMtime: Math.floor(nowMs / 1000) });
  assert.equal(r.status, 0, `expect PASS (prev-header anchored): ${r.stdout}`);
  rmSync(repo, { recursive: true, force: true });
});
