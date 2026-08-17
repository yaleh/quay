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

// 时间鲁棒标签（2026-08-14, cc611891 同族第二处）：timestamp 子句（label ≤ mtime）让硬编码标签
// 跨天后变「未来」⇒ 所有 row() 默认 fixture 全红。默认标签 = fixture 创建时的 date -u HH:MM，
// 与 runChecker 写入的 mtime 同分钟 ⇒ label ≤ mtime 恒成立。需要历史标签的测试显式传 label。
function utcHHMM(d) {
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
// A23 融合防漏（orchestrator-tick-core.md:47）：A23（AC81 四判据核实）是写 B13 行的前置——B13 行
// 存在则同段必须带 A23 四判据输出行（含 A23 + 状态词），否则 tick-log 行不合法。默认 fixture 在
// 带 B13 时补一条 A23 输出行；要测「A23 缺失」的测试传 a23="" 显式移除。
const A23_OUTPUT_LINE = "A23 ① code=0 OK（四判据全真）+ ② code=0 OK";
function row(verdict, ineq, extra = "", label = `${utcHHMM(new Date())}Z`, a23 = A23_OUTPUT_LINE) {
  const ineqBlock = ineq ? `- 五条不等式: ${ineq}\n` : "";
  const a23Block = ineq && a23 ? `- ${a23}\n` : "";
  return `- \`${label}\` \`tick\` — fixture（2026-08-13 锚点按现实改 bullet 形态）
- 类型: ${verdict}（测试）
${ineqBlock}${a23Block}${extra}- 动作分类: ${verdict}
`;
}
// 历史标签（分钟前）——ageMinutes 回拨 mtime 的测试要配一个同样在过去的 label，否则
// label > 回拨后 mtime ⇒ future-label RED（不是测试想要的陈旧行语义）。
function pastLabel(minutesAgo) {
  return `${utcHHMM(new Date(Date.now() - minutesAgo * 60000))}Z`;
}
// 锚定到指定 epoch 的标签——logMtime 固定的测试用它，保证 label HH:MM == mtime HH:MM
// （无分钟边界竞态，2026-08-14）。
function labelAtEpoch(epochSecs) {
  return `${utcHHMM(new Date(epochSecs * 1000))}Z`;
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

// ── A23 融合防漏（gap-a23-ticklog-verify-and-cron-normalization 判据1）────────────────────────────
// A23（AC81 四判据核实）是写 B13 行的前置：B13 行存在而同段无 A23 四判据输出 ⇒ tick-log 行不合法
// （manager 01:5xZ 报 A23 连续 5 轮缺席无人可判）。输出行判定 = 含 A23 + 状态词（code=N/VIOLATED/
// OK/NOT-EVALUATED/CRITICAL），散文讨论 A23 而无产物不计。

test("AC2 — B13 行存在但同段无 A23 四判据输出 ⇒ RED (b13-without-a23-output)", () => {
  // 合法 all-five-false no-action + B13，但 a23="" 显式移除 A23 输出 ⇒ A23 缺失 ⇒ RED（缺失翻红样本）。
  const r = runChecker({ log: row("no-action", FIVE_FALSE, "", `${utcHHMM(new Date())}Z`, ""), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 1, `expect RED: ${r.stdout}`);
  assert.match(r.stdout, /b13-without-a23-output/);
});

test("AC3 — B13 行存在且同段带 A23 四判据输出 ⇒ green（A23 前置满足）", () => {
  // 控制：B13 带 A23 输出（row 默认补）⇒ 不触发 A23 缺失 ⇒ 其余合法 ⇒ PASS。
  const r = runChecker({ log: row("no-action", FIVE_FALSE), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 0, `expect PASS: ${r.stdout}`);
  assert.doesNotMatch(r.stdout, /b13-without-a23-output/);
});

test("AC3 — 无 B13 行 + 无 A23 行 ⇒ green（A23 检查只当 B13 存在时触发）", () => {
  // 无 B13（correct 行）⇒ A23 检查不触发；行其余合法 ⇒ PASS。
  const r = runChecker({ log: row("correct", "", "- 做了什么: 已派发 gap-install-config\n"), truth: "00000", root: NO_ROOT });
  assert.equal(r.status, 0, `expect PASS: ${r.stdout}`);
});

// ── AC4 新鲜度上界 ───────────────────────────────────────────────────────────────────

test("AC4 — 陈旧行（mtime 超上界）+ 实测真值已变 ⇒ 不误报（只判 L1 自洽）", () => {
  // fixture mtime 回拨 20 分钟；fresh-minutes 10 ⇒ 行视为陈旧 ⇒ 跳过 L2 重测。
  // label 必须同在过去（pastLabel(21) ≤ mtime(now-20min)），否则 future-label 抢跑（2026-08-14）。
  const r = runChecker({ log: row("no-action", FIVE_FALSE, "", pastLabel(21)), truth: "10000", freshMinutes: 10, root: NO_ROOT, ageMinutes: 20 });
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
    log: `- \`${utcHHMM(new Date())}Z\` \`tick\` — 无动作分类行的 fixture\n- 类型: no-action（测试）\n`,
    truth: "00000",
    root: NO_ROOT,
  });
  assert.equal(r.status, 0, `expect exit 0: ${r.stdout}`);
  // runChecker uses --json; the NOT-EVALUATED JSON carries evaluated:false + reason:no-action-classification
  assert.match(r.stdout, /"evaluated":false/, "must report evaluated:false (not PASS), so the un-evaluated state is distinguishable");
  assert.match(r.stdout, /no-action-classification/, "the reason must name the un-classified action state");
  assert.doesNotMatch(r.stdout, /"checked":true/, "a checker that cannot parse ACTION must not print the PASS checked:true form");
});

// ── 时间标签判据（manager 2026-08-13：产物，不靠「下次注意」——行为承诺实测寿命 2 行）────────────
// ① 标签单调不减；② 标签 ≤ 文件 mtime（标签不可能晚于其被写下的时刻）。防「估的标签」复发。
test("时间标签 future：标签晚于 mtime ⇒ RED（exit 1）", () => {
  // label 23:59 > mtime（固定 12:00，HH≥2 ⇒ 无跨日宽限）⇒ future。mtime 用 logMtime 固定：
  // 不用「now」——运行时刻 HH<2 时跨日宽限（mtime 00-01h 且标签 22-23h ⇒ 前一天）会吞掉 future
  // 判据，使本测试在凌晨恒失败（2026-08-14 实测，cc611891 同族）。固定 epoch 12:00 全时可复现。
  const noonEpoch = Math.floor(Date.UTC(2026, 7, 13, 12, 0, 0) / 1000);
  const r = runChecker({
    log: "- `23:59Z` `tick` — future label\n- 动作分类: no-action\n- 五条不等式: ①[当前假] ②[当前假] ③[当前假] ④[当前假] ⑤[当前假]\n- A23 ① code=0 OK（四判据全真）+ ② code=0 OK\n",
    truth: "00000",
    root: NO_ROOT,
    logMtime: noonEpoch,
  });
  assert.equal(r.status, 1, `expect RED: ${r.stdout}`);
  assert.match(r.stdout, /future-label/, "a label after the file mtime is a future/estimated label — must RED");
});

test("时间标签 非单调：上一段标签晚于本段 ⇒ RED（exit 1）", () => {
  // 两条标签 20:30（上一段）/20:20（本段）。mtime 固定到 21:30（晚于两条标签）⇒ future 判据
  // 不抢跑（运行时刻 01:2x 会让两条标签都 > mtime ⇒ future-label 先触发，测不到 non-monotonic，
  // 2026-08-14 实测）。固定 epoch 使 20:20 ≤ mtime 全时可复现，剩下 monotonic 判据独占。
  const lateEpoch = Math.floor(Date.UTC(2026, 7, 13, 21, 30, 0) / 1000);
  const r = runChecker({
    log: "- `20:30Z` `tick` — earlier（晚）\n- `20:20Z` `tick` — later（早于上一段）\n- 动作分类: no-action\n- 五条不等式: ①[当前假] ②[当前假] ③[当前假] ④[当前假] ⑤[当前假]\n- A23 ① code=0 OK（四判据全真）+ ② code=0 OK\n",
    truth: "00000",
    root: NO_ROOT,
    logMtime: lateEpoch,
  });
  assert.equal(r.status, 1, `expect RED: ${r.stdout}`);
  assert.match(r.stdout, /non-monotonic/, "labels going backwards in an append-only log must RED");
});

// ── 跨日宽限（gap-outer-tick-log-cross-midnight-monotonic）──────────────────────────────────
// 单调判据用裸 HH:MM 字符串比较：跨午夜（23:5x → 00:0x）时 23:57 > 00:04 ⇒ 假红。修复 = 对称
// future-label 的 :304 逻辑：PREV 22-23h 且 TICK 00-01h ⇒ 日期翻转（新一天），跳过 non-monotonic。
// future-label 已有跨日宽限而单调没有（硬规则 5b 形态：只修了被报的那一处）。以下 fixture 的
// mtime 均固定到 ≥ TICK 的时点（且 HH≥2 或同分钟），使 future 判据不抢跑、monotonic 判据独占。
test("时间标签 跨日：PREV 23:5x → TICK 00:0x ⇒ PASS（跨日宽限，不判 non-monotonic）", () => {
  // 跨午夜实证形状（2026-08-17 00:04Z）：上一段 23:57（前一天末条），本段 00:04（新一天首条）。
  // HH:MM 字符串 23:57 > 00:04，但这是日期翻转不是往回走 ⇒ 单调判据需跨日宽限。mtime 固定到
  // 00:30（≥ TICK 00:04）⇒ future 判据不抢跑；epoch 固定使运行时刻无关（2026-08-14 cc611891 同族）。
  const midnightEpoch = Math.floor(Date.UTC(2026, 7, 17, 0, 30, 0) / 1000);
  const r = runChecker({
    log: "- `23:57Z` `tick` — 前一天末条\n- `00:04Z` `tick` — 新一天首条\n- 动作分类: no-action\n- 五条不等式: ①[当前假] ②[当前假] ③[当前假] ④[当前假] ⑤[当前假]\n- A23 ① code=0 OK（四判据全真）+ ② code=0 OK\n",
    truth: "00000",
    root: NO_ROOT,
    logMtime: midnightEpoch,
  });
  assert.equal(r.status, 0, `expect PASS (cross-midnight tolerance): ${r.stdout}`);
  assert.doesNotMatch(r.stdout, /non-monotonic/, "23:5x → 00:0x is a date rollover, not a backwards step");
});

test("时间标签 跨日宽限取假：同一天深夜 23:58 → 23:57 反向 ⇒ 仍 RED（non-monotonic）", () => {
  // 两条标签都在 22-23h（同一天深夜）：PREV 23:58 > TICK 23:57 是同一天内往回走，跨日宽限
  // （要求 PREV 22-23h 且 TICK 00-01h）不得吞掉它——TICK 23:57 不在 00-01h ⇒ 判 non-monotonic。
  const lateEpoch = Math.floor(Date.UTC(2026, 7, 16, 23, 59, 0) / 1000);
  const r = runChecker({
    log: "- `23:58Z` `tick` — earlier（晚）\n- `23:57Z` `tick` — later（早于上一段）\n- 动作分类: no-action\n- 五条不等式: ①[当前假] ②[当前假] ③[当前假] ④[当前假] ⑤[当前假]\n- A23 ① code=0 OK（四判据全真）+ ② code=0 OK\n",
    truth: "00000",
    root: NO_ROOT,
    logMtime: lateEpoch,
  });
  assert.equal(r.status, 1, `expect RED: ${r.stdout}`);
  assert.match(r.stdout, /non-monotonic/, "same-day 23:58 → 23:57 backward must still RED");
});

test("时间标签 跨日宽限取假：同一天凌晨 00:57 → 00:04 反向 ⇒ 仍 RED（non-monotonic，HH=00 剥零取整）", () => {
  // 两条标签都在 00h（同一天凌晨）：PREV 00:57 > TICK 00:04 是同一天内往回走，跨日宽限（要求
  // PREV 22-23h）不得吞掉它——HH 剥前导零后取整（00 ⇒ 0），PREV_HH_INT=0 < 22 ⇒ 判 non-monotonic。
  const earlyEpoch = Math.floor(Date.UTC(2026, 7, 17, 1, 0, 0) / 1000);
  const r = runChecker({
    log: "- `00:57Z` `tick` — earlier（晚）\n- `00:04Z` `tick` — later（早于上一段）\n- 动作分类: no-action\n- 五条不等式: ①[当前假] ②[当前假] ③[当前假] ④[当前假] ⑤[当前假]\n- A23 ① code=0 OK（四判据全真）+ ② code=0 OK\n",
    truth: "00000",
    root: NO_ROOT,
    logMtime: earlyEpoch,
  });
  assert.equal(r.status, 1, `expect RED: ${r.stdout}`);
  assert.match(r.stdout, /non-monotonic/, "same-day 00:57 → 00:04 backward must still RED");
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
  // label 锚定 nowEpoch（与 logMtime 同分钟）⇒ 无分钟边界竞态（2026-08-14）。
  const log = row("escalate", FIVE_FALSE, `- epoch=${tickStartEpoch}\n- 做了什么: escalate（证据提交在 log 前）\n`, labelAtEpoch(nowEpoch));
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
  const log = row("escalate", FIVE_FALSE, `- epoch=${tickStartEpoch}\n`, labelAtEpoch(nowEpoch));
  const r = runChecker({ log, truth: "10000", root: repo, logMtime: nowEpoch });
  assert.equal(r.status, 0, `expect PASS (deterministic): ${r.stdout}`);
  rmSync(repo, { recursive: true, force: true });
});

test("AC3 — 欺骗输入：仓库有更早提交但本 tick 窗口内无 ⇒ 仍 FAIL（不削弱原判据）", () => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const oldCommitEpoch = nowEpoch - 7200;  // 2h 前提交，落在 tick 窗口外
  const tickStartEpoch = nowEpoch - 300;   // 本 tick 起点
  const repo = makeGitRepoWithCommit({ epoch: oldCommitEpoch });
  const log = row("escalate", FIVE_FALSE, `- epoch=${tickStartEpoch}\n- 做了什么: escalate（声称已派发但本 tick 无提交）\n`, labelAtEpoch(nowEpoch));
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
  const nowEpoch = Math.floor(nowMs / 1000);
  const log = prevRow + row("escalate", FIVE_FALSE, "- 做了什么: escalate（证据在表头后）\n", labelAtEpoch(nowEpoch));
  const r = runChecker({ log, truth: "10000", root: repo, logMtime: nowEpoch });
  assert.equal(r.status, 0, `expect PASS (prev-header anchored): ${r.stdout}`);
  rmSync(repo, { recursive: true, force: true });
});

// ── 监控 tick 豁免（gap-outer-tick-log-l2-monitoring-tick-false-red）────────────────────────
// 纯监控 tick（在飞=cap、无晋升、无派发、无新立案）按构造无 develop commit——它的「动作」就是读数
// 本身（A22/A23/B13），tick-log 是 gitignored ⇒ L2 看不到。修法（方向 A）：checker 识别「本窗口无
// commit 但 tick-log 行自带完整读数举证（B13 + A22 + A23）」为合法监控 tick ⇒ 不报
// action-claimed-but-no-git-trace。⛔ 不压布尔（不是「无 commit 就豁免」）：无读数举证仍报（AC2），
// 且豁免只给 correct——escalate/unblock 声称具体动作，即使带读数也必须留 git 痕迹。
const MONITOR_INEQ = "①in_flight<cap且recommended非空→派发到cap [当前假:in_flight==cap]; ②pool<floor→晋级补池 [当前真:pool<floor 供给侧 A22 promotions=[]]; ③nyf>0且work落地→翻done [当前假]; ④integration领先develop且suite绿→批量合 [当前假]; ⑤suite red→分诊 [当前假]";
// 完整读数举证行（extra）：A22 ready-pool 读数 + epoch 锚定该 tick 起点。
const MONITOR_READINGS = (tickStartEpoch) => `- A22 --apply pool=10 floor=20 deficit=10 promotions=[]\n- epoch=${tickStartEpoch}\n- 做了什么: 纯监控（在飞=cap、无晋升、无派发）\n`;

test("AC1 — 监控 tick（correct + 完整读数 + 窗口无 commit）⇒ PASS，不报 action-claimed-but-no-git-trace", () => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const tickStartEpoch = nowEpoch - 300;       // 该 tick 起点
  const oldCommitEpoch = nowEpoch - 7200;      // 窗口外提交（2h 前）⇒ TRACE_EMPTY
  const repo = makeGitRepoWithCommit({ epoch: oldCommitEpoch });
  // B13（row ineq）+ A23（row 默认补）+ A22（extra 显式加）= 完整读数举证
  const log = row("correct", MONITOR_INEQ, MONITOR_READINGS(tickStartEpoch), labelAtEpoch(nowEpoch));
  const r = runChecker({ log, truth: "01000", root: repo, logMtime: nowEpoch });
  assert.equal(r.status, 0, `expect PASS (monitoring tick): ${r.stdout}`);
  assert.doesNotMatch(r.stdout, /action-claimed-but-no-git-trace/, "monitoring tick must not be flagged as claimed-action-without-trace");
  assert.match(r.stdout, /"monitoring":1/, "PASS must report the monitoring exemption");
  rmSync(repo, { recursive: true, force: true });
});

test("AC2 — 假 correct（判词 correct 但无读数行、无 commit）⇒ 仍 FAIL（防欺骗保留）", () => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const tickStartEpoch = nowEpoch - 300;
  const oldCommitEpoch = nowEpoch - 7200;
  const repo = makeGitRepoWithCommit({ epoch: oldCommitEpoch });
  // ineq="" ⇒ 无 B13、row 不补 A23 ⇒ 无读数举证 ⇒ 非监控 tick ⇒ 仍判欺骗（⛔ 豁免不压布尔）。
  const log = row("correct", "", `- epoch=${tickStartEpoch}\n- 做了什么: correct（声称已修正但本 tick 无提交、无读数）\n`, labelAtEpoch(nowEpoch));
  const r = runChecker({ log, truth: "10000", root: repo, logMtime: nowEpoch });
  assert.equal(r.status, 1, `expect FAIL (deception caught): ${r.stdout}`);
  assert.match(r.stdout, /action-claimed-but-no-git-trace/, "correct without readings evidence must still FAIL");
  rmSync(repo, { recursive: true, force: true });
});

test("AC3 — 豁免不压布尔：escalate + 完整读数 + 窗口无 commit ⇒ 仍 FAIL（豁免只给 correct）", () => {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const tickStartEpoch = nowEpoch - 300;
  const oldCommitEpoch = nowEpoch - 7200;
  const repo = makeGitRepoWithCommit({ epoch: oldCommitEpoch });
  // escalate 声称具体动作（升级/派发），即使带读数也必须留 git 痕迹——豁免只给 correct 监控 tick。
  const log = row("escalate", MONITOR_INEQ, MONITOR_READINGS(tickStartEpoch), labelAtEpoch(nowEpoch));
  const r = runChecker({ log, truth: "01000", root: repo, logMtime: nowEpoch });
  assert.equal(r.status, 1, `expect FAIL (escalate not exempted): ${r.stdout}`);
  assert.match(r.stdout, /action-claimed-but-no-git-trace/, "escalate is a claimed specific action — readings alone must not exempt it");
  rmSync(repo, { recursive: true, force: true });
});
