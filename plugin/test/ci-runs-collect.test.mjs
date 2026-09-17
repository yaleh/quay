// ci-runs-collect.test.mjs — tasks/gap-develop-ci-first-decisive-green
//
// 本文件钉的是采集器**自己新增的那几条契约**（AC-265 的判据读的是 `.quay/ci-runs.jsonl` 这个本地载体，
// 而它此前那几件关键的事要么没做、要么做了但取不到假）：
//
//   ① testFiles **只在 --fetch-logs 时**派生 ⇒ 默认调用下所有记录都缺这个键，而 AC-265 的反作弊关系
//      （green 的 testFiles ≥ 紧邻前一次的 testFiles）**两边都要求整数** ⇒ 判据恒报 *-missing-testFiles。
//      ⇒ 现在对 decisive run（conclusion ∈ success|failure）**默认开**，cancelled 不开（占 develop run 的
//      ~43%，判据不读它们）。
//   ② 派生不出时**不写该键**（缺 ≠ 0），⛔ 不回落到一个常量 —— 恒值字段会让反作弊关系退化成恒等式
//      （硬规则 4）。本文件用「一份没有 __GROUP__ 行的日志」做**负控制**。
//   ③ 去重键是 workflow|runId 而 testFiles 是后派生的 ⇒ 纯追加路径**永远补不上**已落盘的那批记录
//      （实测：30 条 run 里 5 条派生成功、20 条被去重跳过，载体里 testFiles 计数 = 0）。
//      ⇒ 现在有「就地补全」，且**只**填缺失的 testFiles、其余字段逐字保留。
//   ④ gh 不可达必须**可区分**（硬规则 3b）：driver 的 PATH 不保证含 ~/.local/bin，而 gh 不可达若与
//      「CI 没有 run」同形，判据的 still-red 就是假读数。⇒ resolveGhBin 显式解析 + gh-unavailable 态。
//      ④b **「不可达」的模拟不得依赖宿主**（tasks/gap-ci-runs-collect-gh-fallback-defeats-unavailable-test）：
//      resolveGhBin 末尾四个硬编码绝对路径故意不受 env 覆盖 ⇒ 「把 env 覆写成 PATH=/nonexistent」
//      在装了系统级 gh 的机器上不成立（2026-09-16 CI run 35054411272 红在这里，实测 actual:'error'）。
//      ⇒ collectForRound 暴露 ghIsExec 测试缝；本文件另有一条 resolveGhBin 测试专门钉住那个根因。
//   ⑤ collectForRound 的节流是**一个读数**（throttled），不是静默跳过。
//   ⑥ seaVerify（AC-267 载体臂，tasks/gap-sea-artifact-plugin-root-toplevel-eval）：release workflow
//      的 SEA 验证 job 结论派生进记录，词表 {success, failure, incomplete, absent} —— **没有**
//      「读不懂 ⇒ success」的路径（硬规则 3b/4）。没有它，AC-267 永久停在 CAUSE=carrier-absent。
//   ⑦ prereqProvision（AC-282 载体臂，tasks/gap-ac282-runner-prereqs-already-present）：套件运行
//      前置在 **job 自己的日志** 里的预置状态（`__PREREQ__ <name>=<state>`），词表
//      `already-present | installed-apt | installed-pip | absent`。它只能从日志得到 —— `already-present`
//      与 `installed-apt` 的 step conclusion **都是 success**（jobs API 结构上不可派生）。
//      **缺 ≠ absent**：没拉日志 ⇒ 不写键；拉了但一条 marker 都没有 ⇒ 三键全 `absent`（独立取值）。
//      另有一条**闸门**测试：testFiles 已知的 run 仍会为 prereqProvision 拉日志（旧闸门只认
//      testFiles ⇒ 这类 run 的 prereqProvision 结构性不可派生，判据恒停 not-recorded）。
//   ⑧ seaVerify（AC-267 载体臂）—— 见下方 ⑧ 段的标题块。
//   ⑨ prereqProvision（AC-282 载体臂）—— 见下方 ⑨ 段的标题块。
//   ⑩ schedulerMs（AC-281 载体臂，tasks/gap-ac281-scheduler-ms-carrier-field）：**套件自身调度器**的
//      墙钟（`__OVERHEAD__ scheduler_ms=<n>`，`suite-scheduler.ts` 在队列排空那一刻打一次）。AC-281
//      原量的是 job 总墙钟（含 checkout / npm install / runner 收尾等 ≥27s 不可约开销 ⇒ 数学不可
//      达成），2026-09-17 人裁定改量这一个。⛔ 缺 ≠ 0：没拉日志 / 日志没有该行 ⇒ **不写这个键**。
//      另有一条**闸门**测试：testFiles 与 prereqProvision 都已知的 run 仍会为 schedulerMs 拉日志
//      （漏掉第三个闸门 ⇒ 这类 run 的 schedulerMs 结构性不可派生，AC-281 恒停 not-recorded）。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRecord,
  collect,
  collectForRound,
  derivePrereqProvision,
  deriveSchedulerMs,
  deriveTestFilesFromLog,
  knownPrereqRunsFromCarrier,
  knownSchedulerRunsFromCarrier,
  knownTestFilesFromCarrier,
  resolveGhBin,
  writeCarrier,
} from "../scripts/ci-runs-collect.ts";

// R6 carrier-array cleanup：每个 mkdtemp 目录都被跟踪并在跑完后删除（不留 tmp 泄漏）。
const _createdDirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `crc-${prefix}-`));
  _createdDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const d of _createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** gh 形状的 run（离线缝喂给 collect，⛔ 不打网络）。 */
function ghRun(over = {}) {
  return {
    id: 1001,
    name: "CI",
    head_branch: "develop",
    status: "completed",
    conclusion: "failure",
    created_at: "2026-09-15T02:38:35Z",
    run_started_at: "2026-09-15T02:38:36Z",
    updated_at: "2026-09-15T02:56:47Z",
    html_url: "https://example.invalid/1001",
    ...over,
  };
}

/** 一份真实形状的 job（名字含 test ⇒ 命中日志拉取筛选）。 */
function ghJob(id = 55, name = "test", conclusion = "failure") {
  return {
    id,
    name,
    conclusion,
    started_at: "2026-09-15T02:38:40Z",
    completed_at: "2026-09-15T02:56:40Z",
    steps: [{ name: "Run tests", conclusion: "failure", number: 5 }],
  };
}

/** 一段含 `__GROUP__ … files=N` 的日志（真实形态；serial lane 的 files 更小，派生取最大值）。 */
const LOG_WITH_GROUPS =
  "__GROUP__ concurrency=1 files=14 sum_ms=249692 floor_ms=249692 capped=0\n" +
  "✔ some test (12ms)\n" +
  "__GROUP__ concurrency=8 files=631 sum_ms=6253419 floor_ms=781677.375 capped=0\n";

/** 一段**没有** `__GROUP__` 行的日志（2026-08-24 及更早的真实 run 就是这个形状）。 */
const LOG_WITHOUT_GROUPS = "2026-08-24T03:37:38.8118420Z Current runner version: '2.336.0'\nok 1 - something\n";

// ── ① 派生本身 ────────────────────────────────────────────────────────────────────────────────

test("deriveTestFilesFromLog — 取全部 __GROUP__ 行的最大值（serial lane 的 14 不会盖掉 631）", () => {
  assert.equal(deriveTestFilesFromLog(LOG_WITH_GROUPS), 631);
});

test("deriveTestFilesFromLog — 没有 __GROUP__ 行 ⇒ null（⛔ 不是 0，也不是任何常量）", () => {
  assert.equal(deriveTestFilesFromLog(LOG_WITHOUT_GROUPS), null);
  assert.equal(deriveTestFilesFromLog(""), null);
});

// ── ② testFiles 默认对 decisive run 开、对 cancelled 关 ────────────────────────────────────────

test("collect — 默认（不传 fetchLogs）对 conclusion=failure 的 run 就派生 testFiles", () => {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    if (args.includes("--allow-escape-sequences")) return LOG_WITH_GROUPS;
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  const { records } = collect({
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun()],
    jobsByRun: { "1001": [ghJob()] },
  });
  assert.equal(records[0].testFiles, 631, "默认就该派生出来（此前只有 --fetch-logs 才派生）");
  assert.ok(
    calls.some((c) => c.includes("--allow-escape-sequences")),
    "必须带 --allow-escape-sequences（省掉它恒取回 0 字节 ⇒ 永远派生不出）",
  );
});

test("collect — cancelled 的 run 默认【不】拉日志（判据不读 cancelled，占 develop run ~43%）", () => {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    return LOG_WITH_GROUPS;
  };
  const { records } = collect({
    repo: "o/n",
    run,
    limit: 2,
    runs: [ghRun({ id: 1, conclusion: "cancelled" }), ghRun({ id: 2, conclusion: "failure" })],
    jobsByRun: { "1": [ghJob(11)], "2": [ghJob(22)] },
  });
  assert.equal(records[0].conclusion, "cancelled");
  assert.equal(calls.length, 1, `只有那条 failure 该被拉日志，实际拉了 ${calls.length} 次`);
  assert.match(calls[0], /jobs\/22\/logs$/);
});

test("collect — logFetch:'none' 一条日志都不拉；logFetch:'all' 连 cancelled 也拉", () => {
  const mk = () => {
    const calls = [];
    return {
      calls,
      run: (args) => {
        calls.push(args.join(" "));
        return LOG_WITH_GROUPS;
      },
    };
  };
  const runs = [ghRun({ id: 1, conclusion: "cancelled" }), ghRun({ id: 2, conclusion: "failure" })];
  const jobsByRun = { "1": [ghJob(11)], "2": [ghJob(22)] };
  const a = mk();
  collect({ repo: "o/n", run: a.run, limit: 2, logFetch: "none", runs, jobsByRun });
  assert.equal(a.calls.length, 0);
  const b = mk();
  collect({ repo: "o/n", run: b.run, limit: 2, logFetch: "all", runs, jobsByRun });
  assert.equal(b.calls.length, 2, "all ⇒ cancelled 也拉");
});

// ── ③ 负控制：派生不出 ⇒ 键缺失（⛔ 不回落到常量）─────────────────────────────────────────────

test("负控制 — 日志缺 __GROUP__ 行 ⇒ 该记录【没有】testFiles 键，而不是某个常量", () => {
  const run = () => LOG_WITHOUT_GROUPS;
  const { records, warnings } = collect({
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun()],
    jobsByRun: { "1001": [ghJob()] },
  });
  assert.equal("testFiles" in records[0], false, "缺 ≠ 0：派生不出就不写这个键");
  assert.ok(
    warnings.some((w) => w.startsWith("testFiles-underivable:1001")),
    `派生不出必须留痕，实际 warnings=${JSON.stringify(warnings)}`,
  );
});

test("正控制（同一夹具）— 换回带 __GROUP__ 的日志 ⇒ 同一个位置出现整数 testFiles", () => {
  const run = () => LOG_WITH_GROUPS;
  const { records } = collect({
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun()],
    jobsByRun: { "1001": [ghJob()] },
  });
  assert.equal(records[0].testFiles, 631);
});

// ── ④ job 筛选与成本上界 ──────────────────────────────────────────────────────────────────────

test("collect — 只对名字含 test 的 job 拉日志（__GROUP__ 只在跑测试那个 job 的日志里）", () => {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    return LOG_WITH_GROUPS;
  };
  collect({
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun()],
    jobsByRun: { "1001": [ghJob(11, "version-consistency"), ghJob(22, "test"), ghJob(33, "dist-verify-node-floor")] },
  });
  assert.equal(calls.length, 1, `4 个 job 里只有 test 该被拉，实际 ${calls.length}`);
  assert.match(calls[0], /jobs\/22\/logs$/);
});

test("collect — job 名一个都不含 test ⇒ 退回全部 job（fail-soft，⛔ 不是判成没有 testFiles）", () => {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    return LOG_WITH_GROUPS;
  };
  const { records } = collect({
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun()],
    jobsByRun: { "1001": [ghJob(11, "build"), ghJob(22, "gate")] },
  });
  assert.equal(calls.length, 2, "命不中筛选 ⇒ 退回全部");
  assert.equal(records[0].testFiles, 631);
});

test("collect — maxLogRuns 是上界，超出【留痕】而不是静默少拉", () => {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    if (args.includes("--allow-escape-sequences")) return LOG_WITH_GROUPS;
    return "{}";
  };
  const runs = [ghRun({ id: 1 }), ghRun({ id: 2 })];
  const { warnings, logRunsFetched } = collect({
    repo: "o/n",
    run,
    limit: 2,
    maxLogRuns: 1,
    runs,
    jobsByRun: { "1": [ghJob(11)], "2": [ghJob(22)] },
  });
  assert.equal(logRunsFetched, 1);
  assert.ok(
    warnings.some((w) => w.startsWith("log-budget-exhausted:2")),
    `预算耗尽的 run 必须留痕，实际 ${JSON.stringify(warnings)}`,
  );
});

test("collect — 增量回填的成本上界：后派生量【全部】已知时才不拉日志（闸门由 testFiles 与另两个共同决定）", () => {
  // ⚠️ 本条断言的**契约变过两次**，两次都是「新增一个后派生量、忘了给它开闸门」这同一个形状：
  // ① tasks/gap-ac282-runner-prereqs-already-present §三.1 —— 原来只喂 knownTestFiles，闸门是
  //    `!alreadyKnown && …`：一条 testFiles 已派生过的 run **永远不再读日志** ⇒ 它的 prereqProvision
  //    结构性不可派生（AC-282 恒停 not-recorded 的成因之一）。
  // ② tasks/gap-ac281-scheduler-ms-carrier-field —— 同一形状第三次：只按前两者放行，会让一条
  //    testFiles+prereqProvision 都已派生过的 run 永远不再读日志 ⇒ schedulerMs 结构性不可派生
  //    （AC-281 恒停 scheduler-ms-not-recorded）。
  // 闸门现在是「testFiles 未知（且未负缓存）**或** 另任一后派生量未派生」。成本上界本身不变，
  // 只是它按**每一个**后派生量记账：全部已知 ⇒ 零次下载（同一条 job 日志承载全部三个量）。
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    return LOG_WITH_GROUPS;
  };
  const base = {
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun()],
    jobsByRun: { "1001": [ghJob()] },
  };
  // testFiles 已知、后两个未派生 ⇒ 仍要读一次日志（读的是同一条 job 日志，多个量共用）。
  const partial = collect({ ...base, knownTestFiles: { "1001": 631 } });
  assert.equal(calls.length, 1, "testFiles 已知但后两个派生未派生 ⇒ 这一次日志省不掉");
  assert.equal(partial.records[0].testFiles, 631);
  // 三个派生都已知 ⇒ 零次下载（这就是原来的成本上界，逐字保留）。
  const callsBefore = calls.length;
  const all = collect({
    ...base,
    knownTestFiles: { "1001": 631 },
    knownPrereqRuns: new Set(["1001"]),
    knownSchedulerRuns: new Set(["1001"]),
  });
  assert.equal(calls.length, callsBefore, "后派生量全部已知 ⇒ 不重复拉日志");
  assert.equal(all.records[0].testFiles, 631);
});

// ── ⑤ 就地补全（去重键与后派生字段的结构性缺口）──────────────────────────────────────────────

test("writeCarrier — 就地补全：已落盘、缺 testFiles 的行被补上，其余字段逐字保留", () => {
  const dir = tmpDir("enrich");
  const carrier = path.join(dir, "ci-runs.jsonl");
  const stored = {
    ts: "2026-09-15T02:38:35Z",
    branch: "develop",
    workflow: "CI",
    conclusion: "failure",
    runId: 1001,
    attribution: "real-defect",
    signals: ["tests-ran-and-failed"],
  };
  fs.writeFileSync(carrier, JSON.stringify(stored) + "\n");

  const incoming = { ...stored, testFiles: 631 };
  const res = writeCarrier(carrier, [incoming], null);

  assert.equal(res.appended, 0, "同一个 key ⇒ 不追加（⛔ 不制造第二条同 ts 记录）");
  assert.equal(res.enriched, 1);
  const lines = fs.readFileSync(carrier, "utf8").trim().split("\n");
  assert.equal(lines.length, 1, "补全走原地替换，行数不变");
  const got = JSON.parse(lines[0]);
  assert.equal(got.testFiles, 631);
  assert.equal(got.attribution, "real-defect", "既有 attribution 逐字保留（⛔ 不重算）");
  assert.deepEqual(got.signals, ["tests-ran-and-failed"]);
});

test("writeCarrier — 补全【只】补缺失：已有整数 testFiles 的行不被改写", () => {
  const dir = tmpDir("enrich-noop");
  const carrier = path.join(dir, "ci-runs.jsonl");
  const stored = { workflow: "CI", runId: 7, conclusion: "success", testFiles: 640 };
  fs.writeFileSync(carrier, JSON.stringify(stored) + "\n");
  const before = fs.readFileSync(carrier, "utf8");
  const res = writeCarrier(carrier, [{ ...stored, testFiles: 999 }], null);
  assert.equal(res.enriched, 0);
  assert.equal(fs.readFileSync(carrier, "utf8"), before, "文件逐字不变");
});

test("knownTestFilesFromCarrier — 只收整数（⛔ 不把「缺失」当成「已知」，否则永远不再补拉）", () => {
  const dir = tmpDir("known");
  const carrier = path.join(dir, "ci-runs.jsonl");
  fs.writeFileSync(
    carrier,
    [
      JSON.stringify({ workflow: "CI", runId: 1, testFiles: 631 }),
      JSON.stringify({ workflow: "CI", runId: 2 }),
      JSON.stringify({ workflow: "CI", runId: 3, testFiles: null }),
      "not json at all",
      "",
    ].join("\n") + "\n",
  );
  assert.deepEqual(knownTestFilesFromCarrier(carrier), { "1": 631 });
});

// ── ⑥ gh 解析：可区分地「找不到」 ──────────────────────────────────────────────────────────────

test("resolveGhBin — env QUAY_GH_BIN 优先（显式指定压过 PATH）", () => {
  const r = resolveGhBin({ PATH: "/nonexistent", HOME: "/nonexistent", QUAY_GH_BIN: "/x/gh" }, (p) => p === "/x/gh");
  assert.equal(r.bin, "/x/gh");
  assert.equal(r.source, "env:QUAY_GH_BIN");
});

test("resolveGhBin — PATH 里没有 gh 时回落 ~/.local/bin/gh（driver 的 PATH 不保证含它）", () => {
  const home = "/home/u";
  const r = resolveGhBin({ PATH: "/usr/bin:/bin", HOME: home }, (p) => p === path.join(home, ".local", "bin", "gh"));
  assert.equal(r.bin, path.join(home, ".local", "bin", "gh"));
  assert.equal(r.source, "fallback:~/.local/bin/gh");
});

test("resolveGhBin — 真的找不到 ⇒ bin=null 且 source='none'（三态可区分，⛔ 不返回空串冒充路径）", () => {
  const r = resolveGhBin({ PATH: "/nonexistent", HOME: "/nonexistent" }, () => false);
  assert.equal(r.bin, null);
  assert.equal(r.source, "none");
  assert.ok(r.candidates.length > 0, "候选清单必须可读（它是「找不到」这个读数的成因证据）");
});

test("collectForRound — gh 不可达 ⇒ status='gh-unavailable'，⛔ 不静默写成 0 条", () => {
  const dir = tmpDir("gh-unavail");
  const fakeRoot = path.join(dir, "repo");
  fs.mkdirSync(fakeRoot, { recursive: true });
  const res = collectForRound(fakeRoot, {
    repo: "o/n",
    throttleMs: 0,
    carrier: path.join(dir, "carrier.jsonl"),
    statePath: path.join(dir, "state.json"),
    // ⚠️ 光把 env 覆写成 PATH=/nonexistent **不足以**表达「不可达」：resolveGhBin 在 env/PATH 之后还有
    // 四个**故意不受 env 影响**的硬编码绝对路径（见下面那条 resolveGhBin 测试）。本机 / CI 真装了
    // 系统级 gh 时它们会命中 ⇒ 这条断言测的就不再是被测逻辑，而是宿主（2026-09-16 CI run 35054411272
    // 正是这么红的，实测 actual:'error' ≠ expected:'gh-unavailable'）。⇒ 用 ghIsExec 强制不可达。
    env: { PATH: "/nonexistent", HOME: "/nonexistent" },
    ghIsExec: () => false,
  });
  assert.equal(res.status, "gh-unavailable");
  assert.equal(res.ran, false);
  assert.match(res.reason, /gh/);
  assert.equal(fs.existsSync(path.join(dir, "carrier.jsonl")), false, "⛔ 不可达时不得写出一个空载体");
});

test("resolveGhBin — 四个硬编码回退路径【不受】env.PATH/env.HOME 覆盖（2026-09-16 CI 红的根因）", () => {
  // 上一条 collectForRound 测试为什么必须走 ghIsExec、而不能只覆写 env —— 根因就钉在这里。
  // 这一段硬编码回退是【故意】的（常驻 driver 的 PATH 不保证含 ~/.local/bin），所以 ⛔ 不能靠删掉它来修。
  const env = { PATH: "/nonexistent", HOME: "/nonexistent" };
  const hit = resolveGhBin(env, (p) => p === "/usr/bin/gh");
  assert.equal(hit.bin, "/usr/bin/gh", "env 覆写挡不住硬编码回退 —— CI 镜像预装的 gh 正是在这一类路径上");
  assert.equal(hit.source, "fallback:/usr/bin/gh");
  // 对照（硬规则 4）：同一 env 下该路径不可执行时取值相反 ⇒ 这个量能取假，不是恒等式。
  assert.equal(resolveGhBin(env, () => false).bin, null);
  // 枚举四个路径（⛔ 不布尔化成「有没有回退」一条）——少一个都会让「env 覆写就够了」重新变成假前提。
  for (const p of ["/usr/local/bin/gh", "/opt/homebrew/bin/gh", "/usr/bin/gh", "/bin/gh"]) {
    assert.ok(hit.candidates.includes(p), `候选清单必须含 ${p}`);
  }
});

test("collectForRound — ghIsExec 真的被 consult：宿主上真有一个可执行的 gh 时也能强制不可达", () => {
  // 这一条的可证伪性不依赖宿主装不装 gh（本机不装、CI 装），也不依赖那四个硬编码路径：
  // 假 gh 走 PATH，而 PATH 候选**排在最前** ⇒ 任何宿主上都解析得到它。
  const dir = tmpDir("gh-hook");
  const fakeRoot = path.join(dir, "repo");
  const binDir = path.join(dir, "bin");
  fs.mkdirSync(fakeRoot, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  const fakeGh = path.join(binDir, "gh");
  fs.writeFileSync(fakeGh, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(fakeGh, 0o755);
  const env = { PATH: binDir, HOME: "/nonexistent" };

  // 负控制 / 前提：**不注入** ghIsExec ⇒ 真实文件系统探测 ⇒ 确实解析得到这个可执行的假 gh。
  // 若实现把 ghIsExec 忽略掉，下面那条断言就会拿到 status:'error'（defaultGhRunner 真去跑它，
  // 空 stdout ⇒ JSON.parse("") 抛）—— 即【修复前这条测试在任何宿主上都红】，宿主差异不再是变量。
  assert.equal(resolveGhBin(env).bin, fakeGh, "前提：该 env 下确实存在一个可解析到的可执行 gh");

  const res = collectForRound(fakeRoot, {
    repo: "o/n",
    throttleMs: 0,
    carrier: path.join(dir, "carrier.jsonl"),
    statePath: path.join(dir, "state.json"),
    env,
    ghIsExec: () => false,
  });
  assert.equal(res.status, "gh-unavailable", "钩子必须压过「真实存在且可执行」的 gh");
  assert.equal(res.ran, false);
  assert.equal(fs.existsSync(path.join(dir, "carrier.jsonl")), false, "⛔ 不可达时不得写出一个空载体");
});

// ── ⑦ collectForRound 的节流是一个读数，不是静默跳过 ──────────────────────────────────────────

test("collectForRound — 节流窗内 ⇒ status='throttled'（可区分），窗外才真采", () => {
  const dir = tmpDir("throttle");
  const carrier = path.join(dir, "carrier.jsonl");
  const statePath = path.join(dir, "state.json");
  const calls = [];
  const run = (args) => {
    // ⚠️ argv 形是 ["api", "--allow-escape-sequences", "<path>"] —— 路径未必在 args[1]，按整串匹配。
    const s = args.join(" ");
    calls.push(s);
    if (/\/actions\/runs\?/.test(s)) return JSON.stringify({ workflow_runs: [ghRun()] });
    if (/\/actions\/runs\/1001\/jobs$/.test(s)) return JSON.stringify({ jobs: [ghJob()] });
    if (/\/actions\/jobs\/55\/logs$/.test(s)) return LOG_WITH_GROUPS;
    if (/\/contents\//.test(s)) throw new Error("no workflow yaml in fixture");
    throw new Error(`unexpected: ${s}`);
  };

  const first = collectForRound(dir, {
    repo: "o/n",
    run,
    throttleMs: 600_000,
    now: 1_000_000_000,
    carrier,
    statePath,
    env: { PATH: "/nonexistent", HOME: "/nonexistent" },
  });
  assert.equal(first.status, "ok");
  assert.equal(first.appended, 1);
  assert.equal(first.testFilesDerived, 1);

  const callsAfterFirst = calls.length;
  const second = collectForRound(dir, {
    repo: "o/n",
    run,
    throttleMs: 600_000,
    now: 1_000_000_001,
    carrier,
    statePath,
    env: { PATH: "/nonexistent", HOME: "/nonexistent" },
  });
  assert.equal(second.status, "throttled");
  assert.equal(second.ran, false);
  assert.equal(calls.length, callsAfterFirst, "节流窗内不得再打 gh");

  const third = collectForRound(dir, {
    repo: "o/n",
    run,
    throttleMs: 600_000,
    now: 1_000_000_000 + 600_001,
    carrier,
    statePath,
    env: { PATH: "/nonexistent", HOME: "/nonexistent" },
  });
  assert.equal(third.status, "ok", "窗外必须真采");
  assert.equal(third.appended, 0, "同一条 run 已落盘 ⇒ 去重跳过");
  assert.equal(third.skipped, 1);
});

test("buildRecord — testFiles 为 null/0/负数时【不写】该键（buildRecord 是最后一道闸）", () => {
  for (const v of [null, 0, -1, undefined]) {
    const rec = buildRecord(ghRun(), { testFiles: v });
    assert.equal("testFiles" in rec, false, `testFiles=${v} 不该落键`);
  }
  assert.equal(buildRecord(ghRun(), { testFiles: 631 }).testFiles, 631);
});

// ── ⑧ seaVerify：AC-267 载体臂的字段（tasks/gap-sea-artifact-plugin-root-toplevel-eval）─────────
//
// 为什么这条非有不可：AC-267 的静态臂只证明【源码里】再没有模块顶层求值 import.meta.url 的点；
// 「发出去的 SEA 二进制真能起 quay serve」只能由一次**真实 release run** 证明。载体里若没有承载
// 这个读数的字段，判据就**永久停在 `CAUSE=carrier-absent`**（硬规则 4 推论三：实现了、测试绿了、
// 生产没跑过 —— 与「没实现」同形）。
//
// ⛔ 本组断的是**关系**（三条夹具 ⇒ 三个不同输出），不是快照，也**不是**「值是 success」这一类
// 单点断言：单点断言在一个恒为 success 的实现上同样通过（硬规则 4 —— 一个结构上不可能取假的
// 量不是测量）。故最后一条是**负控制**：同一个夹具只翻一个 job 的 conclusion，输出必须跟着变。

/** release.yml 的两个 SEA 验证 job 的真实名字（实测 gh 2026-09-15 run 34845477762）。
 *  第二个是 matrix job，gh 把矩阵值缀在名字后 —— 逐字相等会把它读成「缺失」。 */
const SEA_JOB_LINUX = "sea-verify-node-free";
const SEA_JOB_XPLAT_MACOS = "sea-verify-node-free-cross-platform (macos-latest, macos-arm64, tar.gz)";
const SEA_JOB_XPLAT_WIN = "sea-verify-node-free-cross-platform (windows-latest, windows-x64, zip)";

function seaJob(name, conclusion) {
  return { id: name.length, name, conclusion, started_at: "2026-09-15T02:00:00Z", completed_at: "2026-09-15T02:05:00Z" };
}

/** 走**真实的 collect()**（不是导出的私有函数）：离线缝喂 run + job，零 gh 调用。 */
function seaVerifyOf(jobs, runOver = {}, opts = {}) {
  const r = collect({
    repo: "o/n",
    runs: [ghRun({ id: 1001, name: "Release", conclusion: "failure", ...runOver })],
    jobsByRun: { 1001: jobs },
    logFetch: "none",
    ...opts,
  });
  return r.records[0];
}

const SEA_ALL_GREEN = [
  seaJob(SEA_JOB_LINUX, "success"),
  seaJob(SEA_JOB_XPLAT_MACOS, "success"),
  seaJob(SEA_JOB_XPLAT_WIN, "success"),
];

test("seaVerify — 两个 SEA 验证 job 全在且全 success ⇒ 'success'（matrix 后缀名必须被认出来）", () => {
  assert.equal(seaVerifyOf(SEA_ALL_GREEN).seaVerify, "success");
});

test("seaVerify — 任一 job 非 success ⇒ 'failure'（⛔ 不是 'success'）", () => {
  // 只翻一个 —— 其余逐字不变，故差异只可能来自这一处。
  const jobs = [seaJob(SEA_JOB_LINUX, "failure"), seaJob(SEA_JOB_XPLAT_MACOS, "success"), seaJob(SEA_JOB_XPLAT_WIN, "success")];
  const rec = seaVerifyOf(jobs);
  assert.equal(rec.seaVerify, "failure");
  assert.notEqual(rec.seaVerify, "success");
});

test("seaVerify — job 列表读不到 / 一个都不在 ⇒ 'absent'，且它 ≠ 'success'（硬规则 3b：没评估成 ≠ 通过）", () => {
  const empty = seaVerifyOf([]);
  assert.equal(empty.seaVerify, "absent", "读不到 job ⇒ 独立的『没评估成』取值");
  assert.notEqual(empty.seaVerify, "success", "⛔ 绝不回落到常量 success");
  // 一份「跑了 job 但里面没有 SEA 验证 job」的列表走同一条路（成因不同、读数同形是对的：
  // 两者都是「没有可评估的 SEA 验证读数」）。
  assert.equal(seaVerifyOf([seaJob("test", "success"), seaJob("release", "success")]).seaVerify, "absent");
});

test("seaVerify — 只到了一部分 SEA 验证 job ⇒ 'incomplete'（≠ 'success'，也 ≠ 'absent'/'failure'）", () => {
  const rec = seaVerifyOf([seaJob(SEA_JOB_LINUX, "success")]);
  assert.equal(rec.seaVerify, "incomplete");
  for (const other of ["success", "absent", "failure"]) assert.notEqual(rec.seaVerify, other);
});

test("seaVerify — 非 release workflow 的记录【没有】这个键（缺 ≠ 'absent'，硬规则 6）", () => {
  const rec = seaVerifyOf(SEA_ALL_GREEN, { name: "CI" });
  assert.equal("seaVerify" in rec, false, "ci.yml 的 run 不带 seaVerify 键");
  // 正控制（同一夹具、只换 workflow 名）：同一个 job 列表在 Release 上就有这个键。
  assert.equal(seaVerifyOf(SEA_ALL_GREEN, { name: "Release" }).seaVerify, "success");
  // 两种写法都认（gh 的 run.name 给的是 workflow 的 name:，判据两种都收）。
  assert.equal(seaVerifyOf(SEA_ALL_GREEN, { name: "release.yml" }).seaVerify, "success");
});

test("seaVerify — 负控制：它不是恒值（同一个夹具只翻一个 job 的 conclusion，输出跟着变）", () => {
  // 硬规则 4：恒为 success 的字段与「一切正常」同形。若实现回落到常量，这条必红。
  const green = seaVerifyOf(SEA_ALL_GREEN).seaVerify;
  const oneRed = seaVerifyOf([
    seaJob(SEA_JOB_LINUX, "success"),
    seaJob(SEA_JOB_XPLAT_MACOS, "failure"),
    seaJob(SEA_JOB_XPLAT_WIN, "success"),
  ]).seaVerify;
  assert.notEqual(green, oneRed, "翻一个 job 的结论必须改变读数 —— 否则它是常量，不是测量");
  // 再加上「读不到」的那一态 ⇒ 词表里至少有三个**互不相同**的取值真的出现过。
  const absent = seaVerifyOf([]).seaVerify;
  assert.equal(new Set([green, oneRed, absent]).size, 3, "success / failure / absent 必须是三个不同取值");
});

test("seaVerify — 经真实 CLI 形状的 buildRecord 也派生（--from-file 走的就是这条路）", () => {
  const rec = buildRecord(
    { id: 7, name: "Release", conclusion: "failure", created_at: "2026-09-15T02:38:35Z" },
    { jobs: SEA_ALL_GREEN }
  );
  assert.equal(rec.seaVerify, "success");
  // 同一位置：不给 job ⇒ absent（⛔ 不是 success）。
  assert.equal(buildRecord({ id: 7, name: "Release", conclusion: "failure" }, {}).seaVerify, "absent");
});

// ── ⑨ prereqProvision：AC-282 载体臂（tasks/gap-ac282-runner-prereqs-already-present）──────────
//
// 这条读数**只能**从 job 自己的日志得到：`GhJob.steps` 只有 {name, conclusion, number}，而
// `already-present` 与 `installed-apt` 两个分支的 step conclusion **都是 `success`**，jobs API 也不给
// per-step 时长 ⇒ 在 API 那一层结构上不可派生。故 workflow 每个「走通了」的分支打印一行
// `__PREREQ__ <name>=<state>`，派生器只读该行。
//
// ⛔ 断言的全是**关系**（换一个 marker 值 ⇒ 读数跟着变；日志在但没 marker ⇒ 三个 absent），不是
// 「值等于 already-present」这一类单点断言 —— 单点断言在一个恒为 already-present 的实现上同样通过
// （硬规则 4：一个结构上不可能取假的量不是测量）。

/** 一份预置好的 runner 上的真实形状日志（三条 marker 全 already-present）。 */
const LOG_PREREQ_ALL_PRESENT =
  "2026-09-17T02:00:00.0000000Z ##[group]Run Install suite runtime prerequisites\n" +
  "python3 already has PyYAML (6.0.1)\n" +
  "__PREREQ__ pyyaml=already-present\n" +
  "tmux already present (tmux 3.4)\n" +
  "__PREREQ__ tmux=already-present\n" +
  "procps already present (procps-ng 4.0.4)\n" +
  "__PREREQ__ procps=already-present\n" +
  "##[endgroup]\n";

/** 一份**还没预置**的 runner 上的日志（改了 tmux 那一行，其余逐字不动）。 */
const LOG_PREREQ_TMUX_JUST_INSTALLED =
  LOG_PREREQ_ALL_PRESENT.replace("__PREREQ__ tmux=already-present", "__PREREQ__ tmux=installed-apt");

test("prereqProvision — 三条 marker 全 already-present ⇒ 三键全 already-present", () => {
  assert.deepEqual(derivePrereqProvision(LOG_PREREQ_ALL_PRESENT), {
    pyyaml: "already-present",
    tmux: "already-present",
    procps: "already-present",
  });
});

test("prereqProvision — 负控制①（谓词能取假）：marker 说 installed-apt ⇒ 该键 ≠ already-present", () => {
  const got = derivePrereqProvision(LOG_PREREQ_TMUX_JUST_INSTALLED);
  assert.notEqual(got.tmux, "already-present", "「本 job 内装了一遍」不得被读成「本来就有的」");
  assert.equal(got.tmux, "installed-apt", "逐字取 marker 说的那个状态");
  // 同一次读数里三个键**彼此可分**：翻一行只动一个键，另两个逐字不变。
  assert.equal(got.pyyaml, "already-present");
  assert.equal(got.procps, "already-present");
});

test("prereqProvision — 负控制②（零命中方向）：日志在、marker 一条都没有 ⇒ 三键全 absent", () => {
  // ⛔ 这一格最容易写错成 already-present（「没看见问题」）；absent 是「没评估成」这个**独立取值**。
  const got = derivePrereqProvision(LOG_WITHOUT_GROUPS);
  assert.deepEqual(got, { pyyaml: "absent", tmux: "absent", procps: "absent" });
  for (const k of ["pyyaml", "tmux", "procps"]) assert.notEqual(got[k], "already-present");
  // 空日志同款（不是「读不懂就回落」）。
  assert.deepEqual(derivePrereqProvision(""), { pyyaml: "absent", tmux: "absent", procps: "absent" });
});

test("prereqProvision — 未知取值/marker 名不进入词表（⛔ 不让「读不懂」伪装成某个状态）", () => {
  const got = derivePrereqProvision("__PREREQ__ pyyaml=whatever\n__PREREQ__ gawk=already-present\n");
  assert.equal(got.pyyaml, "absent", "未声明的取值 ⇒ 回落 absent（没评估成），不是一个编出来的状态");
  assert.equal("gawk" in got, false, "未声明的前置名不进词表");
});

test("collect — testFiles 已知的 run 仍会为 prereqProvision 拉日志（闸门不再只由 testFiles 决定）", () => {
  // 这是 AC-282 停在 `CAUSE=prereq-provision-not-recorded` 的成因之一：旧闸门是
  // `!alreadyKnown && …`，一条 testFiles 已派生过的 run **永远不再读日志** ⇒ 后派的
  // prereqProvision 结构性不可派生。
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    return LOG_PREREQ_ALL_PRESENT;
  };
  const { records } = collect({
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
    knownTestFiles: { 1001: 631 }, // ← testFiles 已知（旧闸门在这里就把整段跳过了）
  });
  assert.equal(calls.length, 1, "testFiles 已知不足以跳过 —— prereqProvision 还没派生");
  const testJob = records[0].jobs.find((j) => j.name === "test");
  assert.deepEqual(testJob.prereqProvision, {
    pyyaml: "already-present",
    tmux: "already-present",
    procps: "already-present",
  });
  assert.equal(calls[0].includes("/actions/jobs/55/logs"), true, "拉的是 test job 自己的日志");
});

test("collect — prereqProvision 已派生的 run ⇒ 不重复拉日志（成本上界，且缺 ≠ 已知）", () => {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    return LOG_PREREQ_ALL_PRESENT;
  };
  const base = {
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
    knownTestFiles: { 1001: 631 },
  };
  // ⚠️ 要传**两个** known* 闸门才省得掉这次下载（schedulerMs 也是后派生量，见 ⑩ 段与上面那条
  // 成本上界测试）。只传 knownPrereqRuns 现在是**故意**还会拉一次的。
  collect({ ...base, knownPrereqRuns: new Set(["1001"]), knownSchedulerRuns: new Set(["1001"]) });
  assert.equal(calls.length, 0, "后派生量全部已知 ⇒ 不拉日志");
  // 对照（硬规则 4）：把 knownPrereqRuns 去掉，同一个夹具立刻拉一次 ⇒ 这个量能取值相反。
  collect({ ...base, knownSchedulerRuns: new Set(["1001"]) });
  assert.equal(calls.length, 1);
});

test("collect — 没拉日志的 run【不写】prereqProvision 键（缺 ≠ absent，硬规则 6）", () => {
  // 离线缝（喂 runs 又不给 runner）⇒ 整条路径零 gh ⇒ 没有任何日志被拉过。
  const { records } = collect({
    repo: "o/n",
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
  });
  const testJob = records[0].jobs.find((j) => j.name === "test");
  assert.equal("prereqProvision" in testJob, false, "没拉日志 ⇒ 不写这个键");
  // 正控制（同一夹具）：给了 runner ⇒ 日志拉到了 ⇒ 同一个位置出现该键（内容此时是 absent 之外的
  // 真实读数）。两者可区分 ⇒ 上面那条不是「字段永远不出现」的恒真断言。
  const withLog = collect({
    repo: "o/n",
    run: () => LOG_PREREQ_ALL_PRESENT,
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
  });
  assert.equal("prereqProvision" in withLog.records[0].jobs.find((j) => j.name === "test"), true);
});

test("knownPrereqRunsFromCarrier — 只收【带该键】的 runId（缺 ≠ 已知，否则永远不再补拉）", () => {
  const dir = tmpDir("known-prereq");
  const carrier = path.join(dir, "ci-runs.jsonl");
  fs.writeFileSync(
    carrier,
    [
      JSON.stringify({ workflow: "CI", runId: 1, jobs: [{ name: "test", prereqProvision: { pyyaml: "absent" } }] }),
      JSON.stringify({ workflow: "CI", runId: 2, jobs: [{ name: "test" }] }),
      JSON.stringify({ workflow: "CI", runId: 3 }),
      JSON.stringify({ workflow: "CI", runId: 4, jobs: [{ name: "test", prereqProvision: null }] }),
      "not json at all",
      "",
    ].join("\n") + "\n",
  );
  assert.deepEqual([...knownPrereqRunsFromCarrier(carrier)].sort(), ["1"]);
});

test("writeCarrier — 就地补全 prereqProvision：只补缺失的那个键，既有 job 字段逐字保留", () => {
  const dir = tmpDir("enrich-prereq");
  const carrier = path.join(dir, "ci-runs.jsonl");
  const stored = {
    ts: "2026-09-17T02:15:29Z",
    branch: "develop",
    workflow: "CI",
    conclusion: "success",
    runId: 1001,
    jobs: [
      { name: "version-consistency", conclusion: "success", durationSec: 12 },
      { name: "test", conclusion: "success", durationSec: 243, steps: [{ name: "Run tests", conclusion: "success", number: 9 }] },
    ],
  };
  fs.writeFileSync(carrier, JSON.stringify(stored) + "\n");

  const incoming = {
    ...stored,
    jobs: [
      { name: "version-consistency", conclusion: "success", durationSec: 12 },
      {
        name: "test",
        conclusion: "success",
        durationSec: 243,
        steps: [{ name: "Run tests", conclusion: "success", number: 9 }],
        prereqProvision: { pyyaml: "already-present", tmux: "already-present", procps: "already-present" },
      },
    ],
  };
  const res = writeCarrier(carrier, [incoming], null);
  assert.equal(res.appended, 0, "同一个 key ⇒ 不追加");
  assert.equal(res.enrichedPrereq, 1);
  const lines = fs.readFileSync(carrier, "utf8").trim().split("\n");
  assert.equal(lines.length, 1, "补全走原地替换，行数不变");
  const got = JSON.parse(lines[0]);
  const testJob = got.jobs.find((j) => j.name === "test");
  assert.deepEqual(testJob.prereqProvision, {
    pyyaml: "already-present",
    tmux: "already-present",
    procps: "already-present",
  });
  assert.equal(testJob.durationSec, 243, "既有 job 字段逐字保留（⛔ 不重算）");
  assert.deepEqual(testJob.steps, [{ name: "Run tests", conclusion: "success", number: 9 }]);
  assert.equal(got.jobs.find((j) => j.name === "version-consistency").durationSec, 12);
  assert.equal("prereqProvision" in got.jobs.find((j) => j.name === "version-consistency"), false);
});

// ── ⑩ schedulerMs：AC-281 载体臂（tasks/gap-ac281-scheduler-ms-carrier-field）────────────────────
//
// AC-281 原量的是 CI `test` job 的**总墙钟**（`durationSec`），而其中不可约的固定开销（checkout /
// npm install / coverage self-check / runner 收尾）实测 ≥27s ⇒ 那条判据在当前 job 结构下**数学不可
// 达成**。2026-09-17 人裁定改为只量**套件自身调度器**的墙钟 —— 这个读数只活在 job 自己的日志里
// （`suite-scheduler.ts` 在队列排空那一刻打一次 `__OVERHEAD__ scheduler_ms=<n>`），此前没有任何
// 载体采集它 ⇒ 判据永久停在 `CAUSE=scheduler-ms-not-recorded`（NOT-EVALUATED，硬规则 4 推论三：
// 生产上确实打了，但没落进载体 ⇒ 与「没实现」同形）。
//
// ⛔ 断言的全是**关系**：换一行 marker ⇒ 读数跟着变；日志在但没有该行 ⇒ 键**不存在**（⛔ 不是 0）。
// 单点断言（「等于 53507」）在一个恒返回常量的实现上同样通过（硬规则 4：结构上不可能取假的量不是测量）。

/** 一段**真实**的 CI job 日志片段（run 35227553148 / job 105222883455，2026-09-17 13:32Z 的 develop
 *  全量套件，`gh api .../jobs/105222883455/logs` 的原始字节）。⛔ **不是编造的样本**。
 *
 *  两件必须逐字保留的东西：
 *  ① GitHub 给**每一行**加的 `<ISO 时间戳> ` 前缀 —— 那正是本派生的中间层（硬规则 4c）。锚 `^` 的
 *     正则在它上面命中恒为 0，而「检查恒不命中」与「套件没打印」同形。
 *  ② 同一片段里的 `main_phase_ms` / `lock_overhead_ms` 也是 `__OVERHEAD__` 家族 ⇒ 谓词必须具体到
 *     `scheduler_ms`，只认前缀会读到别人的读数。 */
const LOG_WITH_SCHEDULER =
  "2026-09-17T13:32:21.3476587Z __GROUP__ concurrency=128 files=728 sum_ms=1572369 floor_ms=43058 capped=0\n" +
  "2026-09-17T13:32:21.3476871Z __OVERHEAD__ main_phase_ms=51092\n" +
  "2026-09-17T13:32:21.3477076Z __OVERHEAD__ scheduler_ms=53507\n" +
  "2026-09-17T13:32:21.3676976Z __OVERHEAD__ lock_overhead_ms=8\n";

test("schedulerMs — 真实日志片段（run 35227553148）派生出 53507，是 number 不是 string", () => {
  const got = deriveSchedulerMs(LOG_WITH_SCHEDULER);
  assert.equal(got, 53507);
  assert.equal(typeof got, "number", "判据要拿它做 `/ 1000.0` 的算术 —— 字符串会静默变成别的意思");
});

test("schedulerMs — 中间层：日志每一行都带 GitHub 的时间戳前缀 ⇒ 正则必须【不】锚 `^`", () => {
  // ① 上面那段真实片段里，一个 `^`-锚定的同形谓词命中数必须是 0 —— 这一条钉的是**夹具的保真度**：
  //    哪天有人把时间戳前缀从夹具里抹掉，本测试就红，而不是让那个陷阱悄悄失去覆盖。
  assert.equal(
    [...LOG_WITH_SCHEDULER.matchAll(/^__OVERHEAD__[ \t]+scheduler_ms=(\d+)/gm)].length,
    0,
    "夹具丢了 GitHub 的行前缀 ⇒ 4c 陷阱不再被覆盖（夹具不再等于生产形态）",
  );
  // ② 被测谓词（不锚）在同一份夹具上必须命中 ⇒ 两者可区分，上面那条不是「谓词永远不命中」的恒真断言。
  assert.equal(deriveSchedulerMs(LOG_WITH_SCHEDULER), 53507);
  // ③ 顺带钉住②里那个前缀**真的**是前缀而不是装饰：去掉它之后锚定谓词就能命中了。
  const stripped = LOG_WITH_SCHEDULER.split("\n").map((l) => l.replace(/^[0-9T:.\-]+Z /, "")).join("\n");
  assert.equal([...stripped.matchAll(/^__OVERHEAD__[ \t]+scheduler_ms=(\d+)/gm)].length, 1);
});

test("schedulerMs — 谓词能取假：换一行 marker ⇒ 读数跟着变（⛔ 不是一个常量）", () => {
  assert.equal(deriveSchedulerMs(LOG_WITH_SCHEDULER.replace("scheduler_ms=53507", "scheduler_ms=1")), 1);
  // 兄弟 marker 不被误读（`main_phase_ms=51092` 与 `lock_overhead_ms=8` 同在这份夹具里）。
  assert.equal(deriveSchedulerMs("__OVERHEAD__ main_phase_ms=51092\n"), null);
  assert.equal(deriveSchedulerMs("__OVERHEAD__ lock_overhead_ms=8\n"), null);
});

test("schedulerMs — 负控制（零命中方向）：日志在、没有该行 ⇒ null，⛔ 不是 0（硬规则 6）", () => {
  assert.equal(deriveSchedulerMs(LOG_WITHOUT_GROUPS), null);
  assert.equal(deriveSchedulerMs(""), null);
  // ⛔ 明确排除「看起来像失败」的假值：AC-281 的判据读 `schedulerMs is None` 才报 NOT-EVALUATED，
  // 一个 0 会让它判成「0 秒，飞快」——比缺失更贵。
  assert.notEqual(deriveSchedulerMs(LOG_WITHOUT_GROUPS), 0);
});

test("collect — 日志里的 schedulerMs 落到 `test` job 的读数上（AC-281 判据读的就是这条）", () => {
  const { records } = collect({
    repo: "o/n",
    run: () => LOG_WITH_SCHEDULER,
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
  });
  const testJob = records[0].jobs.find((j) => j.name === "test");
  assert.equal(testJob.schedulerMs, 53507);
});

test("collect — 没拉日志的 run【不写】schedulerMs 键（缺 ≠ 0，硬规则 6）", () => {
  // 离线缝（喂 runs 又不给 runner）⇒ 整条路径零 gh ⇒ 没有任何日志被拉过。
  const { records } = collect({
    repo: "o/n",
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
  });
  const testJob = records[0].jobs.find((j) => j.name === "test");
  assert.equal("schedulerMs" in testJob, false, "没拉日志 ⇒ 不写这个键");
  // 正控制（同一夹具）：给了 runner ⇒ 日志拉到了 ⇒ 同一个位置出现该数字。
  // 两者可区分 ⇒ 上面那条不是「字段永远不出现」的恒真断言。
  const withLog = collect({
    repo: "o/n",
    run: () => LOG_WITH_SCHEDULER,
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
  });
  assert.equal(withLog.records[0].jobs.find((j) => j.name === "test").schedulerMs, 53507);
});

test("collect — testFiles 与 prereqProvision 都已知的 run 仍会为 schedulerMs 拉日志（第三个闸门）", () => {
  // AC-281 恒停 `scheduler-ms-not-recorded` 的成因此前与 AC-282 同形：闸门只认前两个量 ⇒ 一条前
  // 两者都已派生过的 run **永远不再读日志** ⇒ 后派的 schedulerMs 结构性不可派生。
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    return LOG_WITH_SCHEDULER;
  };
  const { records } = collect({
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
    knownTestFiles: { 1001: 728 },
    knownPrereqRuns: new Set(["1001"]),
  });
  assert.equal(calls.length, 1, "前两个量已知不足以跳过 —— schedulerMs 还没派生");
  assert.equal(records[0].jobs.find((j) => j.name === "test").schedulerMs, 53507);
  assert.equal(calls[0].includes("/actions/jobs/55/logs"), true, "拉的是 test job 自己的日志");
});

test("collect — schedulerMs 已派生的 run ⇒ 不重复拉日志（成本上界，且缺 ≠ 已知）", () => {
  const calls = [];
  const run = () => {
    calls.push("x");
    return LOG_WITH_SCHEDULER;
  };
  const base = {
    repo: "o/n",
    run,
    limit: 1,
    runs: [ghRun({ id: 1001, conclusion: "success" })],
    jobsByRun: { 1001: [ghJob(55, "test", "success")] },
    knownTestFiles: { 1001: 728 },
    knownPrereqRuns: new Set(["1001"]),
  };
  collect({ ...base, knownSchedulerRuns: new Set(["1001"]) });
  assert.equal(calls.length, 0, "三个派生都已知道 ⇒ 不拉日志");
  // 对照（硬规则 4）：把 knownSchedulerRuns 去掉，同一个夹具立刻拉一次 ⇒ 这个量能取值相反。
  collect(base);
  assert.equal(calls.length, 1);
});

test("knownSchedulerRunsFromCarrier — 只收【带该键】的 runId（缺 ≠ 已知，否则永远不再补拉）", () => {
  const dir = tmpDir("known-sched");
  const carrier = path.join(dir, "ci-runs.jsonl");
  fs.writeFileSync(
    carrier,
    [
      JSON.stringify({ workflow: "CI", runId: 1, jobs: [{ name: "test", schedulerMs: 53507 }] }),
      JSON.stringify({ workflow: "CI", runId: 2, jobs: [{ name: "test" }] }),
      JSON.stringify({ workflow: "CI", runId: 3 }),
      JSON.stringify({ workflow: "CI", runId: 4, jobs: [{ name: "test", schedulerMs: null }] }),
      JSON.stringify({ workflow: "CI", runId: 5, jobs: [{ name: "test", schedulerMs: "53507" }] }),
      "not json at all",
      "",
    ].join("\n") + "\n",
  );
  // ⛔ 4 是 `null`、5 是字符串 —— 两者都不是一个可判定的读数 ⇒ 都不得进「已知」集合
  // （否则那条记录**永远不会**被补拉，硬规则 6：缺 ≠ 已知）。
  assert.deepEqual([...knownSchedulerRunsFromCarrier(carrier)].sort(), ["1"]);
});

test("writeCarrier — 就地补全 schedulerMs：只补缺失的那个键，既有 job 字段逐字保留", () => {
  const dir = tmpDir("enrich-sched");
  const carrier = path.join(dir, "ci-runs.jsonl");
  const stored = {
    ts: "2026-09-17T13:30:56Z",
    branch: "develop",
    workflow: "CI",
    conclusion: "success",
    runId: 35227553148,
    jobs: [
      { name: "version-consistency", conclusion: "success", durationSec: 12 },
      {
        name: "test",
        conclusion: "success",
        durationSec: 99,
        steps: [{ name: "Run tests", conclusion: "success", number: 10 }],
      },
    ],
  };
  fs.writeFileSync(carrier, JSON.stringify(stored) + "\n");
  const before = fs.readFileSync(carrier, "utf8");

  const incoming = {
    ...stored,
    jobs: [
      { name: "version-consistency", conclusion: "success", durationSec: 12 },
      {
        name: "test",
        conclusion: "success",
        durationSec: 99,
        steps: [{ name: "Run tests", conclusion: "success", number: 10 }],
        schedulerMs: 53507,
      },
    ],
  };
  const res = writeCarrier(carrier, [incoming], null);
  assert.equal(res.appended, 0, "同一个 key ⇒ 不追加");
  assert.equal(res.enrichedScheduler, 1);
  assert.equal(res.enrichedPrereq, 0, "本次没有 prereq 可补 ⇒ 两个计数彼此可分（⛔ 不合并成一个 jobs 布尔）");

  const lines = fs.readFileSync(carrier, "utf8").trim().split("\n");
  assert.equal(lines.length, 1, "补全走原地替换，行数不变");
  const got = JSON.parse(lines[0]);
  const testJob = got.jobs.find((j) => j.name === "test");
  assert.equal(testJob.schedulerMs, 53507);
  assert.equal(testJob.durationSec, 99, "既有 job 字段逐字保留（⛔ 不重算）");
  assert.deepEqual(testJob.steps, [{ name: "Run tests", conclusion: "success", number: 10 }]);
  assert.equal(got.jobs.find((j) => j.name === "version-consistency").durationSec, 12);
  assert.equal("schedulerMs" in got.jobs.find((j) => j.name === "version-consistency"), false);
  // 完整的 JSON 差异：**只多一个键**（不是重写整条记录）。
  const a = JSON.parse(before.trim());
  const b = { ...got };
  b.jobs = got.jobs.map((j) => ({ ...j }));
  b.jobs[1] = { ...b.jobs[1] };
  delete b.jobs[1].schedulerMs;
  assert.deepEqual(b, a, "改前改后的完整 JSON 差异只应有 schedulerMs 这一个键");
});

test("writeCarrier — 两个 job 级补全在同一行上【串联】：缺 prereqProvision 又缺 schedulerMs 时两个都补", () => {
  const dir = tmpDir("enrich-both");
  const carrier = path.join(dir, "ci-runs.jsonl");
  const stored = {
    ts: "2026-09-17T13:30:56Z",
    branch: "develop",
    workflow: "CI",
    conclusion: "success",
    runId: 35227553148,
    jobs: [{ name: "test", conclusion: "success", durationSec: 99 }],
  };
  fs.writeFileSync(carrier, JSON.stringify(stored) + "\n");
  const incoming = {
    ...stored,
    jobs: [
      {
        name: "test",
        conclusion: "success",
        durationSec: 99,
        prereqProvision: { pyyaml: "already-present", tmux: "already-present", procps: "already-present" },
        schedulerMs: 53507,
      },
    ],
  };
  const res = writeCarrier(carrier, [incoming], null);
  assert.equal(res.enrichedPrereq, 1);
  assert.equal(res.enrichedScheduler, 1, "两个补全互相不遮蔽（串联，不是一个盖掉另一个）");
  const got = JSON.parse(fs.readFileSync(carrier, "utf8").trim());
  assert.deepEqual(got.jobs[0].prereqProvision, {
    pyyaml: "already-present",
    tmux: "already-present",
    procps: "already-present",
  });
  assert.equal(got.jobs[0].schedulerMs, 53507);
  assert.equal(got.jobs[0].durationSec, 99);
});

test("buildRecord — schedulerByJob 里没有这个 job ⇒ 该 job 读数上【没有】schedulerMs 键", () => {
  const jobs = [ghJob(55, "test", "success"), ghJob(56, "version-consistency", "success")];
  const rec = buildRecord(ghRun({ id: 1001, conclusion: "success" }), {
    jobs,
    schedulerByJob: new Map([[jobs[0], 53507]]),
  });
  assert.equal(rec.jobs.find((j) => j.name === "test").schedulerMs, 53507);
  assert.equal("schedulerMs" in rec.jobs.find((j) => j.name === "version-consistency"), false);
});
