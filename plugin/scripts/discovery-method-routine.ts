// discovery-method-routine.ts — wire the self-bootstrapping Discovery Method loop
// (docs/analysis/discovery-{experience-ledger,reflection,method-registry}.mjs) into the quality-gate
// driver's routine track, as a MINIMAL, REPORT-ONLY, bounded, killable mechanical routine.
//
// WHY THIS EXISTS: the three Discovery Method modules landed with a hand-run regression report
// (docs/analysis/discovery-method-regression-report.md) and no periodic runner — every round so far was
// started by hand from a task worktree. This module turns the loop into a Layer-1b `RoutineSpec` the
// resident quality-gate driver runs, reusing machinery that already exists rather than inventing a
// driver kind, a second scheduler or a meta-driver change. Per due round it does exactly three things:
//   (a) ingestNewOutcomes — the watermarked batch ingester over the real evidence store, quota-bounded;
//   (b) ONE bounded reflection round over whatever the ingest produced, if it produced anything;
//   (c) validateGeneralization for the candidates THAT ROUND minted, against held-out cases that carry
//       an `evaluation_pin`.
//
// ⛔ WHAT IS REUSED, AND WHY NOTHING IS RE-DERIVED (硬规则 5b): interval scheduling is
//   routine-scheduler.isDue against the DURABLE `.quay/routine-last-run.json` (the loop's own `lastRun`
//   map is in-memory ⇒ a driver restart would re-fire every round); halt is the driver's own
//   `.quay/quality-control.json` (`ctx.halted`); the quality-round fact is the Fact this routine
//   returns — the loop writes the heartbeat and we add NO writer of our own there. The ingest, the
//   reflection round, the candidate validator, the pin materialiser and the ancestry seam are all
//   IMPORTED from the modules that own them. This file adds orchestration + a carrier line, nothing else.
//
// REPORT-ONLY, STRUCTURALLY: this file imports no filing/authoring function and writes no task and no
// goal. Its only persistence is (a) append-only lines on ONE carrier,
// `.quay/discovery-method-findings.jsonl`, (b) the Discovery carriers the imported steps already own
// (the Experience ledger, the reflection-attempt log, the method registry, the generalization-verdict
// log), and (c) the existing quality-round fact. The absence of the authoring imports is asserted
// mechanically by the case-(8) static control in plugin/test/discovery-method-routine.test.mjs — a
// mutation that adds one such import turns that case red. ⚠️ Consequence for maintainers: do NOT name
// the forbidden authoring symbols here, not even in a comment (the control reads POSITION, and a
// comment mention would be a false positive).
//
// KILL SWITCH + OFF BY DEFAULT: the routine is declared in `.quay/config.yml` `loop.discovery_method:`
// (see parseDiscoveryMethodSection). A workspace with no such section gets `not-evaluated:disabled` and
// ZERO spawns — nothing else. `enabled: false` is the same. A malformed section, or an interval under
// the floor, records `failed` and spawns nothing — a bad declaration must never be read as "no
// findings" (硬规则 3b).
//
// FAIL-CLOSED ROUNDS: an ingest refusal (`WATERMARK_MISMATCH`, an unresolved shared checkout, a missing
// evidence store), a reflection refusal, or a budget breach each make the round `failed` with a
// DISTINCT reason; the round then appends NOTHING to the carrier and does NOT advance the last-run (so
// a failed round does not consume the window — the next round retries).
//
// ⛔ NOT a hot-path gate (the `gap-fan-in-remove-archguard-gate` lesson): nothing here is called by
// fan-in / scoped-gate / any per-task path. The only caller is the quality driver's routine table.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { isDue, parseTrigger } from "./routine-scheduler.ts";
import { type Fact, type RoutineSpec } from "./driver-runtime.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap, writeLastRun } from "./probe-routine.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// The Discovery Method loop — imported, never re-derived. The `.mjs` specifiers are the plain-node
// modules the whole Phase 0/1/2 stack already runs under (the same form the regression run used).
import {
  ingestNewOutcomes,
  readExperienceLedger,
} from "../../docs/analysis/discovery-experience-ledger.mjs";
import {
  runReflectionRound,
  validateGeneralization,
  validateEvaluationPin,
  materializeStrippedPin,
  gitIsAncestor,
  liveModelFactory,
  computeReflectionCost,
} from "../../docs/analysis/discovery-reflection.mjs";
import {
  appendMethodRecord,
  readMethodRegistry,
} from "../../docs/analysis/discovery-method-registry.mjs";

/** The routine's name — one key in `.quay/routine-last-run.json` (shared with the probe/arch-discovery
 *  tracks; ⛔ names do not collide and the map is a per-name merge write). */
export const DISCOVERY_METHOD_NAME = "discovery-method";

/** The ONE carrier this routine appends to. Gitignored runtime state, declared in
 *  docs/carrier-registry.json — the same family as quality-round.jsonl / arch-discovery-findings.jsonl. */
export const CARRIER_REL = path.posix.join(".quay", "discovery-method-findings.jsonl");

/** The interval floor. A round spends real model calls and materialises stripped pins (a whole-tree
 *  `git archive` each); a cadence shorter than six hours is refused rather than silently rounded up
 *  (the config error names the value). */
export const MIN_INTERVAL_MINUTES = 360;
/** Default interval when the section declares none (only reachable while disabled — an enabled section
 *  must declare `interval`). */
export const DEFAULT_INTERVAL_MINUTES = 360;
export const DEFAULT_MAX_EXPERIENCES = 8;
export const DEFAULT_MAX_MODEL_CALLS = 6;
export const DEFAULT_MAX_WALL_MS = 900_000;

/** Env override for the temp root the stripped pins are materialised under (tests point it at their own
 *  scratch dir so a run cannot litter the shared `/tmp`; production leaves it unset). */
export const PIN_TMP_ENV = "QUAY_DISCOVERY_METHOD_PIN_TMP";

// ── config: `.quay/config.yml` `loop.discovery_method:` ─────────────────────────────────────────────
export interface DiscoveryMethodConfig {
  enabled: boolean;
  trigger: { kind: string; minutes?: number };
  maxExperiences: number;
  maxModelCalls: number;
  maxWallMs: number;
}

/** `present` = the section exists; `config` = the parsed section (null when malformed); `error` = a
 *  fail-closed reason (a present-but-bad section ⇒ the round is `failed`). */
export interface DiscoveryMethodConfigRead {
  present: boolean;
  config: DiscoveryMethodConfig | null;
  error: string | null;
}

const cfgBad = (msg: string) => `loop.discovery_method ${msg}`;

/** Pure parse of ONE `loop.discovery_method` value. `enabled` is required and boolean; a disabled
 *  section is returned immediately (the kill switch must work even with the other keys absent/bad); an
 *  ENABLED section must carry a valid `interval:<N>m` ≥ the floor, and any bound that IS present must
 *  be in range (absent bounds take their documented default). */
export function parseDiscoveryMethodSection(raw: unknown): { config: DiscoveryMethodConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  const disabled: DiscoveryMethodConfig = {
    enabled: false,
    trigger: { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES },
    maxExperiences: DEFAULT_MAX_EXPERIENCES,
    maxModelCalls: DEFAULT_MAX_MODEL_CALLS,
    maxWallMs: DEFAULT_MAX_WALL_MS,
  };
  if (rec.enabled === false) return { config: disabled, error: null };

  if (typeof rec.interval !== "string") {
    return { config: null, error: cfgBad(`needs an 'interval' string of the form interval:<N>m (got ${rec.interval === undefined ? "missing" : JSON.stringify(rec.interval)})`) };
  }
  let trigger: { kind: string; minutes?: number };
  try {
    trigger = parseTrigger(rec.interval);
  } catch (e) {
    return { config: null, error: cfgBad(`invalid 'interval' — ${(e as Error).message}`) };
  }
  if (trigger.kind !== "interval" || typeof trigger.minutes !== "number") {
    return { config: null, error: cfgBad(`'interval' must be interval:<N>m (got kind '${trigger.kind}')`) };
  }
  if (trigger.minutes < MIN_INTERVAL_MINUTES) {
    return { config: null, error: cfgBad(`interval ${trigger.minutes}m is below the ${MIN_INTERVAL_MINUTES}m floor — a round spends real model calls and materialises stripped pins, so it is refused rather than silently rounded`) };
  }

  // ⛔ `0` is a LEGITIMATE bound for the two quotas (`max_experiences: 0` = ingest nothing this round;
  // `max_model_calls: 0` = a purely mechanical round) — the gate is integrality and non-negativity, not
  // a made-up positive floor. `max_wall_ms` needs ≥ 1: a zero wall budget is a round that can never do
  // anything, which is a declaration error rather than a reading.
  const bound = (key: string, dflt: number, min: number): { value: number | null; error: string | null } => {
    const v = rec[key];
    if (v === undefined || v === null) return { value: dflt, error: null };
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || !Number.isInteger(v)) {
      return { value: null, error: cfgBad(`'${key}' must be an integer >= ${min} (got ${JSON.stringify(v)})`) };
    }
    return { value: v, error: null };
  };
  const maxExperiences = bound("max_experiences", DEFAULT_MAX_EXPERIENCES, 0);
  if (maxExperiences.error) return { config: null, error: maxExperiences.error };
  const maxModelCalls = bound("max_model_calls", DEFAULT_MAX_MODEL_CALLS, 0);
  if (maxModelCalls.error) return { config: null, error: maxModelCalls.error };
  const maxWallMs = bound("max_wall_ms", DEFAULT_MAX_WALL_MS, 1);
  if (maxWallMs.error) return { config: null, error: maxWallMs.error };

  return {
    config: {
      enabled: true,
      trigger,
      maxExperiences: maxExperiences.value as number,
      maxModelCalls: maxModelCalls.value as number,
      maxWallMs: maxWallMs.value as number,
    },
    error: null,
  };
}

/** Read `.quay/config.yml` `loop.discovery_method:`. No config file / no `loop:` / no section ⇒
 *  `present:false` (off by default). Malformed YAML or a bad section ⇒ `error` set (fail-closed). */
export function readDiscoveryMethodConfig(workspaceRoot: string): DiscoveryMethodConfigRead {
  const configPath = path.join(workspaceRoot, ".quay", "config.yml");
  if (!fs.existsSync(configPath)) return { present: false, config: null, error: null };
  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    return { present: true, config: null, error: `FAIL-CLOSED: .quay/config.yml is malformed YAML — ${(e as Error).message}` };
  }
  const loop = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).loop : undefined;
  if (loop === undefined || loop === null) return { present: false, config: null, error: null };
  if (typeof loop !== "object" || Array.isArray(loop)) {
    return { present: true, config: null, error: "FAIL-CLOSED: .quay/config.yml 'loop:' must be a mapping" };
  }
  const raw = (loop as Record<string, unknown>).discovery_method;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseDiscoveryMethodSection(raw);
  return { present: true, config, error };
}

// ── the carrier: append-only JSONL of scan-round lines ──────────────────────────────────────────────
/** Read the carrier's existing lines. Returns `{missing:true}` when the file does not exist. A line
 *  that is not JSON, or is not an object, THROWS — an unreadable carrier must never be shaped like
 *  "0 previous rounds" (硬规则 3b). */
export function readCarrierRounds(carrierPath: string): { missing: boolean; records: Record<string, unknown>[] } {
  if (!fs.existsSync(carrierPath)) return { missing: true, records: [] };
  const raw = fs.readFileSync(carrierPath, "utf8");
  const records: Record<string, unknown>[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch (e) {
      throw new Error(`${carrierPath}:${i + 1} is not valid JSON — ${(e as Error).message}`);
    }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw new Error(`${carrierPath}:${i + 1} is not a JSON object`);
    records.push(rec as Record<string, unknown>);
  }
  return { missing: false, records };
}

/** Append records to the carrier (dir auto-created). One write ⇒ the round's lines land together. */
export function appendCarrierRecords(carrierPath: string, records: readonly Record<string, unknown>[]): number {
  if (records.length === 0) return 0;
  fs.mkdirSync(path.dirname(carrierPath), { recursive: true });
  fs.appendFileSync(carrierPath, records.map((r) => JSON.stringify(r) + "\n").join(""), "utf8");
  return records.length;
}

// ── held-out cases: the pinned Experiences the verifier may read ────────────────────────────────────
/** The held-out pool: ledger Experiences that carry an `evaluation_pin`. The pin is what makes an
 *  Experience usable as a held-out case (`validateGeneralization` refuses `NO_EVALUATION_PIN` without
 *  one), so the filter is the engine's own precondition — not a second policy invented here. An
 *  unreadable ledger is its OWN value (`ok:false`), never "no held-out cases" (硬规则 3b). */
export function readHeldOutCases(root: string): { ok: boolean; cases: Record<string, unknown>[]; reason: string | null; malformed_lines: number } {
  const ledger = readExperienceLedger(root);
  if (!ledger.ok) {
    return {
      ok: false,
      cases: [],
      malformed_lines: ledger.malformed_lines,
      reason: ledger.file === null
        ? `LEDGER_UNRESOLVED:${String((ledger as { reason?: string }).reason ?? "no-shared-checkout")}`
        : `LEDGER_UNREADABLE:${ledger.malformed_lines}-unparseable-line(s)-so-the-held-out-pool-cannot-be-read-as-complete`,
    };
  }
  const cases = ledger.records.filter((r: Record<string, unknown>) => typeof r?.evaluation_pin === "string" && r.evaluation_pin !== "");
  return { ok: true, cases, reason: null, malformed_lines: 0 };
}

// ── the round ───────────────────────────────────────────────────────────────────────────────────────
export type ModelFn = (prompt: string) => Promise<{ stdout: string }>;
export type IngestFn = (root: string, opts: { maxPerRun: number; enabled: boolean }) => Record<string, unknown>;
export type ReflectFn = (root: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type ValidateFn = (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type AppendFn = (root: string, rec: Record<string, unknown>) => Record<string, unknown>;
export type HeldOutFn = (root: string) => { ok: boolean; cases: Record<string, unknown>[]; reason: string | null; malformed_lines: number };
export type PinFn = (opts: { root: string; rev: string; dir: string }) => { ok: boolean; dir?: string; reason?: string };

export interface DiscoveryMethodRunOptions {
  /** Parsed section (see readDiscoveryMethodConfig). */
  config: DiscoveryMethodConfig | null;
  /** Whether `loop.discovery_method:` exists at all. */
  configPresent: boolean;
  /** Fail-closed config reason (a present-but-bad section). */
  configError?: string | null;
  /** From the routine ctx: halt gates the spawn, never the routine track. */
  halted: boolean;
  /** The model seam. Production supplies the live launcher (`liveModelFactory`); tests inject a stub. */
  model?: ModelFn | null;
  /** The model the launcher was ASKED for (recorded on every call). */
  modelId?: string | null;
  /** Resolved LAZILY, only when the round actually has something to reflect on — so a workspace whose
   *  ingest yields nothing (or that never enables the section) pays nothing for the launcher. Used when
   *  `model` is absent; a failure is the round's own `failed` reason. */
  modelFactory?: () => Promise<{ ok: boolean; model?: ModelFn; modelId?: string | null; reason?: string }>;
  /** Test seam: the batch ingester (default `ingestNewOutcomes`). */
  ingestFn?: IngestFn;
  /** Test seam: the reflection round (default `runReflectionRound`). */
  reflectFn?: ReflectFn;
  /** Test seam: the generalization validator (default `validateGeneralization`). */
  validateFn?: ValidateFn;
  /** Test seam: candidate persistence (default `appendMethodRecord`). */
  appendFn?: AppendFn;
  /** Test seam: the held-out pool reader (default `readHeldOutCases`). */
  heldOutFn?: HeldOutFn;
  /** Test seam: the stripped-pin materialiser (default `materializeStrippedPin`). */
  pinFn?: PinFn;
  /** Carrier override (tests). */
  carrierPath?: string;
  /** Durable last-run map override (tests). */
  lastRunPath?: string;
  /** Temp root for stripped pins (tests); defaults to `$QUAY_DISCOVERY_METHOD_PIN_TMP` or os.tmpdir(). */
  pinTmpRoot?: string;
  /** Injectable clock (tests). */
  now?: () => number;
}

const asRel = (root: string, p: string) => path.relative(root, p) || p;

/** The whole round: config gate → halt gate → durable due gate → ingest → (bounded) reflect →
 *  (bounded) generalize → append ONE `scan-round` line → advance last-run. Never throws (the loop
 *  records a `failed` Fact): every refused/failed path returns BEFORE the append. */
export async function runDiscoveryMethod(root: string, opts: DiscoveryMethodRunOptions): Promise<Fact> {
  const now = opts.now ?? Date.now;
  const carrier = opts.carrierPath ?? path.join(root, CARRIER_REL);
  const lastRunPath = opts.lastRunPath ?? path.join(root, ROUTINE_LAST_RUN_REL);
  const base = { routine: DISCOVERY_METHOD_NAME, carrier: asRel(root, carrier), fired: false };
  const fact = (state: Fact["state"], value: Record<string, unknown>, reason: string): Fact => ({ name: DISCOVERY_METHOD_NAME, value, state, reason });

  const started = now();

  // ① config: a bad section is `failed` (fail-closed), an absent/disabled one is `not-evaluated`.
  if (opts.configError) return fact("failed", base, `config invalid — ${opts.configError} (nothing spawned)`);
  if (!opts.configPresent || !opts.config || opts.config.enabled === false) {
    return fact("not-evaluated", { ...base, enabled: false }, "disabled: loop.discovery_method section absent or enabled:false — nothing spawned");
  }
  const config = opts.config;

  // ② halt: the round's gate. It gates the SPAWN (model calls / pin materialisation), not the routine
  //    track — observation continues.
  if (opts.halted) return fact("not-evaluated", { ...base, enabled: true }, "halted: discovery-method spawn suppressed (halt gates the spawn, not the routine track) — nothing spawned");

  // ③ durable window: the loop's own lastRun is in-memory ⇒ a driver restart would re-fire every round.
  const last = Number(readLastRunMap(lastRunPath)[DISCOVERY_METHOD_NAME]);
  if (!isDue(config.trigger, { now: started, lastRun: last })) {
    const agoMin = Number.isFinite(last) && last > 0 ? Math.round((started - last) / 60_000) : null;
    return fact(
      "not-evaluated",
      { ...base, enabled: true, intervalMinutes: config.trigger.minutes, minutesSinceLastRun: agoMin },
      `not due: ${agoMin === null ? "never ran (should be due — check the clock)" : `ran ${agoMin}m ago`} within the ${config.trigger.minutes}m interval — nothing spawned`,
    );
  }

  // ④ the carrier must be readable BEFORE anything runs: an unreadable carrier is NEVER shaped like
  //    "0 previous rounds" (硬规则 3b).
  try {
    readCarrierRounds(carrier);
  } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable carrier — ${(e as Error).message} (nothing appended)`);
  }

  // The wall budget is the round's own refusal: a step that runs past `max_wall_ms` stops the round
  // BEFORE the append, so the carrier stays byte-identical and the last-run is not consumed.
  const breached = () => now() - started >= config.maxWallMs;

  // ⑤ (a) ingest. A refusal here (WATERMARK_MISMATCH / an unresolved shared checkout / a missing
  //    evidence store) is the round's own failure with the step's OWN reason code.
  const ingestFn = opts.ingestFn ?? (ingestNewOutcomes as unknown as IngestFn);
  const ingest = ingestFn(root, { maxPerRun: config.maxExperiences, enabled: true }) as Record<string, unknown>;
  if (ingest.ok !== true) {
    const reasons = Array.isArray(ingest.reasons) ? (ingest.reasons as string[]) : [];
    return fact("failed", { ...base, enabled: true, ingest }, `ingest refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
  }
  const ingested = Number(ingest.ingested ?? 0);
  if (breached()) {
    return fact("failed", { ...base, enabled: true, ingest }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} after ingest (nothing appended, last-run not advanced)`);
  }

  // ⑥ (b) ONE bounded reflection round, and ONLY when the ingest produced something. Zero new
  //    Experiences ⇒ zero model calls — the property that makes two rounds on identical inputs cheap.
  let reflection: Record<string, unknown> | null = null;
  const candidates: Record<string, unknown>[] = [];
  const persisted: Record<string, unknown>[] = [];
  let modelCalls = 0;
  const calls: Record<string, unknown>[] = [];
  let model = opts.model ?? null;
  let modelId = opts.modelId ?? null;
  if (ingested > 0) {
    if (typeof model !== "function" && typeof opts.modelFactory === "function") {
      const live = await opts.modelFactory();
      if (!live.ok || typeof live.model !== "function") {
        return fact("failed", { ...base, enabled: true, ingest }, `model-seam-unavailable — ${String(live.reason ?? "MODEL_SEAM_MISSING")} (nothing appended, last-run not advanced)`);
      }
      model = live.model;
      modelId = live.modelId ?? null;
    }
    // The model requirement belongs to the DEFAULT reflection implementation: a caller that injects its
    // own `reflectFn` owns whatever seam that implementation needs (the tests do exactly that).
    if (typeof model !== "function" && opts.reflectFn === undefined) {
      return fact("failed", { ...base, enabled: true, ingest }, "model-seam-missing: the round has new Experiences to reflect on but no model was supplied (nothing appended, last-run not advanced)");
    }
    const reflectFn = opts.reflectFn ?? (runReflectionRound as unknown as ReflectFn);
    const r = await reflectFn(root, {
      model,
      modelId,
      nowMs: now(),
      budget: { enabled: true, maxPerRun: config.maxExperiences, maxModelCalls: config.maxModelCalls, maxWallMs: config.maxWallMs },
    });
    if (r.ok !== true) {
      return fact("failed", { ...base, enabled: true, ingest }, `reflection refused — ${String(r.reason ?? "no reason reported")} (nothing appended, last-run not advanced)`);
    }
    reflection = {
      decisions: Array.isArray(r.decisions) ? (r.decisions as unknown[]).length : 0,
      skipped_budget: Number(r.skipped_budget ?? 0),
      model_calls: Number(r.model_calls ?? 0),
      selection: r.selection ?? null,
    };
    modelCalls += Number(r.model_calls ?? 0);
    for (const d of (Array.isArray(r.decisions) ? r.decisions : []) as Record<string, unknown>[]) {
      if (d.ok === true && d.candidate) candidates.push(d.candidate as Record<string, unknown>);
      if (d.model_call) calls.push(d.model_call as Record<string, unknown>);
    }
    // The candidates this round minted are persisted BEFORE validation, so the generalization step sees
    // a registry in which the candidate's own version already exists (the version monotonicity gate and
    // the lineage walk both read the RECORDED versions).
    const appendFn = opts.appendFn ?? (appendMethodRecord as unknown as AppendFn);
    for (const c of candidates) {
      const a = appendFn(root, c);
      persisted.push({ method_id: c.method_id, version: c.version, ok: a.ok === true, reasons: a.reasons ?? [] });
    }
    if (breached()) {
      return fact("failed", { ...base, enabled: true, ingest, reflection }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} after reflection (nothing appended, last-run not advanced)`);
    }
  }

  // ⑦ (c) generalization against held-out cases that carry an `evaluation_pin`. Bounded by the SAME
  //    model-call budget as the reflection round, and skipped entirely when nothing new was minted.
  const verdicts: Record<string, unknown>[] = [];
  const promotions: string[] = [];
  const retirements: string[] = [];
  let verdictsSkipped = 0;
  // The held-out pool is read ONLY when there is something to validate — a round that minted nothing
  // must not even open the ledger (and must not turn an unreadable ledger into a round failure).
  const heldOut = candidates.length > 0
    ? (opts.heldOutFn ?? readHeldOutCases)(root)
    : { ok: true, cases: [] as Record<string, unknown>[], reason: null, malformed_lines: 0 };
  if (candidates.length > 0 && heldOut.ok) {
    const registryRead = readMethodRegistry(root, { history: true });
    const registry = Array.isArray(registryRead.history) ? registryRead.history : [];
    const isAncestor = gitIsAncestor(root);
    const pinTmp = opts.pinTmpRoot ?? process.env[PIN_TMP_ENV] ?? os.tmpdir();
    const pinFn = opts.pinFn ?? (materializeStrippedPin as unknown as PinFn);
    const validateFn = opts.validateFn ?? (validateGeneralization as unknown as ValidateFn);
    const pinDirs = new Map<string, { ok: boolean; dir: string | null; reason: string | null }>();
    const pinDirFor = (rev: string): { ok: boolean; dir: string | null; reason: string | null } => {
      if (pinDirs.has(rev)) return pinDirs.get(rev) as { ok: boolean; dir: string | null; reason: string | null };
      const dir = fs.mkdtempSync(path.join(pinTmp, `dm-pin-${rev.slice(0, 8)}-`));
      const r = pinFn({ root, rev, dir });
      const out = r.ok ? { ok: true, dir: r.dir ?? dir, reason: null } : { ok: false, dir: null, reason: String(r.reason ?? "PIN_MATERIALIZE_FAILED") };
      pinDirs.set(rev, out);
      return out;
    };
    for (const candidate of candidates) {
      for (const heldOutCase of heldOut.cases) {
        if (modelCalls >= config.maxModelCalls) { verdictsSkipped++; continue; }
        if (breached()) { verdictsSkipped++; continue; }
        // The cheap PURE preconditions run first: a case that cannot name its pin (or, being positive,
        // its fix) is refused WITHOUT materialising a stripped tree — the same refusal the engine would
        // reach, taken one expensive step earlier.
        const pinFields = validateEvaluationPin(heldOutCase);
        if (!pinFields.ok) {
          verdicts.push({ held_out_case_id: heldOutCase.case_id ?? heldOutCase.id ?? null, outcome: "not-evaluated", refusal_code: pinFields.reasons[0], called: false });
          continue;
        }
        const pin = String(heldOutCase.evaluation_pin);
        const pinDir = pinDirFor(pin);
        if (!pinDir.ok) {
          verdicts.push({ held_out_case_id: heldOutCase.case_id ?? heldOutCase.id ?? null, outcome: "not-evaluated", refusal_code: "PIN_MATERIALIZE_FAILED", called: false, reason: pinDir.reason });
          continue;
        }
        const v = await validateFn({
          candidate,
          heldOutCase,
          registry,
          model,
          modelId,
          nowMs: now(),
          root,
          experiences: heldOut.cases,
          pinDir: pinDir.dir,
          isAncestor,
          budget: { enabled: true, maxPerRun: 1, maxModelCalls: 1, maxWallMs: config.maxWallMs },
        });
        if (v.model_call) { modelCalls += 1; calls.push(v.model_call as Record<string, unknown>); }
        verdicts.push({
          method_id: candidate.method_id,
          version: candidate.version,
          held_out_case_id: heldOutCase.case_id ?? heldOutCase.id ?? null,
          outcome: v.outcome ?? null,
          refusal_code: v.refusal_code ?? null,
          predicted_verdict: v.predicted_verdict ?? null,
          correct: typeof v.correct === "boolean" ? v.correct : null,
          lineage_ok: typeof v.lineage_ok === "boolean" ? v.lineage_ok : null,
          temporal_ok: typeof v.temporal_ok === "boolean" ? v.temporal_ok : null,
          promoted: v.promoted === true,
          verdict_ref: v.verdict_ref ?? null,
        });
        // An EVALUATED verdict mints the candidate's next version: a promotion must CITE the recorded
        // verdict (`PROMOTION_WITHOUT_VALID_GENERALIZATION` otherwise), a retirement carries its reason.
        if (v.outcome === "evaluated" && v.candidate_after) {
          const after = v.promoted === true && typeof v.verdict_ref === "string"
            ? { ...(v.candidate_after as Record<string, unknown>), generalization_evidence: { verdict_ref: v.verdict_ref } }
            : (v.candidate_after as Record<string, unknown>);
          const a2 = appendFn(root, after);
          const label = `${String(candidate.method_id)}@${String(after.version)}`;
          if (after.status === "active" && a2.ok === true) promotions.push(label);
          if (after.status === "retired" && a2.ok === true) retirements.push(label);
          if (a2.ok !== true) {
            verdicts.push({ method_id: candidate.method_id, version: after.version, outcome: "persist-refused", refusal_code: "CANDIDATE_PERSIST_REFUSED", reasons: a2.reasons ?? [] });
          }
        }
      }
    }
    if (breached()) {
      return fact("failed", { ...base, enabled: true, ingest, reflection }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} during generalization (nothing appended, last-run not advanced)`);
    }
  } else if (candidates.length > 0 && !heldOut.ok) {
    // The held-out pool could not be read ⇒ its OWN value. The candidates still landed (they are drafts,
    // not claims); the generalization step is `not-evaluated`, never "0 verdicts ⇒ nothing passed".
    reflection = { ...(reflection ?? {}), held_out_unreadable: heldOut.reason };
  }

  // ⑧ the round's ONE line.
  const wallMs = now() - started;
  const cost = computeReflectionCost(calls, { wall_ms: wallMs }) as Record<string, unknown>;
  const round: Record<string, unknown> = {
    kind: "scan-round",
    routine: DISCOVERY_METHOD_NAME,
    ts: new Date(now()).toISOString(),
    wall_ms: wallMs,
    ingested: { experiences: ingested, scanned: Number(ingest.scanned ?? 0), duplicates: Number(ingest.duplicates ?? 0), advanced_to: ingest.advanced_to ?? null },
    reflected: reflection,
    candidates: { minted: candidates.length, persisted: persisted.filter((p) => p.ok === true).length, records: persisted },
    held_out: { cases: heldOut.ok ? heldOut.cases.length : null, unreadable: heldOut.ok ? null : heldOut.reason },
    verdicts: {
      total: verdicts.length,
      evaluated: verdicts.filter((v) => v.outcome === "evaluated").length,
      correct: verdicts.filter((v) => v.correct === true).length,
      not_evaluated: verdicts.filter((v) => v.outcome === "not-evaluated").length,
      skipped_budget: verdictsSkipped,
      records: verdicts,
    },
    promotions,
    retirements,
    model_calls: modelCalls,
    tokens: cost.tokens,
    cost_usd: cost.cost_usd,
  };
  appendCarrierRecords(carrier, [round]);
  writeLastRun(lastRunPath, DISCOVERY_METHOD_NAME, now());

  return fact(
    "verified",
    round,
    `round ran: ingested ${ingested} experience(s), reflected ${reflection ? Number(reflection.decisions ?? 0) : 0} unit(s), minted ${candidates.length} candidate(s), ${verdicts.filter((v) => v.outcome === "evaluated").length} evaluated verdict(s) (${verdicts.filter((v) => v.correct === true).length} correct), ${promotions.length} promotion(s), ${retirements.length} retirement(s), ${modelCalls} model call(s), wall ${wallMs}ms; appended 1 scan-round line to ${asRel(root, carrier)}`,
  );
}

// ── RoutineSpec factories ────────────────────────────────────────────────────────────────────────────
export interface DiscoveryMethodRoutineOptions extends Omit<DiscoveryMethodRunOptions, "config" | "configPresent" | "configError" | "halted"> {}

/** Build the Layer-1b routine from an ALREADY-PARSED config read. `schedule` is the section's trigger
 *  when present, else the default interval — a disabled/absent section is still an evaluated routine
 *  (it records `not-evaluated:disabled`), it just never spawns. */
export function buildDiscoveryMethodRoutine(root: string, read: DiscoveryMethodConfigRead, opts: DiscoveryMethodRoutineOptions = {}): RoutineSpec {
  const schedule = read.config?.trigger ?? { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES };
  return {
    name: DISCOVERY_METHOD_NAME,
    schedule,
    run: async (ctx) =>
      [await runDiscoveryMethod(root, {
        ...opts,
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        halted: ctx?.halted === true,
      })],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws (an optional routine
 *  track must not take down the host driver's startup). `routine` is `null` when NO section is
 *  declared — "off by default" means the host driver does not even ADD a routine to its table. A
 *  section that IS declared (even `enabled:false`, even malformed) yields a routine, because the
 *  declaration must be OBSERVABLE (硬规则 3b/9: "declared but not driven" and "not declared" must not
 *  look the same). */
export function discoveryMethodRoutineFromConfig(
  root: string,
  opts: DiscoveryMethodRoutineOptions = {},
): { routine: RoutineSpec | null; error: string | null; present: boolean; enabled: boolean } {
  const read = readDiscoveryMethodConfig(root);
  return {
    routine: read.present ? buildDiscoveryMethodRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: read.config?.enabled === true,
  };
}

/** The production model seam: the live launcher, resolved lazily so a workspace that never enables the
 *  section never pays for it. Returns `{ok:false, reason}` when the driver runtime cannot be loaded —
 *  a refusal, never a silent no-op (the round then records `failed`). */
export async function liveDiscoveryModel(root: string): Promise<{ ok: boolean; model?: ModelFn; modelId?: string | null; reason?: string }> {
  const live = await liveModelFactory({ root, tools: "", timeoutMs: 300_000 }) as { ok: boolean; model?: ModelFn; run?: ModelFn; reason?: string };
  if (!live.ok || typeof live.run !== "function") return { ok: false, reason: String(live.reason ?? "MODEL_SEAM_MISSING") };
  return { ok: true, model: live.run, modelId: live.model ?? null };
}

// ── CLI (the one-shot entry AC3 drives) ─────────────────────────────────────────────────────────────
const USAGE = [
  "discovery-method-routine — the Discovery Method loop as a Layer-1b routine (report-only).",
  "  --once --root <dir> [--json]      run ONE round against <dir> (the routine entry the driver calls)",
  "  --no-model                        run without the live model seam (ingest-only; zero model calls)",
  "  --pin-tmp <dir>                   temp root for stripped pins",
].join("\n");

async function main(argv: string[]): Promise<number> {
  const root = (() => { const i = argv.indexOf("--root"); return path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd()); })();
  const json = argv.includes("--json");
  const pinTmpRoot = (() => { const i = argv.indexOf("--pin-tmp"); return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : undefined; })();
  let model: ModelFn | null = null;
  let modelId: string | null = null;
  if (!argv.includes("--no-model")) {
    const live = await liveDiscoveryModel(root);
    if (!live.ok) {
      process.stderr.write(`discovery-method-routine: ${live.reason}\n`);
      return 2;
    }
    model = live.model as ModelFn;
    modelId = live.modelId ?? null;
  }
  const read = readDiscoveryMethodConfig(root);
  const fact = await runDiscoveryMethod(root, {
    config: read.config,
    configPresent: read.present,
    configError: read.error,
    halted: false,
    model,
    modelId,
    pinTmpRoot,
  });
  process.stdout.write(json ? `${JSON.stringify({ root, model: modelId, fact }, null, 1)}\n` : `${fact.state}: ${fact.reason}\n`);
  return fact.state === "failed" ? 1 : 0;
}

if (isDirectEntry(import.meta, process.argv[1], "discovery-method-routine")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

export { USAGE };
