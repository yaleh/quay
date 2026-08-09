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

function runChecker({ log, truth, freshMinutes, root, ageMinutes }) {
  const dir = mkdtempSync(join(tmpdir(), "na-check-"));
  const logPath = join(dir, "tick-log.md");
  writeFileSync(logPath, log);
  // 若指定 ageMinutes：把 fixture 的 mtime 回拨，模拟「20 分钟前的行」。
  if (ageMinutes) spawnSync("touch", ["-d", `-${ageMinutes} minutes`, logPath], { encoding: "utf8" });
  const args = [CHECKER, "--log", logPath, "--json"];
  if (truth) args.push("--truth", truth);
  if (freshMinutes) args.push("--fresh-minutes", String(freshMinutes));
  if (root) args.push("--root", root);
  const r = spawnSync("bash", args, { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout.trim() };
}

const FIVE_FALSE = "①in_flight<cap且recommended非空→派发到cap [当前假:in_flight==cap]; ②pool<floor→晋级补池 [当前假:pool≥floor]; ③nyf>0且work落地→翻done [当前假:nyf=0]; ④integration领先develop且suite绿→批量合 [当前假:develop==integration]; ⑤suite red→分诊 [当前假:green]";

function row(verdict, ineq, extra = "") {
  return `### 15:21Z
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
  const r = runChecker({ log: row("escalate", ineq, "- 做了什么: escalate（声称已派发）\n"), truth: "10000", root: NO_ROOT });
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

test("AC2 — 日志缺失 fail-closed", () => {
  const r = spawnSync("bash", [CHECKER, "--log", "/nonexistent/tick-log.md", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no-log/);
});

test("AC2 — 无 tick 段 fail-closed", () => {
  const r = runChecker({ log: "# 只有表头，无 ### tick 段\n", truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no-tick-section/);
});
