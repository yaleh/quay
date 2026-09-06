#!/usr/bin/env node
// @instrument "Are the active goals' declared criteria actually passing — and when a criterion's real
//   verdict disagrees with the record, does anything notice and propose a correction?"
//
// meta-driver.ts — 机制演进的观测/提案例程（SPEC-capability-planes §12.2 提名管线的第一片实现）。
//
// PROBLEM（实测，2026-09-06）：`goal-store.ts gate <id>` 已经实现了「跑 criterion → 写 GateEvent →
// 把 evidence{at,verdict,reading} 回写记录」的完整机械半，而 `.quay/gate-events.jsonl` 里
// `"gate":"goal"` 事件数 = **0**——它从未被调用过一次。于是 goal store 建立当天即漂移：AC-170 /
// AC-173 的 criterion 实跑是 PASS，记录却仍是 active 未翻转。**缺的不是机制，是轮子**（同
// memory define-correct-mechanism-not-patch：正解入口已存在且零调用者 ⇒ 接线，不是再造一个）。
//
// 同期实测的第二个量：人在 3 天内手写 ScheduleWakeup 自循环做同类监测 **37 轮**（fan-in 收敛 24 +
// 「推进 GOAL-001」11 + 单任务盯梢 2，间隔 ~20min），prompt 正文里逐字抄着「每轮机械读取…」——
// 即本文件要取代的那个「自带私有常驻 + 私有状态」的手工机制（SPEC §8「取代」类判准逐字命中）。
//
// 形态（ADR-033 的分工，与 pool-quality-judge 同构）：
//   机械半（本文件，零 LLM）：枚举 active goal 的 AC → 逐条真跑 `goal-store.ts gate <id>` →
//                              机械算出 divergence 三类 → 出读数。
//   语义半（plugin/probes/meta-driver.md，短命 claude -p）：只对读数做「这意味着什么/该提什么案」，
//                              ⛔ 不自己采证、⛔ 不执行、⛔ 不翻状态。
//
// 抗漂移靠结构而非提示词：①每轮全新短命上下文；②读数由脚本预算好，LLM 不自采证；③输出是约定
// JSON，解析不了 ⇒ not-evaluated（⛔ 绝不静默当合格，硬规则 3b）；④行为规格是版本化的 probe 文件；
// ⑤每轮追加 Fact 到载体 ⇒ 它的沉默可被检测。
//
// 自动/提案的界线**按动作类别与可逆性划，不按自评信心**（自评信心结构上不可取假，硬规则 4）：
//   自动：跑 criterion、写 evidence/GateEvent（`goal-store gate` 自带）、写读数与 Fact、写 draft 提案
//         （draft 记录构造上惰性——写下它不会让任何事发生，安全性来自构造而非纪律）。
//   ⛔ 提案（要人确认）：激活 goal（draft→active，SPEC-goal-mechanism 裁定 3 保留给人）、翻任何状态、
//         新建/退役/合并机制、改闸的判据、改它自己的 probe 规格。
//
// 节制复用既有机件，不另造：`routine-file-gate.ts` 的三闸（quality 证据正则 / dedup findingKey /
// rate K=3）——它此前零调用者，本文件是它的第一个消费者。
//
// Usage:
//   node --experimental-strip-types plugin/scripts/meta-driver.ts [--root <dir>] [--once]
//        [--no-llm] [--focus "<steer>"] [--k N] [--json]
// Exit: 0 = 轮跑完（含 not-evaluated）; 1 = 轮失败（failed fact）; 2 = usage。

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { launchArgv, runAsync, ts, aliveness, carrierStats, KNOWN_KINDS, type Fact, type RoutineSpec } from "./driver-runtime.ts";
import { runResidentQualityGateLoop, computeRoundRecord } from "./quality-gate-driver.ts";
import { readProbeSpec } from "./read-probe-spec.ts";
import { gateFinding, findingKey, DEFAULT_RATE } from "./routine-file-gate.ts";
import { isDirectEntry } from "./gate-script-base.ts";

/** 载体：每轮一条记录（与 quality-round.jsonl 同族，gitignored 运行时状态）。 */
export const ROUND_CARRIER_REL = path.join(".quay", "meta-driver-round.jsonl");

/** 机械 spawn 的超时（跑一条 criterion）。⛔ LLM 派发不设有限超时——成本结构未测出前不设阈值
 *  （硬规则 4 推论一；同 quality-gate-driver 的 judgeTimeoutMs=Infinity 裁定）。 */
export const CRITERION_TIMEOUT_MS = 120_000;

/** 一条 AC 的本轮读数。verdict 来自真跑，不是记录自述。 */
export interface CriterionReading {
  id: string;
  title: string | null;
  goal: string | null;
  status: string;
  criterion: string | null;
  verdict: "pass" | "fail" | "not-evaluated";
  reason: string;
}

/** 机械算出的三类偏离（criterion 的真值 vs 记录的自述）。 */
export type DivergenceKind = "pass-but-unflipped" | "achieved-but-failing" | "no-criterion";
export interface Divergence {
  id: string;
  kind: DivergenceKind;
  status: string;
  verdict: string;
  reason: string;
}

/** 一轮的完整读数（喂给语义半的输入，也是载体里那条记录的值面）。 */
export interface MetaRoundReadings {
  goals: Array<{ id: string; title: string | null; status: string }>;
  criteria: CriterionReading[];
  divergences: Divergence[];
  /** 机制生态：每个 driver kind 在不在跑、载体多久没动。 */
  drivers: DriverReading[];
  /** author↔develop 同步的成败计数（该机制自己的产物）。 */
  syncHealth: SyncHealth;
  focus: string | null;
}

// ── 机械半 ────────────────────────────────────────────────────────────────────────────────────────

/** goal-store CLI 的 argv（单一构造点——所有 goal 读写都经这里，⛔ 不在别处拼路径）。
 *  `scriptRoot` 定位脚本，`dataRoot` 定位 `goals/` 与 `.quay/gate-events.jsonl`；生产上两者相同。
 *  **总是显式传 `--root`**：goal-store 的缺省是从 cwd 向上找根，driver 从别的 cwd 跑时会找错
 *  （隐式 cwd 依赖，硬规则 4b：别让判定量经过一层未经验证的中间推导）。 */
export function goalStoreArgv(scriptRoot: string, sub: string[], dataRoot: string = scriptRoot): string[] {
  return [
    "node", "--no-warnings", "--experimental-strip-types",
    path.join(scriptRoot, "packages", "quay", "src", "goal-store.ts"),
    ...sub, "--root", dataRoot,
  ];
}

/** 读全部 goal 记录。解析不了 ⇒ 抛（fail-closed：读不到输入不得继续，⛔ 不返回空数组冒充"没有"）。 */
export async function listGoalRecords(root: string): Promise<Array<Record<string, unknown>>> {
  const r = await runAsync(goalStoreArgv(root, ["list"]), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error || r.status !== 0) {
    throw new Error(`goal-store list failed (exit ${r.status}): ${(r.stderr || "").trim().slice(0, 300)}`);
  }
  const parsed = JSON.parse(String(r.stdout ?? "").trim());
  if (!Array.isArray(parsed)) throw new Error("goal-store list did not return an array");
  return parsed as Array<Record<string, unknown>>;
}

/** 跑一条 AC 的 criterion。⚠️ 副作用是设计如此：`goal-store gate` 自己写 GateEvent + evidence 回写，
 *  这正是「自动档」允许的那类动作（观测性、可逆、不改变系统行为）。 */
export async function gateCriterion(root: string, id: string): Promise<{ verdict: "pass" | "fail" | "not-evaluated"; reason: string }> {
  const r = await runAsync(goalStoreArgv(root, ["gate", id]), { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return { verdict: "not-evaluated", reason: `gate spawn error: ${r.error.message}` };
  // exit 0 = pass, 1 = fail（含空 criterion 的 fail-closed）, 2 = 用法/记录不存在 ⇒ 无法评估。
  if (r.status === 2) return { verdict: "not-evaluated", reason: `gate usage error: ${(r.stderr || "").trim().slice(0, 200)}` };
  try {
    const out = JSON.parse(String(r.stdout ?? "").trim());
    const v = out.verdict === "pass" ? "pass" : out.verdict === "fail" ? "fail" : "not-evaluated";
    return { verdict: v, reason: String(out.reason ?? "").slice(0, 500) };
  } catch {
    // 读不懂输出 ≠ 合格（硬规则 3b）——给它一个独立取值，不与 pass/fail 共用。
    return { verdict: "not-evaluated", reason: `unparseable gate output (exit ${r.status})` };
  }
}

/** 机械算 divergence。⛔ 只由 verdict 与 status 决定，无语义判断。 */
export function computeDivergences(readings: CriterionReading[]): Divergence[] {
  const out: Divergence[] = [];
  for (const c of readings) {
    const base = { id: c.id, status: c.status, verdict: c.verdict, reason: c.reason };
    if (!c.criterion || c.criterion.trim() === "") { out.push({ ...base, kind: "no-criterion" }); continue; }
    if (c.verdict === "pass" && c.status !== "achieved") { out.push({ ...base, kind: "pass-but-unflipped" }); continue; }
    if (c.verdict === "fail" && c.status === "achieved") { out.push({ ...base, kind: "achieved-but-failing" }); continue; }
  }
  return out;
}

/** 采本轮读数：active goal → 其下全部 AC → 逐条真跑 criterion → 算 divergence。 */
export async function collectReadings(root: string, focus: string | null): Promise<MetaRoundReadings> {
  const all = await listGoalRecords(root);
  const goals = all
    .filter((r) => String(r.id ?? "").startsWith("GOAL-") && r.status === "active")
    .map((r) => ({ id: String(r.id), title: r.title == null ? null : String(r.title), status: String(r.status) }));
  const goalIds = new Set(goals.map((g) => g.id));
  const acs = all.filter((r) => String(r.id ?? "").startsWith("AC-") && goalIds.has(String(r.goal ?? "")));

  const criteria: CriterionReading[] = [];
  for (const ac of acs) {
    const id = String(ac.id);
    const criterion = ac.criterion == null ? null : String(ac.criterion);
    const { verdict, reason } = await gateCriterion(root, id);
    criteria.push({
      id,
      title: ac.title == null ? null : String(ac.title),
      goal: ac.goal == null ? null : String(ac.goal),
      status: String(ac.status ?? ""),
      criterion,
      verdict,
      reason,
    });
  }
  return {
    goals, criteria, divergences: computeDivergences(criteria),
    drivers: collectDriverReadings(root),
    syncHealth: collectSyncHealth(root),
    focus,
  };
}

// ── 提案的闸与落地 ────────────────────────────────────────────────────────────────────────────────

/** 一条提案（语义半的产出形状，与 probe 规格里的 JSON 契约一一对应）。 */
export interface Proposal {
  goal: string;
  title: string;
  criterion: string;
  expect: string;
  origin: string;
}

/** 把提案渲染成 `routine-file-gate` 认识的候选文本（**同一个函数也用来给既有记录算 key**，
 *  这样两边的 key 可比——⛔ 不要为既有记录另写一套 key 算法）。 */
export function proposalCandidateText(p: { title?: string; criterion?: string | null; origin?: string | null }): string {
  return `## Finding\n${p.title ?? ""}\n\n${p.origin ?? ""}\n\n${p.criterion ?? ""}\n`;
}

/** 既有 AC 记录的 key 集（用于 dedup）。用与候选相同的渲染 + findingKey。 */
export function existingProposalKeys(records: Array<Record<string, unknown>>): Set<string> {
  const keys = new Set<string>();
  for (const r of records) {
    if (!String(r.id ?? "").startsWith("AC-")) continue;
    const k = findingKey(proposalCandidateText({
      title: r.title == null ? "" : String(r.title),
      criterion: r.criterion == null ? "" : String(r.criterion),
      origin: r.origin == null ? "" : String(r.origin),
    }));
    if (k) keys.add(k);
  }
  return keys;
}

/** 下一个可用 AC id（max + 1，三位补零）。⛔ 不复用已存在的编号（硬规则 8：编号不得复用）。 */
export function nextAcId(records: Array<Record<string, unknown>>): string {
  let max = 0;
  for (const r of records) {
    const m = String(r.id ?? "").match(/^AC-(\d{3,})$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `AC-${String(max + 1).padStart(3, "0")}`;
}

/** 写一条 draft 提案。⛔ 永不传 --status：goal-store 的 write 缺省即 draft（构造上惰性）。 */
export async function writeDraftProposal(root: string, id: string, p: Proposal, dataRoot: string = root): Promise<{ ok: boolean; reason: string }> {
  const argv = goalStoreArgv(root, [
    "write", id,
    "--goal", p.goal,
    "--title", p.title,
    "--criterion", p.criterion,
    "--expect", p.expect,
    "--origin", p.origin,
  ], dataRoot);
  const r = await runAsync(argv, { timeoutMs: CRITERION_TIMEOUT_MS, collectStderr: true });
  if (r.error) return { ok: false, reason: `write spawn error: ${r.error.message}` };
  if (r.status !== 0) return { ok: false, reason: `write exit ${r.status}: ${(r.stderr || "").trim().slice(0, 200)}` };
  return { ok: true, reason: "written as draft" };
}

/** 过闸 + 落地提案。返回每条的处置（accepted / 被哪一闸挡下），**逐条留痕**——⛔ 不只报总数
 *  （硬规则 3：枚举不布尔）。 */
export async function fileProposals(
  root: string,
  proposals: Proposal[],
  records: Array<Record<string, unknown>>,
  opts: { k: number; activeGoalIds: Set<string>; dryRun: boolean; dataRoot?: string },
): Promise<Array<{ proposal: Proposal; id: string | null; accepted: boolean; reason: string }>> {
  const results: Array<{ proposal: Proposal; id: string | null; accepted: boolean; reason: string }> = [];
  const keys = existingProposalKeys(records);
  const known = [...records];
  let acceptedThisRound = 0;

  for (const p of proposals) {
    if (!opts.activeGoalIds.has(p.goal)) {
      results.push({ proposal: p, id: null, accepted: false, reason: `invalid goal id ${JSON.stringify(p.goal)} (not an active goal)` });
      continue;
    }
    const candidate = proposalCandidateText(p);
    const g = gateFinding(candidate, { existingKeys: keys, recentCount: acceptedThisRound, K: opts.k });
    if (!g.accept) { results.push({ proposal: p, id: null, accepted: false, reason: g.reason }); continue; }
    const id = nextAcId(known);
    if (opts.dryRun) {
      results.push({ proposal: p, id, accepted: true, reason: "dry-run: would write as draft" });
    } else {
      const w = await writeDraftProposal(root, id, p, opts.dataRoot ?? root);
      if (!w.ok) { results.push({ proposal: p, id, accepted: false, reason: w.reason }); continue; }
      results.push({ proposal: p, id, accepted: true, reason: w.reason });
    }
    keys.add(findingKey(candidate));
    known.push({ id, goal: p.goal, title: p.title, criterion: p.criterion, origin: p.origin });
    acceptedThisRound++;
  }
  return results;
}

// ── 轮末结算 evidence 写入（⛔ 不把共享检出留在脏状态）────────────────────────────────────────────
// 实测代价：一轮机械半把 23 个 tracked 的 goals/*.md 写脏，而其中【25 行改动全部只是 evidence.at
// 时间戳】——零信息。常驻后这会让主检出永久脏 ⇒ syncDevelopToDoc 的 --ff-only 失败 ⇒ 正好加剧
// 它本要观测的那个同步失败率。**一个观测机制不得因为观测而破坏被观测的系统。**
//
// 结算规则：只有时间戳变了 ⇒ 还原（无信息）；verdict/reading 真变了 ⇒ 保留并报出（有信息，
// 由调用侧决定提交）。⛔ 只还原「除 at 行外与 HEAD 逐字相同」的文件——若有人另外改过该文件，
// 比较必然不等，于是原样不动（不会毁掉别人在编辑的改动）。

/** 去掉 evidence 的 at 行后的内容（比较用；at 每轮必变且不携带信息）。 */
export function stripEvidenceTimestamp(text: string): string {
  return text.replace(/^\s*at:\s*\S+\s*$/gm, "");
}

export interface EvidenceSettlement { restored: string[]; kept: string[]; skipped: string[] }

/** 轮末结算。返回逐条处置（⛔ 不只报总数，硬规则 3 枚举不布尔）。 */
export function settleEvidenceWrites(root: string, goalsRel = "goals"): EvidenceSettlement {
  const out: EvidenceSettlement = { restored: [], kept: [], skipped: [] };
  const vcs = (args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  let dirty: string[];
  try {
    const r = vcs(["status", "--porcelain", "--", goalsRel]);
    if (r.status !== 0) return out;
    dirty = String(r.stdout ?? "").split("\n")
      .map((l) => l.trim()).filter((l) => l.startsWith("M "))
      .map((l) => l.slice(2).trim());
  } catch { return out; }

  for (const rel of dirty) {
    let head: string, work: string;
    try {
      const h = vcs(["show", `HEAD:${rel}`]);
      if (h.status !== 0) { out.skipped.push(rel); continue; }
      head = String(h.stdout ?? "");
      work = fs.readFileSync(path.join(root, rel), "utf8");
    } catch { out.skipped.push(rel); continue; }

    if (stripEvidenceTimestamp(head) === stripEvidenceTimestamp(work)) {
      const c = vcs(["checkout", "--", rel]);
      if (c.status === 0) out.restored.push(rel); else out.skipped.push(rel);
    } else {
      out.kept.push(rel); // verdict/reading 真变了 ⇒ 有信息，保留
    }
  }
  return out;
}

// ── 机制生态读数（driver 是否在跑 / 同步是否在成功）──────────────────────────────────────────────
// 为什么在这里：meta-driver 的职责是【发现机制层面的问题，并判断有没有机制在管它】。只看 goal
// 判据看不见「主检出落后 develop」「某 driver 停摆」这类问题——那正是人 2026-09-06 指出的缺口。
// ⛔ 不自己实现存活/载体统计：复用 driver-runtime 已有的 aliveness/carrierStats（硬规则①）。

/** 一个 driver kind 的生态读数。staleSecs = 现在距其载体最后一条记录的秒数（载体停更 ≠ 一切正常）。 */
export interface DriverReading {
  kind: string;
  running: boolean;
  supervisorAlive: boolean;
  driverAlive: boolean;
  carrierRecords: number;
  carrierLastTs: string | null;
  staleSecs: number | null;
}

export function collectDriverReadings(root: string, now: number = Date.now()): DriverReading[] {
  const out: DriverReading[] = [];
  for (const kind of KNOWN_KINDS) {
    let a, c;
    try { a = aliveness(root, kind); } catch { a = null; }
    try { c = carrierStats(root, kind); } catch { c = null; }
    const lastTs = c?.lastTs ?? null;
    const parsed = lastTs ? Date.parse(lastTs) : NaN;
    out.push({
      kind,
      running: !!a?.running,
      supervisorAlive: !!a?.supervisorAlive,
      driverAlive: !!a?.driverAlive,
      carrierRecords: c?.records ?? 0,
      carrierLastTs: lastTs,
      // 读不出时刻 ⇒ null（⛔ 不填 0 冒充"刚刚"，硬规则 6：缺值 = 未查，不是为假）。
      staleSecs: Number.isFinite(parsed) ? Math.round((now - parsed) / 1000) : null,
    });
  }
  return out;
}

/** author↔develop 同步的健康度（成功/失败各多少）。这条载体是该机制自己的产物，
 *  ⛔ 不靠"看起来在跑"判断——它每轮都调，失败也每轮都落痕。 */
export interface SyncHealth {
  window: number;
  ffSynced: number;
  notFf: number;
  ffError: number;
  semanticResolved: number;
  lastEvent: string | null;
  lastTs: string | null;
}

export function collectSyncHealth(root: string, window = 200): SyncHealth {
  const file = path.join(root, ".quay", "doc-develop-sync.jsonl");
  const h: SyncHealth = { window, ffSynced: 0, notFf: 0, ffError: 0, semanticResolved: 0, lastEvent: null, lastTs: null };
  let lines: string[];
  try { lines = fs.readFileSync(file, "utf8").trim().split("\n"); } catch { return h; }
  for (const line of lines.slice(-window)) {
    let r: Record<string, unknown>;
    try { r = JSON.parse(line); } catch { continue; }
    const e = String(r.event ?? "");
    if (e === "doc-develop-sync-ff-synced") h.ffSynced++;
    else if (e === "doc-develop-sync-not-ff") h.notFf++;
    else if (e === "doc-develop-sync-ff-error") h.ffError++;
    else if (e === "doc-develop-sync-semantic-resolved") h.semanticResolved++;
    if (e) { h.lastEvent = e; h.lastTs = typeof r.ts === "string" ? r.ts : null; }
  }
  return h;
}

// ── 变化检测（语义半的触发闸）────────────────────────────────────────────────────────────────────

/** 语义半的触发状态（gitignored 运行时状态，与轮载体分开——它是【状态】不是【记录】）。 */
export const STATE_REL = path.join(".quay", "meta-driver-state.json");

/** 读数的稳定摘要：只含【会改变判读结论】的量（每条 AC 的 verdict/status + 偏离类别），
 *  ⛔ 不含时间戳/reason 文本（那些每轮都变，会让摘要恒不相等 ⇒ 变化检测恒为真 ⇒ 闸失效）。 */
export function readingsDigest(readings: MetaRoundReadings): string {
  const parts = [
    ...readings.criteria.map((c) => `${c.id}:${c.status}:${c.verdict}`).sort(),
    ...readings.divergences.map((d) => `${d.id}:${d.kind}`).sort(),
    // driver 只取【在跑与否】这个会改变结论的位；⛔ 不取 staleSecs/记录数——它们每轮都变，
    // 取了会让摘要恒不相等、变化检测闸失效（同 reason 文本的道理）。
    ...readings.drivers.map((d) => `drv:${d.kind}:${d.running ? 1 : 0}`).sort(),
    // 同步只取【最近是否在失败】这个位，⛔ 不取计数。
    `sync:${readings.syncHealth.lastEvent ?? "none"}`,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

export interface MetaState { digest: string | null; lastJudgedAt: string | null }

export function readState(root: string): MetaState {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, STATE_REL), "utf8"));
    return { digest: typeof j.digest === "string" ? j.digest : null, lastJudgedAt: typeof j.lastJudgedAt === "string" ? j.lastJudgedAt : null };
  } catch {
    // 读不到 ⇒ never-judged（⛔ 不当作"没变化"——那会让首轮静默跳过语义半）。
    return { digest: null, lastJudgedAt: null };
  }
}

export function writeState(root: string, s: MetaState): void {
  try {
    const f = path.join(root, STATE_REL);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(s, null, 2) + "\n", "utf8");
  } catch { /* 状态写失败不致命；下一轮退化为 never-judged ⇒ 多判一次，不会漏判 */ }
}

/** 语义半是否该跑。**事件触发 + 定时器地板**（08-23 SPEC §5 已裁定的模型的机械形态）：
 *  读数变了 ⇒ 跑；人给了 focus ⇒ 跑；距上次判读超过地板 ⇒ 跑。
 *  ⊢ 地板是**安全网不是调优参数**：它防的是「摘要因故恒不变 ⇒ 永不再判读」这一失效模式，
 *    故取一个粗值（缺省 24h）并显式可配，⛔ 不是按成本/收益调出来的阈值（硬规则 4 推论一）。 */
export function shouldJudge(
  args: { digest: string; state: MetaState; focus: string | null; now: number; floorMs: number },
): { judge: boolean; reason: string } {
  if (args.focus) return { judge: true, reason: "focus given by human" };
  if (args.state.digest === null) return { judge: true, reason: "never judged" };
  if (args.state.digest !== args.digest) return { judge: true, reason: "readings changed" };
  const last = args.state.lastJudgedAt ? Date.parse(args.state.lastJudgedAt) : NaN;
  if (!Number.isFinite(last)) return { judge: true, reason: "last-judged timestamp unreadable" };
  if (args.now - last >= args.floorMs) return { judge: true, reason: `floor reached (${Math.round((args.now - last) / 60000)}m since last judge)` };
  return { judge: false, reason: `unchanged since ${args.state.lastJudgedAt}` };
}

/** 语义半地板的缺省值（24h）——粗安全网，见 shouldJudge 的说明。 */
export const JUDGE_FLOOR_MS_DEFAULT = 24 * 60 * 60 * 1000;

// ── 语义半 ────────────────────────────────────────────────────────────────────────────────────────

/** 组装 probe prompt 的**单一构造点**（复刻 launchArgv 的 AC140 纪律：一次性入口与常驻入口
 *  共用同一个组装函数，⛔ 不各拼一份）。 */
export function buildProbePrompt(objective: string, readings: MetaRoundReadings): string {
  return [
    objective.trim(),
    "",
    "READINGS (mechanically collected this round — arithmetic, not a verdict):",
    JSON.stringify(readings),
  ].join("\n");
}

/** 解析语义半的输出。读不懂 ⇒ null（调用侧转 not-evaluated / failed，⛔ 不当空结果放行）。 */
export function parseProbeOutput(stdout: string): { divergences: unknown[]; proposals: Proposal[]; humanAttention: string[] } | null {
  const text = String(stdout ?? "").trim();
  if (!text) return null;
  // 容忍 LLM 在 JSON 前后带少量散文：取第一个 { 到最后一个 }。
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(s, e + 1)); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const proposals: Proposal[] = Array.isArray(o.proposals)
    ? (o.proposals as unknown[]).flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const p = raw as Record<string, unknown>;
        const need = ["goal", "title", "criterion", "expect", "origin"] as const;
        if (need.some((k) => typeof p[k] !== "string" || String(p[k]).trim() === "")) return [];
        return [{
          goal: String(p.goal).trim(), title: String(p.title).trim(), criterion: String(p.criterion).trim(),
          expect: String(p.expect).trim(), origin: String(p.origin).trim(),
        }];
      })
    : [];
  return {
    divergences: Array.isArray(o.divergences) ? (o.divergences as unknown[]) : [],
    proposals,
    humanAttention: Array.isArray(o.humanAttention) ? (o.humanAttention as unknown[]).map((x) => String(x)) : [],
  };
}

// ── 一轮 ──────────────────────────────────────────────────────────────────────────────────────────

export interface MetaRoundOptions {
  root: string;
  focus: string | null;
  noLlm: boolean;
  k: number;
  dryRun: boolean;
  /** 语义半的定时器地板（缺省 JUDGE_FLOOR_MS_DEFAULT）——安全网，非调优阈值。 */
  judgeFloorMs?: number;
  /** 测试缝：注入语义半的 argv（缺省经 launchArgv 派 claude -p）。 */
  probeArgv?: (prompt: string) => string[];
  /** 测试缝：probe 规格目录（缺省 <root>/plugin）。 */
  pluginRoot?: string;
}

/** 一轮的结果 = **一条 Fact**。⛔ 不再另出一个 record 形状：一次性路径与常驻循环若各写各的
 *  形状到同一个载体，读者就要在一个文件里分辨两套 schema（本仓库已在 verification-round 上
 *  付过这个代价）。统一信封 = computeRoundRecord({facts:[fact]})，明细全在 fact.value 里。 */
export interface MetaRoundResult {
  fact: Fact<Record<string, unknown>>;
}

/** 跑一轮：读数（机械，总是跑）→ 语义判读（可关）→ 提案过闸落地 → 出 Fact + 载体记录。 */
export async function runMetaRound(opts: MetaRoundOptions): Promise<MetaRoundResult> {
  const { root, focus, noLlm, k, dryRun } = opts;
  const at = ts();
  let readings: MetaRoundReadings;
  try {
    readings = await collectReadings(root, focus);
  } catch (e) {
    const reason = `readings failed: ${(e as Error).message}`;
    // 采读数途中失败也要结算——⛔ 不能因为异常路径就把共享检出留在脏状态。
    try { settleEvidenceWrites(root); } catch { /* 结算失败不致命 */ }
    return {
      fact: { name: "meta-driver", value: { phase: "readings" }, state: "failed", reason },
    };
  }

  // 读数已采完（criterion 全跑过），立刻结算 evidence 写入：只有时间戳变的还原，真变的保留。
  // ⛔ 放在这里而不是函数末尾：语义半可能很慢（实测 134–175s），那段时间不该让共享检出脏着。
  const settlement = settleEvidenceWrites(root);

  const base = {
    goalCount: readings.goals.length,
    criterionCount: readings.criteria.length,
    divergenceCount: readings.divergences.length,
    divergences: readings.divergences,
    // 生态读数进 fact.value：--no-llm 是零成本观测路径，它必须能看见这些
    // （否则"driver 停摆/同步在失败"只能靠烧 LLM 才看得到）。
    drivers: readings.drivers,
    syncHealth: readings.syncHealth,
    // 结算处置进读数：evidenceKept 非空 = 本轮真有 verdict 变化（有信息，待提交）；
    // 全 restored = 本轮只是刷新了时间戳（无信息）。这让「观测的副作用」自身可观测。
    evidenceRestored: settlement.restored.length,
    evidenceKept: settlement.kept,
    evidenceSkipped: settlement.skipped,
    focus,
  };

  // 摘要在机械半就算出来并输出：它是触发闸的输入，必须能被【不花 LLM 的一次调用】观测到
  // （否则"摘要在真实数据上是否稳定"这个最容易坏的性质只能靠烧 LLM 来验）。
  const digest = readingsDigest(readings);

  if (noLlm) {
    return {
      fact: { name: "meta-driver", value: { ...base, semantic: "mechanical-only", digest, readings: readings.criteria }, state: "verified", reason: `mechanical-only (${readings.divergences.length} divergences, digest ${digest})` },
    };
  }

  // 事件触发闸：读数没变且没到地板 ⇒ 不派语义半（同一输入重复派 LLM 是纯烧钱；实测两轮
  // 生产读数完全相同）。⛔ 「跳过」有独立取值，不与「判读过」同形（硬规则 3b）。
  const state = readState(root);
  const gate = shouldJudge({ digest, state, focus, now: Date.now(), floorMs: opts.judgeFloorMs ?? JUDGE_FLOOR_MS_DEFAULT });
  if (!gate.judge) {
    return {
      fact: { name: "meta-driver", value: { ...base, semantic: "skipped-unchanged", digest, skipReason: gate.reason }, state: "verified", reason: `semantic half skipped: ${gate.reason}` },
    };
  }

  let objective: string;
  try {
    objective = readProbeSpec("meta-driver", opts.pluginRoot ?? path.join(root, "plugin")).objective;
  } catch (e) {
    const reason = `probe spec unavailable: ${(e as Error).message}`;
    return {
      fact: { name: "meta-driver", value: { ...base, digest }, state: "not-evaluated", reason },
    };
  }

  const prompt = buildProbePrompt(objective, readings);
  const argv = opts.probeArgv ? opts.probeArgv(prompt) : launchArgv("meta-driver", prompt, root);
  // ⛔ 语义半不设有限超时：成本结构未实测前不设阈值（硬规则 4 推论一）。v0 是手工触发，
  //    外部 ctrl-c 是兜底；固化成常驻例程前必须先拿到实测耗时再定这个数。
  const r = await runAsync(argv, { timeoutMs: Infinity, collectStderr: true });
  if (r.error) {
    const reason = `probe spawn error: ${r.error.message}`;
    return { fact: { name: "meta-driver", value: { ...base, digest }, state: "not-evaluated", reason } };
  }
  const parsed = parseProbeOutput(r.stdout);
  if (!parsed) {
    const reason = `unparseable probe output (exit ${r.status})`;
    return { fact: { name: "meta-driver", value: { ...base, digest }, state: "failed", reason } };
  }

  const records = await listGoalRecords(root);
  const activeGoalIds = new Set(readings.goals.map((g) => g.id));
  const filed = await fileProposals(root, parsed.proposals, records, { k, activeGoalIds, dryRun });
  const acceptedIds = filed.filter((f) => f.accepted).map((f) => f.id);
  // 判读成功才推进状态：失败/解析不了的轮不写 state ⇒ 下一轮仍判为「该判读」，⛔ 不会因
  // 一次失败就把这批读数当成"已判过"而永久跳过。
  if (!dryRun) writeState(root, { digest, lastJudgedAt: new Date().toISOString() });

  const value = {
    ...base,
    interpretations: parsed.divergences.length,
    proposalsOffered: parsed.proposals.length,
    proposalsAccepted: acceptedIds.length,
    acceptedIds,
    humanAttention: parsed.humanAttention,
  };
  return {
    fact: { name: "meta-driver", value, state: "verified", reason: `${readings.divergences.length} divergences, ${acceptedIds.length}/${parsed.proposals.length} proposals filed as draft` },
  };
}

/** 追加一条轮记录（载体写失败不致命——⛔ 不因日志炸轮）。 */
export function appendRoundSafe(root: string, record: Record<string, unknown>): void {
  try {
    const file = path.join(root, ROUND_CARRIER_REL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  } catch { /* 载体写失败不致命 */ }
}

// ── 常驻形态（例程） ──────────────────────────────────────────────────────────────────────────────

/** 控制态文件（与 quality 分开——⛔ 共用会让一个 kind 的 halt 误停另一个）。 */
export const META_CONTROL_STATE_REL = path.join(".quay", "meta-control.json");

/** 本 driver 的例程集：**只此一条**。复用 quality-gate-driver 里那个【已经通用的】例程型常驻
 *  循环（收 RoutineSpec[]、评估 due、汇 Facts、写轮记录），⛔ 不再抄一份 95 行样板——
 *  SPEC §4 正是要消灭那种逐 kind 重复。 */
export function metaDriverRoutines(root: string, opts: {
  reviewIntervalMinutes: number;
  k: number;
  judgeFloorMs: number;
  focus?: string | null;
}): RoutineSpec[] {
  return [{
    name: "meta-review",
    schedule: { kind: "interval", minutes: opts.reviewIntervalMinutes },
    run: async () => {
      // 常驻轮永不 dry-run：提案要真落盘（落盘即 draft，构造上惰性）。
      const { fact } = await runMetaRound({
        root, focus: opts.focus ?? null, noLlm: false, k: opts.k, dryRun: false, judgeFloorMs: opts.judgeFloorMs,
      });
      return [fact];
    },
  }];
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

const HELP = [
  "meta-driver.ts — 机制演进的观测/提案例程（机械读数 + 语义判读 + draft 提案）",
  "",
  "Usage: node --experimental-strip-types plugin/scripts/meta-driver.ts [options]",
  "  --root <dir>      仓库根（缺省 cwd）",
  "  --once            跑一轮后退出（v0 唯一模式，缺省即是）",
  "  --no-llm          只跑机械半（读数 + divergence），不派语义 probe",
  "  --focus \"<text>\"  本轮的人给的方向（可选，进 prompt）",
  "  --k <N>           本轮提案上限（缺省 " + DEFAULT_RATE + "，routine-file-gate 的 rate 闸）",
  "  --dry-run         提案过闸但不写盘（也不推进变化检测状态）",
  "  --judge-floor <m> 语义半的定时器地板（分钟，缺省 1440=24h）——安全网非调优阈值：",
  "                    读数变了/给了 --focus 就会判读；地板只防「摘要恒不变 ⇒ 永不再判」",
  "  --json            输出 JSON（缺省人读摘要）",
  "",
  "常驻（例程型，复用通用循环）:",
  "  --resident            常驻跑；未给此旗标即一次性",
  "  --interval <ms>       循环滴答间隔（缺省 30000）",
  "  --review-interval <m> meta 复核的例程间隔（分钟，缺省 20）",
  "  --run-id <id> / --pid-file <p> / --max-rounds <n>",
  "",
  "Exit: 0 = 轮跑完（含 not-evaluated）; 1 = 轮失败; 2 = usage",
].join("\n");

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root = process.cwd();
  let focus: string | null = null;
  let noLlm = false;
  let dryRun = false;
  let json = false;
  let k = DEFAULT_RATE;
  let judgeFloorMs = JUDGE_FLOOR_MS_DEFAULT;
  let resident = false;
  let intervalMs = 30_000;
  let reviewIntervalMinutes = 20;
  let runId = `meta-${Date.now()}`;
  let pidFile: string | undefined;
  let maxRounds: number | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") { root = args[++i]; }
    else if (a === "--focus") { focus = args[++i] ?? null; }
    else if (a === "--k") { k = Number(args[++i]); }
    else if (a === "--judge-floor") { judgeFloorMs = Number(args[++i]) * 60_000; }
    else if (a === "--no-llm") { noLlm = true; }
    else if (a === "--dry-run") { dryRun = true; }
    else if (a === "--json") { json = true; }
    else if (a === "--once") { /* 一次性是缺省；保留旗标以便显式表达 */ }
    else if (a === "--resident") { resident = true; }
    else if (a === "--interval") { intervalMs = Number(args[++i]); }
    else if (a === "--review-interval") { reviewIntervalMinutes = Number(args[++i]); }
    else if (a === "--run-id") { runId = args[++i]; }
    else if (a === "--pid-file") { pidFile = args[++i]; }
    else if (a === "--max-rounds") { maxRounds = Number(args[++i]); }
    else if (a === "--help" || a === "-h") { process.stdout.write(HELP + "\n"); return 0; }
    else { process.stderr.write(`meta-driver: unknown argument: ${a}\n${HELP}\n`); return 2; }
  }
  if (!Number.isFinite(k) || k < 1) { process.stderr.write("meta-driver: --k must be a positive number\n"); return 2; }
  if (!Number.isFinite(judgeFloorMs) || judgeFloorMs < 0) { process.stderr.write("meta-driver: --judge-floor must be a non-negative number of minutes\n"); return 2; }

  if (resident) {
    // 常驻：复用通用例程型循环，配自己的控制面与载体（⛔ 不与 quality 共用控制面）。
    return await runResidentQualityGateLoop({
      root, intervalMs, once: false, maxRounds,
      roundLogFile: path.join(root, ROUND_CARRIER_REL),
      runId, json, pidFile,
      controlStateRel: META_CONTROL_STATE_REL,
      routines: metaDriverRoutines(root, { reviewIntervalMinutes, k, judgeFloorMs, focus }),
    });
  }

  const { fact } = await runMetaRound({ root, focus, noLlm, k, dryRun, judgeFloorMs });
  // ⛔ dry-run 也要留痕：「跑了一轮、什么都没提」正是最该被记录的情形——不记则「跑过」与
  // 「没跑过」在载体上同形，本例程的沉默就不可被检测（硬规则 9）。dryRun 进记录，不进条件。
  // 信封与常驻轮【完全相同】（computeRoundRecord），避免同一载体两套 schema。
  const record = {
    ...computeRoundRecord({ round: 0, runId, pid: process.pid, at: new Date().toISOString(), facts: [fact] }),
    dryRun,
  };
  appendRoundSafe(root, record);

  if (json) {
    // 输出【与载体逐字同一个对象】——⛔ 不另拼一份，否则 stdout 与载体会各说各话。
    process.stdout.write(JSON.stringify(record, null, 2) + "\n");
  } else {
    const v = (fact.value ?? {}) as Record<string, unknown>;
    process.stdout.write(`meta-driver [${fact.state}] ${fact.reason}\n`);
    if (Array.isArray(v.divergences)) {
      for (const d of v.divergences as Divergence[]) {
        process.stdout.write(`  divergence ${d.kind}: ${d.id} (status=${d.status}, verdict=${d.verdict})\n`);
      }
    }
    if (Array.isArray(v.acceptedIds) && (v.acceptedIds as string[]).length > 0) {
      process.stdout.write(`  filed as draft: ${(v.acceptedIds as string[]).join(", ")}\n`);
    }
    for (const h of (v.humanAttention as string[] | undefined) ?? []) {
      process.stdout.write(`  human-attention: ${h}\n`);
    }
  }
  return fact.state === "failed" ? 1 : 0;
}

// ⛔ argv1 必须留 undefined（让它读 process.argv[1]）：传本模块自身路径会使 basename 恒等于
// expectedBase ⇒ 恒为真 ⇒ 被 import 时就跑一整轮（实测：单测 import 即真调 goal-store 并派 LLM）。
if (isDirectEntry(import.meta, undefined, "meta-driver")) {
  main(process.argv).then((c) => { process.exitCode = c; });
}
