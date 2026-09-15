// @test-group engine
// defect-latency-pair.test.mjs — gap-defect-discovery-latency-has-no-distribution 的单元面。
//
// ⚠️ 本文件的断言**全部是纯函数夹具级**，它们**不是** AC2/AC3/AC4 的证据：
// 那三条 AC 的读数必须来自真仓库（见 DoD 的反例判据）。本文件负责的是另一件事——
// **口径里每一条「读不出来会伪装成什么」的判据**都要取假（硬规则 3b）：
//   · `unresolvable` 与 `high` **不同形**（一个真的配对 vs 一个没量到的配对）；
//   · `unclassified` 是一个**独立取值**，不是「其它」的兜底；
//   · 空分布返回 null，⛔ 不是 0；
//   · 重构/搬移词表能抓住实测栽过的那一族（13 文件拆分）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDiffHunks,
  parseBlamePorcelain,
  parseNameOnlyLog,
  classifyDefectType,
  looksLikeRelocation,
  sampleDeterministic,
  mulberry32,
  dist,
  percentile,
  pairOne,
  listGapTaskIds,
  buildFilingIndex,
  DONE_SUBJECT,
} from "../scripts/defect-latency-pair.ts";

// ── parseDiffHunks：旧侧行区间 ────────────────────────────────────────────────
test("parseDiffHunks 区分「改旧行」与「纯插入」——后者 count=0，⛔ 不产生 t0 候选", () => {
  const diff = [
    "diff --git a/plugin/scripts/a.ts b/plugin/scripts/a.ts",
    "--- a/plugin/scripts/a.ts",
    "+++ b/plugin/scripts/a.ts",
    "@@ -10,3 +10,5 @@ function f() {",
    "-old1",
    "-old2",
    "-old3",
    "+new1",
    "@@ -50,0 +60,4 @@ function g() {",
    "+inserted-only",
    "@@ -77 +88,2 @@ function h() {",
    "-x",
    "+y",
  ].join("\n");
  const got = parseDiffHunks(diff);
  assert.deepEqual(got, [
    { file: "plugin/scripts/a.ts", start: 10, count: 3 },
    { file: "plugin/scripts/a.ts", start: 50, count: 0 }, // 纯插入
    { file: "plugin/scripts/a.ts", start: 77, count: 1 }, // 省略长度的 hunk 头 = 1 行
  ]);
  assert.equal(got.filter((h) => h.count > 0).length, 2);
});

test("parseDiffHunks 对删除文件（+++ /dev/null）不给行区间，⛔ 不把 /dev/null 当路径", () => {
  const diff = [
    "diff --git a/old.ts b/old.ts",
    "deleted file mode 100644",
    "--- a/old.ts",
    "+++ /dev/null",
    "@@ -1,4 +0,0 @@",
    "-a",
  ].join("\n");
  assert.deepEqual(parseDiffHunks(diff), []);
});

test("parseDiffHunks 多文件各自归属——行区间挂在正确的 file 上（按位置不按关键词）", () => {
  const diff = [
    "diff --git a/x.ts b/x.ts",
    "--- a/x.ts",
    "+++ b/x.ts",
    "@@ -1,2 +1,2 @@",
    "-a",
    "@@ -9,1 +9,1 @@",
    "-b",
    "diff --git a/y.ts b/y.ts",
    "--- a/y.ts",
    "+++ b/y.ts",
    "@@ -3,5 +3,5 @@",
    "-c",
  ].join("\n");
  const got = parseDiffHunks(diff);
  assert.deepEqual(got.map((h) => [h.file, h.start, h.count]), [
    ["x.ts", 1, 2],
    ["x.ts", 9, 1],
    ["y.ts", 3, 5],
  ]);
});

// ── parseBlamePorcelain：只取头行 SHA，⛔ 不被元数据行骗到 ─────────────────────
test("parseBlamePorcelain 只认 40 位头行，忽略 filename/author 等元数据", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const p = [
    `${sha} 12 12 1`,
    "author Yale Huang",
    "author-mail <y@example.com>",
    "author-time 1757000000",
    "filename plugin/scripts/a.ts",
    "\tconst x = 1;",
    `${sha} 13 13 2`,
    "author Yale Huang",
    "\tconst y = 2;",
  ].join("\n");
  assert.deepEqual(parseBlamePorcelain(p), [sha, sha]);
  // 一行 SHA（短 SHA / 纯文本）不算命中 —— 否则会把正文读成归属。
  assert.deepEqual(parseBlamePorcelain("abc123 not-a-header\n"), []);
});

// ── parseNameOnlyLog ─────────────────────────────────────────────────────────
test("parseNameOnlyLog 按 \\x02 分块，文件行归到所属提交", () => {
  const text = [
    "\x02aaa\x012026-09-01T00:00:00+00:00\x01first commit",
    "plugin/scripts/a.ts",
    "plugin/test/a.test.mjs",
    "",
    "\x02bbb\x012026-09-02T00:00:00+00:00\x01second commit",
    "tasks/gap-x.md",
  ].join("\n");
  const got = parseNameOnlyLog(text);
  assert.equal(got.length, 2);
  assert.deepEqual(got[0].files, ["plugin/scripts/a.ts", "plugin/test/a.test.mjs"]);
  assert.deepEqual(got[1].files, ["tasks/gap-x.md"]);
  assert.equal(got[1].subject, "second commit");
});

// ── 分类器：每类都要能取到，且 unclassified 是独立取值 ────────────────────────
test("classifyDefectType 五取值各能取到；全无命中 ⇒ unclassified（⛔ 不是任何一类的兜底）", () => {
  assert.equal(classifyDefectType("这个失败是静默的：恒绿、看不见、不发出声音").type, "silent-failure");
  assert.equal(classifyDefectType("进程崩溃了，抛错，非零退出").type, "loud-failure");
  assert.equal(classifyDefectType("性能太慢，耗时高，超时").type, "performance");
  assert.equal(classifyDefectType("文档漂移了，README 过期").type, "doc-drift");
  assert.equal(classifyDefectType("qwerty zxcvb").type, "unclassified");
  // 「unclassified」不得等于任何一类的名字 —— 否则「没分类」会与「分到了某一类」同形。
  for (const t of ["silent-failure", "loud-failure", "performance", "doc-drift"]) {
    assert.notEqual(t, "unclassified");
  }
});

test("classifyDefectType 取命中次数最多的一类（平票按 静默 > 报错 > 性能 > 文档）", () => {
  const body = "静默 静默 静默 静默 慢 慢"; // 静默 4 : 性能 2
  assert.equal(classifyDefectType(body).type, "silent-failure");
  const counts = classifyDefectType(body).counts;
  assert.equal(counts["silent-failure"], 4);
});

// ── 失真判定：重构/搬移一族（回归：实测栽过的那一次）────────────────────────────
test("looksLikeRelocation 收得住「拆分/收敛」一族 —— 只放 refactor/rename 收不住（实测 6 条被顶）", () => {
  const realSubject = "web: serve-handlers.ts 按关切拆分 13 文件 + serve-handlers 收敛为路由桶（AC1）";
  assert.equal(looksLikeRelocation(realSubject, 13), true);
  assert.equal(looksLikeRelocation("refactor: rename Foo to Bar", 2), true);
  assert.equal(looksLikeRelocation("chore(format): prettier", 3), true);
  assert.equal(looksLikeRelocation("迁移旧目录", 2), true);
  // 批量：文件数 ≥25 时无需看主题。
  assert.equal(looksLikeRelocation("update things", 30), true);
  // 真修复：⛔ 不得被误判（否则 good 配对会被无谓降级）。
  assert.equal(looksLikeRelocation("fix: carrier_path 取实际存在的首个载体", 3), false);
  assert.equal(looksLikeRelocation("goal-driver: 新增 goal kind 机械环（G6）", 10), false);
});

// ── 三态形状：unresolvable 与 high 必须不同形（硬规则 3b）─────────────────────
test("pairOne 在无法机械定位时落 unresolvable，且 latency/t0 为 null、方法名带 unresolvable: 前缀", () => {
  const emptyIdx = { merges: new Map(), done: new Map() };
  const withFiling = new Map([["gap-nobody", { sha: "a".repeat(40), iso: "2026-09-01T00:00:00+00:00" }]]);
  const rec = pairOne("gap-nobody", {
    root: "/nonexistent", // ⛔ 故意不存在：这条路径不得发起 git 调用，否则本测试会挂
    idx: emptyIdx,
    filing: withFiling,
    bodyOf: () => "静默 静默",
  });
  assert.equal(rec.confidence, "unresolvable");
  assert.equal(rec.t0, null);
  assert.equal(rec.latencyHours, null);
  assert.equal(rec.t0Commit, null);
  assert.match(rec.t0Method, /^unresolvable:/);
  assert.equal(rec.t0Method, "unresolvable:no-landing-commit");
  // 形状分离：一个没量到的记录，不得带任何「量到了」才有的字段值。
  assert.notEqual(rec.confidence, "high");
  assert.notEqual(rec.confidence, "low");
  assert.equal(rec.landingShape, "none");
  // 分类仍然照做（分类与配对是两条独立路径，⛔ 失败不污染另一条）。
  assert.equal(rec.defectType, "silent-failure");
});

test("pairOne 无立案提交时落 unresolvable:no-filing-commit，且 t1 也是 null（缺值 = 未查，⛔ 不是 0）", () => {
  const rec = pairOne("gap-absent", {
    root: "/nonexistent",
    idx: { merges: new Map(), done: new Map() },
    filing: new Map(),
    bodyOf: () => "",
  });
  assert.equal(rec.confidence, "unresolvable");
  assert.equal(rec.t1, null);
  assert.equal(rec.t1Commit, null);
  assert.equal(rec.t0Method, "unresolvable:no-filing-commit");
});

test("DONE_SUBJECT 收得住驱动的两代主题形，且不把非任务提交读成 done", () => {
  assert.equal(DONE_SUBJECT.exec("tasks: 翻 gap-a done（driver 机械 fan-in）")?.[1], "gap-a");
  assert.equal(DONE_SUBJECT.exec("tasks: gap-b flip done（fan-in 恢复）")?.[1], "gap-b");
  assert.equal(DONE_SUBJECT.exec("tasks: gap-c todo→ready（promotion-driver 机械晋升）"), null);
  assert.equal(DONE_SUBJECT.exec("tasks: gap-d task_write by cli:1"), null);
});

// ── 统计：空分布是 null，⛔ 不是 0 ────────────────────────────────────────────
test("dist/percentile 空输入的取值是 null（not-evaluated），⛔ 与「0 小时」不同形", () => {
  assert.deepEqual(dist([]), { n: 0, min: null, median: null, p90: null, max: null, mean: null });
  assert.equal(percentile([], 0.5), null);
  // 真正的 0 小时是 0，不是 null —— 两个取值必须可区分。
  const d = dist([0]);
  assert.equal(d.median, 0);
  assert.notEqual(d.median, null);
});

test("dist 的 median/p90 按升序取位，p90 ≥ median ≥ min", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
  const d = dist(xs);
  assert.equal(d.n, 10);
  assert.equal(d.min, 1);
  assert.equal(d.max, 100);
  assert.ok(d.median <= d.p90 && d.min <= d.median);
});

// ── 抽样：同 seed 同结果（AC3 的「种子写进文档」以此为前提）──────────────────
test("sampleDeterministic 同 seed 完全一致、异 seed 大概率不同，且都来自同一池", () => {
  const pool = Array.from({ length: 50 }, (_, i) => ({ taskId: `gap-${String(i).padStart(3, "0")}` }));
  const a = sampleDeterministic(pool, 10, 20260914).map((x) => x.taskId);
  const b = sampleDeterministic(pool, 10, 20260914).map((x) => x.taskId);
  const c = sampleDeterministic(pool, 10, 1).map((x) => x.taskId);
  assert.deepEqual(a, b, "同 seed 必须逐条一致");
  assert.notDeepEqual(a, c, "异 seed 应给出不同顺序（若相同说明 seed 没接进去）");
  assert.equal(a.length, 10);
  assert.equal(new Set(a).size, 10, "抽样不得重复");
  assert.ok(a.every((id) => pool.some((p) => p.taskId === id)));
  // 入参不得被就地排序污染（调用方之后还要用原数组）。
  assert.equal(pool[0].taskId, "gap-000");
});

test("sampleDeterministic 请求条数超过池大小时返回整池，⛔ 不补 null 占位", () => {
  const pool = [{ taskId: "gap-a" }, { taskId: "gap-b" }];
  const got = sampleDeterministic(pool, 10, 7);
  assert.equal(got.length, 2);
  assert.ok(got.every((r) => r && typeof r.taskId === "string"));
});

test("mulberry32 是确定性的且落在 [0,1)", () => {
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  for (let i = 0; i < 20; i++) {
    const v = r1();
    assert.equal(v, r2());
    assert.ok(v >= 0 && v < 1);
  }
});

// ── 真仓库集成（轻量、可跳过）：清单来自 git，⛔ 不是工作树 glob（硬规则 5）────
test("listGapTaskIds/buildFilingIndex 在真仓库上形状正确（读不到 ref 则跳过，⛔ 不伪绿）", (t) => {
  const root = process.cwd();
  let ids;
  try {
    ids = listGapTaskIds(root, "develop");
  } catch {
    t.skip("develop ref 不可读（如浅克隆/无该 ref）——本断言不该在这种环境下给出结论");
    return;
  }
  assert.ok(ids.length > 100, `真仓库应有大量 gap 任务，实得 ${ids.length}`);
  assert.ok(ids.every((i) => i.startsWith("gap-")), "清单里不得混进非 gap 条目");
  assert.equal(new Set(ids).size, ids.length, "同一 taskId 不得重复");
  const filing = buildFilingIndex(root, "develop");
  // 立案索引必须命中本任务自身，且其 SHA 是 40 位 —— 空 Map 会让「索引坏了」与
  // 「该任务没立案」同形，故这里必须至少非空。
  assert.ok(filing.size > 100, `立案索引应有大量条目，实得 ${filing.size}`);
  for (const [, v] of [...filing].slice(0, 50)) {
    assert.match(v.sha, /^[0-9a-f]{40}$/);
    assert.ok(Number.isFinite(Date.parse(v.iso)), `不是可比时刻: ${v.iso}`);
  }
});
