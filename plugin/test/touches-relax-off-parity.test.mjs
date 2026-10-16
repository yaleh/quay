// @test-group engine
// touches-relax-off-parity.test.mjs — GOAL-037 AC-365（tasks/gap-touches-relax-off-parity-predicate）
//
// WHY THIS EXISTS：`touchesDisjointOrAged` 是 GOAL-037 整条生效路径（P1 shadow 观察 → P2 live 小名额
// → P4 评估）的前提。它必须在 `mode: off` 下与基线 `touchesDisjoint` **逐候选、逐顺序同形**，在
// `mode: shadow` 下**只标注不放行**。这两个态此前都不存在，也没有任何读数能证明同形。
//
// 判别力【不】来自「断言全绿」——恒真断言与真同形同构。判别力由两处提供：
//   ① AC2 的第三组输入：`mode: off` 但 `after_minutes` / `max_relaxed_inflight` **齐备**、且候选的
//      等待时长**确实超过** `after_minutes`。一个「只在『任务够老』上做判断、忘了先看 mode」的实现
//      会在这里放行 ⇒ 变红。（若 off 只是把基线委托一遍，一个只比「新谓词 vs 旧谓词」的断言会退化成
//      自证——硬规则 4：结构上不可能取假的量不是测量。配置块的存在**不得**泄漏进 off 决策。）
//   ② AC6 的两次取假注入：off 分支写成恒放行 / shadow 真的放行，各让本测试变红一次。
//
// Run: timeout 55 node --experimental-strip-types --test plugin/test/touches-relax-off-parity.test.mjs
//      （文件名与本任务 id 不同名 ⇒ 由 ## Touches 显式选中，⛔ 不改名）

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  TASK_FILTERS,
  applyTaskFilters,
  makeFilterContext,
  touchesDisjoint,
  touchesDisjointOrAged,
  RELAX_CONDITIONS,
} from "../scripts/driver-filters.ts";

// ── fixture ──────────────────────────────────────────────────────────────────────────────────────

/** 本文件建过的 fixture 根。顶层 `after()` 统一删（`tmp-leak-pairing-check` 要求 mkdtemp 有配对清理）。 */
const TMP_ROOTS = [];
after(() => {
  for (const d of TMP_ROOTS) fs.rmSync(d, { recursive: true, force: true });
});

/** 放宽账本的仓内相对路径。⛔ 字面量在此只用于「断言它**不存在**」这一件事——生产写入器/读取器在
 *  AC-363 的模块里，本条不读也不写它（影子期不产生放宽账本）。 */
const RELAXED_DISPATCH_REL = ".quay/relaxed-dispatch.jsonl";

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `touches-relax-parity-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  TMP_ROOTS.push(dir);
  return dir;
}

/** 写一个任务文件（fm 由调用方给；body 省略 ⇒ **没有** `## Touches` 节，用来造「空 Touches」
 *  与「读不出」两面——两者在 checkTouchesPair 下都判 serialize）。 */
function writeTask(root, id, touchesLines, fm) {
  const body = touchesLines === null ? "## Proposal\n\nprose\n" : `## Proposal\n\nprose\n\n## Touches\n\n${touchesLines}\n`;
  fs.writeFileSync(
    path.join(root, "tasks", `${id}.md`),
    `${fm ?? `---\nid: ${id}\nstatus: ready\n---`}\n\n${body}`,
    "utf8",
  );
}

/** 写 `.quay/config.yml`（真 `loop:` mapping；`relax` 为 null ⇒ **不写** touches_relax 块）。 */
function writeConfig(root, relax) {
  const lines = ["loop:", "  board: native"];
  if (relax !== null) {
    lines.push("  touches_relax:");
    for (const [k, v] of Object.entries(relax)) {
      if (Array.isArray(v)) {
        lines.push(`    ${k}:`);
        for (const el of v) lines.push(`      - ${el}`);
      } else {
        lines.push(`    ${k}: ${v}`);
      }
    }
  }
  fs.writeFileSync(path.join(root, ".quay", "config.yml"), `${lines.join("\n")}\n`, "utf8");
}

/** 追加一条真实的 v1 `to:"ready"` 状态事件（生产载体 `.quay/task-status-events.jsonl`）。 */
function appendReadyEvent(root, taskId, isoAt, seq) {
  const rec = {
    schema: "task-status-event/v1",
    seq,
    eventId: `fixture-evt-${seq}`,
    carrierEpoch: "fixture-epoch",
    taskId,
    from: "todo",
    to: "ready",
    kind: "forward",
    at: isoAt,
    recordedAt: isoAt,
    actor: { kind: "cli", id: "fixture" },
  };
  fs.appendFileSync(path.join(root, ".quay", "task-status-events.jsonl"), `${JSON.stringify(rec)}\n`, "utf8");
}

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

// ── 六面输入矩阵（AC2 逐字：无在飞 / 有重叠 / 无重叠 / 空 Touches / 通配声明 / 读不出的任务文件）──

const INFLIGHT = "gap-parity-inflight"; // 在飞对手：声明 plugin/scripts/shared.ts
const OVERLAP = "gap-parity-overlap"; // 与在飞对手重叠
const DISJOINT = "gap-parity-disjoint"; // 与在飞对手无重叠
const EMPTY = "gap-parity-empty"; // `## Touches` 节在但为空
const NOSEC = "gap-parity-nosec"; // 没有 `## Touches` 节
const GLOB = "gap-parity-glob"; // 通配声明（展开后与在飞对手重叠）
const MISSING = "gap-parity-missing"; // tasks/<id>.md 根本不存在 ⇒ 读不出
const DEPBLOCKED = "gap-parity-depblocked"; // touches 面【过得去】但被 depsSatisfied 挡住

/** 候选输入顺序（特征化断言读它——顺序本身就是被保护的量）。 */
const CANDIDATE_ORDER = [OVERLAP, DISJOINT, EMPTY, NOSEC, GLOB, MISSING, DEPBLOCKED, INFLIGHT];

/** fixture 里 `plugin/scripts/` 下的真实文件。**必须在 fixture 根下真存在**：`## Touches` 里的通配
 *  声明是经 `expandDeclaredTouches` 走**真 fs 遍历**展开的，若不建这一层，`plugin/scripts/*.ts` 会命中
 *  夹具根下的空目录/真实仓库树，面 5 就测不到「通配声明展开后与在飞对手重叠」这件事。 */
const FIXTURE_FILES = [
  "shared.ts",
  "inflight-only.ts",
  "overlap-only.ts",
  "disjoint-only.ts",
];

/** 装配六面矩阵的 fixture。真 tasks/*.md、真 plugin/scripts/*.ts、真 .quay/config.yml。 */
function buildMatrix(tag, relax, { inFlight } = {}) {
  const root = makeRoot(tag);
  writeConfig(root, relax);
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  for (const f of FIXTURE_FILES) fs.writeFileSync(path.join(root, "plugin", "scripts", f), "", "utf8");
  writeTask(root, INFLIGHT, "- plugin/scripts/shared.ts\n- plugin/scripts/inflight-only.ts");
  writeTask(root, OVERLAP, "- plugin/scripts/shared.ts\n- plugin/scripts/overlap-only.ts");
  writeTask(root, DISJOINT, "- plugin/scripts/disjoint-only.ts");
  writeTask(root, EMPTY, "- \n"); // 条目解析不出 ⇒ hasSection 在但 globs 空 ⇒ serialize
  writeTask(root, NOSEC, null); // 无节 ⇒ serialize
  // 通配声明：`plugin/scripts/*.ts` 展开到 shared.ts 等 ⇒ 与在飞对手重叠（面 5）。
  writeTask(root, GLOB, "- plugin/scripts/*.ts");
  // MISSING 不写盘 ⇒ 读不出（面 6）。
  // DEPBLOCKED：touches 面过得去（与在飞对手无重叠）但依赖读不出 ⇒ depsSatisfied 滤它。
  // 它让「被【非 touches】谓词滤掉」这件事在这组输入里真实发生（否则 touches-only 与全谓词的
  // 放行集合恒等，条件① 的输入就是空的）。
  writeTask(root, DEPBLOCKED, "- plugin/scripts/depblocked-only.ts", `---\nid: ${DEPBLOCKED}\nstatus: ready\ndepends_on:\n  - gap-parity-no-such-dep\n---`);
  const ctx = makeFilterContext(root, { inFlight: inFlight === undefined ? [INFLIGHT] : inFlight });
  return { root, ctx };
}

/** 跑一次**带 trace** 的真实过滤。 */
function runTraced(candidates, ctx) {
  const entries = [];
  const kept = applyTaskFilters(candidates, ctx, undefined, (e) => entries.push(e));
  return { kept, entries };
}

/** AC2 的**基线谓词序列**：把 `TASK_FILTERS` 里 touches 那一格换成基线 `touchesDisjoint`，其余四格
 *  逐个同一份实现。这样基线侧与实现侧过的是**同一组**非 touches 判定 ⇒ 两边的差只能来自 touches 那一格
 *  （⛔ 只算 touches 一个谓词会在「有在飞 / 无在飞」两面之外把 deps/needs-human 的滤除混进对照，
 *  那样的 deepEqual 比的不是同形）。 */
function baselineFilterList(ctx) {
  return TASK_FILTERS.map((f) => (f === touchesDisjointOrAged ? touchesDisjoint : f)).map((f) => f.predicate(ctx));
}
function baselineKept(candidates, ctx) {
  const preds = baselineFilterList(ctx);
  return candidates.filter((id) => preds.every((p) => p(id)));
}

const touchesEntries = (entries) => entries.filter((e) => e.filter === touchesDisjointOrAged.name);

// ══ AC2 ═══════════════════════════════════════════════════════════════════════════════════════════

test("AC2(a) — off 同形：三组配置 × 六面矩阵，逐元素 deepEqual（配置块的存在不泄漏进 off 决策）", (t) => {
  // ① 无 touches_relax 块 ② 显式 mode: off 且块为空 ③ mode: off 但阈值齐备（且候选【确实超过】阈值）
  const configs = [
    { name: "① 无 touches_relax 块", relax: null },
    { name: "② 显式 mode: off（块为空）", relax: { mode: "off" } },
    { name: "③ mode: off 且 after_minutes/max_relaxed_inflight 齐备", relax: { mode: "off", after_minutes: 30, max_relaxed_inflight: 0, shared_files: ["plugin/scripts/shared.ts"], never_relax: [] } },
  ];
  // 两组在飞：空集（面 1「无在飞」）与含对手（面 2/3/5/6）。
  const inFlightSets = [{ name: "无在飞", inFlight: [] }, { name: "有在飞对手", inFlight: [INFLIGHT] }];

  for (const [ci, cfg] of configs.entries()) {
    for (const [ii, set] of inFlightSets.entries()) {
      const { root, ctx } = buildMatrix(`ac2-${ci}-${ii}`, cfg.relax, { inFlight: set.inFlight });
      // 组 ③ 的 fixture 要有真实的等待读数，否则「候选确实超过 after_minutes」只是文字声称。
      if (ci === 2) {
        appendReadyEvent(root, OVERLAP, minutesAgo(90), 1); // 90 分钟 > 30 分钟
        appendReadyEvent(root, GLOB, minutesAgo(90), 2);
        appendReadyEvent(root, INFLIGHT, minutesAgo(5), 3);
      }
      const { kept } = runTraced(CANDIDATE_ORDER, ctx);
      const baseline = baselineKept(CANDIDATE_ORDER, ctx);
      assert.deepEqual(
        kept,
        baseline,
        `${cfg.name} / ${set.name}：新谓词的放行序列必须与基线 touchesDisjoint 逐元素相同\n` +
          `  实得 = ${JSON.stringify(kept)}\n  基线 = ${JSON.stringify(baseline)}`,
      );
      // 逐候选同形的**更强形式**：两侧的 touches 谓词对同一个 id 各自取值必须相同（不只是过滤后的集合
      // 相同——集合相同也可能来自两侧各错一处相互抵消）。
      const implPred = touchesDisjointOrAged.predicate(ctx);
      const basePred = touchesDisjoint.predicate(ctx);
      for (const id of CANDIDATE_ORDER) {
        assert.equal(
          implPred(id),
          basePred(id),
          `${cfg.name} / ${set.name}：${id} 上 touchesDisjointOrAged(${implPred(id)}) 必须等于 touchesDisjoint(${basePred(id)})`,
        );
      }
      // 非平凡前置：这组输入里确实有候选被【其它】谓词滤掉（否则条件① 的输入是空的，同形断言说服力下降）。
      const touchesOnly = CANDIDATE_ORDER.filter((id) => basePred(id));
      const all = baselineKept(CANDIDATE_ORDER, ctx);
      assert.ok(
        touchesOnly.length > all.length,
        `${cfg.name} / ${set.name}：矩阵里确实存在被非 touches 谓词滤掉的候选（touches-only=${touchesOnly.length} vs all=${all.length}）`,
      );
      console.log(`[AC2] ${cfg.name} / ${set.name}\n  实得 = ${JSON.stringify(kept)}\n  基线 = ${JSON.stringify(baseline)}`);
    }
  }
});

test("AC2(a) — 组 ③ 的等待读数【确实超过】after_minutes（否则该输入不具判别力）", (t) => {
  const { root, ctx } = buildMatrix("ac2-wait", { mode: "off", after_minutes: 30, max_relaxed_inflight: 5, shared_files: [], never_relax: [] }, { inFlight: [INFLIGHT] });
  appendReadyEvent(root, OVERLAP, minutesAgo(90), 1);
  appendReadyEvent(root, INFLIGHT, minutesAgo(5), 2);
  const { entries } = runTraced([OVERLAP, INFLIGHT], ctx);
  const mine = touchesEntries(entries).find((e) => e.task === OVERLAP);
  assert.ok(mine, "OVERLAP 有一条 touchesDisjointOrAged 条目（前置）");
  assert.ok(
    typeof mine.waitedMinutes === "number" && mine.waitedMinutes >= 30,
    `候选等待时长确实 >= after_minutes(30)：waitedMinutes=${mine.waitedMinutes}`,
  );
  console.log(`[AC2-前置] OVERLAP 条目 = ${JSON.stringify(mine)}（waitedMinutes=${mine.waitedMinutes} > after_minutes=30）`);
});

test("AC2(a) — off 下【恒不】出现 wouldRelax:true（无论配置块多齐备）", (t) => {
  for (const relax of [null, { mode: "off" }, { mode: "off", after_minutes: 30, max_relaxed_inflight: 5, shared_files: ["plugin/scripts/shared.ts"], never_relax: [] }]) {
    const { root, ctx } = buildMatrix(`ac2-norelax-${JSON.stringify(relax).length}`, relax, { inFlight: [INFLIGHT] });
    appendReadyEvent(root, OVERLAP, minutesAgo(90), 1);
    const { entries } = runTraced(CANDIDATE_ORDER, ctx);
    const mine = touchesEntries(entries);
    assert.ok(mine.length > 0, `有 touches 条目（前置）relax=${JSON.stringify(relax)}`);
    for (const e of mine) {
      assert.equal(e.wouldRelax, false, `off 下恒 false：${JSON.stringify(e)}`);
      assert.equal(e.relaxBlockedBy, null, `off 下恒 null：${JSON.stringify(e)}`);
    }
    console.log(`[AC2] off（relax=${JSON.stringify(relax)}）touches 条目 wouldRelax 全 false，条数=${mine.length}`);
  }
});

// ══ AC3 ═══════════════════════════════════════════════════════════════════════════════════════════

test("AC3(b) — shadow 决策同形：返回值与 off 逐元素 deepEqual，且观测面确实不同（有标注）", (t) => {
  const shadowRelax = { mode: "shadow", after_minutes: 30, max_relaxed_inflight: 5, shared_files: ["plugin/scripts/shared.ts"], never_relax: [] };
  const offFixture = buildMatrix("ac3-off", { mode: "off" }, { inFlight: [INFLIGHT] });
  const shadowFixture = buildMatrix("ac3-shadow", shadowRelax, { inFlight: [INFLIGHT] });
  for (const [fx, tag] of [[offFixture, "off"], [shadowFixture, "shadow"]]) {
    appendReadyEvent(fx.root, OVERLAP, minutesAgo(90), 1);
    appendReadyEvent(fx.root, INFLIGHT, minutesAgo(5), 2);
  }
  const off = runTraced(CANDIDATE_ORDER, offFixture.ctx);
  const shadow = runTraced(CANDIDATE_ORDER, shadowFixture.ctx);

  assert.deepEqual(
    shadow.kept,
    off.kept,
    `shadow 的放行结果必须与 off 完全相同\n  shadow = ${JSON.stringify(shadow.kept)}\n  off    = ${JSON.stringify(off.kept)}`,
  );
  assert.deepEqual(shadow.kept, baselineKept(CANDIDATE_ORDER, offFixture.ctx), "两态都等于基线");

  const offEntries = touchesEntries(off.entries);
  const shadowEntries = touchesEntries(shadow.entries);
  assert.ok(shadowEntries.length > 0, "shadow 下 touches 条目存在（观测面确实有东西）");
  assert.deepEqual(
    shadowEntries.map((e) => [e.task, e.blocker, e.overlapFiles, e.waitedMinutes]),
    offEntries.map((e) => [e.task, e.blocker, e.overlapFiles, e.waitedMinutes]),
    "两态的 touches 条目在前五键上逐条相同（标注是在同一批条目上追加的）",
  );
  assert.ok(shadowEntries.some((e) => e.wouldRelax === true), "shadow 下确实发生了标注（有 wouldRelax:true）");
  assert.ok(offEntries.every((e) => e.wouldRelax === false), "off 下没有任何 wouldRelax:true");
  console.log(`[AC3] shadow.kept = ${JSON.stringify(shadow.kept)}\n[AC3] off.kept    = ${JSON.stringify(off.kept)}`);
  console.log(`[AC3] shadow 条目 wouldRelax 分布 = ${JSON.stringify(shadowEntries.map((e) => [e.task, e.wouldRelax, e.relaxBlockedBy]))}`);
});

// ══ AC4 ═══════════════════════════════════════════════════════════════════════════════════════════

/** AC4 的 fixture：一个候选（RELAXABLE）与在飞对手（BLOCKER）在 `plugin/scripts/shared.ts` 上重叠，
 *  在 shadow 下满足全部五条件 ⇒ wouldRelax:true。`break` 用来**只破坏一个**条件。 */
function buildRelaxFixture(tag, breakWhich) {
  const CAND = "gap-relax-cand";
  const BLOCKER = "gap-relax-blocker";
  const root = makeRoot(tag);
  const relax = {
    mode: "shadow",
    after_minutes: 30,
    // 名额：默认 5（远大于已放宽数 0）⇒ 条件③ 通过。
    max_relaxed_inflight: breakWhich === "quota-available" ? 0 : 5,
    // 白名单：默认含重叠面 ⇒ 条件⑤ 通过；破坏时换成一条无关条目。
    shared_files: breakWhich === "overlap-shared" ? ["plugin/scripts/unrelated.ts"] : ["plugin/scripts/shared.ts"],
    // 名单：默认空 ⇒ 条件④ 通过；破坏时把候选写进去。
    never_relax: breakWhich === "not-never-relax" ? [CAND] : [],
  };
  writeConfig(root, relax);
  writeTask(root, BLOCKER, "- plugin/scripts/shared.ts\n- plugin/scripts/blocker-only.ts");
  writeTask(root, CAND, "- plugin/scripts/shared.ts\n- plugin/scripts/cand-only.ts");
  // 等待：默认 90 分钟 > 30 ⇒ 条件② 通过；破坏时**不写** ready 事件（waitedMinutes ⇒ null）。
  if (breakWhich !== "waited-enough") appendReadyEvent(root, CAND, minutesAgo(90), 1);
  appendReadyEvent(root, BLOCKER, minutesAgo(5), 2);
  const ctx = makeFilterContext(root, { inFlight: [BLOCKER] });
  return { root, ctx, CAND, BLOCKER };
}

test("AC4(b) — wouldRelax 与首个不满足条件：五条件各只破坏一条，relaxBlockedBy 逐字等于该条件 id", (t) => {
  // 正向：全满足 ⇒ true + null。
  const ok = buildRelaxFixture("ac4-ok", null);
  const okRun = runTraced([ok.CAND, ok.BLOCKER], ok.ctx);
  const okEntry = touchesEntries(okRun.entries).find((e) => e.task === ok.CAND);
  assert.ok(okEntry, "正向 fixture 有候选条目（前置）");
  assert.equal(okEntry.wouldRelax, true, `全满足 ⇒ wouldRelax:true；实得 ${JSON.stringify(okEntry)}`);
  assert.equal(okEntry.relaxBlockedBy, null, "全满足 ⇒ relaxBlockedBy:null");
  console.log(`[AC4] 全满足 ⇒ ${JSON.stringify(okEntry)}`);

  // 条件① touches-only-blocker：候选同时被另一个谓词挡住（notNeedsHuman ⇒ status 改 needs-human）。
  {
    const root = makeRoot("ac4-c1");
    writeConfig(root, { mode: "shadow", after_minutes: 30, max_relaxed_inflight: 5, shared_files: [], never_relax: [] });
    writeTask(root, "gap-relax-blocker", "- plugin/scripts/shared.ts");
    fs.writeFileSync(
      path.join(root, "tasks", "gap-relax-cand.md"),
      `---\nid: gap-relax-cand\nstatus: needs-human\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n- plugin/scripts/shared.ts\n`,
      "utf8",
    );
    appendReadyEvent(root, "gap-relax-cand", minutesAgo(90), 1);
    const ctx = makeFilterContext(root, { inFlight: ["gap-relax-blocker"] });
    const run = runTraced(["gap-relax-cand", "gap-relax-blocker"], ctx);
    const mine = touchesEntries(run.entries);
    const entry = mine.find((e) => e.task === "gap-relax-cand");
    assert.ok(entry, "候选有 touches 条目（它确实被 touches 挡住）");
    assert.equal(entry.wouldRelax, false, `被两个谓词挡住 ⇒ 不放宽：${JSON.stringify(entry)}`);
    assert.equal(entry.relaxBlockedBy, "touches-only-blocker", "首个不满足者 = touches-only-blocker");
    assert.ok(!run.kept.includes("gap-relax-cand"), "该候选仍在返回集合外（标注不改放行）");
    console.log(`[AC4-①] fixture 事实：候选 status=needs-human ⇒ notNeedsHuman 也滤它\n[AC4-①] 条目 = ${JSON.stringify(entry)}`);
  }

  // 条件② waited-enough：无 ready 事件 ⇒ waitedMinutes === null ⇒ 条件为假。
  {
    const f = buildRelaxFixture("ac4-c2", "waited-enough");
    const run = runTraced([f.CAND, f.BLOCKER], f.ctx);
    const entry = touchesEntries(run.entries).find((e) => e.task === f.CAND);
    assert.equal(entry.waitedMinutes, null, `fixture 事实：无 ready 记录 ⇒ waitedMinutes=null（实得 ${entry.waitedMinutes}）`);
    assert.equal(entry.wouldRelax, false, "缺值 ⇒ 条件为假（⛔ 不当 0）");
    assert.equal(entry.relaxBlockedBy, "waited-enough", "首个不满足者 = waited-enough");
    console.log(`[AC4-②] waitedMinutes=null ⇒ ${JSON.stringify(entry)}`);
  }

  // 条件③ quota-available：名额读数 = `ctx.relaxedInFlight ?? 0`。
  //  (i) 名额为 0 ⇒ 0 < 0 为假。
  {
    const f = buildRelaxFixture("ac4-c3", "quota-available");
    const run = runTraced([f.CAND, f.BLOCKER], f.ctx);
    const entry = touchesEntries(run.entries).find((e) => e.task === f.CAND);
    assert.equal(entry.wouldRelax, false, "名额为 0 ⇒ 不放宽");
    assert.equal(entry.relaxBlockedBy, "quota-available", "首个不满足者 = quota-available");
    console.log(`[AC4-③] max_relaxed_inflight=0（已放宽在飞 0）⇒ ${JSON.stringify(entry)}`);
  }
  //  (ii) 负控制：**同一份配置**下把「已放宽在飞数」提到名额上限 ⇒ 条件③ 变假（证明这条判据真的读
  //       `relaxedInFlight`，不是恒真/恒假）。影子期该数结构性为 0（不放行 ⇒ 无任务是被放宽派发的），
  //       live 下由 AC-366 从账本算出后经 ctx 传入——这里直接给 ctx，测的就是那一条判据本身。
  {
    const CAND = "gap-relax-cand";
    const BLOCKER = "gap-relax-blocker";
    const root = makeRoot("ac4-c3b");
    writeConfig(root, { mode: "shadow", after_minutes: 30, max_relaxed_inflight: 3, shared_files: ["plugin/scripts/shared.ts"], never_relax: [] });
    writeTask(root, BLOCKER, "- plugin/scripts/shared.ts\n- plugin/scripts/blocker-only.ts");
    writeTask(root, CAND, "- plugin/scripts/shared.ts\n- plugin/scripts/cand-only.ts");
    appendReadyEvent(root, CAND, minutesAgo(90), 1);
    const base = { inFlight: [BLOCKER] };
    const room = runTraced([CAND, BLOCKER], makeFilterContext(root, { ...base, relaxedInFlight: 2 }));
    const full = runTraced([CAND, BLOCKER], makeFilterContext(root, { ...base, relaxedInFlight: 3 }));
    const roomEntry = touchesEntries(room.entries).find((e) => e.task === CAND);
    const fullEntry = touchesEntries(full.entries).find((e) => e.task === CAND);
    assert.equal(roomEntry.wouldRelax, true, `已放宽 2 < 名额 3 ⇒ 通过：${JSON.stringify(roomEntry)}`);
    assert.equal(fullEntry.wouldRelax, false, `已放宽 3 = 名额 3 ⇒ 阻塞：${JSON.stringify(fullEntry)}`);
    assert.equal(fullEntry.relaxBlockedBy, "quota-available", "首个不满足者 = quota-available");
    console.log(`[AC4-③负控制] relaxedInFlight=2 ⇒ ${JSON.stringify(roomEntry)}\n[AC4-③负控制] relaxedInFlight=3 ⇒ ${JSON.stringify(fullEntry)}`);
  }

  // 条件④ not-never-relax：候选 id 在名单内。
  {
    const f = buildRelaxFixture("ac4-c4", "not-never-relax");
    const run = runTraced([f.CAND, f.BLOCKER], f.ctx);
    const entry = touchesEntries(run.entries).find((e) => e.task === f.CAND);
    assert.equal(entry.wouldRelax, false, "候选在 never_relax 名单内 ⇒ 不放宽");
    assert.equal(entry.relaxBlockedBy, "not-never-relax", "首个不满足者 = not-never-relax");
    console.log(`[AC4-④] never_relax=[${f.CAND}] ⇒ ${JSON.stringify(entry)}`);
  }

  // 条件⑤ overlap-shared：重叠面不在 shared_files 白名单内。
  {
    const f = buildRelaxFixture("ac4-c5", "overlap-shared");
    const run = runTraced([f.CAND, f.BLOCKER], f.ctx);
    const entry = touchesEntries(run.entries).find((e) => e.task === f.CAND);
    assert.equal(entry.wouldRelax, false, "重叠面不在白名单 ⇒ 不放宽");
    assert.equal(entry.relaxBlockedBy, "overlap-shared", "首个不满足者 = overlap-shared");
    console.log(`[AC4-⑤] shared_files=[plugin/scripts/unrelated.ts] vs 重叠 ${JSON.stringify(entry.overlapFiles)} ⇒ ${JSON.stringify(entry)}`);
  }

  // 条件 id 的兜底：五条都在导出的词表里（⛔ 不发明第六个条件）。
  assert.deepEqual(
    [...RELAX_CONDITIONS],
    ["touches-only-blocker", "waited-enough", "quota-available", "not-never-relax", "overlap-shared"],
    "条件词表就是这五条",
  );
});

// ══ AC5 ═══════════════════════════════════════════════════════════════════════════════════════════

test("AC5(c) — 影子期不产生放宽账本：shadow 运行后 .quay/relaxed-dispatch.jsonl 不存在", (t) => {
  const f = buildRelaxFixture("ac5", null);
  const ledgerPath = path.join(f.root, RELAXED_DISPATCH_REL);
  assert.equal(fs.existsSync(ledgerPath), false, "前置：运行前该路径不存在");
  const run = runTraced([f.CAND, f.BLOCKER], f.ctx);
  assert.ok(touchesEntries(run.entries).some((e) => e.wouldRelax === true), "前置：本轮确实产生了 wouldRelax:true（否则下面的「没写账本」是同义的）");
  assert.equal(fs.existsSync(ledgerPath), false, `${RELAXED_DISPATCH_REL} 在 shadow 运行后必须【不存在】`);
  assert.deepEqual(fs.readdirSync(path.join(f.root, ".quay")).sort(), ["config.yml", "task-status-events.jsonl"], ".quay/ 下只有 fixture 自己写的两件");
  console.log(`[AC5] ls .quay/ = ${JSON.stringify(fs.readdirSync(path.join(f.root, ".quay")))}（无 relaxed-dispatch.jsonl）`);
});

// ══ 全谓词负控制（AC2 的「同形」不是「两态都放行」的另一半）═══════════════════════════════════════

test("负控制 — 矩阵里确实有候选被 touches 挡下（若 off 恒放行，下面的非空断言即刻变红）", (t) => {
  const { root, ctx } = buildMatrix("neg-control", null, { inFlight: [INFLIGHT] });
  appendReadyEvent(root, OVERLAP, minutesAgo(90), 1);
  const baseline = baselineKept(CANDIDATE_ORDER, ctx);
  assert.ok(baseline.length < CANDIDATE_ORDER.length, `基线确实滤掉了候选（${CANDIDATE_ORDER.length} → ${baseline.length}）`);
  assert.ok(!baseline.includes(OVERLAP), "重叠候选在基线里被滤掉");
  assert.ok(!baseline.includes(GLOB), "通配候选在基线里被滤掉");
  assert.ok(!baseline.includes(MISSING), "读不出的候选在基线里被滤掉（fail-closed）");
  const { kept } = runTraced(CANDIDATE_ORDER, ctx);
  assert.deepEqual(kept, baseline, "新谓词与基线一致（这正是 off 同形断言的非平凡版本）");
  console.log(`[负控制] 基线滤掉 ${CANDIDATE_ORDER.length - baseline.length} 个；kept = ${JSON.stringify(kept)}`);
});
