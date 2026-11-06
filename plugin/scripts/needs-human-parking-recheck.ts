#!/usr/bin/env node
// needs-human-parking-recheck.ts — 「停放理由已失效」的只读探测器
// (tasks/gap-meta-needs-human-parking-recheck)
//
// PROBLEM IT FIXES: a task flipped to `status: needs-human` by a MECHANICAL park decision records
// that decision in its `## Needs-Human` block (`- 阻碍原因：unsatisfiableUnannotatedAc=[…]`).
// Nothing ever re-ran that criterion. When the criterion was later REPAIRED
// (`judgeUnsatisfiableUnannotatedAc` split its phrase families, 2026-10-22), the task stayed parked
// and the goal AC it blocks kept failing every round — AC-919 read `fail` for 42 consecutive rounds
// while its ONLY blocking criterion was already clean, and no product reported the contradiction.
//
// ⛔ The archived `archive/2026-09-07-zero-call-scripts/plugin/scripts/needs-human-recheck.ts` is NOT
// resurrected: it measured a TIME axis (ageDays) and a survival axis (ADR-022-retired `## Touches`),
// and never re-ran the parking criterion at all — re-instating it would answer a different question
// and still leave 「判据已修好、任务仍停」 invisible.
//
// WHAT IT DOES (a DETECTOR, never a gate; ⛔ it NEVER writes `status`):
//   for every `status: needs-human` task it reads the LAST `## Needs-Human` record, identifies the
//   mechanical judge NAMED in `- 阻碍原因：`, RE-RUNS that judge against the task's CURRENT body, and
//   reports ONLY the tasks whose criterion is clean today while the task is still parked. A task whose
//   criterion still fires, a task parked for a non-mechanical reason, and a task whose input could not
//   be read are all NOT reported — they are counted in their own buckets instead.
//
// FOUR STATES (硬规则 3b: 「读不懂」must never share a value with 「查过且干净」):
//   parking-reason-stale  REPORTED — the recorded judge re-runs clean TODAY, task still needs-human
//   still-blocked         not reported — the recorded judge still fires (parking is still justified)
//   no-registered-judge   not reported — the recorded reason names no re-runnable mechanical judge
//   not-evaluated         not reported — no `## Needs-Human` record / no 阻碍原因 line / the judge
//                                       itself returned `evaluated:false` (could not read the body)
//
// ⛔ WHY IT DOES NOT RE-ENQUEUE (人 2026-09-20 逐字裁定：「needs-human 本来就不应该有『可机械再入队』的
// 路径。」): the missing product here is the REPORT — a human decision to un-park stays human. This
// module therefore has no write mode at all; `scanNeedsHumanParking` is a pure read.
//
// SINGLE SOURCE of the judges: the SAME function that parked the task is imported and re-run
// (⛔ 不新建并行判据、⛔ 不复制一份词表) — see PARKING_JUDGES.
//
// LIVE CONSUMER (AC: 「接到一个每轮真跑的活消费者上」): promotion-driver.ts calls
// `recheckNeedsHumanParking` once per resident round, writes the reading to
// `.quay/needs-human-parking-recheck.json` (durable, observable) and carries it in the round JSON
// event as `needs_human_parking`; a non-empty `stale` list is also printed to stderr so a human
// reading the driver log sees it without querying anything.
//
// Run:
//   node --experimental-strip-types plugin/scripts/needs-human-parking-recheck.ts [--root <dir>] [--json]
//
// Exit codes: 0 = detector ran (a stale park is a FINDING, not an error — same convention as
// ready-pool-check / task-status-drift-check); 2 = usage error.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ARM 2 — body-PARKED tasks (tasks/gap-meta-needs-human-parking-recheck-2)
// ════════════════════════════════════════════════════════════════════════════════════════════════
//
// PROBLEM IT FIXES: `ready-pool-check.isParked` is only the EXCLUSION half. A task that stamps a
// line-start `**PARKED` marker drops out of the dispatch pool, and the marker's own un-park
// instruction ("run `git merge-base --is-ancestor <sha> develop && echo landed`; if it prints
// `landed`, delete the marker and flip done") is a sentence in the task body that NOTHING re-runs.
// Measured 2026-11-06: `gap-goal-driver-filing-ledger`'s declared check had been printing `landed`
// for hours, and the five remaining GOAL-914 tasks sat behind its `depends_on` edge, every round
// reading `stalled`/`world-gated` with nobody told that the block had already cleared.
//
// This is the SAME defect as the needs-human arm above, in the SECOND population — ⛔ not a new
// parallel mechanism: one file, one reading file, one per-round consumer, two arms. It re-runs the
// command the task body itself declares (timeout-bounded, capability-gated, read-only) and reports
// ONLY the tasks whose declared un-park condition ALREADY PASSES while the task is still PARKED.
// ⛔ It never deletes a marker and never writes `status`: deleting the marker stays the human/
// manager's act, exactly as re-enqueueing a needs-human task does.
//
// FOUR STATES (hard rule 3b again — the three failures the AC names are three DIFFERENT values):
//   unpark-passed       REPORTED — the declared command ran and met its declared expectation
//   unpark-still-blocked not reported — it ran and did NOT meet it (park is still justified)
//   no-unpark-check     not reported — the task declares no runnable command (prose condition only)
//   not-evaluated       not reported — timed out / could not spawn / exited 126-127 or 3 /
//                                       refused by the capability judge / declaration unreadable
// ⛔ `not-evaluated` never shares a value with `unpark-passed` NOR with `unpark-still-blocked`: an
// instrument that reports "still blocked" when it could not read the check is the exact inversion
// this repository's hard rule 3b forbids (a false 「一切正常」).

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry, readFrontmatter } from "./gate-script-base.ts";
import { TASK_STATUS } from "./task-status.ts";
// SINGLE SOURCE of the parking judge: the function that produced the recorded `unsatisfiableUnannotatedAc=[…]`
// reason is the ONE that re-runs it. ⛔ Never re-implement the criterion here (that would be a parallel
// mechanism whose "clean" could drift from the gate's).
//
// `isParked` is imported for the SAME reason on ARM 2: "which tasks are body-PARKED" is already decided
// by the dispatch pool's own reader (line-start `**PARKED`, code spans/fences masked). ⛔ Re-deriving
// the marker here would let this detector report on a population the pool does not actually exclude.
import { judgeUnsatisfiableUnannotatedAc, isParked } from "./ready-pool-check.ts";
// The TWO mechanisms ARM 2 borrows instead of re-inventing:
//   * `runAcceptanceCapture` — THIS repo's single "run a shell command under a hard deadline" runner
//     (SIGKILL on expiry, ETIMEDOUT mapped before anything else). ⛔ No hand-rolled spawnSync here.
//   * `judgeCriterionCapability` — THIS repo's single "is this command a READING or an ACTION?" judge
//     (tasks/gap-criterion-side-effect-unguarded-at-write-and-execution-surface). An unpark command is
//     re-run EVERY ROUND with nobody watching, so it must clear the same capability bar a goal
//     criterion does. ⛔ A local verb denylist would be exactly the spelling-based judgment that
//     module's header measured and rejected (87 false hits on this repository's own criteria).
import { runAcceptanceCapture } from "../../packages/quay/src/core/acceptance-runner.ts";
import {
  judgeCriterionCapability,
  readCapabilityDeclaration,
  type CapabilityDeclaration,
} from "../../packages/quay/src/core/criterion-capability.ts";

/** The reading file's repo-relative path (gitignored runtime log, promotion-round.jsonl 同族). */
export const PARKING_READING_REL = path.join(".quay", "needs-human-parking-recheck.json");

/** 「该停放的判据今日还发不发火」的四态。⛔ `not-evaluated` 是独立取值，不与 `clean` 同形。 */
export type ParkingState = "parking-reason-stale" | "still-blocked" | "no-registered-judge" | "not-evaluated";

/** One re-runnable mechanical parking judge. `token` is what the recorded 阻碍原因 line must CONTAIN to
 *  identify this judge; `judge` is the SAME function the parking path used, applied to the current body. */
export interface ParkingJudge {
  name: string;
  token: string;
  /** Three-valued by contract: `evaluated:false` (could not read the input) is DISTINCT from clean. */
  judge: (body: string) => { evaluated: boolean; status?: string; hits: unknown[]; reason?: string };
}

/** The registry. Adding a judge = adding an entry whose `token` matches the reason string the parking
 *  path writes AND whose `judge` is the same function that path calls. ⛔ Never a re-implementation. */
export const PARKING_JUDGES: readonly ParkingJudge[] = Object.freeze([
  Object.freeze({
    name: "unsatisfiableUnannotatedAc",
    token: "unsatisfiableUnannotatedAc=[",
    judge: judgeUnsatisfiableUnannotatedAc,
  }),
]);

/** A task's parking record: `found` = the `## Needs-Human` heading exists; `reason` = the 阻碍原因 line
 *  text (null when the section exists but carries no such line — 读不懂, ⛔ not "no parking reason"). */
export interface ParkingRecord {
  found: boolean;
  reason: string | null;
}

/** One task's recheck verdict. `note` explains a non-stale state (never used to dress up `not-evaluated`
 *  as a pass); `currentHits` carries the judge's current offending items verbatim when it still fires. */
export interface ParkingRecheck {
  id: string;
  state: ParkingState;
  judge: string | null;
  recordedReason: string | null;
  currentHits: string[];
  note: string | null;
}

/** Collective reading over the needs-human store (ARM 1). `evaluated:false` means the store itself
 *  could not be read — an EMPTY stale list then must not read as 「没有任何失效停放」 (硬规则 3b). */
export interface NeedsHumanParkingReading {
  at: string;
  root: string;
  evaluated: boolean;
  reason: string | null;
  needs_human_total: number;
  reported_stale: number;
  counts: Record<ParkingState, number>;
  stale: ParkingRecheck[];
  tasks: ParkingRecheck[];
}

/** The lines of the LAST `## <heading>` section (a task may carry several `## Needs-Human` blocks — one
 *  per park — and the LATEST one is the current parking reason). Fence-aware: a heading inside a fenced
 *  block is not a heading (位置判定, 硬规则 2). Returns null when the heading is absent. */
function lastSectionLines(body: string, heading: string): string[] | null {
  const lines = body.split(/\r?\n/);
  const headingRe = new RegExp(`^##\\s+${heading}\\s*$`);
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
    if (!inFence && headingRe.test(lines[i])) start = i;
  }
  if (start === -1) return null;
  const out: string[] = [];
  inFence = false;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; out.push(lines[i]); continue; }
    if (!inFence && /^#{1,2}\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

/** Read the LAST parking record out of a task body (the `## Needs-Human` block markNeedsHuman appends,
 *  driver-filters.ts). `found:false` (no section) and `found:true, reason:null` (section without a
 *  阻碍原因 line) are BOTH unreadable input and map to `not-evaluated` downstream. */
export function readParkingRecord(body: string): ParkingRecord {
  const lines = lastSectionLines(body, "Needs-Human");
  if (lines === null) return { found: false, reason: null };
  const bullet = lines.find((l) => /^\s*[-*]\s*阻碍原因\s*[:：]/.test(l));
  if (!bullet) return { found: true, reason: null };
  const reason = bullet.replace(/^\s*[-*]\s*阻碍原因\s*[:：]\s*/, "").trim();
  return { found: true, reason: reason.length > 0 ? reason : null };
}

/** Identify + re-run the judge named in a recorded reason. Pure: reads only the two strings.
 *  ⛔ The registered judge is RE-RUN — the recorded reason is used ONLY to identify WHICH judge was
 *  applied, never as evidence that the criterion is (or is not) still satisfied. */
export function recheckOne(id: string, body: string): ParkingRecheck {
  const record = readParkingRecord(body);
  if (!record.found) {
    return { id, state: "not-evaluated", judge: null, recordedReason: null, currentHits: [], note: "no ## Needs-Human record on a needs-human task" };
  }
  if (record.reason === null) {
    return { id, state: "not-evaluated", judge: null, recordedReason: null, currentHits: [], note: "## Needs-Human record carries no 阻碍原因 line" };
  }
  const entry = PARKING_JUDGES.find((j) => record.reason!.includes(j.token)) ?? null;
  if (entry === null) {
    return {
      id,
      state: "no-registered-judge",
      judge: null,
      recordedReason: record.reason,
      currentHits: [],
      note: `recorded reason names no re-runnable mechanical judge (registry: ${PARKING_JUDGES.map((j) => j.name).join(", ")})`,
    };
  }
  const verdict = entry.judge(body);
  if (!verdict || verdict.evaluated !== true) {
    return {
      id,
      state: "not-evaluated",
      judge: entry.name,
      recordedReason: record.reason,
      currentHits: [],
      note: `judge ${entry.name} could not evaluate the current body (${verdict && verdict.reason ? verdict.reason : "no reason given"})`,
    };
  }
  const hits = Array.isArray(verdict.hits) ? verdict.hits.map(String) : [];
  if (hits.length > 0) {
    return { id, state: "still-blocked", judge: entry.name, recordedReason: record.reason, currentHits: hits, note: `judge ${entry.name} still fires` };
  }
  return {
    id,
    state: "parking-reason-stale",
    judge: entry.name,
    recordedReason: record.reason,
    currentHits: [],
    note: `parked on ${entry.name} which is CLEAN on the current body — the parking reason has expired`,
  };
}

/** Scan `tasks/*.md` for `status: needs-human` and re-check each one's parking reason. Read-only:
 *  nothing under `root` is written (the caller may choose to persist the READING, never the status). */
export function scanNeedsHumanParking(root: string, now: Date = new Date()): NeedsHumanParkingReading {
  const counts: Record<ParkingState, number> = {
    "parking-reason-stale": 0,
    "still-blocked": 0,
    "no-registered-judge": 0,
    "not-evaluated": 0,
  };
  const base: NeedsHumanParkingReading = {
    at: now.toISOString(),
    root,
    evaluated: true,
    reason: null,
    needs_human_total: 0,
    reported_stale: 0,
    counts,
    stale: [],
    tasks: [],
  };
  const tasksDir = path.join(root, "tasks");
  if (!fs.existsSync(tasksDir)) {
    // 缺目录 ≠ 没有失效停放 (硬规则 3b): report UNEVALUATED, never an empty all-clear list.
    return { ...base, evaluated: false, reason: "no-tasks-dir" };
  }
  const tasks: ParkingRecheck[] = [];
  for (const file of fs.readdirSync(tasksDir).sort()) {
    if (!file.endsWith(".md")) continue;
    const abs = path.join(tasksDir, file);
    const fm = readFrontmatter(abs);
    if (!fm || fm.status !== TASK_STATUS.NEEDS_HUMAN) continue;
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch (e) {
      tasks.push({
        id: String(fm.id || path.basename(file, ".md")),
        state: "not-evaluated",
        judge: null,
        recordedReason: null,
        currentHits: [],
        note: `task file unreadable (${e instanceof Error ? e.message : String(e)})`,
      });
      continue;
    }
    tasks.push(recheckOne(String(fm.id || path.basename(file, ".md")), body));
  }
  for (const t of tasks) counts[t.state] += 1;
  const stale = tasks.filter((t) => t.state === "parking-reason-stale");
  return { ...base, needs_human_total: tasks.length, reported_stale: stale.length, counts, stale, tasks };
}

/** Persist the READING (never a status). Returns the absolute path written. The file is rewritten each
 *  driver round so 「最近一次读数」is always on disk; a stale list of ZERO is written too — with
 *  `evaluated` telling the reader which of 「没有失效停放」/「没查成」 it is. */
export function writeParkingReading(root: string, reading: ParkingReading): string {
  const file = path.join(root, PARKING_READING_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(reading, null, 2)}\n`, "utf8");
  return file;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ARM 2 — body-PARKED tasks: re-run the un-park command the task body itself declares
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Per-command deadline. A declared un-park check is re-run EVERY driver round (default 30s), so an
 *  unbounded one would stall the loop; the runner kills it (SIGKILL) at this deadline and the task
 *  reads `not-evaluated (timeout)` — never `still-blocked`, which would be a verdict we do not have. */
export const DEFAULT_UNPARK_TIMEOUT_MS = 10_000;

/** The four values of the parked arm. ⛔ `not-evaluated` is INDEPENDENT of both `unpark-passed` and
 *  `unpark-still-blocked` (hard rule 3b): "we ran it and the park still holds" and "we could not run
 *  it" are different facts and must not share a value. */
export type ParkedUnparkState = "unpark-passed" | "unpark-still-blocked" | "no-unpark-check" | "not-evaluated";

/** What a task body declares about its own un-parking. `found:false` = the body announces no un-park
 *  check at all (not the same as announcing one that has no runnable command — see `command:null`). */
export interface UnparkDeclaration {
  found: boolean;
  /** the shell command the declaration puts in an inline code span, or null when it declares none */
  command: string | null;
  /** the stdout token the declaration says must appear (`输出 `landed``), or null when it names none */
  expectedOutput: string | null;
  /** present when the declaration carries a code span that could not be read as a command */
  problem: string | null;
}

/** One PARKED task's verdict. `output` is the tail of the command's own combined stdout/stderr, kept
 *  so a reader can argue with the verdict without re-running anything. */
export interface ParkedUnparkEntry {
  id: string;
  status: string | null;
  state: ParkedUnparkState;
  command: string | null;
  expectedOutput: string | null;
  exitCode: number | null;
  output: string | null;
  note: string | null;
}

/** The parked arm's collective reading. `evaluated:false` = the task store itself could not be read,
 *  so an EMPTY `entries` must not read as 「没有一条 PARKED 的解停条件成立」 (硬规则 3b). */
export interface ParkedUnparkReading {
  at: string;
  root: string;
  evaluated: boolean;
  reason: string | null;
  parked_total: number;
  reported_passed: number;
  timeout_ms: number;
  counts: Record<ParkedUnparkState, number>;
  entries: ParkedUnparkEntry[];
  tasks: ParkedUnparkEntry[];
}

/** The command outcome the arm needs (a structural subset of `AcceptanceCaptureResult`). */
export interface UnparkRunResult {
  code: number | null;
  timedOut: boolean;
  output: string;
  error: string | null;
}

/** Injectable seams. ⛔ The DEFAULTS are the production mechanisms (the repo's shell runner and its
 *  capability judge); a test may inject to drive a state, but the real-store test reads the real arm. */
export interface ParkedUnparkOptions {
  now?: Date;
  timeoutMs?: number;
  /** the cwd the declared command runs in (the scan root — NOT the caller's cwd) */
  cwd?: string;
  run?: (command: string, timeoutMs: number) => UnparkRunResult;
  capability?: (command: string) => { capability: string; code: string | null; reasons?: unknown[] };
  /** inversion-of-control seam for the declaration file (tests point it at a fixture) */
  declaration?: CapabilityDeclaration;
}

/**
 * The line that ANNOUNCES an un-park check. Position-anchored (hard rule ②): only a line START —
 * after an optional blockquote `>`, an optional list bullet, and an optional bold opener — counts, so
 * a task DISCUSSING un-park conditions (`gap-per-test-tail-percentiles-conditional`, whose
 * `解除条件：…` sits mid-line inside a `**PARKED**（…）` parenthetical) is not read as declaring one.
 * Both live forms are covered: `- **unpark 检查（只读、可直接跑）**：`cmd`` and
 * `> **Unpark 判据（可跑，一条命令）**：` followed by the command on the next quoted line.
 */
export const UNPARK_LABEL_RE =
  /^\s*(?:>\s*)?(?:[-*+]\s+)?(?:\*\*|__)?\s*(?:unpark\b|解除\s*park|解停|解除条件|解除停放)/i;

/** The declared expected-stdout token: `输出 `online`` / `prints `landed`` / `outputs `X``. */
const EXPECTED_OUTPUT_RE = /(?:输出|prints?|outputs?|includes?)\s*[:：]?\s*`([^`\n]+)`/i;

/** A declaration's continuation lines: stop at a blank line, a heading, or a NEW bullet/declaration.
 *  Capped so a pathological body cannot make one declaration swallow the rest of the task. */
function unparkDeclarationBlock(lines: string[], startIdx: number): string[] {
  const out = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length && out.length < 12; i++) {
    const line = lines[i];
    if (line.trim() === "") break;
    if (/^\s*(?:>\s*)?#{1,6}\s/.test(line)) break;
    if (/^\s*(?:>\s*)?[-*+]\s+/.test(line)) break;
    if (UNPARK_LABEL_RE.test(line)) break;
    out.push(line);
  }
  return out;
}

/**
 * Read the LAST un-park declaration out of a task body (a task may be re-parked with a rewritten
 * check; the LATEST one is the live instruction — same rule as `lastSectionLines`). Fence-aware: a
 * declaration quoted inside a fenced block is a CITATION, not a declaration (位置判定, 硬规则 ②).
 */
export function readUnparkDeclaration(body: string): UnparkDeclaration {
  const lines = String(body ?? "").split(/\r?\n/);
  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:>\s*)?(?:```|~~~)/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (UNPARK_LABEL_RE.test(lines[i])) start = i;
  }
  if (start === -1) return { found: false, command: null, expectedOutput: null, problem: null };
  const block = unparkDeclarationBlock(lines, start).join("\n");
  // The FIRST inline code span is the command: every live form puts it there, before the prose that
  // explains what its output means. No span at all = a prose-only condition, which is NOT a failure
  // to read (it is a condition only a human can judge) ⇒ `no-unpark-check`, not `not-evaluated`.
  const span = /`([^`\n]+)`/.exec(block);
  if (!span) return { found: true, command: null, expectedOutput: null, problem: null };
  const command = span[1].trim();
  const rest = block.replace(span[0], " ");
  const exp = EXPECTED_OUTPUT_RE.exec(rest);
  const expectedOutput = exp ? exp[1].trim() : null;
  // A code span that does not even START like a program is a declaration we could not read — that is
  // `not-evaluated` territory, ⛔ not "no command declared" (which would silently drop the task).
  if (!/^[\w./~$-]/.test(command)) {
    return { found: true, command: null, expectedOutput, problem: `declared code span is not command-shaped: ${JSON.stringify(command)}` };
  }
  return { found: true, command, expectedOutput, problem: null };
}

/** The production shell runner: this repo's ONE timeout-bounded runner, not a hand-rolled spawnSync. */
function defaultUnparkRun(command: string, timeoutMs: number, cwd: string): UnparkRunResult {
  const r = runAcceptanceCapture({ command, cwd, timeoutMs });
  return { code: r.code, timedOut: r.timedOut, output: r.output ?? "", error: r.error };
}

/** 126/127 = the command never got to run; 3 = this repo's 「I cannot evaluate this HERE」 convention.
 *  All three are `not-evaluated` for the same reason `verdictFromAcceptance` treats them that way. */
const NOT_EVALUABLE_EXIT_CODES = new Set([3, 126, 127]);

/** Re-run one PARKED task's declared un-park check. Pure apart from the injected `run`/`capability`
 *  seams; it NEVER writes anything. */
export function checkParkedOne(
  id: string,
  status: string | null,
  body: string,
  opts: ParkedUnparkOptions = {},
): ParkedUnparkEntry {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_UNPARK_TIMEOUT_MS;
  const decl = readUnparkDeclaration(body);
  const bare = { id, status, command: decl.command, expectedOutput: decl.expectedOutput, exitCode: null, output: null };
  if (!decl.found) {
    return { ...bare, state: "no-unpark-check", note: "body announces no unpark check" };
  }
  if (decl.problem !== null) {
    return { ...bare, state: "not-evaluated", note: decl.problem };
  }
  if (decl.command === null) {
    return {
      ...bare,
      state: "no-unpark-check",
      note: "declared unpark condition is prose — no runnable command in the declaration",
    };
  }
  // ⛔ Capability before execution: an un-park command is re-run every round with nobody watching, so
  // it must be a READING. A refusal is a decision, not a verdict — it maps to `not-evaluated` with the
  // judge's own stable code in the note, never to `unpark-still-blocked`.
  const cap = opts.capability
    ? opts.capability(decl.command)
    : judgeCriterionCapability(decl.command, {
        root: opts.cwd ?? process.cwd(),
        ...(opts.declaration ? { declaration: opts.declaration } : {}),
      });
  if (cap.capability !== "read-only") {
    const detail = Array.isArray(cap.reasons)
      ? cap.reasons
          .map((r) => (r && typeof r === "object" && "rule" in (r as any) ? String((r as any).rule) : String(r)))
          .join(", ")
      : "";
    return {
      ...bare,
      state: "not-evaluated",
      note: `refused before execution by the criterion capability judge (${cap.code}${detail ? `: ${detail}` : ""})`,
    };
  }
  const run = opts.run ?? ((cmd: string, t: number) => defaultUnparkRun(cmd, t, opts.cwd ?? process.cwd()));
  const r = run(decl.command, timeoutMs);
  if (r.timedOut) {
    return { ...bare, state: "not-evaluated", note: `unpark command killed at the ${timeoutMs}ms deadline` };
  }
  if (r.error) {
    return { ...bare, state: "not-evaluated", note: `unpark command could not be spawned: ${r.error}` };
  }
  const output = typeof r.output === "string" ? r.output : "";
  if (r.code === null || NOT_EVALUABLE_EXIT_CODES.has(r.code)) {
    return { ...bare, exitCode: r.code, output, state: "not-evaluated", note: `unpark command did not run (exit ${r.code})` };
  }
  // PASS = the command's own exit status AND (when the declaration names one) the declared token.
  // ⛔ Exit 0 alone is NOT a pass for a declaration that says `→ 输出 online`: `gh api …` exits 0 while
  // printing `offline`, and reading that as 「解停条件已成立」 would be a false un-park signal.
  const missingToken = decl.expectedOutput !== null && !output.includes(decl.expectedOutput);
  if (r.code === 0 && !missingToken) {
    return {
      ...bare,
      exitCode: r.code,
      output,
      state: "unpark-passed",
      note: `unpark check PASSES today (exit 0${decl.expectedOutput ? `, output has ${JSON.stringify(decl.expectedOutput)}` : ""}) but the task is still PARKED`,
    };
  }
  return {
    ...bare,
    exitCode: r.code,
    output,
    state: "unpark-still-blocked",
    note:
      r.code === 0
        ? `exit 0 but output is missing the declared token ${JSON.stringify(decl.expectedOutput)}`
        : `unpark check still fails (exit ${r.code})`,
  };
}

/** Scan `tasks/*.md` for the line-start `**PARKED` marker and re-run each one's declared un-park
 *  check. Read-only: the marker and the status are NEVER touched (deleting the marker is the human/
 *  manager's act). */
export function scanParkedUnpark(root: string, opts: ParkedUnparkOptions = {}): ParkedUnparkReading {
  const now = opts.now ?? new Date();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_UNPARK_TIMEOUT_MS;
  const counts: Record<ParkedUnparkState, number> = {
    "unpark-passed": 0,
    "unpark-still-blocked": 0,
    "no-unpark-check": 0,
    "not-evaluated": 0,
  };
  const base: ParkedUnparkReading = {
    at: now.toISOString(),
    root,
    evaluated: true,
    reason: null,
    parked_total: 0,
    reported_passed: 0,
    timeout_ms: timeoutMs,
    counts,
    entries: [],
    tasks: [],
  };
  const tasksDir = path.join(root, "tasks");
  if (!fs.existsSync(tasksDir)) {
    // 缺目录 ≠ 没有失效 PARKED (硬规则 3b): UNEVALUATED, never an empty all-clear list.
    return { ...base, evaluated: false, reason: "no-tasks-dir" };
  }
  const tasks: ParkedUnparkEntry[] = [];
  for (const file of fs.readdirSync(tasksDir).sort()) {
    if (!file.endsWith(".md")) continue;
    const abs = path.join(tasksDir, file);
    const fallbackId = path.basename(file, ".md");
    const fm = readFrontmatter(abs);
    if (!fm) continue; // vanished/unparseable between readdir and read — not a parked task we can name
    let body: string;
    try {
      body = fs.readFileSync(abs, "utf8");
    } catch (e) {
      // 缺值 = 未查 (硬规则 6): a file we cannot read is `not-evaluated`, ⛔ not silently absent.
      tasks.push({
        id: String(fm.id || fallbackId),
        status: (fm.status as string) ?? null,
        state: "not-evaluated",
        command: null,
        expectedOutput: null,
        exitCode: null,
        output: null,
        note: `task file unreadable (${e instanceof Error ? e.message : String(e)})`,
      });
      continue;
    }
    if (!isParked({ body })) continue;
    tasks.push(
      checkParkedOne(String(fm.id || fallbackId), (fm.status as string) ?? null, body, { ...opts, cwd: root, timeoutMs }),
    );
  }
  for (const t of tasks) counts[t.state] += 1;
  const entries = tasks.filter((t) => t.state === "unpark-passed");
  return { ...base, parked_total: tasks.length, reported_passed: entries.length, counts, entries, tasks };
}

/** BOTH arms in ONE reading: the needs-human arm (parking reason expired) and the body-PARKED arm
 *  (declared un-park check already green). One file, one per-round consumer — ⛔ not two mechanisms. */
export interface ParkingReading extends NeedsHumanParkingReading {
  parked: ParkedUnparkReading;
}

export function scanParkingBoard(
  root: string,
  opts: { now?: Date; unpark?: ParkedUnparkOptions } = {},
): ParkingReading {
  const now = opts.now ?? new Date();
  return {
    ...scanNeedsHumanParking(root, now),
    parked: scanParkedUnpark(root, { ...(opts.unpark ?? {}), now }),
  };
}

const HELP = [
  "usage: node needs-human-parking-recheck.ts [--root <dir>] [--unpark-timeout-ms <n>] [--json]",
  "  Read-only detector over TWO parked populations:",
  "   needs-human: for every status:needs-human task, re-runs the mechanical judge named in its",
  "                ## Needs-Human record and reports ONLY the ones whose criterion is clean today.",
  "   body-PARKED: for every task carrying a line-start **PARKED marker, re-runs the un-park command",
  "                the body itself declares (timeout-bounded, capability-gated, read-only) and reports",
  "                ONLY the ones whose declared check ALREADY passes while the task is still parked.",
  "  --unpark-timeout-ms <n>  per-command deadline for a declared un-park check (default 10000).",
  "  ⛔ Never writes status and never deletes a marker (un-parking stays human/manager). Exit 0 = ran; 2 = usage.",
].join("\n");

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  let root = process.cwd();
  let unparkTimeoutMs: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") continue;
    if (a === "--root") { root = args[++i] ?? ""; continue; }
    if (a.startsWith("--unpark-timeout-ms=")) {
      unparkTimeoutMs = Number(args[i].slice("--unpark-timeout-ms=".length));
      continue;
    }
    if (a === "--unpark-timeout-ms") {
      unparkTimeoutMs = Number(args[++i]);
      continue;
    }
    if (a === "--help" || a === "-h") { console.log(HELP); return 0; }
    console.error(`needs-human-parking-recheck: unknown argument: ${a}`);
    console.error(HELP);
    return 2;
  }
  if (!root) { console.error(HELP); return 2; }
  if (unparkTimeoutMs !== undefined && !(Number.isFinite(unparkTimeoutMs) && unparkTimeoutMs > 0)) {
    console.error(`needs-human-parking-recheck: --unpark-timeout-ms must be a positive number of ms`);
    return 2;
  }
  const rootDir = path.resolve(root);
  if (!fs.existsSync(rootDir)) {
    console.error(`needs-human-parking-recheck: root not found: ${rootDir}`);
    return 2;
  }
  const reading = scanParkingBoard(rootDir, unparkTimeoutMs === undefined ? {} : { unpark: { timeoutMs: unparkTimeoutMs } });
  if (asJson) {
    process.stdout.write(`${JSON.stringify(reading, null, 2)}\n`);
    return 0;
  }
  const parked = reading.parked;
  if (!reading.evaluated) {
    console.log(`needs-human-parking-recheck — NOT EVALUATED (${reading.reason}); no tasks dir at ${rootDir}`);
    return 0;
  }
  console.log(
    `needs-human-parking-recheck — ${reading.needs_human_total} needs-human task(s); ` +
      `stale=${reading.counts["parking-reason-stale"]}; still-blocked=${reading.counts["still-blocked"]}; ` +
      `no-registered-judge=${reading.counts["no-registered-judge"]}; not-evaluated=${reading.counts["not-evaluated"]}`,
  );
  for (const t of reading.stale) {
    console.log(`  [PARKING-REASON-STALE] ${t.id}  judge=${t.judge}  ${t.note}`);
  }
  console.log(
    `  body-PARKED — ${parked.parked_total} task(s); ` +
      `unpark-passed=${parked.counts["unpark-passed"]}; still-blocked=${parked.counts["unpark-still-blocked"]}; ` +
      `no-unpark-check=${parked.counts["no-unpark-check"]}; not-evaluated=${parked.counts["not-evaluated"]}`,
  );
  for (const t of parked.entries) {
    console.log(`  [UNPARK-PASSED] ${t.id}  ${t.note}`);
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "needs-human-parking-recheck")) {
  process.exit(main(process.argv));
}
