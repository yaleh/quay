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
    { entity: "session-liveness.sh", code: 5, hardcoded: 4, codeFiles: ["plugin/scripts/a.ts", "packages/quay/src/observation.ts"] },
    { entity: "gate-script-base.ts", code: 3, hardcoded: 0, codeFiles: ["plugin/scripts/c.ts"] },
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

test("AC1 — empty deletion report / no components ⇒ no P1 cluster", () => {
  assert.deepEqual(clusterDeletionReport({ components: [], dc: [], counts: { dcTotal: 0 } }), []);
  assert.deepEqual(clusterDeletionReport({ components: ["x.sh"], dc: [], counts: { dcTotal: 0 } }), []);
});

test("AC1 — deletionClosureComponents derives hardcoded>0 entities (top N)", () => {
  assert.deepEqual(deletionClosureComponents(IDENTITY, 3), ["session-liveness.sh"]);
  assert.deepEqual(deletionClosureComponents(IDENTITY, 0), []);
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
