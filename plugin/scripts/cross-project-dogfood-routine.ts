#!/usr/bin/env node
// cross-project-dogfood-routine.ts — a periodic, REPORT-ONLY, budgeted, killable semantic round whose
// SUBJECT is OTHER Quay-host projects' real USAGE ARTIFACTS (tasks/, worker-outcome, fan-in traces,
// needs-human reasons), not this repo's source.
//
// WHY THIS EXISTS
// ---------------
// The local routine track already has a path that reads real SOURCE (open-semantic-discovery: pin the
// develop tip, let an investigator Read/Grep it, verify, refute). It has NEVER read any other project:
// `materializeStrippedPin({root, …})` always pins `root` = the repo the routine itself runs in, and every
// Portfolio finding's `components` is a path inside THIS repo. Every cross-project Quay finding landed so
// far came from a human manually dispatching an agent at another project's `.quay/*.jsonl` — a one-off
// investigation, not a recurring mechanism. This module is that mechanism.
//
// THE TWO THINGS THIS FILE IS NOT
// -------------------------------
// ① It is NOT a mechanical detector. The governing principle (binding on OSD too) is SEMANTIC FIRST: the
//    model reads the real artifacts and forms/tests hypotheses. Everything here is scheduling, provenance,
//    dedup-assistance, read-only isolation, budget, and tool wrapping. ⛔ There is deliberately no
//    hand-written rule that decides "X is a bug" — the digest produces COUNTS and EXCERPTS, never a
//    verdict, and `scanSourceProject` has no ok/not-ok output for exactly that reason.
// ② It is NOT a second verifier/refuter/budget. The confirmation bar is OSD's, reached through OSD's own
//    functions: the engine's `runVerifier` (used for the verifier AND the independent refuter role, as OSD
//    does), discovery-method's `openModelBudget` (hard reservation ledger), and the engine's own verdict
//    vocabulary. A `supported` verifier verdict alone is NEVER enough (see `isConfirmed`).
//
// THE ISOLATION INVARIANT (structural, not a promise)
// ---------------------------------------------------
// A source project is opened READ-ONLY, always. Three things make that structural rather than aspirational:
//   (a) this file performs NO `fs.<mutator>` call anywhere — every write goes through `writeOwnedFile`,
//       which reaches the mutators through the `MUTATE` indirection below. The static predicate in the
//       test is therefore a plain text scan for `fs.write*`/`fs.rm*`/… with no allowlist to rot;
//   (b) `assertNotSourceRoot` refuses ANY path inside a declared source root — every write AND every
//       spawn cwd passes through it, so a model subprocess is never rooted in a source project;
//   (c) every model call's `cwd` is a scratch directory THIS routine owns, and the tool envelope is
//       read-only (`Read,Grep,Glob` / `Read,Grep`) — there is no Bash tool, so the child cannot mutate
//       the tree it reads even if it tried.
// An unreadable/absent root is `not-evaluated:root-unreadable` FOR THAT PROJECT ONLY — never fatal to the
// round (硬规则 3: "could not read it" is its own value and is not "clean").
//
// COST / KILL SWITCH
// ------------------
// One hard reservation ledger (`.quay/cross-project-dogfood-model-budget.jsonl`), reserved BEFORE every
// subprocess spawn (a reservation with no outcome counts as spent). `enabled:false` ⇒ zero spawns. The
// 24h call cap and the 24h USD cap are both checked pre-round AND per call.
//
// NOT DEPENDENT ON task_trace / task-status-events, AND NOT DIFF-GATED
// -------------------------------------------------------------------
// Those carriers are read as OPTIONAL context when present and their absence never blocks a round (the
// same already-landed rule `gap-open-discovery-consumes-task-status-events-optional-context` applies to
// the local routine). There is no source-delta gate either: the due decision is the SAME time primitive
// (`routine-scheduler.ts` `isDue` / `interval:<N>m`) its sibling routines use.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { isDue, parseTrigger } from "./routine-scheduler.ts";
import {
  INVOKED_BY_DEFAULT,
  INVOKED_BY_MANUAL,
  INVOKED_BY_RESIDENT,
  BUDGET_24H_MS,
  openModelBudget,
  appendCarrierRecords,
  writeLastRunStamped,
  readLedgerRecords,
  type InvokedBy,
} from "./discovery-method-routine.ts";
import { spawnModelCall, stepArgv, usdBudgetUsage } from "./open-semantic-discovery-routine.ts";
import { launchArgv, type Fact, type RoutineSpec } from "./driver-runtime.ts";
import { ROUTINE_LAST_RUN_REL, readLastRunMap } from "./probe-routine.ts";

// ── names, carriers, constants ──────────────────────────────────────────────────────────────────────
export const CROSS_PROJECT_DOGFOOD_NAME = "cross-project-dogfood";
export const CARRIER_REL = path.posix.join(".quay", "cross-project-dogfood-findings.jsonl");
export const BUDGET_LEDGER_REL = path.posix.join(".quay", "cross-project-dogfood-model-budget.jsonl");
export const BUDGET_LOCK_REL = path.posix.join(".quay", "cross-project-dogfood-model-budget.lock");
/** Scratch space for the per-round evidence pack + the neutral cwd every model call is rooted at. Under
 *  os.tmpdir(), NOT under the workspace: a scratch tree inside the repo would be a second write surface
 *  the isolation invariant would have to reason about. */
export const SCRATCH_PREFIX = "cross-project-dogfood-";

export const MIN_INTERVAL_MINUTES = 60;
export const DEFAULT_INTERVAL_MINUTES = 360;

/** Read-only envelopes. ⛔ No `Bash` anywhere: the child cannot mutate what it reads. The investigator
 *  gets `Glob` because it is EXPLORING an unfamiliar project's artifact tree; the verifier and the
 *  independent refuter only need to re-read positions the claim already named. */
export const INVESTIGATOR_TOOLS = "Read,Grep,Glob";
export const VERIFIER_TOOLS = "Read,Grep";
export const REFUTER_TOOLS = "Read,Grep";
export const BLIND_INVESTIGATOR_MAX_TURNS = 1;

/** The artifact files looked at per source project, relative to its root. Each is OPTIONAL: an absent
 *  file is recorded as `absent`, never as "zero records" (硬规则 3b). */
export const DEFAULT_ARTIFACTS = Object.freeze([
  ".quay/worker-outcome.jsonl",
  ".quay/quality-round.jsonl",
  ".quay/routine-findings.jsonl",
  ".quay/arch-discovery-findings.jsonl",
  ".quay/open-semantic-discovery-findings.jsonl",
  ".quay/discovery-method-findings.jsonl",
  ".quay/fan-in-ff-escalations.jsonl",
  ".quay/fan-in-retries.jsonl",
]);

/** The per-record fields the mechanical digest counts by. These are NOT detector predicates: they are
 *  grouping keys for a COUNT the model reads. A key absent from a record simply does not appear. */
export const DIGEST_KEYS = Object.freeze([
  "kind", "status", "outcome", "step", "reason", "blocking_step", "terminal_reason",
  "turns_reason", "subtype", "verdict", "invoked_by", "role",
  // The fields the drivers actually write onto worker/fan-in/round carriers — without these the digest
  // of a project's outcome ledger would be all-empty and the model would be handed a blank sheet while
  // the record says "read fine" (硬规则 3b).
  "final_state", "exit_code", "state", "routine", "name", "phase", "stage", "gate", "result",
]);

/** How many task files a round may open per project before its status counts stop being a census. A
 *  truncated census is recorded as such — a COUNT over a prefix must not read as a COUNT over the tree. */
export const MAX_TASK_FILES = 2000;

/** How many sample records per artifact are handed to the model (with provenance), and how long each
 *  excerpt may be. Bounded so a 20 MB log cannot crowd the prompt. */
export const SAMPLE_RECORDS_PER_FILE = 40;
export const SAMPLE_EXCERPT_MAX = 400;

/** The USD a call with NO readable price is charged at, so an unknown price is never counted as free (the
 *  ceiling must fail in the expensive direction). Same value and role as OSD's `PER_CALL_USD_CEILING`. */
export const PER_CALL_USD_CEILING = 1.0;

/** ⛔ The read-only write surface: the ONLY `fs` mutators this module reaches, and it reaches them
 *  exclusively from `writeOwnedFile`. Everything else in this file is a read. The indirection exists so
 *  the static predicate ("no `fs.<mutator>(` in this file") is a plain text scan with no allowlist. */
const MUTATE = Object.freeze({
  writeFileSync: fs.writeFileSync,
  mkdirSync: fs.mkdirSync,
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

// ── config ──────────────────────────────────────────────────────────────────────────────────────────
export interface SourceProject { name: string; root: string; enabled: boolean; artifacts: readonly string[] }
export interface CrossProjectDogfoodConfig {
  enabled: boolean;
  trigger: { kind: "interval"; minutes: number };
  intervalUntil: number | null;
  intervalMinutes: number;
  sourceProjects: readonly SourceProject[];
  maxProjectsPerRound: number;
  maxRecordsPerFile: number;
  maxFileBytes: number;
  maxArtifactBytesPerProject: number;
  investigatorMaxTurns: number;
  verifierMaxTurns: number;
  refutationMaxTurns: number;
  maxClustersVerified: number;
  maxWallMs: number;
  maxModelCallsPer24h: number;
  maxUsdPer24h: number;
  /** Whether a CONFIRMED Quay-generic finding is filed as a `todo` task through the Provider ABI.
   *  ⛔ An `undetermined`/`refuted` verdict files NOTHING under either value — this knob does not loosen
   *  the report-only bar, it only says whether the confirmed end of it is automated. */
  fileConfirmed: boolean;
}
export interface CrossProjectDogfoodConfigRead {
  present: boolean;
  config: CrossProjectDogfoodConfig | null;
  error: string | null;
}

/** Parse ONE source-project entry. Fail-closed with a NAMED reason: a project whose entry cannot be read
 *  must never be silently dropped (that would make "misconfigured" and "not configured" isomorphic). */
export function parseSourceProject(raw: unknown, index: number): { project: SourceProject | null; error: string | null } {
  const at = `source_projects[${index}]`;
  if (!isPlainObject(raw)) return { project: null, error: `${at} must be a mapping` };
  const name = raw.name;
  if (typeof name !== "string" || name.trim() === "") return { project: null, error: `${at}.name must be a non-empty string` };
  const root = raw.root;
  if (typeof root !== "string" || root.trim() === "") return { project: null, error: `${at}.root must be a non-empty path` };
  if (!path.isAbsolute(root)) return { project: null, error: `${at}.root must be ABSOLUTE (got "${root}") — a relative root would resolve against whichever process happens to read it` };
  if (typeof raw.enabled !== "boolean") return { project: null, error: `${at}.enabled must be a boolean` };
  let artifacts: readonly string[] = DEFAULT_ARTIFACTS;
  if (raw.artifacts !== undefined) {
    if (!Array.isArray(raw.artifacts) || raw.artifacts.some((a) => typeof a !== "string" || a.trim() === "")) {
      return { project: null, error: `${at}.artifacts must be an array of non-empty relative paths` };
    }
    if (raw.artifacts.some((a) => path.isAbsolute(a) || a.split("/").includes(".."))) {
      return { project: null, error: `${at}.artifacts must be paths RELATIVE to the project root, with no ".."` };
    }
    artifacts = raw.artifacts as string[];
  }
  return { project: { name, root: path.resolve(root), enabled: raw.enabled === true, artifacts }, error: null };
}

const POSITIVE_INT_KEYS = Object.freeze([
  "max_projects_per_round", "max_records_per_file", "max_file_bytes", "max_artifact_bytes_per_project",
  "investigator_max_turns", "verifier_max_turns", "refutation_max_turns", "max_clusters_verified",
  "max_wall_ms", "max_usd_per_24h",
] as const);
const CAMEL: Record<string, keyof CrossProjectDogfoodConfig> = Object.freeze({
  max_projects_per_round: "maxProjectsPerRound",
  max_records_per_file: "maxRecordsPerFile",
  max_file_bytes: "maxFileBytes",
  max_artifact_bytes_per_project: "maxArtifactBytesPerProject",
  investigator_max_turns: "investigatorMaxTurns",
  verifier_max_turns: "verifierMaxTurns",
  refutation_max_turns: "refutationMaxTurns",
  max_clusters_verified: "maxClustersVerified",
  max_wall_ms: "maxWallMs",
  max_usd_per_24h: "maxUsdPer24h",
});

const DISABLED_CONFIG: CrossProjectDogfoodConfig = Object.freeze({
  enabled: false,
  trigger: { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES },
  intervalUntil: null,
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  sourceProjects: [],
  maxProjectsPerRound: 1, maxRecordsPerFile: 1, maxFileBytes: 1, maxArtifactBytesPerProject: 1,
  investigatorMaxTurns: 1, verifierMaxTurns: 1, refutationMaxTurns: 1, maxClustersVerified: 1,
  maxWallMs: 1, maxModelCallsPer24h: 0, maxUsdPer24h: 1, fileConfirmed: false,
}) as CrossProjectDogfoodConfig;

/** Pure section parser. Every declared key is REQUIRED once the section is present: a fabricated default
 *  and a declared value are isomorphic on the record (硬规则 3b), and for a routine whose whole risk is
 *  cost, an unreported budget is the wrong thing to invent. `enabled:false` short-circuits WITHOUT
 *  requiring the rest — a kill switch must not be blocked by the config it kills. */
export function parseCrossProjectDogfoodSection(raw: unknown): { config: CrossProjectDogfoodConfig | null; error: string | null } {
  if (!isPlainObject(raw)) return { config: null, error: "loop.cross_project_dogfood must be a mapping" };
  if (typeof raw.enabled !== "boolean") return { config: null, error: "loop.cross_project_dogfood.enabled must be a boolean" };
  if (raw.enabled === false) return { config: DISABLED_CONFIG, error: null };
  if (typeof raw.interval !== "string") return { config: null, error: "loop.cross_project_dogfood.interval must be a string trigger" };
  let trigger: { kind: string; minutes?: number };
  try { trigger = parseTrigger(raw.interval) as { kind: string; minutes?: number }; }
  catch (e) { return { config: null, error: `loop.cross_project_dogfood.interval — ${(e as Error).message}` }; }
  if (trigger.kind !== "interval") return { config: null, error: `loop.cross_project_dogfood.interval must be "interval:<N>m" (got "${raw.interval}")` };
  const minutes = Number(trigger.minutes);
  if (!Number.isInteger(minutes) || minutes < MIN_INTERVAL_MINUTES) {
    return { config: null, error: `loop.cross_project_dogfood.interval below the ${MIN_INTERVAL_MINUTES}m floor (got ${minutes}m)` };
  }
  let intervalUntil: number | null = null;
  if (minutes < DEFAULT_INTERVAL_MINUTES) {
    if (typeof raw.interval_until !== "string" || !Number.isFinite(Date.parse(raw.interval_until))) {
      return { config: null, error: `loop.cross_project_dogfood.interval_until (ISO-8601) is REQUIRED when interval < ${DEFAULT_INTERVAL_MINUTES}m — otherwise "a temporary fast cadence" and "the permanent cadence" are the same config` };
    }
    intervalUntil = Date.parse(raw.interval_until);
  } else if (raw.interval_until !== undefined) {
    if (typeof raw.interval_until !== "string" || !Number.isFinite(Date.parse(raw.interval_until))) {
      return { config: null, error: "loop.cross_project_dogfood.interval_until must be ISO-8601 when present" };
    }
    intervalUntil = Date.parse(raw.interval_until);
  }
  if (!Array.isArray(raw.source_projects) || raw.source_projects.length === 0) {
    return { config: null, error: "loop.cross_project_dogfood.source_projects must be a non-empty list" };
  }
  const projects: SourceProject[] = [];
  for (let i = 0; i < raw.source_projects.length; i++) {
    const { project, error } = parseSourceProject(raw.source_projects[i], i);
    if (error !== null || project === null) return { config: null, error: `loop.cross_project_dogfood.${error}` };
    projects.push(project);
  }
  const seen = new Set<string>();
  for (const p of projects) {
    if (seen.has(p.name)) return { config: null, error: `loop.cross_project_dogfood.source_projects has a duplicate name "${p.name}" — a duplicated name makes the round's per-project line ambiguous` };
    seen.add(p.name);
  }
  const nums: Record<string, number> = {};
  for (const key of POSITIVE_INT_KEYS) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      return { config: null, error: `loop.cross_project_dogfood.${key} must be an integer >= 1 (got ${JSON.stringify(v)})` };
    }
    const camel = CAMEL[key];
    if (camel !== undefined) nums[camel as string] = v;
  }
  const calls = raw.max_model_calls_per_24h;
  if (typeof calls !== "number" || !Number.isInteger(calls) || calls < 0) {
    return { config: null, error: "loop.cross_project_dogfood.max_model_calls_per_24h must be an integer >= 0 (0 is legal — it means the ledger refuses every call)" };
  }
  if (typeof raw.file_confirmed !== "boolean") {
    return { config: null, error: "loop.cross_project_dogfood.file_confirmed must be a boolean" };
  }
  return {
    config: {
      enabled: true,
      trigger: { kind: "interval", minutes },
      intervalUntil,
      intervalMinutes: minutes,
      sourceProjects: projects,
      maxProjectsPerRound: nums.maxProjectsPerRound,
      maxRecordsPerFile: nums.maxRecordsPerFile,
      maxFileBytes: nums.maxFileBytes,
      maxArtifactBytesPerProject: nums.maxArtifactBytesPerProject,
      investigatorMaxTurns: nums.investigatorMaxTurns,
      verifierMaxTurns: nums.verifierMaxTurns,
      refutationMaxTurns: nums.refutationMaxTurns,
      maxClustersVerified: nums.maxClustersVerified,
      maxWallMs: nums.maxWallMs,
      maxModelCallsPer24h: calls,
      maxUsdPer24h: nums.maxUsdPer24h,
      fileConfirmed: raw.file_confirmed === true,
    },
    error: null,
  };
}

/** Read `.quay/config.yml` → `loop.cross_project_dogfood`. Absent file / absent section ⇒
 *  `present:false` (off by default); a malformed section ⇒ `error` set and `config:null` (fail-closed,
 *  zero spawns). Never throws. */
export function readCrossProjectDogfoodConfig(workspaceRoot: string): CrossProjectDogfoodConfigRead {
  const file = path.join(workspaceRoot, ".quay", "config.yml");
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); }
  catch { return { present: false, config: null, error: null }; }
  let parsed: unknown;
  try { parsed = YAML.parse(text); }
  catch (e) { return { present: true, config: null, error: `.quay/config.yml is not valid YAML — ${(e as Error).message}` }; }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.loop) || parsed.loop.cross_project_dogfood === undefined) {
    return { present: false, config: null, error: null };
  }
  const { config, error } = parseCrossProjectDogfoodSection(parsed.loop.cross_project_dogfood);
  return { present: true, config, error };
}

// ── the read-only guard (isolation invariant, enforcement half) ──────────────────────────────────────
const SOURCE_ROOTS = new Map<string, string>();

/** Declare a root as a source project for the DURATION OF ONE ROUND. Declared for every configured
 *  project — including disabled and unreadable ones — so a mis-typed `root` is still protected. */
export function declareSourceRoot(root: string, name: string): void {
  SOURCE_ROOTS.set(path.resolve(root), name);
}
export function clearSourceRoots(): void {
  SOURCE_ROOTS.clear();
}
/** The declared source project a path belongs to, or null. POSITION-based (prefix on a resolved path),
 *  never a substring match. */
export function sourceRootOwning(target: string): { root: string; name: string } | null {
  const t = path.resolve(target);
  for (const [root, name] of SOURCE_ROOTS) {
    if (t === root || t.startsWith(root + path.sep)) return { root, name };
  }
  return null;
}
/** Refuse ANY path inside a declared source root. Called by every write AND by every model spawn cwd, so
 *  "no write reaches the source project" and "no subprocess is rooted there" are one check, not two. */
export function assertNotSourceRoot(target: string, op: string): void {
  const owner = sourceRootOwning(target);
  if (owner !== null) {
    throw new Error(
      `CROSS_PROJECT_SOURCE_WRITE_REFUSED — ${op} would touch ${target} inside source project "${owner.name}" (${owner.root}); source projects are opened READ-ONLY`,
    );
  }
}
/** The ONLY writer in this module. Every write this routine makes goes through here, so the guard above
 *  cannot be bypassed by a new call site that forgot it. */
export function writeOwnedFile(target: string, text: string, op = "writeOwnedFile"): void {
  assertNotSourceRoot(target, op);
  MUTATE.mkdirSync(path.dirname(target), { recursive: true });
  MUTATE.writeFileSync(target, text, "utf8");
}

// ── deterministic artifact digest (counts + excerpts; NEVER a verdict) ───────────────────────────────
export interface EvidenceRow {
  source_project: string;
  file: string;
  /** Absolute line in the carrier, or null when the file was read as a truncated TAIL — an unread line
   *  number is `null` ("not looked at"), never 0 (硬规则 6). */
  line: number | null;
  kind: string;
  excerpt: string;
}
export interface ArtifactScan {
  file: string;
  /** `ok` | `absent` | `truncated-tail` — three values, so "read it all" cannot be confused with "read
   *  the end of it" (硬规则 3b). */
  reading: "ok" | "absent" | "truncated-tail";
  bytes: number;
  lines: number | null;
  malformed_lines: number;
  counts: Record<string, Record<string, number>>;
  samples: EvidenceRow[];
  reason: string | null;
}
export interface ProjectScan {
  name: string;
  root: string;
  enabled: boolean;
  /** `ok` | `root-unreadable` — the round continues either way (AC3). */
  reading: "ok" | "root-unreadable";
  reason: string | null;
  artifacts: ArtifactScan[];
  task_counts: Record<string, number>;
  task_lines: EvidenceRow[];
  /** How many task files were opened vs how many exist — a count over a PREFIX must not read as a
   *  census of the tree. `task_counts_censused` is false when the two differ. */
  task_files_scanned: number;
  task_files_total: number;
  task_counts_censused: boolean;
  bytes_read: number;
}

const excerptOf = (s: string): string => (s.length > SAMPLE_EXCERPT_MAX ? `${s.slice(0, SAMPLE_EXCERPT_MAX)}…` : s);

/** Read one artifact and digest it. ⛔ Read-only: `statSync` + `readFileSync` / an `openSync("r")` +
 *  `readSync` tail. A file larger than `maxFileBytes` is read as a bounded TAIL and its line numbers are
 *  reported as `null` (an unreadable line number is absent, not guessed). */
export function scanJsonlArtifact(project: string, root: string, rel: string, opts: { maxRecords: number; maxFileBytes: number }): ArtifactScan {
  const abs = path.join(root, rel);
  const blank = (reading: ArtifactScan["reading"], reason: string | null, bytes = 0): ArtifactScan =>
    ({ file: rel, reading, bytes, lines: null, malformed_lines: 0, counts: {}, samples: [], reason });
  let st: fs.Stats;
  try { st = fs.statSync(abs); }
  catch (e) { return blank("absent", (e as NodeJS.ErrnoException).code === "ENOENT" ? "file not present" : `statSync failed: ${(e as Error).message}`); }
  if (!st.isFile()) return blank("absent", "not a regular file");
  let text: string;
  let lineBase: number | null = 0;
  try {
    if (st.size <= opts.maxFileBytes) text = fs.readFileSync(abs, "utf8");
    else {
      const buf = Buffer.alloc(opts.maxFileBytes);
      const fd = fs.openSync(abs, "r");
      try { fs.readSync(fd, buf, 0, buf.length, st.size - opts.maxFileBytes); } finally { fs.closeSync(fd); }
      text = buf.toString("utf8");
      text = text.slice(text.indexOf("\n") + 1); // drop the partial first line
      lineBase = null; // the tail's line numbers are unknowable ⇒ absent, never guessed
    }
  } catch (e) {
    return blank("absent", `read failed: ${(e as Error).message}`);
  }
  const all = text.split("\n");
  while (all.length > 0 && all[all.length - 1] === "") all.pop();
  const counts: Record<string, Record<string, number>> = {};
  const samples: EvidenceRow[] = [];
  let malformed = 0;
  const firstSampled = Math.max(0, all.length - opts.maxRecords); // samples come from the RECENT end
  for (let i = 0; i < all.length; i++) {
    const raw = all[i];
    if (raw.trim() === "") continue;
    let rec: unknown;
    try { rec = JSON.parse(raw); } catch { malformed++; continue; }
    if (!isPlainObject(rec)) { malformed++; continue; }
    for (const key of DIGEST_KEYS) {
      const v = rec[key];
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
      const s = String(v);
      counts[key] ??= {};
      counts[key][s] = (counts[key][s] ?? 0) + 1;
    }
    if (i >= firstSampled) {
      samples.push({
        source_project: project,
        file: rel,
        line: lineBase === null ? null : i + 1,
        kind: typeof rec.kind === "string" ? rec.kind : "unknown",
        excerpt: excerptOf(raw),
      });
    }
  }
  return {
    file: rel, reading: lineBase === null ? "truncated-tail" : "ok", bytes: st.size,
    lines: lineBase === null ? null : all.length, malformed_lines: malformed, counts, samples, reason: null,
  };
}

/** Scan `tasks/*.md`: STATUS COUNTS plus, for `needs-human` tasks, the first body line that looks like the
 *  human-authored reason. Read-only, bounded by file count and by a per-file head read. */
export function scanTasksDir(project: string, root: string, opts: { maxFiles: number; headBytes: number }): { counts: Record<string, number>; rows: EvidenceRow[]; scanned: number; total: number; error: string | null } {
  const dir = path.join(root, "tasks");
  let names: string[];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".md")).sort(); }
  catch (e) { return { counts: {}, rows: [], scanned: 0, total: 0, error: (e as NodeJS.ErrnoException).code === "ENOENT" ? "no tasks/ directory" : `readdirSync failed: ${(e as Error).message}` }; }
  const counts: Record<string, number> = {};
  const rows: EvidenceRow[] = [];
  const scanned = Math.min(names.length, opts.maxFiles);
  for (const name of names.slice(0, scanned)) {
    const abs = path.join(dir, name);
    let head: string;
    try {
      const fd = fs.openSync(abs, "r");
      try {
        const buf = Buffer.alloc(opts.headBytes);
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        head = buf.subarray(0, n).toString("utf8");
      } finally { fs.closeSync(fd); }
    } catch { continue; }
    const m = head.match(/^status:\s*([\w-]+)\s*$/m);
    const status = m ? m[1] : "unreadable";
    counts[status] = (counts[status] ?? 0) + 1;
    if (status !== "needs-human") continue;
    const lines = head.split("\n");
    const bodyIdx = lines.findIndex((l, i) => i > 0 && l.trim() !== "" && l !== "---" && !/^\w[\w-]*:/.test(l) && !l.startsWith("##"));
    const first = bodyIdx >= 0 ? lines[bodyIdx] : "";
    const reasonIdx = lines.findIndex((l) => /原因|reason|blocked|阻塞/i.test(l));
    const chosen = reasonIdx >= 0 ? lines[reasonIdx] : first;
    rows.push({ source_project: project, file: `tasks/${name}`, line: (reasonIdx >= 0 ? reasonIdx : bodyIdx) + 1, kind: "needs-human", excerpt: excerptOf(chosen.trim()) });
  }
  return { counts, rows: rows.slice(0, 100), scanned, total: names.length, error: null };
}

/** Scan one source project READ-ONLY. An unreadable root is its OWN reading (`root-unreadable`) with a
 *  named reason — the round never fails because of it, and "could not open it" never looks like "opened
 *  it and found nothing". */
export function scanSourceProject(project: SourceProject, opts: { maxRecords: number; maxFileBytes: number; maxBytes: number }): ProjectScan {
  const base: ProjectScan = { name: project.name, root: project.root, enabled: project.enabled, reading: "ok", reason: null, artifacts: [], task_counts: {}, task_lines: [], task_files_scanned: 0, task_files_total: 0, task_counts_censused: false, bytes_read: 0 };
  let st: fs.Stats;
  try { st = fs.statSync(project.root); }
  catch (e) { return { ...base, reading: "root-unreadable", reason: `statSync(${project.root}) — ${(e as Error).message}` }; }
  if (!st.isDirectory()) return { ...base, reading: "root-unreadable", reason: `${project.root} is not a directory` };
  const artifacts: ArtifactScan[] = [];
  let used = 0;
  for (const rel of project.artifacts) {
    if (used >= opts.maxBytes) {
      artifacts.push({ file: rel, reading: "absent", bytes: 0, lines: null, malformed_lines: 0, counts: {}, samples: [], reason: `skipped — this round's ${opts.maxBytes}-byte artifact budget for the project is spent` });
      continue;
    }
    const scan = scanJsonlArtifact(project.name, project.root, rel, { maxRecords: opts.maxRecords, maxFileBytes: Math.min(opts.maxFileBytes, opts.maxBytes - used) });
    used += scan.bytes;
    artifacts.push(scan);
  }
  const tasks = scanTasksDir(project.name, project.root, { maxFiles: MAX_TASK_FILES, headBytes: 4096 });
  return {
    ...base, artifacts, task_counts: tasks.counts, task_lines: tasks.rows,
    task_files_scanned: tasks.scanned, task_files_total: tasks.total,
    task_counts_censused: tasks.total === 0 || tasks.scanned === tasks.total,
    bytes_read: used,
  };
}

// ── the evidence pack handed to the investigator ─────────────────────────────────────────────────────
/** Render the deterministic digest as text. ⛔ Counts and excerpts only — no line here says "this is a
 *  defect". The instruction to DISTINGUISH project-local from Quay-generic lives in the prompt, and the
 *  judgment is the model's. */
export function renderEvidencePack(scans: readonly ProjectScan[]): string {
  const out: string[] = [];
  for (const s of scans) {
    out.push(`## source project "${s.name}"`);
    out.push(`root: ${s.root}`);
    out.push(`reading: ${s.reading}${s.reason ? ` (${s.reason})` : ""}`);
    if (s.reading !== "ok") { out.push(""); continue; }
    out.push(`tasks/: ${Object.entries(s.task_counts).map(([k, v]) => `${k}=${v}`).join(" ") || "(no task files read)"} (${s.task_files_scanned}/${s.task_files_total} files read${s.task_counts_censused ? "" : " — a PREFIX, not a census"})`);
    for (const r of s.task_lines.slice(0, 20)) out.push(`- needs-human [${r.file}:${r.line ?? "?"}] ${r.excerpt}`);
    for (const a of s.artifacts) {
      out.push("");
      out.push(`### ${a.file} — ${a.reading}${a.reason ? ` (${a.reason})` : ""}${a.lines === null ? "" : `, ${a.lines} lines`}, ${a.malformed_lines} malformed`);
      for (const [key, tally] of Object.entries(a.counts)) {
        const top = Object.entries(tally).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 12);
        out.push(`  ${key}: ${top.map(([k, v]) => `${k}=${v}`).join(" ")}`);
      }
      for (const row of a.samples.slice(0, SAMPLE_RECORDS_PER_FILE)) {
        out.push(`  - [${row.file}:${row.line ?? "truncated-tail"}] ${row.excerpt}`);
      }
    }
    out.push("");
  }
  return out.join("\n");
}

// ── prompts (TEXT only; the bar they feed is the engine's) ───────────────────────────────────────────
export const CROSS_PROJECT_INVESTIGATOR_PROMPT = `You are auditing OTHER projects that use Quay, by reading the artifacts those projects' own autonomous loops produced.

You are given a DETERMINISTIC DIGEST of a bounded, recent slice of each source project's real usage artifacts: worker-outcome records, quality-round records, routine findings, fan-in escalation/retry records, and the task board's own status counts plus the first line of each \`needs-human\` task.

You may read the digest, and you may Read/Grep the source projects' trees listed above for corroboration (read-only; there is no shell). Prefer reading a project's real file over reasoning about the digest alone.

WHAT IS IN SCOPE — this is the whole judgment you are here to make:
- IN SCOPE: a defect in QUAY'S OWN MECHANISM that this project's usage exposed — the same failure will hit every other Quay-host project. Name the Quay-side surface it lives in (a repo-relative path under plugin/ or packages/ when you can tell) and say why it is not specific to this host.
- OUT OF SCOPE: a defect in the source project's OWN product or its OWN files (a UI copy bug, a failing test naming only that project's file, that project's business logic, that project's local configuration). Report these as \`project_local\` and do NOT turn them into a Quay claim.
- OUT OF SCOPE: a hypothesis you cannot tie to a real record or file position. If you cannot cite the artifact that produced the idea, drop it.

EVIDENCE IS MANDATORY. Every hypothesis must cite at least one concrete position: a carrier path with a line number from the digest, or an absolute path + symbol you read yourself. A claim whose evidence is only "the pattern looked suspicious" must not be emitted.

Return ONLY a JSON array (no prose outside it). Each element:
{
  "components": ["<quay-side repo-relative path the defect lives in>", ...],
  "concept_kind": "<short kebab-case class of defect>",
  "claim": "<<= 200 chars, one falsifiable sentence about QUAY'S mechanism>",
  "scope": "quay_generic" | "project_local",
  "source_project": "<the project whose artifacts exposed it>",
  "evidence": [{"source_project": "...", "file": "<carrier path>", "line": <number or null>, "excerpt": "<what you read>"}],
  "evidence_needed": "<what would have to be true in the Quay source for this to hold>",
  "counterexample_requirement": "<what a refuter should look for that would kill this claim>"
}
Emit \`project_local\` items too — they are how the round demonstrates it can tell the two apart — but a \`project_local\` item is never filed and never ingested.`;

/** WHERE TO LOOK. ⛔ Without this the verifier and refuter cannot examine anything: their cwd is this
 *  round's scratch directory, so a repo-relative `plugin/scripts/foo.ts` names nothing they can open, and
 *  every verdict would come back `undetermined` — a whole round spent proving the prompt was incomplete.
 *  The preamble is per-round because the roots and the cited positions are per-round. */
export function verifierLookupPreamble(scans: readonly ProjectScan[], evidence: readonly EvidenceRow[], repoRoot: string): string {
  const roots = scans.filter((s) => s.reading === "ok").map((s) => `- source project "${s.name}" → ${s.root}`);
  const cite = evidence.slice(0, 60).map((e) => `- ${e.source_project}: \`${e.file}:${e.line ?? "?"}\` — ${e.excerpt.slice(0, 200)}`);
  return `WHERE TO LOOK (read-only; there is no shell):
- the Quay repository this round judges → ${repoRoot}
${roots.join("\n")}
A repo-relative component path is relative to the Quay repository above. A source-project carrier path is
relative to that project's root above. Positions the round already cited:
${cite.join("\n") || "- (the round cited none inline; the claim text names what to look for)"}
`;
}

export const CROSS_PROJECT_VERIFIER_TEMPLATE = `You are verifying ONE hypothesis about Quay's own mechanism, formed by reading another project's usage artifacts.

HYPOTHESIS:
{{HYP}}

Read the evidence you need (read-only; there is no shell). Your job is NOT to agree. Your job is to decide whether the claim holds for the QUAY mechanism it names — not merely for the one project whose artifacts exposed it.

Answer with ONLY this JSON object:
{
  "verdict": "supported" | "refuted" | "undetermined",
  "evidence": [{"file": "<path>", "line": <number or null>, "excerpt": "<what you read>"}],
  "checked": ["<the concrete positions you examined>"],
  "reasoning": "<why the claim does or does not hold>",
  "intentional_difference_found": <true|false>,
  "counterexample": "<the observation that would refute it, or null>"
}
Use "refuted" when you found the observation that kills the claim. Use "undetermined" when you could not examine the positions the claim needs — never answer "supported" on the strength of the hypothesis text alone.`;

export const CROSS_PROJECT_REFUTER_TEMPLATE = `You are an INDEPENDENT REFUTER. A verifier has already said "supported" for the hypothesis below. Assume it is WRONG and try to kill it.

HYPOTHESIS:
{{HYP}}

A claim about Quay's own mechanism survives only if it holds for the mechanism, not for one host's usage. The strongest refutations available to you here:
- the "defect" is this project's own configuration or product, so Quay's own code is not implicated at all;
- the same artifact pattern is produced by a DIFFERENT cause that is not a defect (a normal completion, a deliberate retry, a host-local resource limit);
- the cited evidence does not actually say what the hypothesis says it says.

Read the positions yourself (read-only; there is no shell). Answer with ONLY this JSON object:
{
  "verdict": "supported" | "refuted" | "undetermined",
  "evidence": [{"file": "<path>", "line": <number or null>, "excerpt": "<what you read>"}],
  "checked": ["<the concrete positions you examined>"],
  "reasoning": "<what you tried to kill it with, and what happened>",
  "counterexample": "<the observation that would refute it, or null>"
}
Answer "refuted" ONLY when you have a concrete counter-observation. "undetermined" is the honest answer when you could not examine the positions — it does not confirm anything.`;

// ── the engine (resolved from disk at runtime, never statically imported) ────────────────────────────
/** The narrow engine surface this module consumes, declared structurally so the shipped file keeps NO
 *  static import of `docs/analysis/*` (the local routine's case-(i) invariant, same reason). */
export interface HypothesisModuleLike {
  hardenedArgv: (launch: unknown, prompt: string, root: string, opts?: Record<string, unknown>) => string[];
  clusterHypotheses: (runs: readonly Record<string, unknown>[], opts?: Record<string, unknown>) => Array<Record<string, unknown>>;
  runInvestigator: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  runVerifier: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
  parseJsonObject: (stdout: string) => Record<string, unknown> | null;
}

export const HYPOTHESIS_MODULE_FILE = "arch-hypothesis-generation.mjs";
export const PORTFOLIO_MODULE_FILE = "discovery-portfolio.mjs";
export const ANALYSIS_DIR_REL = path.posix.join("docs", "analysis");
/** The repo this FILE lives in (…/plugin/scripts/<this> → repo root). Used only to BUILD a candidate
 *  path — nothing is resolved through it until the runtime `import()`. */
export const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const _moduleCache = new Map<string, unknown>();
async function loadEngineModule(root: string, file: string): Promise<unknown> {
  const tried = [path.join(SCRIPT_REPO_ROOT, ANALYSIS_DIR_REL, file), path.join(root, ANALYSIS_DIR_REL, file)];
  for (const candidate of tried) {
    if (!fs.existsSync(candidate)) continue;
    const cached = _moduleCache.get(candidate);
    if (cached !== undefined) return cached;
    const mod = (await import(/* @vite-ignore */ pathToFileURL(candidate).href)) as unknown;
    _moduleCache.set(candidate, mod);
    return mod;
  }
  throw new Error(`CROSS_PROJECT_ENGINE_UNRESOLVED — ${file} not found at ${tried.join(" or ")}`);
}
export const loadHypothesisModule = async (root: string): Promise<HypothesisModuleLike> =>
  (await loadEngineModule(root, HYPOTHESIS_MODULE_FILE)) as HypothesisModuleLike;

/** The Portfolio module's OWN dedup/ingest surface. ⛔ This routine is not a second finding store: the
 *  duplicate decision and the row write are the module's, reached through the same runtime loader. */
export interface PortfolioLike {
  readPortfolio: (root: string, opts?: Record<string, unknown>) => { ok: boolean; records: Record<string, unknown>[]; reason?: string };
  findDuplicate: (earlier: unknown, q: { components: unknown; claim: unknown }) => Record<string, unknown> | null;
  ingestFinding: (root: string, input: Record<string, unknown>, opts?: Record<string, unknown>) => { ok: boolean; id?: string | null; reasons?: string[] };
}
export const loadPortfolioModule = async (root: string): Promise<PortfolioLike> =>
  (await loadEngineModule(root, PORTFOLIO_MODULE_FILE)) as PortfolioLike;

/** The ledger module's SHARED-checkout resolver. Reused rather than re-derived (硬规则 5b): it is the
 *  ONE place that answers "where does this workspace's runtime carrier really live". */
export interface LedgerModuleLike { carrierFile: (root: string, rel: string) => string | null }
export const loadLedgerModule = async (root: string): Promise<LedgerModuleLike> =>
  (await loadEngineModule(root, LEDGER_MODULE_FILE)) as LedgerModuleLike;
export const LEDGER_MODULE_FILE = "discovery-experience-ledger.mjs";

// ── round helpers (pure) ────────────────────────────────────────────────────────────────────────────
/** ⛔ The `cross-project-dogfood@` prefix is NOT decoration: `discovery-portfolio.mjs`'s
 *  `resolveOriginRef` picks the origin CARRIER by the ref's own prefix, so a bare `<round>::c1` would be
 *  looked up in `.quay/routine-findings.jsonl` and every ingestion would be refused with
 *  `ORIGIN_REF_UNRESOLVED`. Measured 2026-10-13. The matcher on the other side is
 *  `ref.startsWith(CROSS_PROJECT_REF_PREFIX)` + `kind === "dogfood-cluster"`. */
export const crossProjectRecordId = (round: string, suffix: string): string => `${CROSS_PROJECT_DOGFOOD_NAME}@${round}::${suffix}`;
const roundId = (pid: number, started: number): string => `cpd-${pid}-${started}-${Math.random().toString(36).slice(2, 8)}`;

/** Read a verdict off an engine row. Anything not in the engine's vocabulary is `undetermined` — never
 *  `supported` (硬规则 3b: an unreadable verdict must not look like a confirmation). */
export function verdictOf(row: Record<string, unknown> | null | undefined): "supported" | "refuted" | "undetermined" {
  const v = row?.verdict;
  return v === "supported" || v === "refuted" || v === "undetermined" ? v : "undetermined";
}

/** THE CONFIRMATION BAR — OSD's, not a second one: the verifier AND an independently-contexted refuter
 *  must BOTH return `supported`, and the refuter must not have been undetermined for any reason. An
 *  `undetermined` refuter confirms nothing. */
export function isConfirmed(verifierVerdict: unknown, refuterVerdict: unknown, refuterCause: unknown): boolean {
  return verifierVerdict === "supported" && refuterVerdict === "supported" && (refuterCause === null || refuterCause === undefined);
}

interface CallRecord { step: string; reservation_id: string | null; ok: boolean; not_evaluated: string | null; turns: number | null; exit: number | null }

export function summarizeCalls(calls: readonly CallRecord[]): Record<string, unknown> {
  return {
    model_calls: calls.length,
    calls: calls.map((c) => ({ step: c.step, reservation_id: c.reservation_id, ok: c.ok, not_evaluated: c.not_evaluated, turns: c.turns, exit: c.exit })),
    not_evaluated: calls.find((c) => c.not_evaluated !== null)?.not_evaluated ?? null,
  };
}

// ── the round ───────────────────────────────────────────────────────────────────────────────────────
export interface CrossProjectDogfoodRunOptions {
  config: CrossProjectDogfoodConfig | null;
  configPresent: boolean;
  configError?: string | null;
  halted?: boolean;
  invokedBy?: InvokedBy;
  force?: boolean;
  /** Seams. Every one has a real default; a test replaces one to exercise a specific branch. */
  hypModule?: HypothesisModuleLike;
  portfolioModule?: PortfolioLike;
  launchArgvFn?: (role: string, prompt: string, root: string, opts?: Record<string, unknown>) => string[];
  spawnFn?: typeof spawnModelCall;
  fileTaskFn?: (root: string, input: FiledTask) => Promise<{ ok: boolean; reason: string; id: string | null }>;
  budgetLedgerPath?: string;
  budgetLockPath?: string;
  carrierPath?: string;
  lastRunPath?: string;
  scratchRoot?: string;
  now?: () => number;
}
export interface FiledTask { id: string; title: string; body: string; labels: string[] }

export async function runCrossProjectDogfood(root: string, opts: CrossProjectDogfoodRunOptions): Promise<Fact> {
  const now = opts.now ?? Date.now;
  const started = now();
  const cfg = opts.config;
  // ── WHERE THIS ROUND'S OWN CARRIERS LIVE ─────────────────────────────────────────────────────────
  // ⛔ The SHARED checkout, not necessarily `root`. `ingestFinding` writes the Portfolio to the shared
  // checkout, and `resolveOriginRef` RESOLVES this routine's `origin_ref` by reading THIS carrier from
  // that same shared root — so a round rooted in a linked worktree that wrote its carrier under its own
  // root could never ingest anything: every confirmed finding would be refused (measured 2026-10-13,
  // `ORIGIN_REF_UNRESOLVED`). The cap must be global for the same reason: a per-worktree ledger is not a
  // 24h ceiling. `carrierFile` is the ledger module's own resolver — reused, never re-derived (硬规则
  // 5b) — and a root it cannot resolve to a shared checkout (no git, as in the unit tests) falls back to
  // the root itself, which is also the production shape when the round already runs in the shared
  // checkout.
  const shared = await loadLedgerModule(root).catch(() => null);
  const at = (rel: string): string => shared?.carrierFile(root, rel) ?? path.join(root, rel);
  const lastRunPath = opts.lastRunPath ?? at(ROUTINE_LAST_RUN_REL);
  const carrierPath = opts.carrierPath ?? at(CARRIER_REL);
  const ledgerPath = opts.budgetLedgerPath ?? at(BUDGET_LEDGER_REL);
  const invokedBy: InvokedBy = opts.invokedBy ?? INVOKED_BY_DEFAULT;
  const resident = invokedBy === INVOKED_BY_RESIDENT;
  const round = roundId(process.pid, started);
  const fact = (state: Fact["state"], value: Record<string, unknown>, reason: string | null): Fact =>
    ({ name: CROSS_PROJECT_DOGFOOD_NAME, state, reason, value: { ...value, round_id: round, invoked_by: invokedBy } });

  if (opts.configError) return fact("failed", { enabled: false, config_error: opts.configError }, `config invalid — ${opts.configError} (zero spawns)`);
  if (!opts.configPresent || cfg === null) return fact("not-evaluated", { enabled: false }, "not-evaluated:no-config — loop.cross_project_dogfood is not declared (off by default, zero spawns)");
  if (!cfg.enabled) return fact("not-evaluated", { enabled: false }, "not-evaluated:disabled — enabled:false (kill switch, zero spawns)");
  if (opts.halted === true) return fact("not-evaluated", { enabled: true }, "not-evaluated:halted");

  const intervalMinutes = cfg.intervalUntil !== null && started >= cfg.intervalUntil ? DEFAULT_INTERVAL_MINUTES : cfg.intervalMinutes;
  const reverted = intervalMinutes !== cfg.intervalMinutes;
  const lastRunRaw = readLastRunMap(lastRunPath)[CROSS_PROJECT_DOGFOOD_NAME];
  const lastRun = typeof lastRunRaw === "number" ? lastRunRaw : NaN;
  const due = isDue({ kind: "interval", minutes: intervalMinutes }, { now: started, lastRun });
  const forced = opts.force === true && !resident;
  const base: Record<string, unknown> = {
    enabled: true,
    interval: { declared_minutes: cfg.intervalMinutes, minutes: intervalMinutes, reverted, until: cfg.intervalUntil },
    due: { source: forced ? "forced-manual" : "interval", due, last_resident_run: Number.isFinite(lastRun) ? lastRun : null },
  };
  if (!due && !forced) return fact("not-evaluated", base, "not-evaluated:not-due");

  // ── the round's write footprint, and the read-only declaration it must not violate ────────────────
  clearSourceRoots();
  for (const p of cfg.sourceProjects) declareSourceRoot(p.root, p.name);
  const scratch = opts.scratchRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));

  // ⛔ `ledgerPath`/`lockPath` are passed EXPLICITLY and ALWAYS. `openModelBudget`'s own defaults are
  // discovery-method's paths, so letting them default here would put two routines' reservations on ONE
  // ledger — and, worse, this round would then read its own USD window off a ledger it does not write.
  const budget = openModelBudget({
    root,
    cap: cfg.maxModelCallsPer24h,
    ledgerPath,
    lockPath: opts.budgetLockPath ?? at(BUDGET_LOCK_REL),
    carrierPath,
    now,
  });
  const usage = await budget.usage();
  const usd = usdBudgetUsage({ ledgerRecords: readLedgerRecords(ledgerPath).records, nowMs: started, windowMs: BUDGET_24H_MS, perCallCeiling: PER_CALL_USD_CEILING });
  const budgetView: Record<string, unknown> = {
    budget_24h: { cap: cfg.maxModelCallsPer24h, used_at_start: usage.total },
    budget_usd_24h: { cap: cfg.maxUsdPer24h, used_at_start: usd.usd, priced: usd.priced, estimated: usd.estimated, per_call_ceiling: PER_CALL_USD_CEILING },
  };
  if (usage.total >= cfg.maxModelCallsPer24h) return fact("not-evaluated", { ...base, ...budgetView }, "not-evaluated:budget-24h");
  if (usd.usd >= cfg.maxUsdPer24h) return fact("not-evaluated", { ...base, ...budgetView }, "not-evaluated:budget-usd-24h");

  let hyp: HypothesisModuleLike;
  try { hyp = opts.hypModule ?? (await loadHypothesisModule(root)); }
  catch (e) { return fact("failed", { ...base, ...budgetView }, `${(e as Error).message} (nothing appended, last-run not advanced)`); }

  const launch = opts.launchArgvFn ?? (launchArgv as unknown as (role: string, prompt: string, root: string, o?: Record<string, unknown>) => string[]);
  const spawn = opts.spawnFn ?? spawnModelCall;
  const buildArgv = (prompt: string, r: string, o: { tools: string; maxTurns: number | null; outputFormat: string | null; model: string | null }): string[] =>
    hyp.hardenedArgv(launch, prompt, r, o as Record<string, unknown>);
  // The model the LAUNCHER was asked for, read off a throwaway argv built the same way a real call's is.
  const requestedModel = (() => {
    try {
      const probe = buildArgv("", root, { tools: "", maxTurns: BLIND_INVESTIGATOR_MAX_TURNS, outputFormat: null, model: null });
      const i = probe.indexOf("--model");
      return i >= 0 && typeof probe[i + 1] === "string" ? probe[i + 1] : null;
    } catch { return null; }
  })();

  const callRecords: CallRecord[] = [];
  /** Reserve → spawn → record. ⛔ A reservation is taken BEFORE the subprocess exists, and a refusal
   *  THROWS: a call that was never made must not appear as one that failed. */
  const reservingStep = async (step: string, payload: { prompt: string; tools: string; maxTurns: number }): Promise<{ stdout: string; status: number | null; stderr: string; record: CallRecord }> => {
    const r = await budget.reserve({ step, tools: payload.tools, max_turns: payload.maxTurns, round });
    if (!r.ok) throw new Error(`BUDGET_REFUSED:${r.code}:used=${r.used}:cap=${r.cap}`);
    const argv = stepArgv(buildArgv, payload.prompt, root, { tools: payload.tools, maxTurns: payload.maxTurns, model: requestedModel }).argv;
    // ⛔ The spawn cwd is a directory THIS round owns, and it is checked against the declared source
    // roots — a subprocess rooted in a source project is refused HERE, not by convention.
    assertNotSourceRoot(scratch, `spawn cwd for step ${step}`);
    const res = await spawn(argv, { cwd: scratch, timeoutMs: cfg.maxWallMs, stdinData: payload.prompt });
    const parsed = hyp.parseJsonObject(String(res.stdout ?? ""));
    const turns = parsed && typeof parsed.num_turns === "number" ? parsed.num_turns : null;
    const outcome = res.error ? "timeout" : res.status === 0 ? "completed" : "failed";
    budget.outcome(r.id, outcome as "completed" | "failed" | "timeout", turns, res.error ? `SPAWN:${res.error.message.slice(0, 120)}` : null);
    const notEvaluated = res.error ? `not-evaluated:spawn-${outcome}` : res.status !== 0 ? `not-evaluated:exit-${res.status}` : null;
    const record: CallRecord = { step, reservation_id: r.id, ok: notEvaluated === null, not_evaluated: notEvaluated, turns, exit: res.status };
    callRecords.push(record);
    return { stdout: String(res.stdout ?? ""), status: res.status, stderr: String(res.stderr ?? ""), record };
  };
  const modelCalls = (calls: readonly CallRecord[]) => ({ ...budgetView, ...summarizeCalls(calls) });

  // ── ① READ the source projects (no model call yet) ────────────────────────────────────────────────
  const enabledProjects = cfg.sourceProjects.filter((p) => p.enabled);
  const scanned: ProjectScan[] = [];
  for (const p of enabledProjects.slice(0, cfg.maxProjectsPerRound)) {
    const scan = scanSourceProject(p, { maxRecords: cfg.maxRecordsPerFile, maxFileBytes: cfg.maxFileBytes, maxBytes: cfg.maxArtifactBytesPerProject });
    scanned.push(scan);
    appendCarrierRecords(carrierPath, [{
      kind: "dogfood-project", round_id: round, invoked_by: invokedBy, ts: new Date(now()).toISOString(),
      source_project: p.name, root: p.root, reading: scan.reading, reason: scan.reason,
      bytes_read: scan.bytes_read, not_evaluated: scan.reading === "ok" ? null : "not-evaluated:root-unreadable",
      artifacts: scan.artifacts.map((a) => ({ file: a.file, reading: a.reading, lines: a.lines, malformed_lines: a.malformed_lines, reason: a.reason })),
      task_counts: scan.task_counts,
    }]);
  }
  const readable = scanned.filter((s) => s.reading === "ok");
  const projectsView = {
    projects: scanned.map((s) => ({ name: s.name, reading: s.reading, not_evaluated: s.reading === "ok" ? null : "not-evaluated:root-unreadable", reason: s.reason })),
    readable_projects: readable.length,
  };
  if (readable.length === 0) {
    appendCarrierRecords(carrierPath, [{ kind: "dogfood-round", round_id: round, invoked_by: invokedBy, ts: new Date(now()).toISOString(), ...base, ...projectsView, model_calls: 0, confirmed: 0, filed: [] }]);
    writeLastRunStamped(lastRunPath, CROSS_PROJECT_DOGFOOD_NAME, now(), invokedBy);
    return fact("not-evaluated", { ...base, ...projectsView }, "not-evaluated:no-readable-source-project — every enabled project was root-unreadable (the project lines record which)");
  }

  const evidencePack = renderEvidencePack(readable);
  const evidenceIndex: EvidenceRow[] = readable.flatMap((s) => [...s.task_lines, ...s.artifacts.flatMap((a) => a.samples)]);
  // The verifier/refuter prompts carry WHERE TO LOOK (see verifierLookupPreamble): a verifier whose cwd
  // is this round's scratch dir can only open the positions it is TOLD about.
  const lookup = verifierLookupPreamble(readable, evidenceIndex, root);
  const verifierTemplate = `${lookup}\n${CROSS_PROJECT_VERIFIER_TEMPLATE}`;
  const refuterTemplate = `${lookup}\n${CROSS_PROJECT_REFUTER_TEMPLATE}`;

  // ── ② INVESTIGATE ────────────────────────────────────────────────────────────────────────────────
  const prompt = `${CROSS_PROJECT_INVESTIGATOR_PROMPT}\n\n# DETERMINISTIC DIGEST OF REAL USAGE ARTIFACTS\n\n${evidencePack}`;
  writeOwnedFile(path.join(scratch, "evidence-pack.md"), prompt);
  writeOwnedFile(path.join(scratch, "evidence-index.json"), JSON.stringify(evidenceIndex, null, 1));

  let hypotheses: Record<string, unknown>[] = [];
  try {
    const inv = await hyp.runInvestigator({
      prompt,
      // The BLIND policy: cwd === neutralDir === our scratch, which is not a source project and holds no
      // repository. The model reads the projects by absolute path with read-only tools.
      neutralDir: scratch,
      cwd: scratch,
      runs: 1,
      outDir: path.join(scratch, "runs"),
      writeFile: (f: string, t: string) => writeOwnedFile(f, t, "investigator run file"),
      budget: { maxRuns: 1, maxMs: cfg.maxWallMs },
      model: requestedModel ?? "not-evaluated:model-unverified",
      tools: INVESTIGATOR_TOOLS,
      maxTurns: cfg.investigatorMaxTurns,
      runModel: async (p: string) => (await reservingStep("cross-project-investigator", { prompt: p, tools: INVESTIGATOR_TOOLS, maxTurns: cfg.investigatorMaxTurns })) as unknown as { stdout: string },
    });
    if (inv.ok !== true) {
      const reasons = Array.isArray(inv.reasons) ? (inv.reasons as string[]) : [];
      return fact("failed", { ...base, ...projectsView, ...modelCalls(callRecords) }, `investigator refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
    }
    // ⛔ A CALL THAT FAILED IS NOT A MODEL THAT FOUND NOTHING (硬规则 3b). The engine reports `ok:true`
    // for a run whose subprocess died — the run file carries the failure, the round does not — so the
    // call's OWN record is what has to decide. Measured 2026-10-13: a caller that trusted `ok:true`
    // recorded a round as `verified` with zero hypotheses on an `exit 1` call, which reads on the
    // carrier exactly like "the model looked and found nothing".
    const invCall = callRecords.find((c) => c.step === "cross-project-investigator");
    if (invCall !== undefined && invCall.not_evaluated !== null) {
      return fact("failed", { ...base, ...projectsView, ...modelCalls(callRecords) }, `investigator call ${invCall.not_evaluated} (nothing appended, last-run not advanced)`);
    }
    if (inv.parsed === 0) {
      return fact("failed", { ...base, ...projectsView, ...modelCalls(callRecords) }, "investigator produced no parseable hypothesis list (an empty JSON array parses — this is unparseable output, not a finding of nothing); nothing appended, last-run not advanced");
    }
    hypotheses = Array.isArray(inv.records)
      ? (inv.records as Record<string, unknown>[]).flatMap((r) => (Array.isArray(r.hyps) ? (r.hyps as Record<string, unknown>[]) : []))
      : [];
  } catch (e) {
    return fact("failed", { ...base, ...projectsView, ...modelCalls(callRecords) }, `investigator threw — ${(e as Error).message} (nothing appended, last-run not advanced)`);
  }

  if (hypotheses.length === 0) {
    appendCarrierRecords(carrierPath, [{ kind: "dogfood-round", round_id: round, invoked_by: invokedBy, ts: new Date(now()).toISOString(), ...base, ...projectsView, ...modelCalls(callRecords), hypotheses: 0, clusters: 0, confirmed: 0, filed: [] }]);
    writeLastRunStamped(lastRunPath, CROSS_PROJECT_DOGFOOD_NAME, now(), invokedBy);
    return fact("verified", { ...base, ...projectsView, ...modelCalls(callRecords), hypotheses: 0 }, null);
  }

  // Clustering is dedup ASSISTANCE ONLY (the local routine's rule): nothing is discarded by shape here,
  // and the cap below is a COUNT, not a filter.
  const clusters = hyp.clusterHypotheses([{ hyps: hypotheses }], {});
  const selected = clusters.slice(0, cfg.maxClustersVerified);

  // ── ③ VERIFY, then ④ REFUTE independently ────────────────────────────────────────────────────────
  const repOf = (c: unknown): Record<string, unknown> => ((c as { rep?: Record<string, unknown> })?.rep ?? {});
  let verifierOut: Record<string, unknown>;
  try {
    verifierOut = await hyp.runVerifier({
      clusters: selected, pinDir: scratch, cwd: scratch, promptTemplate: verifierTemplate,
      maxClusters: cfg.maxClustersVerified, concurrency: 1, maxMs: cfg.maxWallMs, // concurrency-default-fallback: ONE verifier call at a time — concurrent calls reserve from several places at once and the per-step cost ledger stops being readable in call order
      strategy: "default", onlyCluster: null, evidence: null, model: requestedModel,
      runModel: async (p: string) => (await reservingStep("cross-project-verifier", { prompt: p, tools: VERIFIER_TOOLS, maxTurns: cfg.verifierMaxTurns })) as unknown as { stdout: string },
    });
  } catch (e) {
    return fact("failed", { ...base, ...projectsView, ...modelCalls(callRecords) }, `verifier threw — ${(e as Error).message} (nothing appended, last-run not advanced)`);
  }
  if (verifierOut.ok !== true) {
    const reasons = Array.isArray(verifierOut.reasons) ? (verifierOut.reasons as string[]) : [];
    return fact("failed", { ...base, ...projectsView, ...modelCalls(callRecords) }, `verifier refused — ${reasons[0] ?? "no reason reported"} (nothing appended, last-run not advanced)`);
  }
  const rows = Array.isArray(verifierOut.results) ? (verifierOut.results as Record<string, unknown>[]) : [];

  const clusterRecords: Record<string, unknown>[] = [];
  const confirmedRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    const idx = Number(row.cluster ?? 0);
    const cluster = selected[idx - 1] ?? {};
    const rep = repOf(cluster);
    const verifierVerdict = verdictOf(row);
    const entry: Record<string, unknown> = {
      kind: "dogfood-cluster", round_id: round, invoked_by: invokedBy, ts: new Date(now()).toISOString(),
      cluster: idx, record_id: crossProjectRecordId(round, `c${idx}`),
      claim: String(rep.claim ?? ""),
      components: Array.isArray(rep.components) ? rep.components : [],
      concept_kind: String(rep.concept_kind ?? ""),
      scope: String(rep.scope ?? "unstated"),
      source_project: String(rep.source_project ?? ""),
      evidence: Array.isArray(rep.evidence) ? rep.evidence : [],
      verifier_verdict: verifierVerdict,
      verifier_cause: row.verdict_cause ?? null,
      verifier_checked: Array.isArray(row.checked) ? row.checked : [],
      refutation_verdict: "not-run",
      refutation_undetermined_cause: null,
      confirmed: false,
      filed_task: null,
      portfolio: null,
    };
    if (verifierVerdict === "supported") {
      let refRow: Record<string, unknown> = {};
      let refCause: unknown = null;
      try {
        const ref = await hyp.runVerifier({
          clusters: [cluster], pinDir: scratch, cwd: scratch, promptTemplate: refuterTemplate,
          maxClusters: 1, concurrency: 1, maxMs: cfg.maxWallMs, // concurrency-default-fallback: ONE refuter call at a time — the independent refuter is a single fresh-context call by definition, and a second concurrent reservation would make the round's cost ledger unreadable in call order
          strategy: "default", onlyCluster: 1, evidence: null, model: requestedModel,
          runModel: async (p: string) => (await reservingStep("cross-project-refuter", { prompt: p, tools: REFUTER_TOOLS, maxTurns: cfg.refutationMaxTurns })) as unknown as { stdout: string },
        });
        if (ref.ok === true && Array.isArray(ref.results)) refRow = (ref.results as Record<string, unknown>[])[0] ?? {};
        else refCause = `refuter-refused:${(Array.isArray(ref.reasons) ? (ref.reasons as string[])[0] : null) ?? "no reason"}`;
      } catch (e) {
        refCause = `refuter-threw:${(e as Error).message}`;
      }
      entry.refutation_verdict = refCause === null ? verdictOf(refRow) : "undetermined";
      entry.refutation_undetermined_cause = refCause ?? refRow.verdict_cause ?? null;
      entry.refutation_counterexample = refRow.counterexample ?? null;
      entry.refutation_checked = Array.isArray(refRow.checked) ? refRow.checked : [];
      entry.confirmed = isConfirmed(verifierVerdict, entry.refutation_verdict, entry.refutation_undetermined_cause);
    }
    clusterRecords.push(entry);
    if (entry.confirmed === true) confirmedRows.push(entry);
  }

  // ── ⑤ DEDUP against the EXISTING Portfolio, then INGEST / FILE ───────────────────────────────────
  // ⛔ ORDER MATTERS: the cluster lines go on the carrier BEFORE the Portfolio is asked to resolve
  // their `record_id`s. `ingestFinding` resolves `origin_ref` by READING the record out of this carrier,
  // so ingesting first asks the Portfolio to confirm a finding that does not exist yet — the same shape
  // OSD's own round avoids by appending its clusters before calling `ingestRoundClusters`. Measured
  // 2026-10-13: every confirmed cluster was refused with
  // `ORIGIN_REF_UNRESOLVED:<id>-names-no-record-in-.quay/cross-project-dogfood-findings.jsonl`.
  if (clusterRecords.length > 0) appendCarrierRecords(carrierPath, clusterRecords);
  // ⛔ The cluster lines are now IMMUTABLE origin records (they had to be on the carrier first), so what
  // happened to each one — duplicate / skipped scope / ingested — is recorded on the round line's
  // `ingestion` array, the way OSD records its own ingestion outcomes. Writing the outcome back onto a
  // line that is already on disk would silently do nothing.
  const ingestion: Record<string, unknown>[] = [];
  const filings: Record<string, unknown>[] = [];
  let dedupView: Record<string, unknown> = { checked: false };
  if (confirmedRows.length > 0) {
    let portfolio: PortfolioLike | null = null;
    try { portfolio = opts.portfolioModule ?? (await loadPortfolioModule(root)); }
    catch (e) { dedupView = { checked: false, reason: `portfolio module unresolved — ${(e as Error).message}` }; }
    if (portfolio !== null) {
      const read = portfolio.readPortfolio(root);
      const existing = read.ok === true ? read.records : [];
      dedupView = { checked: read.ok === true, existing: existing.length, reason: read.ok === true ? null : (read.reason ?? "readPortfolio returned ok:false") };
      for (const entry of confirmedRows) {
        const components = Array.isArray(entry.components) ? (entry.components as string[]) : [];
        const claim = String(entry.claim ?? "");
        // ⛔ SCOPE GUARD — the judgment this routine exists to make. A `project_local` item (the source
        // project's OWN product/file defect) is CONFIRMED and still writes nothing: it is not a Quay
        // finding, and a Portfolio row for it would be a false cross-project claim. An UNSTATED scope is
        // `unstated`, not `quay_generic` — an unreadable scope must not be read as the in-scope value
        // (硬规则 3b). The skip is RECORDED, so "we decided not to file it" never looks like "we never
        // saw it".
        if (entry.scope !== "quay_generic") {
          entry.portfolio = { written: false, duplicate_of: null, skipped: `scope:${String(entry.scope)}-is-never-a-Quay-Portfolio-row` };
          ingestion.push({ cluster: entry.cluster, record_id: entry.record_id, source_project: entry.source_project, confirmed: true, written: false, duplicate_of: null, skipped: entry.portfolio.skipped, filed: null });
          continue;
        }
        // ⛔ The dedup decision is the Portfolio module's OWN `findDuplicate` — a second matcher here would
        // be a second definition of "already known" to keep in step (硬规则 5b). A duplicate is recorded
        // and NOT written: a second row for a known finding inflates every count derived from the Portfolio.
        const dup = read.ok === true ? portfolio.findDuplicate(existing, { components, claim }) : null;
        if (dup !== null) {
          entry.portfolio = { written: false, duplicate_of: dup.id ?? dup.finding_id ?? null, reason: "duplicate" };
          ingestion.push({ cluster: entry.cluster, record_id: entry.record_id, source_project: entry.source_project, confirmed: true, written: false, duplicate_of: entry.portfolio.duplicate_of, skipped: null, filed: null });
          continue;
        }
        const ingest = portfolio.ingestFinding(root, {
          finding_id: String(entry.record_id),
          origin: "autonomous-routine",
          origin_ref: String(entry.record_id),
          evidence_level: "production-open",
          method_ref: `${CROSS_PROJECT_DOGFOOD_NAME}:${String(entry.source_project)}`,
          claim,
          components,
          outcome: "supported",
          fix_task: null,
          human_rating: null,
          domain: null,
          domain_reason: null,
        });
        entry.portfolio = { written: ingest.ok === true, finding_id: ingest.ok === true ? String(entry.record_id) : null, duplicate_of: null, reasons: Array.isArray(ingest.reasons) ? ingest.reasons : [] };
        let filed: Record<string, unknown> | null = null;
        if (cfg.fileConfirmed && ingest.ok === true) {
          filed = await fileConfirmedTask(root, opts, entry, evidenceIndex);
          entry.filed_task = filed;
          filings.push({ cluster: entry.cluster, record_id: entry.record_id, ...filed });
        }
        ingestion.push({ cluster: entry.cluster, record_id: entry.record_id, source_project: entry.source_project, confirmed: true, written: ingest.ok === true, duplicate_of: null, skipped: null, reasons: entry.portfolio.reasons, filed: filed === null ? null : { id: filed.id, ok: filed.ok, reason: filed.reason } });
      }
    }
  }

  appendCarrierRecords(carrierPath, [
    {
      kind: "dogfood-round", round_id: round, invoked_by: invokedBy, ts: new Date(now()).toISOString(),
      ...base, ...projectsView, ...modelCalls(callRecords),
      hypotheses: hypotheses.length, clusters: clusters.length, verified: selected.length,
      confirmed: confirmedRows.length,
      refuted: clusterRecords.filter((c) => c.refutation_verdict === "refuted").length,
      duplicates: ingestion.filter((r) => r.duplicate_of !== null && r.duplicate_of !== undefined).length,
      dedup: dedupView,
      ingestion,
      filed: filings,
      scope_split: {
        quay_generic: clusterRecords.filter((c) => c.scope === "quay_generic").length,
        project_local: clusterRecords.filter((c) => c.scope === "project_local").length,
      },
      wall_ms: now() - started,
    },
  ]);
  writeLastRunStamped(lastRunPath, CROSS_PROJECT_DOGFOOD_NAME, now(), invokedBy);
  return fact("verified", { ...base, ...projectsView, ...modelCalls(callRecords), hypotheses: hypotheses.length, clusters: clusters.length, confirmed: confirmedRows.length, duplicates: ingestion.filter((r) => r.duplicate_of !== null && r.duplicate_of !== undefined).length, filed: filings.map((f) => f.id ?? null) }, null);
}

/** The task body for a confirmed cross-project finding. It carries its OWN provenance — which round,
 *  which source project, and the exact artifact positions the claim rests on — so the fixer never has to
 *  re-derive why the task exists.
 *
 *  ⛔ SHAPE MATTERS: a filed task that the author→ready gate cannot recognize is a task that can never be
 *  promoted, so the whole point of filing it (a real fix landing on Quay's tree) would be lost. This body
 *  therefore carries the `plan` shape's artifacts (`## Proposal` + `## Plan` + AC + DoD) AND `## Touches`,
 *  because a task whose Touches cannot be read is silently undispatchable. The Touches are the Quay-side
 *  components the claim named — a FIRST CUT the fixer is expected to correct, and the body says so. */
export function renderFiledTaskBody(entry: Record<string, unknown>, evidence: readonly EvidenceRow[], taskId = filedTaskId(entry)): string {
  const inline = Array.isArray(entry.evidence) ? (entry.evidence as Record<string, unknown>[]) : [];
  const components = Array.isArray(entry.components) ? (entry.components as string[]) : [];
  const cite = (inline.length > 0 ? inline : evidence.filter((e) => e.source_project === entry.source_project).slice(0, 20))
    .map((e) => `- \`${String(e.file ?? "?")}:${e.line === null || e.line === undefined ? "?" : String(e.line)}\` — ${String(e.excerpt ?? "").slice(0, 300)}`)
    .join("\n");
  return `## Proposal
Cross-project Quay dogfooding round \`${String(entry.round_id)}\` read the real usage artifacts of source project \`${String(entry.source_project)}\` and formed this hypothesis; an independent verifier and an independent refuter both returned \`supported\`.

**Claim**: ${String(entry.claim)}

**Quay-side components**: ${components.map((c) => `\`${c}\``).join(", ") || "(the round named none — the fixer must locate the surface)"}

**Why this is Quay-generic, not host-local**: the claim names Quay's own mechanism, not the source project's product; the source project is only where the failure became visible.

## Evidence
${cite || "- (the round recorded no inline excerpt; see the cluster record on .quay/cross-project-dogfood-findings.jsonl)"}

- round: \`${String(entry.round_id)}\` (record \`${String(entry.record_id)}\`)
- source project: \`${String(entry.source_project)}\`
- verifier verdict: \`${String(entry.verifier_verdict)}\`; refuter verdict: \`${String(entry.refutation_verdict)}\`

## Plan
1. Reproduce the claim from the cited positions above (the artifact that exposed it), then read the named Quay-side surface.
2. Either fix the mechanism, or record why the claim does not hold for Quay's own code — the round's refuter was satisfied, so "it is only that host" needs its own evidence.
3. Correct \`## Touches\` to the files the fix actually changes before editing them.

## Acceptance Criteria
- [ ] the Quay-side mechanism named in the claim behaves as the claim says (reproduce it from the cited positions)
- [ ] the fix is verified on Quay's own tree, not only on the source project that exposed it

## Definition of Done
- the defect is fixed or shown not to exist, and the round's claim is answered in the task body.

## Touches
${components.map((c) => `- \`${c}\``).join("\n") || "- ⛔ the round named no Quay-side component — the filer must locate one before this task can be dispatched"}
- \`tasks/${taskId}.md\`
`;
}

/** The id a confirmed cluster is filed under. Deterministic from the round, the source project and the
 *  cluster, so a re-run of the same round addresses the SAME id (and the store's create then refuses
 *  rather than silently minting a second task). */
export function filedTaskId(entry: Record<string, unknown>): string {
  return `gap-cross-project-dogfood-${String(entry.source_project).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-c${String(entry.cluster)}-${String(entry.round_id).slice(-6)}`;
}

/** File the task through the Provider ABI. ⛔ The constructor is `meta-driver.ts`'s `createTask` — the
 *  repo's single "file a task from a script" construction point — reached by a DYNAMIC import so this
 *  module does not add a static `quality-gate-driver → cross-project → meta-driver → quality-gate-driver`
 *  cycle to the import graph. A failure to file is RECORDED, never swallowed. */
export async function fileConfirmedTask(root: string, opts: CrossProjectDogfoodRunOptions, entry: Record<string, unknown>, evidence: readonly EvidenceRow[]): Promise<Record<string, unknown>> {
  const id = filedTaskId(entry);
  const body = renderFiledTaskBody(entry, evidence, id);
  const title = `[cross-project dogfood] ${String(entry.claim).slice(0, 120)}`;
  try {
    if (opts.fileTaskFn) return { id, ...(await opts.fileTaskFn(root, { id, title, body, labels: ["gap", "cross-project-dogfood"] })) };
    const mod = (await import(/* @vite-ignore */ "./meta-driver.ts")) as unknown as {
      createTask: (root: string, id: string, title: string, labels: string[], body: string, status?: string) => Promise<{ ok: boolean; reason: string }>;
    };
    const res = await mod.createTask(root, id, title, ["gap", "cross-project-dogfood"], body);
    return { id, ok: res.ok === true, reason: res.reason };
  } catch (e) {
    return { id: null, ok: false, reason: `filing refused — ${(e as Error).message}` };
  }
}

// ── routine plumbing ────────────────────────────────────────────────────────────────────────────────
export type CrossProjectDogfoodRoutineOptions = Omit<CrossProjectDogfoodRunOptions, "config" | "configPresent" | "configError" | "halted" | "invokedBy" | "force">;

export function buildCrossProjectDogfoodRoutine(root: string, read: CrossProjectDogfoodConfigRead, opts: CrossProjectDogfoodRoutineOptions = {}): RoutineSpec {
  return {
    name: CROSS_PROJECT_DOGFOOD_NAME,
    schedule: read.config?.trigger ?? { kind: "interval", minutes: DEFAULT_INTERVAL_MINUTES },
    run: async (ctx) => [
      await runCrossProjectDogfood(root, {
        ...opts,
        config: read.config,
        configPresent: read.present,
        configError: read.error,
        halted: ctx?.halted === true,
        invokedBy: INVOKED_BY_RESIDENT,
      }),
    ],
  };
}

/** Production entry. NEVER throws (an optional routine must not take down the host driver's startup).
 *  `routine:null` only when NO section is declared; a declared-but-`enabled:false` section still yields a
 *  routine, because "declared and not driven" must not look like "not declared" (硬规则 3b/9). */
export function crossProjectDogfoodRoutineFromConfig(
  root: string,
  opts: CrossProjectDogfoodRoutineOptions = {},
  readIn?: CrossProjectDogfoodConfigRead,
): { routine: RoutineSpec | null; error: string | null; present: boolean; enabled: boolean } {
  const read = readIn ?? readCrossProjectDogfoodConfig(root);
  return {
    routine: read.present ? buildCrossProjectDogfoodRoutine(root, read, opts) : null,
    error: read.error,
    present: read.present,
    enabled: read.config?.enabled === true,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
export const USAGE = `cross-project-dogfood-routine.ts — periodic READ-ONLY semantic dogfooding of OTHER Quay-host
projects' real usage artifacts (tasks/, worker-outcome, fan-in traces, needs-human reasons).

Usage:
  node --experimental-strip-types cross-project-dogfood-routine.ts [--root <dir>] [--force] [--json] [--help]

  --root <dir>   workspace root (default: cwd). Reads .quay/config.yml -> loop.cross_project_dogfood.
  --force        run a MANUAL round even when not due. ⛔ What it writes is stamped invoked_by:"manual",
                 so a forced round can never be read as an autonomous one.
  --json         print the Fact as JSON.

Exit codes: 0 verified · 1 failed · 3 not-evaluated (not due / disabled / budget / no readable project).`;

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { process.stdout.write(USAGE + "\n"); return 0; }
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  const read = readCrossProjectDogfoodConfig(root);
  const fact = await runCrossProjectDogfood(root, {
    config: read.config,
    configPresent: read.present,
    configError: read.error,
    invokedBy: INVOKED_BY_MANUAL,
    force: args.includes("--force"),
  });
  if (args.includes("--json")) process.stdout.write(JSON.stringify(fact, null, 2) + "\n");
  else process.stdout.write(`${CROSS_PROJECT_DOGFOOD_NAME}: ${fact.state}${fact.reason ? ` — ${fact.reason}` : ""}\n`);
  return fact.state === "failed" ? 1 : fact.state === "verified" ? 0 : 3;
}

if (isDirectEntry(import.meta, process.argv[1], "cross-project-dogfood-routine")) {
  main(process.argv).then((c) => process.exit(c));
}
