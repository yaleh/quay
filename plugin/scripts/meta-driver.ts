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
import { launchArgv, runAsync, ts, type Fact } from "./driver-runtime.ts";
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
  return { goals, criteria, divergences: computeDivergences(criteria), focus };
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
  /** 测试缝：注入语义半的 argv（缺省经 launchArgv 派 claude -p）。 */
  probeArgv?: (prompt: string) => string[];
  /** 测试缝：probe 规格目录（缺省 <root>/plugin）。 */
  pluginRoot?: string;
}

export interface MetaRoundResult {
  fact: Fact<Record<string, unknown>>;
  record: Record<string, unknown>;
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
    return {
      fact: { name: "meta-driver", value: null, state: "failed", reason },
      record: { ts: at, state: "failed", reason },
    };
  }

  const base = {
    goalCount: readings.goals.length,
    criterionCount: readings.criteria.length,
    divergenceCount: readings.divergences.length,
    divergences: readings.divergences,
    focus,
  };

  if (noLlm) {
    return {
      fact: { name: "meta-driver", value: { ...base, semantic: "skipped" }, state: "verified", reason: `mechanical-only (${readings.divergences.length} divergences)` },
      record: { ts: at, state: "mechanical-only", ...base, readings: readings.criteria },
    };
  }

  let objective: string;
  try {
    objective = readProbeSpec("meta-driver", opts.pluginRoot ?? path.join(root, "plugin")).objective;
  } catch (e) {
    const reason = `probe spec unavailable: ${(e as Error).message}`;
    return {
      fact: { name: "meta-driver", value: base, state: "not-evaluated", reason },
      record: { ts: at, state: "not-evaluated", reason, ...base },
    };
  }

  const prompt = buildProbePrompt(objective, readings);
  const argv = opts.probeArgv ? opts.probeArgv(prompt) : launchArgv("meta-driver", prompt, root);
  // ⛔ 语义半不设有限超时：成本结构未实测前不设阈值（硬规则 4 推论一）。v0 是手工触发，
  //    外部 ctrl-c 是兜底；固化成常驻例程前必须先拿到实测耗时再定这个数。
  const r = await runAsync(argv, { timeoutMs: Infinity, collectStderr: true });
  if (r.error) {
    const reason = `probe spawn error: ${r.error.message}`;
    return { fact: { name: "meta-driver", value: base, state: "not-evaluated", reason }, record: { ts: at, state: "not-evaluated", reason, ...base } };
  }
  const parsed = parseProbeOutput(r.stdout);
  if (!parsed) {
    const reason = `unparseable probe output (exit ${r.status})`;
    return { fact: { name: "meta-driver", value: base, state: "failed", reason }, record: { ts: at, state: "failed", reason, ...base } };
  }

  const records = await listGoalRecords(root);
  const activeGoalIds = new Set(readings.goals.map((g) => g.id));
  const filed = await fileProposals(root, parsed.proposals, records, { k, activeGoalIds, dryRun });
  const acceptedIds = filed.filter((f) => f.accepted).map((f) => f.id);

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
    record: { ts: at, state: "judged", ...value, filed, divergenceReadings: parsed.divergences, readings: readings.criteria },
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
  "  --dry-run         提案过闸但不写盘",
  "  --json            输出 JSON（缺省人读摘要）",
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

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--root") { root = args[++i]; }
    else if (a === "--focus") { focus = args[++i] ?? null; }
    else if (a === "--k") { k = Number(args[++i]); }
    else if (a === "--no-llm") { noLlm = true; }
    else if (a === "--dry-run") { dryRun = true; }
    else if (a === "--json") { json = true; }
    else if (a === "--once") { /* v0 唯一模式 */ }
    else if (a === "--help" || a === "-h") { process.stdout.write(HELP + "\n"); return 0; }
    else { process.stderr.write(`meta-driver: unknown argument: ${a}\n${HELP}\n`); return 2; }
  }
  if (!Number.isFinite(k) || k < 1) { process.stderr.write("meta-driver: --k must be a positive number\n"); return 2; }

  const { fact, record } = await runMetaRound({ root, focus, noLlm, k, dryRun });
  // ⛔ dry-run 也要留痕：「跑了一轮、什么都没提」正是最该被记录的情形——不记则「跑过」与
  // 「没跑过」在载体上同形，本例程的沉默就不可被检测（硬规则 9）。dryRun 进记录，不进条件。
  appendRoundSafe(root, { ...record, dryRun });

  if (json) {
    process.stdout.write(JSON.stringify({ fact, record }, null, 2) + "\n");
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
