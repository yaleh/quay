// @test-group engine
// ci-red-attribute.test.mjs — tasks/gap-ci-red-attribution-classifier, AC1 / AC2 / AC3(写面).
//
// Pins the mechanical CI-red attributor behind GOAL-020's AC-269:
//   AC1  表驱动：三条 fixture 分别判出 real-defect / infrastructure / known-flake，并逐条打印
//        `attribution` 与 `signals`；一条**无任何信号**的 fixture 判 real-defect 且 signals 带兜底标记
//        `default:no-signal-matched`（硬规则 3b：兜底不得与「命中信号判出的 real-defect」同形）。
//   AC2  可证伪性 / 单变量对照：同一条记录**只翻转一个客观信号**（timedOut false→true），其余字段
//        逐字不变 ⇒ attribution 必须改判 real-defect → infrastructure。一个恒返回同一取值的「归因器」
//        在这个对照下必然暴露。两次读数逐字打印。
//   AC3  写面：`withAttribution` 只给 `conclusion === "failure"` 的记录盖 attribution；success 记录
//        落盘时**不带**该字段。`writeCarrier` 走真实文件追加 + 按 (workflow,runId) 去重。
//
// 全部用例是纯函数 / 文件读写，不 spawn 真进程、不触网（离线缝 = 注入的 run/job 数组）。
//
// Run: scripts/test.sh plugin/test/ci-red-attribute.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ATTRIBUTION_VOCAB,
  DEFAULT_NO_SIGNAL,
  DEFECT_TESTS_RAN,
  TEST_STEP_RE,
  attributeRun,
  loadKnownFlakes,
  hasValidAttribution,
} from "../scripts/ci-red-attribute.ts";

import {
  buildRecord,
  collect,
  deriveTestFilesFromLog,
  parseJobTimeouts,
  writeCarrier,
  withAttribution,
  existingKeys,
} from "../scripts/ci-runs-collect.ts";

// R6 carrier-array cleanup: every mkdtemp dir is tracked and removed after the run (no tmp leak).
const _createdDirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cira-${prefix}-`));
  _createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** 表驱动 fixture：一条**失败**记录 + 期望的归因。 */
const FIXTURES = [
  {
    name: "real-defect（测试确实跑了并失败 — 无 infra / flake 信号）",
    record: { conclusion: "failure", testFiles: 631, failedTests: ["plugin/test/x.test.mjs::a real assertion"] },
    expect: "real-defect",
  },
  {
    name: "infrastructure（job 时长达到该 job 的 timeout-minutes）",
    record: {
      conclusion: "failure",
      testFiles: 631,
      jobs: [{ name: "test", conclusion: "failure", durationSec: 1501, timeoutMinutes: 25 }],
    },
    expect: "infrastructure",
  },
  {
    name: "known-flake（失败测试标识命中登记表）",
    record: {
      conclusion: "failure",
      testFiles: 631,
      failedTests: ["plugin/test/tmux-leak-scan.test.mjs::R2 — TRANSIENT NEW residue"],
    },
    registry: {
      flakes: [
        {
          test: "plugin/test/tmux-leak-scan.test.mjs::R2 — TRANSIENT NEW residue",
          firstRegistered: "2026-09-13",
          evidence: "fixture",
        },
      ],
    },
    expect: "known-flake",
  },
  {
    name: "兜底（一条信号都没命中 ⇒ real-defect + 兜底标记）",
    record: { conclusion: "failure" },
    expect: "real-defect",
    expectSignal: DEFAULT_NO_SIGNAL,
  },
];

for (const fx of FIXTURES) {
  test(`AC1 — ${fx.name}`, () => {
    const res = attributeRun(fx.record, {
      knownFlakes: fx.registry ?? null,
    });
    // 逐条打印（AC1 要求打印每条的 attribution 与 signals）
    console.log(`    attribution=${res.attribution} signals=${JSON.stringify(res.signals)}`);
    assert.equal(res.attribution, fx.expect);
    assert.ok(ATTRIBUTION_VOCAB.includes(res.attribution), "attribution 必须取三元词表之一");
    assert.ok(Array.isArray(res.signals) && res.signals.length > 0, "signals 必须是非空数组");
    if (fx.expectSignal) assert.ok(res.signals.includes(fx.expectSignal), `signals 应含 ${fx.expectSignal}`);
  });
}

test("AC1 — 兜底判出的 real-defect 与命中信号判出的 real-defect 可分辨（硬规则 3b）", () => {
  const byFallback = attributeRun({ conclusion: "failure" }, { knownFlakes: null });
  const bySignal = attributeRun(
    { conclusion: "failure", testFiles: 631, jobs: [{ name: "test", steps: [{ name: "Run tests", conclusion: "success" }] }] },
    { knownFlakes: null },
  );
  assert.equal(byFallback.attribution, "real-defect");
  assert.equal(bySignal.attribution, "real-defect");
  // 同一个取值、两件不同的事 —— signals 必须把它们分开
  assert.ok(byFallback.signals.includes(DEFAULT_NO_SIGNAL));
  assert.ok(bySignal.signals.includes(DEFECT_TESTS_RAN));
  assert.notDeepEqual(byFallback.signals, bySignal.signals);
});

test("AC1 — 非 failure 记录返回 attribution=null（读不懂必须与『判为 real-defect』不同形）", () => {
  for (const conclusion of ["success", "cancelled", undefined]) {
    const res = attributeRun({ conclusion, testFiles: 631 }, { knownFlakes: null });
    assert.equal(res.attribution, null, `conclusion=${conclusion} 不该被归因`);
    assert.ok(res.signals[0].startsWith("refused:"), "拒绝必须留下可分辨的信号");
  }
});

test("AC1 — 空登记表 / 读不到的登记表 ⇒ 判不出 known-flake（⛔ 不拿『看起来像 flake』当信号）", () => {
  const record = {
    conclusion: "failure",
    testFiles: 631,
    failedTests: ["plugin/test/x.test.mjs::some test"],
  };
  const empty = attributeRun(record, { knownFlakes: { flakes: [] } });
  assert.equal(empty.attribution, "real-defect", "空登记表下必须兜底为真缺陷");
  const unreadable = attributeRun(record, { knownFlakes: null });
  assert.equal(unreadable.attribution, "real-defect", "读不到登记表下必须兜底为真缺陷");
});

test("AC1 — setup 步失败且测试步从未开始 ⇒ infrastructure（Finding 点名的第三类）", () => {
  const record = {
    conclusion: "failure",
    jobs: [
      {
        name: "test",
        conclusion: "failure",
        durationSec: 42,
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Checkout", conclusion: "success" },
          { name: "Setup Node", conclusion: "failure" },
          { name: "Run tests", conclusion: "skipped" },
        ],
      },
    ],
  };
  const res = attributeRun(record, { knownFlakes: null });
  assert.equal(res.attribution, "infrastructure");
  assert.ok(res.signals.some((s) => s.startsWith("infra:failed-before-tests-started")), JSON.stringify(res.signals));
});

test("AC1 — ⛔ 没有步级读数时不得报『测试步从未开始』（读不懂不回落到 infra，方向安全）", () => {
  const res = attributeRun({ conclusion: "failure", jobs: [{ name: "test", conclusion: "failure" }] }, { knownFlakes: null });
  assert.equal(res.attribution, "real-defect");
  assert.ok(!res.signals.some((s) => s.startsWith("infra:")), JSON.stringify(res.signals));
});

// ── 回归：两条真实语料上暴露的误判（2026-09-15，首次对真 run 归因时发现的）──────────────────
// 首次落盘后 19 条真失败**全部**被判 infrastructure —— 一个在真实语料上恒定的取值，方向是把真红
// 豁免掉。根因是「测试步**没成功**」被当成「测试步**没跑**」。下面两条把这两个形态钉住。
test("回归 — ⛔ 测试步【跑了且失败】不得判成『测试从未开始』（真红不得被豁免）", () => {
  const record = {
    conclusion: "failure",
    jobs: [
      {
        name: "test",
        conclusion: "failure",
        durationSec: 1088,
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Run actions/checkout@v4", conclusion: "success" },
          { name: "Run npm install", conclusion: "success" },
          { name: "Run tests", conclusion: "failure" },
        ],
      },
    ],
  };
  const res = attributeRun(record, { knownFlakes: null });
  console.log(`    attribution=${res.attribution} signals=${JSON.stringify(res.signals)}`);
  assert.equal(res.attribution, "real-defect", "Run tests 步失败 = 测试跑了并失败，不是基础设施问题");
  assert.ok(res.signals.includes(DEFECT_TESTS_RAN), JSON.stringify(res.signals));
  assert.ok(!res.signals.some((s) => s.startsWith("infra:")), JSON.stringify(res.signals));
});

test("回归 — ⛔ 失败在一个【非 setup 的测试前步】不得判成 infrastructure（宁多一次人看）", () => {
  const record = {
    conclusion: "failure",
    jobs: [
      {
        name: "test",
        conclusion: "failure",
        steps: [
          { name: "Set up job", conclusion: "success" },
          { name: "Run actions/checkout@v4", conclusion: "success" },
          { name: "Run npm install", conclusion: "success" },
          { name: "Test-coverage self-check (DIR-110/ADR-019 decision #4)", conclusion: "failure" },
          { name: "Run tests", conclusion: "skipped" },
        ],
      },
    ],
  };
  const res = attributeRun(record, { knownFlakes: null });
  assert.equal(res.attribution, "real-defect", "既非 setup 形 ⇒ 不得豁免成 infrastructure");
  assert.ok(res.signals.includes(DEFAULT_NO_SIGNAL), JSON.stringify(res.signals));
});

test("回归 — ⛔ 兄弟 job 被取消不得豁免另一个 job 的实质失败（真缺陷不得洗成基础设施）", () => {
  // 实测形态（release run 34845477762 / 34843029988）：`release` job 被取消，
  // 而 `sea-verify-node-free` 的 `Run quay serve and curl it (no Node on PATH)` 步真的失败
  // —— 那正是 AC-267 追的 SEA 缺陷。若「有 job 被取消」一句话豁免整条 run，这个真缺陷就没了。
  const record = {
    conclusion: "failure",
    jobs: [
      { name: "release", conclusion: "cancelled", durationSec: 1817, steps: [{ name: "Run tests", conclusion: "cancelled" }] },
      {
        name: "sea-verify-node-free",
        conclusion: "failure",
        durationSec: 23,
        steps: [
          { name: "Install runtime deps (libatomic1; explicitly NOT nodejs, NOT gh)", conclusion: "success" },
          { name: "Run quay --help (no Node on PATH)", conclusion: "success" },
          { name: "Run quay serve and curl it (no Node on PATH)", conclusion: "failure" },
        ],
      },
    ],
  };
  const res = attributeRun(record, { knownFlakes: null });
  console.log(`    attribution=${res.attribution} signals=${JSON.stringify(res.signals)}`);
  assert.equal(res.attribution, "real-defect", "实质失败优先于兄弟 job 的取消");
  // 被压制的 infra 信号必须仍留在 signals 里（看得见「命中过，只是没定案」）
  assert.ok(res.signals.some((s) => s.startsWith("suppressed-by-substantive-failure:infra:job-cancelled:")), JSON.stringify(res.signals));
  assert.ok(res.signals.some((s) => s.startsWith("defect:substantive-failure:sea-verify-node-free")), JSON.stringify(res.signals));
});

test("回归 — 被取消的 job 若没有兄弟实质失败，infrastructure 照常生效（压制不是一票否决）", () => {
  const record = {
    conclusion: "failure",
    jobs: [
      { name: "release", conclusion: "cancelled", durationSec: 1817, steps: [{ name: "Run tests", conclusion: "cancelled" }] },
      { name: "sea-release", conclusion: "success", durationSec: 45, steps: [{ name: "Build", conclusion: "success" }] },
    ],
  };
  const res = attributeRun(record, { knownFlakes: null });
  assert.equal(res.attribution, "infrastructure");
  assert.ok(res.signals.includes("infra:job-cancelled:release"));
});

test("回归 — 步名含 test 但不是测试步（Test-coverage self-check）不得被当成测试步", () => {
  // 直接钉步名谓词本身：它只认「跑测试套件」的形态，不认裸词 test/suite。
  assert.equal(TEST_STEP_RE.test("Test-coverage self-check (DIR-110/ADR-019 decision #4)"), false);
  assert.equal(TEST_STEP_RE.test("Run tests"), true);
  assert.equal(TEST_STEP_RE.test("Run node --test"), true);
  assert.equal(TEST_STEP_RE.test("Run npm install"), false);
  assert.equal(TEST_STEP_RE.test("Run actions/checkout@v4"), false);
});

// ── AC2：单变量对照（本任务核心）──────────────────────────────────────────────────────────
test("AC2 — 只翻转 timedOut 一个字段，attribution 必须改判", () => {
  // 其余字段逐字不变：同一份 JSON 文本解析出来、只改一个键。
  const baseJson = JSON.stringify({
    ts: "2026-09-15T02:38:35Z",
    branch: "develop",
    workflow: "CI",
    conclusion: "failure",
    runId: 34921960393,
    durationSec: 1091,
    testFiles: 631,
    jobs: [{ name: "test", conclusion: "failure", durationSec: 1080, timeoutMinutes: 25 }],
  });

  const before = JSON.parse(baseJson);
  const after = { ...JSON.parse(baseJson), timedOut: true };

  // 逐字确认「只有一个信号被翻转」
  const diffKeys = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  assert.deepEqual(diffKeys, ["timedOut"], "对照必须只翻转一个字段");

  const rBefore = attributeRun(before, { knownFlakes: null });
  const rAfter = attributeRun(after, { knownFlakes: null });

  console.log(`    before: input=${JSON.stringify(before)}`);
  console.log(`            attribution=${rBefore.attribution} signals=${JSON.stringify(rBefore.signals)}`);
  console.log(`    after : input=${JSON.stringify(after)}`);
  console.log(`            attribution=${rAfter.attribution} signals=${JSON.stringify(rAfter.signals)}`);

  assert.equal(rBefore.attribution, "real-defect");
  assert.equal(rAfter.attribution, "infrastructure");
  assert.notEqual(rBefore.attribution, rAfter.attribution, "单变量对照下必须改判");
});

test("AC2 — 控制臂：另有两条单变量翻转同样改判（job-cancelled / 命中登记表）", () => {
  const base = {
    conclusion: "failure",
    testFiles: 631,
    jobs: [{ name: "test", conclusion: "failure", durationSec: 1080, timeoutMinutes: 25 }],
  };
  const cancelled = { ...base, jobs: [{ ...base.jobs[0], conclusion: "cancelled" }] };
  assert.equal(attributeRun(base, { knownFlakes: null }).attribution, "real-defect");
  assert.equal(attributeRun(cancelled, { knownFlakes: null }).attribution, "infrastructure");

  const flakes = { flakes: [{ test: "f::t", firstRegistered: "2026-09-15", evidence: "fixture" }] };
  const withId = { ...base, failedTests: ["f::t"] };
  assert.equal(attributeRun(withId, { knownFlakes: null }).attribution, "real-defect");
  assert.equal(attributeRun(withId, { knownFlakes: flakes }).attribution, "known-flake");
});

test("AC2 — ⛔ 单变量对照不成立于【有兄弟实质失败】的记录上，那是设计而非恒值（方向说明）", () => {
  // 上一条对照成立的前提是这条记录里没有 job「实质性地」失败。若把同一条记录补上一个真的失败了
  // 测试步的兄弟 job，再翻转 timedOut，则 attribution **不变** —— 因为那条真红才是这个 run 红的
  // 成因（豁免它 = 把真缺陷洗成基础设施，方向不可逆）。本条把这个边界逐字钉住：
  // 「改判不了」与「恒值」不是同一件事，signals 会把被压制的信号原样吐出来，可分辨。
  const withSibling = {
    ts: "2026-09-15T02:38:35Z",
    conclusion: "failure",
    durationSec: 1091,
    jobs: [
      { name: "test", conclusion: "failure", durationSec: 1088, steps: [{ name: "Run tests", conclusion: "failure" }] },
    ],
  };
  const before = attributeRun(withSibling, { knownFlakes: null });
  const after = attributeRun({ ...withSibling, timedOut: true }, { knownFlakes: null });
  console.log(`    before: ${before.attribution} ${JSON.stringify(before.signals)}`);
  console.log(`    after : ${after.attribution} ${JSON.stringify(after.signals)}`);
  assert.equal(before.attribution, "real-defect");
  assert.equal(after.attribution, "real-defect", "兄弟实质失败把 infra 信号压住了");
  assert.ok(
    after.signals.some((s) => s.startsWith("suppressed-by-substantive-failure:infra:run-timed-out")),
    "被压制的信号必须可见 —— 否则读记录的人分不出「没命中」与「命中但没定案」",
  );
});

// ── AC3：写面 ─────────────────────────────────────────────────────────────────────────────
test("AC3 — withAttribution 只给 failure 盖 attribution；success 记录不带该字段", () => {
  const flakes = { flakes: [{ test: "f::t", firstRegistered: "2026-09-15", evidence: "fixture" }] };
  const failure = withAttribution({ conclusion: "failure", testFiles: 10 }, flakes);
  assert.ok(hasValidAttribution(failure), "failure 记录必须带词表内的 attribution");
  assert.ok(Array.isArray(failure.signals) && failure.signals.length > 0);

  for (const conclusion of ["success", "cancelled"]) {
    const rec = withAttribution({ conclusion, testFiles: 10 }, flakes);
    assert.equal("attribution" in rec, false, `${conclusion} 记录不得携带 attribution 字段`);
    assert.equal("signals" in rec, false, `${conclusion} 记录不得携带 signals 字段`);
  }
});

test("AC3 — writeCarrier 真落盘：failure 带 attribution、success 不带、重复 runId 不重复写", () => {
  const dir = tmpDir("carrier");
  const carrier = path.join(dir, ".quay", "ci-runs.jsonl");

  const batch = [
    { ts: "2026-09-15T02:38:35Z", workflow: "CI", branch: "develop", conclusion: "failure", runId: 1, testFiles: 631 },
    { ts: "2026-09-15T02:40:00Z", workflow: "CI", branch: "develop", conclusion: "success", runId: 2, testFiles: 640 },
  ];
  const first = writeCarrier(carrier, batch, null);
  assert.deepEqual({ appended: first.appended, skipped: first.skipped, attributed: first.attributed }, { appended: 2, skipped: 0, attributed: 1 });

  // 再写一遍同一批 ⇒ 全部被去重跳过
  const second = writeCarrier(carrier, batch, null);
  assert.equal(second.appended, 0);
  assert.equal(second.skipped, 2);

  const rows = fs.readFileSync(carrier, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 2, "重复采集不重复落盘");
  const red = rows.find((r) => r.runId === 1);
  const green = rows.find((r) => r.runId === 2);
  assert.ok(ATTRIBUTION_VOCAB.includes(red.attribution), JSON.stringify(red));
  assert.equal("attribution" in green, false, "success 记录不得带 attribution");
  assert.deepEqual([...existingKeys(carrier)].sort(), ["CI|1", "CI|2"]);
});

// ── 采集器：字段口径 + 离线缝 ─────────────────────────────────────────────────────────────
test("采集器 — ts 取 run 自己的时刻（⛔ 不是采集时刻），workflow 取显示名不是路径", () => {
  const r = buildRecord({
    id: 42,
    name: "CI",
    head_branch: "develop",
    conclusion: "failure",
    created_at: "2026-09-15T02:38:35Z",
    run_started_at: "2026-09-15T02:38:40Z",
    updated_at: "2026-09-15T02:56:46Z",
  });
  assert.equal(r.ts, "2026-09-15T02:38:35Z", "ts 必须是 run 的时刻");
  assert.equal(r.workflow, "CI", "workflow 必须是显示名（判据的 not in (None,'ci.yml','CI') 会静默跳过路径）");
  assert.equal(r.branch, "develop");
  assert.equal(r.conclusion, "failure");
  // 采集时刻不在记录里 —— 记录里根本不写采集时刻这个键
  for (const k of Object.keys(r)) assert.ok(!/collect/i.test(k), `记录不得含采集时刻字段: ${k}`);
});

test("采集器 — deriveTestFilesFromLog 取 __GROUP__ … files=N 的最大值；派生不出 ⇒ null（缺 ≠ 0）", () => {
  assert.equal(deriveTestFilesFromLog("__GROUP__ concurrency=8 files=631\nx"), 631);
  assert.equal(deriveTestFilesFromLog("__GROUP__ a files=12\n__GROUP__ b files=640"), 640);
  assert.equal(deriveTestFilesFromLog("no markers here"), null);
});

test("采集器 — parseJobTimeouts 只认 jobs: 块下的 per-job timeout-minutes", () => {
  const yaml = [
    "name: CI",
    "on:",
    "  push:",
    "jobs:",
    "  test:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 25",
    "  other:",
    "    timeout-minutes: 5",
    "  notimeout:",
    "    runs-on: ubuntu-latest",
  ].join("\n");
  assert.deepEqual(parseJobTimeouts(yaml), { test: 25, other: 5 });
});

test("采集器 — 离线缝走的是同一条 collect()：failure 记录落盘后带 attribution", () => {
  const runs = [
    {
      id: 7,
      name: "CI",
      head_branch: "develop",
      conclusion: "failure",
      created_at: "2026-09-15T02:38:35Z",
      run_started_at: "2026-09-15T02:38:40Z",
      updated_at: "2026-09-15T02:56:46Z",
    },
    { id: 8, name: "CI", head_branch: "develop", conclusion: "success", created_at: "2026-09-15T03:00:00Z", updated_at: "2026-09-15T03:10:00Z" },
  ];
  const jobsByRun = {
    "7": [
      {
        id: 70,
        name: "test",
        conclusion: "failure",
        started_at: "2026-09-15T02:38:40Z",
        completed_at: "2026-09-15T02:56:46Z",
        steps: [{ name: "Checkout", conclusion: "success" }, { name: "Run tests", conclusion: "failure" }],
      },
    ],
  };
  const { records, warnings } = collect({ repo: "o/n", runs, jobsByRun, testFilesByRun: { "7": 631 } });
  assert.deepEqual(warnings, []);
  assert.equal(records.length, 2);
  assert.equal(records[0].testFiles, 631);
  assert.equal(records[0].jobs[0].durationSec, 1086);

  const dir = tmpDir("offline");
  const carrier = path.join(dir, "ci-runs.jsonl");
  const res = writeCarrier(carrier, records, null);
  assert.equal(res.attributed, 1, "只有那一条 failure 被归因");
  const rows = fs.readFileSync(carrier, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(ATTRIBUTION_VOCAB.includes(rows[0].attribution));
  assert.equal("attribution" in rows[1], false);
});

test("采集器 — 登记表读不到 ⇒ loadKnownFlakes 返回 null（⛔ 不是空表）", () => {
  const dir = tmpDir("flakes");
  assert.equal(loadKnownFlakes(path.join(dir, "missing.json")), null);
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{ not json");
  assert.equal(loadKnownFlakes(bad), null);
  const shapeWrong = path.join(dir, "shape.json");
  fs.writeFileSync(shapeWrong, JSON.stringify({ flakes: [{ test: "x" }] }));
  assert.equal(loadKnownFlakes(shapeWrong), null, "缺 evidence/firstRegistered 的条目 = 读不懂");
  const ok = path.join(dir, "ok.json");
  fs.writeFileSync(ok, JSON.stringify({ flakes: [{ test: "x", firstRegistered: "2026-09-15", evidence: "e" }] }));
  assert.deepEqual(loadKnownFlakes(ok), { flakes: [{ test: "x", firstRegistered: "2026-09-15", evidence: "e" }] });
});

test("仓库自带的 known-flakes.json 可读且每条登记完整（防登记表悄悄变空）", () => {
  const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "known-flakes.json");
  const reg = loadKnownFlakes(p);
  assert.ok(reg !== null, "plugin/scripts/known-flakes.json 必须可读且格式合法");
  assert.ok(reg.flakes.length > 0, "登记表为空 ⇒ 永远判不出 known-flake");
  for (const f of reg.flakes) {
    assert.match(f.firstRegistered, /^\d{4}-\d{2}-\d{2}$/, `firstRegistered 形状: ${f.test}`);
    assert.ok(f.evidence.length > 40, `evidence 必须指向可复现读数: ${f.test}`);
  }
});
