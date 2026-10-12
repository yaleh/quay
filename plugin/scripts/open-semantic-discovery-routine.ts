// open-semantic-discovery-routine.ts — wire OPEN-ENDED SEMANTIC architecture discovery into the
// quality-gate driver's routine track, as a REPORT-ONLY, bounded, killable, budgeted semantic round.
//
// WHY THIS EXISTS. A 2026-10-12 operator audit of this workspace's discovery carriers measured that
// continuous AUTOMATIC architecture discovery had produced ZERO confirmed new code problems in 24h:
//   · `arch-discovery` is purely mechanical — no model, no verification. Its "new" fingerprints were
//     test-red signals.
//   · `semantic-dedup-scan` is model-driven but only every 1440m and only for the duplication class.
//   · `discovery-method` reflects on Experience summaries with `tools:""` — it produces METHODS, not
//     findings, and nothing applies them to code.
// The ONE path that found a real new defect recently was open-ended hypothesis generation + source
// Read/Grep verification (docs/analysis/arch-hypothesis-generation.mjs, the 2026-10-12 capability-gain
// experiment: GAIN1-CTRL-c10, fixed by gap-self-report-vocab-audit-check-pattern-tables-diverge,
// 74b4341b8). That path existed but was only ever run BY HAND. This module schedules it.
//
// GOVERNING PRINCIPLE — SEMANTIC FIRST, MECHANIZE LATER (user ruling, 2026-10-12). The mechanical code
// here is limited to scheduling, state/provenance persistence, dedup ASSISTANCE, safety isolation,
// budget and tool wrapping. It never replaces a semantic judgment, never gates whether the model may
// look, and "no mechanical change" never suppresses a semantic round:
//   · the inventory is an OPTIONAL MAP, never a filter and never a prerequisite (see `runOpenSemanticRound`
//     step ④): an empty, missing or unbuildable inventory still runs the semantic round;
//   · a pin unchanged since the last round still runs it;
//   · `arch-discovery` reporting 0 new fingerprints still runs it — in fact this module never reads that
//     routine's carrier at all;
//   · there is NO classifier, fingerprint gate or problem-class pattern table anywhere below. The only
//     pattern-shaped thing in this file is a PROTOCOL MARKER (`FOCUS_MARKER`, the tag the model uses to
//     state its own exploration focus) — it selects nothing and rejects nothing. `dedup` is ASSISTANCE
//     ONLY: `clusterHypotheses` merges near-duplicate hypotheses across runs by component-set overlap;
//     nothing is discarded by shape.
//
// ⛔ WHAT IS REUSED, AND WHY NOTHING IS RE-DERIVED (硬规则 5b): the model steps are the EXISTING
// arch-hypothesis-generation.mjs functions (`runInvestigator`, `runVerifier`, `clusterHypotheses`,
// `hardenedArgv`, `parseJsonObject`, `verifyCwdRefusal`), loaded from disk at RUNTIME like
// `discovery-method-routine.loadDiscoveryModules` does — never by a static `../../docs/analysis` import,
// because this file is SHIPPED and such a specifier both escapes the built artifact and inlines those
// modules' entry guards into the driver bundles (see the discovery-method re-land note). Interval
// scheduling is routine-scheduler.isDue against the DURABLE `.quay/routine-last-run.json`; halt is the
// driver's own control file; the round's fact is the Fact this routine returns. The budget is the hard,
// atomic, pre-spawn reservation ledger delivered by gap-discovery-method-24h-budget-hard-reservation —
// imported, under THIS routine's own key paths and its own cap (240 is discovery-method's cap and is not
// shared silently).
//
// REPORT-ONLY, STRUCTURALLY: this file imports no filing/authoring function and writes no task and no
// goal. Its only persistence is (a) append-only lines on ONE carrier,
// `.quay/open-semantic-discovery-findings.jsonl`, (b) this routine's own reservation ledger, and (c) the
// existing quality-round fact. The absence of the authoring imports is asserted mechanically by the
// case-(i) static control in plugin/test/open-semantic-discovery-routine.test.mjs. ⚠️ Consequence for
// maintainers: do NOT name the forbidden authoring symbols here, not even in a comment (the control reads
// POSITION, and a comment mention would be a false positive).
//
// KILL SWITCH + OFF BY DEFAULT: declared in `.quay/config.yml` `loop.open_semantic_discovery:`. A
// workspace with no such section gets `not-evaluated:disabled` and ZERO spawns. `enabled:false` is the
// same. A malformed section — or a missing key, since EVERY key is required — records `failed` and spawns
// nothing: a bad declaration must never be read as "no findings" (硬规则 3b).
//
// ⛔ WHO INVOKED THE ROUND — the manual/resident split, same as discovery-method. The durable due gate
// reads AND advances the PRODUCTION entry in `.quay/routine-last-run.json`, a SCHEDULING input, so a
// round run BY HAND (the `--once` CLI, a test, an acceptance check) must never be what moves production's
// clock. Every round records `invoked_by` on both its carrier line and its Fact; only
// `resident-driver` (the driver's routine table) advances the entry, and it stamps the entry with its own
// identity in the SAME write. The default is `manual` — a caller that forgets to declare itself cannot
// move production's schedule.
//
// ⛔ THE 24h CEILINGS ARE HARD, PRE-SPAWN RESERVATIONS, one per SUBPROCESS (investigator, verifier,
// refuter, value-assessment). TWO ceilings, checked in this order before every spawn:
//   · COUNT — `max_model_calls_per_24h`, from the reservation ledger's trailing-24h reservations;
//   · USD   — `max_usd_per_24h`, from the SAME ledger's realized gateway cost (`loadGatewayRates` +
//             `deriveCost`). An unknown cost counts as the per-call ceiling estimate, NEVER 0 — a call
//             whose price could not be read must not read as free.
// Either refusal is its OWN token on the Fact (`budget-24h` / `budget-usd-24h`) — never shaped like idle.
//
// ⛔ THE TURN BUDGET OF EVERY SUBPROCESS IS EXPLICIT AND STATED, so the worst case is computable rather
// than unknown: `--max-turns` is on every argv this routine builds. The blind investigator (`--tools ""`,
// kept for the controlled experiments of the P2 task — NOT the production default) is ONE turn, because
// with no tools there is nothing to iterate on.
//
// ⛔ NOT a hot-path gate (the `gap-fan-in-remove-archguard-gate` lesson): nothing here is called by
// fan-in / scoped-gate / any per-task path. The only caller is the quality driver's routine table.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { isDue, parseTrigger } from "./routine-scheduler.ts";
import { launchArgv, type Fact, type RoutineSpec } from "./driver-runtime.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "./probe-routine.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// The reservation ledger + the carrier/last-run helpers are the machine discovery-method's budget task
// built and tested. Imported, never re-derived — this routine only supplies its OWN key paths and caps.
import {
  appendCarrierRecords,
  appendLedgerRecords,
  BudgetLockError,
  BudgetRefusedError,
  classifyModelFailure,
  INVOKED_BY_DEFAULT,
  INVOKED_BY_MANUAL,
  INVOKED_BY_RESIDENT,
  isBudgetRefused,
  isResidentStamped,
  latestResidentRoundTs,
  openModelBudget,
  readCarrierRounds,
  readLedgerRecords,
  readRealizedTurns,
  writeLastRunStamped,
  type BudgetUsage,
  type InvokedBy,
  type ModelBudget,
} from "./discovery-method-routine.ts";

// ── identity + carriers ─────────────────────────────────────────────────────────────────────────────
/** The routine's name — one key in `.quay/routine-last-run.json`. ⛔ Names do not collide and the map is
 *  a per-name merge write, so this string is the routine's identity everywhere. */
export const OPEN_SEMANTIC_DISCOVERY_NAME = "open-semantic-discovery";

/** The ONE carrier this routine appends to (scan-round + per-cluster records). Gitignored runtime state,
 *  declared in docs/carrier-registry.json — the same family as arch-discovery-findings.jsonl. */
export const CARRIER_REL = path.posix.join(".quay", "open-semantic-discovery-findings.jsonl");
/** THIS routine's own reservation ledger and lock. ⛔ Its OWN paths: the call ceiling is per-routine and
 *  discovery-method's 240 is not shared silently. */
export const BUDGET_LEDGER_REL = path.posix.join(".quay", "open-semantic-discovery-model-budget.jsonl");
export const BUDGET_LOCK_REL = path.posix.join(".quay", "open-semantic-discovery-model-budget.lock");

/** Env override for the temp root the stripped pins are materialised under (tests point it at their own
 *  scratch dir so a run cannot litter the shared `/tmp`; production leaves it unset). */
export const PIN_TMP_ENV = "QUAY_OPEN_SEMANTIC_DISCOVERY_PIN_TMP";

// ── cadence ─────────────────────────────────────────────────────────────────────────────────────────
/** The interval floor: a round materialises a whole stripped tree (a full `git archive`), runs at least
 *  one real model call and verifies up to K clusters — a cadence shorter than an hour is refused rather
 *  than silently rounded up. ⛔ PER-ROUTINE: arch-discovery's and discovery-method's own floors are
 *  separate constants in their own files and none of them moves another's. */
export const MIN_INTERVAL_MINUTES = 60;
/** The PERMANENT interval, and the revert target of a temporary window — the same rule discovery-method
 *  uses (`interval_until` is REQUIRED below it, so a faster cadence can only ever be a declared,
 *  expiring window). */
export const DEFAULT_INTERVAL_MINUTES = 360;

// ── the model steps' tool and turn envelopes (see the header) ────────────────────────────────────────
/** The INVESTIGATOR's tools. It reads code and context ITSELF, rooted at the pinned tree, instead of
 *  reasoning only over a mechanically pre-digested inventory — that is the whole difference between this
 *  routine and `runInvestigator`'s blind default. */
export const INVESTIGATOR_TOOLS = "Read,Grep,Glob";
/** The investigator's internal turn budget when it HAS tools. It is a stated module constant rather than a
 *  config key because the config's declared keys are the operator's budget surface; this bounds what
 *  happens INSIDE one already-counted call. `investigator_max_turns` in the config overrides it. */
export const DEFAULT_INVESTIGATOR_MAX_TURNS = 12;
/** The blind investigator's turn budget: `--tools ""` ⇒ nothing to iterate on ⇒ ONE turn, exactly as the
 *  discovery-method reflection seam documents its own. Kept because the controlled experiments of the P2
 *  task still want the tool-less mode — as an opt-in, never as this routine's production default. */
export const BLIND_INVESTIGATOR_MAX_TURNS = 1;
/** The VERIFIER's tools (the bounded-verifier discipline: it may read the pinned tree, nothing else). */
export const VERIFIER_TOOLS = "Read,Grep";
/** The REFUTER's tools: the same envelope, a DIFFERENT prompt and a FRESH context. */
export const REFUTER_TOOLS = "Read,Grep";
/** The VALUE-assessor's tools: it states engineering impact from evidence it may re-read. */
export const VALUE_TOOLS = "Read,Grep";

/** The stated per-call USD ceiling used when a call's realized gateway cost could not be read. Basis: the
 *  2026-10-12 GAIN1 capability-gain run measured ≈$0.05 for an investigator call and ≈$0.5 for a verifier
 *  cluster at gateway rates; the ceiling is the larger of those rounded up, so an unreadable price is
 *  always counted at or ABOVE its plausible cost (the ceiling fails safe toward refusal). */
export const PER_CALL_USD_CEILING = 1.0;

/** The scope the inventory is built over. It is only the map's scope — the investigator's own tools are
 *  rooted at the whole pinned tree, so a declared scope never narrows what the model may look at. */
export const INVENTORY_SCOPE_REL = path.posix.join("plugin", "scripts");

/** The PROTOCOL MARKER the investigator states its exploration focus with. ⛔ This is not a problem-class
 *  pattern: it selects nothing, rejects nothing and carries no vocabulary of defects. It exists so the
 *  focus the MODEL chose can be persisted and handed to the NEXT round as history (mechanical state), so
 *  later rounds can choose to go elsewhere — the choice stays the model's. */
export const FOCUS_MARKER = "FOCUS:";

/** How many previously-explored focuses are handed back to the model. A bound on the prompt, not a policy:
 *  the model is told these were already explored, and nothing stops it from revisiting one. */
export const FOCUS_HISTORY_MAX = 10;

// ── the config section: `.quay/config.yml` `loop.open_semantic_discovery:` ───────────────────────────
// EVERY key is required on an ENABLED section, and a malformed key is a config error (`failed`, zero
// spawns). Why ALL of them: each one is a bound this routine would otherwise have to invent a default for,
// and an invented default is indistinguishable from a stated one on the record (硬规则 3b). The kill
// switch is the exception — `enabled:false` returns before any other key is read, so disabling never
// depends on the rest of the declaration being well-formed.
export interface OpenSemanticDiscoveryConfig {
  enabled: boolean;
  trigger: { kind: string; minutes?: number };
  /** Epoch-ms deadline of a TEMPORARY cadence. `null` = the configured interval is PERMANENT. At/after
   *  this instant the round reverts to `DEFAULT_INTERVAL_MINUTES` and says so in its Fact. */
  intervalUntil: number | null;
  investigatorRuns: number;
  maxClustersVerified: number;
  investigatorMaxTurns: number;
  verifierMaxTurns: number;
  refutationMaxTurns: number;
  maxWallMs: number;
  maxModelCallsPer24h: number;
  maxUsdPer24h: number;
}

/** `present` = the section exists; `config` = the parsed section (null when malformed); `error` = a
 *  fail-closed reason (a present-but-bad section ⇒ the round is `failed`). */
export interface OpenSemanticDiscoveryConfigRead {
  present: boolean;
  config: OpenSemanticDiscoveryConfig | null;
  error: string | null;
}

const cfgBad = (msg: string) => `loop.open_semantic_discovery ${msg}`;

const DISABLED_DEFAULTS: OpenSemanticDiscoveryConfig = {
  enabled: false,
  trigger: { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES },
  intervalUntil: null,
  investigatorRuns: 1,
  maxClustersVerified: 3,
  investigatorMaxTurns: DEFAULT_INVESTIGATOR_MAX_TURNS,
  verifierMaxTurns: 8,
  refutationMaxTurns: 6,
  maxWallMs: 1_200_000,
  maxModelCallsPer24h: 120,
  maxUsdPer24h: 30,
};

/** Pure parse of ONE `loop.open_semantic_discovery` value. `enabled` is required and boolean; a disabled
 *  section is returned immediately (the kill switch must work even with the other keys absent/bad); an
 *  ENABLED section must carry EVERY other key, each in range. */
export function parseOpenSemanticDiscoverySection(raw: unknown): { config: OpenSemanticDiscoveryConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) return { config: { ...DISABLED_DEFAULTS }, error: null };

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
    return { config: null, error: cfgBad(`interval ${trigger.minutes}m is below the ${MIN_INTERVAL_MINUTES}m floor — a round materialises a whole stripped tree and spends real model calls, so it is refused rather than silently rounded`) };
  }

  // The TEMPORARY-cadence rule (the same one discovery-method uses, restated because the two routines'
  // floors and defaults are separate constants): a cadence below the PERMANENT default is temporary BY
  // DECLARATION and must name the instant it expires, so "60m became the standing cadence" is not a state
  // this config can be left in by omission.
  let intervalUntil: number | null = null;
  if (rec.interval_until !== undefined && rec.interval_until !== null) {
    if (typeof rec.interval_until !== "string") {
      return { config: null, error: cfgBad(`'interval_until' must be an ISO-8601 string (got ${JSON.stringify(rec.interval_until)})`) };
    }
    const ms = Date.parse(rec.interval_until);
    if (!Number.isFinite(ms)) {
      return { config: null, error: cfgBad(`'interval_until' is not a parseable instant (got ${JSON.stringify(rec.interval_until)} — expected ISO-8601, e.g. 2026-10-20T12:00:00Z)`) };
    }
    intervalUntil = ms;
  }
  const temporary = trigger.minutes < DEFAULT_INTERVAL_MINUTES;
  if (temporary && intervalUntil === null) {
    return { config: null, error: cfgBad(`interval ${trigger.minutes}m is below the ${DEFAULT_INTERVAL_MINUTES}m default and no 'interval_until' is declared — a sub-${DEFAULT_INTERVAL_MINUTES}m cadence is TEMPORARY by declaration and must not be able to become permanent silently`) };
  }

  const intKey = (key: string, min: number): { value: number | null; error: string | null } => {
    const v = rec[key];
    if (v === undefined || v === null) return { value: null, error: cfgBad(`needs '${key}' (every key is required on an enabled section; got missing)`) };
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < min) {
      return { value: null, error: cfgBad(`'${key}' must be an integer >= ${min} (got ${JSON.stringify(v)})`) };
    }
    return { value: v, error: null };
  };
  const fields: Array<[keyof OpenSemanticDiscoveryConfig & string, number]> = [
    ["investigator_runs", 1],
    ["max_clusters_verified", 1],
    ["verifier_max_turns", 1],
    ["refutation_max_turns", 1],
    ["max_wall_ms", 1],
    ["max_model_calls_per_24h", 0],
  ];
  const parsed: Record<string, number> = {};
  for (const [key, min] of fields) {
    const r = intKey(key, min);
    if (r.error) return { config: null, error: r.error };
    parsed[key] = r.value as number;
  }
  // `investigator_max_turns` is an OPTIONAL EXTRA bound, not one of the declared key set: the operator's
  // budget surface is the nine declared keys, and this one bounds what happens INSIDE an already-counted
  // call. Absent ⇒ the stated default; present ⇒ it must still be a well-formed positive integer.
  const invTurns = rec.investigator_max_turns === undefined || rec.investigator_max_turns === null
    ? { value: DEFAULT_INVESTIGATOR_MAX_TURNS, error: null }
    : intKey("investigator_max_turns", 1);
  if (invTurns.error) return { config: null, error: invTurns.error };
  // ⛔ `0` is a legitimate value for `max_model_calls_per_24h` (a mechanical-only declaration is coherent)
  // — the gate is integrality and non-negativity, not a made-up positive floor. The USD ceiling is the one
  // bound where 0 would be incoherent (a round that may spend nothing is a round that may never run), so it
  // needs a strictly positive value.
  const usd = rec.max_usd_per_24h;
  if (usd === undefined || usd === null) {
    return { config: null, error: cfgBad(`needs 'max_usd_per_24h' (every key is required on an enabled section; got missing)`) };
  }
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
    return { config: null, error: cfgBad(`'max_usd_per_24h' must be a number > 0 (got ${JSON.stringify(usd)})`) };
  }

  return {
    config: {
      enabled: true,
      trigger,
      intervalUntil,
      investigatorRuns: parsed.investigator_runs,
      maxClustersVerified: parsed.max_clusters_verified,
      investigatorMaxTurns: invTurns.value as number,
      verifierMaxTurns: parsed.verifier_max_turns,
      refutationMaxTurns: parsed.refutation_max_turns,
      maxWallMs: parsed.max_wall_ms,
      maxModelCallsPer24h: parsed.max_model_calls_per_24h,
      maxUsdPer24h: usd,
    },
    error: null,
  };
}

/** Read `.quay/config.yml` `loop.open_semantic_discovery:`. No config file / no `loop:` / no section ⇒
 *  `present:false` (off by default). Malformed YAML or a bad section ⇒ `error` set (fail-closed). */
export function readOpenSemanticDiscoveryConfig(workspaceRoot: string): OpenSemanticDiscoveryConfigRead {
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
  const raw = (loop as Record<string, unknown>).open_semantic_discovery;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseOpenSemanticDiscoverySection(raw);
  return { present: true, config, error };
}

// ── the USD half of the 24h budget ───────────────────────────────────────────────────────────────────
/** One reservation's realized price, as the ledger records it (a `cost` line written after the call,
 *  joined to its `reserve` line by `id`). */
export interface LedgerCostLine {
  id: string;
  cost_usd: number | null;
  cost_source: string;
}

/** ⛔ THE USD READING IS `unknown ⇒ ceiling`, NEVER `unknown ⇒ 0`. For every reservation GRANTED in the
 *  trailing window: its own `cost` line's `cost_usd` when that is a finite number, else
 *  `perCallCeiling`. That makes a call whose price could not be read, and a call with NO cost line at all
 *  (killed mid-flight), both count at or above their plausible cost — the direction a CEILING must fail.
 *  `priced` / `estimated` are reported separately so a reader can tell "we knew the price" from "we
 *  guessed high" without re-deriving it (硬规则 3). */
export function usdBudgetUsage(opts: {
  ledgerRecords: readonly Record<string, unknown>[];
  nowMs: number;
  windowMs: number;
  perCallCeiling: number;
}): { usd: number; priced: number; estimated: number; reservations: number; reservation_ids: string[] } {
  const costs = new Map<string, number | null>();
  for (const rec of opts.ledgerRecords) {
    if (rec.kind !== "cost") continue;
    const id = typeof rec.id === "string" ? rec.id : null;
    if (id === null) continue;
    const v = rec.cost_usd;
    costs.set(id, typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  }
  let usd = 0;
  let priced = 0;
  let estimated = 0;
  let reservations = 0;
  const ids: string[] = [];
  for (const rec of opts.ledgerRecords) {
    if (rec.kind !== "reserve") continue;
    const ms = typeof rec.ts === "string" ? Date.parse(rec.ts) : NaN;
    if (!Number.isFinite(ms)) {
      throw new Error(`ledger reservation has no parseable 'ts' (got ${JSON.stringify(rec.ts)}) — the USD budget cannot be established from a partially-readable window`);
    }
    if (!(ms > opts.nowMs - opts.windowMs && ms <= opts.nowMs)) continue;
    reservations++;
    if (typeof rec.id === "string") ids.push(rec.id);
    const realized = typeof rec.id === "string" ? costs.get(rec.id) : undefined;
    if (typeof realized === "number") {
      usd += realized;
      priced++;
    } else {
      usd += opts.perCallCeiling;
      estimated++;
    }
  }
  return { usd: Math.round(usd * 1e6) / 1e6, priced, estimated, reservations, reservation_ids: ids };
}

// ── the pin: a stripped tree at the develop tip ──────────────────────────────────────────────────────
/** A materialised pin, or a refusal naming why. `dir` is the stripped tree the model is rooted at. */
export type PinResult = { ok: true; dir: string } | { ok: false; reason: string };

/** Where the model may NOT find anything: the pin is STRIPPED of the methodology directories before any
 *  step is allowed to run in it, so the model reasons about CODE, not about the project's own notes on
 *  itself. The list is the engine's own `PIN_FORBIDDEN_DIRS` — read from the loaded module, never copied,
 *  so a change there is a change here (硬规则 5b). */
export function materializeStrippedPin(opts: {
  root: string;
  rev: string;
  dir: string;
  forbiddenDirs: readonly string[];
  stripCheck: (dir: string) => string | null;
  exec?: typeof execFileSync;
}): PinResult {
  const exec = opts.exec ?? execFileSync;
  try {
    fs.mkdirSync(opts.dir, { recursive: true });
    const tar = exec("git", ["-C", opts.root, "archive", "--format=tar", opts.rev], { maxBuffer: 1 << 30 });
    exec("tar", ["-x", "-C", opts.dir], { input: tar, maxBuffer: 1 << 26 });
  } catch (e) {
    return { ok: false, reason: `PIN_MATERIALIZE_FAILED:${(e as Error).message}` };
  }
  for (const d of opts.forbiddenDirs) {
    try {
      fs.rmSync(path.join(opts.dir, d), { recursive: true, force: true });
    } catch { /* a directory that is not there needs no stripping */ }
  }
  // ⛔ The strip is CHECKED by position, not asserted: `verifyCwdRefusal` enumerates the forbidden
  // directories and their presence is its own refusal, naming which ones. A pin that silently still
  // carried `docs/` would make every downstream reading a reading of the wrong tree.
  const refusal = opts.stripCheck(opts.dir);
  if (refusal) return { ok: false, reason: `PIN_NOT_STRIPPED:${refusal}` };
  return { ok: true, dir: opts.dir };
}

// ── argv + the spawn wrapper (the tool-wrapper mechanical piece the DoD allows) ───────────────────────
/** The argv for ONE model step. Every argv carries `--max-turns`: an unbounded subprocess is not a shape
 *  this routine can produce. A tool-less step is ONE turn — with no tools there is nothing to iterate on,
 *  and saying so here is what makes the 24h worst case a computable number rather than a hope. */
export function stepArgv(
  buildArgv: (prompt: string, root: string, opts: { tools: string; maxTurns: number | null; outputFormat: string | null; model: string | null }) => string[],
  prompt: string,
  root: string,
  opts: { tools: string; maxTurns: number | null; model: string | null },
): { argv: string[]; tools: string; maxTurns: number } {
  const maxTurns = opts.tools === "" ? BLIND_INVESTIGATOR_MAX_TURNS : (opts.maxTurns ?? BLIND_INVESTIGATOR_MAX_TURNS);
  return {
    argv: buildArgv(prompt, root, { tools: opts.tools, maxTurns, outputFormat: "stream-json", model: opts.model }),
    tools: opts.tools,
    maxTurns,
  };
}

/** The spawn primitive this routine drives every model subprocess with. It exists because the model must
 *  be ROOTED AT THE PIN, and the shared `runAsync` primitive has no `cwd` option: without it the child
 *  would inherit the driver's own cwd — the main checkout — and read an UNSTRIPPED tree. Timeout semantics
 *  mirror `runAsync` (finite ⇒ SIGKILL; every failure is returned, never thrown). */
export function spawnModelCall(
  argv: string[],
  opts: { cwd: string; timeoutMs: number; stdinData?: string },
): Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: opts.cwd,
        stdio: [opts.stdinData === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ status: null, stdout: "", stderr: "", error: e as Error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (status: number | null, error: Error | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, error });
    };
    if (Number.isFinite(opts.timeoutMs)) {
      timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        finish(null, new Error(`spawn timeout after ${opts.timeoutMs}ms (SIGKILL): ${argv[0]}`));
      }, opts.timeoutMs);
    }
    if (opts.stdinData !== undefined && child.stdin) {
      child.stdin.on("error", () => { /* the child's own exit decides the outcome */ });
      child.stdin.end(opts.stdinData);
    }
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code, null));
  });
}

// ── the engine modules: resolved from DISK at runtime, never statically imported (see the header) ────
export const HYPOTHESIS_MODULE_FILE = "arch-hypothesis-generation.mjs";
export const PORTFOLIO_MODULE_FILE = "discovery-portfolio.mjs";
export const ANALYSIS_DIR_REL = path.posix.join("docs", "analysis");

/** The repo this FILE lives in (…/plugin/scripts/<this> → repo root). Used only to BUILD a candidate
 *  path — nothing is resolved through it until the runtime `import()`. */
export const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The narrow interface this file consumes from arch-hypothesis-generation.mjs. Declared here rather than
 *  reached through a type-position import of an out-of-artifact path (the same reason the loader exists). */
export interface HypothesisModule {
  PIN_FORBIDDEN_DIRS: readonly string[];
  HARD_MAX_CLUSTERS: number;
  DEFAULT_EVIDENCE_MAX_LINES: number;
  hardenedArgv: (launch: unknown, prompt: string, root: string, opts?: Record<string, unknown>) => string[];
  verifyCwdRefusal: (cwd: string, pinDir: string) => string | null;
  clusterHypotheses: (runs: readonly Record<string, unknown>[], opts?: Record<string, unknown>) => Array<Record<string, unknown>>;
  runInvestigator: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  runVerifier: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  buildInventory: (opts: Record<string, unknown>) => Record<string, unknown>;
  parseJsonObject: (stdout: string) => Record<string, unknown> | null;
  parseVerifierStream: (stdout: string) => { ok?: boolean; num_turns?: unknown; model?: unknown; usage?: unknown; cost_usd?: unknown };
  callText: (stdout: string) => string;
  defaultVerifierPrompt: (here?: string) => string;
  defaultInvestigatorPrompt: (here?: string) => string;
  TOOL: string;
}
/** The narrow interface this file consumes from discovery-portfolio.mjs (the gateway cost path). */
export interface PortfolioModule {
  loadGatewayRates: (opts: Record<string, unknown>) => { ok: boolean; rates?: Record<string, unknown>; reason?: string };
  deriveCost: (usage: unknown, rates: unknown) => { ok: boolean; cost?: Record<string, unknown>; reason?: string };
}
export interface OpenDiscoveryModules {
  hyp: HypothesisModule;
  portfolio: PortfolioModule;
}

const _engineModuleCache = new Map<string, unknown>();

/** Resolve one engine module to an absolute path, returning the candidates it TRIED so a refusal can name
 *  them (an unresolvable engine is a `failed` round, not a silent zero). */
export function resolveEngineModule(root: string, file: string): { path: string | null; tried: string[] } {
  const tried = [
    path.join(SCRIPT_REPO_ROOT, ANALYSIS_DIR_REL, file),
    path.join(root, ANALYSIS_DIR_REL, file),
  ];
  for (const candidate of tried) {
    if (fs.existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}

/** Load the two engine modules, or THROW a refusal naming every module that could not be resolved and the
 *  candidate paths tried. Throwing (rather than returning a `{ok:false}` a caller might forget to check) is
 *  deliberate: the round converts it into its own `failed` reason. */
export async function loadOpenDiscoveryModules(root: string): Promise<OpenDiscoveryModules> {
  const unresolved: string[] = [];
  const load = async (file: string): Promise<unknown> => {
    const r = resolveEngineModule(root, file);
    if (r.path === null) {
      unresolved.push(`${file} — not found at ${r.tried.join(" or ")}`);
      return null;
    }
    const cached = _engineModuleCache.get(r.path);
    if (cached !== undefined) return cached;
    try {
      const mod = (await import(/* @vite-ignore */ pathToFileURL(r.path).href)) as unknown;
      _engineModuleCache.set(r.path, mod);
      return mod;
    } catch (e) {
      unresolved.push(`${file} — import failed: ${(e as Error).message}`);
      return null;
    }
  };
  const hyp = await load(HYPOTHESIS_MODULE_FILE);
  const portfolio = await load(PORTFOLIO_MODULE_FILE);
  if (unresolved.length > 0 || hyp === null || portfolio === null) {
    throw new Error(`OPEN_DISCOVERY_MODULES_UNRESOLVED — ${unresolved.join("; ") || "one or more engine modules did not load"}`);
  }
  return { hyp: hyp as HypothesisModule, portfolio: portfolio as PortfolioModule };
}

// ── prompts (the routine's OWN composition; the frozen engine prompts stay byte-identical) ───────────
/** The directive PREPENDED to the frozen investigator prompt. It is what turns the blind investigator into
 *  a source-reading one, and what carries the focus history back to the model. */
export function focusDirective(priorFocuses: readonly string[]): string {
  const history = priorFocuses.length === 0
    ? "No exploration focus has been recorded by an earlier round yet."
    : `Earlier rounds chose these focuses (mechanical history, so you can choose to go ELSEWHERE — nothing forbids revisiting one):\n${priorFocuses.map((f) => `  - ${f}`).join("\n")}`;
  return [
    "You are exploring a PINNED, STRIPPED copy of this repository. Use Read/Grep/Glob to read real source",
    "and context yourself; do not reason from a summary. Directories holding the project's own notes about",
    "itself are not present in the tree.",
    "",
    `FIRST, state your exploration focus on its own line, exactly as: \`${FOCUS_MARKER} <one sentence>\`.`,
    "The focus is YOUR choice. Then return the hypothesis JSON array as instructed below.",
    "",
    history,
    "",
    "---",
    "",
  ].join("\n");
}

/** The REFUTATION prompt. Its ONLY input is the cluster's claim and components — it never sees the first
 *  verifier's reasoning, which is the whole point of a fresh-context independent refutation. */
export const REFUTATION_PROMPT_TEMPLATE = [
  "You are an INDEPENDENT REFUTER. Another agent claimed the following about this repository.",
  "Your ONLY job is to REFUTE it from the code. Read the source with Read/Grep before answering.",
  "You have not seen the other agent's reasoning and must not assume it.",
  "",
  "CLAIM + COMPONENTS:",
  "{{HYP}}",
  "",
  'Return ONE JSON object: {"verdict":"supported|refuted|undetermined","intentional_difference_found":"',
  'the specific counterexample you found, or null","evidence":["file:line — what it shows"],',
  '"counterexample":"what would have to be true for the claim to hold","summary":"one sentence"}',
  'Use "refuted" when you FOUND a concrete counterexample in the code; "supported" ONLY when you tried and',
  'could not; "undetermined" when the code does not settle it.',
].join("\n");

/** The VALUE-ASSESSMENT prompt. Bounded: it states engineering impact, the evidence, and a candidate fix
 *  outline — and it is recorded as the MODEL's assessment, never as a human rating. The JSON keys are the
 *  ones the shared verifier row already parses, so no second parser is invented (the mapping is documented
 *  at the call site). */
export const VALUE_PROMPT_TEMPLATE = [
  "You are assessing the ENGINEERING VALUE of a CONFIRMED finding about this repository.",
  "Read whatever source you need with Read/Grep. State impact, evidence and a candidate fix outline.",
  "",
  "CONFIRMED FINDING:",
  "{{HYP}}",
  "",
  'Return ONE JSON object: {"intentional_difference_found":"the engineering impact, concretely",',
  '"evidence":["file:line — what it shows"],"counterexample":"a candidate fix outline, or null",',
  '"summary":"one sentence a maintainer can act on"}',
].join("\n");

// ── the round ────────────────────────────────────────────────────────────────────────────────────────
export type ModelStepKind = "investigator" | "verifier" | "refuter" | "value-assessment";

export interface OpenSemanticDiscoveryRunOptions {
  config: OpenSemanticDiscoveryConfig | null;
  configPresent: boolean;
  configError?: string | null;
  halted: boolean;
  invokedBy?: InvokedBy;
  force?: boolean;
  /** The engine seam. Absent ⇒ resolved from disk at runtime (`loadOpenDiscoveryModules`). */
  modules?: OpenDiscoveryModules | null;
  /** The base launcher argv builder. Defaults to driver-runtime's `launchArgv`. */
  launchArgvFn?: ((role: string, prompt: string, root: string, opts?: Record<string, unknown>) => string[]) | null;
  /** The spawn seam. Defaults to `spawnModelCall` (which roots the child at the pin). */
  spawnFn?: ((argv: string[], opts: { cwd: string; timeoutMs: number; stdinData?: string }) => Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }>) | null;
  /** Test seam: materialise the pin. Defaults to `materializeStrippedPin`. */
  pinFn?: ((opts: { root: string; rev: string; dir: string }) => PinResult) | null;
  /** Test seam: resolve the revision to pin. Defaults to the develop tip. */
  revFn?: ((root: string) => string) | null;
  budgetLedgerPath?: string;
  budgetLockPath?: string;
  carrierPath?: string;
  lastRunPath?: string;
  pinTmpRoot?: string;
  now?: () => number;
}

const asRel = (root: string, p: string) => path.relative(root, p) || p;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** The focus the MODEL stated, read from its own final text by PROTOCOL MARKER (the last occurrence wins:
 *  a model that restates its focus is read at its latest statement). Returns `null` when the model stated
 *  none — its own value, never an invented string. ⛔ String operations only: this file contains no
 *  regular expression, and the case-(l) control asserts exactly that. */
export function focusFromText(text: string): string | null {
  if (typeof text !== "string") return null;
  let found: string | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(FOCUS_MARKER)) continue;
    const v = line.slice(FOCUS_MARKER.length).trim();
    if (v !== "") found = v;
  }
  return found;
}

/** The previously explored focuses, read off the carrier's own scan-round lines. This is the persisted
 *  mechanical state handed back to the model — the carrier IS the list; no second store is invented. */
export function priorFocuses(records: readonly Record<string, unknown>[], max: number = FOCUS_HISTORY_MAX): string[] {
  const out: string[] = [];
  for (let i = records.length - 1; i >= 0 && out.length < max; i--) {
    const rec = records[i];
    if (rec.kind !== "scan-round") continue;
    const focus = (rec.focus as Record<string, unknown> | undefined)?.chosen;
    if (typeof focus === "string" && focus !== "") out.push(focus);
  }
  return out.reverse();
}

/** The develop tip, resolved from the workspace. A `rev-parse` failure is the round's own `failed`. */
export function developTip(root: string): string {
  return execFileSync("git", ["-C", root, "rev-parse", "develop"], { encoding: "utf8" }).trim();
}

/** The whole round. Never throws (the loop records a `failed` Fact): every refused/failed path returns
 *  BEFORE the append, except the mid-round budget refusal, which PERSISTS what it did and says so. */
export async function runOpenSemanticDiscovery(root: string, opts: OpenSemanticDiscoveryRunOptions): Promise<Fact> {
  const now = opts.now ?? Date.now;
  const carrier = opts.carrierPath ?? path.join(root, CARRIER_REL);
  const ledgerPath = opts.budgetLedgerPath ?? path.join(root, BUDGET_LEDGER_REL);
  const lockPath = opts.budgetLockPath ?? path.join(root, BUDGET_LOCK_REL);
  const lastRunPath = opts.lastRunPath ?? path.join(root, ROUTINE_LAST_RUN_REL);
  const invokedBy: InvokedBy = opts.invokedBy ?? INVOKED_BY_DEFAULT;
  const resident = invokedBy === INVOKED_BY_RESIDENT;
  const force = opts.force === true;
  const base = { routine: OPEN_SEMANTIC_DISCOVERY_NAME, invoked_by: invokedBy, carrier: asRel(root, carrier) };
  const fact = (state: Fact["state"], value: Record<string, unknown>, reason: string): Fact =>
    ({ name: OPEN_SEMANTIC_DISCOVERY_NAME, value, state, reason });
  const started = now();

  // ① config. A present-but-bad section is `failed` (fail-closed); absent/disabled is `not-evaluated`.
  if (opts.configError) return fact("failed", { ...base, enabled: false }, `config invalid — ${opts.configError} (nothing spawned)`);
  if (!opts.configPresent || !opts.config || opts.config.enabled === false) {
    return fact("not-evaluated", { ...base, enabled: false }, "disabled: loop.open_semantic_discovery section absent or enabled:false — nothing spawned");
  }
  const config = opts.config;

  // ② halt gates the SPAWN (model calls / pin materialisation), never the routine track.
  if (opts.halted) return fact("not-evaluated", { ...base, enabled: true }, "halted: open-semantic-discovery spawn suppressed (halt gates the spawn, not the routine track) — nothing spawned");

  // ③ the carrier must be readable BEFORE anything runs: the due basis is read FROM it, and an unreadable
  //    carrier is NEVER shaped like "0 previous rounds" (硬规则 3b).
  let carrierRounds: Record<string, unknown>[];
  try {
    carrierRounds = readCarrierRounds(carrier).records;
  } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable carrier — ${(e as Error).message} (nothing appended)`);
  }

  // ③a the effective interval: an expired `interval_until` reverts to the permanent default, re-derived
  //     EVERY round so a driver holding the old RoutineSpec in memory cannot keep a stale cadence alive.
  const declaredMinutes = typeof config.trigger.minutes === "number" ? config.trigger.minutes : DEFAULT_INTERVAL_MINUTES;
  const intervalReverted = config.intervalUntil !== null && started >= config.intervalUntil;
  const intervalMinutes = intervalReverted ? DEFAULT_INTERVAL_MINUTES : declaredMinutes;
  const intervalUntilIso = config.intervalUntil === null ? null : new Date(config.intervalUntil).toISOString();
  const revertedNote = intervalReverted
    ? ` (the temporary interval_until ${intervalUntilIso} has passed ⇒ the ${DEFAULT_INTERVAL_MINUTES}m default applies)`
    : "";
  const intervalInfo = { minutes: intervalMinutes, declared_minutes: declaredMinutes, reverted: intervalReverted, until: intervalUntilIso };

  // ③b the due basis: when PRODUCTION last really ran. Preferred = the newest `invoked_by:"resident-driver"`
  //     scan-round on the carrier; fallback = a RESIDENT-STAMPED last-run entry. An unstamped legacy entry
  //     grants no window (it cannot say who wrote it) and is recorded as ignored, never edited.
  let residentTs: number | null = null;
  try {
    residentTs = latestResidentRoundTs(carrierRounds);
  } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable due basis — ${(e as Error).message} (nothing appended)`);
  }
  const lastRunMap = readLastRunMap(lastRunPath) as Record<string, unknown>;
  const lastRunValue = Number(lastRunMap[OPEN_SEMANTIC_DISCOVERY_NAME]);
  const lastRunUsable = Number.isFinite(lastRunValue) && lastRunValue > 0;
  let last: number | null;
  let dueSource: "carrier" | "last-run-stamped" | "none";
  let dueBasis: string;
  let legacyIgnored: number | null = null;
  if (residentTs !== null) {
    last = residentTs;
    dueSource = "carrier";
    dueBasis = `carrier: latest invoked_by:${INVOKED_BY_RESIDENT} scan-round at ${new Date(residentTs).toISOString()}`;
  } else if (isResidentStamped(lastRunMap, OPEN_SEMANTIC_DISCOVERY_NAME) && lastRunUsable) {
    last = lastRunValue;
    dueSource = "last-run-stamped";
    dueBasis = `routine-last-run.json: resident-stamped entry ${lastRunValue}`;
  } else {
    last = null;
    dueSource = "none";
    if (lastRunUsable) {
      legacyIgnored = lastRunValue;
      dueBasis = `routine-last-run.json holds ${lastRunValue}, but it carries no invoked_by:${INVOKED_BY_RESIDENT} stamp and the carrier has no resident-driver round, so it is a legacy/unattributed entry and is IGNORED for due-computation`;
    } else {
      dueBasis = `no invoked_by:${INVOKED_BY_RESIDENT} scan-round on the carrier and no usable routine-last-run.json entry`;
    }
  }
  const dueInfo = { source: dueSource, basis: dueBasis, last_resident_run: residentTs === null ? null : new Date(residentTs).toISOString(), legacy_ignored: legacyIgnored };
  const legacyNote = legacyIgnored === null ? "" : ` (the legacy .quay/routine-last-run.json entry ${legacyIgnored} was NOT written by the resident driver and is ignored for due-computation)`;

  const due = isDue({ kind: "interval", minutes: intervalMinutes }, { now: started, lastRun: last === null ? NaN : last });
  const forcedPastDue = !due && force;
  if (!due && !forcedPastDue) {
    const agoMin = last === null ? null : Math.round((started - last) / 60_000);
    return fact(
      "not-evaluated",
      { ...base, enabled: true, interval: intervalInfo, due: dueInfo, minutesSinceLastRun: agoMin },
      `not due: ${agoMin === null ? "never ran (should be due — check the clock)" : `ran ${agoMin}m ago`} within the ${intervalMinutes}m interval — nothing spawned${revertedNote}${legacyNote}${resident ? "" : " (manual round: `--force` runs one anyway; the interval is production's, and last-run stays put either way)"}`,
    );
  }

  // ③c the two 24h ceilings. The pre-round reading is an OPTIMIZATION and a REPORT — it lets a fully
  //     exhausted round refuse without even loading the engine — while the AUTHORITY is the reservation
  //     taken inside `reservingStep` before each spawn, which is what a concurrent second process cannot
  //     get past. Both ceilings are consulted here so a workspace at EITHER ceiling refuses before work.
  const budget: ModelBudget = openModelBudget({ root, cap: config.maxModelCallsPer24h, ledgerPath, lockPath, carrierPath: carrier, now });
  let callsUsage: BudgetUsage;
  let usdUsage: ReturnType<typeof usdBudgetUsage>;
  try {
    callsUsage = await budget.usage();
    usdUsage = usdBudgetUsage({ ledgerRecords: readLedgerRecords(ledgerPath).records, nowMs: now(), windowMs: budget.windowMs, perCallCeiling: PER_CALL_USD_CEILING });
  } catch (e) {
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `unreadable 24h budget — ${(e as Error).message} (nothing appended)`);
  }
  const countBudgetBlock = { cap: config.maxModelCallsPer24h, used: callsUsage.total, reservations: callsUsage.reservations, legacy_model_calls: callsUsage.legacy_model_calls, window_ms: budget.windowMs };
  const usdBudgetBlock = { cap: config.maxUsdPer24h, used: usdUsage.usd, priced: usdUsage.priced, estimated: usdUsage.estimated, per_call_ceiling: PER_CALL_USD_CEILING, window_ms: budget.windowMs };
  if (callsUsage.total >= config.maxModelCallsPer24h) {
    return fact(
      "not-evaluated",
      { ...base, enabled: true, interval: intervalInfo, due: dueInfo, budget_24h: countBudgetBlock, budget_usd_24h: usdBudgetBlock },
      `budget-24h: ${callsUsage.total} model call(s) in the trailing 24h >= max_model_calls_per_24h ${config.maxModelCallsPer24h} — nothing spawned (the routine is held back by its declared ceiling, not idle)${revertedNote}${legacyNote}`,
    );
  }
  if (usdUsage.usd >= config.maxUsdPer24h) {
    return fact(
      "not-evaluated",
      { ...base, enabled: true, interval: intervalInfo, due: dueInfo, budget_24h: countBudgetBlock, budget_usd_24h: usdBudgetBlock },
      `budget-usd-24h: $${usdUsage.usd} in the trailing 24h >= max_usd_per_24h $${config.maxUsdPer24h} (${usdUsage.priced} priced, ${usdUsage.estimated} at the $${PER_CALL_USD_CEILING} per-call ceiling) — nothing spawned${revertedNote}${legacyNote}`,
    );
  }

  // ④ the engine modules, resolved from DISK (never a static import: see the header). A resolution failure
  //    is this round's `failed`, named — never a silent zero.
  let modules: OpenDiscoveryModules;
  try {
    modules = opts.modules ?? (await loadOpenDiscoveryModules(root));
  } catch (e) {
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `engine modules unresolved — ${(e as Error).message} (nothing appended, last-run not advanced)`);
  }
  const hyp = modules.hyp;
  const launch = opts.launchArgvFn ?? (launchArgv as unknown as (role: string, prompt: string, root: string, opts?: Record<string, unknown>) => string[]);
  const spawn = opts.spawnFn ?? spawnModelCall;
  const buildArgv = (prompt: string, r: string, o: { tools: string; maxTurns: number | null; outputFormat: string | null; model: string | null }): string[] =>
    hyp.hardenedArgv(launch, prompt, r, o as Record<string, unknown>);
  const breached = () => now() - started >= config.maxWallMs;

  // ⑤ (a) pin the current develop tip into a STRIPPED tree, then build the inventory over the declared
  //    scope. BOTH are recorded; NEITHER is a gate. See step ⑥ for why.
  const rev = (opts.revFn ?? developTip)(root);
  const pinTmp = opts.pinTmpRoot ?? process.env[PIN_TMP_ENV] ?? os.tmpdir();
  const pinDir = fs.mkdtempSync(path.join(pinTmp, `osd-pin-${rev.slice(0, 8)}-`));
  const pinFn = opts.pinFn ?? ((o: { root: string; rev: string; dir: string }): PinResult =>
    materializeStrippedPin({ ...o, forbiddenDirs: hyp.PIN_FORBIDDEN_DIRS, stripCheck: (d) => hyp.verifyCwdRefusal(d, d) }));
  const pin = pinFn({ root, rev, dir: pinDir });
  if (!pin.ok) {
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `pin refused — ${pin.reason} (nothing appended, last-run not advanced)`);
  }
  const pinned = pin.dir;
  // The inventory is an OPTIONAL MAP. Its construction is best-effort ON PURPOSE: an empty, missing or
  // unbuildable inventory is recorded as such and the semantic round runs anyway (硬规则: a mechanical
  // input must never be the thing that decides whether the model may look).
  const inventory: Record<string, unknown> = (() => {
    try {
      const scriptsDir = path.join(pinned, INVENTORY_SCOPE_REL);
      const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".ts"));
      if (files.length === 0) return { ok: true, entries: 0, text: "", unavailable: "NO_FILES_IN_SCOPE" };
      let catalog = "";
      try {
        catalog = execFileSync("bash", [path.join(scriptsDir, "capability-catalog.sh")], { cwd: pinned, encoding: "utf8", maxBuffer: 1 << 26 });
      } catch { /* a catalog that cannot be built leaves the inventory's `q` fields empty; it is not fatal */ }
      const built = hyp.buildInventory({
        files,
        readSource: (f: string) => fs.readFileSync(path.join(scriptsDir, f), "utf8"),
        catalog,
        scope: INVENTORY_SCOPE_REL,
      });
      return { ok: true, entries: Array.isArray(built.entries) ? built.entries.length : 0, text: String(built.text ?? ""), sha256: built.sha256 ?? null, unavailable: null };
    } catch (e) {
      return { ok: false, entries: 0, text: "", unavailable: `INVENTORY_UNAVAILABLE:${(e as Error).message}` };
    }
  })();
  if (breached()) {
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} after the pin (nothing appended, last-run not advanced)`);
  }

  // ── the reserving step seam ────────────────────────────────────────────────────────────────────────
  // Every subprocess goes: reserve (durable, atomic, BEFORE the spawn) → build argv → spawn → record the
  // outcome and the realized price. A refusal THROWS, so a step cannot spend a call the ledger did not
  // grant; a failure/timeout still records an outcome, so the call stays counted.
  const grantedIds: string[] = [];
  const callRecords: Record<string, unknown>[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let costUsd = 0;

  async function reservingStep(kind: ModelStepKind, payload: { prompt: string; tools: string; maxTurns: number; model: string | null }): Promise<Record<string, unknown>> {
    const r = await budget.reserve({ step: kind, tools: payload.tools, max_turns: payload.maxTurns });
    if (!r.ok) throw new BudgetRefusedError(r.used, r.cap, kind);
    grantedIds.push(r.id);
    const { argv, maxTurns, tools } = stepArgv(buildArgv, payload.prompt, root, { tools: payload.tools, maxTurns: payload.maxTurns, model: payload.model });
    let res: { status: number | null; stdout: string; stderr: string; error: Error | null };
    try {
      res = await spawn(argv, { cwd: pinned, timeoutMs: Math.max(1_000, config.maxWallMs), stdinData: payload.prompt });
    } catch (e) {
      budget.outcome(r.id, classifyModelFailure(e), null, `CALL_THREW:${(e as Error)?.name ?? "Error"}`);
      throw e;
    }
    const { turns } = readRealizedTurns(res?.stdout, (s: string) => hyp.parseVerifierStream(s));
    budget.outcome(r.id, res.error ? classifyModelFailure(res.error) : "completed", turns, res.error ? "SPAWN_ERROR" : null);
    // The realized price: the gateway rate applied to the stream's own usage when BOTH are readable, else
    // NULL — and NULL counts as the per-call ceiling in `usdBudgetUsage`, never as free.
    const stream = hyp.parseVerifierStream(String(res?.stdout ?? ""));
    const usage = stream.ok && stream.usage && typeof stream.usage === "object" ? (stream.usage as Record<string, unknown>) : null;
    const servedModel = stream.ok && typeof stream.model === "string" && stream.model !== "" ? stream.model : null;
    let realized: number | null = null;
    let costSource = "per-call-ceiling";
    if (usage !== null && servedModel !== null) {
      const rates = modules.portfolio.loadGatewayRates({ modelGroup: servedModel });
      if (rates.ok) {
        const derived = modules.portfolio.deriveCost({
          model_group: servedModel,
          model_calls: 1,
          input_tokens: Number(usage.input_tokens ?? 0),
          output_tokens: Number(usage.output_tokens ?? 0),
          cache_read_tokens: Number(usage.cache_read_input_tokens ?? 0),
          cache_creation_tokens: Number(usage.cache_creation_input_tokens ?? 0),
        }, rates.rates);
        if (derived.ok && derived.cost && typeof derived.cost.usd_gateway === "number") {
          realized = derived.cost.usd_gateway as number;
          costSource = "gateway-rates";
        }
      }
    }
    appendLedgerRecords(ledgerPath, [{ kind: "cost", id: r.id, ts: new Date(now()).toISOString(), pid: process.pid, step: kind, cost_usd: realized, cost_source: costSource, model: servedModel }]);
    const charged = realized === null ? PER_CALL_USD_CEILING : realized;
    costUsd += charged;
    tokensIn += Number(usage?.input_tokens ?? 0);
    tokensOut += Number(usage?.output_tokens ?? 0);
    const rec = {
      step: kind, tools, max_turns: maxTurns, argv_tools_index: argv.indexOf("--tools"), cwd: asRel(root, pinned),
      exit: res?.status ?? null, spawn_error: res?.error ? String(res.error.message ?? res.error).slice(0, 200) : null,
      turns, actual_model: servedModel ?? "not-evaluated:model-unverified",
      tokens: { input: Number(usage?.input_tokens ?? 0), output: Number(usage?.output_tokens ?? 0) },
      cost_usd: realized, cost_source: costSource, cost_charged_usd: charged,
    };
    callRecords.push(rec);
    return { res, stream, argv, rec };
  }

  // ⑥ (b) SEMANTIC EXPLORATION ON REAL SOURCE. The investigator runs with Read/Grep/Glob rooted at the
  //    pinned tree and an explicit `--max-turns`, so it reads code and context itself. The inventory is
  //    passed as an optional map — appended to the prompt, never used to select or reject anything.
  const focuses = priorFocuses(carrierRounds);
  // The model the LAUNCHER was asked for, read off a throwaway argv built the same way a real call's is —
  // `launchArgv` bakes the resolved `--model` in, so this is the requested identity rather than a guess
  // copied from the stream (which is the ACTUAL one and is read per call).
  const requestedModel = (() => {
    try {
      const probe = buildArgv("", root, { tools: "", maxTurns: BLIND_INVESTIGATOR_MAX_TURNS, outputFormat: null, model: null });
      const i = probe.indexOf("--model");
      return i >= 0 && typeof probe[i + 1] === "string" ? probe[i + 1] : null;
    } catch { return null; }
  })();
  const investigatorTexts: string[] = [];
  let midRound: { kind: ModelStepKind; used: number; cap: number } | null = null;
  let investigatorBlock: Record<string, unknown> = { ran: false };
  let clusters: Array<Record<string, unknown>> = [];
  try {
    let verifierPromptText = "";
    try {
      verifierPromptText = fs.readFileSync(hyp.defaultVerifierPrompt(), "utf8");
    } catch (e) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `verifier prompt unreadable — ${(e as Error).message} (nothing appended, last-run not advanced)`);
    }
    // The FROZEN investigator prompt (the hypothesis-generation instruction). Its own file stays
    // byte-identical — this routine PREPENDS a focus directive to it rather than editing it.
    const basePrompt = fs.readFileSync(hyp.defaultInvestigatorPrompt(), "utf8");
    const prompt = `${focusDirective(focuses)}\n${basePrompt}\n\n${inventory.ok === true ? String(inventory.text ?? "") : ""}`;
    const inv = await hyp.runInvestigator({
      prompt,
      // `neutralDir` is unused on the pinned path (the cwd gate switches to `verifyCwdRefusal`); it is
      // passed equal to the pin so BOTH gates agree on which tree this is.
      neutralDir: pinned,
      cwd: pinned,
      pinDir: pinned,
      runs: config.investigatorRuns,
      outDir: path.join(pinned, ".open-semantic-discovery-runs"),
      writeFile: (f: string, t: string) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t, "utf8"); },
      budget: { maxRuns: config.investigatorRuns, maxMs: config.maxWallMs },
      model: requestedModel ?? "not-evaluated:model-unverified",
      tools: INVESTIGATOR_TOOLS,
      maxTurns: config.investigatorMaxTurns,
      runModel: async (p: string) => {
        const { res } = await reservingStep("investigator", { prompt: p, tools: INVESTIGATOR_TOOLS, maxTurns: config.investigatorMaxTurns, model: requestedModel });
        investigatorTexts.push(hyp.callText(String(res?.stdout ?? "")));
        return res;
      },
    });
    if (inv.ok !== true) {
      const reasons = Array.isArray(inv.reasons) ? (inv.reasons as string[]) : [];
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `investigator refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
    }
    const records = Array.isArray(inv.records) ? (inv.records as Record<string, unknown>[]) : [];
    const statedFocus = investigatorTexts.map((t) => focusFromText(t)).find((f) => typeof f === "string" && f !== "") ?? null;
    investigatorBlock = {
      ran: true, runs: config.investigatorRuns, runs_with_hypotheses: Number(inv.parsed ?? 0),
      tools: INVESTIGATOR_TOOLS, max_turns: config.investigatorMaxTurns, cwd: asRel(root, pinned),
      stated_focus: statedFocus, prior_focuses: focuses,
    };
    // (b, cont.) `clusterHypotheses` merges near-duplicates ACROSS the runs by component-set overlap. It
    // is dedup ASSISTANCE ONLY — nothing here discards a cluster by shape, and the cap below is a COUNT.
    clusters = hyp.clusterHypotheses(records, {});
    if (breached()) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo, pin: { rev, dir: asRel(root, pinned) }, inventory, investigator: investigatorBlock }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} after the investigator (nothing appended, last-run not advanced)`);
    }

    // ⑦ (c) VERIFY at most K clusters, with Read,Grep on the pin and an explicit turn budget.
    let verification: Record<string, unknown> = { verified: 0, results: [] };
    if (clusters.length > 0) {
      const v = await hyp.runVerifier({
        clusters, pinDir: pinned, cwd: pinned, promptTemplate: verifierPromptText,
        maxClusters: config.maxClustersVerified, concurrency: 1, maxMs: config.maxWallMs,
        strategy: "default", onlyCluster: null, evidence: null, model: requestedModel,
        runModel: async (p: string) => {
          const { res } = await reservingStep("verifier", { prompt: p, tools: VERIFIER_TOOLS, maxTurns: config.verifierMaxTurns, model: requestedModel });
          return res;
        },
      });
      if (v.ok !== true) {
        const reasons = Array.isArray(v.reasons) ? (v.reasons as string[]) : [];
        return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `verifier refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
      }
      verification = v;
    }
    const verifiedRows = Array.isArray(verification.results) ? (verification.results as Record<string, unknown>[]) : [];

    // ⑧ (d) INDEPENDENT REFUTATION. Each `supported` cluster gets a SEPARATE fresh-context call whose ONLY
    //    input is the claim and the components — it never sees the first verifier's reasoning. A cluster is
    //    reported `confirmed` ONLY if it survives.
    const clusterRecords: Record<string, unknown>[] = [];
    for (const row of verifiedRows) {
      const idx = Number(row.cluster ?? 0);
      const cluster = clusters[idx - 1] ?? null;
      const rep = (cluster?.rep ?? {}) as Record<string, unknown>;
      const entry: Record<string, unknown> = {
        kind: "cluster",
        routine: OPEN_SEMANTIC_DISCOVERY_NAME,
        invoked_by: invokedBy,
        ts: new Date(now()).toISOString(),
        cluster: idx,
        members: row.members ?? cluster?.members ?? [],
        concept_kind: rep.concept_kind ?? null,
        claim: rep.claim ?? row.claim ?? null,
        components: rep.components ?? [],
        verifier_verdict: row.verdict ?? null,
        verifier_cause: row.verdict_cause ?? null,
        evidence_lines: Array.isArray(row.evidence) ? row.evidence : [],
        actual_model: row.actual_model ?? null,
        turns: row.turns_used ?? null,
        cost_usd: row.cost_usd ?? null,
      };
      let refutation: Record<string, unknown> | null = null;
      if (row.verdict === "supported") {
        const one = await hyp.runVerifier({
          clusters: [cluster], pinDir: pinned, cwd: pinned, promptTemplate: REFUTATION_PROMPT_TEMPLATE,
          maxClusters: 1, concurrency: 1, maxMs: config.maxWallMs, strategy: "default", onlyCluster: 1,
          evidence: null, model: requestedModel,
          runModel: async (p: string) => {
            const { res } = await reservingStep("refuter", { prompt: p, tools: REFUTER_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel });
            return res;
          },
        });
        if (one.ok !== true) {
          const reasons = Array.isArray(one.reasons) ? (one.reasons as string[]) : [];
          return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `refuter refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
        }
        refutation = (Array.isArray(one.results) ? one.results[0] : null) as Record<string, unknown> | null;
        entry.refutation_verdict = refutation?.verdict ?? null;
        entry.refutation_counterexample = refutation?.counterexample ?? null;
        entry.refutation_turns = refutation?.turns_used ?? null;
        entry.refutation_cost_usd = refutation?.cost_usd ?? null;
      } else {
        entry.refutation_verdict = "not-run";
      }
      // `confirmed` REQUIRES surviving the refuter: an unrun, undetermined or refuted refutation is NOT a
      // confirmation (fail-closed — "we could not refute it" is not "it is true").
      const confirmed = row.verdict === "supported" && refutation?.verdict === "supported";
      entry.confirmed = confirmed;
      // ⑨ (d2) SEMANTIC VALUE ASSESSMENT — bounded, for confirmed clusters only, recorded as the MODEL's
      //    assessment and never as a human rating.
      if (confirmed) {
        const one = await hyp.runVerifier({
          clusters: [cluster], pinDir: pinned, cwd: pinned, promptTemplate: VALUE_PROMPT_TEMPLATE,
          maxClusters: 1, concurrency: 1, maxMs: config.maxWallMs, strategy: "default", onlyCluster: 1,
          evidence: null, model: requestedModel,
          runModel: async (p: string) => {
            const { res } = await reservingStep("value-assessment", { prompt: p, tools: VALUE_TOOLS, maxTurns: config.refutationMaxTurns, model: requestedModel });
            return res;
          },
        });
        if (one.ok !== true) {
          const reasons = Array.isArray(one.reasons) ? (one.reasons as string[]) : [];
          return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `value assessment refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
        }
        const va = (Array.isArray(one.results) ? one.results[0] : null) as Record<string, unknown> | null;
        // The mapping is explicit because the shared verifier row is what parses the JSON: the template
        // asks for `intentional_difference_found` = impact, `evidence` = evidence, `counterexample` = fix
        // outline. Recording it under a name that says what it IS keeps it from reading as a human rating.
        entry.model_value_assessment = {
          impact: va?.intentional ?? null,
          evidence: va?.evidence ?? [],
          fix_outline: va?.counterexample ?? null,
          summary: va?.summary ?? null,
          turns: va?.turns_used ?? null,
          cost_usd: va?.cost_usd ?? null,
          assessed_by: "model",
        };
      }
      clusterRecords.push(entry);
      if (breached()) {
        return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo, investigator: investigatorBlock }, `budget breach — wall ${now() - started}ms >= max_wall_ms ${config.maxWallMs} during verification (nothing appended, last-run not advanced)`);
      }
    }

    // ⑩ the round's ONE scan-round line + its per-cluster records, appended together.
    const wallMs = now() - started;
    const confirmedClusters = clusterRecords.filter((c) => c.confirmed === true);
    const round: Record<string, unknown> = {
      kind: "scan-round",
      routine: OPEN_SEMANTIC_DISCOVERY_NAME,
      invoked_by: invokedBy,
      ts: new Date(now()).toISOString(),
      interval: intervalInfo,
      due: dueInfo,
      pin: { rev, dir: asRel(root, pinned) },
      inventory: { ok: inventory.ok, entries: inventory.entries, unavailable: inventory.unavailable, scope: INVENTORY_SCOPE_REL },
      focus: { chosen: investigatorBlock.stated_focus ?? null, prior_focuses: focuses },
      investigator: investigatorBlock,
      clusters: { total: clusters.length, verified: verifiedRows.length, beyond_cap: Math.max(0, clusters.length - verifiedRows.length) },
      confirmed: { count: confirmedClusters.length, claims: confirmedClusters.map((c) => c.claim) },
      // ⛔ This block's PRESENCE is what tells the call-budget reader that this line's calls are already
      // counted ONE FOR ONE by the reservation ledger (so the legacy carrier term must skip it).
      reservations: {
        cap: config.maxModelCallsPer24h,
        used_at_start: callsUsage.total,
        granted: budget.grantedCount,
        refused: budget.refusedCount,
        mid_round_refusal: midRound,
        usd_cap: config.maxUsdPer24h,
        usd_used_at_start: usdUsage.usd,
        ledger: asRel(root, ledgerPath),
      },
      budget_24h: countBudgetBlock,
      budget_usd_24h: usdBudgetBlock,
      wall_ms: wallMs,
      model_calls: budget.grantedCount,
      calls: callRecords,
      tokens: { input: tokensIn, output: tokensOut },
      cost_usd: round6(costUsd),
    };
    appendCarrierRecords(carrier, [round, ...clusterRecords]);
    // ⑪ ⛔ THE SPLIT: only a RESIDENT round advances the production window, and only when nothing was cut
    //    short mid-round (a round that ran out of ceiling part-way must not consume the interval).
    if (resident && midRound === null) writeLastRunStamped(lastRunPath, OPEN_SEMANTIC_DISCOVERY_NAME, now(), invokedBy);

    if (midRound !== null) {
      return fact("not-evaluated", round, `budget: the ${midRound.kind} step was refused by the 24h ceiling (${midRound.used} >= cap ${midRound.cap}) — ${budget.grantedCount} call(s) were already made and stay RESERVED; the round persisted what it did but did NOT advance the production last-run${revertedNote}${legacyNote}`);
    }
    return fact(
      "verified",
      round,
      `round ran (invoked_by:${invokedBy}, interval ${intervalMinutes}m): investigator read the pin with ${INVESTIGATOR_TOOLS} (focus: ${investigatorBlock.stated_focus ?? "<not stated>"}), ${clusters.length} cluster(s) from ${investigatorBlock.runs_with_hypotheses} run(s), ${verifiedRows.length} verified, ${confirmedClusters.length} CONFIRMED after independent refutation, ${budget.grantedCount} model call(s) costing $${round6(costUsd)}, wall ${wallMs}ms; appended 1 scan-round + ${clusterRecords.length} cluster record(s) to ${asRel(root, carrier)}${resident ? " and advanced the production last-run" : " — MANUAL: the production last-run was NOT advanced"}${revertedNote}${legacyNote}`,
    );
  } catch (e) {
    if (isBudgetRefused(e)) {
      // A MID-ROUND refusal: calls were already made and the ledger holds them, so the round persists what
      // it did — but it must NOT consume the window, so the last-run is left alone.
      midRound = { kind: e.step as ModelStepKind, used: e.used, cap: e.cap };
      const round: Record<string, unknown> = {
        kind: "scan-round", routine: OPEN_SEMANTIC_DISCOVERY_NAME, invoked_by: invokedBy, ts: new Date(now()).toISOString(),
        interval: intervalInfo, due: dueInfo, pin: { rev, dir: asRel(root, pinned) }, inventory: { ok: inventory.ok, entries: inventory.entries, unavailable: inventory.unavailable },
        investigator: investigatorBlock, reservations: { cap: config.maxModelCallsPer24h, used_at_start: callsUsage.total, granted: budget.grantedCount, refused: budget.refusedCount, mid_round_refusal: midRound, ledger: asRel(root, ledgerPath) },
        budget_24h: countBudgetBlock, budget_usd_24h: usdBudgetBlock, wall_ms: now() - started, model_calls: budget.grantedCount, calls: callRecords,
        tokens: { input: tokensIn, output: tokensOut }, cost_usd: round6(costUsd),
      };
      appendCarrierRecords(carrier, [round]);
      return fact("not-evaluated", round, `budget-24h: the ${midRound.kind} step was refused by the 24h ceiling (${midRound.used} reservation(s) >= cap ${midRound.cap}) — ${budget.grantedCount} call(s) were already made and stay RESERVED; the round persisted what it did (1 scan-round line) but did NOT advance the production last-run${revertedNote}${legacyNote}`);
    }
    if (e instanceof BudgetLockError) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `budget lock unavailable — ${e.message} (nothing appended, last-run not advanced)`);
    }
    return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `round threw — ${(e as Error)?.message ?? String(e)} (nothing appended, last-run not advanced)`);
  }
}

// ── RoutineSpec factories ────────────────────────────────────────────────────────────────────────────
export interface OpenSemanticDiscoveryRoutineOptions
  extends Omit<OpenSemanticDiscoveryRunOptions, "config" | "configPresent" | "configError" | "halted" | "invokedBy" | "force"> {}

/** Build the Layer-1b routine from an ALREADY-PARSED config read. ⛔ `invokedBy` and `force` are OMITTED,
 *  not merely defaulted: this factory IS the driver's routine table, so the round it builds is
 *  `resident-driver` by construction and cannot be talked out of it. A caller that wants a manual round
 *  calls `runOpenSemanticDiscovery` directly — the two paths must not be reachable by the same switch. */
export function buildOpenSemanticDiscoveryRoutine(root: string, read: OpenSemanticDiscoveryConfigRead, opts: OpenSemanticDiscoveryRoutineOptions = {}): RoutineSpec {
  const schedule = read.config?.trigger ?? { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES };
  return {
    name: OPEN_SEMANTIC_DISCOVERY_NAME,
    schedule,
    run: async (ctx) =>
      [await runOpenSemanticDiscovery(root, {
        ...opts,
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        halted: ctx?.halted === true,
        invokedBy: INVOKED_BY_RESIDENT,
      })],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws (an optional routine
 *  track must not take down the host driver's startup). `routine` is `null` when NO section is declared —
 *  "off by default" means the host driver does not even ADD a routine to its table. A section that IS
 *  declared (even `enabled:false`, even malformed) yields a routine, because the declaration must be
 *  OBSERVABLE (硬规则 3b/9: "declared but not driven" and "not declared" must not look the same). */
export function openSemanticDiscoveryRoutineFromConfig(
  root: string,
  opts: OpenSemanticDiscoveryRoutineOptions = {},
  readIn?: OpenSemanticDiscoveryConfigRead,
): {
  routine: RoutineSpec | null;
  error: string | null;
  present: boolean;
  enabled: boolean;
  intervalMinutes: number | null;
  intervalUntil: number | null;
  maxModelCallsPer24h: number | null;
  maxUsdPer24h: number | null;
  investigatorRuns: number | null;
  maxClustersVerified: number | null;
  verifierMaxTurns: number | null;
  refutationMaxTurns: number | null;
} {
  const read = readIn ?? readOpenSemanticDiscoveryConfig(root);
  const cfg = read.config;
  return {
    routine: read.present ? buildOpenSemanticDiscoveryRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: cfg?.enabled === true,
    intervalMinutes: cfg && typeof cfg.trigger.minutes === "number" ? cfg.trigger.minutes : null,
    intervalUntil: cfg ? cfg.intervalUntil : null,
    maxModelCallsPer24h: cfg ? cfg.maxModelCallsPer24h : null,
    maxUsdPer24h: cfg ? cfg.maxUsdPer24h : null,
    investigatorRuns: cfg ? cfg.investigatorRuns : null,
    maxClustersVerified: cfg ? cfg.maxClustersVerified : null,
    verifierMaxTurns: cfg ? cfg.verifierMaxTurns : null,
    refutationMaxTurns: cfg ? cfg.refutationMaxTurns : null,
  };
}

// ── CLI (a one-shot MANUAL round) ────────────────────────────────────────────────────────────────────
const USAGE = [
  "open-semantic-discovery-routine — open-ended semantic architecture discovery as a Layer-1b routine (report-only).",
  "  --once --root <dir> [--json]      run ONE MANUAL round against <dir> (invoked_by:\"manual\")",
  "  --force                           manual: run even inside the interval (still never advances",
  "                                    .quay/routine-last-run.json — production's clock is not yours)",
  "  --pin-tmp <dir>                   temp root for the stripped pins",
  "⛔ This CLI is ALWAYS a manual round: it reads the production interval but never advances it. The",
  "   resident round (the one that advances it) is assembled by the quality-gate driver's routine table.",
].join("\n");

async function main(argv: string[]): Promise<number> {
  const root = (() => { const i = argv.indexOf("--root"); return path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd()); })();
  const json = argv.includes("--json");
  const pinTmpRoot = (() => { const i = argv.indexOf("--pin-tmp"); return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : undefined; })();
  const read = readOpenSemanticDiscoveryConfig(root);
  const fact = await runOpenSemanticDiscovery(root, {
    config: read.config,
    configPresent: read.present,
    configError: read.error,
    halted: false,
    invokedBy: INVOKED_BY_MANUAL,
    force: argv.includes("--force"),
    pinTmpRoot,
  });
  process.stdout.write(json ? `${JSON.stringify({ root, fact }, null, 1)}\n` : `${fact.state}: ${fact.reason}\n`);
  return fact.state === "failed" ? 1 : 0;
}

if (isDirectEntry(import.meta, process.argv[1], "open-semantic-discovery-routine")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

export { USAGE };
