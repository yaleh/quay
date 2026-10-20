// arch-discovery-routine.ts — wire the two arch-DISCOVERY instruments
// (docs/analysis/arch-discovery-{space,time}.mjs) into the quality-gate driver's routine track, as a
// REPORT-ONLY, bounded, killable mechanical routine.
//
// WHY THIS EXISTS: the two instruments landed (done task
// gap-arch-discovery-instruments-have-no-bounded-scan-mode) with a bounded `--scan` mode, a run-stable
// `finding_fp`, and no periodic runner — they were only ever started by hand. This module turns them
// into a Layer-1b `RoutineSpec` the resident quality-gate driver runs, reusing machinery that already
// exists rather than inventing a driver kind or a second scheduler:
//   - interval scheduling: routine-scheduler.isDue + the DURABLE `.quay/routine-last-run.json`
//     (the loop's own `lastRun` map is in-memory ⇒ a driver restart would re-fire every round);
//   - the caller-side routine watchdog + halt (`isHalted`, `.quay/quality-control.json`);
//   - the quality-round fact (`.quay/quality-round.jsonl`) — the routine returns a Fact; the loop
//     writes the heartbeat. We add NO writer of our own there.
//
// REPORT-ONLY, STRUCTURALLY: this file imports no filing/authoring function and writes no task or
// goal. Its only persistence is (a) append-only lines on ONE carrier,
// `.quay/arch-discovery-findings.jsonl`, and (b) the existing quality-round fact. The absence of the
// authoring imports is asserted mechanically by the case-(9) static control in
// plugin/test/arch-discovery-routine.test.mjs — a mutation that adds one such import turns that case
// red. ⚠️ Consequence for maintainers: do NOT name the forbidden authoring symbols here, not even in
// a comment (the control reads POSITION, and a comment mention would be a false positive).
//
// KILL SWITCH + OFF BY DEFAULT: the routine is declared in `.quay/config.yml` `loop.arch_discovery:`
// (see parseArchDiscoverySection). A workspace with no such section gets `not-evaluated:disabled` and
// ZERO spawns — nothing else. `enabled: false` is the same. A malformed section, or an out-of-range
// value (an interval under the floor), records `failed` and spawns nothing — a bad declaration must
// never be read as "no findings" (硬规则 3b).
//
// FAIL-CLOSED ROUNDS: instrument exit ≠ 0 (bounds use 4/5/6; 2 = usage), timeout, unparseable output,
// validator-refused records, or an unreadable carrier each make the round `failed` with a DISTINCT
// reason; the round then appends NOTHING to the carrier and does NOT advance the last-run (so a failed
// round does not consume the window — the next round retries).
//
// EMPTY ROUNDS APPEND NOTHING (gap-arch-discovery-space-no-candidate-universe-still-appends-scan-
// round): a COMPLETED round whose space half has no candidate universe AND whose instruments produced
// no finding carries no reading, so it writes no `scan-round` line (see `shouldAppendRound`). It DOES
// advance the last-run — the scan genuinely ran, and not advancing would make it due every tick. Any
// finding from either half keeps the line: the time half's readings are never discarded.
//
// THE SPACE HALF'S CANDIDATE UNIVERSE (gap-arch-discovery-space-instrument-has-no-candidate-universe-
// on-non-quay-hosts): the `space` instrument can only produce a finding for a (authority, surface) pair
// the registry DECLARES. With no `--registry` it uses the registry shipped in its OWN checkout (quay's
// own), which on any tree that is not quay's repo yields `candidates: 0` — an exit-0 reading that
// STRUCTURALLY cannot be non-zero and therefore carries no information (硬规则 3b/4). The routine now
// (a) reads the instrument's own `cost.candidates` from its `--json` report and records it on the
// space sub-record, and (b) treats `candidates: 0` (and an unreadable count) as `not-evaluated` — the
// round is NOT `verified`, and (c) accepts an OPTIONAL `loop.arch_discovery.space_registry: <workspace-
// relative path>` which is passed to the instrument as `--registry`, so a foreign host can declare its
// own authorities/surfaces AS DATA. ⛔ No host-specific analyzer ships in Quay.
//
// AND — gap-arch-discovery-space-no-candidate-universe-still-appends-scan-round — a round with NO
// candidate universe and NO finding at all appends NOTHING (it used to write one near-empty
// `scan-round` line every interval on every registry-less host). A time-half finding still keeps the
// round and still lands on the carrier; see `shouldAppendRound`.
//
// ⛔ NOT a hot-path gate (the `gap-fan-in-remove-archguard-gate` lesson): nothing here is called by
// fan-in / scoped-gate / any per-task path. The only caller is the quality driver's routine table.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { isDue, parseTrigger } from "./routine-scheduler.ts";
import { runAsync, type Fact, type RoutineSpec } from "./driver-runtime.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap, writeLastRun } from "./probe-routine.ts";

/** The routine's name — one key in `.quay/routine-last-run.json` (shared with the probe track; ⛔ names
 *  do not collide and the map is a per-name merge write). */
export const ARCH_DISCOVERY_NAME = "arch-discovery";

/** The ONE carrier this routine appends to. Gitignored (`.gitignore`), declared in
 *  docs/carrier-registry.json — a runtime-state carrier, the same family as quality-round.jsonl. */
export const CARRIER_REL = path.posix.join(".quay", "arch-discovery-findings.jsonl");

/** The two instruments' FILE names — the basenames the engine modules are shipped under, spelled once. */
export const SPACE_INSTRUMENT_FILE = "arch-discovery-space.mjs";
export const TIME_INSTRUMENT_FILE = "arch-discovery-time.mjs";
export const SPACE_INSTRUMENT_REL = path.posix.join("docs", "analysis", SPACE_INSTRUMENT_FILE);
export const TIME_INSTRUMENT_REL = path.posix.join("docs", "analysis", TIME_INSTRUMENT_FILE);

/** ⛔ THE PACKAGING SINGLE SOURCE — see `OPEN_DISCOVERY_ENGINE_MODULES` in
 *  open-semantic-discovery-routine.ts for the full rationale. `build-plugin-dist.mjs` derives the
 *  artifact's engine closure from THIS list, never from a build-side hand list. */
export const ARCH_DISCOVERY_ENGINE_MODULES = [SPACE_INSTRUMENT_FILE, TIME_INSTRUMENT_FILE] as const;

/** The plugin root this FILE lives in (…/plugin/scripts/<this> → …/plugin). Used only to BUILD the first
 *  candidate path of `resolveInstrument`. */
export const SCRIPT_PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Resolve one instrument to an absolute path, returning the candidates it TRIED so a refusal can name
 *  them (an unresolvable instrument is a `failed` round, not a silent zero — 硬规则 3b).
 *
 *  ⛔ ORDER IS THE FIX for gap-discovery-toolchain-depends-on-unshipped-docs-analysis-and-ts-sources-never-
 *  works-off-quay-repo: the instrument was resolved from the WORKSPACE root ONLY, so a host project that
 *  enabled `loop.arch_discovery` without a copy of `docs/analysis/` could never run a round — the
 *  instrument argv pointed at a file that does not exist there. The instrument ships with the plugin
 *  (it is this file's own sibling engine), so the PLUGIN root is the primary candidate; the workspace root
 *  stays as the second candidate for a workspace that vendors its own copy (the pre-existing behaviour). */
export function resolveInstrument(root: string, file: string): { path: string | null; tried: string[] } {
  const tried = [
    path.join(SCRIPT_PLUGIN_ROOT, "docs", "analysis", file),
    path.join(root, "docs", "analysis", file),
  ];
  for (const candidate of tried) {
    if (fs.existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}

/** Shape-check a host-declared space registry (`loop.arch_discovery.space_registry`); returns the
 *  fail-closed REASON, or null when it is usable. An absent file, unparseable JSON, or a registry with
 *  no authorities is a NAMED refusal — the round is `failed` and NOTHING is spawned or appended
 *  (硬规则 3b: "the host declared a registry" must never degrade into the same reading as "the
 *  instrument scanned and found nothing"). The shape check mirrors the instrument's own guard
 *  (`registry has no authorities — nothing would be evaluated`) so the failure is legible at the
 *  ROUTINE layer instead of arriving as an opaque non-zero child exit. The routine deliberately does
 *  NOT hand the parsed object to the instrument: the instrument reads the file itself by `--registry`,
 *  so the routine and the instrument always see bit-identical bytes. */
export function checkSpaceRegistry(absPath: string, relPath: string): string | null {
  const refuse = (why: string) => `FAIL-CLOSED: loop.arch_discovery space_registry '${relPath}' ${why} (nothing spawned, nothing appended)`;
  if (!fs.existsSync(absPath)) return refuse(`not found at ${absPath}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (e) {
    return refuse(`is not readable JSON — ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return refuse(`must be a JSON object with an 'authorities' array (got ${Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed})`);
  const authorities = (parsed as Record<string, unknown>).authorities;
  if (!Array.isArray(authorities) || authorities.length === 0) return refuse("has no 'authorities' array — nothing would be evaluated");
  return null;
}

/** The `space` instrument's OWN `cost.candidates` from its `--json` scan report. `null` means the
 *  structured report was absent/unreadable — NEVER a fabricated 0 (硬规则 3b: a count we could not read
 *  and a real zero must not share a shape; the round treats the two differently). */
export function readScanCandidates(stdout: string): number | null {
  let report: unknown;
  try {
    report = JSON.parse(String(stdout ?? ""));
  } catch {
    return null;
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const cost = (report as Record<string, unknown>).cost;
  if (!cost || typeof cost !== "object" || Array.isArray(cost)) return null;
  const n = (cost as Record<string, unknown>).candidates;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** The space half's evaluated / not-evaluated state, derived from the instrument's own candidate count.
 *  `evaluated` = it had a candidate universe to read; the two `not-evaluated:` states are DISTINCT and
 *  legible, and NEITHER is folded into a clean `exit:0` round (硬规则 3b/4). */
export const SPACE_EVALUATED = "evaluated";
export const SPACE_NO_UNIVERSE = "not-evaluated:no-candidate-universe";
export const SPACE_UNREADABLE = "not-evaluated:candidate-count-unreadable";

/** Map the instrument's candidate count to the space half's state. Exported so a test can pin the three
 *  states (a non-zero count, a real zero, and an unreadable count) without a live spawn. */
export function spaceStateFor(candidates: number | null): string {
  if (candidates === null) return SPACE_UNREADABLE;
  return candidates === 0 ? SPACE_NO_UNIVERSE : SPACE_EVALUATED;
}

/** Whether a COMPLETED round has anything to write to the carrier.
 *
 *  A round whose space half had NO candidate universe (`candidates: 0`) AND whose two instruments
 *  produced NO finding at all carries no reading: on a host with no `space_registry` the space half
 *  structurally reads zero, so appending a near-empty `scan-round` line every interval is pure empty
 *  spin (gap-arch-discovery-space-no-candidate-universe-still-appends-scan-round).
 *
 *  ⛔ Findings are NEVER suppressed: `findingCount` counts the findings of BOTH halves, so a real
 *  time-half reading keeps the round even when the space half is dark (硬规则 3b/4 — the fix must
 *  not turn "no space universe" into "drop the time half's evidence"). Only an UNREADABLE candidate
 *  count still appends: that round is not a known-empty round, and its record is the only diagnostic
 *  of the unreadable report. */
export function shouldAppendRound(spaceState: string, findingCount: number): boolean {
  return !(spaceState === SPACE_NO_UNIVERSE && findingCount === 0);
}

/** The interval floor. A round spawns two node processes that stream large carriers; a cadence shorter
 *  than an hour is refused rather than silently rounded up (the config error names the value). */
export const MIN_INTERVAL_MINUTES = 60;
/** Default interval when the section declares none (only reachable when disabled — an enabled section
 *  must declare `interval`). */
export const DEFAULT_INTERVAL_MINUTES = 360;
export const DEFAULT_SINCE_DAYS = 7;
export const DEFAULT_MAX_MS = 60_000;
export const DEFAULT_MAX_RECORDS = 2_000;
export const DEFAULT_MAX_OLD_SPACE_MB = 512;

/** The routine-side spawn timeout margin. The instrument bounds ITSELF with `--max-ms` and exits with
 *  code 4 on breach; this margin only has to cover node startup + module load + writing the carrier, so
 *  a breach surfaces as the instrument's OWN exit code rather than as our timeout. */
export const SPAWN_KILL_MARGIN_MS = 15_000;

/** GNU time, used ONLY to read the child's peak RSS (the instruments do not self-report it). Missing /
 *  non-executable ⇒ peak RSS is recorded as `null` (an honest "not measured"), never as 0. */
export const GNU_TIME_BIN = "/usr/bin/time";

// ── config: `.quay/config.yml` `loop.arch_discovery:` ───────────────────────────────────────────────
export interface ArchDiscoveryConfig {
  enabled: boolean;
  trigger: { kind: string; minutes?: number };
  sinceDays: number;
  maxMs: number;
  maxRecords: number;
  maxOldSpaceMb: number;
  /** Optional WORKSPACE-RELATIVE path to a space-instrument registry (the checker's own registry file
   *  format: `{authorities, surfaces, knownDrift}`). This is the ONLY way a host that is not quay's own
   *  repo can give the `space` instrument a candidate universe: with no key the instrument falls back to
   *  the registry shipped in its OWN checkout (quay's), which on a foreign tree yields `candidates: 0`
   *  — a reading that cannot be non-zero and therefore carries no information (硬规则 3b/4).
   *  ⛔ Data, not code: the host declares its authorities+surfaces; Quay ships no host-specific analyzer. */
  spaceRegistry: string | null;
}

/** `present` = the section exists; `config` = the parsed section (null when malformed/disabled-null);
 *  `error` = a fail-closed reason (a present-but-bad section ⇒ the round is `failed`). */
export interface ArchDiscoveryConfigRead {
  present: boolean;
  config: ArchDiscoveryConfig | null;
  error: string | null;
}

const cfgBad = (msg: string) => `loop.arch_discovery ${msg}`;

/** Pure parse of ONE `loop.arch_discovery` value. `enabled` is required and boolean; a disabled section
 *  is returned immediately (the kill switch must work even with the other keys absent/bad); an ENABLED
 *  section must carry a valid `interval:<N>m` ≥ the floor, and any bound that IS present must be in
 *  range (absent bounds take their documented default). */
export function parseArchDiscoverySection(raw: unknown): { config: ArchDiscoveryConfig | null; error: string | null } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw as Record<string, unknown>;
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgBad(`needs a boolean 'enabled' (got ${rec.enabled === undefined ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  const disabled: ArchDiscoveryConfig = {
    enabled: false,
    trigger: { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES },
    sinceDays: DEFAULT_SINCE_DAYS,
    maxMs: DEFAULT_MAX_MS,
    maxRecords: DEFAULT_MAX_RECORDS,
    maxOldSpaceMb: DEFAULT_MAX_OLD_SPACE_MB,
    spaceRegistry: null,
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
    return { config: null, error: cfgBad(`interval ${trigger.minutes}m is below the ${MIN_INTERVAL_MINUTES}m floor — a round spawns two node processes and is refused, not silently rounded`) };
  }

  const bound = (key: string, dflt: number, min: number): { value: number | null; error: string | null } => {
    const v = rec[key];
    if (v === undefined || v === null) return { value: dflt, error: null };
    if (typeof v !== "number" || !Number.isFinite(v) || v < min) {
      return { value: null, error: cfgBad(`'${key}' must be a number >= ${min} (got ${JSON.stringify(v)})`) };
    }
    return { value: v, error: null };
  };
  const since = bound("since_days", DEFAULT_SINCE_DAYS, 0.001);
  if (since.error) return { config: null, error: since.error };
  const maxMs = bound("max_ms", DEFAULT_MAX_MS, 1);
  if (maxMs.error) return { config: null, error: maxMs.error };
  const maxRecords = bound("max_records", DEFAULT_MAX_RECORDS, 1);
  if (maxRecords.error) return { config: null, error: maxRecords.error };
  const maxOldSpaceMb = bound("max_old_space_mb", DEFAULT_MAX_OLD_SPACE_MB, 16);
  if (maxOldSpaceMb.error) return { config: null, error: maxOldSpaceMb.error };

  // `space_registry`: OPTIONAL. Present ⇒ it must be a non-empty string (a workspace-relative path);
  // its EXISTENCE/parseability is checked at round time with a legible refusal (see readSpaceRegistry)
  // — this pure parse only refuses the wrong TYPE, so the kill switch keeps working without it.
  let spaceRegistry: string | null = null;
  if (rec.space_registry !== undefined && rec.space_registry !== null) {
    if (typeof rec.space_registry !== "string" || rec.space_registry.trim() === "") {
      return { config: null, error: cfgBad(`'space_registry' must be a non-empty workspace-relative path string (got ${JSON.stringify(rec.space_registry)})`) };
    }
    spaceRegistry = rec.space_registry;
  }

  return {
    config: {
      enabled: true,
      trigger,
      sinceDays: since.value as number,
      maxMs: maxMs.value as number,
      maxRecords: maxRecords.value as number,
      maxOldSpaceMb: maxOldSpaceMb.value as number,
      spaceRegistry,
    },
    error: null,
  };
}

/** Read `.quay/config.yml` `loop.arch_discovery:`. No config file / no `loop:` / no section ⇒
 *  `present:false` (off by default). Malformed YAML or a bad section ⇒ `error` set (fail-closed). */
export function readArchDiscoveryConfig(workspaceRoot: string): ArchDiscoveryConfigRead {
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
  const raw = (loop as Record<string, unknown>).arch_discovery;
  if (raw === undefined || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseArchDiscoverySection(raw);
  return { present: true, config, error };
}

// ── the carrier: append-only JSONL of finding + scan-round lines ─────────────────────────────────────
/** One `finding` line (appended only when its `finding_fp` is new). */
export interface CarrierFinding {
  finding_fp: string;
  subject_key: string;
  verdict: string;
  instrument: string;
}

/** Read the carrier's existing `finding` lines. Returns `{missing:true}` when the file does not exist.
 *  A line that is not JSON, or is not an object, THROWS — an unreadable carrier must never be shaped
 *  like "0 previous findings" (硬规则 3b). */
export function readCarrierFindings(carrierPath: string): { missing: boolean; records: CarrierFinding[] } {
  if (!fs.existsSync(carrierPath)) return { missing: true, records: [] };
  const raw = fs.readFileSync(carrierPath, "utf8");
  const records: CarrierFinding[] = [];
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
    const r = rec as Record<string, unknown>;
    if (r.kind !== "finding") continue;
    if (typeof r.finding_fp !== "string" || !r.finding_fp) throw new Error(`${carrierPath}:${i + 1} is a finding line with no finding_fp`);
    records.push({
      finding_fp: r.finding_fp,
      subject_key: String(r.subject_key ?? ""),
      verdict: String(r.verdict ?? ""),
      instrument: String(r.instrument ?? ""),
    });
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

// ── reading an instrument's `--out` carrier ──────────────────────────────────────────────────────────
/** Parse one instrument's `--out` JSONL. A MISSING file or a non-JSON / non-object line is an error
 *  (unparseable output). An empty-but-present file is a real "0 records", not an error. */
export function readInstrumentRows(outFile: string): Record<string, unknown>[] {
  if (!fs.existsSync(outFile)) throw new Error(`no output carrier at ${outFile} (instrument exited 0 but wrote nothing readable)`);
  const raw = fs.readFileSync(outFile, "utf8");
  const rows: Record<string, unknown>[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch (e) {
      throw new Error(`${outFile}:${i + 1} is not valid JSON — ${(e as Error).message}`);
    }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw new Error(`${outFile}:${i + 1} is not a JSON object`);
    rows.push(rec as Record<string, unknown>);
  }
  return rows;
}

// ── peak RSS via GNU time (honest null when unavailable) ─────────────────────────────────────────────
/** Wrap `inner` with `/usr/bin/time -v` when it is executable, so the child's peak RSS can be read from
 *  its report. Returns `wrapped:false` (and the argv unchanged) otherwise — RSS is then `null`. */
export function wrapWithGnuTime(inner: string[], enabled: boolean): { argv: string[]; wrapped: boolean } {
  if (!enabled) return { argv: inner, wrapped: false };
  try {
    fs.accessSync(GNU_TIME_BIN, fs.constants.X_OK);
  } catch {
    return { argv: inner, wrapped: false };
  }
  return { argv: [GNU_TIME_BIN, "-v", ...inner], wrapped: true };
}

/** `Maximum resident set size (kbytes): N` from GNU time's stderr report (null when absent). */
export function parsePeakRssKb(stderr: string): number | null {
  const m = /Maximum resident set size \(kbytes\):\s*(\d+)/.exec(stderr ?? "");
  return m ? Number(m[1]) : null;
}

// ── the round ────────────────────────────────────────────────────────────────────────────────────────
export type ArchDiscoverySpawnFn = (
  argv: string[],
  opts: { timeoutMs: number; collectStderr?: boolean },
) => Promise<{ status: number | null; stdout: string; stderr: string; error: Error | null }>;

export interface ArchDiscoveryRunOptions {
  /** Parsed section (see readArchDiscoveryConfig). */
  config: ArchDiscoveryConfig | null;
  /** Whether `loop.arch_discovery:` exists at all. */
  configPresent: boolean;
  /** Fail-closed config reason (a present-but-bad section). */
  configError?: string | null;
  /** From the routine ctx: halt gates the spawn, never the routine track. */
  halted: boolean;
  /** Test seam: the spawn primitive (default `runAsync`). */
  spawnFn?: ArchDiscoverySpawnFn;
  /** Test seam: replace the per-instrument argv PREFIX (default node + strip-types + heap cap + path). */
  argvPrefix?: { space: string[]; time: string[] };
  /** Carrier override (tests). */
  carrierPath?: string;
  /** Durable last-run map override (tests). */
  lastRunPath?: string;
  /** Test seam: `false` ⇒ never wrap with GNU time (deterministic RSS = null). */
  measureRss?: boolean;
  /** Injectable clock (tests). */
  now?: () => number;
}

const asRel = (root: string, p: string) => path.relative(root, p) || p;

/** The whole round: config gate → halt gate → durable due gate → spawn both `--scan`s → diff against
 *  the carrier → append (finding lines for NEW fingerprints + one scan-round line, unless the round is
 *  a KNOWN-EMPTY one — see `shouldAppendRound`) → advance last-run (both branches).
 *  Never throws (the loop records a `failed` Fact): every failure returns BEFORE the append. */
export async function runArchDiscovery(root: string, opts: ArchDiscoveryRunOptions): Promise<Fact> {
  const now = opts.now ?? Date.now;
  const carrier = opts.carrierPath ?? path.join(root, CARRIER_REL);
  const lastRunPath = opts.lastRunPath ?? path.join(root, ROUTINE_LAST_RUN_REL);
  const base = { routine: ARCH_DISCOVERY_NAME, carrier: asRel(root, carrier), fired: false };
  const fact = (state: Fact["state"], value: Record<string, unknown>, reason: string): Fact => ({ name: ARCH_DISCOVERY_NAME, value, state, reason });

  const started = now();

  // ① config: a bad section is `failed` (fail-closed), an absent/disabled one is `not-evaluated`.
  if (opts.configError) return fact("failed", base, `config invalid — ${opts.configError} (nothing spawned)`);
  if (!opts.configPresent || !opts.config || opts.config.enabled === false) {
    return fact("not-evaluated", { ...base, enabled: false }, "disabled: loop.arch_discovery section absent or enabled:false — nothing spawned");
  }
  const config = opts.config;

  // ② halt: the round's gate. It gates the SPAWN, not the routine track (observation continues).
  if (opts.halted) return fact("not-evaluated", { ...base, enabled: true }, "halted: scan spawn suppressed (halt gates the spawn, not the routine track) — nothing spawned");

  // ③ durable window: the loop's own lastRun is in-memory ⇒ a driver restart would re-fire every round.
  const last = Number(readLastRunMap(lastRunPath)[ARCH_DISCOVERY_NAME]);
  if (!isDue(config.trigger, { now: started, lastRun: last })) {
    const agoMin = Number.isFinite(last) && last > 0 ? Math.round((started - last) / 60_000) : null;
    return fact(
      "not-evaluated",
      { ...base, enabled: true, intervalMinutes: config.trigger.minutes, minutesSinceLastRun: agoMin },
      `not due: ${agoMin === null ? "never ran (should be due — check the clock)" : `ran ${agoMin}m ago`} within the ${config.trigger.minutes}m interval — nothing spawned`,
    );
  }

  // ④ previous fingerprints. An unreadable carrier is NEVER shaped like "0 findings" (硬规则 3b).
  let prev: { missing: boolean; records: CarrierFinding[] };
  try {
    prev = readCarrierFindings(carrier);
  } catch (e) {
    return fact("failed", { ...base, enabled: true }, `unreadable carrier — ${(e as Error).message} (nothing appended)`);
  }

  // ⑤ spawn both instruments, SEQUENTIALLY (a serial run keeps the peak RSS bounded to one instrument
  //    and makes the peak reading attributable — see the emitted per-instrument facts).
  const spawnFn = opts.spawnFn ?? (runAsync as unknown as ArchDiscoverySpawnFn);

  // ⑤a the host's optional space registry is validated BEFORE any spawn: a declared-but-missing or
  //     malformed registry is a `failed` round naming the path — NOT an empty candidate set read as a
  //     clean zero (硬规则 3b). Done at the ROUTINE layer so the refusal is legible here rather than
  //     arriving as an opaque non-zero child exit carrying a node stack trace on stderr.
  let spaceRegistryAbs: string | null = null;
  if (config.spaceRegistry) {
    spaceRegistryAbs = path.resolve(root, config.spaceRegistry);
    const registryError = checkSpaceRegistry(spaceRegistryAbs, config.spaceRegistry);
    if (registryError) return fact("failed", { ...base, enabled: true, space_registry: config.spaceRegistry }, registryError);
  }

  // The instruments are resolved from DISK before the spawn (plugin root first, workspace root second —
  // see resolveInstrument), and an unresolvable one is refused HERE, naming both candidates, rather than
  // being handed to `node` as a path that does not exist (硬规则 3b: a spawn ENOENT and a real instrument
  // failure must not arrive as the same reading).
  const resolvedInstruments = opts.argvPrefix !== undefined ? null : {
    space: resolveInstrument(root, SPACE_INSTRUMENT_FILE),
    time: resolveInstrument(root, TIME_INSTRUMENT_FILE),
  };
  if (resolvedInstruments !== null) {
    const missing = (["space", "time"] as const).filter((w) => resolvedInstruments[w].path === null);
    if (missing.length > 0) {
      return fact(
        "failed",
        { ...base, enabled: true },
        `instrument(s) unresolved — ${missing.map((w) => `${w}: not found at ${resolvedInstruments[w].tried.join(" or ")}`).join("; ")} (nothing spawned, nothing appended; not-evaluated:no-instrument)`,
      );
    }
  }
  const prefixes = opts.argvPrefix ?? {
    space: ["node", "--experimental-strip-types", `--max-old-space-size=${config.maxOldSpaceMb}`, resolvedInstruments!.space.path as string],
    time: ["node", "--experimental-strip-types", `--max-old-space-size=${config.maxOldSpaceMb}`, resolvedInstruments!.time.path as string],
  };
  const sinceIso = new Date(started - config.sinceDays * 86_400_000).toISOString();
  const untilIso = new Date(started).toISOString();
  const timeoutMs = config.maxMs + SPAWN_KILL_MARGIN_MS;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arch-discovery-round-"));
  const instruments: Record<string, Record<string, unknown>> = {};
  const allRows: Record<string, unknown>[] = [];
  try {
    for (const which of ["space", "time"] as const) {
      const outFile = path.join(tmp, `${which}-records.jsonl`);
      const modeArgs = ["--scan", "--root", root, "--out", outFile, "--max-ms", String(config.maxMs), "--max-records", String(config.maxRecords)];
      if (which === "space") {
        // `--json` makes the instrument print its structured report (including `cost.candidates`) on
        // stdout, which is the only place the candidate-universe size is exposed. The `--out` carrier is
        // written IDENTICALLY with or without it, so quay's own candidate set/results are unchanged.
        modeArgs.push("--json");
        // The declared registry (if any) is the foreign tree's candidate universe. Absent ⇒ the
        // instrument falls back to the registry in its OWN checkout (quay's own) — correct for quay's
        // root, and a structurally empty candidate set everywhere else (which the space-state below
        // now records as `not-evaluated:no-candidate-universe` instead of a clean zero).
        if (spaceRegistryAbs) modeArgs.push("--registry", spaceRegistryAbs);
      }
      // The time instrument's window is `[--since, --until]`; `--until` is pinned to THIS round's start
      // so two rounds over the same interval read the SAME frozen window while the live loop keeps
      // appending carriers (the instrument's own scanWindow doc names exactly this reason). Without it,
      // every round would extend `to` and the diff's `new` count would be dominated by carrier growth.
      if (which === "time") modeArgs.push("--since", sinceIso, "--until", untilIso);
      const inner = [...prefixes[which], ...modeArgs];
      const { argv, wrapped } = wrapWithGnuTime(inner, opts.measureRss !== false);
      const t0 = now();
      const r = await spawnFn(argv, { timeoutMs, collectStderr: true });
      const wallMs = now() - t0;
      const peakRssKb = wrapped ? parsePeakRssKb(r.stderr) : null;
      instruments[which] = { instrument: which, wall_ms: wallMs, peak_rss_kb: peakRssKb, exit: r.status, argv: inner };
      const runBase = { ...base, fired: true, enabled: true, instruments };
      if (r.error) {
        return fact("failed", runBase, `${which} instrument spawn failed — ${r.error.message} (nothing appended)`);
      }
      if (r.status !== 0) {
        return fact("failed", runBase, `${which} instrument exited ${r.status} (bound breaches use 4=max-ms / 5=max-records / 6=candidate-group; 2=usage) — nothing appended`);
      }
      let rows: Record<string, unknown>[];
      try {
        rows = readInstrumentRows(outFile);
      } catch (e) {
        return fact("failed", runBase, `${which} instrument output unparseable — ${(e as Error).message} (nothing appended)`);
      }
      const refused = rows.filter((row) => row.validator_ok === false);
      if (refused.length > 0) {
        return fact("failed", runBase, `${which} instrument produced ${refused.length} validator-REFUSED record(s) — nothing appended`);
      }
      const spaceFields: Record<string, unknown> = {};
      if (which === "space") {
        // The instrument's OWN `cost.candidates`. A zero here is the whole point of this task: it means
        // the instrument had NO candidate universe to read (on a host that is not quay's own, the
        // default registry resolves to nothing) — that is not a measurement of the host, and exit 0
        // must not be recorded as a clean round (硬规则 3b/4: a reading that structurally cannot be
        // non-zero carries no information).
        const candidates = readScanCandidates(r.stdout);
        const state = spaceStateFor(candidates);
        spaceFields.candidates = candidates;
        spaceFields.evaluated = state === SPACE_EVALUATED;
        spaceFields.state = state;
      }
      instruments[which] = { ...instruments[which], ok: true, records: rows.length, ...spaceFields };
      for (const row of rows) allRows.push({ ...row, _instrument: which });
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir cleanup is best-effort */ }
  }

  // ⑥ diff against the carrier.
  const kinds: Record<string, number> = {};
  for (const r of allRows) {
    const k = String(r.kind ?? "unknown");
    kinds[k] = (kinds[k] ?? 0) + 1;
  }
  const current = new Map<string, CarrierFinding>();
  for (const r of allRows) {
    if (r.kind !== "outcome" && r.kind !== "counterexample") continue;
    const fp = typeof r.finding_fp === "string" ? r.finding_fp : "";
    if (!fp || current.has(fp)) continue;
    current.set(fp, {
      finding_fp: fp,
      subject_key: String(r.subject_key ?? ""),
      verdict: String(r.rule_verdict ?? r.verdict ?? ""),
      instrument: String(r._instrument ?? ""),
    });
  }
  const prevFps = new Set(prev.records.map((r) => r.finding_fp));
  const newFps = [...current.keys()].filter((fp) => !prevFps.has(fp));
  const repeated = [...current.keys()].filter((fp) => prevFps.has(fp)).length;
  const gone = [...prevFps].filter((fp) => !current.has(fp)).length;

  const ts = new Date(now()).toISOString();
  const findingLines = newFps.map((fp) => {
    const c = current.get(fp) as CarrierFinding;
    return { kind: "finding", routine: ARCH_DISCOVERY_NAME, ts, finding_fp: c.finding_fp, subject_key: c.subject_key, verdict: c.verdict, instrument: c.instrument };
  });
  // A subject_key whose verdict CHANGED produces a NEW finding_fp; record that as a transition.
  const prevSubjects = new Set(prev.records.map((r) => r.subject_key).filter(Boolean));
  const transitions = [...new Set(findingLines.filter((l) => l.subject_key && prevSubjects.has(l.subject_key)).map((l) => l.subject_key))];
  // Recurrence per subject_key: the CUMULATIVE count of distinct finding_fp recorded for that key.
  const bySubject = new Map<string, number>();
  for (const r of prev.records) if (r.subject_key) bySubject.set(r.subject_key, (bySubject.get(r.subject_key) ?? 0) + 1);
  for (const l of findingLines) if (l.subject_key) bySubject.set(l.subject_key, (bySubject.get(l.subject_key) ?? 0) + 1);
  const recurrence = Object.fromEntries([...bySubject.entries()]);

  const wallMs = Number(instruments.space.wall_ms) + Number(instruments.time.wall_ms);
  const rssSamples = [instruments.space.peak_rss_kb, instruments.time.peak_rss_kb].filter((v) => typeof v === "number") as number[];
  const peakRssKb = rssSamples.length > 0 ? Math.max(...rssSamples) : null;

  const round: Record<string, unknown> = {
    kind: "scan-round",
    routine: ARCH_DISCOVERY_NAME,
    ts,
    since: sinceIso,
    until: untilIso,
    wall_ms: wallMs,
    peak_rss_kb: peakRssKb,
    kinds,
    findings: { new: newFps.length, repeated, gone, total: current.size },
    recurrence,
    transitions,
    instruments,
  };
  // ⑦ the space half did NOT have a candidate universe (or its count could not be read) ⇒ the round is
  //    `not-evaluated`, NOT `verified`. The round must not be reported as clean: on a host that is not
  //    quay's own, `space` structurally reads zero, and folding that into `verified` is exactly the
  //    false reading this routine used to produce (硬规则 3b/4).
  //
  //    EMPTY ROUNDS ARE NOT RECORDED (gap-arch-discovery-space-no-candidate-universe-still-appends-scan-
  //    round): when the space half has no candidate universe AND neither instrument produced a finding,
  //    the round carries no reading, so the near-empty `scan-round` line is NOT appended — that was one
  //    line every interval, forever, on every host without a declared registry. Any finding (from
  //    EITHER half) keeps the round: the time half's readings are real and must never be discarded.
  //    The last-run advances in BOTH branches — the round genuinely ran, and leaving it un-advanced
  //    would make it due on every tick instead of every interval (a far hotter spin).
  const spaceState = String(instruments.space.state ?? SPACE_UNREADABLE);
  const append = shouldAppendRound(spaceState, current.size);
  appendCarrierRecords(carrier, append ? [...findingLines, round] : []);
  writeLastRun(lastRunPath, ARCH_DISCOVERY_NAME, now());

  const scanSummary = `${current.size} finding_fp (${newFps.length} new, ${repeated} repeated, ${gone} gone), ${transitions.length} transition(s), wall ${wallMs}ms, peak RSS ${peakRssKb === null ? "not measured" : `${peakRssKb}kB`}`;
  const appendNote = append
    ? `appended ${findingLines.length} finding + 1 scan-round line to ${asRel(root, carrier)}`
    : `appended NOTHING — empty round: the space half has no candidate universe and neither instrument produced a finding, so no scan-round line was written to ${asRel(root, carrier)}`;
  const scanned = `scan ran: ${scanSummary}; ${appendNote}`;
  if (spaceState !== SPACE_EVALUATED) {
    const count = typeof instruments.space.candidates === "number" ? String(instruments.space.candidates) : "unreadable";
    return fact(
      "not-evaluated",
      append ? round : { ...round, appended: false },
      `space ${spaceState} (candidates=${count}${spaceRegistryAbs ? "" : `; no loop.arch_discovery.space_registry declared ⇒ the space instrument scanned with ITS OWN checkout's registry, which finds nothing outside quay's repo`}) — the space half is NOT a measurement of this host, so the round is not clean. ${scanned}`,
    );
  }
  return fact("verified", round, scanned);
}

// ── RoutineSpec factories ────────────────────────────────────────────────────────────────────────────
export interface ArchDiscoveryRoutineOptions extends Omit<ArchDiscoveryRunOptions, "config" | "configPresent" | "configError" | "halted"> {}

/** Build the Layer-1b routine from an ALREADY-PARSED config read. `schedule` is the section's trigger
 *  when present, else the default interval — a disabled/absent section is still an evaluated routine
 *  (it records `not-evaluated:disabled`), it just never spawns. */
export function buildArchDiscoveryRoutine(root: string, read: ArchDiscoveryConfigRead, opts: ArchDiscoveryRoutineOptions = {}): RoutineSpec {
  const schedule = read.config?.trigger ?? { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES };
  return {
    name: ARCH_DISCOVERY_NAME,
    schedule,
    run: async (ctx) =>
      [await runArchDiscovery(root, {
        ...opts,
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        halted: ctx?.halted === true,
      })],
  };
}

/** Production entry: read `.quay/config.yml` and build the routine. NEVER throws (an optional routine
 *  track must not take down the host driver's startup) — an unreadable config is reported through
 *  `error` for the caller to surface VISIBLY (hard rules 3b/9: "declared but not driven" and "not
 *  declared" must not look the same).
 *
 *  `routine` is `null` when NO section is declared — "off by default: a project that has not declared
 *  the section gets nothing" means the host driver does not even ADD a routine to its table, so an
 *  undeclared workspace keeps the exact routine set it had before. A section that IS declared (even
 *  `enabled: false`, even malformed) yields a routine, because the declaration must be OBSERVABLE: the
 *  kill switch reads as `not-evaluated:disabled` and a bad section as `failed`, never as silence. */
export function archDiscoveryRoutineFromConfig(
  root: string,
  opts: ArchDiscoveryRoutineOptions = {},
): { routine: RoutineSpec | null; error: string | null; present: boolean; enabled: boolean } {
  const read = readArchDiscoveryConfig(root);
  return {
    routine: read.present ? buildArchDiscoveryRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: read.config?.enabled === true,
  };
}
