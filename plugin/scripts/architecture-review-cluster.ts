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
// 四态（AC3 + gap-architecture-review-not-triggered-lacks-per-detector-state，硬规则 3b）：
// judged = 判过且有结果；failed = 判词解析/执行失败；not-triggered = **三个检测器都评估过**且候选簇为空；
// not-evaluated = 至少一个检测器没有候选宇宙/只覆盖了一部分（读不懂）。四者 state 取值不同，
// ⛔ 「没有东西可判」不得与「判过且干净」同形。判词为空不写空 judged 记录（同 gap-pool-quality-
// verdicts-never-persisted AC1 的纪律）。
//
// per-detector 状态（本模块的 `ArchReviewDetectorState`）是这条纪律的载体：每条 round 记录带
// `detectors: [{id, evaluated, reason, clusters}]`，于是下游（以及一条 jq 命令）能验证
// `state === "not-triggered" ⇒ detectors.every(d => d.evaluated && d.clusters.length === 0)`。
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

// ── 阈值谓词：与检测器【共用同一份实现】（本文件唯一的一处 import）────────────────────────────────
// 为什么破例 import：cluster 阶段曾用裸计数 `hardcoded > 0` 取代检测器自己的阈值判定
// (`hardcoded >= 5 && hardcoded > accessor`)，于是 25 个逐实体簇里 8 个是检测器**已经判过清白**的
// 假簇 —— 上游判过、下游不读，输出就与「查过且合格」同形（硬规则 3b）。**两份副本正是这个缺陷的
// 成因形态**，所以谓词只此一份，定义在 `identity-replication-check.ts`（那里是阈值判定的老家，
// 且是唯一能与 `sharedModuleControl` 共用的位置）。
// 代价如实记在此处：本模块被 esbuild 打进 driver bundle (`plugin/scripts/dist/*.js`) 时，检测器会被
// 一并内联。检测器只依赖 node 内建 + 三个纯模块，且其 CLI 由 `isDirectEntry(import.meta, …)` 守卫
// ——内联副本的 `import.meta.url` 是 bundle 路径，永远不等于期望 basename，⛔ 不会当 CLI 跑
// (driver-runtime.ts 的 bundle 重建与 `plugin/scripts/dist/*.js` 均不受影响)。
import { isFlagged } from "./identity-replication-check.ts";

// ── 三个检测器 `--json` 输出的【最小结构视图】（聚类消费的字段面，⛔ 不 import 检测器本体，
//    否则会把纯函数绑到它们的 fs/repo-root 重依赖上——strip-types 下 import 是运行时 import。
//    **唯一例外**：下面那个纯谓词 `isFlagged` —— 它正是本模块要消费、而上一版没消费的那个判定，
//    复制一份到这里就是本缺陷的成因形态，故宁可真 import 一次；代价与安全论证见其注释）─────────────

/** identity-replication-check.ts --json（P2）里聚类消费的面。 */
export interface IdentityReportView {
  pathConstants?: Array<{ file?: string }>;
  /** 判定重写（P2）—— 收窄后的语义：**可合并到 kernel leaf 的**站点。
   *  `judgmentRewriteCarveOuts`（同一检测器 `--json` 的另一个字段：检测到但结构上不可合并，
   *  每条带 `carveOut` 类别 + 理由）**刻意不被本模块消费** —— 它不是簇的输入，是「排除 ≠ 没扫到」
   *  的可区分性载体。⛔ 不要在这里对它再判一次。 */
  judgmentRewrites?: Array<{ file?: string }>;
  byteIdentical?: { count?: number; pairs?: Array<{ plugin?: string; experiment?: string }> };
  // `accessor`/`hardcoded` 是阈值谓词的两个操作数，行上都有（检测器的 LiteralReplication）——
  // ⛔ 不消费 `flagged`：那是 `sharedModuleControl`（单实体）独有的派生字段，`table[]` 行上没有
  // （照字面「读 row.flagged」读不到 ⇒ `undefined` ⇒ 判据恒真，硬规则 4）。
  table?: Array<{ entity?: string; code?: number; accessor?: number; hardcoded?: number; codeFiles?: string[] }>;
  /** 本检测器在 `--root` 上【扫描面】的在否（检测器自己的三态：full / absent）。
   *  这是 per-detector `evaluated` 的判据：`absent` 意味着那些读数**结构上取不到**，
   *  ⛔ 不得与「扫过且零命中」同形（gap-architecture-review-not-triggered-lacks-per-detector-state）。 */
  rootSurface?: { kind?: string; note?: string | null };
}

/** guard-lineage-check.ts --json（P4）里聚类消费的面。 */
export interface LineageReportView {
  suspicious?: Array<{ basename?: string; dir?: string }>;
  /** `kind` 是本模块**必须看见**的那个字段（gap-guard-lineage-runtime-carrier-not-evaluated）：
   *  `file` = 随仓入库、缺失即真删除；`invariant` = 无文件可指；`runtime` = gitignored 运行时载体
   *  （快照存在性不可判）。⛔ 只看 `present` 分不出「真缺」与「读不懂」——那正是本缺陷的成因形态。 */
  declared?: Array<{ basename?: string; dir?: string; kind?: string; present?: boolean | null }>;
  /** 守卫枚举面的在否（检测器自己的三态：full / absent）。per-detector `evaluated` 的判据。 */
  rootSurface?: { kind?: string; note?: string | null };
}

/** deletion-closure-check.ts --json（P1）里聚类消费的面。 */
export interface DeletionReportView {
  components?: string[];
  dc?: string[];
  counts?: { dcTotal?: number; callGraphTotal?: number; ratio?: number | null };
  /** 代码根覆盖面的在否（检测器自己的三态：full / partial）。per-detector `evaluated` 的判据：
   *  `partial` 表示闭包只覆盖了在场根 —— reason 里必须带上，⛔ 不静默当成完整读数。 */
  rootSurface?: { kind?: string; note?: string | null };
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

/** 逐实体复制度降序比较器——**P2 面（`clusterIdentityReport`）与 P1 面（`deletionClosureComponents`）
 *  共用同一份**，⛔ 不各写一遍（两处副本正是本文件那个缺陷的成因形态：同一判据在两个消费点各写一次，
 *  修了一处漏另一处 ⇒ 硬规则 5b）。只排序，⛔ 不是选取谓词——选取一律走 `isFlagged`。 */
function byHardcodedDesc(
  a: { hardcoded?: number },
  b: { hardcoded?: number },
): number {
  return (b.hardcoded ?? 0) - (a.hardcoded ?? 0);
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
  // ⛔ 此处**不再过滤一遍**：`judgmentRewrites` 已经是检测器按**类**收窄后的【可合并到 kernel leaf 的】
  //   站点；结构上不可合并的站点（test / `.sh` / 已 import leaf / repo-import-free `.mjs`）在检测器的
  //   `classifyRewriteSite` 里被排除，并以 `judgmentRewriteCarveOuts`（每条带类别 + 一行理由）**独立
  //   出现在同一份 `--json` 里** —— 它们是「排除」，不是「没扫到」。
  //   在这里再过滤一次就是同一判据的第二份实现（硬规则 5b：修一处漏另一处），与本文件顶部
  //   `isFlagged` 那条的成因形态完全相同。
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

  // 逐实体字面量复制度：**检测器判定 `flagged` 的实体**才成簇 —— `hardcoded >= 5 && hardcoded > accessor`，
  // 与 `sharedModuleControl` 共用同一份 `isFlagged`（见文件顶部的 import 注释）。
  // ⛔ 不是裸 `hardcoded > 0`：那恰好漏掉判据的另一半，把「大量文件走单一访问器引用、少数硬编码」
  //   （共享模块的正常形态，gate-script-base.ts 10/231 在列）也成簇 —— 25 簇里 8 簇如此。
  // ⛔ 也不是「把阈值调大」：调阈值仍会把检测器判过清白的行留在族里，同一缺陷换个数字复发。
  const entities = (r.table ?? [])
    .filter((row) => isFlagged(row) && typeof row.entity === "string" && row.entity.length > 0)
    .sort(byHardcodedDesc);
  for (const row of entities) {
    const entity = row.entity as string;
    // 判词必须与**这一行自己的读数**一致 (硬规则 3b: 读数与判词矛盾时仍输出同一句话, 就是让
    // 「查过且清白」与「没查成」共用输出)。旧判词把「without a single accessor」写成了字面量,
    // 于是 `accessor > 0` 的行照样这么断言 —— 立案实测: 17 个 P2-identity-* 簇里 **14** 个如此,
    // 最极端的 `P2-identity-driver-runtime.ts` 是 accessor=26 (gap-identity-replication-requires-structural-relation)。
    // ⇒ 强断言只在它**真的取真**时输出; 否则输出与读数一致的那一句。
    const hardcoded = row.hardcoded ?? 0;
    const accessor = row.accessor ?? 0;
    out.push({
      clusterId: `P2-identity-${entity}`,
      primitive: "P2",
      files: uniqueSorted(row.codeFiles ?? []),
      rawCount: hardcoded,
      label:
        accessor > 0
          ? `identity replication: "${entity}" named in ${hardcoded} code file(s) that carry no structural relation to it ` +
            `(a further ${accessor} file(s) reach it through an accessor — partial, not exclusive, replication)`
          : `identity replication: "${entity}" named in ${hardcoded} code file(s) without a single accessor`,
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

  // 缺失对象 = 判定**为 file 对象**且 present === false 的那些。gap-guard-lineage-runtime-carrier-
  //  not-evaluated：一个 gitignored 运行时载体（`runtime:` 声明）在任何快照根上结构性地不在，它的
  // 「快照里没有」不是删除 —— 检测器对它报 present:null ∧ kind:"runtime"。
  // ⛔ 这里**显式**按 kind 排除 runtime，而不是依赖「present:null 恰好 !== false」这种隐式巧合:
  //   ① 假若某个 runtime 声明因故报 present:false（检测器退化/旧版本输出），隐式判据会立刻把它
  //      误报成「已删」；显式判据在整个 runtime 类上取假，与本缺陷的成因形态解耦。
  //   ② 判据方向保持 fail-closed 的另一半: 真 `file:` 对象缺失（present:false ∧ kind ≠ runtime，
  //      含 kind 未知的输出）**仍然**成簇 —— 不得靠放宽阈值或吞掉缺失来消掉本缺陷。
  const missing = (r.declared ?? []).filter((d) => d.present === false && d.kind !== "runtime");
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

/** 从 identity 报告的逐实体复制度表推导 deletion-closure 的候选构件（**检测器判定 `isFlagged`
 *  的前 max 个**）。PURE。
 *
 *  ⛔ 不是裸 `(row.hardcoded ?? 0) > 0`：那是**同一个缺陷在 P1 面的未扫兄弟**（硬规则 5b）——
 *  `clusterIdentityReport()` 已改成消费 `isFlagged`（`hardcoded >= 5 && hardcoded > accessor`），
 *  本函数却仍按裸计数选取，于是检测器**已经判过清白**的共享模块（`hardcoded` 高但 `accessor` 更高：
 *  `gate-script-base.ts` 10/230、`touches-orthogonality-check.ts` 20/23…）照样作为「构件」被送进
 *  `deletion-closure-check.ts`，产出一条大而无意义的 DC。实测池 25 → 17，8 个已判清白的行退出。
 *  ⛔ 也不是「把 max 调小」或「调阈值」：那仍会把判过清白的行留在族里，同一缺陷换个数字复发。
 *  谓词只有一份实现（上面 import 的 `isFlagged`），与 P2 面共用，⛔ 不各写一遍。 */
export function deletionClosureComponents(r: IdentityReportView, max = 3): string[] {
  return (r.table ?? [])
    .filter((row) => isFlagged(row) && typeof row.entity === "string" && row.entity.length > 0)
    .sort(byHardcodedDesc)
    .slice(0, max)
    .map((row) => row.entity as string);
}

/** 逐检测器的候选簇（per-detector 状态的输入面）。PURE。 */
export interface DetectorClusters {
  identity: Cluster[];
  lineage: Cluster[];
  deletion: Cluster[];
}

/** 逐检测器聚类——**同一份** per-source 函数被 clusterDetectorOutputs 与 per-detector 状态共用，
 *  ⛔ 不各算一遍（两份计数必然漂移）。PURE。 */
export function clusterByDetector(args: {
  identity: IdentityReportView;
  lineage: LineageReportView;
  deletion: DeletionReportView;
}): DetectorClusters {
  return {
    identity: clusterIdentityReport(args.identity),
    lineage: clusterLineageReport(args.lineage),
    deletion: clusterDeletionReport(args.deletion),
  };
}

/** 把逐检测器簇合并成统一的候选簇列表（确定性排序：rawCount desc → clusterId）。PURE。 */
export function flattenDetectorClusters(d: DetectorClusters): Cluster[] {
  return [...d.identity, ...d.lineage, ...d.deletion]
    .sort((a, b) => b.rawCount - a.rawCount || a.clusterId.localeCompare(b.clusterId));
}

/** 把三个检测器的 `--json` 输出聚合成统一的候选簇列表（确定性排序：rawCount desc → clusterId）。PURE。 */
export function clusterDetectorOutputs(args: {
  identity: IdentityReportView;
  lineage: LineageReportView;
  deletion: DeletionReportView;
}): Cluster[] {
  return flattenDetectorClusters(clusterByDetector(args));
}

// ── 触发（机械，能取假：候选簇为空 ⇒ 不触发）────────────────────────────────────────────────────
// gap-architecture-review-not-triggered-lacks-per-detector-state：旧实现只问「簇是否为空」，于是
// 「三个检测器都评估过且干净」与「检测器没有候选宇宙（非 quay 树上的常态）」共用 `not-triggered`
// 这一个输出 —— 真实宿主 ClaudeCodeUI 的 83/83 轮全零就被读成「干净」。现在**每个检测器自报**
// evaluated/reason/clusters，触发判定据三分支：
//   · 有簇                         ⇒ triggered（照常判）
//   · 无簇 ∧ 每个检测器 evaluated   ⇒ not-triggered（这是「干净」的**真条件**）
//   · 无簇 ∧ 任一检测器未评估       ⇒ not-evaluated（⛔ 不伪装成干净）

/** 三个检测器在 per-detector 状态里的稳定身份（载体成员的 `id`）。 */
export const ARCH_REVIEW_DETECTOR_IDS = {
  identity: "P2-identity-replication",
  lineage: "P4-guard-lineage",
  deletion: "P1-deletion-closure",
} as const;

/** 一个检测器本轮的自报态（**输入侧**：clusters 是完整簇对象）。 */
export interface DetectorProbe {
  id: string;
  evaluated: boolean;
  reason: string;
  clusters: Cluster[];
}

/** 一个检测器本轮的自报态（**载体侧**：clusters 是 clusterId 数组——AC2 的
 *  `d.clusters.length === 0` 因而是可以从 round jsonl 直接求值的谓词）。 */
export interface ArchReviewDetectorState {
  id: string;
  evaluated: boolean;
  reason: string;
  clusters: string[];
}

export type ArchReviewTriggerState = "triggered" | "not-triggered" | "not-evaluated";

export interface ArchReviewTrigger {
  fired: boolean;
  reasons: string[];
  clusterCount: number;
  /** 三分支取值（见本节顶部注释）；`not-triggered` **仅当** `detectors.every(d => d.evaluated
   *  && d.clusters.length === 0)` 时成立（AC2 的蕴含关系由本函数构造性保证）。 */
  state: ArchReviewTriggerState;
  detectors: ArchReviewDetectorState[];
}

/** 机械触发：有候选簇 ⇒ 该 judge（⛔ 不设数值阈值——成本结构未知前不设字面量，硬规则 4 推论）。
 *  PURE。`detectors` 为空数组时 ⛔ 不返回 not-triggered（空 `every` 是恒真——硬规则 4：
 *  一个结构上不可能取假的读数不是测量）。 */
export function computeArchReviewTrigger(detectors: DetectorProbe[]): ArchReviewTrigger {
  const states: ArchReviewDetectorState[] = detectors.map((d) => ({
    id: d.id,
    evaluated: d.evaluated,
    reason: d.reason,
    clusters: d.clusters.map((c) => c.clusterId),
  }));
  const clusterCount = states.reduce((n, d) => n + d.clusters.length, 0);
  const fired = clusterCount > 0;
  const allEvaluatedAndClean = states.length > 0
    && states.every((d) => d.evaluated && d.clusters.length === 0);
  const state: ArchReviewTriggerState = fired
    ? "triggered"
    : allEvaluatedAndClean
      ? "not-triggered"
      : "not-evaluated";
  const reasons = fired
    ? [`candidate-clusters=${clusterCount}`]
    : state === "not-evaluated"
      ? states.filter((d) => !d.evaluated).map((d) => `detector-not-evaluated:${d.id}: ${d.reason}`)
      : [];
  return { fired, reasons, clusterCount, state, detectors: states };
}

/** 检测器自报的 `rootSurface` → (evaluated, reason)。PURE。
 *  `kind === "full"` ⇒ 本轮根上该检测器的面可读；其余（absent / 缺失 / 未知取值）⇒ 未评估，
 *  reason 带上检测器自己的 note（硬规则 3b：面不在 ≠ 扫过且干净；缺字段 ≠ 合格）。
 *  P2/P4 用本函数；P1 的候选宇宙由 P2 报告推导，故走 `deletionDetectorEvaluation`。 */
export function detectorEvalFromSurface(
  surface: { kind?: string; note?: string | null } | undefined,
  detector: string,
): { evaluated: boolean; reason: string } {
  if (!surface || typeof surface !== "object") {
    return {
      evaluated: false,
      reason: `${detector} output carries no rootSurface — cannot distinguish an absent scan surface from a measured-clean one`,
    };
  }
  if (surface.kind === "full") {
    return { evaluated: true, reason: `${detector} rootSurface full` };
  }
  const note = typeof surface.note === "string" && surface.note.trim().length > 0 ? surface.note.trim() : null;
  return {
    evaluated: false,
    reason: note ?? `${detector} rootSurface kind=${surface.kind ?? "(missing)"} — the scan surface is not present under this root`,
  };
}

/** P1 的候选宇宙**派生自 P2 报告**（`deletionClosureComponents`），因此它的 evaluated 也是派生的：
 *  · components 为空时：上游 identity 评估过 ⇒ 空宇宙是**测量结果**（evaluated:true，理由点名上游）；
 *    上游未评估 ⇒ 宇宙未知（evaluated:false）——⛔ 不让「上游没读成」伪装成「P1 判过且干净」。
 *  · components 非空时：检测器跑过 ⇒ evaluated:true；rootSurface 缺失 ⇒ false（覆盖范围读不出）；
 *    `partial` ⇒ 仍算评估过，但理由必须带上检测器自己的 note（覆盖范围是读数的一部分）。
 *  PURE。 */
export function deletionDetectorEvaluation(args: {
  components: string[];
  identityEvaluated: boolean;
  deletionSurface?: { kind?: string; note?: string | null };
}): { evaluated: boolean; reason: string } {
  if (args.components.length === 0) {
    return args.identityEvaluated
      ? {
          evaluated: true,
          reason: "no candidate components — upstream identity-replication evaluated and flagged none (measured-empty candidate universe)",
        }
      : {
          evaluated: false,
          reason: "no candidate components and upstream identity-replication was not evaluated — candidate universe unknown",
        };
  }
  const surface = args.deletionSurface;
  if (!surface || typeof surface !== "object") {
    return {
      evaluated: false,
      reason: "deletion-closure output carries no rootSurface — cannot distinguish a partial scan from a complete one",
    };
  }
  // 只认检测器自己的两个取值（full / partial）。未知取值 ⇒ 未评估（⛔ 「读不懂」不得落进
  // 「评估过」那一支——同硬规则 3b；这与 P2/P4 的 full-only 判据方向一致）。
  if (surface.kind !== "full" && surface.kind !== "partial") {
    return {
      evaluated: false,
      reason: `deletion-closure rootSurface kind=${surface.kind ?? "(missing)"} — unrecognized coverage reading`,
    };
  }
  const note = typeof surface.note === "string" && surface.note.trim().length > 0 ? surface.note.trim() : null;
  const caveat = surface.kind === "full"
    ? ""
    : ` (${note ?? `rootSurface kind=${surface.kind ?? "(missing)"}`})`;
  return {
    evaluated: true,
    reason: `deletion-closure evaluated over ${args.components.length} candidate component(s)${caveat}`,
  };
}

// ── 判词载体（.quay/architecture-review-round.jsonl — 逐簇判词的持久化载体）──────────────────────
// 四态（AC3 + gap-architecture-review-not-triggered-lacks-per-detector-state，硬规则 3b）：
// judged / failed / not-triggered / not-evaluated。写端单一真相源——driver 经本函数写。
// ⛔ 不 auto-file、不改 status（AC4 硬边界）。

export const ARCH_REVIEW_ROUND_REL = path.join(".quay", "architecture-review-round.jsonl");

/** 载体文件路径。gitignored 运行时态（与 quality-round.jsonl / gate-events.jsonl 同族）。 */
export function archReviewRoundPath(root: string): string {
  return path.join(root, ARCH_REVIEW_ROUND_REL);
}

/** 载体记录四态（AC3）。 */
export type ArchReviewState = "judged" | "failed" | "not-triggered" | "not-evaluated";

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

/** 上一轮被判过的簇（= 本轮要逐条复核的 prior finding）——**含被否认的**
 *  （`priorVerdict: "coincidental"` 的那些正是「上一轮说不成立」的结论，必须一起复核）。 */
export interface PriorFinding {
  clusterId: string;
  primitive: string;
  label: string;
  files: string[];
  priorVerdict: string;
  priorReasoning: string;
  priorSuggestedAction: string;
  priorRound: number;
  priorJudgedAt: string;
}

/** 一条 prior finding 的复核结论。**三态 + 未评估独立取值**（硬规则 3b）：
 *  survived = 缺陷在**当前源码**里仍可见；resolved = 上一轮指出的真缺陷已消失；denied = 上一轮的
 *  结论本身错了（误读）；not-evaluated = 给不出判定（⛔ 不折叠成 denied）。 */
export type PriorFindingState = "survived" | "resolved" | "denied" | "not-evaluated";

/** judge 一条 prior finding 判词的**依据来源**（机械派生，⛔ 不让读者自觉）：
 *  current-source = file:line 或 grep 命中（真的去看了源码）；
 *  task-store = 引用了任务库（`tasks/<id>.md` / 「done 任务」）——**不是** current-source 核对；
 *  none = 没给依据；unrecognized = 给了但两种形态都不像。 */
export type EvidenceSource = "current-source" | "task-store" | "none" | "unrecognized";

export interface PriorFindingRuling {
  clusterId: string;
  state: PriorFindingState;
  /** judge 给出的核对依据原文（current-source 时含 file:line / grep 命中）。 */
  evidence: string;
  evidenceSource: EvidenceSource;
  /** state==="not-evaluated" 时的原因（降级/缺判词/词表外取值）。 */
  reason?: string;
}

/** 本轮 prior-finding 复核的**聚合态**（写进载体，供下一轮/外部一条命令核对）：
 *  none = 没有上一轮 findings；checked = 每条都拿到了三态判词；partial = 一部分拿到；
 *  not-evaluated = 上一轮有 findings 但一条判词都没拿到（含载体读不懂）。 */
export type PriorFindingsCheckState = "none" | "checked" | "partial" | "not-evaluated";

/** 「上一轮」读出的结果（硬规则 3b：none / read / unreadable 三个取值互不同形）。 */
export interface PriorRoundRead {
  state: "none" | "read" | "unreadable";
  round: number | null;
  judgedAt: string | null;
  findings: PriorFinding[];
  reason?: string;
}

/** 写进载体的上一轮元信息（不含 findings 本体——本体在 `priorFindings` 的逐条判词里）。 */
export interface ArchReviewPriorRound {
  state: PriorRoundRead["state"];
  round: number | null;
  judgedAt: string | null;
  findingCount: number;
  reason?: string;
}

/** 载体记录（一行 = 一次架构复核完成/失败/未触发/未评估）。 */
export interface ArchReviewRoundRecord {
  round: number;
  judgedAt: string;
  state: ArchReviewState;
  triggerReasons: string[];
  clusterCount: number;
  clusters: ArchReviewClusterVerdict[];
  /** per-detector 自报态（AC3）：**每条**记录都带，故「not-triggered 蕴含每个检测器都评估过且没有簇」
   *  可以从载体本身一条命令验证（硬规则 3b：读数必须能取假）。 */
  detectors: ArchReviewDetectorState[];
  /** 上一轮元信息 + 逐条 prior-finding 三态（gap-arch-review-judge-consumes-prior-round-findings）。
   *  只在 **judged** 记录上出现：非 judged 记录里 judge 没跑，不存在「逐条复核过」这件事。 */
  priorRound?: ArchReviewPriorRound;
  priorFindings?: PriorFindingRuling[];
  priorFindingsState?: PriorFindingsCheckState;
  reason?: string;
}

/** 构造载体记录（单一真相源）。PURE。`detectors` 必填：漏传时构造出来的记录无法回答
 *  「本轮每个检测器到底评估过没有」，正是本缺陷要消灭的形状（⛔ 不 default 成 []）。 */
export function buildArchReviewRoundRecord(args: {
  round: number;
  judgedAt: string;
  state: ArchReviewState;
  triggerReasons: string[];
  clusters: ArchReviewClusterVerdict[];
  detectors: ArchReviewDetectorState[];
  priorRound?: ArchReviewPriorRound;
  priorFindings?: PriorFindingRuling[];
  priorFindingsState?: PriorFindingsCheckState;
  reason?: string;
}): ArchReviewRoundRecord {
  const rec: ArchReviewRoundRecord = {
    round: args.round,
    judgedAt: args.judgedAt,
    state: args.state,
    triggerReasons: args.triggerReasons,
    clusterCount: args.clusters.length,
    clusters: args.clusters,
    detectors: args.detectors,
  };
  // ⛔ 不 default 成 []：缺席 = 「这次没做 prior 复核」（非 judged 记录），与「复核过且没有 findings」
  // 必须不同形（硬规则 3b）。
  if (args.priorRound !== undefined) rec.priorRound = args.priorRound;
  if (args.priorFindings !== undefined) rec.priorFindings = args.priorFindings;
  if (args.priorFindingsState !== undefined) rec.priorFindingsState = args.priorFindingsState;
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

// ── 上一轮 findings 的逐条复核（gap-arch-review-judge-consumes-prior-round-findings）──────────────
// WHY：两次全仓架构评审里，「重跑后逐条核上一轮提过的问题（**含被否认的**）现在还可见吗」这一步
// 拦下了四次误判（「601 节点全是 DTO」/「native 6 条越界 import」/「两份转移表是 drift」/
// 「core↔gate 是复制」）。此前 judge 只吃本轮 clusters ——「上一轮结论现在是否仍成立」在机制里是空的，
// 靠人每次重跑手算。本段把这一步变成**judge 的输入 + 载体的逐条三态**。
//
// 两条纪律：
//   ① 三态 + 未评估（硬规则 3b）：survived / resolved / denied 是判定；给不出判定时必须写
//      `not-evaluated`，⛔ 不折叠成 denied（「读不懂」与「判过且否认」不得同形）。
//      `mergePriorFindingRulings()` 是这条的唯一执行点。
//   ② 依据必须是 **current-source 核对**（file:line / grep 命中），⛔ 不是「任务库里有一条同标题
//      done 任务」（硬规则 5b：任务状态是代理量，且它与「缺陷已修」恰好同形——任务被错误关闭时也同形）。
//      `classifyEvidenceSource()` 把依据机械分类；非 current-source 的判词**降级为 not-evaluated**
//      ——⛔ 不让 prompt 措辞成为唯一执行点（可见性 ≠ 执行，硬规则 9）。

/** 依据来源判定（PURE）。顺序有事：`tasks/<id>.md:12` 既是 file:line 又是任务库引用，任务库优先
 *  ——它恰恰是**不得**当作修复证据的那一类。 */
export function classifyEvidenceSource(evidence: string): EvidenceSource {
  const e = String(evidence ?? "").trim();
  if (e.length === 0) return "none";
  if (
    /(?:^|[\s(（"'`])tasks\/[A-Za-z0-9._-]+\.md\b/.test(e) ||
    /\b(?:done|completed)\s+task\b/i.test(e) ||
    /(?:任务库|已完成(?:的)?任务|同标题\s*done\s*任务|done\s*任务)/.test(e)
  ) {
    return "task-store";
  }
  // file:line（含可选的 ./ 或 / 前缀）——「真的去看了一眼源码」的最小可核形态。
  const fileLine = /(?:\.{0,2}\/)?(?:[\w.@+-]+\/)*[\w.@+-]+\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|jsonl|md|ya?ml|sh|css|html):\d+/;
  // grep 命中：命令 + 一个「有结果」的记号（⛔ 光有 grep 命令不算——那可能零命中）。
  const grepHit = /\bgrep\b[^\n]{0,300}(?:→|=>|->|\bhits?\b|\bmatch(?:es)?\b|命中)/i;
  if (fileLine.test(e) || grepHit.test(e)) return "current-source";
  return "unrecognized";
}

/** judge 输出的逐条 prior-finding 判词（schema：{clusterId, state, evidence}；字段一律 unknown，
 *  因为判词来自 LLM，读不懂的取值必须走 not-evaluated 而不是被当成本类型）。 */
export interface JudgePriorRuling {
  clusterId?: unknown;
  state?: unknown;
  evidence?: unknown;
}

const PRIOR_FINDING_STATES: ReadonlySet<string> = new Set(["survived", "resolved", "denied"]);

/** 把 judge 判词合回上一轮 findings（PURE）。对**每条** prior finding 都产出恰好一条 ruling：
 *  · 没判词 / 词表外 state / 依据不是 current-source ⇒ `not-evaluated` + reason（⛔ 不 default 成 denied）；
 *  · judge 自己写 `not-evaluated` ⇒ 保留为 not-evaluated（这是它诚实的「核不出来」）；
 *  · 只有 survived / resolved / denied + current-source 依据才是真判词。
 *  `rulings === null` 表示 judge 输出根本没带 priorFindings（例如旧的裸数组形态）——整批未评估。 */
export function mergePriorFindingRulings(
  prior: PriorFinding[],
  rulings: JudgePriorRuling[] | null,
): PriorFindingRuling[] {
  const byId = new Map<string, JudgePriorRuling>();
  for (const r of rulings ?? []) {
    if (!r || typeof r !== "object") continue;
    const id = typeof r.clusterId === "string" ? r.clusterId.trim() : "";
    if (id.length === 0) continue;
    if (!byId.has(id)) byId.set(id, r); // 重复判词取首条（确定性，⛔ 不靠后者覆盖前者）
  }
  return prior.map((p) => {
    const r = byId.get(p.clusterId);
    if (!r) {
      return {
        clusterId: p.clusterId,
        state: "not-evaluated" as const,
        evidence: "",
        evidenceSource: "none" as const,
        reason: "judge returned no ruling for this prior finding",
      };
    }
    const evidence = typeof r.evidence === "string" ? r.evidence.trim() : "";
    const evidenceSource = classifyEvidenceSource(evidence);
    const rawState = typeof r.state === "string" ? r.state.trim().toLowerCase() : "";
    if (rawState === "not-evaluated") {
      return {
        clusterId: p.clusterId,
        state: "not-evaluated" as const,
        evidence,
        evidenceSource,
        reason: "judge reported it could not verify this prior finding against the current source",
      };
    }
    if (!PRIOR_FINDING_STATES.has(rawState)) {
      return {
        clusterId: p.clusterId,
        state: "not-evaluated" as const,
        evidence,
        evidenceSource,
        reason: `unrecognized prior-finding state ${JSON.stringify(r.state ?? null)} (expected survived|resolved|denied|not-evaluated)`,
      };
    }
    if (evidenceSource !== "current-source") {
      return {
        clusterId: p.clusterId,
        state: "not-evaluated" as const,
        evidence,
        evidenceSource,
        reason: `ruling ${rawState} lacks a current-source basis (file:line or grep hit); evidence source = ${evidenceSource}`,
      };
    }
    return { clusterId: p.clusterId, state: rawState as PriorFindingState, evidence, evidenceSource };
  });
}

/** 聚合态（PURE）。`prior.state === "unreadable"` 必须落到 not-evaluated——载体读不懂时，
 *  「没有 findings」与「不知道有没有 findings」不同形（硬规则 3b）。 */
export function priorFindingsCheckState(
  prior: PriorRoundRead,
  rulings: PriorFindingRuling[],
): PriorFindingsCheckState {
  if (prior.state === "unreadable") return "not-evaluated";
  if (rulings.length === 0) return "none";
  const evaluated = rulings.filter((r) => r.state !== "not-evaluated").length;
  if (evaluated === rulings.length) return "checked";
  return evaluated === 0 ? "not-evaluated" : "partial";
}

/** 读「上一轮」judged 记录里的逐簇判词作为 prior findings（IO）。PURE 的部分只有字段归一化；
 *  三态语义见本段顶部。
 *  · 文件不存在 / 没有任何 judged 记录 ⇒ `none`（合法的首轮态，⛔ 不是 unreadable）；
 *  · **最后一行**解析不出 ⇒ `unreadable`——无法确定「上一轮」是不是它，⛔ 不得跳过它去用更早的记录；
 *  · 中间坏行不影响结论（它不可能是「上一轮」，只要最后一条可解析的 judged 记录还在）。
 *  · 取**最后一条** state==="judged" 的记录（非 judged 记录没有 clusters，不是可复核的 findings）。 */
export function readPriorRoundFindings(root: string): PriorRoundRead {
  const p = archReviewRoundPath(root);
  if (!fs.existsSync(p)) {
    return { state: "none", round: null, judgedAt: null, findings: [], reason: "no architecture-review-round carrier yet (nothing judged before)" };
  }
  const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { state: "none", round: null, judgedAt: null, findings: [], reason: "carrier exists but holds no records (nothing judged before)" };
  }
  let lastJudged: Record<string, unknown> | null = null;
  for (let i = 0; i < lines.length; i++) {
    let rec: unknown;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      if (i === lines.length - 1) {
        return {
          state: "unreadable",
          round: null,
          judgedAt: null,
          findings: [],
          reason: "last architecture-review-round record is not parseable — cannot tell which round is the prior one",
        };
      }
      continue; // 中间坏行：后面还有记录，上一轮由最后一条可解析的 judged 记录确定
    }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
    const r = rec as Record<string, unknown>;
    if (r.state === "judged" && Array.isArray(r.clusters)) lastJudged = r;
  }
  if (lastJudged === null) {
    return { state: "none", round: null, judgedAt: null, findings: [], reason: "no judged architecture-review-round record yet (nothing to re-check)" };
  }
  const recRound = typeof lastJudged.round === "number" ? lastJudged.round : null;
  const recJudgedAt = typeof lastJudged.judgedAt === "string" ? lastJudged.judgedAt : null;
  const findings: PriorFinding[] = [];
  for (const c of lastJudged.clusters as unknown[]) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    const v = c as Record<string, unknown>;
    if (typeof v.clusterId !== "string" || v.clusterId.length === 0) continue;
    findings.push({
      clusterId: v.clusterId,
      primitive: typeof v.primitive === "string" ? v.primitive : "",
      label: typeof v.label === "string" ? v.label : "",
      files: Array.isArray(v.files) ? v.files.filter((f): f is string => typeof f === "string") : [],
      priorVerdict: typeof v.verdict === "string" ? v.verdict : "",
      priorReasoning: typeof v.reasoning === "string" ? v.reasoning : "",
      priorSuggestedAction: typeof v.suggestedAction === "string" ? v.suggestedAction : "",
      priorRound: typeof v.round === "number" ? v.round : (recRound ?? 0),
      priorJudgedAt: typeof v.judgedAt === "string" ? v.judgedAt : (recJudgedAt ?? ""),
    });
  }
  return { state: "read", round: recRound, judgedAt: recJudgedAt, findings };
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

/** 追加写一条载体记录（mkdir -p + append，一行一 JSON，⛔ 不截断）。state=judged 且判词为空时拒写。
 *  `detectors` 缺失/非数组时同样拒写（AC3 的载体不变式——「没带 per-detector 状态」的记录会让
 *  `not-triggered` 重新变成不可验证的断言）。 */
export function appendArchReviewRound(root: string, record: ArchReviewRoundRecord): string {
  if (record.state === "judged" && record.clusters.length === 0) {
    throw new Error("refusing to write an empty judged architecture-review-round record (判词为空不写空记录)");
  }
  if (!Array.isArray(record.detectors)) {
    throw new Error("refusing to write an architecture-review-round record without a detectors array (AC3)");
  }
  const p = archReviewRoundPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(record) + "\n", "utf8");
  return p;
}
