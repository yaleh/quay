// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 4/10 (10 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { EXEMPT_TEST, RETRY_EXEMPTION_WINDOW_MS_DEFAULT, after, appendOtherSuiteRed, assert, assertionSignaturesFromSuiteLog, backoffDelayMs, failingTestFilesFromSuiteLog, fs, isQuickDeath, judgeRetryExemption, makeRoot, markNeedsHuman, normalizeAssertionSignature, path, rmSafe, spawn, writeExemptionTask, writeFailingTest, writeSuiteRedLog } from "./helpers/worker-driver-fan-in-harness.mjs";

test("failingTestFilesFromSuiteLog — 绝对路径 __PERFILE__ 行也提取 repo-relative 失败测试（⛔ 只匹配相对路径 ⇒ 恒空）", (t) => {
  // gap-suite-failure-attribution-third-party-layout：绝对路径的 repo 根【由 root 给出】。生产里
  // measure-suite-reporter 发的是 full-path，而 suite 在任务 worktree 里跑、调用方手里是 worktree
  // root ⇒ 按前缀剥离。⛔ 旧实现改为按 `packages|plugin|experiments` 关键词猜后缀，那正是本任务修的
  // 缺陷（第三方布局恒不匹配）——所以本用例把 root 传进来，而不是留一个「无 root 也能猜」的假要求。
  const root = makeRoot("s04-abs");
  t.after(() => rmSafe(root));
  const abs = failingTestFilesFromSuiteLog(`__PERFILE__ duration_ms=10 ${root}/plugin/test/obs.test.mjs passed=false end_ms=1\n`, root);
  assert.deepEqual(abs, [EXEMPT_TEST], "absolute-path __PERFILE__ line extracts the repo-relative path");
  const rel = failingTestFilesFromSuiteLog("__PERFILE__ duration_ms=10 plugin/test/obs.test.mjs passed=false end_ms=1\n");
  assert.deepEqual(rel, [EXEMPT_TEST], "relative __PERFILE__ line still extracts (no regression)");
  // 无 root 的绝对路径 ⇒ 读不懂（独立取值），⛔ 不削成「看着像 repo-relative」的假路径冒充已归因。
  const noRoot = failingTestFilesFromSuiteLog(`__PERFILE__ duration_ms=10 ${root}/plugin/test/obs.test.mjs passed=false end_ms=1\n`);
  assert.deepEqual(noRoot, [], "无 root ⇒ 不冒充已归因");
});


test("assertionSignaturesFromSuiteLog — 提取并归一化 AssertionError 签名（[ERR_ASSERTION] 变体 + 空白折叠去重）", () => {
  const sigs = assertionSignaturesFromSuiteLog("  AssertionError [ERR_ASSERTION]: probe must be alive\n  AssertionError: probe   must   be   alive\n");
  assert.deepEqual(sigs, ["probe must be alive"], "normalized assertion signature extracted + deduped");
});


test("RETRY_EXEMPTION_WINDOW_MS_DEFAULT — 48h 窗口缺省（与提案 48h 复盘同窗）", () => {
  assert.equal(RETRY_EXEMPTION_WINDOW_MS_DEFAULT, 48 * 3600 * 1000, "48h default window");
});

// ── gap-retry-exemption-signature-keeps-volatile-values：签名归一化必须折易变量 ⛔ 不折身份 ──────────
// 根因：归一化只折叠空白 ⇒ pid / 毫秒 / 路径 / 哈希留在签名里 ⇒ 同一缺陷每次运行给出**新**签名 ⇒
// 「≥2 个不同任务命中同一签名」结构上永不成立 ⇒ 专为「不相关 flaky 不压垮受害任务」而造的豁免恒空。
// 本段是**双向控制**：①同一缺陷（易变量各异）跨 2 任务 ⇒ 必须豁免；②两个**不同**缺陷（易变量各异）
// ⇒ 必须仍计数。②是①的取假器——把归一化写过头的实现（例如抹掉整个签名）会让②立刻翻红。


test("AC3 (反向控制) — 两个【不同】缺陷（易变量各异）跨 2 任务 ⇒ 仍 own-defect-counted（⛔ 归一化过头即红）", (t) => {
  const root = makeRoot("exempt-volatile-ac3");
  t.after(() => rmSafe(root));
  writeExemptionTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  writeFailingTest(root, EXEMPT_TEST);
  const nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  // 缺陷 A 与缺陷 B：措辞不同（缺陷身份不同），但**都**带 pid/路径易变量——若归一化把量抹成恒等占位
  // 甚至抹掉整条签名，两条会并成同一签名 ⇒ 本条从 own-defect-counted 翻成 unrelated-flaky-exempt ⇒ 红。
  const defectA = "probe must be alive: pid=1234 at /home/yale/work/quay-worktrees/gap-a/plugin/test/obs.test.mjs";
  const defectB = "queue depth exceeded: pid=9999 at /home/yale/work/quay-worktrees/gap-b/plugin/test/obs.test.mjs";
  writeSuiteRedLog(root, "fan-in-suite-gap-a.log", EXEMPT_TEST, defectA);
  writeSuiteRedLog(root, "fan-in-suite-gap-b.log", EXEMPT_TEST, defectB);
  appendOtherSuiteRed(root, "gap-b", new Date(nowMs - 3600_000).toISOString(), "fan-in-suite-gap-b.log");

  assert.notEqual(
    normalizeAssertionSignature(defectA), normalizeAssertionSignature(defectB),
    "AC3 取假器：两个不同缺陷归一化后必须仍不同（相同 ⇒ 归一化把「不同」变成了「同一」）",
  );
  const j = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-a.log" } }, { nowMs });
  assert.equal(j.verdict, "own-defect-counted", "different defect ⇒ NOT exempt (count normally)");
  assert.deepEqual(j.recurredTasks, [], "no other task recurred this defect's signature");
});


test("AC2 (正控制) — 同一缺陷的易变量（pid/ms/路径）各异跨 2 任务 ⇒ unrelated-flaky-exempt（⛔ 改前 own-defect-counted）", (t) => {
  const root = makeRoot("exempt-volatile-ac2");
  t.after(() => rmSafe(root));
  writeExemptionTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  writeFailingTest(root, EXEMPT_TEST);
  const nowMs = Date.parse("2026-09-03T00:00:00.000Z");
  // 同一缺陷（driver-runtime AC4「未确认存活」）的两次运行：pid / 耗时 / 工作树路径全不同。
  // 这两条逐字取自 2026-09-13 现场 suite 日志（见任务体 AC1 读数），此处只换 worktree 路径段。
  const run1 = "未确认存活 ⇒ 非零退出：started: supervisor pid=955396 kind=promotion run_id=dr-ac4-short driver pid=955909 confirmed_ms=1044";
  const run2 = "未确认存活 ⇒ 非零退出：started: supervisor pid=2765126 kind=promotion run_id=dr-ac4-short driver pid=2765880 confirmed_ms=1045";
  writeSuiteRedLog(root, "fan-in-suite-gap-a.log", EXEMPT_TEST, run1);
  writeSuiteRedLog(root, "fan-in-suite-gap-b.log", EXEMPT_TEST, run2);
  appendOtherSuiteRed(root, "gap-b", new Date(nowMs - 3600_000).toISOString(), "fan-in-suite-gap-b.log");

  // 生产缺陷（driver-runtime AC4）在两次运行里逐字不同 ⇒ 改前这两条签名不相等（AC1 能取假读数）。
  assert.notEqual(run1, run2, "AC1 取假：同一缺陷的两次运行逐字不同");
  assert.equal(
    normalizeAssertionSignature(run1), normalizeAssertionSignature(run2),
    "AC2：同一缺陷的易变量折叠后必须相等",
  );
  const j = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-a.log" } }, { nowMs });
  assert.equal(j.verdict, "unrelated-flaky-exempt", "same defect (volatile values differ) across ≥2 tasks ⇒ exempt");
  assert.deepEqual(j.recurredTasks, ["gap-b"], "the other task that recurred the signature is named");
});


test("normalizeAssertionSignature — 折易变量（数字/哈希/绝对路径）∧ ⛔ 不折词内数字与措辞", () => {
  // 折：pid / 毫秒 / 端口 / 计数（数字 token）、sha、绝对路径。单位文本保留 ⇒ 数量变、签名不变。
  assert.equal(
    normalizeAssertionSignature("pid=955396 confirmed_ms=1044 at /home/yale/work/quay-worktrees/gap-x/plugin/test/obs.test.mjs"),
    "pid=<n> confirmed_ms=<n> at <path>",
  );
  assert.equal(normalizeAssertionSignature("probe 530ms port 34567"), "probe <n>ms port <n>");
  assert.equal(
    normalizeAssertionSignature("head 4f2a9c1b3d5e6f70819a2b3c4d5e6f708192a3b4"),
    "head <hex>",
  );
  // ⛔ 不折词内数字：`dr-ac4-short` 是**稳定**标识符，折掉它会把 ac4 与 ac7 两个不同用例并成同一签名。
  assert.equal(normalizeAssertionSignature("run_id=dr-ac4-short"), "run_id=dr-ac4-short");
  assert.notEqual(normalizeAssertionSignature("run_id=dr-ac4-short"), normalizeAssertionSignature("run_id=dr-ac7-short"));
  // ⛔ 不折普通英文词里恰好由 a–f 组成的字母（`defaced` 不是哈希）。
  assert.equal(normalizeAssertionSignature("defaced artifact"), "defaced artifact");
  // ⛔ 不折措辞：`AC1/AC2/AC3` 的斜杠不在词首，不当作路径。
  assert.equal(normalizeAssertionSignature("AC1/AC2/AC3 covered"), "AC1/AC2/AC3 covered");
});


test("DoD (落点映射·机械) — 签名归一化只有一个正本点：提取点/归一化点各一处，⛔ 不留第二份易变量清单", () => {
  // 把「唯一正本点」做成可执行判据（⛔ 不是散文承诺）：源码里出现第二处签名提取或第二处空白归一化
  // ⇒ 立刻红。这样「后来有人又在别处拼一份签名逻辑」是机械可见的，不靠记得。
  const src = fs.readFileSync(new URL("../scripts/worker-driver.ts", import.meta.url), "utf8");
  const count = (re) => (src.match(re) || []).length;
  assert.equal(count(/AssertionError\(\?:/g), 1, "断言签名的提取点只许有一处");
  assert.equal(count(/export function normalizeAssertionSignature\(/g), 1, "归一化函数只许定义一次");
  assert.equal(count(/\\s\+\/g/g), 1, "空白归一化只许在唯一正本点里做（第二处 = 第二份清单）");
  // 消费者：两个（跨任务复发扫描 + 判定入口），都经 assertionSignaturesFromSuiteLog 拿到已归一化签名。
  assert.equal(count(/assertionSignaturesFromSuiteLog\(/g), 3, "1 处定义 + 2 处消费者，全部经同一提取点");
});


test("AC4 (硬规则 3b) — 判不出（退化签名 / 无断言行 / suite log 读不到）⇒ insufficient-data-fallback，⛔ 不与豁免同形", (t) => {
  const root = makeRoot("exempt-volatile-ac4");
  t.after(() => rmSafe(root));
  writeExemptionTask(root, "gap-a", ["packages/quay/src/serve-dashboard.ts"]);
  writeFailingTest(root, EXEMPT_TEST);

  // ① 退化签名：折叠后连一个字母都不剩（`1 !== 2`）⇒ 在不同缺陷间恒等 ⇒ 不得当作身份 ⇒ 判不出。
  writeSuiteRedLog(root, "fan-in-suite-gap-degenerate.log", EXEMPT_TEST, "1 !== 2");
  const degenerate = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-degenerate.log" } });
  assert.equal(degenerate.verdict, "insufficient-data-fallback", "degenerate signature ⇒ insufficient-data-fallback");
  assert.notEqual(degenerate.verdict, "unrelated-flaky-exempt", "判不出 ≠ 判为无关（硬规则 3b）");

  // ② suite 日志里一条 AssertionError 都没有 ⇒ 判不出（⛔ 不伪造成「无复发」）。
  const p = path.join(root, ".quay", "fan-in-suite-gap-noassert.log");
  fs.writeFileSync(p, `__PERFILE__ duration_ms=10 ${EXEMPT_TEST} passed=false end_ms=1\n`, "utf8");
  const noAssert = judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "fan-in-suite-gap-noassert.log" } });
  assert.equal(noAssert.verdict, "insufficient-data-fallback", "no assertion line ⇒ insufficient-data-fallback");
  assert.notEqual(noAssert.verdict, "unrelated-flaky-exempt", "读不懂 ≠ 豁免");

  // ③ suite log 读不到 / outcome 缺字段 ⇒ 判不出。
  assert.equal(
    judgeRetryExemption(root, "gap-a", { mechanical_fan_in: { step: "suite", suiteLog: "no-such-log.log" } }).verdict,
    "insufficient-data-fallback", "unreadable suite log ⇒ insufficient-data-fallback");
  assert.equal(
    judgeRetryExemption(root, "gap-a", { final_state: "exited-not-landed" }).verdict,
    "insufficient-data-fallback", "outcome with no mechanical_fan_in ⇒ insufficient-data-fallback");

  // ④ 退化签名与好签名并存 ⇒ 好签名仍起作用（退化只被丢弃，不污染整条日志）。
  const mixedPath = path.join(root, ".quay", "fan-in-suite-gap-mixed.log");
  fs.writeFileSync(mixedPath,
    `__PERFILE__ duration_ms=10 ${EXEMPT_TEST} passed=false end_ms=1\n  AssertionError [ERR_ASSERTION]: 1 !== 2\n  AssertionError [ERR_ASSERTION]: probe must be alive\n`, "utf8");
  assert.deepEqual(assertionSignaturesFromSuiteLog(fs.readFileSync(mixedPath, "utf8")), ["probe must be alive"],
    "degenerate signature dropped, non-degenerate one kept");
});

// ── gap-worker-driver-selector-api-error-no-backoff：selector API 错误/快速死亡无退避 ───────────────
// 根因：worker-driver 对 selector API 错误 / fallback 失败的【快速死亡】（<60s 墙钟）无退避——17:22–17:56
// 两任务 54 次「worker exited with code 1」全部 <60s 快速重派，纯烧派发预算（subagent spawn 预算 / 会话累计）。
// 修法：worker <quickDeathMs 连续死亡 ≥backoffThreshold 次 ⇒ 对该 task 指数退避（backoffUntil，⛔ 不立即重派），
// 间隔随次数增长、封顶 maxBackoffMs；退避到上限（maxRetries，复用现有重试上限机制）⇒ markNeedsHuman。
// 退避状态按 task 记（⛔ 不全局）。⛔ 不修模型名（a7a507eab 已治「为什么 400」）。


test("AC1 pure (gap-worker-driver-selector-api-error-no-backoff) — isQuickDeath: failed/spawn-failed/killed + <quickDeathMs ⇒ 快速死亡；completed/exited-not-landed/timed-out 不算", () => {
  assert.equal(isQuickDeath("failed", 59_999), true, "failed + <60s ⇒ quick death");
  assert.equal(isQuickDeath("spawn-failed", 0), true, "spawn-failed ⇒ quick death");
  assert.equal(isQuickDeath("killed", 1000), true, "killed ⇒ quick death");
  assert.equal(isQuickDeath("failed", 60_000), false, "wall ≥ quickDeathMs ⇒ not quick death（⛔ 慢速失败不进快速死亡桶）");
  assert.equal(isQuickDeath("completed", 1000), false, "completed is never quick death");
  assert.equal(isQuickDeath("exited-not-landed", 1000), false, "exited-not-landed has its own retry-cap（⛔ 与既有机制重叠计数）");
  assert.equal(isQuickDeath("timed-out", 1000), false, "timed-out has its own semantics");
});


test("AC1 pure — backoffDelayMs 指数增长 + 封顶 maxBackoffMs（⛔ 无限增长 ⇒ 假）", () => {
  const cfg = { quickDeathMs: 60_000, backoffThreshold: 1, baseBackoffMs: 30_000, maxBackoffMs: 300_000 };
  assert.equal(backoffDelayMs(1, cfg), 30_000, "consecutive=1 (threshold=1) ⇒ base");
  assert.equal(backoffDelayMs(2, cfg), 60_000, "2nd ⇒ 2×base（随次数增长）");
  assert.equal(backoffDelayMs(3, cfg), 120_000, "3rd ⇒ 4×base");
  assert.equal(backoffDelayMs(4, cfg), 240_000, "4th ⇒ 8×base");
  assert.equal(backoffDelayMs(5, cfg), 300_000, "5th ⇒ capped at maxBackoffMs");
  assert.equal(backoffDelayMs(99, cfg), 300_000, "never grows past maxBackoffMs");
});
