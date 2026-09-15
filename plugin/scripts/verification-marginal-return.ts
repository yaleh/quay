// verification-marginal-return.ts — 「每拦下一个缺陷的验证成本」的读数机件。
// Task: gap-cost-per-defect-caught-verification-marginal-return
//
// THE QUESTION IT MAKES ASKABLE:
//   把「每个闸/checker 拦下多少次真实坏状态」与「它累计花了多少成本」对起来 —— 哪些检查器
//   物有所值、哪些是纯税？ADR-005（验证是绑定约束）只有定性论证，本机件产出的读数就是它
//   的第一个数。
//
// ── 成本载体与拦截载体是【两个不同的键空间】，这是本任务的核心难点 ─────────────────────────
// 成本来自 `.quay/checker-cost.jsonl`（每行 `{name, ms, n, load, at, verdict?}`，PURE APPEND，
// 由 plugin/scripts/checker-cost.ts + checker-cost-lib.sh + gate/engine.ts 三个写者写入）。
// 拦截来自另外的载体，且【不同的检查器有【不同的】拦截通道】—— 把这件事说清楚比报一个数重要：
//
//   | 通道            | 生产载体                          | 键                       | 窗口             |
//   |-----------------|-----------------------------------|--------------------------|------------------|
//   | gate            | .quay/gate-events.jsonl           | `gate` (+`pipeline_id`)  | 2026-08-12→now   |
//   | promotion-refuse| .quay/promotion-outcome.jsonl     | 晋升准入判定（task_id）  | 2026-08-22→now   |
//   | static-check    | .quay/verification-round.jsonl    | `STATIC_CHECK_FAILED:` 行 | 2026-08-12→now  |
//   | （无）          | —                                 | —                        | —                |
//
// ⚠️ 一个检查器【没有拦截通道】时，它的拦截数是 `null`（未查），**不是 `0`（查过且没有）**
// —— 硬规则 6（缺值=未查）+ 硬规则 3b（读不懂输入时不得返回与合格同形的值）。把两者混同会
// 把「我们没测」印成「它没拦下任何东西」，那正是用错口径砍闸的路径。成本载体自己也带一个
// `verdict` 字段（2026-09-04 起），但它只有 1,133 行且只覆盖 5 个检查器出过 fail
// （窗口太窄），故【不】当主通道，只在报告里作为旁证计数出现。
//
// ── 去重口径（AC1 要求脚本自己打印所用口径的定义）─────────────────────────────────────────
// 一次真实缺陷会被同一个闸重复判定很多次（`goal` 闸 23,224 条 fail 显然不是 23,224 个不同
// 缺陷）。口径必须写清楚、可复跑、并做敏感性分析。本机件同时算三种，定义见
// DEDUP_DEFINITIONS（脚本运行时会【逐字打印】这三条）：
//   D1 streak —— 同一 (item, gate) 的【连续 fail 段】算一次（中间夹一次 pass 就断开）。
//   D2 reason —— 同一 (item, gate, 规范化失败原因) 算一次。
//   D3 item   —— 同一 (item, gate) 只要曾 fail 过就算一次（最粗，给出缺陷数下界）。
// 「规范化失败原因」= 把数字与 ID 折叠成 N（`AC-143 has no criterion` → `AC-N has no criterion`），
// 使「同一个理由重复出现」不会被 ID 差异拆成多个缺陷。
//
// ── 用法 ──────────────────────────────────────────────────────────────────────────────────
//   node --no-warnings --experimental-strip-types plugin/scripts/verification-marginal-return.ts \
//     [--root <dir>] [--json] [--top <n>]
//   --cost/--gates/--promotion/--rounds <path>   覆盖载体路径（hermetic 测试用；默认 <root>/.quay/*）
//
// Exit: 0 = 报出读数（**即使结论是「某些检查器是纯税」也 exit 0** —— 这是读数不是闸）；
//       2 = usage/env 错误；3 = NOT-EVALUATED（成本载体不存在 ⇒ 没有任何可比的对象，
//       独立取值，绝不与「全部合格」同形）。
//
// 纪律（本任务 DoD）：本脚本只报数，不删任何检查器。删除要另行立案并经人裁定 —— 用一个
// 口径敏感的数去砍掉一道闸，是本任务明令避免的错误。

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { repoRoot } from "./repo-root.ts";

export const NOT_EVALUATED = 3;

/** 三态口径 —— 拦截数只有这三种，绝不把 ② 与 ③ 混同。 */
export const CATCH_STATE = {
  MEASURED_ZERO: "MEASURED_ZERO", // 通道在，拦下 0 个
  MEASURED_N: "MEASURED_N", // 通道在，拦下 n>0 个
  NOT_EVALUATED: "NOT_EVALUATED", // 该检查器没有拦截通道 ⇒ 未查（≠ 0）
} as const;

export interface DedupDefinition {
  id: "D1" | "D2" | "D3";
  name: string;
  definition: string;
}

/** AC1：脚本运行时会逐字打印这三条 —— 口径不写清楚的排序没有意义。 */
export const DEDUP_DEFINITIONS: DedupDefinition[] = [
  {
    id: "D1",
    name: "streak",
    definition:
      "同一 (item, gate) 的【连续 fail 段】算一次缺陷：把该键的全部判定按 timestamp 升序排列，" +
      "一段极大的连续 fail 序列（中间没有出现过一次 pass）计为 1 个缺陷。理由是「坏状态没被修好、" +
      "被重复判了 N 次」是一个缺陷而不是 N 个。",
  },
  {
    id: "D2",
    name: "reason",
    definition:
      "同一 (item, gate, 规范化失败原因) 算一次缺陷：失败原因文本先规范化（数字与 ID 折叠为 N：" +
      "`AC-143 has no criterion` → `AC-N has no criterion`），同一键的多次判定计为 1 个缺陷。" +
      "理由是「换了理由 = 换了缺陷」，而同一理由的重复判定是同一个缺陷。",
  },
  {
    id: "D3",
    name: "item",
    definition:
      "同一 (item, gate) 只要曾 fail 过就算一次缺陷。这是最粗的口径，给出缺陷数的下界（把一个对象上" +
      "发生过的所有缺陷压成一个），用于检验 D1/D2 的量级是否被重复计数撑大。",
  },
];

export interface CheckerCostRecord {
  name: string;
  ms: number;
  n: number;
  load: number;
  at: string;
  verdict?: string;
}

export interface GateEvent {
  id?: string;
  item_id?: string;
  pipeline_id?: string;
  gate: string;
  actor?: string;
  verdict: string;
  timestamp?: string;
  payload?: { reason?: string; [k: string]: unknown };
}

export interface PromotionOutcome {
  task_id: string;
  gate?: { eligible?: boolean; missing?: string[] };
  action?: string;
  result?: { ok?: boolean; detail?: string };
  ts?: string;
}

/** 静态检查红 —— verification-round 的一条轮记录里被 `STATIC_CHECK_FAILED:` 行点名的检查器。 */
export interface StaticCheckFlag {
  name: string;
  rc: number;
  commit: string;
  round: number;
  startedAt: string;
  line: string;
}

export interface CatchCounts {
  D1: number;
  D2: number;
  D3: number;
}

/**
 * mutation case 目录（`plugin/scripts/checker-mutation-cases/<name>.sh`）—— 一个检查器有 case
 * ⇒ 它**已被证明能红**（checker-mutation-check.sh 会故意弄坏它声称要查的东西并断言它 RED）。
 *
 * ⚠️ 为什么这个 join 决定 AC4 的读数该怎么读：拦截数 = 0 有两种成因，
 * ①被查对象窗口内确实一直干净（检查器在正常工作，只是没东西可拦）；
 * ②检查器是**恒绿**的（结构上不可能报红 —— 硬规则 3b 的「一个假的保证」）。
 * 没有 mutation case，这两种在读数上同形；**有** case 则排除了 ② ⇒ 0 拦截读作「干净」，不是「空转」。
 */
export function readMutationCases(dir: string): Set<string> {
  const out = new Set<string>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".sh")) out.add(f.replace(/\.sh$/, ""));
  }
  return out;
}

export interface Row {
  name: string;
  kind: "gate" | "checker";
  /** 累计成本（小时）。null = 成本载体里没有该名字（未测，不是 0）。 */
  costHours: number | null;
  /** 成本行条数（该名字被记了多少次耗时）。 */
  costRows: number;
  /** Σn（调用者自报的输入规模；ready-pool-check 自报真实池大小）。 */
  sumN: number;
  /** **判定次数** —— 该 checker/闸自己做了多少次判定。
   *  闸 = gate-events 里该闸的记录数；检查器 = 成本载体里该名的调用条数（一次调用=一次判定）。
   *  null 仅当对象没有任何可数的判定来源。 */
  judgments: number | null;
  /** 拦截通道内的记录条数（**不是**该检查器的判定次数 —— 两者口径不同，分开列）。 */
  channelRecords: number | null;
  /** fail 次数 = 判定里 verdict=fail 的条数。null = 无通道。 */
  fails: number | null;
  /** 去重后的不同缺陷数。null = 无通道（未查）。 */
  defects: CatchCounts | null;
  /** 每缺陷成本（小时/缺陷）。null = 分子或分母缺（并【不】当作 0）。 */
  costPerDefect: Record<"D1" | "D2" | "D3", number | null>;
  catchChannel: string | null;
  catchCoverage: string | null;
  catchState: (typeof CATCH_STATE)[keyof typeof CATCH_STATE];
  /** 有 mutation case ⇒ 该检查器已被证明【能】红 ⇒ 「0 拦截」读作干净而非空转。 */
  mutationProven: boolean;
}

// ── 规范化失败原因（D2 的输入口径）──────────────────────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** 把数字/ID 折叠成 N，使同一理由的重复出现不被 ID 差异拆开。空原因给一个显式占位符。 */
export function normalizeReason(reason: string | undefined | null): string {
  const raw = (reason ?? "").trim();
  if (!raw) return "(no reason)";
  return raw
    .replace(UUID_RE, "N")
    .replace(/\bAC-\d+/g, "AC-N")
    .replace(/\bGOAL-\d+/g, "GOAL-N")
    .replace(/\bDIR-\d+/g, "DIR-N")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim();
}

// ── 载体读入（每一层都能取假：坏行 fail-open 跳过并计数，不静默当 0）───────────────────────

export function readCheckerCost(file: string): CheckerCostRecord[] {
  if (!fs.existsSync(file)) return [];
  const out: CheckerCostRecord[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.name === "string" && Number.isFinite(r.ms)) out.push(r);
    } catch {
      // 坏行跳过（pure-append 载体不得打断读者），数量由调用方按行数对比发现
    }
  }
  return out;
}

export function readGateEvents(file: string): GateEvent[] {
  if (!fs.existsSync(file)) return [];
  const out: GateEvent[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.gate === "string" && typeof r.verdict === "string") out.push(r);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

export function readPromotionOutcomes(file: string): PromotionOutcome[] {
  if (!fs.existsSync(file)) return [];
  const out: PromotionOutcome[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.task_id === "string") out.push(r);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

const STATIC_FAIL_RE = /STATIC_CHECK_FAILED:\s*([A-Za-z0-9_.:\-]+)\s+exit=(\d+)/;
const RUN_CHECKER_RE = /^\s*run_checker\s+"([^"]+)"/gm;

/**
 * 静态检查器的**注册表**（本套件实际会跑哪些 checker）—— 单一真相源是
 * `plugin/scripts/runner-static-gate.ts`（被 scripts/test.sh source）里的 `run_checker "<name>"` 行，
 * 以及 scripts/test.sh 自己那几行。**两个既有消费者已经这样解析它**
 * （`select-static-checks-for-touches.ts` / `checker-mutation-check.sh`，各自的 `@checker-count` 也是机器核的）。
 *
 * ⚠️ 为什么必须读注册表、而不是只看「有没有红过」：一个检查器**从不红**与**没有拦截通道**在
 * 「只看红行」的读法下同形（硬规则 3b）。有了注册表，「注册了但窗口内 0 次红」是一个**真读数**
 * （MEASURED_ZERO），AC4 的纯税谓词才有对象；没有它，AC4 的清单结构上恒空。
 */
export function readStaticCheckRegistry(files: string[]): Set<string> {
  const names = new Set<string>();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    RUN_CHECKER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RUN_CHECKER_RE.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

/** 流式读 —— verification-round.jsonl 实测 ~73 MB，整文件 readFileSync 会白白吃内存。 */
export async function readStaticCheckFlags(file: string): Promise<StaticCheckFlag[]> {
  if (!fs.existsSync(file)) return [];
  const out: StaticCheckFlag[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o: { failures?: { line?: string }[]; commit?: string; round?: number; startedAt?: string };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    for (const f of o.failures ?? []) {
      const m = STATIC_FAIL_RE.exec(f.line ?? "");
      if (m) {
        out.push({
          name: m[1],
          rc: Number(m[2]),
          commit: o.commit ?? "",
          round: o.round ?? 0,
          startedAt: o.startedAt ?? "",
          line: (f.line ?? "").split("\n")[0],
        });
      }
    }
  }
  return out;
}

// ── 三种去重口径 ─────────────────────────────────────────────────────────────────────────

/** 通用：按 key 分组后，对每组的【全部判定】（不只是 fail）求连续 fail 段数（D1）。 */
export function countStreaks<T>(events: T[], keyFn: (e: T) => string, isFail: (e: T) => boolean, tsFn: (e: T) => string): number {
  const byKey = new Map<string, T[]>();
  for (const e of events) {
    const k = keyFn(e);
    const arr = byKey.get(k);
    if (arr) arr.push(e);
    else byKey.set(k, [e]);
  }
  let total = 0;
  for (const arr of byKey.values()) {
    const sorted = [...arr].sort((a, b) => (tsFn(a) < tsFn(b) ? -1 : tsFn(a) > tsFn(b) ? 1 : 0));
    let inRun = false;
    for (const e of sorted) {
      if (isFail(e)) {
        if (!inRun) {
          total += 1;
          inRun = true;
        }
      } else {
        inRun = false;
      }
    }
  }
  return total;
}

/** 通用：distinct 计数（D2/D3 共用）。 */
export function countDistinct<T>(events: T[], keyFn: (e: T) => string): number {
  const s = new Set<string>();
  for (const e of events) s.add(keyFn(e));
  return s.size;
}

/** 对一组 fail 事件同时算 D1/D2/D3。`allEvents` 用于 D1（streak 要靠穿插的 pass 断开）。 */
export function dedupeFails<F, A>(
  allEvents: A[],
  fails: F[],
  keyOf: (e: F | A) => string,
  reasonOf: (e: F) => string,
  tsOf: (e: F | A) => string,
): CatchCounts {
  const failSet = new Set<F>(fails);
  return {
    D1: countStreaks(allEvents, keyOf, (e) => failSet.has(e as unknown as F), tsOf),
    D2: countDistinct(fails, (e) => `${keyOf(e)}\u0000${normalizeReason(reasonOf(e))}`),
    D3: countDistinct(fails, (e) => keyOf(e)),
  };
}

// ── 成本聚合 ───────────────────────────────────────────────────────────────────────────────

/** `gate:<gate>:<task>` 形的成本行折回闸名；其余名字原样保留。 */
export function costOwnerOf(name: string): { owner: string; isGate: boolean } {
  const m = /^gate:([^:]+):/.exec(name);
  if (m) return { owner: m[1], isGate: true };
  return { owner: name, isGate: false };
}

export interface CostAgg {
  ms: number;
  rows: number;
  sumN: number;
  gateMs: number;
  gateRows: number;
  verdicts: Record<string, number>;
}

export function aggregateCost(records: CheckerCostRecord[]): Map<string, CostAgg> {
  const m = new Map<string, CostAgg>();
  for (const r of records) {
    const { owner, isGate } = costOwnerOf(r.name);
    let a = m.get(owner);
    if (!a) {
      a = { ms: 0, rows: 0, sumN: 0, gateMs: 0, gateRows: 0, verdicts: {} };
      m.set(owner, a);
    }
    a.ms += r.ms;
    a.rows += 1;
    a.sumN += Number.isFinite(r.n) ? r.n : 0;
    if (isGate) {
      a.gateMs += r.ms;
      a.gateRows += 1;
    }
    if (r.verdict) a.verdicts[r.verdict] = (a.verdicts[r.verdict] ?? 0) + 1;
  }
  return m;
}

// ── 组装 ──────────────────────────────────────────────────────────────────────────────────

/** 晋升准入的「真实缺陷」判据：missing 里出现【非 depsReady】的项才算拦下了一个坏状态。
 *  `depsReady=false` 是依赖排序（正确的调度行为），不是任务本身坏了 —— 把它算成「拦下缺陷」
 *  会把 `ready-pool-check` 的读数虚高 92.5%（38,002/41,068）。 */
export const REAL_DEFECT_MISSING = [
  "selfTouchOk=false",
  "fourArtifacts=false",
  "touchesResolve=false",
  "touchesNarrow=false",
  "prosePrereqGap=",
];

export function isRealDefectMissing(missing: string[]): boolean {
  return missing.some((m) => REAL_DEFECT_MISSING.some((p) => m.startsWith(p)));
}

export interface BuildInput {
  cost: CheckerCostRecord[];
  gates: GateEvent[];
  promotion: PromotionOutcome[];
  staticFlags: StaticCheckFlag[];
  /** 静态检查器注册表（本套件实际会跑哪些 checker），见 readStaticCheckRegistry。 */
  registry: Set<string>;
  /** mutation case 名单（证明检查器【能】红），见 readMutationCases。 */
  mutationCases: Set<string>;
}

export interface BuildMeta {
  costPresent: boolean;
  gatesPresent: boolean;
  promotionPresent: boolean;
  roundsPresent: boolean;
}

export function buildRows(input: BuildInput, meta: BuildMeta): Row[] {
  const costAgg = aggregateCost(input.cost);
  const rows: Row[] = [];

  const mkCostPerDefect = (hours: number | null, d: CatchCounts | null) => ({
    D1: hours !== null && d && d.D1 > 0 ? hours / d.D1 : null,
    D2: hours !== null && d && d.D2 > 0 ? hours / d.D2 : null,
    D3: hours !== null && d && d.D3 > 0 ? hours / d.D3 : null,
  });

  // ── 闸行：判定数来自 gate-events，成本来自 `gate:<gate>:*` 成本行 ────────────────────────
  const gateNames = new Set<string>(input.gates.map((e) => e.gate));
  for (const [owner, agg] of costAgg) if (agg.gateRows > 0) gateNames.add(owner);

  for (const gate of [...gateNames].sort()) {
    const events = input.gates.filter((e) => e.gate === gate);
    const fails = events.filter((e) => e.verdict === "fail");
    const agg = costAgg.get(gate);
    const haveCost = meta.costPresent && agg !== undefined && agg.gateRows > 0;
    const hours = haveCost ? agg!.gateMs / 3_600_000 : null;
    const hasChannel = meta.gatesPresent && events.length > 0;
    const defects = hasChannel
      ? dedupeFails(
          events,
          fails,
          (e) => (e as GateEvent).pipeline_id ?? (e as GateEvent).item_id ?? "?",
          (e) => (e as GateEvent).payload?.reason ?? "",
          (e) => (e as GateEvent).timestamp ?? "",
        )
      : null;
    rows.push({
      name: gate,
      kind: "gate",
      costHours: hours,
      costRows: haveCost ? agg!.gateRows : 0,
      sumN: haveCost ? agg!.sumN : 0,
      // 判定次数 = 该闸在 gate-events 里的记录数（闸自己的判定来源）
      judgments: hasChannel ? events.length : null,
      channelRecords: hasChannel ? events.length : null,
      fails: hasChannel ? fails.length : null,
      defects,
      costPerDefect: mkCostPerDefect(hours, defects),
      catchChannel: hasChannel ? "gate" : null,
      catchCoverage: hasChannel ? "2026-08-12→now" : null,
      catchState: !hasChannel
        ? CATCH_STATE.NOT_EVALUATED
        : fails.length === 0
          ? CATCH_STATE.MEASURED_ZERO
          : CATCH_STATE.MEASURED_N,
      mutationProven: input.mutationCases.has(gate),
    });
  }

  // ── 检查器行：成本来自非 gate: 成本行；拦截按【各自的通道】 ─────────────────────────────
  const staticByName = new Map<string, StaticCheckFlag[]>();
  for (const f of input.staticFlags) {
    const arr = staticByName.get(f.name);
    if (arr) arr.push(f);
    else staticByName.set(f.name, [f]);
  }

  for (const [owner, agg] of costAgg) {
    if (agg.gateRows === agg.rows) continue; // 纯 gate: 行已在上面折进闸
    // runner 级的 gate: 行与同名非 gate 行混在一起时，只把非 gate 部分算进检查器
    const nonGateRows = agg.rows - agg.gateRows;
    const nonGateMs = agg.ms - agg.gateMs;

    let catchChannel: string | null = null;
    let channelRecords: number | null = null;
    let fails: number | null = null;
    let defects: CatchCounts | null = null;
    let coverage: string | null = null;

    if (owner === "ready-pool-check" && meta.promotionPresent) {
      catchChannel = "promotion-refuse";
      coverage = "2026-08-22→now";
      const refusals = input.promotion.filter(
        (p) => (p.action ?? "promote") !== "promote" && isRealDefectMissing(p.gate?.missing ?? []),
      );
      channelRecords = input.promotion.length;
      fails = refusals.length;
      defects = dedupeFails(
        refusals,
        refusals,
        (e) => (e as PromotionOutcome).task_id,
        (e) => ((e as PromotionOutcome).gate?.missing ?? []).join(","),
        (e) => (e as PromotionOutcome).ts ?? "",
      );
    } else if (meta.roundsPresent && (input.registry.has(owner) || staticByName.has(owner))) {
      // 通道在 = 该 checker 是套件注册表的一员（或它在窗口内真的红过）。注册了但 0 次红 ⇒
      // MEASURED_ZERO（真读数）；不注册且没红过 ⇒ 落到下面的 NOT_EVALUATED（未查）。
      catchChannel = "static-check";
      coverage = "2026-08-12→now";
      const flags = staticByName.get(owner) ?? [];
      channelRecords = flags.length; // 该载体只在红的时候有行 —— 它不是「跑了多少次」
      fails = flags.length;
      defects = dedupeFails(
        flags,
        flags,
        (e) => `${(e as StaticCheckFlag).commit}`,
        (e) => (e as StaticCheckFlag).line,
        (e) => (e as StaticCheckFlag).startedAt,
      );
    }

    rows.push({
      name: owner,
      kind: agg.gateRows > 0 ? "gate" : "checker",
      costHours: meta.costPresent ? nonGateMs / 3_600_000 : null,
      costRows: nonGateRows,
      sumN: agg.sumN,
      // 检查器的判定次数 = 它被调用了多少次（成本载体每次调用一行）—— 与拦截通道的记录数区分开
      judgments: meta.costPresent ? nonGateRows : null,
      channelRecords,
      fails,
      defects,
      costPerDefect: mkCostPerDefect(meta.costPresent ? nonGateMs / 3_600_000 : null, defects),
      catchChannel,
      catchCoverage: coverage,
      catchState: catchChannel === null ? CATCH_STATE.NOT_EVALUATED : fails === 0 ? CATCH_STATE.MEASURED_ZERO : CATCH_STATE.MEASURED_N,
      mutationProven: input.mutationCases.has(owner),
    });
  }

  return rows;
}

/** 「纯税」谓词：累计成本 > 阈值 且【拦截通道在】且去重后拦截数 = 0。
 *  ⚠️ `catchState === NOT_EVALUATED` 的行【不】入围 —— 未查 ≠ 没有（硬规则 6/3b）。 */
export function isPureTax(row: Row, minHours: number, dedup: "D1" | "D2" | "D3" = "D3"): boolean {
  if (row.costHours === null) return false;
  if (row.costHours <= minHours) return false;
  if (row.catchState === CATCH_STATE.NOT_EVALUATED) return false;
  if (!row.defects) return false;
  return row.defects[dedup] === 0;
}

export interface SensitivityReport {
  /** 每个口径下的排序（成本>0 的行，按每缺陷成本降序）。 */
  rankings: Record<"D1" | "D2" | "D3", string[]>;
  /** 相邻口径之间的 top-k 集合交叠比例。 */
  topKOverlap: Record<string, number>;
  /** 逐行三口径分歧：列出 max/min > 1.2 的行（口径选择在这些行上真的会改结论）。 */
  spread: { name: string; D1: number; D2: number; D3: number; ratio: number }[];
  /** 结论是否稳定：三个口径下 top-k 集合完全一致 ⇒ stable，否则 sensitive。 */
  stable: boolean;
  verdict: string;
}

export function computeSensitivity(rows: Row[], k: number): SensitivityReport {
  const ids: ("D1" | "D2" | "D3")[] = ["D1", "D2", "D3"];
  const rankings = { D1: [], D2: [], D3: [] } as Record<"D1" | "D2" | "D3", string[]>;
  for (const id of ids) {
    rankings[id] = rows
      .filter((r) => r.costPerDefect[id] !== null)
      .sort((a, b) => (b.costPerDefect[id] as number) - (a.costPerDefect[id] as number))
      .map((r) => r.name);
  }
  const top = (id: "D1" | "D2" | "D3") => new Set(rankings[id].slice(0, k));
  const overlap = (a: Set<string>, b: Set<string>) => {
    const union = new Set([...a, ...b]);
    if (union.size === 0) return 1;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter += 1;
    return inter / union.size;
  };
  const t12 = overlap(top("D1"), top("D2"));
  const t23 = overlap(top("D2"), top("D3"));
  const t13 = overlap(top("D1"), top("D3"));
  const stable = t12 === 1 && t23 === 1 && t13 === 1;

  // 逐行分歧：口径真的要选的时候，是这些行。ratio = max/min（三个都 >0 时才算）。
  const spread: SensitivityReport["spread"] = [];
  for (const r of rows) {
    const d = r.defects;
    if (!d || d.D1 === 0 || d.D2 === 0 || d.D3 === 0) continue;
    const ratio = Math.max(d.D1, d.D2, d.D3) / Math.min(d.D1, d.D2, d.D3);
    if (ratio > 1.2) spread.push({ name: r.name, D1: d.D1, D2: d.D2, D3: d.D3, ratio });
  }
  spread.sort((a, b) => b.ratio - a.ratio);

  return {
    rankings,
    topKOverlap: { "D1∩D2": t12, "D2∩D3": t23, "D1∩D3": t13 },
    spread,
    stable,
    verdict: stable
      ? `稳定：三个口径下每缺陷成本 top-${k} 的集合完全一致 ⇒ 排序可用于决策。`
      : `该结论对口径敏感，不可用于决策：三个口径下每缺陷成本 top-${k} 的集合不一致（交叠 D1∩D2=${t12.toFixed(2)} D2∩D3=${t23.toFixed(2)} D1∩D3=${t13.toFixed(2)}）。`,
  };
}

// ── 报告 ──────────────────────────────────────────────────────────────────────────────────

const H = (h: number | null) => (h === null ? "  n/a" : h.toFixed(2).padStart(8));
const N = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : String(n).padStart(7));
const CPD = (v: number | null) => (v === null ? "n/a" : v < 0.001 ? "<0.001" : v.toFixed(3));

/** 每缺陷成本列：分母为 0 是【无限】不是「n/a」（n/a 留给「未查/未测」）。 */
function costPerDefectCell(row: Row, id: "D1" | "D2" | "D3"): string {
  const def = row.defects;
  if (def && def[id] === 0) return "∞";
  return CPD(row.costPerDefect[id]);
}

export interface Report {
  generatedAt: string;
  root: string;
  carriers: Record<string, { path: string; present: boolean; records: number }>;
  dedupDefinitions: DedupDefinition[];
  rows: Row[];
  sensitivity: SensitivityReport;
  readyPoolCheck: Row | null;
  pureTax: { minHours: number; dedup: "D1" | "D2" | "D3"; rows: Row[] };
  /** 成本超阈但【没有拦截通道】的行 —— 纯税判不了，不是 0 拦截。 */
  unjudgeable: { minHours: number; rows: Row[] };
  /** 零计数的配套动作（硬规则 2）：谓词对一个已知有拦截的行干跑一次的结果。 */
  predicateControl: { target: string | null; returned: boolean | null; ok: boolean; note: string };
  /** 旁证：成本载体自带的 verdict 字段（窗口窄，只作对照）。 */
  verdictField: { rows: number; fail: number; window: string | null; firstAt: string | null };
  coverageGaps: string[];
}

export function buildReport(opts: {
  root: string;
  input: BuildInput;
  meta: BuildMeta;
  paths: Record<string, string>;
  minHours: number;
  topK: number;
  now?: string;
}): Report {
  const rows = buildRows(opts.input, opts.meta);
  const sensitivity = computeSensitivity(rows, opts.topK);
  const pureTaxRows = rows.filter((r) => isPureTax(r, opts.minHours, "D3")).sort((a, b) => (b.costHours ?? 0) - (a.costHours ?? 0));
  const unjudgeableRows = rows
    .filter((r) => r.costHours !== null && r.costHours > opts.minHours && r.catchState === CATCH_STATE.NOT_EVALUATED)
    .sort((a, b) => (b.costHours ?? 0) - (a.costHours ?? 0));

  // 零计数配套动作：谓词必须对一个【已知有拦截】的行返回 false。挑拦截数最大的那一行。
  const knownCatcher = [...rows]
    .filter((r) => r.defects !== null && r.defects.D3 > 0 && r.costHours !== null && r.costHours > opts.minHours)
    .sort((a, b) => (b.defects?.D3 ?? 0) - (a.defects?.D3 ?? 0))[0];
  const control = knownCatcher
    ? {
        target: knownCatcher.name,
        returned: isPureTax(knownCatcher, opts.minHours, "D3"),
        ok: isPureTax(knownCatcher, opts.minHours, "D3") === false,
        note: "谓词 isPureTax 在一个已知有拦截的行上干跑 —— 必须返回 false，否则谓词无效（硬规则 2 的零计数配套动作）",
      }
    : { target: null, returned: null, ok: false, note: "载体里没有任何「成本>阈值且有拦截」的行 ⇒ 谓词无法被自证（当轮所有零命中结论都不可信）" };

  const verdictRows = opts.input.cost.filter((r) => r.verdict !== undefined);
  const firstAt = verdictRows.length ? verdictRows.map((r) => r.at).sort()[0] : null;

  const gaps: string[] = [];
  if (!opts.meta.costPresent) gaps.push("成本载体 .quay/checker-cost.jsonl 不存在 ⇒ 全部成本读数为 null（未查）");
  if (!opts.meta.gatesPresent) gaps.push("闸载体 .quay/gate-events.jsonl 不存在 ⇒ 闸拦截读数为 null（未查）");
  if (!opts.meta.promotionPresent) gaps.push("晋升载体 .quay/promotion-outcome.jsonl 不存在 ⇒ ready-pool-check 的拦截读数为 null（未查）");
  if (!opts.meta.roundsPresent) gaps.push("轮载体 .quay/verification-round.jsonl 不存在 ⇒ 静态检查器拦截读数为 null（未查）");
  const goalRow = rows.find((r) => r.name === "goal");
  if (goalRow && goalRow.costHours === null) {
    gaps.push("闸 `goal` 拦下全仓最多的缺陷，但成本载体里【没有任何 goal 闸的成本行】⇒ 它的每缺陷成本结构上不可算");
  }
  const rankable = rows.filter((r) => r.costPerDefect.D1 !== null || r.costPerDefect.D2 !== null || r.costPerDefect.D3 !== null);
  gaps.push(
    `⚠️ 敏感性排序只覆盖【同时有成本与拦截通道】的 ${rankable.length} 行（全表 ${rows.length} 行）—— 它不是全序，` +
      `拦截数最多的 goal 闸不在其中 ⇒ 「最贵/最便宜」只能在这 ${rankable.length} 行之间读`,
  );
  const noChannel = rows.filter((r) => r.kind === "checker" && r.catchState === CATCH_STATE.NOT_EVALUATED);
  gaps.push(
    `${noChannel.length}/${rows.filter((r) => r.kind === "checker").length} 个检查器没有拦截通道 ⇒ 它们的「每缺陷成本」是未查（null），不是 0；无法据此判断它们是否物有所值`,
  );

  return {
    generatedAt: opts.now ?? new Date().toISOString(),
    root: opts.root,
    carriers: {
      cost: { path: opts.paths.cost, present: opts.meta.costPresent, records: opts.input.cost.length },
      gates: { path: opts.paths.gates, present: opts.meta.gatesPresent, records: opts.input.gates.length },
      promotion: { path: opts.paths.promotion, present: opts.meta.promotionPresent, records: opts.input.promotion.length },
      rounds: { path: opts.paths.rounds, present: opts.meta.roundsPresent, records: opts.input.staticFlags.length },
      registry: {
        path: opts.paths.registry ?? "",
        present: (opts.input.registry?.size ?? 0) > 0,
        records: opts.input.registry?.size ?? 0,
      },
    },
    dedupDefinitions: DEDUP_DEFINITIONS,
    rows,
    sensitivity,
    readyPoolCheck: rows.find((r) => r.name === "ready-pool-check") ?? null,
    pureTax: { minHours: opts.minHours, dedup: "D3", rows: pureTaxRows },
    unjudgeable: { minHours: opts.minHours, rows: unjudgeableRows },
    predicateControl: control,
    verdictField: { rows: verdictRows.length, fail: verdictRows.filter((r) => r.verdict === "fail").length, window: "2026-09-04→now", firstAt },
    coverageGaps: gaps,
  };
}

export function renderHuman(rep: Report): string {
  const out: string[] = [];
  out.push(`# 每拦下一个缺陷的验证成本 — 读数`);
  out.push(``);
  out.push(`生成时刻: ${rep.generatedAt}`);
  out.push(`根目录: ${rep.root}`);
  out.push(``);
  out.push(`## 载体（全部为生产载体；缺失的载体读数为 null=未查，不是 0）`);
  for (const [k, v] of Object.entries(rep.carriers)) {
    out.push(`  ${v.present ? "✓" : "✗"} ${k.padEnd(10)} ${v.path}  (${v.records} 条)`);
  }
  out.push(``);
  out.push(`## 去重口径定义（AC1：口径不写清楚的排序没有意义）`);
  for (const d of rep.dedupDefinitions) out.push(`  ${d.id} ${d.name}: ${d.definition}`);
  out.push(``);
  out.push(`## 每行读数`);
  out.push(
    `  ${"name".padEnd(38)} ${"cost_h".padStart(8)} ${"judg".padStart(8)} ${"fail".padStart(7)} ${"D1".padStart(6)} ${"D2".padStart(6)} ${"D3".padStart(6)} ${"h/D1".padStart(8)} ${"h/D2".padStart(8)} ${"h/D3".padStart(8)}  channel`,
  );
  out.push(`  （judg = 该对象的判定次数：闸=gate-events 记录数，检查器=成本载体调用条数）`);
  const sorted = [...rep.rows].sort((a, b) => (b.costHours ?? -1) - (a.costHours ?? -1));
  for (const r of sorted) {
    out.push(
      `  ${r.name.padEnd(38)} ${H(r.costHours)} ${N(r.judgments)} ${N(r.fails)} ` +
        `${N(r.defects?.D1)} ${N(r.defects?.D2)} ${N(r.defects?.D3)} ` +
        `${costPerDefectCell(r, "D1").padStart(8)} ${costPerDefectCell(r, "D2").padStart(8)} ${costPerDefectCell(r, "D3").padStart(8)}  ${r.catchChannel ?? "（无通道 = 未查）"}`,
    );
  }
  out.push(``);
  out.push(`## 敏感性分析（AC2：≥2 种口径下的排序是否稳定）`);
  for (const id of ["D1", "D2", "D3"] as const) {
    out.push(`  ${id} 排序（每缺陷成本降序，只列有可比读数的行）: ${rep.sensitivity.rankings[id].join(" > ") || "（无）"}`);
  }
  out.push(`  top-k 集合交叠: ${Object.entries(rep.sensitivity.topKOverlap).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ")}`);
  out.push(`  逐行三口径分歧（max/min > 1.2 —— 口径选择真的会改结论的行）:`);
  if (rep.sensitivity.spread.length === 0) out.push(`    （无：所有行的三口径缺陷数分歧都 ≤ 1.2×）`);
  for (const s of rep.sensitivity.spread) {
    out.push(`    - ${s.name}: D1=${s.D1} D2=${s.D2} D3=${s.D3}  ratio=${s.ratio.toFixed(2)}×`);
  }
  out.push(`  ⇒ ${rep.sensitivity.verdict}`);
  out.push(``);
  out.push(`## ready-pool-check 专项（AC3：全仓最贵的单个检查器，必须单列）`);
  const rpc = rep.readyPoolCheck;
  if (!rpc) {
    out.push(`  NOT-EVALUATED：成本载体里没有 ready-pool-check 这一行。`);
  } else {
    out.push(`  累计成本: ${rpc.costHours === null ? "n/a（未测）" : rpc.costHours.toFixed(2) + " h"}  (${rpc.costRows} 次记录, Σn=${rpc.sumN})`);
    out.push(`  拦截通道: ${rpc.catchChannel ?? "（无）"}  窗口 ${rpc.catchCoverage ?? "n/a"}`);
    out.push(`  该检查器的判定次数: ${rpc.judgments ?? "n/a"}（成本载体调用条数）`);
    out.push(`  拦截通道内记录数: ${rpc.channelRecords ?? "n/a"}（该载体的全部记录，含被跳过与被晋升的）`);
    out.push(`  拦下的「真实缺陷」次数（未去重）: ${rpc.fails ?? "n/a"}`);
    out.push(`  去重后不同缺陷数: D1=${rpc.defects?.D1 ?? "n/a"} D2=${rpc.defects?.D2 ?? "n/a"} D3=${rpc.defects?.D3 ?? "n/a"}`);
    out.push(
      `  ⇒ 每拦截成本: D1=${CPD(rpc.costPerDefect.D1)} h  D2=${CPD(rpc.costPerDefect.D2)} h  D3=${CPD(rpc.costPerDefect.D3)} h`,
    );
    out.push(`  注：分母只含【非 depsReady】的准入拒绝 —— depsReady=false 是依赖排序（正确调度），`);
    out.push(`      不是任务本身坏了；把它计入会把读数虚高 92.5%。`);
  }
  out.push(``);
  out.push(`## 纯税候选（AC4：累计成本 > ${rep.pureTax.minHours} h 且去重后拦截数 = 0，口径 ${rep.pureTax.dedup}）`);
  out.push(`  条数: ${rep.pureTax.rows.length}`);
  for (const r of rep.pureTax.rows) {
    out.push(
      `    - ${r.name}  成本 ${r.costHours?.toFixed(2)} h  通道 ${r.catchChannel}  拦截 0  ` +
        `mutation 证明能红: ${r.mutationProven ? "是（⇒ 读作「窗口内干净」，不是「空转」）" : "否（⚠️ 恒绿与干净不可区分）"}`,
    );
  }
  out.push(`  零计数配套动作（硬规则 2）: ${rep.predicateControl.note}`);
  out.push(
    `    → 目标 ${rep.predicateControl.target ?? "（无）"}，谓词返回 ${rep.predicateControl.returned ?? "n/a"} ⇒ ${rep.predicateControl.ok ? "谓词有效 ✓" : "谓词未被自证 ✗"}`,
  );
  out.push(
    `  ⚠️ 「拦截数 = 0」有两种成因，本读数**不能单独区分**：①被查对象窗口内一直干净（检查器在正常工作）；` +
      `②检查器恒绿（结构上不可能报红 —— 硬规则 3b 的「一个假的保证」）。`,
  );
  out.push(
    `     判别靠上面的「mutation 证明能红」列：有 case ⇒ 已由 checker-mutation-check 证过它能红 ⇒ 排除 ②。` +
      `无 case ⇒ 该行两种成因不可区分，**不得**据以砍闸。`,
  );
  out.push(``);
  out.push(`## 判不了是否纯税（成本 > ${rep.unjudgeable.minHours} h 但【没有拦截通道】）`);
  out.push(`  条数: ${rep.unjudgeable.rows.length}  ← 这是「未查」，不是「0 拦截」；不得据以砍闸`);
  for (const r of rep.unjudgeable.rows) out.push(`    - ${r.name}  成本 ${r.costHours?.toFixed(2)} h`);
  out.push(``);
  out.push(`## 覆盖缺口（这些是「未查」，不是「没有」）`);
  for (const g of rep.coverageGaps) out.push(`  - ${g}`);
  out.push(``);
  out.push(
    `## 成本载体自带 verdict 旁证: ${rep.verdictField.rows} 行有 verdict（fail ${rep.verdictField.fail}），窗口 ${rep.verdictField.window}（首行 ${rep.verdictField.firstAt ?? "n/a"}）—— 窗口太窄，不作主通道`,
  );
  return out.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────

export interface LoadResult {
  input: BuildInput;
  meta: BuildMeta;
  paths: Record<string, string>;
}

export async function loadCarriers(root: string, over: Partial<Record<string, string>> = {}): Promise<LoadResult> {
  const paths = {
    cost: over.cost ?? path.join(root, ".quay", "checker-cost.jsonl"),
    gates: over.gates ?? path.join(root, ".quay", "gate-events.jsonl"),
    promotion: over.promotion ?? path.join(root, ".quay", "promotion-outcome.jsonl"),
    rounds: over.rounds ?? path.join(root, ".quay", "verification-round.jsonl"),
    registry: over.registry ?? path.join(root, "plugin", "scripts", "runner-static-gate.ts"),  // kernel-sibling-dev-tree-only: dev-tree-only — repo-local plugin/scripts use, not third-party sibling resolution.
    registryExtra: over.registryExtra ?? path.join(root, "scripts", "test.sh"),
    mutationCases: over.mutationCases ?? path.join(root, "plugin", "scripts", "checker-mutation-cases"),
  };
  const meta: BuildMeta = {
    costPresent: fs.existsSync(paths.cost),
    gatesPresent: fs.existsSync(paths.gates),
    promotionPresent: fs.existsSync(paths.promotion),
    roundsPresent: fs.existsSync(paths.rounds),
  };
  return {
    meta,
    paths,
    input: {
      cost: readCheckerCost(paths.cost),
      gates: readGateEvents(paths.gates),
      promotion: readPromotionOutcomes(paths.promotion),
      staticFlags: await readStaticCheckFlags(paths.rounds),
      registry: readStaticCheckRegistry([paths.registry, paths.registryExtra]),
      mutationCases: readMutationCases(paths.mutationCases ?? path.join(root, "plugin", "scripts", "checker-mutation-cases")),
    },
  };
}

async function main(argv: string[]): Promise<number> {
  let root = "";
  let asJson = false;
  let minHours = 1;
  let topK = 5;
  const over: Partial<Record<string, string>> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i] ?? "";
    else if (a === "--json") asJson = true;
    else if (a === "--min-hours") minHours = Number(argv[++i]);
    else if (a === "--top") topK = Number(argv[++i]);
    else if (a === "--cost") over.cost = argv[++i];
    else if (a === "--gates") over.gates = argv[++i];
    else if (a === "--promotion") over.promotion = argv[++i];
    else if (a === "--rounds") over.rounds = argv[++i];
    else if (a === "--registry") over.registry = argv[++i];
    else if (a === "--mutation-cases") over.mutationCases = argv[++i];
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "usage: verification-marginal-return.ts [--root <dir>] [--json] [--top <n>] [--min-hours <n>]\n" +
          "       [--cost <path>] [--gates <path>] [--promotion <path>] [--rounds <path>]\n",
      );
      return 0;
    } else {
      process.stderr.write(`verification-marginal-return: unknown arg: ${a}\n`);
      return 2;
    }
  }
  if (!root) {
    try {
      root = repoRoot();
    } catch {
      root = process.cwd();
    }
  }
  if (!Number.isFinite(minHours) || minHours < 0) {
    process.stderr.write("verification-marginal-return: --min-hours must be a non-negative number\n");
    return 2;
  }

  const loaded = await loadCarriers(root, over);
  if (!loaded.meta.costPresent && !loaded.meta.gatesPresent) {
    process.stderr.write(
      `verification-marginal-return: NOT-EVALUATED — neither cost carrier nor gate carrier found under ${root}/.quay (未查 ≠ 全部合格)\n`,
    );
    return NOT_EVALUATED;
  }
  const rep = buildReport({ root, input: loaded.input, meta: loaded.meta, paths: loaded.paths, minHours, topK });
  if (asJson) process.stdout.write(JSON.stringify(rep, null, 2) + "\n");
  else process.stdout.write(renderHuman(rep) + "\n");
  return 0;
}

// Bundler-friendly direct-entry guard (basename match, same convention as checker-cost.ts).
if (
  process.argv[1] &&
  path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "verification-marginal-return"
) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
