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
//   ⑤ collectForRound 的节流是**一个读数**（throttled），不是静默跳过。

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRecord,
  collect,
  collectForRound,
  deriveTestFilesFromLog,
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
function ghJob(id = 55, name = "test") {
  return {
    id,
    name,
    conclusion: "failure",
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

test("collect — 已经知道的 runId 不再拉日志（增量回填的成本上界）", () => {
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
    jobsByRun: { "1001": [ghJob()] },
    knownTestFiles: { "1001": 631 },
  });
  assert.equal(calls.length, 0, "已知 ⇒ 不重复拉日志");
  assert.equal(records[0].testFiles, 631);
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
    env: { PATH: "/nonexistent", HOME: "/nonexistent" },
  });
  assert.equal(res.status, "gh-unavailable");
  assert.equal(res.ran, false);
  assert.match(res.reason, /gh/);
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
