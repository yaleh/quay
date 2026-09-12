// plugin/scripts/architecture-review-cluster.ts — 架构复核例程的机械聚类纯函数 + 判词载体单一真相源。
// (tasks/gap-quality-driver-architecture-review-routine)
//
// WHY THIS EXISTS：docs/proposals/archguard-generation-era-primitives.md §3 的五个直接量测度里，
// P1（Deletion Closure）/ P2（Identity Replication）/ P4（Guard Lineage）已各有独立检测器落地
// （deletion-closure-check.ts / identity-replication-check.ts / guard-lineage-check.ts），但除 P5 外
// 全部零周期调用——传感器建成了，缺的是把它们接上一个会转的轮子。本文件是那个轮子的确定性一半：
//
//   1. 机械聚类（复用既有脚本，⛔ 不重新实现三个检测器本身）：纯函数读三个检测器的 `--json` 输出，
//      聚合成统一的候选簇（每簇 = 涉及文件集 + 来源 primitive + 原始计数）。
//   2. P3（Artifact Liveness）无现成脚本 ⇒ 本任务不实现它，只在 primitive 词表里留一个来源占位
//      （P1/P2/P4 三个已有来源，P3 尚缺）——⛔ 不为凑够「五个 P」而现造一个空转实现。
//   3. 判词载体（.quay/architecture-review-round.jsonl）的写端单一真相源——driver 经同一函数写，
//      ⛔ 不各写一份（双 writer 同形，参照 verification-round / quality-round 的既有教训）。
//
// 三态（AC3，硬规则 3b）：judged = 判过且有结果；failed = 判词解析/执行失败；not-triggered = 机械
// 触发未命中（候选簇为空）。三者 state 取值不同，⛔ 「读不懂」不得与「合格」同形。判词为空不写空
// judged 记录（同 gap-pool-quality-verdicts-never-persisted AC1 的纪律）。
//
// 本文件不 auto-file 任务、不改任何任务 status（AC4 硬边界）——只产出读数。
//
// ── gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel ──────────────────
// 本文件新增【语义结论 → 立案】的确定性一半（判定仍归 LLM，算术/选取归 JS，同 ADR-033）：
//   1. `actionable`（judge 自己的结构化判定，三态 true/false/null）——见 ArchReviewClusterVerdict。
//   2. `actionableConclusions()` —— 从逐簇判词里取出**够格立案**的那些（PURE）。
//   3. `conclusionKey()` —— 结论的**稳定身份**（节流键）。⛔ 见其注释：易变量（DC 计数、
//      suggestedAction 措辞）不得参与，否则同一结论 42 次运行会得到 42 个键 ⇒ 42 条任务。
//   4. 提交台账（.quay/architecture-review-submissions.jsonl）——**节流**用，⛔ 不是第二套查重：
//      台账只回答「我们是否已经把这个结论交给过立案通道」，从不去读任务库判「是否已有任务认领它」
//      ——后者是 quay-file-task 技能的机制查重（单一实现，本文件不复制）。

import fs from "node:fs";
import path from "node:path";

// ── 来源 primitive（P3 占位，无现成脚本）────────────────────────────────────────────────────────
export const PRIMITIVES = ["P1", "P2", "P4"] as const;
export type Primitive = (typeof PRIMITIVES)[number];
/** P3（Artifact Liveness）无现成脚本——本任务不实现，只留此占位说明来源尚缺。 */
export const PRIMITIVE_P3_PLACEHOLDER = "P3";

// ── 三个检测器 `--json` 输出的【最小结构视图】（聚类消费的字段面，⛔ 不 import 检测器本体，
//    否则会把纯函数绑到它们的 fs/repo-root 重依赖上——strip-types 下 import 是运行时 import）─────

/** identity-replication-check.ts --json（P2）里聚类消费的面。 */
export interface IdentityReportView {
  pathConstants?: Array<{ file?: string }>;
  judgmentRewrites?: Array<{ file?: string }>;
  byteIdentical?: { count?: number; pairs?: Array<{ plugin?: string; experiment?: string }> };
  table?: Array<{ entity?: string; code?: number; hardcoded?: number; codeFiles?: string[] }>;
}

/** guard-lineage-check.ts --json（P4）里聚类消费的面。 */
export interface LineageReportView {
  suspicious?: Array<{ basename?: string; dir?: string }>;
  declared?: Array<{ basename?: string; dir?: string; present?: boolean | null }>;
}

/** deletion-closure-check.ts --json（P1）里聚类消费的面。 */
export interface DeletionReportView {
  components?: string[];
  dc?: string[];
  counts?: { dcTotal?: number; callGraphTotal?: number; ratio?: number | null };
}

// ── 候选簇 ──────────────────────────────────────────────────────────────────────────────────────

/** 一个候选簇：涉及文件集 + 来源 primitive + 原始计数。这是 judge 的语义判定输入。 */
export interface Cluster {
  clusterId: string;
  primitive: Primitive;
  files: string[];
  rawCount: number;
  label: string;
}

function uniqueSorted(items: (string | undefined)[]): string[] {
  return [...new Set(items.filter((x): x is string => typeof x === "string" && x.length > 0))].sort();
}

function relPath(dir: string | undefined, basename: string | undefined): string {
  if (!basename) return "";
  return dir ? `${dir}/${basename}` : basename;
}

/** P2 聚类：身份复制（字面量复制度 + 判定重写 + 字节相同对 + 路径字面量常量）。PURE。 */
export function clusterIdentityReport(r: IdentityReportView): Cluster[] {
  const out: Cluster[] = [];

  // 字节完全相同文件对（plugin/scripts ↔ experiments/*/scripts）——「复制替代抽象」的直接证据。
  const pairs = (r.byteIdentical?.pairs ?? []).filter((p) => p.plugin || p.experiment);
  if ((r.byteIdentical?.count ?? pairs.length) > 0) {
    out.push({
      clusterId: "P2-byte-identical-pairs",
      primitive: "P2",
      files: uniqueSorted(pairs.flatMap((p) => [p.plugin, p.experiment])),
      rawCount: r.byteIdentical?.count ?? pairs.length,
      label: `byte-identical plugin↔experiments file pairs (${r.byteIdentical?.count ?? pairs.length} pairs)`,
    });
  }

  // 判定重写：读 /proc/<pid>/cmdline ∧ 比较名字 ⇒ 识别进程，被独立实现多处。
  const rewrites = uniqueSorted((r.judgmentRewrites ?? []).map((j) => j.file));
  if (rewrites.length > 0) {
    out.push({
      clusterId: "P2-judgment-rewrites",
      primitive: "P2",
      files: rewrites,
      rawCount: rewrites.length,
      label: `process-identification judgment independently re-implemented ${rewrites.length}× (read /proc/<pid>/cmdline ∧ name-compare)`,
    });
  }

  // 路径字面量常量：产品源码硬编码 ../../../plugin/scripts/* 的 *_REL 常量。
  const pathConstants = uniqueSorted((r.pathConstants ?? []).map((c) => c.file));
  if (pathConstants.length > 0) {
    out.push({
      clusterId: "P2-path-constants",
      primitive: "P2",
      files: pathConstants,
      rawCount: pathConstants.length,
      label: `${pathConstants.length} *_REL path-literal constant(s) hardcoding plugin/scripts relative paths (import-graph invisible)`,
    });
  }

  // 逐实体字面量复制度：未经单一访问器（hardcoded>0）的实体。
  const entities = (r.table ?? [])
    .filter((row) => (row.hardcoded ?? 0) > 0 && typeof row.entity === "string" && row.entity.length > 0)
    .sort((a, b) => (b.hardcoded ?? 0) - (a.hardcoded ?? 0));
  for (const row of entities) {
    const entity = row.entity as string;
    out.push({
      clusterId: `P2-identity-${entity}`,
      primitive: "P2",
      files: uniqueSorted(row.codeFiles ?? []),
      rawCount: row.hardcoded ?? 0,
      label: `identity replication: "${entity}" named in ${row.hardcoded} code file(s) without a single accessor`,
    });
  }

  return out;
}

/** P4 聚类：守卫谱系（从未变红且未 mutation-verified 的可疑守卫 + 已声明但对象缺失的守卫）。PURE。 */
export function clusterLineageReport(r: LineageReportView): Cluster[] {
  const out: Cluster[] = [];

  const suspicious = (r.suspicious ?? []).filter((s) => s.basename);
  if (suspicious.length > 0) {
    out.push({
      clusterId: "P4-suspicious-guards",
      primitive: "P4",
      files: uniqueSorted(suspicious.map((s) => relPath(s.dir, s.basename))),
      rawCount: suspicious.length,
      label: `${suspicious.length} guard(s) never-fired and not mutation-verified (indistinguishable from broken)`,
    });
  }

  const missing = (r.declared ?? []).filter((d) => d.present === false);
  if (missing.length > 0) {
    out.push({
      clusterId: "P4-missing-guard-object",
      primitive: "P4",
      files: uniqueSorted(missing.map((d) => relPath(d.dir, d.basename))),
      rawCount: missing.length,
      label: `${missing.length} declared guard object(s) no longer present (file:<path> missing)`,
    });
  }

  return out;
}

/** P1 聚类：删除闭包（DC = 使构件不再存在而必须修改的文件集，剖面比 R=|DC|/|CallGraph|）。PURE。 */
export function clusterDeletionReport(r: DeletionReportView): Cluster[] {
  const components = (r.components ?? []).filter((c) => c.length > 0);
  const dc = uniqueSorted(r.dc ?? []);
  const dcTotal = r.counts?.dcTotal ?? dc.length;
  if (components.length === 0 || dc.length === 0) return [];
  const ratio = r.counts?.ratio ?? null;
  return [
    {
      clusterId: "P1-deletion-closure",
      primitive: "P1",
      files: dc,
      rawCount: dcTotal,
      label: `deletion closure of [${components.join(", ")}]: DC=${dcTotal} files, R=${ratio === null ? "n/a" : ratio.toFixed(2)}`,
    },
  ];
}

/** 从 identity 报告的逐实体复制度表推导 deletion-closure 的候选构件（hardcoded>0 的前 max 个）。PURE。 */
export function deletionClosureComponents(r: IdentityReportView, max = 3): string[] {
  return (r.table ?? [])
    .filter((row) => (row.hardcoded ?? 0) > 0 && typeof row.entity === "string" && row.entity.length > 0)
    .sort((a, b) => (b.hardcoded ?? 0) - (a.hardcoded ?? 0))
    .slice(0, max)
    .map((row) => row.entity as string);
}

/** 把三个检测器的 `--json` 输出聚合成统一的候选簇列表（确定性排序：rawCount desc → clusterId）。PURE。 */
export function clusterDetectorOutputs(args: {
  identity: IdentityReportView;
  lineage: LineageReportView;
  deletion: DeletionReportView;
}): Cluster[] {
  const clusters = [
    ...clusterIdentityReport(args.identity),
    ...clusterLineageReport(args.lineage),
    ...clusterDeletionReport(args.deletion),
  ];
  return clusters.sort((a, b) => b.rawCount - a.rawCount || a.clusterId.localeCompare(b.clusterId));
}

// ── 触发（机械，能取假：候选簇为空 ⇒ 不触发）────────────────────────────────────────────────────

export interface ArchReviewTrigger {
  fired: boolean;
  reasons: string[];
  clusterCount: number;
}

/** 机械触发：有候选簇 ⇒ 该 judge（⛔ 不设数值阈值——成本结构未知前不设字面量，硬规则 4 推论）。PURE。 */
export function computeArchReviewTrigger(clusters: Cluster[]): ArchReviewTrigger {
  const fired = clusters.length > 0;
  return { fired, reasons: fired ? [`candidate-clusters=${clusters.length}`] : [], clusterCount: clusters.length };
}

// ── 判词载体（.quay/architecture-review-round.jsonl — 逐簇判词的持久化载体）──────────────────────
// 三态（AC3，硬规则 3b）：judged / failed / not-triggered。写端单一真相源——driver 经本函数写。
// ⛔ 不 auto-file、不改 status（AC4 硬边界）。

export const ARCH_REVIEW_ROUND_REL = path.join(".quay", "architecture-review-round.jsonl");

/** 载体文件路径。gitignored 运行时态（与 quality-round.jsonl / gate-events.jsonl 同族）。 */
export function archReviewRoundPath(root: string): string {
  return path.join(root, ARCH_REVIEW_ROUND_REL);
}

/** 载体记录三态（AC3）。 */
export type ArchReviewState = "judged" | "failed" | "not-triggered";

/** 逐簇判词（≥5 键：clusterId/primitive/files/verdict/reasoning/judgedAt/round + suggestedAction/label）。 */
export interface ArchReviewClusterVerdict {
  clusterId: string;
  primitive: Primitive;
  files: string[];
  label: string;
  verdict: string;
  reasoning: string;
  suggestedAction: string;
  /** judge 对【该簇是否够格立案】的结构化判定（gap-arch-review-judge-verdicts-never-reach-…）。
   *  **三态**（硬规则 3b）：true = 够格立案；false = 判过且不够格（coincidental / 承重中心性）；
   *  null = **判词里读不出这个字段 ⇒ 未评估**——⛔ 不得与 false 同形（「读不懂装合格」的镜像：
   *  读不懂装成「判过且不立案」，会让接线后的收益恒为零而记录上什么都看不出来）。 */
  actionable: boolean | null;
  judgedAt: string;
  round: number;
}

/** 载体记录（一行 = 一次架构复核完成/失败/未触发的三态）。 */
export interface ArchReviewRoundRecord {
  round: number;
  judgedAt: string;
  state: ArchReviewState;
  triggerReasons: string[];
  clusterCount: number;
  clusters: ArchReviewClusterVerdict[];
  reason?: string;
}

/** 构造载体记录（单一真相源）。PURE。 */
export function buildArchReviewRoundRecord(args: {
  round: number;
  judgedAt: string;
  state: ArchReviewState;
  triggerReasons: string[];
  clusters: ArchReviewClusterVerdict[];
  reason?: string;
}): ArchReviewRoundRecord {
  const rec: ArchReviewRoundRecord = {
    round: args.round,
    judgedAt: args.judgedAt,
    state: args.state,
    triggerReasons: args.triggerReasons,
    clusterCount: args.clusters.length,
    clusters: args.clusters,
  };
  if (args.reason !== undefined) rec.reason = args.reason;
  return rec;
}

/** judge 输出的逐簇判词（schema：{clusterId, verdict, reasoning, suggestedAction, actionable}）。 */
export interface JudgeClusterVerdict {
  clusterId: string;
  verdict: string;
  reasoning: string;
  suggestedAction: string;
  /** 够格立案的判定（见 ArchReviewClusterVerdict.actionable 的三态说明）。缺失/非布尔 ⇒ 未评估。 */
  actionable?: unknown;
}

/** 把 judge 判词合并回簇（补齐 primitive/files/label/judgedAt/round + actionable 三态）。judge 没判到的
 *  簇不写（判词为空不写空记录——AC1 纪律）。PURE。 */
export function mergeClusterVerdicts(
  clusters: Cluster[],
  verdicts: JudgeClusterVerdict[],
  judgedAt: string,
  round: number,
): ArchReviewClusterVerdict[] {
  const byId = new Map(clusters.map((c) => [c.clusterId, c]));
  const out: ArchReviewClusterVerdict[] = [];
  for (const v of verdicts) {
    const c = byId.get(v.clusterId);
    if (!c) continue;
    out.push({
      clusterId: c.clusterId,
      primitive: c.primitive,
      files: c.files,
      label: c.label,
      verdict: v.verdict,
      reasoning: v.reasoning,
      suggestedAction: v.suggestedAction,
      // 三态（硬规则 3b）：只有 judge 明确给出布尔才取值，其余一律 null（未评估）——⛔ 不 default false。
      actionable: typeof v.actionable === "boolean" ? v.actionable : null,
      judgedAt,
      round,
    });
  }
  return out;
}

// ── 语义结论 → 立案（gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel）──
// 为什么在这里、为什么是这些函数：判定是 LLM 的（ADR-033「判定用 agent」），而**选取/去重/节流**
// 是确定性的算术，必须与判定分离且单一实现（「聚合用 JS 算术」）。driver 只负责 spawn 与传参。

/** 结论的稳定身份（节流键）：`<clusterId>|<verdict>`。PURE。
 *  ⛔ **易变量不得参与**——DC 计数（3196…3570）、`label` 里的 R=…、`suggestedAction` 的措辞每轮都变；
 *  若键包含它们，同一结论 42 次运行会得到 42 个不同的键 ⇒ 42 次立案，正是本任务要消灭的噪声。
 *  ✓ `verdict` **参与**：判定变了就是另一个结论（例：同一 P1 簇由 coincidental 变 abstract ⇒ 应立新案）
 *  ——这是节流「能取假」的那半边（见 architecture-review-cluster.test.mjs 的对照用例）。PURE。 */
export function conclusionKey(c: { clusterId: string; verdict: string }): string {
  return `${c.clusterId}|${c.verdict}`;
}

/** 从逐簇判词里取出**够格立案**的结论 + 未评估计数（硬规则 3b：两种「不立案」必须可区分）。PURE。
 *  - filable：actionable === true 的簇（每个一条结论，节流键去重后仍可能多条）。
 *  - notEvaluated：actionable === null 的 clusterId——判词没给这个字段，⛔ 不算「判过且不立案」。 */
export function actionableConclusions(merged: ArchReviewClusterVerdict[]): {
  filable: ArchReviewClusterVerdict[];
  notEvaluated: string[];
} {
  const filable: ArchReviewClusterVerdict[] = [];
  const notEvaluated: string[] = [];
  for (const v of merged) {
    if (v.actionable === true) filable.push(v);
    else if (v.actionable === null) notEvaluated.push(v.clusterId);
  }
  return { filable, notEvaluated };
}

/** 过滤掉已经提交过的结论（节流）。PURE——读台账是 IO，在这里只做集合运算（便于单测两态）。 */
export function unsentConclusions(
  filable: ArchReviewClusterVerdict[],
  submitted: ReadonlySet<string>,
): ArchReviewClusterVerdict[] {
  const seen = new Set<string>();
  const out: ArchReviewClusterVerdict[] = [];
  for (const v of filable) {
    const k = conclusionKey(v);
    if (submitted.has(k) || seen.has(k)) continue;  // 台账命中 or 本轮内重复
    seen.add(k);
    out.push(v);
  }
  return out;
}

// ── 提交台账（.quay/architecture-review-submissions.jsonl — 节流用，⛔ 不是第二套查重）──────────────
// **职责边界（本任务的 AC3 靠它取假）**：台账记录的是「我们是否已经把这个结论交给过立案通道」，
// 是**成本/噪声**层——防止同一结论每小时重新 spawn 一次 LLM agent（25+ 次同结论 = 25+ 次付费）。
// 它**从不**去读任务库、判「是否已有任务认领这个缺陷」——那是 `quay-file-task` 技能的**机制查重**
// （单一实现）。两层正交：查重保证「不重复立案」，节流保证「不为已知结论重复付费」。

export const SUBMISSION_LEDGER_REL = path.join(".quay", "architecture-review-submissions.jsonl");

/** 台账文件路径。gitignored 运行时态（与 architecture-review-round.jsonl 同族）。 */
export function submissionLedgerPath(root: string): string {
  return path.join(root, SUBMISSION_LEDGER_REL);
}

/** 台账一条：一个结论被交给立案通道一次。 */
export interface SubmissionRecord {
  key: string;
  clusterId: string;
  verdict: string;
  submittedAt: string;
  round: number;
}

/** 读台账的已提交键集。文件不存在 ⇒ 空集：**不存在是合法的首轮态**，⛔ 与「文件在但读不懂」不同形
 *  ——后者（坏行）被跳过；跳过只会让键少一个 ⇒ 至多多 spawn 一次，方向是 fail-open（⛔ 不会漏立案）。 */
export function readSubmittedKeys(root: string): Set<string> {
  const p = submissionLedgerPath(root);
  const keys = new Set<string>();
  if (!fs.existsSync(p)) return keys;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.key === "string" && rec.key.length > 0) keys.add(rec.key);
    } catch { /* 坏行跳过：节流键少一个 ⇒ 至多多 spawn 一次，不会漏立案（fail-open 方向安全） */ }
  }
  return keys;
}

/** 追加写提交台账（mkdir -p + append，一行一 JSON，⛔ 不截断）。 */
export function appendSubmission(root: string, record: SubmissionRecord): string {
  const p = submissionLedgerPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(record) + "\n", "utf8");
  return p;
}

/** 追加写一条载体记录（mkdir -p + append，一行一 JSON，⛔ 不截断）。state=judged 且判词为空时拒写。 */
export function appendArchReviewRound(root: string, record: ArchReviewRoundRecord): string {
  if (record.state === "judged" && record.clusters.length === 0) {
    throw new Error("refusing to write an empty judged architecture-review-round record (判词为空不写空记录)");
  }
  const p = archReviewRoundPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(record) + "\n", "utf8");
  return p;
}
