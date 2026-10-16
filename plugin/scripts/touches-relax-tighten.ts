// touches-relax-tighten.ts — the AUTO-TIGHTEN LOOP of GOAL-037's adaptive dispatch relaxation:
// read the configured budget, judge the relaxation's measured cost against it, and — when the
// budget is blown — write the halt into the EXISTING control-state carrier.
//
// WHY THIS EXISTS (task gap-touches-relax-auto-tighten-loop-absent, GOAL-037 AC-367): AC-363 built
// the ledger and its cost report (a READING) and AC-366 turned `mode: live` into a real permit (an
// ACTION). Between them there was NOBODY who JUDGED the reading, NOBODY who wrote the control state,
// and NOBODY who left a trace. Without this module the relaxation is a one-way ratchet: it can be
// released and never taken back. That is 硬规则 4 推论三 in its exact form — AC-363's quantity was
// produced and had no consumer.
//
// ── THE THREE STATES, NOT TWO (硬规则 3b — "read it wrong" must never wear "qualified"'s face) ────
//   verdict "not-evaluated" — this run could NOT judge: a threshold is not configured, the sample is
//                             below `min_samples`, AC-363's report is itself not evaluated, or a
//                             declared step has no denominator. ⛔ NOT the same as "within budget".
//   verdict "within-budget" — judged, and nothing is over its configured threshold.
//   verdict "halt"          — judged, and something IS over ⇒ write `relax_halted: true`.
// Only `"halt"` writes. `"not-evaluated"` writes NOTHING — and that is enforced *structurally*
// (inside `applyAutoTighten`), ⛔ not by asking every caller to remember (AC2's 「不动作」).
//
// ── NO BUILT-IN THRESHOLDS (硬规则 12 / 硬规则 4 推论二) ────────────────────────────────────────
// Every threshold is READ from `loop.touches_relax.auto_tighten` (AC-364's config module). If one is
// missing the verdict is `not-evaluated` and the reason NAMES the missing key — ⛔ we never
// substitute a literal. There are no relaxed samples yet (quay itself runs `mode: off`), so inventing
// a number here would be inventing a precondition; the values are for a human to fill in from
// AC-362's data and the shadow-period readings.
//
// ── WHAT "COST" MEANS, AND WHY THE TWO DIMENSIONS ARE KEPT APART ────────────────────────────────
//   · extra worker minutes  = the relaxed group's extra minutes vs the control group (AC-363's
//                             `extraWorkerMinutes`, whose per-run quantity is `worker_exited_at −
//                             dispatched_at` — ⛔ NOT `wall_clock_ms`, which includes fan-in).
//   · fan-in failure rate   — PER `mechanical_fan_in.step` KEY. A `suite` red and a `merge-develop`
//                             red are reported as TWO independent entries with different thresholds
//                             and DIFFERENT reasons; ⛔ they are never folded into one "failure"
//                             count. The step vocabulary is the fan-in step vocabulary
//                             (`merge-develop` / `suite` / `ff` …) and ⛔ NOT `final_state`'s
//                             (`completed` / `exited-not-landed` / …): `worker-driver.ts` records a
//                             real incident where `landed` leaked into `final_state` and made the
//                             throughput reading read as zero, i.e. indistinguishable from a stall.
//                             A failure with NO `mechanical_fan_in` counts toward neither a step's
//                             numerator NOR the denominator (fail-closed), and is reported on its own
//                             as `failuresWithoutStep` — ⛔ never folded into `"unknown"`, ⛔ never 0.
//
// ── WHAT THIS MODULE DOES *NOT* DO ─────────────────────────────────────────────────────────────
//   · it does not read `.quay/relaxed-dispatch.jsonl` or `.quay/worker-outcome.jsonl` itself — it
//     consumes AC-363's `buildRelaxedDispatchReport` output (硬规则 1: one source of truth for the
//     measurement. If a reading were missing from that report we would EXTEND the report, never
//     re-parse the carriers here);
//   · it does not read the config file — AC-364's `loadTouchesRelaxConfig` / `parseTouchesRelaxSection`
//     is the only reader (the `auto_tighten:` sub-block was added THERE, not here);
//   · it does not create a carrier, a sentinel file, or an MCP control-plane verb. The halt lives in
//     the EXISTING `.quay/worker-control.json` (registered in `docs/carrier-registry.json` and
//     `.gitignore`), reached through the kernel's `readControlState` / `writeControlState`;
//   · it does not enable anything: with `mode` absent/off the driver does not even run the step.
//
// CLI (READ-ONLY — `--evaluate` never writes the control state; writing is `applyAutoTighten`, which
// only the driver calls):
//   node --experimental-strip-types plugin/scripts/touches-relax-tighten.ts --evaluate [--root <dir>] [--json]
//   exit 0 = evaluated (verdict is `within-budget` or `halt` — both ARE evaluations)
//   exit 3 = NOT-EVALUATED (same convention as `rework-predictors.ts` / `relaxed-dispatch-ledger.ts`)
//   exit 2 = usage error

import path from "node:path";
// Single source of truth for the measurement: AC-363's report + its `NOT_EVALUATED` sentinel.
import { NOT_EVALUATED, type MaybeNum } from "./duration-report.ts";
import { buildRelaxedDispatchReport, type RelaxedDispatchReport, type RelaxedRow } from "./relaxed-dispatch-ledger.ts";
// AC-364's config reader (⛔ this module does not parse `config.yml`).
import { loadTouchesRelaxConfig, type TouchesRelaxAutoTighten, type TouchesRelaxConfig } from "./touches-relax-config.ts";
// The EXISTING control-state carrier + its read/write/idempotent-op trio. Imported straight from the
// kernel (the sanctioned `plugin/` → `packages/` forward edge; `driver-shared.ts` re-exports the very
// same bindings) so this module's import closure stays {control-state, write-json-atomic, node:*}.
import { CONTROL_STATE_REL, applyRelaxHalt, readControlState, writeControlState, type ControlState } from "../../packages/quay/src/kernel/control-state.ts";
import { isDirectEntry } from "./gate-script-base.ts";

/** The verdict vocabulary — THE single source (⛔ do not re-spell these three at a call site). */
export const TIGHTEN_VERDICTS = ["not-evaluated", "within-budget", "halt"] as const;

export type TightenVerdict = (typeof TIGHTEN_VERDICTS)[number];

/** The step vocabulary is `mechanical_fan_in.step`'s, ⛔ not `final_state`'s. Exported so a reader (and
 *  the test) can assert the two vocabularies do not bleed into each other, and so the refusal message
 *  can list what a step key is. ⛔ The parser does NOT restrict the config to this list — the fan-in
 *  step set is owned by `worker-fan-in.ts` and evolves there; pinning a copy here would be a second
 *  source of truth. What is pinned is what these tokens are NOT. */
export const NOT_STEP_TOKENS = ["completed", "exited-not-landed", "landed", "killed", "timed-out", "failed"] as const;

/** One declared step's reading — numerator, denominator, the threshold ACTUALLY USED, and the rate. */
export interface AutoTightenStepReading {
  /** The `mechanical_fan_in.step` value this entry is about (逐字). */
  step: string;
  /** Relaxed-group runs red at this step (numerator). */
  failures: number;
  /** Relaxed-group runs that reached fan-in at all (denominator; the same value for every step). */
  reached: number;
  /** The configured threshold **read from the file** — `NOT_EVALUATED` when the key is absent
   *  (⛔ never a built-in literal). */
  threshold: MaybeNum;
  /** `failures / reached`; `NOT_EVALUATED` when the denominator is 0 (⛔ not 0 — "fan-in never ran"
   *  and "fan-in ran and was green" must not share a shape). */
  rate: MaybeNum;
  /** Over threshold? `null` = NOT EVALUATED (rate or threshold unmeasurable) — ⛔ never `false`. */
  overThreshold: boolean | null;
}

/** The readings a decision carries — all of them coming from carriers (AC-363's report) or from the
 *  config file (AC-364's reader), ⛔ none of them from a literal in this module. */
export interface AutoTightenReadings {
  /** Relaxed group's extra worker minutes vs the control group (AC-363's own reading). */
  extraWorkerMinutes: MaybeNum;
  /** The extra-cost threshold actually used, read from config (⛔ not a built-in). */
  maxExtraWorkerMinutes: MaybeNum;
  /** Relaxed-group sample size = the len of AC-363's ledger (that is what `min_samples` bounds). */
  samples: number;
  /** The configured `min_samples`, read from config (⛔ not a built-in). */
  minSamples: MaybeNum;
  /** Per-step entries — one per step key DECLARED in the config, sorted by step name. */
  fanIn: AutoTightenStepReading[];
  /** Relaxed-group failures that produced no step value: counted toward NO step's numerator and NOT
   *  toward the denominator. ⛔ Reported as itself, never as `"unknown"`, never as 0. */
  failuresWithoutStep: number;
  /** The relaxed group's fan-in-reaching run count (the shared denominator; 0 ⇒ nothing measurable). */
  fanInReached: number;
  /** The control state's `relax_halted` BEFORE this decision — a reading, so a caller can tell
   *  "already halted" from "we just halted it" without a second carrier read. */
  relaxHaltedBefore: boolean;
}

/** The decision — the whole judge's output. `verdict` is the three-state face; `reason` names the
 *  dimension (and, for a step, the step) that produced it. */
export interface AutoTightenDecision {
  evaluated: boolean;
  verdict: TightenVerdict;
  reason: string | null;
  /** True ⟺ EVERY threshold this decision needs was present in the config. A `false` here is one of
   *  the not-evaluated causes and is stated separately so a reader need not parse the reason. */
  thresholdsConfigured: boolean;
  readings: AutoTightenReadings;
}

export interface EvaluateOptions {
  /** Injected clock (epoch ms). ⛔ Read once, by the caller — an evaluation must be reproducible. */
  nowMs: number;
  /** AC-364's parsed config (`loop.touches_relax`). `auto_tighten` may be absent ⇒ not-evaluated. */
  config: TouchesRelaxConfig;
  /** AC-363's report. Its `evaluated` is an INPUT to this judge, never re-derived here. */
  report: RelaxedDispatchReport;
}

/** Render a `MaybeNum` for a message: the sentinel verbatim, else a fixed-precision number. */
function fmt(v: MaybeNum, digits = 3): string {
  return v === NOT_EVALUATED ? NOT_EVALUATED : v.toFixed(digits);
}

/** `undefined` → the sentinel; a number → itself. Keeps "the key was absent" from ever being
 *  encoded as a number (硬规则 3b: the missing threshold is a DIFFERENT value, not a different
 *  magnitude). */
function thresholdOrNotEvaluated(v: number | undefined): MaybeNum {
  return v === undefined ? NOT_EVALUATED : v;
}

/** Which of the three `auto_tighten` keys are missing/unusable. Named per key so the reason is
 *  locatable in `config.yml` rather than merely "rejected". */
function missingAutoTightenKeys(auto: TouchesRelaxAutoTighten | undefined): string[] {
  const missing: string[] = [];
  if (auto === undefined) {
    // The whole sub-block is absent — name all three rather than pretending one of them is the
    // problem (we have not read any of them).
    return ["auto_tighten (the whole sub-block is absent)"];
  }
  if (auto.min_samples === undefined) missing.push("min_samples");
  if (auto.max_extra_worker_minutes === undefined) missing.push("max_extra_worker_minutes");
  const rates = auto.max_fan_in_failure_rate;
  if (rates === undefined || Object.keys(rates).length === 0) missing.push("max_fan_in_failure_rate (no step declared)");
  return missing;
}

/** Sum one per-step numerator over the relaxed group's rows. A row that never carried the step
 *  contributes 0 — that is a measurement (it did not fail there), not a missing value. */
function sumStep(rows: readonly RelaxedRow[], step: string): number {
  let n = 0;
  for (const row of rows) n += row.fanInStepFailures[step] ?? 0;
  return n;
}

/**
 * Judge the relaxation's measured cost against the configured budget. **Pure with respect to the
 * control state**: it READS `.quay/worker-control.json` (for `relaxHaltedBefore`) and writes nothing.
 *
 * ⛔ The four not-evaluated causes are checked in a fixed order, and the FIRST one that fires names
 * itself. They are NOT folded into one another: 「阈值没配」, 「样本不够」, 「AC-363 的报告本身未评估」
 * and 「某一步没有分母」 are four different facts a reader must be able to tell apart.
 */
export function evaluateAutoTighten(root: string, opts: EvaluateOptions): AutoTightenDecision {
  const { config, report } = opts;
  const auto = config.auto_tighten;
  const controlState = readControlState(root).state;
  const relaxedRows = report.relaxed.rows;
  const fanInReached = relaxedRows.reduce((n, row) => n + row.fanInReached, 0);
  const failuresWithoutStep = relaxedRows.reduce((n, row) => n + row.failuresWithoutStep, 0);

  const missing = missingAutoTightenKeys(auto);
  const thresholdsConfigured = missing.length === 0;
  const declaredSteps = thresholdsConfigured ? Object.keys(auto!.max_fan_in_failure_rate!).sort() : [];

  const fanIn: AutoTightenStepReading[] = declaredSteps.map((step) => {
    const failures = sumStep(relaxedRows, step);
    const threshold = thresholdOrNotEvaluated(auto!.max_fan_in_failure_rate![step]);
    const rate: MaybeNum = fanInReached === 0 ? NOT_EVALUATED : failures / fanInReached;
    const overThreshold = rate === NOT_EVALUATED || threshold === NOT_EVALUATED ? null : rate > threshold;
    return { step, failures, reached: fanInReached, threshold, rate, overThreshold };
  });

  const readings: AutoTightenReadings = {
    extraWorkerMinutes: report.extraWorkerMinutes,
    maxExtraWorkerMinutes: thresholdOrNotEvaluated(auto?.max_extra_worker_minutes),
    samples: report.ledger.records,
    minSamples: thresholdOrNotEvaluated(auto?.min_samples),
    fanIn,
    failuresWithoutStep,
    fanInReached,
    relaxHaltedBefore: controlState.relax_halted,
  };

  const notEvaluated = (reason: string): AutoTightenDecision => ({ evaluated: false, verdict: "not-evaluated", reason, thresholdsConfigured, readings });

  // ① mode really enabled? With `off` (or an absent block — which reads `off`) there is no relaxation
  //    to tighten. ⛔ This is NOT "evaluated and within budget": it is "there is nothing to judge".
  if (config.mode === "off") {
    return notEvaluated(`not-evaluated: mode is 'off' — the relaxation is not enabled, so there is no relaxation budget to tighten (thresholds read: ${thresholdsConfigured})`);
  }

  // ② every threshold present? (⛔ No built-in default is substituted for a missing one.)
  if (!thresholdsConfigured) {
    return notEvaluated(
      `not-evaluated: thresholds not configured — missing ${missing.join(", ")}; ` +
        `samples=${readings.samples}, extraWorkerMinutes=${fmt(readings.extraWorkerMinutes)}, fanInReached=${fanInReached}. ` +
        `No built-in default is applied (GOAL-037: the thresholds come from config, never from a literal in code)`,
    );
  }

  // ③ enough samples? Both counts are printed so the reader can see the shortfall, not just its fact.
  if (readings.samples < auto!.min_samples!) {
    return notEvaluated(
      `not-evaluated: 样本不足 — samples=${readings.samples} < min_samples=${auto!.min_samples} ` +
        `(relaxed measurable tasks=${report.relaxed.measurableTasks}, ledger records=${report.ledger.records}, ledger present=${report.ledger.present})`,
    );
  }

  // ④ is AC-363's report itself evaluable? (Its `evaluated` is an input; we do not re-derive it.)
  if (!report.evaluated) {
    return notEvaluated(`not-evaluated: 放宽账本报告未评估 — ${report.reason ?? "(no reason given)"}`);
  }
  if (readings.extraWorkerMinutes === NOT_EVALUATED) {
    return notEvaluated(
      `not-evaluated: extraWorkerMinutes 读不出（relaxed measurable=${report.relaxed.measurableTasks}, control measurable=${report.control.measurableTasks}）`,
    );
  }

  // ⑤ every declared step measurable? A step whose denominator is 0 has NO rate — ⛔ that is not
  //    "rate 0 <= threshold". Refusing here only ever withholds a halt (never fabricates one).
  const blindSteps = fanIn.filter((s) => s.overThreshold === null);
  if (blindSteps.length > 0) {
    return notEvaluated(
      `not-evaluated: 分步失败率无分母 — ${blindSteps.map((s) => `${s.step} (rate=${fmt(s.rate)}, threshold=${fmt(s.threshold)})`).join(", ")}; ` +
        `fanInReached=${fanInReached} over the relaxed group (a run that never reached fan-in is excluded from the denominator by construction, ⛔ not counted as a non-failure)`,
    );
  }

  // ── the judgment itself ───────────────────────────────────────────────────────────────────────
  const over: string[] = [];
  if (readings.extraWorkerMinutes > readings.maxExtraWorkerMinutes) {
    over.push(
      `extra worker minutes ${fmt(readings.extraWorkerMinutes, 1)} > max_extra_worker_minutes ${fmt(readings.maxExtraWorkerMinutes, 1)} ` +
        `(relaxed median=${fmt(report.relaxed.workerMinutesMedian, 1)}, control median=${fmt(report.control.workerMinutesMedian, 1)})`,
    );
  }
  for (const s of fanIn) {
    if (s.overThreshold === true) {
      over.push(`fan-in failure rate at step '${s.step}' ${fmt(s.rate)} > threshold ${fmt(s.threshold)} (failures=${s.failures}/${s.reached})`);
    }
  }

  if (over.length > 0) {
    return {
      evaluated: true,
      verdict: "halt",
      reason: `halt: ${over.join("; ")}`,
      thresholdsConfigured,
      readings,
    };
  }
  return {
    evaluated: true,
    verdict: "within-budget",
    reason:
      `within-budget: extra worker minutes ${fmt(readings.extraWorkerMinutes, 1)} <= ${fmt(readings.maxExtraWorkerMinutes, 1)}; ` +
      `steps [${fanIn.map((s) => `${s.step}=${fmt(s.rate)}<=${fmt(s.threshold)}`).join(", ")}]; samples=${readings.samples} >= min_samples=${readings.minSamples}`,
    thresholdsConfigured,
    readings,
  };
}

/** The write path's result. `applied:false` with `reason:null` = "nothing to do (already halted)" —
 *  distinguishable from `applied:false` with a reason (refused) and from `applied:true`. */
export interface ApplyTightenResult {
  applied: boolean;
  reason: string | null;
  /** The carrier that would be / was written (⛔ always the EXISTING control-state file). */
  file: string;
  /** The carrier's state AFTER the call (read-back for the already-halted path, the written value
   *  otherwise). This is the in-memory state; AC3/AC7 read the FILE back. */
  state: ControlState;
}

/**
 * Apply a decision: on `verdict === "halt"`, flip `relax_halted` to `true` in the EXISTING control
 * state — a read-modify-write through the kernel's `readControlState` / `writeControlState`
 * (⛔ no `writeFileSync`, ⛔ no new sentinel file, ⛔ no new MCP control-plane verb).
 *
 * ⛔ WRITES ONLY ON `"halt"`, and only when the flag actually CHANGES. The refusal for every other
 * verdict lives HERE rather than in the caller, so "the not-evaluated branch wrote the control
 * state" is not a mistake a caller can make (AC2's 「不动作」 is structural, not a convention).
 *
 * ⛔ It never CLEARS the flag: `within-budget` is not an un-halt. Clearing is a human action on that
 * one JSON file (AC6) — otherwise a single good round would release a tightening that the budget
 * says should stand, and the ratchet would be one-way in the wrong direction.
 *
 * ⛔ It never touches `halted` / `halted_by` / `halted_at` / `preference` / `forced`: the
 * read-modify-write carries the parsed state through `applyRelaxHalt`'s spread, so an automatic
 * tightening cannot erase a human halt or a forced dispatch (AC7).
 */
export function applyAutoTighten(root: string, decision: AutoTightenDecision): ApplyTightenResult {
  const file = path.join(root, CONTROL_STATE_REL);
  if (decision.verdict !== "halt") {
    return {
      applied: false,
      reason: `verdict=${decision.verdict} — auto-tighten writes only on 'halt' (⛔ 'not-evaluated' takes no action)`,
      file,
      state: readControlState(root).state,
    };
  }
  const current = readControlState(root).state;
  const next = applyRelaxHalt(current, true);
  if (next.relax_halted === current.relax_halted) {
    // Already halted ⇒ nothing to flush. Reported as refused-with-no-reason so 「本来就是 true」and
    // 「落盘失败」 don't share a face.
    return { applied: false, reason: null, file, state: current };
  }
  writeControlState(root, next);
  return { applied: true, reason: null, file, state: next };
}

/** The round-record entry this step contributes (AC8). `null` at the call site = the step did NOT
 *  run this round (⛔ never written as 「ran and found nothing over budget」). This shape is what a
 *  round record's `auto_tighten` key holds. */
export interface AutoTightenRoundRecord {
  evaluated: boolean;
  verdict: TightenVerdict;
  reason: string | null;
  thresholdsConfigured: boolean;
  /** Did this run actually flip the control state? (false for not-evaluated / within-budget /
   *  already-halted — the reasons are separable through `verdict` + `relaxHaltedBefore`.) */
  applied: boolean;
  readings: AutoTightenReadings;
}

/** Build the round-record entry. Kept here (not in `worker-driver.ts`) so the record's shape and the
 *  judge's shape cannot drift apart — the driver only decides WHETHER the step ran. */
export function toRoundRecord(decision: AutoTightenDecision, applied: ApplyTightenResult): AutoTightenRoundRecord {
  return {
    evaluated: decision.evaluated,
    verdict: decision.verdict,
    reason: decision.reason,
    thresholdsConfigured: decision.thresholdsConfigured,
    applied: applied.applied,
    readings: decision.readings,
  };
}

// ── CLI (read-only: `--evaluate` NEVER writes the control state) ───────────────────────────────────
const USAGE = [
  "usage: touches-relax-tighten.ts --evaluate [--root <dir>] [--json]",
  "  reads <root>/.quay/config.yml loop.touches_relax.auto_tighten: + AC-363's report and judges the",
  "  relaxation's measured cost against the configured budget. WRITES NOTHING (the write path is",
  "  applyAutoTighten, called by the worker driver's round loop).",
  "  exit 0 = evaluated (verdict within-budget | halt); 3 = NOT-EVALUATED; 2 = usage error",
];

function main(argv: string[]): number {
  let root: string | null = null;
  let json = false;
  let evaluate = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--evaluate") evaluate = true;
    else if (a === "--json") json = true;
    else if (a === "--root") {
      const v = argv[++i];
      if (v === undefined || v === "") {
        process.stderr.write(`touches-relax-tighten: --root requires a directory\n`);
        return 2;
      }
      root = v;
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(`${USAGE.join("\n")}\n`);
      return 0;
    } else {
      process.stderr.write(`touches-relax-tighten: unknown argument '${a}'\n${USAGE.join("\n")}\n`);
      return 2;
    }
  }
  if (!evaluate) {
    process.stderr.write(`touches-relax-tighten: --evaluate is required (this CLI has exactly one verb)\n${USAGE.join("\n")}\n`);
    return 2;
  }

  const rootDir = root ?? process.cwd();
  const nowMs = Date.now();
  const load = loadTouchesRelaxConfig(rootDir);
  // An unreadable/invalid declaration is NOT silently "off": we still evaluate (and the judge will
  // report not-evaluated naming the config problem through the absent thresholds).
  const config: TouchesRelaxConfig = load.config ?? { mode: "off", shared_files: [], never_relax: [] };
  const report = buildRelaxedDispatchReport(rootDir, { nowMs });
  const decision = evaluateAutoTighten(rootDir, { nowMs, config, report });

  if (json) {
    process.stdout.write(`${JSON.stringify({ root: rootDir, configState: load.state, ...decision }, null, 2)}\n`);
  } else {
    const L: string[] = [];
    L.push(`touches-relax-tighten: ${rootDir}`);
    L.push(`config state: ${load.state} (mode=${config.mode})`);
    L.push(`verdict: ${decision.verdict.toUpperCase()}${decision.reason ? `  — ${decision.reason}` : ""}`);
    L.push(`thresholdsConfigured: ${decision.thresholdsConfigured}`);
    L.push(`samples=${decision.readings.samples} min_samples=${fmt(decision.readings.minSamples, 1)}`);
    L.push(
      `extraWorkerMinutes=${fmt(decision.readings.extraWorkerMinutes, 1)} max_extra_worker_minutes=${fmt(decision.readings.maxExtraWorkerMinutes, 1)}`,
    );
    L.push(`fanInReached=${decision.readings.fanInReached} failuresWithoutStep=${decision.readings.failuresWithoutStep}`);
    for (const s of decision.readings.fanIn) {
      L.push(`  step ${s.step}: rate=${fmt(s.rate)} (${s.failures}/${s.reached}) threshold=${fmt(s.threshold)} over=${s.overThreshold === null ? "NOT-EVALUATED" : s.overThreshold}`);
    }
    L.push(`relax_halted (before this decision) = ${decision.readings.relaxHaltedBefore}`);
    process.stdout.write(`${L.join("\n")}\n`);
  }
  // 3 = NOT-EVALUATED: "could not judge" is not "judged and within budget" (same convention as
  // `rework-predictors.ts` / `relaxed-dispatch-ledger.ts`).
  return decision.evaluated ? 0 : 3;
}

// Direct-execution guard: the NAME form, not the URL form — same reason as `touches-relax-config.ts`
// (this module is statically imported by `worker-driver.ts`, i.e. it gets inlined into every driver
// bundle, where a URL-shaped guard is vacuously true and would hijack the bundle's own main).
if (isDirectEntry(import.meta, undefined, "touches-relax-tighten")) {
  process.exit(main(process.argv.slice(2)));
}
