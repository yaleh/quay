// @test-group engine
// architecture-review-cluster.test.mjs — gap-quality-driver-architecture-review-routine:
// 架构复核例程的机械聚类纯函数 + 判词载体（.quay/architecture-review-round.jsonl）写端。
//
// Coverage map (task ACs):
//   AC1 — clusterDetectorOutputs is deterministic: given fixed --json samples of the three
//         detectors (P1/P2/P4), it yields a fixed, ordered candidate-cluster list (unit-tested,
//         not eyeballed). Each cluster carries {clusterId, primitive, files, rawCount, label}.
//   AC3 — the carrier's three states (judged / failed / not-triggered) are distinct values;
//         an empty judged record is refused (判词为空不写空记录).
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
    { basename: "guard-a.ts", dir: "plugin/scripts", present: false },
    { basename: "guard-c.ts", dir: "plugin/scripts", present: true },
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

  const deletion = clusterDeletionReport(DELETION);
  assert.deepEqual(deletion.map((c) => c.clusterId), ["P1-deletion-closure"]);
  assert.equal(deletion[0].rawCount, 2);
  assert.match(deletion[0].label, /R=2\.00/);
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

// ── 触发（能取假）─────────────────────────────────────────────────────────────────────────────

test("trigger — candidate clusters empty ⇒ not fired (能取假)", () => {
  assert.deepEqual(computeArchReviewTrigger([]), { fired: false, reasons: [], clusterCount: 0 });
  const fired = computeArchReviewTrigger(clusterDetectorOutputs({ identity: IDENTITY, lineage: LINEAGE, deletion: DELETION }));
  assert.equal(fired.fired, true);
  assert.equal(fired.clusterCount, 7);
  assert.ok(fired.reasons.length > 0);
});

// ── AC3 · 三态可区分 + 判词合并 + 载体写端 ────────────────────────────────────────────────────

test("AC3 — three carrier states are distinct values; empty judged record refused", () => {
  const judgedAt = "2026-09-05T00:00:00.000Z";
  const round = 42;
  const clusters = clusterDetectorOutputs({ identity: IDENTITY, lineage: LINEAGE, deletion: DELETION });
  const verdicts = clusters.map((c) => ({ clusterId: c.clusterId, verdict: "abstract", reasoning: "r", suggestedAction: "a" }));
  const merged = mergeClusterVerdicts(clusters, verdicts, judgedAt, round);

  const judged = buildArchReviewRoundRecord({ round, judgedAt, state: "judged", triggerReasons: ["candidate-clusters=7"], clusters: merged });
  const failed = buildArchReviewRoundRecord({ round, judgedAt, state: "failed", triggerReasons: [], clusters: [], reason: "x" });
  const notTriggered = buildArchReviewRoundRecord({ round, judgedAt, state: "not-triggered", triggerReasons: [], clusters: [], reason: "y" });

  assert.equal(judged.state, "judged");
  assert.equal(failed.state, "failed");
  assert.equal(notTriggered.state, "not-triggered");
  assert.notEqual(judged.state, failed.state, "judged ≠ failed");
  assert.notEqual(failed.state, notTriggered.state, "failed ≠ not-triggered");

  // 逐簇判词 ≥5 键（Plan 步骤 4）。
  assert.equal(judged.clusters.length, 7);
  for (const v of judged.clusters) {
    for (const k of ["clusterId", "primitive", "files", "verdict", "reasoning", "judgedAt", "round"]) {
      assert.ok(k in v, `cluster verdict must carry ${k}`);
    }
    assert.ok("suggestedAction" in v, "cluster verdict carries suggestedAction");
  }
});

test("AC3 — appendArchReviewRound writes one line per record; refuses empty judged", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const round = 1;
  const judgedAt = "2026-09-05T00:00:00.000Z";

  const judged = buildArchReviewRoundRecord({
    round, judgedAt, state: "judged", triggerReasons: ["candidate-clusters=1"],
    clusters: [{ clusterId: "P1-deletion-closure", primitive: "P1", files: ["a.ts"], label: "l", verdict: "abstract", reasoning: "r", suggestedAction: "a", judgedAt, round }],
  });
  appendArchReviewRound(tmp, judged);
  appendArchReviewRound(tmp, buildArchReviewRoundRecord({ round, judgedAt, state: "not-triggered", triggerReasons: [], clusters: [] }));
  appendArchReviewRound(tmp, buildArchReviewRoundRecord({ round, judgedAt, state: "failed", triggerReasons: [], clusters: [], reason: "x" }));

  const p = archReviewRoundPath(tmp);
  const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, 3, "one line per record (judged + not-triggered + failed)");
  assert.deepEqual(lines.map((l) => JSON.parse(l).state), ["judged", "not-triggered", "failed"]);

  assert.throws(
    () => appendArchReviewRound(tmp, buildArchReviewRoundRecord({ round, judgedAt, state: "judged", triggerReasons: [], clusters: [] })),
    /empty judged/,
    "空 judged 记录拒写",
  );
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
