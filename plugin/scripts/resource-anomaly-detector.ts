// resource-anomaly-detector.ts — the Quality-kind CONTINUOUS RESOURCE DIAGNOSTIC routine:
// mechanical collection + filtering FIRST (zero model calls), a model call ONLY on an evidenced
// NEW anomaly, routed through the EXISTING verifier/refuter + Portfolio/Experience + filing channel.
//
// WHY THIS EXISTS (task gap-quality-continuous-resource-diagnostic-routine-mechanical-filter-then-
// semantic). The unified execution record (`.quay/verification-round.jsonl` — per-file
// duration/outcome + completeness + OOM + leak readings, `.quay/measure-history.jsonl`, and the
// long-experiment records) already carries the signal for four anomaly classes; nothing watched it
// between full-suite runs. A file whose duration/outcome SHAPE changes at a commit boundary (the
// worked example: `quality-gate-driver-loop-watchdog.test.mjs`, 1.7-1.9s pass -> hang 4/4 times,
// exactly at `e18ec4b04`) is a MECHANICAL signal — a distribution shift keyed to a commit range —
// detectable with no model call at all. A model is only useful for the causal narrative, AFTER the
// mechanical pass has narrowed the suspect to one file and one commit range. Re-diagnosing the whole
// history every round is exactly what this module refuses to do.
//
// ⛔ WHAT IS REUSED, NOT REBUILT (the DoD's three prohibitions):
//   · identity/dedup — `conceptKeyOfCluster` (docs/analysis/discovery-experience-ledger.mjs), the
//     SAME stable key landed by gap-discovery-findings-lack-stable-identity-…; the SAME key shape
//     `[<concept_kind>|<sorted,normalized,deduped components>]`, derived from the record's own
//     subject, never a second key vocabulary.
//   · verifier/refuter — `runVerifier` (docs/analysis/arch-hypothesis-generation.mjs), the SAME
//     engine OSD's round calls twice (verify, then an independent fresh-context refute); this module
//     adds no confirmation mechanism, it feeds that one.
//   · filing + mechanism dedup — `gateFinding`/`findingKey` (plugin/scripts/routine-file-gate.ts)
//     and the ABI's `createTask` (plugin/scripts/meta-driver.ts). A duplicate mechanical signal is
//     NOT re-filed: the existing mechanism-dedup gate is the only thing that decides that.
//   · submit-once throttle — `readSubmittedKeys`/`appendSubmission` (plugin/scripts/
//     architecture-review-cluster.ts): the same conclusion-key ledger arch-review uses, so a
//     recurring anomaly is one PAYMENT across rounds, not N.
//   · 24h budget — the OSD/discovery-method ledger PATTERN, applied to this routine's own ledger.
//     ⛔ No ceiling anywhere is raised by this module.
//
// ⛔ STATIC-IMPORT DISCIPLINE (memory: shipped-script-must-not-statically-import-docs-analysis): the
// two engine modules live OUTSIDE the shipped plugin root (`docs/analysis/*.mjs`), so they are NEVER
// named in an import position — they are resolved from disk at RUNTIME and imported by file URL. A
// resolution failure is this round's own NAMED `failed`, never a silent zero (硬规则 3b).
//
// ⛔ MECHANICAL PASS COSTS ZERO MODEL CALLS, STRUCTURALLY: the mechanical half of a round reads the
// carriers and calls pure functions. The ONLY budget reservation in this file is inside
// `runSemanticPass`, which is reached only when `fresh.length > 0`. AC1's reading is therefore a
// MEASURED comparison of the budget ledger before and after a mechanical run — ⛔ not a constant
// returned by the code (硬规则 4: a structurally-unfalsifiable value is not a measurement).
//
// 取假（一条命令可验）：
//   ① 机械轮做了一次模型调用 ⇒ 假。`--rounds <fixture>` 前后读预算台账，`reservations_delta` 必须为 0。
//   ② 同一 anomaly 三轮回出现 ⇒ 三条 Finding ⇒ 假。identity 键把三轮折成一条（`distinct:1`）。
//   ③ 已被立案的同一机械信号再出现 ⇒ 重复立案 ⇒ 假。既有 `gateFinding` 的机制查重是唯一的裁决者。
//   ④ 一个没有 anomaly 的 fixture ⇒ 报出东西 ⇒ 假。负控：`anomalies:0` 且零 spawn。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import { isDirectEntry } from "./gate-script-base.ts";
import type { Fact, RoutineSpec, RoutineRunContext } from "./driver-runtime.ts";
import { gateFinding, DEFAULT_RATE, ROUTINE_TASK_PREFIX } from "./routine-file-gate.ts";
import { readSubmittedKeys, appendSubmission } from "./architecture-review-cluster.ts";

// ── identity / carrier / budget constants ────────────────────────────────────────────────────────
export const RESOURCE_DIAGNOSTIC_NAME = "resource-diagnostic";
/** Append-only carrier: one `kind:"anomaly"` line per NEW anomaly + one `kind:"scan-round"` per round. */
export const CARRIER_REL = path.posix.join(".quay", "resource-anomaly-findings.jsonl");
/** This routine's OWN 24h model-call ledger (the OSD/discovery-method pattern, no ceiling raised). */
export const BUDGET_LEDGER_REL = path.posix.join(".quay", "resource-diagnostic-model-budget.jsonl");
/** The unified execution record this routine reads (the fan-in/suite runner's own carrier). */
export const UNIFIED_RECORD_REL = path.posix.join(".quay", "verification-round.jsonl");
export const ANALYSIS_DIR_REL = "docs/analysis";
export const LEDGER_MODULE_FILE = "discovery-experience-ledger.mjs";
export const HYPOTHESIS_MODULE_FILE = "arch-hypothesis-generation.mjs";
export const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SUBMISSION_ROUTINE = RESOURCE_DIAGNOSTIC_NAME;

/** The five anomaly classes, each with a CONCRETE re-derivable signal (⛔ never a vibe). */
export const ANOMALY_CLASSES = Object.freeze([
  "watchdog-shape-shift", // a file's pass/duration shape changes at a specific commit boundary
  "long-tail-duration", // a file's wall time sits far outside its OWN historical distribution
  "oom-kill", // a round's telemetry reports an OOM kill
  "leaked-process", // a round reports processes that outlived the suite
  "repeat-expensive-experiment", // an expensive run re-ran from scratch while a checkpoint existed
] as const);
export type AnomalyClass = (typeof ANOMALY_CLASSES)[number];

// ── thresholds (all overridable for fixtures) ────────────────────────────────────────────────────
export const WATCHDOG_MIN_BEFORE = 2;
export const WATCHDOG_MIN_AFTER = 2;
export const WATCHDOG_SHAPE_FACTOR = 3;
export const WATCHDOG_SHAPE_ABS_MS = 5_000;
export const LONG_TAIL_FACTOR = 3;
export const LONG_TAIL_ABS_MS = 30_000;
export const LONG_TAIL_MIN_OBS = 4;
export const EXPENSIVE_MIN_MS = 300_000;
export const DEFAULT_MAX_MODEL_CALLS_PER_24H = 24;
export const DEFAULT_MAX_ANOMALIES_PER_ROUND = 3;
export const MIN_INTERVAL_MINUTES = 60;
export const DEFAULT_INTERVAL_MINUTES = 360;
export const ROUND_TIMEOUT_MS_DEFAULT = 1_800_000;

// ── input shapes (the unified execution record) ──────────────────────────────────────────────────
export interface PerFileObservation {
  file: string;
  durationMs: number;
  passed: boolean;
}

export interface LeakedProcess {
  pid?: number;
  ppid?: number;
  cmdline?: string;
  cwd?: string | null;
}

/** One round of the unified execution record. Every field is optional-and-typed: a carrier row that
 *  predates a field is "not carried", ⛔ never read as a zero (硬规则 3b/6). */
export interface UnifiedRound {
  round?: number;
  commit?: string | null;
  perFile?: PerFileObservation[];
  oomKill?: number | "unknown" | null;
  telemetry?: string | null;
  notEvaluated?: string | null;
  leakedProcesses?: LeakedProcess[];
}

/** One long-experiment record (the `repeat-expensive-experiment` class). */
export interface ExperimentRun {
  experimentId: string;
  durationMs: number;
  resumedFromCheckpoint: boolean;
  checkpointAvailable: boolean;
}

/** A mechanically-flagged anomaly. `concept_kind` + `components` are the identity inputs — the key
 *  is DERIVED from them by the existing ledger module, never carried in from here. */
export interface ResourceAnomaly {
  class: AnomalyClass;
  subject: string;
  concept_kind: string;
  components: string[];
  detail: string;
  evidence: Record<string, unknown>;
}

export interface DetectorOptions {
  watchdogMinBefore?: number;
  watchdogMinAfter?: number;
  watchdogShapeFactor?: number;
  watchdogShapeAbsMs?: number;
  longTailFactor?: number;
  longTailAbsMs?: number;
  longTailMinObs?: number;
  expensiveMinMs?: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export function median(xs: readonly number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const passRate = (xs: readonly PerFileObservation[]) => (xs.length === 0 ? null : xs.filter((o) => o.passed).length / xs.length);

// ── the mechanical detectors (pure: carrier in, anomalies out; ⛔ zero model calls) ───────────────
/** watchdog-class: group a file's observations by the round's commit, and flag the boundary where
 *  the outcome/duration shape changes. Two INDEPENDENT readings fire it (pass-rate flip 1.0→0.0, and
 *  a duration jump past `max(factor×before, before+abs)`); `which` records which one fired so a
 *  reader can tell them apart (硬规则 3: 枚举不布尔). */
export function detectWatchdogShifts(rounds: readonly UnifiedRound[], opts: DetectorOptions = {}): ResourceAnomaly[] {
  const minBefore = opts.watchdogMinBefore ?? WATCHDOG_MIN_BEFORE;
  const minAfter = opts.watchdogMinAfter ?? WATCHDOG_MIN_AFTER;
  const factor = opts.watchdogShapeFactor ?? WATCHDOG_SHAPE_FACTOR;
  const absMs = opts.watchdogShapeAbsMs ?? WATCHDOG_SHAPE_ABS_MS;

  const byFile = new Map<string, Array<{ commit: string | null; obs: PerFileObservation }>>();
  for (const r of rounds) {
    for (const o of arr<PerFileObservation>(r.perFile)) {
      if (typeof o?.file !== "string" || num(o.durationMs) === null) continue;
      if (!byFile.has(o.file)) byFile.set(o.file, []);
      byFile.get(o.file)!.push({ commit: typeof r.commit === "string" ? r.commit : null, obs: o });
    }
  }

  const out: ResourceAnomaly[] = [];
  for (const [file, seq] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Ordered distinct commit groups (by first appearance) — a boundary is a GROUP boundary, so N
    // rounds at one commit are one group, not N boundaries.
    const groups: Array<{ commit: string | null; obs: PerFileObservation[] }> = [];
    for (const { commit, obs } of seq) {
      const last = groups[groups.length - 1];
      if (last && last.commit === commit) last.obs.push(obs);
      else groups.push({ commit, obs: [obs] });
    }
    if (groups.length < 2) continue;
    for (let b = 1; b < groups.length; b++) {
      const before = groups.slice(0, b).flatMap((g) => g.obs);
      const after = groups.slice(b).flatMap((g) => g.obs);
      if (before.length < minBefore || after.length < minAfter) continue;
      const beforePass = passRate(before);
      const afterPass = passRate(after);
      const beforeMed = median(before.filter((o) => o.passed).map((o) => o.durationMs));
      const afterMed = median(after.map((o) => o.durationMs));
      const passFlip = beforePass === 1 && afterPass === 0;
      const durationJump =
        beforeMed !== null && beforeMed > 0 && afterMed !== null && afterMed >= Math.max(factor * beforeMed, beforeMed + absMs);
      if (!passFlip && !durationJump) continue;
      out.push({
        class: "watchdog-shape-shift",
        subject: file,
        concept_kind: "resource-watchdog-shape-shift",
        components: [file],
        detail: `${file}: shape changed at commit ${groups[b].commit ?? "<none>"} (${passFlip ? "pass->fail" : ""}${passFlip && durationJump ? "+" : ""}${durationJump ? "duration-jump" : ""})`,
        evidence: {
          file,
          commit_before: groups[b - 1].commit,
          commit_boundary: groups[b].commit,
          before: { n: before.length, passed: before.filter((o) => o.passed).length, medianMs: beforeMed },
          after: { n: after.length, passed: after.filter((o) => o.passed).length, medianMs: afterMed },
          which: [passFlip ? "pass-flip" : null, durationJump ? "duration-jump" : null].filter(Boolean),
          boundary_index: b,
        },
      });
      // ⛔ NO `break`: EVERY qualifying boundary is emitted, so a file whose shape shifted at three
      // successive commits yields THREE readings — and the identity fold is what turns them into ONE
      // Finding. Emitting only the first would hide the fold (AC2 would pass with the fold removed).
    }
  }
  return out;
}

/** long-tail-class: a file whose wall time sits far outside its OWN historical distribution. */
export function detectLongTail(rounds: readonly UnifiedRound[], opts: DetectorOptions = {}): ResourceAnomaly[] {
  const factor = opts.longTailFactor ?? LONG_TAIL_FACTOR;
  const absMs = opts.longTailAbsMs ?? LONG_TAIL_ABS_MS;
  const minObs = opts.longTailMinObs ?? LONG_TAIL_MIN_OBS;
  const byFile = new Map<string, PerFileObservation[]>();
  for (const r of rounds) for (const o of arr<PerFileObservation>(r.perFile)) {
    if (typeof o?.file !== "string" || num(o.durationMs) === null) continue;
    if (!byFile.has(o.file)) byFile.set(o.file, []);
    byFile.get(o.file)!.push(o);
  }
  const out: ResourceAnomaly[] = [];
  for (const [file, obs] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (obs.length < minObs) continue;
    const med = median(obs.map((o) => o.durationMs));
    if (med === null || med <= 0) continue;
    const bar = Math.max(factor * med, med + absMs);
    const worst = obs.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
    if (worst.durationMs < bar) continue;
    out.push({
      class: "long-tail-duration",
      subject: file,
      concept_kind: "resource-long-tail-duration",
      components: [file],
      detail: `${file}: ${worst.durationMs}ms vs its own median ${med}ms (bar ${bar}ms)`,
      evidence: { file, durationMs: worst.durationMs, medianMs: med, barMs: bar, observations: obs.length },
    });
  }
  return out;
}

/** telemetry-class: a round whose telemetry reports an OOM kill. `oomKill` is three-valued
 *  (`number | "unknown" | absent`) — only a POSITIVE reading fires; "unknown" never does (硬规则 3b). */
export function detectOomKills(rounds: readonly UnifiedRound[]): ResourceAnomaly[] {
  const out: ResourceAnomaly[] = [];
  for (const [i, r] of rounds.entries()) {
    const k = num(r.oomKill);
    const named = /oom[- ]?kill/i.test(String(r.notEvaluated ?? ""));
    if ((k === null || k <= 0) && !named) continue;
    out.push({
      class: "oom-kill",
      subject: "suite",
      concept_kind: "resource-oom-kill",
      components: ["suite"],
      detail: `round ${r.round ?? i + 1} (commit ${r.commit ?? "<none>"}): oomKill=${k ?? "named-in-notEvaluated"}`,
      evidence: { round: r.round ?? i + 1, commit: r.commit ?? null, oomKill: k, notEvaluated: r.notEvaluated ?? null },
    });
  }
  return out;
}

/** lifecycle-class: a round that reports processes which outlived the suite. */
export function detectLeakedProcesses(rounds: readonly UnifiedRound[]): ResourceAnomaly[] {
  const out: ResourceAnomaly[] = [];
  for (const [i, r] of rounds.entries()) {
    const leaked = arr<LeakedProcess>(r.leakedProcesses);
    if (leaked.length === 0) continue;
    out.push({
      class: "leaked-process",
      subject: "suite",
      concept_kind: "resource-leaked-process",
      components: ["suite"],
      detail: `round ${r.round ?? i + 1} (commit ${r.commit ?? "<none>"}): ${leaked.length} leaked process(es)`,
      evidence: {
        round: r.round ?? i + 1,
        commit: r.commit ?? null,
        leaked: leaked.slice(0, 8).map((p) => ({ pid: p.pid ?? null, cmdline: String(p.cmdline ?? "").slice(0, 120) })),
        count: leaked.length,
      },
    });
  }
  return out;
}

/** repeat-expensive-class: an expensive experiment re-run from scratch while a checkpoint existed. */
export function detectRepeatExpensive(runs: readonly ExperimentRun[], opts: DetectorOptions = {}): ResourceAnomaly[] {
  const minMs = opts.expensiveMinMs ?? EXPENSIVE_MIN_MS;
  const out: ResourceAnomaly[] = [];
  for (const r of runs) {
    if (typeof r?.experimentId !== "string") continue;
    if (r.checkpointAvailable !== true || r.resumedFromCheckpoint === true) continue;
    if ((num(r.durationMs) ?? 0) < minMs) continue;
    out.push({
      class: "repeat-expensive-experiment",
      subject: r.experimentId,
      concept_kind: "resource-repeat-expensive-experiment",
      components: [r.experimentId],
      detail: `${r.experimentId}: re-ran ${r.durationMs}ms from scratch although a checkpoint existed`,
      evidence: { experimentId: r.experimentId, durationMs: r.durationMs, resumedFromCheckpoint: false, checkpointAvailable: true },
    });
  }
  return out;
}

/** ALL classes, one mechanical pass. PURE. ⛔ makes no model call and reads no ledger. */
export function detectResourceAnomalies(
  input: { rounds?: readonly UnifiedRound[]; experiments?: readonly ExperimentRun[] },
  opts: DetectorOptions = {},
): ResourceAnomaly[] {
  const rounds = input.rounds ?? [];
  return [
    ...detectWatchdogShifts(rounds, opts),
    ...detectLongTail(rounds, opts),
    ...detectOomKills(rounds),
    ...detectLeakedProcesses(rounds),
    ...detectRepeatExpensive(input.experiments ?? [], opts),
  ];
}

// ── identity: the EXISTING stable key, resolved from disk at runtime ──────────────────────────────
export interface ConceptKeyFn {
  (rec: { concept_kind?: unknown; components?: unknown }): string | null;
}

export interface ConceptKeyResolution {
  conceptKeyOf: ConceptKeyFn | null;
  modulePath: string | null;
  error: string | null;
}

/** Resolve `conceptKeyOfCluster` from the landed ledger module at RUNTIME (⛔ never a static import:
 *  `docs/analysis/*.mjs` is outside the shipped plugin root — see the header). A resolution failure
 *  is a NAMED error, so "the key could not be computed" never reads as "no anomaly" (硬规则 3b). */
export async function resolveConceptKeyOf(root: string, opts: { modulePath?: string } = {}): Promise<ConceptKeyResolution> {
  const candidates = opts.modulePath
    ? [opts.modulePath]
    : [path.join(root, ANALYSIS_DIR_REL, LEDGER_MODULE_FILE), path.join(SCRIPT_REPO_ROOT, ANALYSIS_DIR_REL, LEDGER_MODULE_FILE)];
  const tried: string[] = [];
  for (const p of candidates) {
    tried.push(p);
    if (!fs.existsSync(p)) continue;
    try {
      const mod = await import(/* @vite-ignore */ pathToFileURL(p).href);
      if (typeof mod?.conceptKeyOfCluster === "function") return { conceptKeyOf: mod.conceptKeyOfCluster as ConceptKeyFn, modulePath: p, error: null };
      return { conceptKeyOf: null, modulePath: p, error: `${p} exports no conceptKeyOfCluster function` };
    } catch (e) {
      return { conceptKeyOf: null, modulePath: p, error: `cannot load ${p}: ${(e as Error).message}` };
    }
  }
  return { conceptKeyOf: null, modulePath: null, error: `${LEDGER_MODULE_FILE} not found (tried ${tried.join(", ")})` };
}

/** The anomaly's identity, DERIVED by the existing key function from its own `concept_kind` +
 *  `components` — ⛔ never carried in, never a second vocabulary. `null` when the key cannot be
 *  computed (the round reports it; it is never silently given a fresh key). */
export function anomalyConceptKey(a: ResourceAnomaly, conceptKeyOf: ConceptKeyFn | null): string | null {
  if (typeof conceptKeyOf !== "function") return null;
  return conceptKeyOf({ concept_kind: a.concept_kind, components: a.components }) ?? null;
}

/** Fold anomalies into (fresh, repeated) against the carrier's own earlier anomaly records — the
 *  AC2 property: the same anomaly across N rounds is ONE Finding, not N. Records that predate
 *  `concept_key` are keyed by DERIVING from their own fields (the fold is why nothing is rewritten). */
export function foldAnomalies(
  anomalies: readonly ResourceAnomaly[],
  priorRecords: readonly Record<string, unknown>[],
  conceptKeyOf: ConceptKeyFn | null,
): { fresh: ResourceAnomaly[]; repeated: ResourceAnomaly[]; keyed: Array<{ anomaly: ResourceAnomaly; concept_key: string | null }>; unkeyable: number } {
  const seen = new Set<string>();
  for (const rec of priorRecords) {
    if (rec?.kind !== "anomaly") continue;
    const k = typeof rec.concept_key === "string" && rec.concept_key ? rec.concept_key : anomalyConceptKey(rec as unknown as ResourceAnomaly, conceptKeyOf);
    if (k) seen.add(k);
  }
  const fresh: ResourceAnomaly[] = [];
  const repeated: ResourceAnomaly[] = [];
  const keyed: Array<{ anomaly: ResourceAnomaly; concept_key: string | null }> = [];
  let unkeyable = 0;
  for (const a of anomalies) {
    const k = anomalyConceptKey(a, conceptKeyOf);
    if (k === null) unkeyable++;
    keyed.push({ anomaly: a, concept_key: k });
    if (k !== null && seen.has(k)) { repeated.push(a); continue; }
    if (k !== null) seen.add(k); // same key twice inside ONE pass ⇒ one Finding (AC2, in-pass half)
    fresh.push(a);
  }
  return { fresh, repeated, keyed, unkeyable };
}

// ── carrier IO (append-only; ⛔ never truncated) ─────────────────────────────────────────────────
export function readCarrierRecords(carrierPath: string): { missing: boolean; records: Record<string, unknown>[] } {
  if (!fs.existsSync(carrierPath)) return { missing: true, records: [] };
  const records: Record<string, unknown>[] = [];
  for (const line of fs.readFileSync(carrierPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* 坏行跳过：至多丢一个已见键 ⇒ 多报一次，方向安全 */ }
  }
  return { missing: false, records };
}

export function appendCarrierRecords(carrierPath: string, records: readonly Record<string, unknown>[]): number {
  if (records.length === 0) return 0;
  fs.mkdirSync(path.dirname(carrierPath), { recursive: true });
  fs.appendFileSync(carrierPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return records.length;
}

// ── the 24h model-call ledger (the OSD/discovery-method pattern; ⛔ no ceiling raised) ────────────
export interface BudgetLedger { reserve: (step: string, meta?: Record<string, unknown>) => boolean; used: number }

export function countReservations(ledgerPath: string, nowMs = Date.now(), windowMs = 24 * 60 * 60 * 1000): number {
  if (!fs.existsSync(ledgerPath)) return 0;
  let n = 0;
  for (const line of fs.readFileSync(ledgerPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r?.kind !== "reserve") continue;
      const ts = Date.parse(String(r.ts ?? ""));
      if (Number.isFinite(ts) && nowMs - ts < windowMs) n++;
    } catch { /* 坏行跳过 */ }
  }
  return n;
}

export function openResourceBudget(opts: { ledgerPath: string; cap: number; now?: () => number }): BudgetLedger {
  const now = opts.now ?? Date.now;
  let used = countReservations(opts.ledgerPath, now());
  return {
    get used() { return used; },
    reserve(step, meta = {}) {
      if (used >= opts.cap) return false;
      fs.mkdirSync(path.dirname(opts.ledgerPath), { recursive: true });
      fs.appendFileSync(opts.ledgerPath, JSON.stringify({ kind: "reserve", ts: new Date(now()).toISOString(), pid: process.pid, step, ...meta }) + "\n", "utf8");
      used++;
      return true;
    },
  };
}

// ── the semantic half: verify → refute → file (ALL of it the existing machinery) ──────────────────
export interface AnomalySeed {
  concept_key: string | null;
  concept_kind: string;
  components: string[];
  claim: string;
  evidence_needed: string;
  counterexample_requirement: string;
}

/** The mechanically-flagged anomaly as a VERIFIER SEED, in the shape the existing engine's
 *  `clustersFromAnomalySeeds` (docs/analysis/arch-hypothesis-generation.mjs) consumes. */
export function anomalyToSeed(a: ResourceAnomaly, conceptKeyOf: ConceptKeyFn | null): AnomalySeed {
  return {
    concept_key: anomalyConceptKey(a, conceptKeyOf),
    concept_kind: a.concept_kind,
    components: a.components,
    claim: a.detail,
    evidence_needed: "the per-file/per-round readings named on the finding (duration, outcome, commit boundary, leaked pids, oomKill)",
    counterexample_requirement: "a reading of the SAME carriers in which this file's/round's shape does not differ from its own history",
  };
}

export interface PipelineDeps {
  /** The EXISTING verifier engine call (arch-hypothesis-generation `runVerifier`). */
  verify: (clusters: unknown[], opts: { promptTemplate: string; runModel: unknown }) => Promise<unknown>;
  /** The EXISTING refuter = the same engine, an INDEPENDENT fresh context, refutation template. */
  refute: (clusters: unknown[], opts: { promptTemplate: string; runModel: unknown }) => Promise<unknown>;
  /** The EXISTING anomaly→cluster adapter (arch-hypothesis-generation `clustersFromAnomalySeeds`). */
  clustersFromAnomalySeeds: (seeds: readonly AnomalySeed[]) => unknown[];
  /** The EXISTING refutation prompt builder (open-semantic-discovery-routine `refutationPromptFor`). */
  refutationPromptFor: (evidence: unknown) => string;
  /** The EXISTING frozen verifier prompt text. */
  verifierPrompt: string;
  /** The EXISTING task-board key reader (the mechanism-dedup space). */
  existingKeys: string[];
  /** The EXISTING ABI task creator (meta-driver `createTask`). */
  createTask: (root: string, id: string, title: string, labels: string[], body: string) => Promise<unknown>;
  recentCount?: number;
  K?: number;
}

/** Read the verdict out of whatever the injected verifier returned. `null` = UNREADABLE, its own
 *  value: a verifier whose answer cannot be parsed did NOT confirm anything (硬规则 3b). */
function readVerdict(r: unknown): { verdict: string | null; reason: string | null } {
  const rows = arr<Record<string, unknown>>((r as Record<string, unknown> | null)?.results);
  const first = rows[0];
  if (!first || typeof first.verdict !== "string") return { verdict: null, reason: null };
  return { verdict: first.verdict, reason: typeof first.verdict_reason === "string" ? first.verdict_reason : null };
}

export function anomalyTaskId(a: ResourceAnomaly, conceptKeyOf: ConceptKeyFn | null): string {
  const k = anomalyConceptKey(a, conceptKeyOf) ?? `${a.concept_kind}|${a.subject}`;
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  const slug = a.concept_kind.replace(/^resource-/, "").replace(/[^a-z0-9-]/g, "-");
  return `${ROUTINE_TASK_PREFIX}resource-${slug}-${h.toString(16).padStart(8, "0")}`;
}

/** The candidate task body. It carries `## Finding` with a `symbols:`-shaped line so the EXISTING
 *  `findingKey` (and therefore the EXISTING mechanism dedup) keys it identically to a board task —
 *  ⛔ this module invents no second dedup key. */
export function renderAnomalyTaskBody(a: ResourceAnomaly, round: number): string {
  return [
    `## Finding`,
    `The unified execution record shows a \`${a.class}\` anomaly in round ${round}: ${a.detail}`,
    ``,
    `reproduction: read the carrier round(s) named in the evidence and re-run the mechanical pass;`,
    `\`node --experimental-strip-types plugin/scripts/resource-anomaly-detector.ts --rounds <carrier.jsonl> --json\` reports it.`,
    `evidence: \`${JSON.stringify(a.evidence).slice(0, 400)}\``,
    ``,
    `- 观测符号：\`${a.concept_kind}\`、\`${a.subject}\``,
    ``,
    `## Proposal`,
    `Close the anomaly at its source, then let the post-merge effect re-test (same metric, same method)`,
    `compare the shape against the pre-anomaly baseline.`,
  ].join("\n");
}

export interface RouteReading {
  concept_key: string | null;
  verified: string | null;
  refuted: string | null;
  confirmed: boolean;
  filed: boolean;
  gate_reason: string;
  task_id: string | null;
}

/** Route ONE new anomaly through the EXISTING verifier → refuter → (on confirmation) the EXISTING
 *  filing channel with the EXISTING mechanism dedup active. ⛔ Nothing here is a second confirmation
 *  mechanism: both passes are the injected engine's `runVerifier`, and the filing decision is
 *  `gateFinding`'s. */
export async function routeAnomaly(
  root: string,
  a: ResourceAnomaly,
  round: number,
  deps: PipelineDeps,
  conceptKeyOf: ConceptKeyFn | null,
): Promise<RouteReading> {
  const key = anomalyConceptKey(a, conceptKeyOf);
  const base: RouteReading = { concept_key: key, verified: null, refuted: null, confirmed: false, filed: false, gate_reason: "", task_id: null };
  const clusters = deps.clustersFromAnomalySeeds([anomalyToSeed(a, conceptKeyOf)]);
  const v = readVerdict(await deps.verify(clusters, { promptTemplate: deps.verifierPrompt, runModel: null }));
  base.verified = v.verdict;
  if (v.verdict !== "supported") {
    base.gate_reason = `verifier did not support (${v.verdict ?? "not-evaluated:unreadable-verdict"})`;
    return base;
  }
  const ref = readVerdict(await deps.refute(clusters, { promptTemplate: deps.refutationPromptFor(a.evidence), runModel: null }));
  base.refuted = ref.verdict;
  if (ref.verdict !== "supported") {
    base.gate_reason = `refuter did not let it through (${ref.verdict ?? "not-evaluated:unreadable-verdict"})`;
    return base;
  }
  base.confirmed = true;
  const body = renderAnomalyTaskBody(a, round);
  const gate = gateFinding(body, { existingKeys: deps.existingKeys, recentCount: deps.recentCount ?? 0, K: deps.K ?? DEFAULT_RATE });
  base.gate_reason = gate.reason;
  if (!gate.accept) return base;
  const id = anomalyTaskId(a, conceptKeyOf);
  await deps.createTask(root, id, `resource anomaly: ${a.detail}`.slice(0, 120), ["gap", "architecture-discovery"], body);
  base.filed = true;
  base.task_id = id;
  return base;
}

// ── the AC4 post-merge effect re-test: the SAME metric, the SAME method, before vs after ──────────
export interface EffectReading {
  metric: string;
  method: string;
  baseline: { n: number; medianMs: number | null };
  anomalous: { n: number; medianMs: number | null };
  after: { n: number; medianMs: number | null };
  ratio_after_vs_baseline: number | null;
  verdict: "restored" | "still-anomalous" | "not-evaluated";
  reason: string;
}

/** Direct re-measurement (⛔ NOT the fix task's own AC): compare the post-fix distribution against
 *  the PRE-anomaly baseline, both measured the same way, with the anomalous window as the control. */
export function effectRetest(input: {
  metric: string;
  method: string;
  baseline: readonly number[];
  anomalous: readonly number[];
  after: readonly number[];
  restoreTolerance?: number;
}): EffectReading {
  const tol = input.restoreTolerance ?? 1.5;
  const b = median(input.baseline);
  const a1 = median(input.anomalous);
  const a2 = median(input.after);
  const base: Omit<EffectReading, "verdict" | "reason" | "ratio_after_vs_baseline"> = {
    metric: input.metric,
    method: input.method,
    baseline: { n: input.baseline.length, medianMs: b },
    anomalous: { n: input.anomalous.length, medianMs: a1 },
    after: { n: input.after.length, medianMs: a2 },
  };
  const ratio = b !== null && b > 0 && a2 !== null ? a2 / b : null;
  if (b === null || b <= 0 || a1 === null || a2 === null || input.after.length === 0 || input.anomalous.length === 0) {
    return { ...base, ratio_after_vs_baseline: ratio, verdict: "not-evaluated", reason: "insufficient samples on one of the three windows — ⛔ not read as restored" };
  }
  if (a1 < 2 * b) {
    return { ...base, ratio_after_vs_baseline: ratio, verdict: "not-evaluated", reason: `the 'anomalous' window (median ${a1}ms) is not ≥2× the baseline (${b}ms) — this is not the anomaly the re-test claims to have fixed` };
  }
  if (ratio !== null && ratio <= tol) {
    return { ...base, ratio_after_vs_baseline: ratio, verdict: "restored", reason: `after median ${a2}ms is ${ratio.toFixed(2)}× the pre-anomaly baseline ${b}ms (tolerance ${tol}×) — the shape returned` };
  }
  return { ...base, ratio_after_vs_baseline: ratio, verdict: "still-anomalous", reason: `after median ${a2}ms is ${ratio === null ? "?" : ratio.toFixed(2)}× the pre-anomaly baseline ${b}ms (tolerance ${tol}×) — not restored` };
}

// ── the round ────────────────────────────────────────────────────────────────────────────────────
export interface ResourceDiagnosticConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxModelCallsPer24h: number;
  maxAnomaliesPerRound: number;
}
export interface ResourceDiagnosticConfigRead {
  present: boolean;
  config: ResourceDiagnosticConfig | null;
  error: string | null;
}

const cfgbad = (m: string) => `loop.resource_diagnostic ${m}`;

/** Parse `loop.resource_diagnostic:`. `enabled` is REQUIRED and boolean (a declared section without
 *  a kill switch is a section nobody can turn off); an enabled section requires a valid
 *  `interval:<N>m` at or above the floor, and the two caps. A bad section is fail-closed. */
export function parseResourceDiagnosticSection(raw: unknown): { config: ResourceDiagnosticConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgbad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") return { config: null, error: cfgbad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  if (rec.enabled === false) return { config: { enabled: false, intervalMinutes: MIN_INTERVAL_MINUTES, maxModelCallsPer24h: 0, maxAnomaliesPerRound: 0 }, error: null };
  if (typeof rec.interval !== "string") return { config: null, error: cfgbad(`needs an 'interval' string of the form interval:<N>m (got ${rec.interval === undefined ? "missing" : JSON.stringify(rec.interval)})`) };
  const m = /^interval:(\d+)m$/.exec(rec.interval);
  if (!m) return { config: null, error: cfgbad(`interval must match interval:<N>m (got ${JSON.stringify(rec.interval)})`) };
  const minutes = Number(m[1]);
  if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES) return { config: null, error: cfgbad(`interval ${minutes}m is below the ${MIN_INTERVAL_MINUTES}m floor`) };
  const cap = rec.max_model_calls_per_24h;
  if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 0) return { config: null, error: cfgbad(`needs a non-negative integer 'max_model_calls_per_24h' (got ${cap === undefined ? "missing" : JSON.stringify(cap)})`) };
  const perRound = rec.max_anomalies_per_round;
  if (typeof perRound !== "number" || !Number.isInteger(perRound) || perRound < 1) return { config: null, error: cfgbad(`needs a positive integer 'max_anomalies_per_round' (got ${perRound === undefined ? "missing" : JSON.stringify(perRound)})`) };
  return { config: { enabled: true, intervalMinutes: minutes, maxModelCallsPer24h: cap, maxAnomaliesPerRound: perRound }, error: null };
}

export function readResourceDiagnosticConfig(root: string): ResourceDiagnosticConfigRead {
  const p = path.join(root, ".quay", "config.yml");
  if (!fs.existsSync(p)) return { present: false, config: null, error: null };
  let parsed: unknown;
  try {
    parsed = parseYaml(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return { present: true, config: null, error: `FAIL-CLOSED: .quay/config.yml is malformed YAML — ${(e as Error).message}` };
  }
  const loop = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).loop : undefined;
  if (loop === undefined || loop === null) return { present: false, config: null, error: null };
  if (typeof loop !== "object" || Array.isArray(loop)) return { present: true, config: null, error: "FAIL-CLOSED: .quay/config.yml 'loop:' must be a mapping" };
  const raw = (loop as Record<string, unknown>).resource_diagnostic;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseResourceDiagnosticSection(raw);
  return { present: true, config, error };
}

export interface ResourceDiagnosticRunOptions {
  config: ResourceDiagnosticConfig | null;
  configPresent: boolean;
  configError?: string | null;
  halted: boolean;
  /** Test seam: the unified record rows (default: read UNIFIED_RECORD_REL). */
  rounds?: readonly UnifiedRound[];
  /** Test seam: experiment run rows. */
  experiments?: readonly ExperimentRun[];
  /** Test seam: the semantic pipeline (absent ⇒ the round stops at the mechanical half). */
  pipeline?: PipelineDeps | null;
  conceptKeyOf?: ConceptKeyFn | null;
  carrierPath?: string;
  ledgerPath?: string;
  round?: number;
  now?: () => number;
  detectorOptions?: DetectorOptions;
}

/** One whole round: mechanical pass (ZERO model calls) → identity fold against the carrier →
 *  append the new anomalies + one scan-round line → ONLY IF there are new anomalies, and only past
 *  halt/resource/budget gates, the semantic pass over AT MOST `max_anomalies_per_round` of them. */
export async function runResourceDiagnostic(root: string, opts: ResourceDiagnosticRunOptions): Promise<Fact> {
  const now = opts.now ?? Date.now;
  const carrier = opts.carrierPath ?? path.join(root, CARRIER_REL);
  const ledger = opts.ledgerPath ?? path.join(root, BUDGET_LEDGER_REL);
  const round = opts.round ?? 0;
  const base = { routine: RESOURCE_DIAGNOSTIC_NAME, carrier: path.relative(root, carrier) || carrier, fired: false };
  const fact = (state: Fact["state"], value: Record<string, unknown>, reason: string): Fact => ({ name: RESOURCE_DIAGNOSTIC_NAME, value, state, reason });

  if (opts.configError) return fact("failed", base, `config invalid — ${opts.configError} (nothing run)`);
  if (!opts.configPresent || !opts.config || opts.config.enabled === false) {
    return fact("not-evaluated", { ...base, enabled: false }, "disabled: loop.resource_diagnostic section absent or enabled:false — nothing run");
  }
  const config = opts.config;

  // ── the MECHANICAL half: ⛔ no model call, no ledger reservation, no halt gate (observation is
  //    never gated — the same rule the sibling routines follow).
  let ck: ConceptKeyFn | null = opts.conceptKeyOf ?? null;
  let keyError: string | null = null;
  if (ck === null) {
    const res = await resolveConceptKeyOf(root);
    ck = res.conceptKeyOf;
    keyError = res.error;
  }
  const rounds = opts.rounds ?? readUnifiedRounds(path.join(root, UNIFIED_RECORD_REL));
  const experiments = opts.experiments ?? [];
  const anomalies = detectResourceAnomalies({ rounds, experiments }, opts.detectorOptions ?? {});

  let prior: { missing: boolean; records: Record<string, unknown>[] };
  try { prior = readCarrierRecords(carrier); } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable carrier — ${(e as Error).message} (nothing appended)`);
  }
  const fold = foldAnomalies(anomalies, prior.records, ck);

  // ⛔ Only NEW anomalies become `kind:"anomaly"` lines — a recurrence is recorded on the scan-round
  // line (its own `repeated` count), never as a duplicate finding line. Same shape as arch-discovery.
  const appended: Record<string, unknown>[] = fold.fresh.map((anomaly) => ({
    kind: "anomaly",
    routine: RESOURCE_DIAGNOSTIC_NAME,
    class: anomaly.class,
    subject: anomaly.subject,
    concept_kind: anomaly.concept_kind,
    components: anomaly.components,
    concept_key: anomalyConceptKey(anomaly, ck),
    detail: anomaly.detail,
    evidence: anomaly.evidence,
    round,
    at: new Date(now()).toISOString(),
  }));
  const mechanical = {
    ...base,
    fired: fold.fresh.length > 0,
    roundsRead: rounds.length,
    anomalies: anomalies.length,
    /** DISTINCT identity keys among the readings — ⛔ not the number of keyed readings (a file whose
     *  shape shifted at three commits is three readings and ONE key, which is the whole point of AC2). */
    distinct: new Set(fold.keyed.map((k) => k.concept_key).filter((k) => k !== null)).size,
    fresh: fold.fresh.length,
    repeated: fold.repeated.length,
    unkeyable: fold.unkeyable,
    conceptKeyError: keyError,
  };

  const scanRound = (extra: Record<string, unknown> = {}) => ({
    kind: "scan-round", routine: RESOURCE_DIAGNOSTIC_NAME, round, at: new Date(now()).toISOString(),
    anomalies: anomalies.length, fresh: fold.fresh.length, repeated: fold.repeated.length, ...extra,
  });

  // ② halt gates the SPAWN, not the routine track.
  if (opts.halted) {
    appendCarrierRecords(carrier, [...appended, scanRound({ spawns: 0, note: "halted — semantic pass suppressed" })]);
    return fact("not-evaluated", { ...mechanical, submittedKeys: [] }, "halted: semantic pass suppressed (mechanical readings appended) — nothing spawned");
  }
  // ③ no new anomaly ⇒ zero spawn, and the scan-round line says WHY (門态可观测).
  if (fold.fresh.length === 0) {
    appendCarrierRecords(carrier, [...appended, scanRound({ spawns: 0, note: "no new mechanically-flagged anomaly — zero model calls" })]);
    return fact("verified", { ...mechanical, submittedKeys: [] }, `mechanical pass: ${anomalies.length} anomaly reading(s), 0 new — zero model calls`);
  }
  if (ck === null) {
    // ⛔ The anomalies could not be keyed: they are NOT appended as findings (an unkeyed finding line
    // would be re-folded as a NEW finding every round — the exact noise this routine exists to stop),
    // and the round is a NAMED failure. 硬规则 3b: cannot-key ≠ no-anomaly.
    appendCarrierRecords(carrier, [scanRound({ spawns: 0, note: "identity key unavailable — findings withheld" })]);
    return fact("failed", { ...mechanical, submittedKeys: [] }, `identity key unavailable — ${keyError ?? "unknown"} (nothing appended as a finding; nothing spawned — 硬规则 3b: cannot-key ≠ no-anomaly)`);
  }
  if (!opts.pipeline) {
    appendCarrierRecords(carrier, [...appended, scanRound({ spawns: 0, note: "no semantic pipeline wired — zero model calls" })]);
    return fact("not-evaluated", { ...mechanical, submittedKeys: [] }, "no semantic pipeline wired — mechanical anomalies appended, zero model calls");
  }

  // ── submit-once throttle (the EXISTING ledger): a recurring anomaly is one payment, not N.
  const submitted = readSubmittedKeys(root);
  const toSend = fold.fresh.filter((a) => {
    const k = anomalyConceptKey(a, ck);
    return k !== null && !submitted.has(`${SUBMISSION_ROUTINE}:${k}`);
  }).slice(0, config.maxAnomaliesPerRound);
  const budget = openResourceBudget({ ledgerPath: ledger, cap: config.maxModelCallsPer24h, now });
  const routes: RouteReading[] = [];
  let refused: string | null = null;
  for (const a of toSend) {
    const k = anomalyConceptKey(a, ck);
    if (!budget.reserve("verify", { concept_key: k })) { refused = `budget-24h: ${budget.used} ≥ cap ${config.maxModelCallsPer24h}`; break; }
    const r = await routeAnomaly(root, a, round, opts.pipeline, ck);
    routes.push(r);
    if (r.confirmed) budget.reserve("refute", { concept_key: k });
    if (budget.used >= config.maxModelCallsPer24h) break;
    if (r.confirmed && k !== null) appendSubmission(root, { key: `${SUBMISSION_ROUTINE}:${k}`, clusterId: k, verdict: "confirmed", submittedAt: new Date(now()).toISOString(), round });
    else if (!r.confirmed && k !== null) appendSubmission(root, { key: `${SUBMISSION_ROUTINE}:${k}`, clusterId: k, verdict: String(r.verified ?? "unreadable"), submittedAt: new Date(now()).toISOString(), round });
  }
  appendCarrierRecords(carrier, [
    ...appended,
    scanRound({ spawns: routes.length, confirmed: routes.filter((r) => r.confirmed).length, filed: routes.filter((r) => r.filed).length, budgetUsed: budget.used }),
  ]);
  const value = { ...mechanical, submittedKeys: routes.map((r) => r.concept_key), routes, budgetUsed: budget.used, refused };
  return fact("verified", value, `mechanical pass: ${anomalies.length} reading(s), ${fold.fresh.length} new; semantic: ${routes.length} routed, ${routes.filter((r) => r.confirmed).length} confirmed, ${routes.filter((r) => r.filed).length} filed (dedup: ${routes.filter((r) => r.confirmed && !r.filed).length} suppressed)${refused ? ` — ${refused}` : ""}`);
}

/** Read the unified execution record. An unreadable/missing carrier is its OWN state (⛔ never an
 *  empty round list silently read as "nothing happened"). */
export function readUnifiedRounds(recordPath: string): UnifiedRound[] {
  if (!fs.existsSync(recordPath)) return [];
  const out: UnifiedRound[] = [];
  for (const line of fs.readFileSync(recordPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as UnifiedRound); } catch { /* 坏行跳过 */ }
  }
  return out;
}

export function readExperimentRuns(p: string): ExperimentRun[] {
  if (!fs.existsSync(p)) return [];
  const out: ExperimentRun[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as ExperimentRun); } catch { /* 坏行跳过 */ }
  }
  return out;
}

// ── RoutineSpec factories (the declarative track, same as arch-discovery) ─────────────────────────
export interface ResourceDiagnosticRoutineOptions extends Omit<ResourceDiagnosticRunOptions, "config" | "configPresent" | "configError" | "halted"> {}

export function buildResourceDiagnosticRoutine(root: string, read: ResourceDiagnosticConfigRead, opts: ResourceDiagnosticRoutineOptions = {}): RoutineSpec {
  const schedule = read.config ? { kind: "interval" as const, minutes: read.config.intervalMinutes } : { kind: "interval" as const, minutes: DEFAULT_INTERVAL_MINUTES };
  return {
    name: RESOURCE_DIAGNOSTIC_NAME,
    schedule,
    run: async (ctx?: RoutineRunContext) => [
      await runResourceDiagnostic(root, { ...opts, config: read.config, configPresent: read.present, configError: read.error, halted: ctx?.halted === true }),
    ],
  };
}

/** Production entry: read `loop.resource_diagnostic:` and build the routine. NEVER throws — an
 *  undeclared section yields `routine:null` (the host's routine set is unchanged), while a DECLARED
 *  section is always observable (disabled ⇒ `not-evaluated:disabled`, malformed ⇒ `failed`). */
export function resourceDiagnosticRoutineFromConfig(root: string, opts: ResourceDiagnosticRoutineOptions = {}): { routine: RoutineSpec | null; error: string | null; present: boolean; enabled: boolean } {
  const read = readResourceDiagnosticConfig(root);
  return { routine: read.present ? buildResourceDiagnosticRoutine(root, read, opts) : null, error: read.error, present: read.present, enabled: read.config?.enabled === true };
}

// ── CLI (the fixture-driven evidence surface the ACs paste from) ─────────────────────────────────
function flagValue(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write([
      "resource-anomaly-detector.ts — the Quality continuous resource diagnostic (mechanical first).",
      "  --rounds <file.jsonl>        unified execution record rows (fixture or .quay/verification-round.jsonl)",
      "  --experiments <file.jsonl>   long-experiment rows (repeat-expensive class)",
      "  --root <dir>                 workspace root (default cwd) — carrier/ledger live under it",
      "  --carrier <path>             override the anomaly carrier path",
      "  --no-carrier                 do not append to the carrier (pure reading)",
      "  --effect-before <a,b,c>      post-merge effect re-test: the anomalous window's durations (ms)",
      "  --effect-after <a,b,c>       post-merge effect re-test: the post-fix window's durations (ms)",
      "  --effect-baseline <a,b,c>    post-merge effect re-test: the pre-anomaly window's durations (ms)",
      "  --json                       machine-readable output",
      "",
    ].join("\n"));
    return 0;
  }
  const root = flagValue(argv, "--root") ?? process.cwd();
  const json = argv.includes("--json");
  const noCarrier = argv.includes("--no-carrier");

  // ── effect re-test mode (AC4): a DIRECT re-measurement, ⛔ not the fix task's own AC.
  const before = flagValue(argv, "--effect-before");
  if (before !== null) {
    const parse = (s: string | null) => String(s ?? "").split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
    const r = effectRetest({
      metric: flagValue(argv, "--metric") ?? "per-file durationMs",
      method: "median of the file's own __PERFILE__ durations over the window (.quay/verification-round.jsonl `perFile[].durationMs`)",
      baseline: parse(flagValue(argv, "--effect-baseline")),
      anomalous: parse(before),
      after: parse(flagValue(argv, "--effect-after")),
    });
    process.stdout.write(json ? JSON.stringify(r) + "\n" : `${r.verdict}: ${r.reason}\n`);
    return 0;
  }

  const carrier = flagValue(argv, "--carrier") ?? path.join(root, CARRIER_REL);
  const ledger = path.join(root, BUDGET_LEDGER_REL);
  const roundsFile = flagValue(argv, "--rounds") ?? path.join(root, UNIFIED_RECORD_REL);
  const experimentsFile = flagValue(argv, "--experiments");
  const rounds = readUnifiedRounds(roundsFile);
  const experiments = experimentsFile ? readExperimentRuns(experimentsFile) : [];

  const ckRes = await resolveConceptKeyOf(root);
  const anomalies = detectResourceAnomalies({ rounds, experiments }, {});
  const prior = readCarrierRecords(carrier);
  const fold = foldAnomalies(anomalies, prior.records, ckRes.conceptKeyOf);

  // ⛔ AC1's reading is MEASURED, not asserted: the budget ledger is counted around the mechanical
  // pass. A pass that reserved would move this number.
  const reservationsBefore = countReservations(ledger);
  let appended = 0;
  if (!noCarrier) {
    // ⛔ only NEW anomalies become finding lines; the recurrence is recorded on the scan-round line.
    appended = appendCarrierRecords(carrier, [
      ...fold.fresh.map((anomaly) => ({
        kind: "anomaly", routine: RESOURCE_DIAGNOSTIC_NAME, class: anomaly.class, subject: anomaly.subject,
        concept_kind: anomaly.concept_kind, components: anomaly.components,
        concept_key: anomalyConceptKey(anomaly, ckRes.conceptKeyOf),
        detail: anomaly.detail, evidence: anomaly.evidence, round: 0, at: new Date().toISOString(),
      })),
      {
        kind: "scan-round", routine: RESOURCE_DIAGNOSTIC_NAME, round: 0, at: new Date().toISOString(),
        anomalies: anomalies.length, fresh: fold.fresh.length, repeated: fold.repeated.length,
        spawns: 0, note: "cli mechanical pass — zero model calls",
      },
    ]);
  }
  const reservationsAfter = countReservations(ledger);

  const out = {
    routine: RESOURCE_DIAGNOSTIC_NAME,
    rounds_read: rounds.length,
    experiments_read: experiments.length,
    concept_key_module: ckRes.modulePath,
    concept_key_error: ckRes.error,
    anomalies: anomalies.length,
    distinct_concept_keys: new Set(fold.keyed.map((k) => k.concept_key).filter((k) => k !== null)).size,
    keyed: fold.keyed.filter((k) => k.concept_key !== null).length,
    fresh: fold.fresh.length,
    repeated: fold.repeated.length,
    unkeyable: fold.unkeyable,
    appended,
    reservations_before: reservationsBefore,
    reservations_after: reservationsAfter,
    reservations_delta: reservationsAfter - reservationsBefore,
    classes: [...new Set(anomalies.map((a) => a.class))].sort(),
    fresh_anomalies: fold.fresh.map((a) => ({ class: a.class, subject: a.subject, concept_kind: a.concept_kind, concept_key: anomalyConceptKey(a, ckRes.conceptKeyOf), detail: a.detail })),
    repeated_anomalies: fold.repeated.map((a) => ({ class: a.class, subject: a.subject, concept_key: anomalyConceptKey(a, ckRes.conceptKeyOf) })),
  };
  if (json) process.stdout.write(JSON.stringify(out) + "\n");
  else process.stdout.write([
    `resource-diagnostic — ${out.rounds_read} round(s) read`,
    `  anomalies ${out.anomalies} | distinct ${out.distinct_concept_keys} | fresh ${out.fresh} | repeated ${out.repeated} | unkeyable ${out.unkeyable}`,
    `  budget reservations before/after: ${out.reservations_before}/${out.reservations_after} (delta ${out.reservations_delta})`,
    ...out.fresh_anomalies.map((a) => `  NEW ${a.class} ${a.subject} key=${a.concept_key}`),
    ...out.repeated_anomalies.map((a) => `  REPEAT ${a.class} ${a.subject} key=${a.concept_key}`),
  ].join("\n") + "\n");
  return 0;
}

if (isDirectEntry(import.meta, undefined, "resource-anomaly-detector")) {
  main().then((code) => { process.exitCode = code; }).catch((e) => { process.stderr.write(`resource-anomaly-detector: ${(e as Error).stack ?? e}\n`); process.exitCode = 1; });
}
