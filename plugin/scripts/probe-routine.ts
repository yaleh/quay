// probe-routine.ts — the generic bridge that turns a DECLARED routine (`.quay/config.yml`
// `loop.routines:` entry with a `probe:`) into a live Layer-1b `RoutineSpec` that a resident driver
// actually runs. This is SPEC-capability-planes-and-mechanism-lifecycle §5.2's `llmProbeRoutine`
// (选定的落地项 1「probe 轨道机械化」), minus the invented `probe-driver` kind §5.1 ruled out.
//
// WHY THIS EXISTS（实测，SPEC §2.3）: the probe track was never mechanically wired. Its only caller
// was fast-mode-tick-core.md's A14 — a layer that has since been RETIRED — and its "last run"
// state was maintained by PROSE handed to an LLM (`run-routines.js:29` tells an agent to write the
// epoch-ms back into `.quay/routine-last-run.json`). Measured consequence: that file held ONE key
// with an mtime of 2026-08-12, i.e. the track had been dead for weeks with nothing able to say so
// (硬规则 9: 守与不守在记录上无法区分). Meanwhile `.quay/config.yml` still declared four routines
// whose triggers (`every(N)`) belong to the retired iteration counter ⇒ they could never fire.
//
// THE FIVE STEPS (SPEC §5.2's target shape — four parts already existed):
//   ① readProbeSpec(probe)            — existing (read-probe-spec.ts); unreadable ⇒ not-evaluated
//   ② spawn a fresh-context agent     — existing (launchArgv + runAsync)
//   ③ FILE-ONLY guard                 — existing (probe-write-guard.ts, shared with meta-driver)
//   ④ record structured findings      — THIS module: append to a queryable carrier
//   ⑤ Fact[]                          — existing (driver-runtime.ts Layer 1b)
//
// WHAT THIS MODULE ADDS ON TOP OF SPEC §5.2, and why:
//   - **Durable last-run** (`.quay/routine-last-run.json`). `runResidentQualityGateLoop`'s own
//     `lastRun` map is IN-MEMORY (quality-gate-driver.ts:1042) ⇒ every driver restart re-fires every
//     interval routine. For a cheap mechanical reading that is harmless; for a deep scan that spawns
//     LLM sub-agents on a ~2000-entity corpus it is a cost bug (the driver respawns whenever its
//     watched sources change). So the routine consults/updates a persisted window itself, and says
//     so in the Fact (never a silent skip).
//   - **Shard reporting**: the probe's output contract carries `shards`/`inventory`, and the carrier
//     records them, so "the deep mode ran (N shards)" is distinguishable from "one agent skimmed".
//
// ⛔ NOT a hot-path gate (the `gap-fan-in-remove-archguard-gate` lesson): nothing here is called by
// fan-in / scoped-gate / any per-task path. The ONLY caller is the quality driver's routine table.
//
// Usage (production): `probeRoutinesFromConfig(root, opts)` → RoutineSpec[] → the caller appends
// them to its Layer-1b routine table. Tests import the pure functions directly.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { parseTrigger } from "./routine-scheduler.ts";
import { readProbeSpec } from "./read-probe-spec.ts";
import { launchArgv, runAsync } from "./driver-runtime.ts";
import { probeWriteViolations, snapshotTrackedChanges } from "./probe-write-guard.ts";
// 机械立案步（AC5/AC6）：三道闸与 finding→任务 的形状判据都复用 routine-file-gate.ts 的单一实现，
// ⛔ 不在这里另写一份质量/去重/限流判据。该模块只 import gate-script-base，无环
// （⛔ 不可改 import meta-driver.ts：quality-gate-driver → probe-routine → meta-driver → quality-gate-driver
//  正是 probe-write-guard 当初被拆出去要消掉的那个环）。
import {
  boardKeys,
  classifyExecutionProbeResult,
  countRecentFilings,
  escalationKey,
  escalationMarkerByKey,
  findingKey,
  foldProbeReportedValue,
  gateFinding,
  hasRequestedAction,
  producerGate,
  readProducerMapping,
  recurrenceByKey,
  recurrenceOrder,
  remedyGatesProducer,
  REMEDY_AVAILABILITY_VALUES,
  renderRoutineTaskBody,
  resolveTaskCliEntry,
  routineFindingCandidateText,
  routineTaskId,
  DEFAULT_RATE,
} from "./routine-file-gate.ts";
import type { ExecutionProbeDecl, RemedyAvailability } from "./routine-file-gate.ts";
import type { Fact, RoutineSpec } from "./driver-runtime.ts";

/** 结构化 finding 的载体（追加式 JSONL）。登记在任务 ## Touches 里 ⇒ 是**可查的落地产物**，
 *  ⛔ 不是 gitignored 的运行时字节（`.gitignore` 未列它；同族先例 `.quay/it0-split-or-commit-…jsonl`）。 */
export const ROUTINE_FINDINGS_REL = path.posix.join(".quay", "routine-findings.jsonl");
/** 持久 last-run 表（`{ "<routine>": <epoch-ms> }`，merge 写回）。 */
export const ROUTINE_LAST_RUN_REL = path.posix.join(".quay", "routine-last-run.json");

/** 探针 spawn 的 role 名（`launchArgv(role, …)` → profiles.yml → launcher/model/-n）。
 *  ⚠️ 刻意复用既有 role，不新造 `probe-runner`：role 表由 quay-init 的 profiles 模板同步，
 *  而该模板的「覆盖全部 driver 请求的 role」检查正由 in-flight 任务
 *  `gap-quay-init-profiles-template-omits-every-role-the-drivers-request` 落地——此刻新增 role
 *  会在两个任务合流后让那条检查对**未在本任务 Touches 内的 quay-init.sh** 报红。
 *  `meta-driver` 的语义与其注释（「例程的语义半，短命 claude -p，每轮全新上下文」）正是本模块所做的事。 */
export const PROBE_ROLE_DEFAULT = "meta-driver";

/** FILE-ONLY 违约扫描里**豁免**的路径前缀。旧 routines 契约（plugin/skills/routines/SKILL.md）
 *  就允许例程新增 tasksDir 文件；共享检出里 tasks/*.md 也正被别的 driver 持续改写
 *  ⇒ 不豁免它会让每一次真实运行都因**别人的**写入而违约（假阳性）。 */
const FILE_ONLY_ALLOWED_PREFIXES = ["tasks/"];

// ── 配置读取（kernel 侧；形状与 suite-params.ts 同族）────────────────────────────────────────────
// 为什么在这里读 YAML 而不是 import packages/quay/src/loop-params.ts：kernel（plugin/scripts）在
// 第三方工作区里与 packages/quay/src 不同源（可能只有 plugin/ 一份）——suite-params.ts 已为同族
// 需求立了这个先例。⚠️ 代价是「第二个读者」，故 trigger 文法复用 routine-scheduler.parseTrigger
// （唯一文法实现），且 plugin/test/probe-routine.test.mjs 用同一批 fixture 对 readLoopParams
// 做 no-drift 断言（形状分歧会被那条用例抓住）。

/** 一条声明式 routine（与 loop-params.ts 校验的名字段同名）。 */
export interface RoutineDecl {
  name: string;
  trigger: string;
  probe: string | null;
  dispatch: string | null;
}

/** 读 `.quay/config.yml` 的 `loop.routines:`。**无该节 ⇒ `[]`**（本节可选，同 suite-params 的契约）。
 *  YAML 坏 / 节形状坏 / 单条形状坏 ⇒ **fail-closed throw**（⛔ 不静默降级成「没有 routine」）。 */
export function readRoutinesConfig(workspaceRoot: string): RoutineDecl[] {
  const configPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (!fs.existsSync(configPath)) return []; // 无统一 config ⇒ 本节不存在（branch-B 工作区不归本读者管）
  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    throw new Error(`FAIL-CLOSED: .quay/config.yml is malformed YAML — ${(e as Error).message}`);
  }
  const loop = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).loop : undefined;
  if (loop === undefined || loop === null) return [];
  if (typeof loop !== "object" || Array.isArray(loop)) {
    throw new Error(`FAIL-CLOSED: .quay/config.yml 'loop:' must be a mapping (got ${Array.isArray(loop) ? "array" : typeof loop})`);
  }
  const raw = (loop as Record<string, unknown>).routines;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`FAIL-CLOSED: .quay/config.yml 'loop.routines:' must be an array (got ${typeof raw})`);
  }
  return raw.map((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      throw new Error(`FAIL-CLOSED: .quay/config.yml loop.routines[${i}] must be a mapping`);
    }
    const rec = r as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) throw new Error(`FAIL-CLOSED: .quay/config.yml loop.routines[${i}] needs a non-empty string 'name'`);
    if (typeof rec.trigger !== "string") {
      throw new Error(`FAIL-CLOSED: .quay/config.yml loop.routines[${i}] ('${name}') needs a string 'trigger'`);
    }
    // 文法单一实现：routine-scheduler.parseTrigger 对非法 trigger 抛错（fail-closed）。
    try { parseTrigger(rec.trigger); } catch (e) {
      throw new Error(`FAIL-CLOSED: .quay/config.yml loop.routines[${i}] ('${name}') — ${(e as Error).message}`);
    }
    const probe = typeof rec.probe === "string" && rec.probe.trim() ? rec.probe.trim() : null;
    const dispatch = typeof rec.dispatch === "string" && rec.dispatch.trim() ? rec.dispatch.trim() : null;
    if (!probe && !dispatch) {
      throw new Error(`FAIL-CLOSED: .quay/config.yml loop.routines[${i}] ('${name}') needs 'probe' (DIR-056) or 'dispatch' (legacy)`);
    }
    return { name, trigger: rec.trigger.trim(), probe, dispatch };
  });
}

/** 从声明里挑出**本机制能驱动**的（有 `probe:` 且 trigger 是两层模式的时间量 `interval:<N>m`）。
 *  其余逐条给出**可见的**跳过理由（⛔ 不静默丢；硬规则 3b）：
 *   - `every(N)` 依赖已退役的迭代计数（ADR-022）⇒ 两层模式下永不 due；
 *   - `on(<event>)` 需要事件生产者，当前无人发布这些事件名；
 *   - 只有 `dispatch:` 的旧形态归 legacy 派发器，不由本机制承接。 */
export function selectProbeRoutines(decls: readonly RoutineDecl[]): {
  probes: RoutineDecl[];
  skipped: { name: string; trigger: string; reason: string }[];
} {
  const probes: RoutineDecl[] = [];
  const skipped: { name: string; trigger: string; reason: string }[] = [];
  for (const d of decls) {
    const t = parseTrigger(d.trigger);
    if (!d.probe) {
      skipped.push({ name: d.name, trigger: d.trigger, reason: "no 'probe:' — legacy 'dispatch:' form is not hosted here" });
      continue;
    }
    if (t.kind !== "interval") {
      skipped.push({ name: d.name, trigger: d.trigger, reason: `trigger kind '${t.kind}' — only 'interval:<N>m' is a two-layer quantity the driver can evaluate` });
      continue;
    }
    probes.push(d);
  }
  return { probes, skipped };
}

// ── 探针输出的解析（结构化 finding 契约，见 plugin/probes/semantic-dedup-scan.md）─────────────────

/** 一条结构化 finding（AC2 ③：**具体文件路径 + 函数名 + 判定理由**，⛔ 不是一个绿/红布尔）。 */
export interface ProbeFinding {
  id: string | null;
  kind: string | null;
  symbols: string[];
  files: string[];
  verdict: string | null;
  rationale: string;
  suggestedAction: string | null;
  /** 探针点名的产出者/主体（探针契约可选带；`plugin/probes/freshness-refresh.md` 的 finding 带
   *  `producer`）。⛔ `null` = 没点名，与「点名了但没登记」不同形（硬规则 3b）。 */
  producer: string | null;
  /** 探针点名的**跟踪主体**（`GOAL-009-AC-NNN`）。与 `producer` 分开：一个产出者可拥有多个主体，
   *  而升级面的去重键是**主体**（「不重复立案同一主体」）。⛔ `null` = 探针没报，不是某个默认值。 */
  subject: string | null;
}

export interface ParsedProbeOutput {
  findings: ProbeFinding[];
  /** 形状读不懂的 finding 条数（⛔ 与「没有 finding」不同形；硬规则 3b）。 */
  malformed: number;
  /** 探针自报的分片数（深模式 = 多个 fresh-context agent 各自核实一批；null = 未自报）。 */
  shards: number | null;
  /** 探针自报的全量实体清单规模（`{<surface>: <count>}`）。 */
  inventory: Record<string, number> | null;
  notes: string | null;
}

/** 字符串感知的「平衡花括号切片」扫描：返回文本里所有**顶层** `{…}` 片段（按出现顺序）。
 *  用于 agent 在 JSON 前后夹了散文、或一次打了多个对象的情形——只做**选取**（挑 agent 自己打出来的
 *  那一个），⛔ 不合成、不修补、不猜字段。 */
export function balancedObjectSlices(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth += 1; continue; }
    if (c === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; }
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

/** 从**任意**探针 stdout 里取出那一个 JSON 对象。读不出 ⇒ null（调用方记 failed，⛔ 不猜）。
 *  依次尝试：围栏块 → 整段 → 第一个 `{` 到最后一个 `}` → 每个顶层平衡 `{…}` 切片（按序）。
 *  多个候选都能解析时，**优先带 `findings` 键的那个**（探针契约的主字段），否则取第一个。 */
function extractJsonObject(stdout: string): unknown | null {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  const candidates: string[] = [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  candidates.push(text);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  candidates.push(...balancedObjectSlices(text));
  const parsed: unknown[] = [];
  for (const c of candidates) {
    try {
      const j = JSON.parse(c);
      if (j && typeof j === "object" && !Array.isArray(j)) parsed.push(j);
      else if (Array.isArray(j)) parsed.push({ findings: j }); // 只给数组的探针也认（宽容但形状明确）
    } catch { /* 试下一个候选 */ }
  }
  if (parsed.length === 0) return null;
  return parsed.find((p) => Array.isArray((p as Record<string, unknown>).findings)) ?? parsed[0];
}

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => String(x).trim()) : [];

/** 解析探针输出。整体读不出 ⇒ null；逐条 finding 读不懂 ⇒ 计入 `malformed`（⛔ 不静默丢）。 */
export function parseProbeFindings(stdout: string): ParsedProbeOutput | null {
  const obj = extractJsonObject(stdout) as Record<string, unknown> | null;
  if (!obj) return null;
  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: ProbeFinding[] = [];
  let malformed = 0;
  for (const raw of rawFindings) {
    const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null) as Record<string, unknown> | null;
    if (!r) { malformed += 1; continue; }
    const files = strArray(r.files);
    const symbols = strArray(r.symbols);
    const rationale = typeof r.rationale === "string" ? r.rationale.trim() : "";
    // AC2 ③ 的三要素缺一 ⇒ 不是一条可用的 finding（计入 malformed，⛔ 不伪装成通过）。
    if (files.length === 0 || symbols.length === 0 || rationale.length === 0) { malformed += 1; continue; }
    findings.push({
      id: typeof r.id === "string" && r.id.trim() ? r.id.trim() : null,
      kind: typeof r.kind === "string" && r.kind.trim() ? r.kind.trim() : null,
      symbols,
      files,
      verdict: typeof r.verdict === "string" && r.verdict.trim() ? r.verdict.trim() : null,
      rationale,
      suggestedAction: typeof r.suggestedAction === "string" && r.suggestedAction.trim() ? r.suggestedAction.trim() : null,
      producer: typeof r.producer === "string" && r.producer.trim() ? r.producer.trim() : null,
      subject: typeof r.subject === "string" && r.subject.trim() ? r.subject.trim() : null,
    });
  }
  const inv = obj.inventory && typeof obj.inventory === "object" && !Array.isArray(obj.inventory)
    ? Object.fromEntries(
      Object.entries(obj.inventory as Record<string, unknown>)
        .filter(([, v]) => typeof v === "number" && Number.isFinite(v)),
    ) as Record<string, number>
    : null;
  return {
    findings,
    malformed,
    shards: typeof obj.shards === "number" && Number.isFinite(obj.shards) ? obj.shards : null,
    inventory: inv && Object.keys(inv).length ? inv : null,
    notes: typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : null,
  };
}

// ── 机械立案步（AC5/AC6 of gap-ac214-fifth-crossing-routine-detects-but-nothing-acts）────────────
//
// THE MISSING HALF. Everything above ends at "append the finding to the carrier". Measured: 61
// finding records / 57 distinct findingIds landed there and **zero** became tasks (`grep -rl <id>
// tasks/` matched only the routine's own task quoting its output). The carrier had no consumer, so
// "the routine is running and has findings" was shaped exactly like "the gap is being handled" —
// which is the whole defect. This step closes it: actionable findings are FILED (⛔ not executed).
//
// ⛔ FILE-ONLY. The closing action for a filed task (re-running a cross-machine producer, fixing a
// defect) belongs to the dispatch chain. A routine that executes is the rogue-probe failure mode the
// probe specs forbid in prose; here it is bounded by construction — this function can only create
// `tasks/<id>.md`.

export interface FilingDisposition {
  findingId: string | null;
  taskId: string | null;
  accepted: boolean;
  /** 哪一道处置判据给的结论——⛔ 不合并成布尔（硬规则 3）；`producer` 单独一类，因为它是探针
   *  自身完整性问题（点名一个不存在的产出者），与「有产出者但被质量/去重/限流挡下」不同形；
   *  `blocked-repeat` 同理单独一类——「同一主体在该读数不变时已升级过」与 rate 限流不同形。 */
  gate: "action" | "producer" | "quality-dedup-rate" | "blocked-repeat" | "collision" | "filed";
  reason: string;
  /** 本条落哪条通道。`false` = 派发链（⛔ 与修复前逐字节同形）；`true` = 人可见通道
   *  （`needs-human` 升级，携带逐字补救）。被拒时恒为 false。 */
  escalate: boolean;
}

export interface FilingOptions {
  routine: string;
  probe: string;
  runId: string;
  ts: string;
  /** 载体路径（绝对）——rate 窗口从它自己的 `filing-round` 记录里读，⛔ 不另立一个计数器文件。 */
  carrierPath: string;
  /** 载体相对 root 的路径（写进任务体的逐字来源行）。 */
  carrierRel: string;
  /** 任务板目录（绝对）——dedup 闸从这里读既有 finding key。 */
  tasksDir: string;
  /** 板上的既有任务文件路径 → 内容（测试缝可覆盖；缺省从 tasksDir 读）。 */
  boardKeys?: Set<string>;
  nowMs: number;
  /** rate 闸的上限（本窗口内允许立案的条数）。 */
  k: number;
  /** 登记在册的产出者集合。**三值**（见 producerGate 注释）：`undefined` = 本例程未声明登记面 ⇒
   *  该闸不适用；`null` = 声明了但读不懂 ⇒ fail-closed；`Set` = 读到了，按成员判定。 */
  registeredProducers: Set<string> | null | undefined;
  /** 复现优先级读数的注入缝。**三值**（同 registeredProducers 的形状）：`undefined` = 从载体读
   *  （生产路径）；`null` = 明确「读不出」⇒ 退回探针顺序（⛔ 不退化成「都没复现过」）；`Map` = 用这个
   *  读数。缺省即生产行为，测试缝只为把同一个判定对着**受控语料**跑。 */
  recurrence?: Map<string, number> | null;
  /** 本轮的 remedy-availability 读数（机械执行探针 + 探针自报的折叠结果）。**缺省 `undefined`**
   *  = 未评估 ⇒ 逐字节退回修复前的行为（⛔ 不是「默认可执行」，也不是「默认被挡住」）。 */
  remedy?: RemedyAvailability;
  /** 声明了该读数的执行探针（用于判定 finding 点名的产出者是否被这一读数覆盖）。 */
  remedyProbe?: ExecutionProbeDecl | null;
  /** 板上【已升级为 needs-human】的主体键 → 立案文件名。缺省从 tasksDir 机械读（⛔ 不另立计数器）。 */
  escalatedKeys?: Map<string, string>;
}

/** 逐条处置 finding（⛔ 不只回一个布尔，硬规则 3）。**纯函数**：不写盘、不 spawn——落盘在调用方，
 *  于是同一个判定可以对着**生产载体**跑一次而不改变任何东西（AC5 的「生产载体真实读数」）。
 *
 *  ⚠️ **判定顺序 ≠ 输出顺序**（`gap-routine-semantic-dedup-scan-recurring-cluster-starvation`）：
 *  本轮预算（rate 闸）按**复现次数降序**发放 —— 高复现主语先花，探针发射顺序只在同分时才是次序
 *  （见 routine-file-gate.ts 的 recurrence 段，那里同时是这条改动的实测读数）。输出仍按**探针顺序**
 *  返回：载体里的 filing-round 记录要跨轮可比，⛔ 不因优先级改动而整体重排。 */
export function selectFilings(findings: readonly ProbeFinding[], o: FilingOptions): FilingDisposition[] {
  const keys = o.boardKeys ?? boardKeys(o.tasksDir);
  // ⓪ 优先级（只决定顺序，⛔ 不改变任何判据）：读不出载体 ⇒ 探针顺序，与修复前逐字节相同。
  const recurrence = o.recurrence === undefined ? recurrenceByKey(o.carrierPath) : o.recurrence;
  const order = recurrenceOrder(findings, recurrence);
  const byIndex = new Array<FilingDisposition | undefined>(findings.length);
  let acceptedThisRound = 0;
  let recentBase: number | null = null;
  // ⓪b 升级面（remedy availability = blocked 时才读；⛔ 读数不是 blocked 时一次盘都不碰）。
  let escalated: Map<string, string> | null = null;
  for (const rank of order) {
    const f = findings[rank.index];
    const id = f.id;
    const reject = (gate: FilingDisposition["gate"], reason: string): void => {
      byIndex[rank.index] = { findingId: id, taskId: null, accepted: false, gate, reason, escalate: false };
    };

    // ① 只立「要求了动作」的 finding。semantic-dedup-scan 的 `suggestedAction: "leave"` 判定是
    //    **测量**不是工作；把它们也立成任务会让这条轨道变成噪音，而噪音轨道会被关掉。
    if (!hasRequestedAction(f)) {
      reject("action", `action: finding declares no requested action (suggestedAction=${JSON.stringify(f.suggestedAction)}) ⇒ a measurement, not work`);
      continue;
    }
    // ② 产出者闸（AC5 红侧）：点名的产出者必须在登记面上。
    const pg = producerGate(f, o.registeredProducers);
    if (!pg.ok) { reject("producer", pg.reason); continue; }
    // ②b 升级面（本条要点）：本读数 = blocked 且该 finding 点名的产出者被这一读数覆盖
    //     ⇒ ⛔ 不得产出与「可在本处执行」同形的可派发任务；改走人可见通道，且同一主体
    //     在该读数不变时不重复升级。判据在 routine-file-gate.ts（单一实现，⛔ 不在此处重写）。
    const escalate = remedyGatesProducer(o.remedy, o.remedyProbe ?? null, f.producer);
    const escKey = escalate ? escalationKey(f) : "";
    if (escalate) {
      if (escalated === null) escalated = o.escalatedKeys ?? escalationMarkerByKey(o.tasksDir);
      const already = escKey ? escalated.get(escKey) : undefined;
      if (already) {
        reject("blocked-repeat", `blocked-repeat: ${escKey} is already escalated to the human-visible channel (tasks/${already}) and remedy availability is still 'blocked' (probe '${o.remedy?.probeId ?? "<none>"}') ⇒ not re-filing`);
        continue;
      }
    }
    // ③ 既有三道闸（质量 / 去重 / 限流）——⛔ 复用单一实现，不在这里另写一份判据。
    if (recentBase === null) recentBase = countRecentFilings(o.carrierPath, o.nowMs);
    const candidate = routineFindingCandidateText(f);
    const g = gateFinding(candidate, { existingKeys: keys, recentCount: recentBase + acceptedThisRound, K: o.k });
    if (!g.accept) {
      // rate 拒绝把**复现读数**一并落痕：残余饥饿（复现很高却仍被限流）必须可审，⛔ 否则
      // 「限流正确」与「优先级没生效」在载体记录里同形（硬规则 3）。null = 没读到，写明。
      const reason = g.reason.startsWith("rate:")
        ? `${g.reason} (subject recurrence: ${rank.recurrence === null ? "unknown — carrier unreadable" : `${rank.recurrence} round(s)`})`
        : g.reason;
      reject("quality-dedup-rate", reason);
      continue;
    }

    // ④ id 派生 + 撞车处置：同 slug 但**不同** finding ⇒ 加确定性后缀（⛔ 不覆盖既有任务体）。
    let taskId = routineTaskId(o.routine, f.id);
    if (fs.existsSync(path.join(o.tasksDir, `${taskId}.md`))) {
      taskId = `${taskId}-${createHash("sha1").update(findingKey(candidate)).digest("hex").slice(0, 8)}`;
    }
    if (fs.existsSync(path.join(o.tasksDir, `${taskId}.md`))) {
      reject("collision", `collision: tasks/${taskId}.md already exists and is not this finding ⇒ not overwriting`);
      continue;
    }
    keys.add(findingKey(candidate));
    // 同一轮内第二个同主体的 finding 也按「已升级」处理（板上还没有它 ⇒ 只靠 board 读挡不住）。
    if (escalate && escKey !== "") escalated?.set(escKey, `${taskId}.md`);
    acceptedThisRound += 1;
    byIndex[rank.index] = {
      findingId: id, taskId, accepted: true, escalate,
      gate: "filed",
      reason: escalate
        ? `accepted: actionable, novel, within rate — routed to the HUMAN-VISIBLE channel because remedy availability is 'blocked' (the requested action is not performable from this host)`
        : "accepted: actionable, novel, within rate",
    };
  }
  // 每个候选恰有一条处置（⛔ 不返回带洞的数组：一条 undefined 会静默变成载体里的空洞）。
  for (let i = 0; i < findings.length; i++) {
    if (!byIndex[i]) throw new Error(`selectFilings: finding #${i} (${findings[i].id ?? "<no-id>"}) got no disposition — the priority order dropped it`);
  }
  return byIndex as FilingDisposition[];
}

/** 一条执行探针的运行结果（`spawnSync` 的形状里只取判定要用的四个字段）。 */
export interface ExecutionProbeRun {
  status: number | null;
  error?: { message?: string } | null;
  stdout?: string | null;
  stderr?: string | null;
}

/** 生产实现：按 mapping 声明的 argv 跑**可达性探针**（⛔ 不是产出者；见 freshness-producers.json 的
 *  `execution_probe._comment`）。超时由声明里的 `timeout_ms` 给（⛔ 不在这里写死秒数——硬规则 4 推论二）。
 *  `spawnSync` 是**有意**的选择：本步在例程的 spawn 序列之外、要一个确定性的、有界的、可判定的读数，
 *  而异步 spawn 会让「读不出」与「还没跑完」在调用方同形（硬规则 3b）。 */
export function defaultRunExecutionProbe(decl: ExecutionProbeDecl): ExecutionProbeRun {
  const r = spawnSync(decl.command[0], decl.command.slice(1), {
    encoding: "utf8", timeout: decl.timeoutMs,
  });
  return {
    status: r.status,
    error: r.error ? { message: (r.error as Error).message } : null,
    stdout: r.stdout ?? null,
    stderr: r.stderr ?? null,
  };
}

/** 解析探针规格声明的 `producers_file` 到**磁盘上的那一份**。
 *
 *  解析顺序（⛔ ① 在前是有理由的，见下）：
 *    ① `<pluginRoot>/<basename(declared)>` —— 与**读该规格的那一份代码修订**同源的副本；
 *    ② `<root>/<declared>`               —— workspace 自己的副本（声明的路径写的是 root 相对）。
 *
 *  WHY ① 在前（2026-09-25 **实测**，本条任务 AC6 的第一次真实读数）：规格从**代码修订**读，而它
 *  指向的 mapping 从 **workspace** 读 ⇒ 一次代码修订切换（`--script-root` / 换 worktree）会加载
 *  **新规格 + 旧 mapping**，于是 remedy-availability 静默变成 `not-declared`、**声明没有消费者** ——
 *  正是本条要关掉的那个形态，只是又低了一层。同一个「源与跑的不是一份」的家族（第 6 次是
 *  源 vs 编译产物）。⛔ 这里仍然**不是**「谁新用谁」的猜测：只按固定顺序取第一份存在的文件。
 *
 *  ⚠️ 生产等价性（这是它能被安全引入的原因）：quality-gate-driver 传的恒是
 *  `pluginRoot = <root>/plugin`，而此时 ① 与 ② 是**同一个路径**（`declared` 就是
 *  `plugin/freshness-producers.json`）⇒ 本仓库的生产行为逐字节不变。
 *  ⚠️ 声明边界：一个同时拥有 vendored plugin 与自己的 `plugin/freshness-producers.json` 的
 *  workspace，会取到 plugin 那一份——本仓库不存在该形态（`plugin/` 就是本仓的插件目录），
 *  故作为**已声明的**边界记在此处，⛔ 不声称对所有布局都无影响。
 *  两份都不存在 ⇒ 返回 ②（= 修复前的路径）⇒ 读不出 ⇒ 调用方照旧 fail-closed。 */
export function resolveMappingPath(root: string, pluginRoot: string, declared: string): string {
  const workspacePath = path.resolve(root, declared);
  const pluginPath = path.resolve(pluginRoot, path.basename(declared));
  if (pluginPath !== workspacePath && fs.existsSync(pluginPath)) return pluginPath;
  return workspacePath;
}

/** 立一条任务：spawn workspace 自己的 task store CLI（⛔ 不手搓 markdown 落盘）。
 *
 *  ⚠️ `cwd` 必须显式设为 root，⛔ 不能靠继承（`runAsync` 不接受 cwd ⇒ 用的是**父进程的** cwd）。
 *  实测（2026-09-15，两次）：`quay-native task create` 在错误 cwd 下会把 `tasks/<id>.md` 写进
 *  `<cwd>/tasks`——一次造出 `/tmp/tasks/WRONGCWD-1.md`。这与 `tasks/EXIST.md` 那条残留同源
 *  （都是「写入落点由 cwd 决定，而调用方以为它由 root 决定」）。两道保险都用，因为二者的失效模式不同：
 *    ① `cwd: root` —— 让 CLI 从正确的工作区解析 `.quay/config.yml`（provider/tasks_dir 的正本）；
 *    ② `QUAY_NATIVE_TASKS_DIR` 绝对路径 —— 让**写入落点**与 `selectFilings` 做撞车检查时看的
 *      `tasksDir` 是**同一个目录**（检查与实际写盘不得各看一处）。实测该 env 在错误 cwd 下仍然生效。
 *  解析不出 CLI ⇒ 返回 `unresolved`（与「没有要立的」不同形，硬规则 3b）。 */
export function fileRoutineTask(
  root: string, kernelPluginRoot: string | null, taskId: string, title: string, body: string,
  labels: readonly string[], tasksDir: string, status: string | null = null, timeoutMs = 120_000,
): { ok: boolean; reason: string } {
  const entry = resolveTaskCliEntry(root, kernelPluginRoot);
  if (!entry) return { ok: false, reason: "task store CLI unresolved (no packages/quay-native and no vendored bundle) — nothing filed" };
  // `status` 只在**升级形态**（remedy-availability = blocked）传入，值为 `needs-human`：那是本项目
  // 现成的「人可见、不进派发候选」通道（⛔ 不新增成因枚举、⛔ 不新增再入队路径 —— 人 2026-09-20 裁定）。
  // 缺省 null ⇒ 不传 `--status`，由 store 的 default_task_status 决定，与修复前逐字节相同。
  const argv = [
    process.execPath, ...entry, "task", "create", taskId, "--title", title, "--labels", labels.join(","), "--body", body,
    ...(status ? ["--status", status] : []),
  ];
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: root,
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: path.resolve(tasksDir) },
    encoding: "utf8",
    timeout: timeoutMs,
  });
  if (r.error) return { ok: false, reason: `task create spawn error: ${(r.error as Error).message}` };
  if (r.status !== 0) return { ok: false, reason: `task create exit ${r.status}: ${String(r.stderr ?? "").trim().slice(0, 200)}` };
  // 写入必须真的发生在这个目录里（⛔ 不采信 CLI 的自报——EXIST 那次 CLI 也报了 ok 而文件落在别处）。
  if (!fs.existsSync(path.join(tasksDir, `${taskId}.md`))) {
    return { ok: false, reason: `task create reported ok but ${path.join(tasksDir, `${taskId}.md`)} does not exist ⇒ filing not trusted` };
  }
  return { ok: true, reason: `filed as ${taskId}` };
}

// ── 载体（追加式 JSONL）──────────────────────────────────────────────────────────────────────
/** 追加记录到载体；返回实际追加条数。目录自动创建。 */
export function appendRoutineFindings(findingsPath: string, records: readonly Record<string, unknown>[]): number {
  if (records.length === 0) return 0;
  fs.mkdirSync(path.dirname(findingsPath), { recursive: true });
  fs.appendFileSync(findingsPath, records.map((r) => JSON.stringify(r) + "\n").join(""), "utf8");
  return records.length;
}

/** 例程提交身份 —— **常量，⛔ 不读宿主**（gap-commit-routine-write-no-git-identity-fallback）。
 *
 *  WHY 不读宿主：这一条与「别在本机等价于无限制」同族（硬规则 4 推论二）——「宿主已配好身份」是一个
 *  **依赖宿主的常量**，换台机器（GH runner/容器/新机器）就变成**没有身份**，而失败是静默能力缺失：
 *  函数照常返回、错误照常上报，只是 append 永远提交不了。要用「例程提交」这个能力，就在机制上带身份，
 *  不要依赖一个恰好成立的 ambient 配置。
 *
 *  ⛔ 不写 `--global`、也不改仓库/全局 config（那会永久污染宿主与共享检出，且改的是别人的东西）；
 *  身份只作用于本模块 spawn 的那一次 git 进程。 */
export const ROUTINE_COMMIT_IDENTITY = { name: "quay-routine", email: "routine@quay.local" } as const;

/** 一次【带例程身份】的 git 调用 —— `commitRoutineWrite` 的全部 git 动作都经它。
 *
 *  ⚠️ 为什么**两层都设**（`-c` 配置层 + `GIT_*` env 层），而不是只设一层 —— git 解析 ident 的顺序是
 *  **env → config → 自动探测**，且「存在但为空」的 env 变量**被当作取值**（git 判的是 NULL 不是长度）：
 *  - 只设 `-c` ⇒ 宿主若导出了**空的** `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME`，env 层先命中空值 ⇒
 *    `fatal: empty ident name (for <>) not allowed`（GH runner 的环境就带这两个空变量）；
 *  - 只设 env ⇒ 一旦将来有人 unwrap 这一层就退回原缺陷，而 `-c` 让「这次提交是谁」在 commit 那一行
 *    自己读得出来。
 *  ⇒ 两层同源（同一个常量），**改一处即可**；⛔ 不要「简化」掉任何一层。 */
function routineGit(root: string, args: string[]) {
  return spawnSync(
    "git",
    ["-C", root, "-c", `user.name=${ROUTINE_COMMIT_IDENTITY.name}`, "-c", `user.email=${ROUTINE_COMMIT_IDENTITY.email}`, ...args],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: ROUTINE_COMMIT_IDENTITY.name,
        GIT_AUTHOR_EMAIL: ROUTINE_COMMIT_IDENTITY.email,
        GIT_COMMITTER_NAME: ROUTINE_COMMIT_IDENTITY.name,
        GIT_COMMITTER_EMAIL: ROUTINE_COMMIT_IDENTITY.email,
      },
    },
  );
}

/** 写盘即提交 —— 例程对**它自己写下的产物**用同一个动作落库（AC7 的推广）。
 *
 *  两个消费者，同一条判据：① 载体 `.quay/routine-findings.jsonl` 的追加（它从不被提交 ⇒ 实测丢过
 *  25 条记录）；② 立案步新建的 `tasks/<id>.md`。
 *
 *  ⚠️ 对 ② 的诚实说明：**实测 `quay-native task create` 自己就会提交**（`tasks: <id> task_write by
 *  cli:<pid>`，本 worktree 与一个全新的临时仓库里都验过）⇒ 对任务文件本函数通常只是**空转**。它仍
 *  保留，因为「CLI 会提交」不是本模块能保证的事实（非 git 工作区里它做不到），而保留它的代价只是一次
 *  空转——**但空转必须与被拒绝区分开**（硬规则 3b）：这正是本函数要判「已提交」而不是「失败」的原因。
 *  第一版把「nothing to commit」当成失败上报 ⇒ 每一个成功立案都会附一条假 failure。**5b 的扫描结论
 *  因此是「否」**：任务文件这一侧不存在同形缺陷，声明修了它就是虚报。
 *
 *
 *  WHY: the carrier is git-TRACKED but its append was never committed ⇒ the working-tree copy was
 *  permanently dirty, and **any** tree-hygiene `git checkout`/`reset` on the shared checkout silently
 *  restored it to HEAD. Measured 2026-09-15: rounds 1–473 appended 25 records (3 scan-round + 22
 *  finding) between 02:17Z and 14:36Z; the file then held HEAD's 54 lines + only the last two rounds'
 *  10 ⇒ those 25 are gone, and with them the ability to re-examine why round 473 reported 6 findings
 *  where its neighbours reported 4. **The loss window was the interval between "the routine wrote it"
 *  and "somebody happened to commit it" — i.e. it was never bounded.** Closing it means the append and
 *  its commit are the same action, so HEAD and the work tree agree after every round and there is
 *  nothing left for a `checkout` to take back.
 *
 *  ⛔ NOT the gitignore route (the other option the task names): `git rm --cached` would put a
 *  DELETION of this file on develop, and the main checkout holds a locally-modified copy of it ⇒ the
 *  very next `--ff-only` sync would refuse ("local changes would be overwritten"), i.e. the fix for a
 *  silent-loss defect would break the sync path. Keeping it tracked and committing the append has no
 *  such edge and additionally preserves the record as the diff-able artifact it was designed to be.
 *
 *  Shape copied from Core's `commitStoreWrite` (the repo's ONE task-store commit primitive): pathspec-
 *  limited add+commit back-to-back (hard rule 11 — never leave the shared index staged), `--no-verify`
 *  (the pre-commit guard is for human/driver commits, not for an append that already happened on disk),
 *  and on failure `git reset -- <path>` to unstage while keeping the bytes. Returns a reason rather
 *  than throwing ⇒ the caller reports it in the Fact (⛔ never a silent "not committed").
 *
 *  ⛔ **身份必须自己带**（gap-commit-routine-write-no-git-identity-fallback）：本函数的每一个 git 调用
 *  都经 `routineGit` 注入 `ROUTINE_COMMIT_IDENTITY`，**不靠宿主 ambient 配置**。修前它裸跑 `git`，
 *  于是「能不能提交」取决于宿主是否恰好配过 user.name/user.email —— 在没有的宿主（GH runner、容器、
 *  刚装好的机器）上 `git commit` 报 `Author identity unknown`，append 永远提交不了 ⇒ 例程在这些环境里
 *  必然退化成「写了但被下一次 checkout 吃掉」，即本函数存在的理由整个失效（实测 CI run 35065126553）。 */
export function commitRoutineWrite(root: string, relPath: string, message: string): { ok: boolean; reason: string } {
  const git = (args: string[]) => routineGit(root, args);
  const inside = git(["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || String(inside.stdout ?? "").trim() !== "true") {
    return { ok: false, reason: "not a git work tree — append left uncommitted" };
  }
  if (git(["ls-files", "--error-unmatch", "--", relPath]).status !== 0) {
    return { ok: false, reason: `${relPath} is untracked — append left uncommitted` };
  }
  const added = git(["add", "--", relPath]);
  if (added.status !== 0) {
    return { ok: false, reason: `git add failed: ${String(added.stderr ?? "").trim().slice(0, 200)}` };
  }
  // 「已提交」与「提交失败」必须分开（硬规则 3b）。实测：`quay-native task create` 自己就提交了它写的
  // 任务文件 ⇒ 走到这里时往往已经是 HEAD 的内容，`git commit` 会以 exit 1 + "nothing to commit" 收场。
  // 把它当成失败上报，会让每一个**成功**的立案都附一条假 failure（第一版就是这样）。
  const staged = String(git(["diff", "--cached", "--name-only", "--", relPath]).stdout ?? "").trim();
  if (staged === "") {
    const head = git(["show", `HEAD:${relPath}`]);
    let work = null;
    try { work = fs.readFileSync(path.join(root, relPath), "utf8"); } catch { /* unreadable ⇒ 不作合格判定 */ }
    if (head.status === 0 && work !== null && String(head.stdout ?? "") === work) {
      return { ok: true, reason: "already committed (nothing to stage)" };
    }
    return { ok: false, reason: `${relPath} has no staged change but differs from HEAD ⇒ not trusting it as committed` };
  }
  const committed = git(["commit", "--no-verify", "-m", message, "--", relPath]);
  if (committed.status !== 0) {
    // hard rule 11：⛔ 绝不在共享索引上留一个已暂存未提交的状态去等窗口。
    git(["reset", "--", relPath]);
    return { ok: false, reason: `git commit failed (unstaged, bytes kept on disk): ${String(committed.stderr ?? "").trim().slice(0, 200)}` };
  }
  return { ok: true, reason: "committed" };
}

/** 持久 last-run 表（读不出/坏 JSON ⇒ `{}`：**从未运行 ⇒ due**，与 routine-scheduler.isDue 同契约）。 */
export function readLastRunMap(lastRunPath: string): Record<string, number> {
  try {
    const j = JSON.parse(fs.readFileSync(lastRunPath, "utf8"));
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, number>) : {};
  } catch { return {}; }
}

/** merge 写回一条 last-run（⛔ 不覆盖别的 routine 的键）。 */
export function writeLastRun(lastRunPath: string, name: string, ts: number): void {
  const map = readLastRunMap(lastRunPath);
  map[name] = ts;
  fs.mkdirSync(path.dirname(lastRunPath), { recursive: true });
  fs.writeFileSync(lastRunPath, JSON.stringify(map, null, 1), "utf8");
}

// ── prompt 组装（唯一构造点，同 launchArgv 的 AC140 纪律）──────────────────────────────────────
/** 探针 prompt = `WORKSPACE:` 头（让 agent 能解析工作区相对路径）+ 探针规格的 objective + 机器可读
 *  输出契约 + READ-ONLY 边界。⛔ objective 逐字来自 `plugin/probes/<name>.md`，不在此处改写方法。 */
export function buildProbePrompt(objective: string, opts: { workspace: string; name: string }): string {
  return [
    `WORKSPACE: ${opts.workspace}`,
    `You are the fresh-context probe runner for the standing routine "${opts.name}" (probe spec: plugin/probes/${opts.name}.md, objective below).`,
    "⛔ READ-ONLY: do NOT modify, create, or delete any file in the workspace. Your entire product is the JSON object on stdout — every write to disk is performed mechanically by the routine afterwards.",
    "",
    String(objective ?? "").trim(),
    "",
    "OUTPUT CONTRACT (the routine parses your stdout mechanically — a boolean, a summary, or prose is NOT a usable answer):",
    'Reply with ONLY one JSON object: {"findings":[{"id":"<slug>","kind":"<kind>","symbols":["<fn>"],"files":["<path:line>"],"verdict":"<verdict>","rationale":"<one line>","suggestedAction":"<one line>"}],"shards":<int>,"inventory":{"<surface>":<int>},"notes":"<one line>"}',
    "Every finding MUST carry files (concrete paths), symbols (function/entity names) and a rationale — a finding missing any of the three is DROPPED by the parser and counted as malformed.",
    "If you found nothing, reply with an empty findings array (that is a real measurement, not a failure).",
  ].join("\n");
}

// ── 例程本体 ─────────────────────────────────────────────────────────────────────────────────

export interface ProbeRoutineOptions {
  /** 工作区根 = 探针要分析/记录的仓库；也是 FILE-ONLY 快照与 `WORKSPACE:` 头的取值处。 */
  root: string;
  /** 探针规格所在 plugin 根（`<pluginRoot>/probes/<name>.md`）。 */
  pluginRoot: string;
  /** 单次 spawn 的 wall-clock 上限（ms）。**由调用方从 driver 的例程看门狗派生**（default
   *  `Math.max(60_000, routineWatchdogMs - 60_000)`）——⛔ 本模块不另立字面量（硬规则 4 推论二：
   *  写死一个「合理」的秒数，换台机器/换个负载就变成真限制，且静默）。 */
  probeTimeoutMs: number;
  /** spawn 用的 role（缺省 PROBE_ROLE_DEFAULT）。 */
  role?: string;
  /** 状态目录（缺省 `<root>/.quay`）：载体与 last-run 都落在这里。测试缝（⛔ 别让测试写进真工作区）。 */
  stateDir?: string;
  /** 载体路径覆盖（缺省 `<stateDir>/routine-findings.jsonl`）。 */
  findingsPath?: string;
  /** last-run 路径覆盖（缺省 `<stateDir>/routine-last-run.json`）。 */
  lastRunPath?: string;
  /** argv 构造缝（测试用假探针；缺省 `launchArgv(role, prompt, root)`）。 */
  probeArgv?: (prompt: string, decl: RoutineDecl) => string[];
  /** spawn 缝（缺省 runAsync）。 */
  spawnFn?: typeof runAsync;
  /** 时钟缝（缺省 Date.now）。 */
  now?: () => number;
  /** 任务板目录（缺省 `<root>/tasks`）——机械立案步的落点。 */
  tasksDir?: string;
  /** 本 kernel 的 plugin root（缺省从本文件位置推导）：出厂布局下 vendored task CLI 的锚点。 */
  kernelPluginRoot?: string | null;
  /** **立案开关缝（测试用）**：缺省 true。`false` ⇒ 立案步整段不出产任务，用于「关掉产出面 ⇒ 不产出」
   *  的反向对照（AC6）——⛔ 不是生产开关，生产恒为 true。 */
  filingEnabled?: boolean;
  /** 立案的 rate 上限（缺省 DEFAULT_RATE）。 */
  filingRate?: number;
  /** 任务写入缝（测试用；缺省 spawn workspace 自己的 task store CLI）。第四参 = 要落的 status
   *  （升级形态为 `needs-human`；缺省 null = 由 store 的 default_task_status 决定）。 */
  fileTaskFn?: (taskId: string, title: string, body: string, status?: string | null) => Promise<{ ok: boolean; reason: string }>;
  /** 执行探针的 spawn 缝（测试用；缺省 `defaultRunExecutionProbe` = 真跑 mapping 声明的 argv）。
   *  ⛔ 注入它是为了让**同一个判定**能对着受控读数跑；生产路径恒为默认值。 */
  runExecutionProbe?: (decl: ExecutionProbeDecl) => ExecutionProbeRun;
}

/** 把一条声明变成 Layer-1b 例程。`schedule` 用 routine-scheduler 的解析结果（**interval:<N>m 是
 *  唯一被本机制接受的形态**——两层模式没有迭代计数，见 parseTrigger 的注释）。 */
export function llmProbeRoutine(decl: RoutineDecl, opts: ProbeRoutineOptions): RoutineSpec {
  const trigger = parseTrigger(decl.trigger) as { kind: string; minutes?: number };
  const role = opts.role ?? PROBE_ROLE_DEFAULT;
  const stateDir = opts.stateDir ?? path.join(opts.root, ".quay");
  const findingsPath = opts.findingsPath ?? path.join(stateDir, path.basename(ROUTINE_FINDINGS_REL));
  const lastRunPath = opts.lastRunPath ?? path.join(stateDir, path.basename(ROUTINE_LAST_RUN_REL));
  const spawnFn = opts.spawnFn ?? runAsync;
  const clock = opts.now ?? Date.now;

  return {
    name: decl.name,
    schedule: trigger,
    run: async (ctx): Promise<Fact<Record<string, unknown>>[]> => {
      const started = clock();
      const fact = (state: Fact["state"], value: Record<string, unknown>, reason: string): Fact<Record<string, unknown>>[] =>
        [{ name: decl.name, value, state, reason }];

      // ① 持久窗口：driver 重启不重触发（loop 的 lastRun 是进程内存态；见本文件头注释）。
      if (trigger.kind === "interval" && typeof trigger.minutes === "number") {
        const last = Number(readLastRunMap(lastRunPath)[decl.name]);
        if (Number.isFinite(last) && last > 0 && started - last < trigger.minutes * 60_000) {
          const agoMin = Math.round((started - last) / 60_000);
          return fact("not-evaluated", { fired: false, carrier: path.relative(opts.root, findingsPath) },
            `within durable last-run window (ran ${agoMin}m ago, interval ${trigger.minutes}m) — not re-fired`);
        }
      }

      // ② 探针规格 fail-closed（读不到 ⇒ 未评估，⛔ 不伪装成「没找到重复」）。
      let spec: Awaited<ReturnType<typeof readProbeSpec>>;
      try {
        spec = readProbeSpec(decl.probe as string, opts.pluginRoot);
      } catch (e) {
        return fact("not-evaluated", { fired: false, carrier: path.relative(opts.root, findingsPath) },
          `probe spec unreadable: ${(e as Error).message}`);
      }

      // ③ halt 是轮内的闸：只挡 spawn，不挡观测（gap-drain-on-routine-driver-empties-…）。
      if (ctx?.halted === true) {
        return fact("not-evaluated", { fired: false, probe: decl.probe, carrier: path.relative(opts.root, findingsPath) },
          "halted: probe spawn suppressed (halt gates the spawn, not the routine track)");
      }

      // ④ spawn 一个全新上下文（每次都是新进程 ⇒ 抗漂移靠这个，不靠提示词）。
      const prompt = buildProbePrompt(spec.objective, { workspace: opts.root, name: decl.name });
      let argv: string[];
      try {
        argv = opts.probeArgv ? opts.probeArgv(prompt, decl) : launchArgv(role, prompt, opts.root);
      } catch (e) {
        return fact("failed", { fired: false, probe: decl.probe }, `probe argv unavailable (profiles?): ${(e as Error).message}`);
      }
      const before = snapshotTrackedChanges(opts.root);
      const r = await spawnFn(argv, { timeoutMs: opts.probeTimeoutMs, collectStderr: true });
      const durationMs = clock() - started;
      const base = { fired: true, probe: decl.probe, role, durationMs, exit: r.status, carrier: path.relative(opts.root, findingsPath) };
      if (r.error) {
        return fact("failed", base, `probe spawn error: ${r.error.message}`);
      }

      // ⑤ FILE-ONLY 守卫：探针运行期间不得改动 tracked 文件（除 tasksDir——旧 routines 契约允许的落点）。
      const violations = probeWriteViolations(
        before,
        snapshotTrackedChanges(opts.root),
      );
      if (violations === null) {
        return fact("not-evaluated", base, "FILE-ONLY guard could not read the tree (git unavailable) — probe output NOT trusted, nothing recorded");
      }
      const real = violations.filter((f) => !FILE_ONLY_ALLOWED_PREFIXES.some((p) => f.startsWith(p)));
      if (real.length > 0) {
        return fact("failed", { ...base, writeViolations: real.slice(0, 10) },
          `probe violated FILE-ONLY: ${real.length} tracked file(s) changed during the spawn (${real.slice(0, 3).join(", ")}) ⇒ nothing recorded`);
      }

      // ⑥ 结构化产出 → 载体。读不懂 ⇒ failed（⛔ 不猜、不落半条）。
      const parsed = parseProbeFindings(r.stdout ?? "");
      if (!parsed) {
        // 诊断落盘：「读不懂」若不留原件，就只剩一句无法追查的话（硬规则 3b 的代价形态——
        // 第一次真跑 310s 的输出因此不可查）。原文写到 stateDir，路径进 Fact。
        const rawPath = path.join(stateDir, `routine-probe-failed-${started}.out`);
        let rawRel: string | null = null;
        try {
          fs.mkdirSync(path.dirname(rawPath), { recursive: true });
          fs.writeFileSync(rawPath, String(r.stdout ?? ""), "utf8");
          rawRel = path.relative(opts.root, rawPath);
        } catch { /* 诊断落盘失败不致命 */ }
        return fact("failed", { ...base, ...(rawRel ? { rawProbeOutput: rawRel } : {}) },
          `unparseable probe output (exit ${r.status})${rawRel ? ` — raw stdout saved to ${rawRel}` : ""} — expected one JSON object per the probe's output contract`);
      }
      const runId = `${decl.name}-${started}`;
      const tasksDir = opts.tasksDir ?? path.join(opts.root, "tasks");
      // ⑥b remedy availability —— 本条（gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer）的
      //     要点：把「本机可执行的产出者 = 0」从一个**探针自发字段**（只活在 inventory/notes 散文里、
      //     零消费者）升成**规格声明的取值**，并在**立案链**里消费它。⛔ 这里是**机械**评估：与探针
      //     自报值分开记录、机械值优先（它可复现，而探针自报值是每轮重新释义的）。⛔ 不执行产出者 ——
      //     只跑 mapping 声明的**可达性探针**（一条 BatchMode ssh 的 trivial 远程命令）。
      const mappingRel = (spec.output_routing as Record<string, unknown> | undefined)?.producers_file;
      const mappingDeclared = typeof mappingRel === "string" && mappingRel.trim() !== "";
      // ⚠️ 三值，⛔ 不把「未声明」与「声明了但读不懂」合并（硬规则 3b；第一版合并过，被 (f) 的
      //    「no registry declared」用例抓住）：undefined = 未声明 ⇒ 闸不适用；null = 读不懂 ⇒ fail-closed。
      const mappingPath = mappingDeclared ? resolveMappingPath(opts.root, opts.pluginRoot, String(mappingRel)) : null;
      const mapping = mappingPath
        ? readProducerMapping(mappingPath)
        : { producers: undefined as undefined, executionProbe: null as ExecutionProbeDecl | null, commands: new Map<string, string>() };
      const registeredProducers = mapping.producers;
      const executionProbe = mapping.executionProbe;
      const remedySpec = (spec.output_routing as Record<string, unknown> | undefined)?.remedy_availability;
      const remedySpecValues = remedySpec && typeof remedySpec === "object" && !Array.isArray(remedySpec)
        ? (Array.isArray((remedySpec as Record<string, unknown>).values)
          ? ((remedySpec as Record<string, unknown>).values as unknown[]).map((v) => String(v).trim()).filter(Boolean)
          : [])
        : [];
      const remedy = ((): RemedyAvailability => {
        if (!executionProbe) {
          return {
            status: "not-declared", evaluated: false, source: "none", probeId: null, probeReported: null,
            specValues: remedySpecValues, observed: null,
            reason: `${String(mappingRel ?? "<no mapping>")} declares no execution_probe ⇒ remedy availability not applicable to this routine (⛔ NOT the same as 'executable')`,
          };
        }
        const run = (opts.runExecutionProbe ?? defaultRunExecutionProbe)(executionProbe);
        const mechanical = classifyExecutionProbeResult(executionProbe, run);
        const obj = extractJsonObject(r.stdout ?? "") as Record<string, unknown> | null;
        const reportedKey = remedySpec && typeof remedySpec === "object" && !Array.isArray(remedySpec)
          && typeof (remedySpec as Record<string, unknown>).key === "string" && String((remedySpec as Record<string, unknown>).key).trim()
          ? String((remedySpec as Record<string, unknown>).key).trim()
          : "remedyAvailability";
        return foldProbeReportedValue(mechanical, obj ? obj[reportedKey] : null, remedySpecValues);
      })();
      const records: Record<string, unknown>[] = [{
        ts: new Date(started).toISOString(),
        kind: "scan-round",
        routine: decl.name,
        probe: decl.probe,
        role,
        runId,
        findings: parsed.findings.length,
        malformed: parsed.malformed,
        shards: parsed.shards,
        inventory: parsed.inventory,
        notes: parsed.notes,
        // ⛔ 顶层、独立取值（硬规则 3b）：⛔ 不与 inventory/notes 散文混写 —— 一个只活在散文里的
        //    读数没有消费者，正是本条要关掉的那个形态。词表由探针规格声明（`remedy_availability`）。
        remedy_availability: remedy,
        exit: r.status,
        durationMs,
      }, ...parsed.findings.map((f) => ({
        ts: new Date(started).toISOString(),
        kind: "finding",
        routine: decl.name,
        probe: decl.probe,
        runId,
        findingId: f.id,
        dupKind: f.kind,
        subject: f.subject,
        symbols: f.symbols,
        files: f.files,
        verdict: f.verdict,
        rationale: f.rationale,
        suggestedAction: f.suggestedAction,
      }))];
      let recorded = 0;
      try {
        recorded = appendRoutineFindings(findingsPath, records);
      } catch (e) {
        return fact("failed", base, `carrier append failed: ${(e as Error).message}`);
      }

      // ⑦ 机械立案（AC5/AC6）：append 之后，把 actionable finding 经三道闸落成**新任务文件**。
      //    ⛔ FILE-ONLY —— 只立案，不执行（缺口重跑/修复仍归派发链）。见本文件头部与 selectFilings 注释。
      //    产出者登记面与执行探针都在 ⑥b 一次读完（⛔ 同一份文件不读第二遍）。
      if (mappingDeclared && registeredProducers === null) {
        // fail-closed：登记面声明了却读不懂 ⇒ 不立案（⛔ 不得把「读不懂」当成「没有未登记的」）。
        return fact("failed", { ...base, runId, recordsAppended: recorded, producerRegistry: String(mappingRel) },
          `producer registry declared but unreadable (${String(mappingRel)}) ⇒ no findings filed this round, carrier records kept`);
      }
      let dispositions: FilingDisposition[] = [];
      const filed: string[] = [];
      const escalated: string[] = [];
      const fileErrors: string[] = [];
      if (opts.filingEnabled !== false) {
        dispositions = selectFilings(parsed.findings, {
          routine: decl.name, probe: decl.probe as string, runId, ts: new Date(started).toISOString(),
          carrierPath: findingsPath, carrierRel: path.relative(opts.root, findingsPath),
          tasksDir, nowMs: started, k: opts.filingRate ?? DEFAULT_RATE, registeredProducers,
          remedy, remedyProbe: executionProbe,
        });
        for (const d of dispositions) {
          if (!d.accepted || !d.taskId) continue;
          const f = parsed.findings.find((x) => x.id === d.findingId);
          if (!f) continue;
          // 单行标题：rationale 里的换行会让 `task create --title` 写出 YAML 折行块（实测），难看且易漂。
          // 升级形态在标题前加一个可见前缀，使板上「人可见通道」的立案与可派发立案在标题面即可区分。
          const title = `${decl.name}${d.escalate ? " [remedy-blocked] " : ": "}${String(f.rationale).replace(/\s+/g, " ").trim()}`.slice(0, 180);
          const body = renderRoutineTaskBody({ ...f }, {
            routine: decl.name, probe: decl.probe as string, runId, carrier: path.relative(opts.root, findingsPath),
            ts: new Date(started).toISOString(), taskId: d.taskId,
          }, d.escalate ? {
            blocked: {
              probeId: remedy.probeId,
              observed: remedy.observed,
              remedy: executionProbe?.remedy ?? null,
              // ⛔ 逐字来自 mapping 自己的 `producers[].command`（同一次读，`mapping.commands`）——
              //    升级体里 ⛔ 不重打一份命令，那会制造第二个真相源（硬规则 5b）。
              producerCommand: (f.producer ? mapping.commands.get(String(f.producer).trim()) : null) ?? null,
            },
          } : undefined);
          // 升级形态落 `needs-human`：本项目现成的「人可见、不进派发候选」通道。⛔ 不新增成因枚举、
          // ⛔ 不新增再入队路径（人 2026-09-20 裁定）；⛔ 也不给这个任务加任何成因类 frontmatter 字段。
          const escalateStatus = d.escalate ? "needs-human" : null;
          const w = opts.fileTaskFn
            ? await opts.fileTaskFn(d.taskId, title, body, escalateStatus)
            : fileRoutineTask(opts.root, opts.kernelPluginRoot ?? null, d.taskId, title, body, ["gap", "routine-filed", decl.name], tasksDir, escalateStatus);
          if (w.ok) {
            // 写盘即提交（与载体同一条判据）：⛔ 不留一个「已立案但没人提交」的任务文件。
            // ⚠️ 实测这里通常是**空转**——`quay-native task create` 自己就提交它写的文件（见
            //    commitRoutineWrite 的注释）。保留它是为了不依赖那个「CLI 会提交」的假设（非 git
            //    工作区里它做不到），而 commitRoutineWrite 已把「已提交」与「提交失败」分开。
            const taskRel = path.relative(opts.root, path.join(tasksDir, `${d.taskId}.md`));
            const tc = commitRoutineWrite(opts.root, taskRel, `routine(${decl.name}): file ${d.taskId} from finding ${d.findingId}`);
            filed.push(d.taskId);
            if (d.escalate) escalated.push(d.taskId);
            if (!tc.ok) fileErrors.push(`${d.taskId}: filed but not committed — ${tc.reason}`);
          } else {
            fileErrors.push(`${d.taskId}: ${w.reason}`);
          }
        }
      }
      // 立案轮次落痕（rate 窗口的唯一读数来源；⛔ 不另立计数器文件）。
      try {
        appendRoutineFindings(findingsPath, [{
          ts: new Date(started).toISOString(), kind: "filing-round", routine: decl.name, probe: decl.probe,
          runId, evaluated: opts.filingEnabled !== false,
          candidates: parsed.findings.length,
          filed,
          // 升级面单独一类（⛔ 不与 `filed` 合并）：这两条通道的产物**形状不同、消费者不同**，
          // 合并会让「本轮走了人可见通道」与「本轮照常派发」在载体里同形（硬规则 3）。
          escalated,
          remedy_availability: remedy.status,
          rejected: dispositions.filter((d) => !d.accepted).map((d) => ({ findingId: d.findingId, gate: d.gate, reason: d.reason })),
          errors: fileErrors,
        }]);
      } catch { /* 立案落痕失败不推翻本轮读数 */ }

      // ⑧ 追加即提交（AC7）：本轮的全部追加（scan-round + finding + filing-round）在**同一次动作**里
      //    落到 HEAD，于是「例程写了、还没人提交」这个丢失窗口长度归零。失败只报不抛（见其注释）。
      const carrierRel = path.relative(opts.root, findingsPath);
      const commit = commitRoutineWrite(opts.root, carrierRel, `routine(${decl.name}): findings round ${runId}`);

      // last-run 只在**真的产出了记录**之后写回：违约/失败轮不占窗口，下一轮仍会重试。
      try { writeLastRun(lastRunPath, decl.name, started); } catch { /* last-run 写失败 ⇒ 下轮重跑，不致命 */ }

      // AC5 的红侧：探针点名了一个**未登记**的产出者 = 探针自身的完整性缺陷（它凭空造了一个主体）
      // ⇒ 本轮判 failed 并**逐条指名**（⛔ 不静默降级成一条普通 rejected 记录）。登记齐备 ⇒ verified。
      const producerRejects = dispositions.filter((d) => d.gate === "producer");
      if (producerRejects.length > 0) {
        return fact("failed", {
          ...base, runId, recordsAppended: recorded, findings: parsed.findings.length, malformed: parsed.malformed,
          filed, filingRejected: dispositions.length - filed.length, carrierCommit: commit.ok ? "committed" : commit.reason,
          unregisteredProducers: producerRejects.map((d) => ({ findingId: d.findingId, reason: d.reason })),
        }, `probe named ${producerRejects.length} UNREGISTERED producer(s) — nothing filed for them: ${producerRejects.map((d) => `${d.findingId ?? "<no-id>"} (${d.reason})`).join("; ")}`);
      }
      return fact("verified", {
        ...base,
        runId,
        findings: parsed.findings.length,
        malformed: parsed.malformed,
        shards: parsed.shards,
        inventory: parsed.inventory,
        recordsAppended: recorded,
        filed,
        escalated,
        remedy_availability: remedy.status,
        remedy_source: remedy.source,
        filingRejected: dispositions.filter((d) => !d.accepted).length,
        carrierCommit: commit.ok ? "committed" : commit.reason,
      }, `deep scan ran: ${parsed.findings.length} structured finding(s), ${parsed.malformed} malformed, ${parsed.shards ?? "?"} shard(s), ${recorded} record(s) appended to ${path.relative(opts.root, findingsPath)}, ${filed.length} filed as task(s)${escalated.length ? `, ${escalated.length} of them via the HUMAN-VISIBLE channel (remedy availability: ${remedy.status})` : ""} — remedy availability: ${remedy.status} (${remedy.reason})`);
    },
  };
}

/** 生产入口：读配置 → 选可驱动的 → 造例程表。**永不抛**（一条可选的例程轨道不得拖垮宿主 driver
 *  的启动）；读不出配置时把理由经 `error` 交回调用方去**可见地**报告（⛔ 不静默变空转）。 */
export function probeRoutinesFromConfig(
  root: string,
  opts: Omit<ProbeRoutineOptions, "root">,
): { routines: RoutineSpec[]; skipped: { name: string; trigger: string; reason: string }[]; error: string | null } {
  let decls: RoutineDecl[];
  try {
    decls = readRoutinesConfig(root);
  } catch (e) {
    return { routines: [], skipped: [], error: (e as Error).message };
  }
  const { probes, skipped } = selectProbeRoutines(decls);
  return { routines: probes.map((d) => llmProbeRoutine(d, { ...opts, root })), skipped, error: null };
}
