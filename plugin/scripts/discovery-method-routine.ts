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
//   IMPORTED from the modules that own them (loaded at RUNTIME — see `loadDiscoveryModules`; a static
//   specifier here would escape the shipped artifact and inline their entry guards into the drivers).
//   This file adds orchestration + a carrier line, nothing else.
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
// ⛔ WHO INVOKED THE ROUND — the manual/resident split (gap-discovery-method-routine-manual-run-advances-
// production-last-run). The durable due gate reads AND advances the PRODUCTION entry in
// `.quay/routine-last-run.json`, which is a SCHEDULING input — so a round run BY HAND (the `--once` CLI,
// a test, an acceptance check) must never be what moves production's clock. Observed defect: a `--once`
// acceptance run against the production root at 09:10:40Z wrote `discovery-method` into that map, and the
// resident driver's next round then reported «ran 36m ago within the 360m interval». Every round now
// records `invoked_by` on BOTH the carrier line and its Fact:
//   `"resident-driver"` — the round came through the driver's routine table (buildDiscoveryMethodRoutine)
//                         ⇒ it reads the production entry and ADVANCES it on success;
//   `"manual"`          — every other caller (the `--once` CLI, tests) ⇒ it still READS the production
//                         entry to answer its OWN due gate (a hand-run inside the window is a no-op
//                         unless `--force`), never writes to it, and stamps its carrier line so the
//                         carrier itself says who ran it.
// The default is `manual`: a caller that forgets to declare itself must not be able to move production's
// schedule (硬规则 3b — the two states must not be shaped alike). Manual rounds still ingest and reflect
// into the persistent Discovery carriers: that output is real data. What they must not change is WHEN
// production runs next.
//
// ⛔ A TEMPORARY FASTER CADENCE (gap-discovery-method-routine-interval-60m-temporary) — three rules,
// each closing a way a "temporary" change could quietly become a standing one:
//   ① PER-ROUTINE FLOOR. `MIN_INTERVAL_MINUTES = 60` for THIS routine (arch-discovery's own floor is a
//      separate constant in a separate file and is untouched). `DEFAULT_INTERVAL_MINUTES` stays 360 and
//      is now also the line below which a declaration must be TEMPORARY.
//   ② `interval_until: <ISO-8601>` is the expiry. While `now < interval_until` the configured interval
//      applies; from that instant the round reverts to the 360m default AND SAYS SO in its Fact. A
//      sub-360m interval declared WITHOUT `interval_until` is a config error (`failed`, zero spawns) —
//      so "60m became the permanent cadence" is not a state this config can reach by omission.
//   ③ `max_model_calls_per_24h` is REQUIRED whenever the interval is below 360m, and is enforced across
//      rounds from the trailing-24h `scan-round` lines; hitting it records `not-evaluated:budget-24h`
//      with zero spawns. A six-times-faster cadence needs a ceiling that spans rounds, not just the
//      per-round `max_model_calls`.
// ⛔ THE DUE BASIS (same task): production's window is read from WHEN PRODUCTION LAST REALLY RAN, not
//   from whatever happens to be in `.quay/routine-last-run.json`. Preferred source = the newest
//   `invoked_by:"resident-driver"` `scan-round` line on the carrier; fallback (only when the carrier has
//   none) = the last-run entry, and only if it carries the sibling stamp this routine now writes
//   (`"<name>@invoked_by"`). An UNSTAMPED legacy entry — like this workspace's 2026-10-12 09:10:40Z one,
//   written by a worker acceptance run — is recorded as IGNORED and grants no window; it is never
//   edited or deleted. Manual rounds still never write last-run (see above), and a manual round between
//   two resident rounds does not shift the resident due time (it is not read at all).
//
// ⛔ NOT a hot-path gate (the `gap-fan-in-remove-archguard-gate` lesson): nothing here is called by
// fan-in / scoped-gate / any per-task path. The only caller is the quality driver's routine table.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { isDue, parseTrigger } from "./routine-scheduler.ts";
import { type Fact, type RoutineSpec } from "./driver-runtime.ts";
// ⛔ `writeLastRun` is deliberately NOT imported: the resident advance must land the stamp in the SAME
// write as the timestamp, so this routine uses its own `writeLastRunStamped` (see that function).
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "./probe-routine.ts";
import { isDirectEntry } from "./gate-script-base.ts";
// ⛔ The Discovery Method loop (docs/analysis/discovery-{experience-ledger,reflection,method-registry}.mjs)
// is NEVER statically imported here — this file is SHIPPED, and a static `../../docs/analysis/*.mjs`
// specifier both escapes the built artifact and inlines those modules' own entry guards into the driver
// bundles. They are resolved from disk at runtime instead: see `loadDiscoveryModules` below.

/** The routine's name — one key in `.quay/routine-last-run.json` (shared with the probe/arch-discovery
 *  tracks; ⛔ names do not collide and the map is a per-name merge write). */
export const DISCOVERY_METHOD_NAME = "discovery-method";

/** The ONE carrier this routine appends to. Gitignored runtime state, declared in
 *  docs/carrier-registry.json — the same family as quality-round.jsonl / arch-discovery-findings.jsonl. */
export const CARRIER_REL = path.posix.join(".quay", "discovery-method-findings.jsonl");

/** Who invoked the round. `resident-driver` = the quality-gate driver's routine table (the PRODUCTION
 *  scheduler); `manual` = the `--once` CLI, a test, an acceptance check. Only a `resident-driver` round
 *  may advance the production entry in `.quay/routine-last-run.json` (see the header). */
export type InvokedBy = "resident-driver" | "manual";
export const INVOKED_BY_RESIDENT: InvokedBy = "resident-driver";
export const INVOKED_BY_MANUAL: InvokedBy = "manual";
/** The default: an undeclared caller is MANUAL, so forgetting the declaration cannot move production's
 *  schedule (the defect this task exists for was a manual run doing exactly that). */
export const INVOKED_BY_DEFAULT: InvokedBy = INVOKED_BY_MANUAL;

/** The interval floor. A round spends real model calls and materialises stripped pins (a whole-tree
 *  `git archive` each); a cadence shorter than an hour is refused rather than silently rounded up
 *  (the config error names the value). ⛔ The floor is PER-ROUTINE: arch-discovery has its own (60m,
 *  `arch-discovery-routine.ts`), and neither routine's floor moves the other's. */
export const MIN_INTERVAL_MINUTES = 60;
/** The PERMANENT interval, and the revert target of a temporary window. It is the default when the
 *  section declares no interval (only reachable while disabled — an enabled section must declare one)
 *  AND the cadence below which a declaration must be TEMPORARY (`interval_until`) to be accepted. */
export const DEFAULT_INTERVAL_MINUTES = 360;

/** The 24h window the cross-round model-call ceiling (`max_model_calls_per_24h`) counts over. The
 *  window is 24h because the KEY IS NAMED `..._per_24h` — the number is the declaration's own
 *  semantics, not a host-derived quantity (硬规则 4 推论二 is about literals that silently *replace* a
 *  host capability; this one defines the unit the operator wrote). */
export const BUDGET_24H_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MAX_EXPERIENCES = 8;
export const DEFAULT_MAX_MODEL_CALLS = 6;
export const DEFAULT_MAX_WALL_MS = 900_000;

/** The sibling key a RESIDENT round stamps next to its `routine-last-run.json` entry, so the entry
 *  itself says WHO wrote it. ⛔ Without it, "the resident driver ran" and "a worker acceptance run
 *  wrote this" are shaped the same (硬规则 3b) — which is exactly the state production was found in on
 *  2026-10-12 (see the header). The key is per-routine, so every routine can stamp its own entry. */
export const invokedByStampKey = (name: string): string => `${name}@invoked_by`;

/** Who may have written a `routine-last-run.json` entry, as the stamp records it. `resident-driver`
 *  is the only value that means "production really ran"; an entry with NO stamp is treated as not
 *  written by production at all (see `latestResidentRoundTs` / the round's due basis). */
export function isResidentStamped(map: Record<string, unknown>, name: string): boolean {
  return map[invokedByStampKey(name)] === INVOKED_BY_RESIDENT;
}

/** Env override for the temp root the stripped pins are materialised under (tests point it at their own
 *  scratch dir so a run cannot litter the shared `/tmp`; production leaves it unset). */
export const PIN_TMP_ENV = "QUAY_DISCOVERY_METHOD_PIN_TMP";

// ── config: `.quay/config.yml` `loop.discovery_method:` ─────────────────────────────────────────────
export interface DiscoveryMethodConfig {
  enabled: boolean;
  trigger: { kind: string; minutes?: number };
  /** Epoch-ms deadline of a TEMPORARY cadence. `null` = none declared, i.e. the configured interval is
   *  PERMANENT. At/after this instant the round reverts to `DEFAULT_INTERVAL_MINUTES` and says so in its
   *  Fact — so a faster cadence can only ever be a declared, expiring window (see the parse below). */
  intervalUntil: number | null;
  maxExperiences: number;
  maxModelCalls: number;
  maxWallMs: number;
  /** The cross-round ceiling on model calls over the trailing 24h. REQUIRED when `interval` is below
   *  `DEFAULT_INTERVAL_MINUTES`; `null` when not declared ⇒ the 24h gate does not apply. */
  maxModelCallsPer24h: number | null;
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
    intervalUntil: null,
    maxExperiences: DEFAULT_MAX_EXPERIENCES,
    maxModelCalls: DEFAULT_MAX_MODEL_CALLS,
    maxWallMs: DEFAULT_MAX_WALL_MS,
    maxModelCallsPer24h: null,
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

  // ⛔ THE TEMPORARY-CADENCE RULE (the whole reason a sub-360m interval is reachable at all): a cadence
  // below the PERMANENT default may only be declared together with the instant it expires. Without an
  // `interval_until` the declaration is refused outright, so "a faster cadence became the standing one"
  // is not a state this config can be left in by accident — the operator has to name the deadline, and
  // the round re-reads it every round (an expired window reverts to the 360m default and says so).
  let intervalUntil: number | null = null;
  if (rec.interval_until !== undefined && rec.interval_until !== null) {
    if (typeof rec.interval_until !== "string") {
      return { config: null, error: cfgBad(`'interval_until' must be an ISO-8601 string (got ${JSON.stringify(rec.interval_until)})`) };
    }
    const ms = Date.parse(rec.interval_until);
    if (!Number.isFinite(ms)) {
      return { config: null, error: cfgBad(`'interval_until' is not a parseable instant (got ${JSON.stringify(rec.interval_until)} — expected ISO-8601, e.g. 2026-10-19T12:00:00Z)`) };
    }
    intervalUntil = ms;
  }
  const temporary = trigger.minutes < DEFAULT_INTERVAL_MINUTES;
  if (temporary && intervalUntil === null) {
    return { config: null, error: cfgBad(`interval ${trigger.minutes}m is below the ${DEFAULT_INTERVAL_MINUTES}m default and no 'interval_until' is declared — a sub-${DEFAULT_INTERVAL_MINUTES}m cadence is TEMPORARY by declaration and must not be able to become permanent silently`) };
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

  // ⛔ REQUIRED FOR A TEMPORARY CADENCE, optional otherwise: an interval under the permanent default
  // buys rounds six times more often, so the per-round `max_model_calls` alone no longer bounds the
  // day. `0` is a legitimate value here for the same reason it is on the other two quotas (a
  // mechanical-only fast cadence is a coherent declaration); the gate is shape, not a made-up floor.
  const per24 = bound("max_model_calls_per_24h", 0, 0);
  if (per24.error) return { config: null, error: per24.error };
  const has24hCap = rec.max_model_calls_per_24h !== undefined && rec.max_model_calls_per_24h !== null;
  if (temporary && !has24hCap) {
    return { config: null, error: cfgBad(`'max_model_calls_per_24h' is REQUIRED when 'interval' is below the ${DEFAULT_INTERVAL_MINUTES}m default (interval ${trigger.minutes}m) — a faster cadence must declare its cross-round model-call ceiling`) };
  }

  return {
    config: {
      enabled: true,
      trigger,
      intervalUntil,
      maxExperiences: maxExperiences.value as number,
      maxModelCalls: maxModelCalls.value as number,
      maxWallMs: maxWallMs.value as number,
      maxModelCallsPer24h: has24hCap ? (per24.value as number) : null,
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

/** One instant off a carrier line: its `ts` (ISO-8601, the field every round writes). THROWS when a
 *  line this routine has to READ cannot supply one — a scheduling quantity that cannot be read must
 *  never be silently treated as "long ago" (硬规则 3b). */
function lineTs(rec: Record<string, unknown>, index: number): number {
  const ms = typeof rec.ts === "string" ? Date.parse(rec.ts) : NaN;
  if (!Number.isFinite(ms)) {
    throw new Error(`carrier line ${index + 1} (kind:${String(rec.kind ?? "<none>")}) has no parseable 'ts' (got ${JSON.stringify(rec.ts)}) — its instant cannot be read`);
  }
  return ms;
}

/** When PRODUCTION last really ran: the newest `scan-round` line on the carrier whose `invoked_by` is
 *  `resident-driver`. `null` = production never ran (⇒ due). ⛔ A line with no `invoked_by` at all is a
 *  LEGACY line — written before the stamp existed — and is deliberately NOT counted: it cannot say who
 *  ran it, and reading it as production is exactly the defect this basis removes (this workspace's
 *  legacy entries came from worker acceptance runs). An unreadable `ts` on a resident line THROWS —
 *  "cannot read when production ran" is not "production never ran". */
export function latestResidentRoundTs(records: readonly Record<string, unknown>[]): number | null {
  let latest: number | null = null;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.kind !== "scan-round" || rec.invoked_by !== INVOKED_BY_RESIDENT) continue;
    const ms = lineTs(rec, i);
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

/** Model calls spent in the trailing window, summed over the carrier's `scan-round` lines. Counts
 *  EVERY round in the window, manual ones included: the budget bounds MODEL CALLS, and a hand-run
 *  spends them exactly like a resident one (what a manual round must not do is move production's
 *  clock — a different thing, enforced separately). An in-window line whose `model_calls` cannot be
 *  read THROWS rather than counting as 0: a budget computed from a partially-readable history would
 *  report "under the ceiling" without having established it (硬规则 3b). */
export function modelCallsInWindow(records: readonly Record<string, unknown>[], nowMs: number, windowMs: number): number {
  let total = 0;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.kind !== "scan-round") continue;
    const spent = rec.model_calls;
    const ms = lineTs(rec, i);
    if (ms < nowMs - windowMs || ms > nowMs) continue; // outside the trailing window ⇒ not this budget's business
    if (typeof spent !== "number" || !Number.isFinite(spent) || spent < 0) {
      throw new Error(`carrier line ${i + 1} is a scan-round inside the trailing 24h whose 'model_calls' is not a non-negative number (got ${JSON.stringify(spent)}) — the 24h budget cannot be established from a partially-readable window`);
    }
    total += spent;
  }
  return total;
}

/** The merge write for the durable last-run map, WITH the caller stamp. ⛔ Local rather than
 *  `probe-routine.writeLastRun` because that helper writes exactly one key, and the stamp must land in
 *  the SAME write as the timestamp (two writes would leave a window in which the entry is fresh but
 *  unattributed — the unreadable state this stamp exists to remove). The serializer is deliberately
 *  the same `JSON.stringify(map, null, 1)` so every other routine's entry survives byte-for-byte. */
export function writeLastRunStamped(lastRunPath: string, name: string, ts: number, invokedBy: InvokedBy): void {
  const map = readLastRunMap(lastRunPath) as Record<string, unknown>;
  map[name] = ts;
  map[invokedByStampKey(name)] = invokedBy;
  fs.mkdirSync(path.dirname(lastRunPath), { recursive: true });
  fs.writeFileSync(lastRunPath, JSON.stringify(map, null, 1), "utf8");
}

// ── held-out cases: the pinned Experiences the verifier may read ────────────────────────────────────
/** The held-out pool: ledger Experiences that carry an `evaluation_pin`. The pin is what makes an
 *  Experience usable as a held-out case (`validateGeneralization` refuses `NO_EVALUATION_PIN` without
 *  one), so the filter is the engine's own precondition — not a second policy invented here. An
 *  unreadable ledger is its OWN value (`ok:false`), never "no held-out cases" (硬规则 3b). */
export async function readHeldOutCases(root: string, ledgerFn?: LedgerReadFn): Promise<HeldOutRead> {
  // The ledger reader is a SEAM: the round resolves it once from the engine modules it already loaded,
  // so a round that needs the pool never pays for a second resolution.
  const readLedger = ledgerFn ?? (await loadDiscoveryModules(root)).ledger.readExperienceLedger;
  const ledger = readLedger(root);
  if (!ledger.ok) {
    return {
      ok: false,
      cases: [],
      malformed_lines: ledger.malformed_lines,
      reason: ledger.file === null
        ? `LEDGER_UNRESOLVED:${String(ledger.reason ?? "no-shared-checkout")}`
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
/** The held-out pool reader. `HeldOutRead` on its own, or a promise — the DEFAULT is async (it resolves
 *  the ledger module first), and a test seam may stay synchronous. */
export type HeldOutFn = (root: string) => HeldOutRead | Promise<HeldOutRead>;
export type PinFn = (opts: { root: string; rev: string; dir: string }) => { ok: boolean; dir?: string; reason?: string };

// ── the engine modules: resolved from DISK at runtime, never statically imported ─────────────────────
// WHY (the defect this block exists for): this file is SHIPPED — publish-dist-branch stages `plugin/`
// as the artifact root and bundles `scripts/*.ts` with esbuild. A static `../../docs/analysis/*.mjs`
// specifier is resolved against THAT staged root, so it escapes the artifact and the build dies with
// `Could not resolve "../../docs/analysis/…"`. And even were it resolvable, esbuild would INLINE those
// modules — each carries its own `import.meta.url === pathToFileURL(process.argv[1])` entry guard, and
// an inlined guard HIJACKS the driver bundle's own main (packages/quay/test/build-plugin-dist.test.mjs
// AC1 covers exactly that). A specifier the bundler cannot see is the fix: resolve a path from disk,
// then `import()` its file URL.
//
// WHERE THEY ARE RESOLVED FROM: first the repo this FILE lives in (…/plugin/scripts → repo root), then
// the workspace `root`. Code belongs with the code — the engine lives in this repo's `docs/analysis`,
// not in the workspace being observed — and the workspace candidate is what lets a checkout whose
// script is somewhere else (a worktree running against the main checkout) or a workspace vendoring its
// own copy still run. Both candidates absent ⇒ the round is `failed` with a reason naming BOTH paths:
// "could not resolve the engine" must never be read as "no findings" (硬规则 3b).
export const DISCOVERY_MODULE_DIR_REL = path.posix.join("docs", "analysis");
export const LEDGER_MODULE_FILE = "discovery-experience-ledger.mjs";
export const REFLECTION_MODULE_FILE = "discovery-reflection.mjs";
export const REGISTRY_MODULE_FILE = "discovery-method-registry.mjs";

/** The repo this FILE lives in (…/plugin/scripts/<this> → repo root). Used only to BUILD a candidate
 *  path — nothing is resolved through it until the runtime `import()` above. */
export const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A carrier read, as the ledger module returns it (narrowed to the fields this file reads). */
export interface LedgerRead {
  ok: boolean;
  file: string | null;
  records: Record<string, unknown>[];
  malformed_lines: number;
  reason?: string;
}
export type LedgerReadFn = (root: string) => LedgerRead;

/** The held-out pool reading. `cases` is the pool; `ok:false` is "could not be read", which is its OWN
 *  value and never "the pool is empty" (硬规则 3b). */
export interface HeldOutRead { ok: boolean; cases: Record<string, unknown>[]; reason: string | null; malformed_lines: number }

/** The shapes this routine CALLS, declared here rather than reached through a type-position import of
 *  an out-of-artifact path (the same reason the whole block exists). The modules are the source of
 *  truth; this is the narrow interface this file consumes. */
export interface DiscoveryLedgerModule {
  ingestNewOutcomes: IngestFn;
  readExperienceLedger: LedgerReadFn;
}
export interface DiscoveryReflectionModule {
  runReflectionRound: ReflectFn;
  validateGeneralization: ValidateFn;
  validateEvaluationPin: (heldOutCase: Record<string, unknown>) => { ok: boolean; reasons: string[] };
  materializeStrippedPin: PinFn;
  gitIsAncestor: (root: string) => (ancestor: string, descendant: string) => boolean;
  liveModelFactory: (opts: { root: string; tools?: string; maxTurns?: number | null; timeoutMs?: number }) => Promise<Record<string, unknown>>;
  computeReflectionCost: (calls: readonly Record<string, unknown>[], opts?: { wall_ms?: number | null }) => Record<string, unknown>;
}
export interface DiscoveryRegistryModule {
  appendMethodRecord: (root: string, rec: Record<string, unknown>) => Record<string, unknown>;
  readMethodRegistry: (root: string, opts?: { history?: boolean }) => { history?: unknown[]; records?: unknown[]; malformed_lines?: number };
}
export interface DiscoveryModules {
  ledger: DiscoveryLedgerModule;
  reflection: DiscoveryReflectionModule;
  registry: DiscoveryRegistryModule;
}

/** One process-wide cache keyed by the RESOLVED path — two rounds (and two tests) that resolve the same
 *  file load it once. Node's own module cache would do this anyway; the map is what lets the resolver
 *  stay synchronous and cheap while the import stays lazy. */
const _engineModuleCache = new Map<string, unknown>();

/** Resolve one engine module to an absolute path. Returns the candidates it TRIED so the refusal can
 *  name them (an unresolvable engine is a `failed` round, not a silent zero). */
export function resolveEngineModule(root: string, file: string): { path: string | null; tried: string[] } {
  const tried = [
    path.join(SCRIPT_REPO_ROOT, DISCOVERY_MODULE_DIR_REL, file),
    path.join(root, DISCOVERY_MODULE_DIR_REL, file),
  ];
  for (const candidate of tried) {
    if (fs.existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}

/** Load the three engine modules, or THROW a refusal naming every module that could not be resolved and
 *  the candidate paths tried. Throwing (rather than returning a `{ok:false}` shape a caller might
 *  forget to check) is deliberate: every caller is a `??`-default inside the round, and the round
 *  converts the throw into its own `failed` reason. */
export async function loadDiscoveryModules(root: string): Promise<DiscoveryModules> {
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
  const ledger = await load(LEDGER_MODULE_FILE);
  const reflection = await load(REFLECTION_MODULE_FILE);
  const registry = await load(REGISTRY_MODULE_FILE);
  if (unresolved.length > 0 || ledger === null || reflection === null || registry === null) {
    throw new Error(`DISCOVERY_MODULES_UNRESOLVED — ${unresolved.join("; ") || "one or more engine modules did not load"}`);
  }
  return {
    ledger: ledger as DiscoveryLedgerModule,
    reflection: reflection as DiscoveryReflectionModule,
    registry: registry as DiscoveryRegistryModule,
  };
}


export interface DiscoveryMethodRunOptions {
  /** Parsed section (see readDiscoveryMethodConfig). */
  config: DiscoveryMethodConfig | null;
  /** Whether `loop.discovery_method:` exists at all. */
  configPresent: boolean;
  /** Fail-closed config reason (a present-but-bad section). */
  configError?: string | null;
  /** From the routine ctx: halt gates the spawn, never the routine track. */
  halted: boolean;
  /** WHO invoked this round (see the header). Defaults to `manual` — an undeclared caller never advances
   *  the production last-run. `buildDiscoveryMethodRoutine` declares `resident-driver` for the driver's
   *  routine table; the `--once` CLI declares `manual`. */
  invokedBy?: InvokedBy;
  /** Ignore the durable due gate and run anyway (the CLI's `--force`). ⛔ It bypasses the GATE only: it
   *  never changes what the round may WRITE, so a forced manual round still does not advance the
   *  production last-run (forcing past the window must not consume the window). The driver never sets
   *  it — the resident round's cadence is the driver's schedule and nothing else. */
  force?: boolean;
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
 *  (bounded) generalize → append ONE `scan-round` line → advance last-run (⛔ RESIDENT ROUNDS ONLY —
 *  see `invokedBy`). Never throws (the loop records a `failed` Fact): every refused/failed path returns
 *  BEFORE the append. */
export async function runDiscoveryMethod(root: string, opts: DiscoveryMethodRunOptions): Promise<Fact> {
  const now = opts.now ?? Date.now;
  const carrier = opts.carrierPath ?? path.join(root, CARRIER_REL);
  const lastRunPath = opts.lastRunPath ?? path.join(root, ROUTINE_LAST_RUN_REL);
  const invokedBy: InvokedBy = opts.invokedBy ?? INVOKED_BY_DEFAULT;
  const resident = invokedBy === INVOKED_BY_RESIDENT;
  const force = opts.force === true;
  const base = { routine: DISCOVERY_METHOD_NAME, invoked_by: invokedBy, carrier: asRel(root, carrier), fired: false };
  const fact = (state: Fact["state"], value: Record<string, unknown>, reason: string): Fact => ({ name: DISCOVERY_METHOD_NAME, value, state, reason });

  const started = now();

  /** The engine modules could not be resolved/loaded — the round's OWN `failed` reason, naming the
   *  step and the candidate paths. Never a silent zero (硬规则 3b). */
  const engineRefusal = (e: unknown, step: string): Fact =>
    fact("failed", { ...base, enabled: true }, `engine modules unresolved at ${step} — ${(e as Error).message} (nothing appended, last-run not advanced)`);

  // ① config: a bad section is `failed` (fail-closed), an absent/disabled one is `not-evaluated`.
  if (opts.configError) return fact("failed", base, `config invalid — ${opts.configError} (nothing spawned)`);
  if (!opts.configPresent || !opts.config || opts.config.enabled === false) {
    return fact("not-evaluated", { ...base, enabled: false }, "disabled: loop.discovery_method section absent or enabled:false — nothing spawned");
  }
  const config = opts.config;

  // ② halt: the round's gate. It gates the SPAWN (model calls / pin materialisation), not the routine
  //    track — observation continues.
  if (opts.halted) return fact("not-evaluated", { ...base, enabled: true }, "halted: discovery-method spawn suppressed (halt gates the spawn, not the routine track) — nothing spawned");

  // ③ the carrier must be readable BEFORE anything runs — the due basis (below) is READ FROM IT, and an
  //    unreadable carrier is NEVER shaped like "0 previous rounds" (硬规则 3b).
  let carrierRounds: Record<string, unknown>[];
  try {
    carrierRounds = readCarrierRounds(carrier).records;
  } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable carrier — ${(e as Error).message} (nothing appended)`);
  }

  // ③a THE EFFECTIVE INTERVAL. A declared `interval_until` is a TEMPORARY window: while `now` is before
  //     it the declared (possibly sub-360m) cadence applies, and from that instant on the round falls
  //     back to the permanent default. The revert is re-derived EVERY round from the parsed config, so
  //     an expired window cannot keep driving production merely because the driver still holds the old
  //     RoutineSpec in memory.
  const declaredMinutes = typeof config.trigger.minutes === "number" ? config.trigger.minutes : DEFAULT_INTERVAL_MINUTES;
  const intervalReverted = config.intervalUntil !== null && started >= config.intervalUntil;
  const intervalMinutes = intervalReverted ? DEFAULT_INTERVAL_MINUTES : declaredMinutes;
  const intervalUntilIso = config.intervalUntil === null ? null : new Date(config.intervalUntil).toISOString();
  const revertedNote = intervalReverted
    ? ` (the temporary interval_until ${intervalUntilIso} has passed ⇒ the ${DEFAULT_INTERVAL_MINUTES}m default applies)`
    : "";

  // ③b THE DUE BASIS — "when did PRODUCTION last really run". Preferred: the newest resident-driver
  //     `scan-round` line on the carrier. Fallback (only when the carrier has none): the durable entry
  //     in `.quay/routine-last-run.json`, and ONLY if it carries this routine's resident stamp. ⛔ A
  //     legacy entry with no stamp is *recorded as ignored* and grants no window: this workspace's
  //     `discovery-method` entry was written by a worker acceptance run and would otherwise hold
  //     production's clock for six hours. The entry is never edited or deleted — only not believed.
  let residentTs: number | null = null;
  try {
    residentTs = latestResidentRoundTs(carrierRounds);
  } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable due basis — ${(e as Error).message} (nothing appended)`);
  }
  const lastRunMap = readLastRunMap(lastRunPath) as Record<string, unknown>;
  const lastRunRaw = lastRunMap[DISCOVERY_METHOD_NAME];
  const lastRunValue = Number(lastRunRaw);
  const lastRunUsable = Number.isFinite(lastRunValue) && lastRunValue > 0;
  let last: number | null;
  let dueSource: "carrier" | "last-run-stamped" | "none";
  let dueBasis: string;
  let legacyIgnored: number | null = null;
  if (residentTs !== null) {
    last = residentTs;
    dueSource = "carrier";
    dueBasis = `carrier: latest invoked_by:${INVOKED_BY_RESIDENT} scan-round at ${new Date(residentTs).toISOString()}`;
  } else if (isResidentStamped(lastRunMap, DISCOVERY_METHOD_NAME) && lastRunUsable) {
    last = lastRunValue;
    dueSource = "last-run-stamped";
    dueBasis = `routine-last-run.json: resident-stamped entry ${lastRunValue}`;
  } else {
    last = null;
    dueSource = "none";
    if (lastRunUsable) {
      legacyIgnored = lastRunValue;
      dueBasis = `routine-last-run.json holds ${lastRunValue}, but it carries no invoked_by:${INVOKED_BY_RESIDENT} stamp on '${invokedByStampKey(DISCOVERY_METHOD_NAME)}' and the carrier has no resident-driver round, so it is a legacy/unattributed entry and is IGNORED for due-computation`;
    } else {
      dueBasis = `no invoked_by:${INVOKED_BY_RESIDENT} scan-round on the carrier and no usable routine-last-run.json entry`;
    }
  }
  // ⛔ ONE shape, used by EVERY Fact this round can return (the refusals and the run alike): the cadence
  // that governed, and the reading the window came from — enumerated (`source`), not only in the prose
  // (`basis`), so a reader can tell "the carrier said so" from "a stamped entry said so" from "nothing
  // was believed" without parsing a sentence (硬规则 3).
  const intervalInfo = { minutes: intervalMinutes, declared_minutes: declaredMinutes, reverted: intervalReverted, until: intervalUntilIso };
  const dueInfo = { source: dueSource, basis: dueBasis, last_resident_run: residentTs === null ? null : new Date(residentTs).toISOString(), legacy_ignored: legacyIgnored };
  const legacyNote = legacyIgnored === null
    ? ""
    : ` (the legacy .quay/routine-last-run.json entry ${legacyIgnored} was NOT written by the resident driver and is ignored for due-computation)`;

  // ③c the durable window: the loop's own lastRun is in-memory ⇒ a driver restart would re-fire every
  //     round. ⛔ What is consulted is the PRODUCTION time, for BOTH kinds of round — a manual round
  //     answers its own "is it time?" with the same reading production uses (so a hand-run inside the
  //     window is a no-op unless `--force`), it just never ADVANCES it. That is the whole split: read is
  //     shared, advance is the resident round's alone (a manual round that wrote here is the defect this
  //     task fixes).
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

  // ③d THE 24h CEILING. Only for a declaration that carries one (required whenever the interval is below
  //     the permanent default). A round that would push the trailing-24h total past the ceiling does not
  //     run at all — and says so with its own reason, so "the fast cadence is being held back by its
  //     budget" is never shaped like "the routine is idle" (硬规则 3b).
  let budget24h: { cap: number; used: number; window_ms: number } | null = null;
  if (config.maxModelCallsPer24h !== null) {
    let used: number;
    try {
      used = modelCallsInWindow(carrierRounds, started, BUDGET_24H_MS);
    } catch (e) {
      return fact("failed", { ...base, enabled: true, interval: intervalInfo, due: dueInfo }, `unreadable 24h budget — ${(e as Error).message} (nothing appended)`);
    }
    if (used >= config.maxModelCallsPer24h) {
      return fact(
        "not-evaluated",
        { ...base, enabled: true, interval: intervalInfo, due: dueInfo, budget_24h: { cap: config.maxModelCallsPer24h, used, window_ms: BUDGET_24H_MS } },
        `budget-24h: ${used} model call(s) in the trailing 24h >= max_model_calls_per_24h ${config.maxModelCallsPer24h} — nothing spawned (the fast cadence is held back by its declared 24h ceiling, not idle)${revertedNote}${legacyNote}`,
      );
    }
    budget24h = { cap: config.maxModelCallsPer24h, used, window_ms: BUDGET_24H_MS };
  }

  // The engine modules (docs/analysis/discovery-{experience-ledger,reflection,method-registry}.mjs) are
  // resolved HERE — once, after the three gates that can return without running a step, and before the
  // first step that falls back to one of them. Loading them from DISK (never a static import: see
  // loadDiscoveryModules) is what keeps this SHIPPED file out of the bundler's resolution graph; a
  // resolution failure is this round's `failed`, named, not a silent zero.
  let engine: DiscoveryModules;
  try {
    engine = await loadDiscoveryModules(root);
  } catch (e) {
    return engineRefusal(e, "round start");
  }

  // The wall budget is the round's own refusal: a step that runs past `max_wall_ms` stops the round
  // BEFORE the append, so the carrier stays byte-identical and the last-run is not consumed.
  const breached = () => now() - started >= config.maxWallMs;

  // ⑤ (a) ingest. A refusal here (WATERMARK_MISMATCH / an unresolved shared checkout / a missing
  //    evidence store) is the round's own failure with the step's OWN reason code.
  const ingestFn = opts.ingestFn ?? engine.ledger.ingestNewOutcomes;
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
  // Candidate persistence is used by BOTH ⑥ (the round's own candidates) and ⑦ (the next version an
  // evaluated verdict mints), and ⑦ runs OUTSIDE the `ingested > 0` block below — so the seam lives at
  // the round's own scope. Declaring it inside ⑥ left ⑦ reading a binding that is not in scope there
  // (a ReferenceError on the one path where a verdict is `evaluated` with a `candidate_after`).
  let appendFn = opts.appendFn ?? engine.registry.appendMethodRecord;
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
    let reflectFn = opts.reflectFn ?? engine.reflection.runReflectionRound;
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
  // ⛔ `null` (not `[]`) is the "not read" value: a round that validated nothing must not report the
  // population it never looked at as "0 held-out cases" (硬规则 3b).
  // The default reader is async (it resolves the ledger module); a test seam may stay synchronous, so
  // the call is awaited either way.
  const heldOut = candidates.length > 0 ? await (opts.heldOutFn ?? readHeldOutCases)(root) : null;
  if (heldOut !== null && heldOut.ok) {
    const registryRead = engine.registry.readMethodRegistry(root, { history: true });
    const registry = Array.isArray(registryRead.history) ? registryRead.history : [];
    const isAncestor = engine.reflection.gitIsAncestor(root);
    const pinTmp = opts.pinTmpRoot ?? process.env[PIN_TMP_ENV] ?? os.tmpdir();
    const pinFn = opts.pinFn ?? engine.reflection.materializeStrippedPin;
    const validateFn = opts.validateFn ?? engine.reflection.validateGeneralization;
    const validateEvaluationPin = engine.reflection.validateEvaluationPin;
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
  } else if (heldOut !== null && !heldOut.ok) {
    // The held-out pool could not be read ⇒ its OWN value. The candidates still landed (they are drafts,
    // not claims); the generalization step is `not-evaluated`, never "0 verdicts ⇒ nothing passed".
    reflection = { ...(reflection ?? {}), held_out_unreadable: heldOut.reason };
  }

  // ⑧ the round's ONE line.
  const wallMs = now() - started;
  const cost = engine.reflection.computeReflectionCost(calls, { wall_ms: wallMs }) as Record<string, unknown>;
  const round: Record<string, unknown> = {
    kind: "scan-round",
    routine: DISCOVERY_METHOD_NAME,
    // ⛔ The carrier line says WHO ran it, so a reader of `.quay/discovery-method-findings.jsonl` can tell
    // a production round from a hand-run/test one without cross-referencing anything (硬规则 9 — the two
    // must be distinguishable on the record itself, not only in the head of whoever ran it).
    invoked_by: invokedBy,
    ts: new Date(now()).toISOString(),
    // ⛔ The cadence that ACTUALLY governed this round, and the reading the window came from, on the line
    // itself (the SAME two objects every Fact of this round carries — see intervalInfo/dueInfo): a reader
    // asking "was this a 60m round or a 360m one, and what told us it was due?" gets both answers without
    // re-reading a config that may since have changed or re-deriving the basis from the file's order.
    interval: intervalInfo,
    due: dueInfo,
    budget_24h: budget24h,
    wall_ms: wallMs,
    ingested: { experiences: ingested, scanned: Number(ingest.scanned ?? 0), duplicates: Number(ingest.duplicates ?? 0), advanced_to: ingest.advanced_to ?? null },
    reflected: reflection,
    candidates: { minted: candidates.length, persisted: persisted.filter((p) => p.ok === true).length, records: persisted },
    held_out: {
      read: heldOut !== null,
      cases: heldOut === null || !heldOut.ok ? null : heldOut.cases.length,
      unreadable: heldOut !== null && !heldOut.ok ? heldOut.reason : null,
    },
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
  // ⑨ ⛔ THE SPLIT: only a RESIDENT round advances the production window. A manual round's line lands on
  //    the carrier exactly like a production one (same data, and its `invoked_by` names the difference),
  //    but `.quay/routine-last-run.json` is left BYTE-IDENTICAL — a hand-run must never be what decides
  //    when production runs next. The `if` is the whole mechanism; there is no write-elsewhere path.
  //    ⛔ The advance carries the STAMP in the same write: an entry whose writer is unreadable would be
  //    indistinguishable from one this routine itself wrote (硬规则 3b), which is the state the due basis
  //    above exists to refuse.
  if (resident) writeLastRunStamped(lastRunPath, DISCOVERY_METHOD_NAME, now(), invokedBy);

  return fact(
    "verified",
    round,
    `round ran (invoked_by:${invokedBy}, interval ${intervalMinutes}m): ingested ${ingested} experience(s), reflected ${reflection ? Number(reflection.decisions ?? 0) : 0} unit(s), minted ${candidates.length} candidate(s), ${verdicts.filter((v) => v.outcome === "evaluated").length} evaluated verdict(s) (${verdicts.filter((v) => v.correct === true).length} correct), ${promotions.length} promotion(s), ${retirements.length} retirement(s), ${modelCalls} model call(s), wall ${wallMs}ms; appended 1 scan-round line to ${asRel(root, carrier)}${resident ? " and advanced the production last-run" : " — MANUAL: the production last-run in .quay/routine-last-run.json was NOT advanced (this round did not move production's clock)"}${revertedNote}${legacyNote}${forcedPastDue ? " [--force: the due gate was ignored for this round only]" : ""}`,
  );
}

// ── RoutineSpec factories ────────────────────────────────────────────────────────────────────────────
/** ⛔ `invokedBy` and `force` are OMITTED, not merely defaulted: this factory IS the driver's routine
 *  table, so the round it builds is `resident-driver` by construction and cannot be talked out of it
 *  (a routine spec is exactly the thing that may advance production). A caller that wants a manual round
 *  calls `runDiscoveryMethod` directly — the two paths must not be reachable by the same switch. */
export interface DiscoveryMethodRoutineOptions extends Omit<DiscoveryMethodRunOptions, "config" | "configPresent" | "configError" | "halted" | "invokedBy" | "force"> {}

/** Build the Layer-1b routine from an ALREADY-PARSED config read. `schedule` is the section's trigger
 *  when present, else the default interval — a disabled/absent section is still an evaluated routine
 *  (it records `not-evaluated:disabled`), it just never spawns.
 *  ⚠️ `schedule` is the DECLARED interval and stays that way for the life of this spec: the driver holds
 *  it in memory, so after an `interval_until` window expires the driver keeps OFFERING a round every
 *  `declared` minutes, and the round itself answers `not due` against the reverted 360m default (the due
 *  basis is re-read from disk on every round). A cheap no-op is the price of not requiring a driver
 *  restart at the deadline; the alternative — a spec that silently mutates its own schedule — would hide
 *  the revert from the driver's own routine table. */
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
        // The driver's routine table ⇒ the PRODUCTION scheduler. Declared here, at the one place that
        // knows the caller is the driver (see the header: the read is shared, the advance is ours).
        invokedBy: INVOKED_BY_RESIDENT,
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
): {
  routine: RoutineSpec | null;
  error: string | null;
  present: boolean;
  enabled: boolean;
  /** The ASSEMBLED cadence, so the host driver can REPORT it at startup rather than leaving "what
   *  interval did we actually assemble?" readable only by re-parsing the config by hand. `null` when the
   *  section is absent/malformed/disabled (nothing was assembled to report). */
  intervalMinutes: number | null;
  intervalUntil: number | null;
  maxModelCallsPer24h: number | null;
} {
  const read = readDiscoveryMethodConfig(root);
  const cfg = read.config;
  return {
    routine: read.present ? buildDiscoveryMethodRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: cfg?.enabled === true,
    intervalMinutes: cfg && typeof cfg.trigger.minutes === "number" ? cfg.trigger.minutes : null,
    intervalUntil: cfg ? cfg.intervalUntil : null,
    maxModelCallsPer24h: cfg ? cfg.maxModelCallsPer24h : null,
  };
}

/** The production model seam: the live launcher, resolved lazily so a workspace that never enables the
 *  section never pays for it. Returns `{ok:false, reason}` when the engine modules or the driver
 *  runtime cannot be loaded — a refusal, never a silent no-op (the round then records `failed`). */
export async function liveDiscoveryModel(root: string): Promise<{ ok: boolean; model?: ModelFn; modelId?: string | null; reason?: string }> {
  let liveModelFactory: DiscoveryReflectionModule["liveModelFactory"];
  try {
    liveModelFactory = (await loadDiscoveryModules(root)).reflection.liveModelFactory;
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  const live = await liveModelFactory({ root, tools: "", timeoutMs: 300_000 }) as { ok: boolean; model?: ModelFn; run?: ModelFn; reason?: string };
  if (!live.ok || typeof live.run !== "function") return { ok: false, reason: String(live.reason ?? "MODEL_SEAM_MISSING") };
  return { ok: true, model: live.run, modelId: live.model ?? null };
}

// ── CLI (the one-shot entry AC3 drives) ─────────────────────────────────────────────────────────────
const USAGE = [
  "discovery-method-routine — the Discovery Method loop as a Layer-1b routine (report-only).",
  "  --once --root <dir> [--json]      run ONE MANUAL round against <dir> (invoked_by:\"manual\")",
  "  --force                           manual: run even inside the interval (still never advances",
  "                                    .quay/routine-last-run.json — production's clock is not yours)",
  "  --no-model                        run without the live model seam (ingest-only; zero model calls)",
  "  --pin-tmp <dir>                   temp root for stripped pins",
  "⛔ This CLI is ALWAYS a manual round: it reads the production interval but never advances it. The",
  "   resident round (the one that advances it) is assembled by the quality-gate driver's routine table.",
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
    // ⛔ The CLI is ALWAYS manual: it is a hand-run by definition. `--force` lets it run inside the
    // interval, and even then it does not advance the production last-run (see runDiscoveryMethod ⑨).
    invokedBy: INVOKED_BY_MANUAL,
    force: argv.includes("--force"),
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
