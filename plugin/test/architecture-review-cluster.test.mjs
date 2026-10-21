// @test-group engine
// architecture-review-cluster.test.mjs — gap-quality-driver-architecture-review-routine:
// 架构复核例程的机械聚类纯函数 + 判词载体（.quay/architecture-review-round.jsonl）写端。
//
// Coverage map (task ACs):
//   AC1 — clusterDetectorOutputs is deterministic: given fixed --json samples of the three
//         detectors (P1/P2/P4), it yields a fixed, ordered candidate-cluster list (unit-tested,
//         not eyeballed). Each cluster carries {clusterId, primitive, files, rawCount, label}.
//   AC3 — the carrier's states (judged / failed / not-triggered / not-evaluated) are distinct values;
//         an empty judged record is refused, and every record carries its per-detector states.
//   gap-architecture-review-not-triggered-lacks-per-detector-state — AC1 (any detector
//         evaluated:false ⇒ not-evaluated, never not-triggered), AC2 (not-triggered ⇒ every detector
//         evaluated && clusters empty, verified from the written jsonl), AC3 (detectors member shape).
//
// Run:
//   scripts/test.sh plugin/test/architecture-review-cluster.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARCH_REVIEW_DETECTOR_IDS,
  PRIMITIVES,
  appendArchReviewRound,
  archReviewRoundPath,
  buildArchReviewRoundRecord,
  clusterDetectorOutputs,
  clusterIdentityReport,
  clusterLineageReport,
  clusterDeletionReport,
  computeArchReviewTrigger,
  deletionClosureComponents,
  deletionDetectorEvaluation,
  detectorEvalFromSurface,
  classifyEvidenceSource,
  mergePriorFindingRulings,
  priorFindingsCheckState,
  readPriorRoundFindings,
  mergeClusterVerdicts,
} from "../scripts/architecture-review-cluster.ts";

// ── 固定样本（三个检测器的 --json 输出的最小结构视图）──────────────────────────────────────────

const IDENTITY = {
  pathConstants: [
    { file: "packages/quay/src/observation.ts", line: 2729, name: "SESSION_LIVENESS_REL", script: "session-liveness.sh", targetExists: true },
  ],
  judgmentRewrites: [
    { file: "plugin/scripts/manager-tick-readings.ts", line: 364 },
    { file: "plugin/scripts/worker-driver.ts", line: 100 },
  ],
  byteIdentical: {
    count: 1,
    pairs: [{ plugin: "plugin/scripts/foo.ts", experiment: "experiments/quay-perpetual-stream/scripts/foo.ts" }],
  },
  table: [
    // 成簇行：满足检测器判定 `hardcoded >= 5 && hardcoded > accessor`。⛔ 本 fixture 原先只写
    // `hardcoded: 4`（旧的裸计数判据 `hardcoded > 0` 放行）——下面 AC5 的两条对照用例把这个谓词钉死。
    { entity: "session-liveness.sh", code: 5, accessor: 0, hardcoded: 5, codeFiles: ["plugin/scripts/a.ts", "packages/quay/src/observation.ts"] },
    { entity: "gate-script-base.ts", code: 3, accessor: 231, hardcoded: 0, codeFiles: ["plugin/scripts/c.ts"] },
  ],
};

const LINEAGE = {
  suspicious: [
    { basename: "guard-a.ts", dir: "plugin/scripts" },
    { basename: "guard-b.ts", dir: "plugin/gate-scripts" },
  ],
  declared: [
    { basename: "guard-a.ts", dir: "plugin/scripts", kind: "file", present: false },
    { basename: "guard-c.ts", dir: "plugin/scripts", kind: "file", present: true },
    // gitignored 运行时载体 (gap-guard-lineage-runtime-carrier-not-evaluated): 在任何快照根上
    // present:null ∧ kind:"runtime" ⇒ ⛔ 不是「缺失对象」, 不得成簇。加进共享 fixture 让**每一条**
    // 既有聚类断言都在带 runtime 行的输入上跑（本行不改变任何簇的 id / rawCount / files）。
    { basename: "tick-log-guard.sh", dir: "plugin/scripts", kind: "runtime", present: null },
  ],
};

const DELETION = {
  components: ["session-liveness.sh"],
  dc: ["plugin/scripts/a.ts", "tasks/x.md"],
  counts: { dcTotal: 2, callGraphTotal: 1, ratio: 2 },
};

// ── AC1 · 机械聚类可复现 ──────────────────────────────────────────────────────────────────────

test("AC1 — clusterDetectorOutputs yields a fixed, ordered cluster list from fixed samples", () => {
  const once = clusterDetectorOutputs({ identity: IDENTITY, lineage: LINEAGE, deletion: DELETION });
  const twice = clusterDetectorOutputs({ identity: IDENTITY, lineage: LINEAGE, deletion: DELETION });
  assert.deepEqual(twice, once, "deterministic — same input ⇒ same output");
  assert.deepEqual(
    once.map((c) => c.clusterId),
    [
      "P2-identity-session-liveness.sh",
      "P1-deletion-closure",
      "P2-judgment-rewrites",
      "P4-suspicious-guards",
      "P2-byte-identical-pairs",
      "P2-path-constants",
      "P4-missing-guard-object",
    ],
    "rawCount desc, then clusterId asc",
  );
  for (const c of once) {
    assert.ok(PRIMITIVES.includes(c.primitive), `${c.clusterId} primitive ∈ {P1,P2,P4}`);
    assert.ok(Array.isArray(c.files), `${c.clusterId} has a files array`);
    assert.equal(typeof c.rawCount, "number", `${c.clusterId} rawCount is a number`);
    assert.ok(c.label.length > 0, `${c.clusterId} has a label`);
  }
});

test("AC1 — per-source clustering maps each detector's shape to clusters", () => {
  const identity = clusterIdentityReport(IDENTITY);
  assert.deepEqual(identity.map((c) => c.clusterId), [
    "P2-byte-identical-pairs",
    "P2-judgment-rewrites",
    "P2-path-constants",
    "P2-identity-session-liveness.sh",
  ]);
  // hardcoded=0 的实体不产簇（gate-script-base.ts 是共享模块负控制）。
  assert.ok(!identity.some((c) => c.clusterId.includes("gate-script-base")), "hardcoded=0 不产簇");

  const lineage = clusterLineageReport(LINEAGE);
  assert.deepEqual(lineage.map((c) => c.clusterId), ["P4-suspicious-guards", "P4-missing-guard-object"]);
  // runtime 载体 (tick-log-guard.sh) 不在缺失簇的 files 里 (硬规则 3b: 快照缺席 ≠ 已删)。
  const missing = lineage.find((c) => c.clusterId === "P4-missing-guard-object");
  assert.deepEqual(missing.files, ["plugin/scripts/guard-a.ts"], "只收真 file 对象的缺失");
  assert.equal(missing.rawCount, 1);

  const deletion = clusterDeletionReport(DELETION);
  assert.deepEqual(deletion.map((c) => c.clusterId), ["P1-deletion-closure"]);
  assert.equal(deletion[0].rawCount, 2);
  assert.match(deletion[0].label, /R=2\.00/);
});

// ── gap-guard-lineage-runtime-carrier-not-evaluated · AC4 ────────────────────────────────────────
// 两个方向都钉住（硬规则 2 两半）:
//   ① gitignored 运行时载体 ⇒ **不**产出 P4-missing-guard-object;
//   ② 真缺的 `file:` 对象  ⇒ **仍**产出该簇。
// 且判据必须是**按 kind 显式**的差分（不是靠 present:null 恰好 ≠ false 的隐式巧合）—— 下面第三条
// 对照把同一个 basename 的 kind 从 file 翻到 runtime 而 present 固定为 false：成簇与否必须跟着翻转。
test("AC4 — runtime 载体不成缺失簇; 真缺 file 对象仍成簇; 判据按 kind 而非 present 的巧合", () => {
  const rt = clusterLineageReport({
    declared: [{ basename: "manager-tick-log-check.sh", dir: "plugin/scripts", kind: "runtime", present: null }],
  });
  assert.deepEqual(rt.map((c) => c.clusterId), [], "runtime 载体 ⇒ 不产出 P4-missing-guard-object");

  const fileGone = clusterLineageReport({
    declared: [{ basename: "gone-check.ts", dir: "plugin/scripts", kind: "file", present: false }],
  });
  assert.deepEqual(fileGone.map((c) => c.clusterId), ["P4-missing-guard-object"], "真 file 对象缺失 ⇒ 簇照出");
  assert.equal(fileGone[0].rawCount, 1);
  assert.deepEqual(fileGone[0].files, ["plugin/scripts/gone-check.ts"]);

  // 差分对照: 同一 basename, present 固定 false, 只把 kind 从 file 翻到 runtime ⇒ 簇必须有/无翻转。
  // 若判据退回隐式的 `present === false`（不再看 kind），第二条断言立刻变红 —— 这就是「显式」的证据。
  const asFile = clusterLineageReport({ declared: [{ basename: "x-check.ts", dir: "plugin/scripts", kind: "file", present: false }] });
  const asRuntime = clusterLineageReport({ declared: [{ basename: "x-check.ts", dir: "plugin/scripts", kind: "runtime", present: false }] });
  assert.deepEqual(asFile.map((c) => c.clusterId), ["P4-missing-guard-object"]);
  assert.deepEqual(asRuntime.map((c) => c.clusterId), [], "整个 runtime 类永不成为缺失对象（即便它报 present:false）");
});

// ── 阈值谓词：cluster 阶段消费检测器自己的判定（gap-arch-review-cluster-ignores-detector-flag-predicate
//    AC5(a)/(b)）—— 两侧都要能取假：只做「过滤掉清白行」而不做「flagged=true 侧仍成簇」，等于把检测器
//    关掉（正是 identity-replication-check.ts 里那条注释自己担心的那件事）。
//    两个样本都是**实测过的真读数**：10/231 = gate-script-base.ts（检测器判清白，修前却成簇），
//    59/3 = quay-init.sh（真复制，修前后都必须成簇）。

test("AC5(a) — 检测器判清白的行（hardcoded=10 < accessor=231）不产出该簇", () => {
  const r = { table: [{ entity: "gate-script-base.ts", code: 241, accessor: 231, hardcoded: 10, codeFiles: ["plugin/scripts/a.ts"] }] };
  assert.deepEqual(
    clusterIdentityReport(r).map((c) => c.clusterId),
    [],
    "hardcoded < accessor ⇒ 大量文件走单一访问器引用（共享模块正常形态）⇒ ⛔ 不成簇",
  );
});

test("AC5(b) — 检测器判定 flagged 的行（hardcoded=59 > accessor=3）仍产出该簇", () => {
  const r = { table: [{ entity: "quay-init.sh", code: 62, accessor: 3, hardcoded: 59, codeFiles: ["plugin/scripts/a.ts"] }] };
  const ids = clusterIdentityReport(r).map((c) => c.clusterId);
  assert.deepEqual(ids, ["P2-identity-quay-init.sh"], "flagged ⇒ 仍成簇（阈值判定没被用来关掉检测器）");
  // rawCount 仍是裸 hardcoded 计数（判据是「成不成簇」，不是「报什么数」）。
  const c = clusterIdentityReport(r)[0];
  assert.equal(c.rawCount, 59);
});

test("AC5(a/b) 反向控制 — 同一份输入里两条行只在 accessor 上不同，成簇与否必须跟着翻转", () => {
  const row = (hardcoded, accessor) => ({ entity: "x.sh", code: hardcoded + accessor, accessor, hardcoded, codeFiles: ["plugin/scripts/a.ts"] });
  // 差分对照：hardcoded 不变（=59），只把 accessor 从 3 抬到 59 ⇒ 判定翻转。若 cluster 侧退回裸
  // `hardcoded > 0`，下面第二条断言立刻变红（hardcoded 两态都是 59 > 0）。
  assert.deepEqual(clusterIdentityReport({ table: [row(59, 3)] }).map((c) => c.clusterId), ["P2-identity-x.sh"]);
  assert.deepEqual(clusterIdentityReport({ table: [row(59, 59)] }).map((c) => c.clusterId), []);
});

// ── 判词必须与**这一行自己的读数**一致 (gap-identity-replication-requires-structural-relation AC4) ──
// 立案缺陷: 判词把「without a single accessor」写成了**字面量**, 与行上的 `accessor` 无关 ——
// 17 个 P2-identity-* 簇里 **14** 个在 `accessor > 0` 时照样这么断言 (最极端的 driver-runtime.ts
// 是 accessor=26)。读数与判词矛盾时仍输出同一句话 ⇒ 「查过且合格」与「没查成」共用输出 (硬规则 3b)。
// 两个方向都要钉住: accessor>0 **不得**断言独占; accessor=0 **必须**断言 —— 后者否证「把这句话删掉」
// 冒充修法 (删掉字面量能让前半条恒绿, 却把强断言在整个判据里弄丢)。

test("AC4 — 判词不得在 accessor>0 时断言 without a single accessor (=0 时必须断言)", () => {
  const row = (hardcoded, accessor) => ({ entity: "x.sh", code: hardcoded + accessor, accessor, hardcoded, codeFiles: ["plugin/scripts/a.ts"] });

  const partial = clusterIdentityReport({ table: [row(59, 3)] })[0];
  assert.equal(/without a single accessor/.test(partial.label), false,
    `accessor=3 ⇒ ⛔ 不得断言「没有单一访问器」, label=${partial.label}`);
  assert.match(partial.label, /3 file\(s\) reach it through an accessor/,
    "读数必须**出现在判词里** (不是把这句话删掉了事)");
  assert.match(partial.label, /59 code file\(s\)/, "hardcoded 计数仍在判词里");

  const exclusive = clusterIdentityReport({ table: [row(59, 0)] })[0];
  assert.match(exclusive.label, /without a single accessor/,
    "accessor=0 ⇒ 强断言必须仍然输出 (否则这条判据在真取真的那一半上被架空)");
});

// ── 判定重写计数收窄后的簇侧行为 (gap-identity-rewrite-count-includes-carve-outs AC5) ───────────
// 收窄把「哪些站点算判定重写」的类别判定收进检测器 (`classifyRewriteSite`)：`judgmentRewrites` 只剩
// **可合并到 kernel leaf 的**站点，非可合并的四类（test / `.sh` / 已 import leaf / repo-import-free
// `.mjs`）改经 `judgmentRewriteCarveOuts`（带类别 + 理由）在场。
// 本组两个方向都要钉住（硬规则 2 的另一半 = 零计数也要干跑已知真样本）：
//   · 列表为空 ⇒ ⛔ 不产出该簇（已 done 的 proc-identity 迁移机制不再每轮被重报）；
//   · 注入一个可合并站点 ⇒ **必须**重新产出（否则「不产出」与「判据坏死」在报告上同形）。
// ⛔ cluster 侧不另写一份过滤: 它读的就是检测器已收窄的列表（下游再过滤 = 硬规则 5b 违规）。

test("AC5 — 判定重写列表为空 ⇒ 不产出 P2-judgment-rewrites (不再重报已 done 机制)", () => {
  const ids = clusterIdentityReport({ judgmentRewrites: [] }).map((c) => c.clusterId);
  assert.deepEqual(ids, [], "0 个可合并站点 ⇒ 该簇缺席（检测到的 carve-out 不经此面）");
});

test("AC5 反向 — 注入一个可合并站点 ⇒ 该簇必须重新产出 (判据非恒假/非空转)", () => {
  const r = { judgmentRewrites: [{ file: "plugin/scripts/never-seen-before.ts", line: 7 }] };
  const clusters = clusterIdentityReport(r);
  assert.deepEqual(clusters.map((c) => c.clusterId), ["P2-judgment-rewrites"]);
  assert.equal(clusters[0].rawCount, 1);
  assert.deepEqual(clusters[0].files, ["plugin/scripts/never-seen-before.ts"]);
  assert.match(clusters[0].label, /independently re-implemented 1×/, "判词里的计数与读数一致");
});

test("AC5 — carve-out 字段不经簇面消费 (排除 ≠ 没扫到, 但 carve-out 不是簇的输入)", () => {
  // 同一份 --json 里另有一个 judgmentRewriteCarveOuts 列表；即使它非空，可合并列表为空就仍然不产簇。
  const ids = clusterIdentityReport({
    judgmentRewrites: [],
    judgmentRewriteCarveOuts: [
      { file: "plugin/scripts/os-anchor-watchdog.sh", line: 130, carveOut: "shell", carveOutReason: "shell carrier" },
      { file: "plugin/test/x.test.mjs", line: 1, carveOut: "test", carveOutReason: "test carrier" },
    ],
  }).map((c) => c.clusterId);
  assert.deepEqual(ids, [], "carve-out 不是可合并站点 ⇒ 不产簇 (它们由检测器的独立字段在场)");
});

test("AC1 — empty deletion report / no components ⇒ no P1 cluster", () => {
  assert.deepEqual(clusterDeletionReport({ components: [], dc: [], counts: { dcTotal: 0 } }), []);
  assert.deepEqual(clusterDeletionReport({ components: ["x.sh"], dc: [], counts: { dcTotal: 0 } }), []);
});

test("AC1 — deletionClosureComponents derives hardcoded>0 entities (top N)", () => {
  assert.deepEqual(deletionClosureComponents(IDENTITY, 3), ["session-liveness.sh"]);
  assert.deepEqual(deletionClosureComponents(IDENTITY, 0), []);
});

// ── AC3/AC5 · P1 候选构件选取与 P2 面共用 `isFlagged`（硬规则 5b：同一原则在 P1 面的未扫兄弟）──────
// 判据必须能取假：一张 below-threshold 的行排在 top-N 边界内，裸判据选它、`isFlagged` 判据不选它。
// ⛔ 本组第二条是「另一半能取假」——把 leak.ts 的 accessor 降到谓词之下后**仍须被选出**，
//    证明修法排的是「检测器判过清白」，不是把边界行一律丢掉（否则就是空转）。

/** AC3 的差分表：leak.ts 20/23 硬编码多但访问器更多（共享模块的正常形态），其余三行真越过谓词。 */
const BOUNDARY_TABLE = [
  { entity: "leak.ts", hardcoded: 20, accessor: 23 },
  { entity: "real.ts", hardcoded: 9, accessor: 2 },
  { entity: "real2.ts", hardcoded: 8, accessor: 3 },
  { entity: "real3.ts", hardcoded: 7, accessor: 4 },
];

test("AC3/AC5 — below-threshold boundary row is NOT selected as a P1 component", () => {
  // 修前（裸 `(row.hardcoded ?? 0) > 0`）选出 ["leak.ts","real.ts","real2.ts"] —— leak.ts 20/23 在列。
  // 修后（`isFlagged`）选出 ["real.ts","real2.ts","real3.ts"] —— leak.ts 被排除，真构件不被丢掉。
  assert.deepEqual(
    deletionClosureComponents({ table: BOUNDARY_TABLE }, 3),
    ["real.ts", "real2.ts", "real3.ts"],
  );
});

test("AC3/AC5 — 另一半能取假：越过谓词的边界行修后仍被选出", () => {
  // 只把 accessor 20/23 → 20/3（越过 `hardcoded > accessor && hardcoded >= 5`）⇒ 必须回到候选池。
  // 若修法写成「把 top-N 边界整段丢掉」或「按文件名/位置排除」，本条即变红。
  const crossed = BOUNDARY_TABLE.map((r) => (r.entity === "leak.ts" ? { ...r, accessor: 3 } : r));
  assert.deepEqual(
    deletionClosureComponents({ table: crossed }, 3),
    ["leak.ts", "real.ts", "real2.ts"],
  );
});

// ── 触发（能取假 + per-detector 三态：gap-architecture-review-not-triggered-lacks-per-detector-state）──
//
// AC1：任一 detector `evaluated:false` ⇒ state `not-evaluated`（⛔ 仍写 not-triggered 即假）。
// AC2：`not-triggered` 仅当 `detectors.every(d => d.evaluated && d.clusters.length === 0)`。
// AC3：每条 round 记录带 `detectors: [{id, evaluated, reason, clusters}]`。

/** 一条检测器自报态（input 侧，clusters 是簇对象）。 */
function probe(id, evaluated, clusters = [], reason = evaluated ? `${id} rootSurface full` : `${id} rootSurface absent`) {
  return { id, evaluated, reason, clusters };
}

/** 三个检测器**都评估过且无簇**的基准（not-triggered 的真条件）。 */
function allEvaluatedProbes() {
  return [
    probe(ARCH_REVIEW_DETECTOR_IDS.identity, true),
    probe(ARCH_REVIEW_DETECTOR_IDS.lineage, true),
    probe(ARCH_REVIEW_DETECTOR_IDS.deletion, true),
  ];
}

test("trigger — no detector probes ⇒ not-evaluated（空 every 恒真，⛔ 不返回 not-triggered）", () => {
  const t = computeArchReviewTrigger([]);
  assert.equal(t.fired, false);
  assert.equal(t.clusterCount, 0);
  assert.equal(t.state, "not-evaluated", "没有检测器读数时不得声称「都评估过」");
});

test("trigger — 三个检测器都评估过且无簇 ⇒ not-triggered（能取假）", () => {
  const t = computeArchReviewTrigger(allEvaluatedProbes());
  assert.equal(t.fired, false);
  assert.equal(t.state, "not-triggered");
  assert.equal(t.clusterCount, 0);
  assert.deepEqual(t.reasons, []);
  assert.deepEqual(t.detectors.map((d) => [d.id, d.evaluated, d.clusters.length]), [
    [ARCH_REVIEW_DETECTOR_IDS.identity, true, 0],
    [ARCH_REVIEW_DETECTOR_IDS.lineage, true, 0],
    [ARCH_REVIEW_DETECTOR_IDS.deletion, true, 0],
  ]);
});

test("AC1 — 任一 detector evaluated:false ⇒ state not-evaluated，且记录带该 detector 的 reason", () => {
  const probes = allEvaluatedProbes();
  probes[2] = probe(ARCH_REVIEW_DETECTOR_IDS.deletion, false, [], "no candidate components — candidate universe unknown");
  const t = computeArchReviewTrigger(probes);
  assert.equal(t.fired, false);
  assert.equal(t.state, "not-evaluated", "⛔ 不得写成 not-triggered（那会把「没有候选宇宙」读成「干净」）");
  assert.equal(t.detectors[2].evaluated, false);
  assert.match(t.detectors[2].reason, /candidate universe unknown/);
  assert.ok(t.reasons.some((r) => r.includes(ARCH_REVIEW_DETECTOR_IDS.deletion)),
    "not-evaluated 的 triggerReasons 必须点名未评估的 detector");
});

test("AC2 — 差分对照：只把 evaluated 从 true 翻到 false（其余不变）⇒ 状态必须翻转", () => {
  const clean = computeArchReviewTrigger(allEvaluatedProbes());
  assert.equal(clean.state, "not-triggered");
  assert.ok(clean.detectors.every((d) => d.evaluated && d.clusters.length === 0),
    "AC2 的蕴含在 clean 记录上取真");

  const probes = allEvaluatedProbes();
  probes[1] = probe(ARCH_REVIEW_DETECTOR_IDS.lineage, false);
  const flipped = computeArchReviewTrigger(probes);
  assert.equal(flipped.state, "not-evaluated", "同一输入只翻 evaluated ⇒ not-triggered 必须消失");
  assert.ok(!flipped.detectors.every((d) => d.evaluated && d.clusters.length === 0));
});

test("trigger — 有候选簇 ⇒ triggered；逐检测器 clusters 是 clusterId 数组（与合并列表同源）", () => {
  const merged = clusterDetectorOutputs({ identity: IDENTITY, lineage: LINEAGE, deletion: DELETION });
  const t = computeArchReviewTrigger([
    probe(ARCH_REVIEW_DETECTOR_IDS.identity, true, clusterIdentityReport(IDENTITY)),
    probe(ARCH_REVIEW_DETECTOR_IDS.lineage, true, clusterLineageReport(LINEAGE)),
    probe(ARCH_REVIEW_DETECTOR_IDS.deletion, true, clusterDeletionReport(DELETION)),
  ]);
  assert.equal(t.fired, true);
  assert.equal(t.state, "triggered");
  assert.equal(t.clusterCount, merged.length);
  assert.deepEqual(t.reasons, [`candidate-clusters=${merged.length}`]);
  for (const d of t.detectors) for (const id of d.clusters) assert.equal(typeof id, "string");
});

test("detectorEvalFromSurface — full ⇒ evaluated；absent / 缺失 ⇒ not-evaluated（两半都取假）", () => {
  assert.deepEqual(detectorEvalFromSurface({ kind: "full", note: null }, "P2"), {
    evaluated: true, reason: "P2 rootSurface full",
  });
  const absent = detectorEvalFromSurface({ kind: "absent", note: "no plugin/scripts under this root" }, "P2");
  assert.equal(absent.evaluated, false);
  assert.match(absent.reason, /no plugin\/scripts under this root/);
  const missing = detectorEvalFromSurface(undefined, "P2");
  assert.equal(missing.evaluated, false, "缺 rootSurface 字段 ⇒ ⛔ 不默认合格（硬规则 3b）");
  assert.match(missing.reason, /no rootSurface/);
});

test("deletionDetectorEvaluation — P1 候选宇宙派生自 P2：四种输入分别取到不同态", () => {
  // 上游评估过 + 零构件 ⇒ 空宇宙是测量结果。
  assert.equal(deletionDetectorEvaluation({ components: [], identityEvaluated: true }).evaluated, true);
  // 上游未评估 + 零构件 ⇒ 宇宙未知。
  const unknown = deletionDetectorEvaluation({ components: [], identityEvaluated: false });
  assert.equal(unknown.evaluated, false);
  assert.match(unknown.reason, /candidate universe unknown/);
  // 有构件但报告无 rootSurface ⇒ 覆盖范围读不出。
  assert.equal(deletionDetectorEvaluation({ components: ["x"], identityEvaluated: true }).evaluated, false);
  // 未知 kind ⇒ 同样不落进「评估过」（⛔ 读不懂 ≠ 合格）。
  assert.equal(
    deletionDetectorEvaluation({ components: ["x"], identityEvaluated: true, deletionSurface: { kind: "weird" } }).evaluated,
    false,
  );
  // 有构件 + partial ⇒ 评估过，但 reason 必须带检测器自己的 note（覆盖范围是读数的一部分）。
  const partial = deletionDetectorEvaluation({
    components: ["x"], identityEvaluated: true,
    deletionSurface: { kind: "partial", note: "root .claude/workflows absent" },
  });
  assert.equal(partial.evaluated, true);
  assert.match(partial.reason, /\.claude\/workflows absent/);
});

// ── AC3 · 四态可区分 + 判词合并 + 载体写端 ────────────────────────────────────────────────────

/** 载体侧 detectors（clusters 是 clusterId 数组）。 */
function detectorStates(probes = allEvaluatedProbes()) {
  return probes.map((p) => ({ id: p.id, evaluated: p.evaluated, reason: p.reason, clusters: p.clusters.map((c) => c.clusterId) }));
}

test("AC3 — four carrier states are distinct values; empty judged record refused", () => {
  const judgedAt = "2026-09-05T00:00:00.000Z";
  const round = 42;
  const clusters = clusterDetectorOutputs({ identity: IDENTITY, lineage: LINEAGE, deletion: DELETION });
  const verdicts = clusters.map((c) => ({ clusterId: c.clusterId, verdict: "abstract", reasoning: "r", suggestedAction: "a" }));
  const merged = mergeClusterVerdicts(clusters, verdicts, judgedAt, round);
  const detectors = detectorStates();

  const judged = buildArchReviewRoundRecord({ round, judgedAt, state: "judged", triggerReasons: ["candidate-clusters=7"], clusters: merged, detectors });
  const failed = buildArchReviewRoundRecord({ round, judgedAt, state: "failed", triggerReasons: [], clusters: [], detectors, reason: "x" });
  const notTriggered = buildArchReviewRoundRecord({ round, judgedAt, state: "not-triggered", triggerReasons: [], clusters: [], detectors, reason: "y" });
  const notEvaluated = buildArchReviewRoundRecord({ round, judgedAt, state: "not-evaluated", triggerReasons: ["detector-not-evaluated:P1-deletion-closure"], clusters: [], detectors, reason: "z" });

  assert.equal(judged.state, "judged");
  assert.equal(failed.state, "failed");
  assert.equal(notTriggered.state, "not-triggered");
  assert.equal(notEvaluated.state, "not-evaluated");
  assert.notEqual(judged.state, failed.state, "judged ≠ failed");
  assert.notEqual(failed.state, notTriggered.state, "failed ≠ not-triggered");
  assert.notEqual(notTriggered.state, notEvaluated.state, "not-triggered ≠ not-evaluated（本缺陷的核心可分性）");

  // 逐簇判词 ≥5 键（Plan 步骤 4）。
  assert.equal(judged.clusters.length, 7);
  for (const v of judged.clusters) {
    for (const k of ["clusterId", "primitive", "files", "verdict", "reasoning", "judgedAt", "round"]) {
      assert.ok(k in v, `cluster verdict must carry ${k}`);
    }
    assert.ok("suggestedAction" in v, "cluster verdict carries suggestedAction");
  }

  // AC3：**每条**记录都带 detectors，且成员带 id/evaluated/reason/clusters。
  for (const rec of [judged, failed, notTriggered, notEvaluated]) {
    assert.ok(Array.isArray(rec.detectors), `${rec.state} record carries a detectors array`);
    assert.equal(rec.detectors.length, 3);
    for (const d of rec.detectors) {
      for (const k of ["id", "evaluated", "reason", "clusters"]) {
        assert.ok(k in d, `${rec.state} detector ${d.id} carries ${k}`);
      }
      assert.equal(typeof d.evaluated, "boolean");
      assert.ok(Array.isArray(d.clusters));
    }
  }
});

test("AC3 — appendArchReviewRound writes one line per record; refuses empty judged and missing detectors", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const round = 1;
  const judgedAt = "2026-09-05T00:00:00.000Z";
  const detectors = detectorStates();

  const judged = buildArchReviewRoundRecord({
    round, judgedAt, state: "judged", triggerReasons: ["candidate-clusters=1"], detectors,
    clusters: [{ clusterId: "P1-deletion-closure", primitive: "P1", files: ["a.ts"], label: "l", verdict: "abstract", reasoning: "r", suggestedAction: "a", judgedAt, round }],
  });
  appendArchReviewRound(tmp, judged);
  appendArchReviewRound(tmp, buildArchReviewRoundRecord({ round, judgedAt, state: "not-triggered", triggerReasons: [], clusters: [], detectors }));
  appendArchReviewRound(tmp, buildArchReviewRoundRecord({ round, judgedAt, state: "not-evaluated", triggerReasons: [], clusters: [], detectors, reason: "ne" }));
  appendArchReviewRound(tmp, buildArchReviewRoundRecord({ round, judgedAt, state: "failed", triggerReasons: [], clusters: [], detectors, reason: "x" }));

  const p = archReviewRoundPath(tmp);
  const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 4, "one line per record (judged + not-triggered + not-evaluated + failed)");
  assert.deepEqual(lines.map((l) => JSON.parse(l).state), ["judged", "not-triggered", "not-evaluated", "failed"]);

  assert.throws(
    () => appendArchReviewRound(tmp, buildArchReviewRoundRecord({ round, judgedAt, state: "judged", triggerReasons: [], clusters: [], detectors })),
    /empty judged/,
    "空 judged 记录拒写",
  );
  assert.throws(
    () => appendArchReviewRound(tmp, {
      round, judgedAt, state: "failed", triggerReasons: [], clusterCount: 0, clusters: [], reason: "no detectors",
    }),
    /detectors/,
    "缺 detectors 的记录拒写（AC3 的载体不变式）",
  );
});

test("AC2 — 一条命令可从 round jsonl 验证：not-triggered 记录里每个检测器都 evaluated 且 clusters 为空", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-ac2-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const round = 3;
  const judgedAt = "2026-09-05T00:00:00.000Z";

  const clean = allEvaluatedProbes();
  const notEval = allEvaluatedProbes();
  notEval[0] = probe(ARCH_REVIEW_DETECTOR_IDS.identity, false, [], "identity rootSurface absent");

  appendArchReviewRound(tmp, buildArchReviewRoundRecord({
    round, judgedAt, state: "not-triggered", triggerReasons: [], clusters: [], detectors: detectorStates(clean),
  }));
  appendArchReviewRound(tmp, buildArchReviewRoundRecord({
    round, judgedAt, state: "not-evaluated", triggerReasons: ["detector-not-evaluated:P2"], clusters: [], detectors: detectorStates(notEval), reason: "x",
  }));

  // 这就是那条「一条命令」的判据（等价于 jq -e 'select(.state=="not-triggered") | all(.detectors[]; .evaluated and (.clusters|length==0))'）。
  const recs = fs.readFileSync(archReviewRoundPath(tmp), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const notTriggered = recs.filter((r) => r.state === "not-triggered");
  assert.equal(notTriggered.length, 1);
  for (const r of notTriggered) {
    assert.ok(r.detectors.every((d) => d.evaluated && d.clusters.length === 0), "not-triggered ⇒ 每个检测器都评估且无簇");
  }
  // 负控制：同一载体里存在一条 evaluated:false 的记录 ⇒ 上面那条蕴含不是靠「只有一种记录」恒真。
  assert.ok(recs.some((r) => r.state === "not-evaluated" && r.detectors.some((d) => !d.evaluated)));
});

test("AC3 — mergeClusterVerdicts skips unknown clusterIds and fills primitive/files/label", () => {
  const clusters = clusterDetectorOutputs({ identity: IDENTITY, lineage: LINEAGE, deletion: DELETION });
  const judgedAt = "2026-09-05T00:00:00.000Z";
  const merged = mergeClusterVerdicts(
    clusters,
    [
      { clusterId: "P1-deletion-closure", verdict: "abstract", reasoning: "r1", suggestedAction: "merge" },
      { clusterId: "no-such-cluster", verdict: "abstract", reasoning: "ghost", suggestedAction: "x" },
    ],
    judgedAt,
    7,
  );
  assert.equal(merged.length, 1, "unknown clusterId skipped");
  assert.equal(merged[0].clusterId, "P1-deletion-closure");
  assert.equal(merged[0].primitive, "P1");
  assert.ok(Array.isArray(merged[0].files));
  assert.equal(merged[0].round, 7);
  assert.equal(merged[0].judgedAt, judgedAt);
});

// ── 语义结论 → 立案（gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel）──
// 本文件的确定性一半：actionable 三态合并 / 结论键（节流身份）/ 够格选取 / 提交台账。

import {
  SUBMISSION_LEDGER_REL,
  actionableConclusions,
  appendSubmission,
  conclusionKey,
  mergeClusterVerdicts as mergeForFilings,
  readSubmittedKeys,
  submissionLedgerPath,
  unsentConclusions,
} from "../scripts/architecture-review-cluster.ts";

const FILING_CLUSTERS = clusterDetectorOutputs({ identity: IDENTITY, lineage: LINEAGE, deletion: DELETION });

function mergedWith(actionable) {
  return mergeForFilings(
    FILING_CLUSTERS,
    FILING_CLUSTERS.map((c, i) => ({ clusterId: c.clusterId, verdict: "coincidental", reasoning: "r", suggestedAction: "a", actionable: actionable[i] })),
    "2026-09-12T00:00:00.000Z",
    7,
  );
}

test("filings — actionable 三态：true/false 取值，缺失 ⇒ null（⛔ 不 default false，硬规则 3b）", () => {
  const merged = mergeForFilings(
    FILING_CLUSTERS,
    [
      { clusterId: FILING_CLUSTERS[0].clusterId, verdict: "abstract", reasoning: "r", suggestedAction: "a", actionable: true },
      { clusterId: FILING_CLUSTERS[1].clusterId, verdict: "coincidental", reasoning: "r", suggestedAction: "a", actionable: false },
      { clusterId: FILING_CLUSTERS[2].clusterId, verdict: "uncertain", reasoning: "r", suggestedAction: "a" },
      { clusterId: FILING_CLUSTERS[3].clusterId, verdict: "coincidental", reasoning: "r", suggestedAction: "a", actionable: "yes" },
    ],
    "2026-09-12T00:00:00.000Z",
    1,
  );
  assert.deepEqual(merged.map((v) => v.actionable), [true, false, null, null], "非布尔一律 null（未评估）");
  const { filable, notEvaluated } = actionableConclusions(merged);
  assert.deepEqual(filable.map((v) => v.clusterId), [FILING_CLUSTERS[0].clusterId], "只有 true 够格");
  assert.deepEqual(notEvaluated, [FILING_CLUSTERS[2].clusterId, FILING_CLUSTERS[3].clusterId], "false 不混进未评估");
  assert.equal(filable.length + notEvaluated.length, 3, "4 条判词里 false 那条两态都不进（判过且不立案）");
  assert.ok(!notEvaluated.includes(FILING_CLUSTERS[1].clusterId), "actionable=false ⛔ 不得被当成未评估");
});

test("filings — conclusionKey 只含稳定身份：易变量（DC 计数/措辞）参与就会造出 42 个键", () => {
  // 同一簇、同一 verdict，label / reasoning / suggestedAction 每轮都不同（生产 42 次运行的真实形态）。
  const a = { clusterId: "P1-deletion-closure", verdict: "coincidental", label: "DC=3196", suggestedAction: "exclude .archguard/output" };
  const b = { clusterId: "P1-deletion-closure", verdict: "coincidental", label: "DC=3566", suggestedAction: "keep as-is; re-run closure excluding worktree copies" };
  assert.equal(conclusionKey(a), conclusionKey(b), "易变量不参与 ⇒ 同一结论一个键（节流生效）");
  assert.equal(conclusionKey(a), "P1-deletion-closure|coincidental");
  // 能取假：判定变了就是另一个结论。
  assert.notEqual(conclusionKey(a), conclusionKey({ ...a, verdict: "abstract" }));
  assert.notEqual(conclusionKey(a), conclusionKey({ ...a, clusterId: "P2-path-constants" }));
});

test("filings — unsentConclusions 去台账命中 + 本轮内重复（PURE，两态）", () => {
  const merged = mergedWith([true, true, true, false]);
  const filable = actionableConclusions(merged).filable;
  assert.equal(filable.length, 3, "三个够格");
  const none = unsentConclusions(filable, new Set());
  assert.equal(none.length, 3, "台账空 ⇒ 全部待提交");
  const some = unsentConclusions(filable, new Set([conclusionKey(filable[0])]));
  assert.deepEqual(some.map((v) => v.clusterId), filable.slice(1).map((v) => v.clusterId), "已提交的不再入选");
  const all = unsentConclusions(filable, new Set(filable.map(conclusionKey)));
  assert.deepEqual(all, [], "全部已提交 ⇒ 零待提交（同一结论 25 次 ⇒ 只付一次费）");
  // 本轮内重复的簇（judge 给同一 clusterId 两条判词）只提交一次。
  const dup = unsentConclusions([filable[0], filable[0]], new Set());
  assert.equal(dup.length, 1, "同一键本轮只提交一次");
});

test("filings — 提交台账：不存在 ⇒ 空集；追加后可读；坏行跳过而不丢其余键", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-led-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  assert.equal(SUBMISSION_LEDGER_REL, path.join(".quay", "architecture-review-submissions.jsonl"));
  assert.equal(readSubmittedKeys(tmp).size, 0, "首轮无台账 ⇒ 空集（合法态，⛔ 不是读不懂）");
  appendSubmission(tmp, { key: "k1", clusterId: "c1", verdict: "abstract", submittedAt: "2026-09-12T00:00:00.000Z", round: 1 });
  appendSubmission(tmp, { key: "k2", clusterId: "c2", verdict: "coincidental", submittedAt: "2026-09-12T00:00:00.000Z", round: 1 });
  assert.deepEqual([...readSubmittedKeys(tmp)].sort(), ["k1", "k2"]);
  fs.appendFileSync(submissionLedgerPath(tmp), "{not json\n", "utf8");
  assert.deepEqual([...readSubmittedKeys(tmp)].sort(), ["k1", "k2"], "坏行跳过，其余键照读（⛔ 不整台账作废）");
  // 幂等：重复追加同一键不改变集合（读侧按集合语义）。
  appendSubmission(tmp, { key: "k1", clusterId: "c1", verdict: "abstract", submittedAt: "2026-09-12T01:00:00.000Z", round: 2 });
  assert.deepEqual([...readSubmittedKeys(tmp)].sort(), ["k1", "k2"]);
});

// ── gap-arch-review-judge-consumes-prior-round-findings ────────────────────────────────────────
// AC1：上一轮 findings 进 judge 输入，逐条三态写进**同一载体**（round jsonl）。
// AC2：resolved/denied 的依据必须是 current-source 核对（file:line / grep 命中），⛔ 不是
//      「任务库里有一条 done 任务」——后者在机械侧被降级为 not-evaluated（prompt 措辞不是执行点）。

function priorFinding(clusterId, priorVerdict = "abstract") {
  return {
    clusterId,
    primitive: "P2",
    label: `label for ${clusterId}`,
    files: ["plugin/scripts/a.ts"],
    priorVerdict,
    priorReasoning: "prior reasoning",
    priorSuggestedAction: "prior action",
    priorRound: 7,
    priorJudgedAt: "2026-10-20T00:00:00.000Z",
  };
}

function writeJudgedRound(tmp, round, clusters) {
  const detectors = detectorStates();
  const judgedAt = "2026-10-20T00:00:00.000Z";
  appendArchReviewRound(tmp, buildArchReviewRoundRecord({
    round,
    judgedAt,
    state: "judged",
    triggerReasons: ["candidate-clusters=1"],
    detectors,
    clusters: clusters.map((c) => ({
      clusterId: c.clusterId, primitive: c.primitive, files: c.files, label: c.label,
      verdict: c.verdict, reasoning: c.reasoning, suggestedAction: c.suggestedAction,
      actionable: null, judgedAt, round,
    })),
  }));
}

test("prior — classifyEvidenceSource：file:line / grep 命中是 current-source；任务库引用不是", () => {
  // 真·current-source 的两半都要认。
  assert.equal(classifyEvidenceSource("plugin/scripts/x.ts:42 still imports y"), "current-source", "file:line");
  assert.equal(classifyEvidenceSource("./plugin/scripts/x.ts:7 — no longer present"), "current-source", "./ 前缀");
  assert.equal(classifyEvidenceSource('grep -rn "Foo" plugin/scripts → 3 hits'), "current-source", "grep 命中");
  assert.equal(classifyEvidenceSource('grep -rn "Foo" plugin/scripts => 0'), "current-source", "grep 命中(=>)");
  // 任务库引用必须与 current-source 不同形（AC2 的负控制）。
  assert.equal(classifyEvidenceSource("tasks/gap-foo.md:1 says done"), "task-store", "tasks/<id>.md 是任务库，不是源码核对");
  assert.equal(classifyEvidenceSource("there is a done task for this"), "task-store", "done task");
  assert.equal(classifyEvidenceSource("任务库里有同标题 done 任务"), "task-store", "中文任务库引用");
  assert.equal(classifyEvidenceSource(""), "none");
  assert.equal(classifyEvidenceSource("looks fine to me"), "unrecognized", "既非 file:line 也非任务库 ⇒ 未识别（⛔ 不算核对过）");
  // ⛔ 光有 grep 命令、没有结果记号 ⇒ 不是命中（零命中也长这样）。
  assert.equal(classifyEvidenceSource('grep -rn "Foo" plugin/scripts'), "unrecognized");
});

test("prior — mergePriorFindingRulings：三态 + 未评估独立取值；无 current-source 依据的 resolved/denied 降级", () => {
  const prior = [priorFinding("c-survived"), priorFinding("c-resolved"), priorFinding("c-denied", "coincidental"), priorFinding("c-missing")];
  const rulings = mergePriorFindingRulings(prior, [
    { clusterId: "c-survived", state: "survived", evidence: "plugin/scripts/a.ts:10 still shows the duplication" },
    { clusterId: "c-resolved", state: "resolved", evidence: "grep -rn 'legacySymbol' plugin/scripts → 0 hits" },
    { clusterId: "c-denied", state: "denied", evidence: "plugin/scripts/a.ts:99 shows the two tables are pinned by a golden test, not drift" },
    // c-missing 没判词
  ]);
  assert.equal(rulings.length, 4, "对**每条** prior finding 都有恰好一条 ruling（⛔ 不因缺判词而少一条）");
  assert.deepEqual(rulings.map((r) => r.state), ["survived", "resolved", "denied", "not-evaluated"]);
  assert.deepEqual(rulings.map((r) => r.evidenceSource), ["current-source", "current-source", "current-source", "none"]);
  assert.ok(rulings[3].reason.includes("no ruling"), "缺判词必须带 reason（⛔ 不折叠成 denied）");
  // AC2 负控制：resolved/denied 只靠「任务库里有 done 任务」⇒ 必须降级为 not-evaluated。
  const taskStore = mergePriorFindingRulings(prior, [
    { clusterId: "c-resolved", state: "resolved", evidence: "tasks/gap-foo.md is done" },
    { clusterId: "c-denied", state: "denied", evidence: "a done task already covers this" },
  ]);
  assert.equal(taskStore[1].state, "not-evaluated", "task-store 依据不足以判 resolved");
  assert.equal(taskStore[1].evidenceSource, "task-store");
  assert.match(taskStore[1].reason, /current-source/);
  assert.equal(taskStore[2].state, "not-evaluated", "task-store 依据不足以判 denied");
  // 词表外取值 / judge 自己说 not-evaluated ⇒ 都是 not-evaluated，且原因可区分。
  const unknown = mergePriorFindingRulings([priorFinding("c1")], [{ clusterId: "c1", state: "fixed", evidence: "plugin/scripts/a.ts:1" }]);
  assert.equal(unknown[0].state, "not-evaluated");
  assert.match(unknown[0].reason, /unrecognized/);
  const selfNE = mergePriorFindingRulings([priorFinding("c1")], [{ clusterId: "c1", state: "not-evaluated", evidence: "could not locate the file" }]);
  assert.equal(selfNE[0].state, "not-evaluated");
  assert.match(selfNE[0].reason, /could not verify/);
  // rulings=null（旧裸数组形态的 judge 输出）⇒ 整批未评估，⛔ 不是「没有 prior findings」。
  const legacy = mergePriorFindingRulings(prior, null);
  assert.ok(legacy.every((r) => r.state === "not-evaluated"));
});

test("prior — priorFindingsCheckState：none/checked/partial/not-evaluated 四态互不同形；载体读不懂 ⇒ not-evaluated", () => {
  const prior = [priorFinding("c1"), priorFinding("c2")];
  const read = { state: "read", round: 7, judgedAt: "x", findings: prior };
  assert.equal(priorFindingsCheckState(priorFindingsReadNone(), []), "none", "没有上一轮 findings");
  const checked = mergePriorFindingRulings(prior, [
    { clusterId: "c1", state: "resolved", evidence: "plugin/scripts/a.ts:3 no longer present" },
    { clusterId: "c2", state: "survived", evidence: "plugin/scripts/b.ts:9 still present" },
  ]);
  assert.equal(priorFindingsCheckState(read, checked), "checked");
  const partial = mergePriorFindingRulings(prior, [{ clusterId: "c1", state: "survived", evidence: "plugin/scripts/a.ts:3" }]);
  assert.equal(priorFindingsCheckState(read, partial), "partial", "一半拿到三态 ⇒ partial");
  const noneRuled = mergePriorFindingRulings(prior, []);
  assert.equal(priorFindingsCheckState(read, noneRuled), "not-evaluated", "有 findings 但零判词 ⇒ not-evaluated");
  const unreadable = { state: "unreadable", round: null, judgedAt: null, findings: [], reason: "bad line" };
  assert.equal(priorFindingsCheckState(unreadable, []), "not-evaluated", "⛔ 载体读不懂不得与「没有 findings」同形");
});

function priorFindingsReadNone() {
  return { state: "none", round: null, judgedAt: null, findings: [], reason: "no carrier" };
}

test("prior — readPriorRoundFindings：取最后一条 judged 记录的逐簇判词（含被否认的）；中间坏行不影响，末行坏 ⇒ unreadable", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-prior-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  // 没有载体 ⇒ none（合法的首轮态，⛔ 不是 unreadable）。
  const first = readPriorRoundFindings(tmp);
  assert.equal(first.state, "none");
  assert.deepEqual(first.findings, []);

  writeJudgedRound(tmp, 7, [
    { clusterId: "P2-identity-x", primitive: "P2", files: ["a.ts"], label: "x", verdict: "abstract", reasoning: "dup", suggestedAction: "merge" },
    { clusterId: "P4-suspicious-guards", primitive: "P4", files: ["g.ts"], label: "g", verdict: "coincidental", reasoning: "preventive", suggestedAction: "keep" },
  ]);
  // 中间插一行坏 JSON + 一条更新的非 judged 记录：上一轮仍 = 最后一条 judged。
  fs.appendFileSync(archReviewRoundPath(tmp), "{broken middle line\n", "utf8");
  appendArchReviewRound(tmp, buildArchReviewRoundRecord({
    round: 8, judgedAt: "2026-10-20T01:00:00.000Z", state: "not-triggered", triggerReasons: [], clusters: [], detectors: detectorStates(),
  }));
  const read = readPriorRoundFindings(tmp);
  assert.equal(read.state, "read");
  assert.equal(read.round, 7);
  assert.deepEqual(read.findings.map((f) => f.clusterId), ["P2-identity-x", "P4-suspicious-guards"]);
  assert.deepEqual(read.findings.map((f) => f.priorVerdict), ["abstract", "coincidental"], "被否认的（coincidental）也在清单里");
  assert.equal(read.findings[0].priorReasoning, "dup");

  // 末行坏 ⇒ unreadable（⛔ 不得跳过它去用更早的记录——那会把「不知道」伪装成「上一轮是 7」）。
  fs.appendFileSync(archReviewRoundPath(tmp), "{broken last line\n", "utf8");
  const bad = readPriorRoundFindings(tmp);
  assert.equal(bad.state, "unreadable");
  assert.match(bad.reason, /not parseable/);
  assert.deepEqual(bad.findings, []);
});
