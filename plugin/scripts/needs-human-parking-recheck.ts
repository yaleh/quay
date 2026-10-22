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

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry, readFrontmatter } from "./gate-script-base.ts";
import { TASK_STATUS } from "./task-status.ts";
// SINGLE SOURCE of the parking judge: the function that produced the recorded `unsatisfiableUnannotatedAc=[…]`
// reason is the ONE that re-runs it. ⛔ Never re-implement the criterion here (that would be a parallel
// mechanism whose "clean" could drift from the gate's).
import { judgeUnsatisfiableUnannotatedAc } from "./ready-pool-check.ts";

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

/** Collective reading over the needs-human store. `evaluated:false` means the store itself could not be
 *  read — an EMPTY stale list then must not read as 「没有任何失效停放」 (硬规则 3b). */
export interface ParkingReading {
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
export function scanNeedsHumanParking(root: string, now: Date = new Date()): ParkingReading {
  const counts: Record<ParkingState, number> = {
    "parking-reason-stale": 0,
    "still-blocked": 0,
    "no-registered-judge": 0,
    "not-evaluated": 0,
  };
  const base: ParkingReading = {
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

const HELP = [
  "usage: node needs-human-parking-recheck.ts [--root <dir>] [--json]",
  "  Read-only detector: for every status:needs-human task, re-runs the mechanical judge named in its",
  "  ## Needs-Human record and reports ONLY the ones whose criterion is clean today while still parked.",
  "  ⛔ Never writes status (needs-human has no mechanical re-enqueue path). Exit 0 = ran; 2 = usage.",
].join("\n");

export function main(argv: string[]): number {
  const args = argv.slice(2);
  const asJson = args.includes("--json");
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") continue;
    if (a === "--root") { root = args[++i] ?? ""; continue; }
    if (a === "--help" || a === "-h") { console.log(HELP); return 0; }
    console.error(`needs-human-parking-recheck: unknown argument: ${a}`);
    console.error(HELP);
    return 2;
  }
  if (!root) { console.error(HELP); return 2; }
  const rootDir = path.resolve(root);
  if (!fs.existsSync(rootDir)) {
    console.error(`needs-human-parking-recheck: root not found: ${rootDir}`);
    return 2;
  }
  const reading = scanNeedsHumanParking(rootDir);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(reading, null, 2)}\n`);
    return 0;
  }
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
  return 0;
}

if (isDirectEntry(import.meta, undefined, "needs-human-parking-recheck")) {
  process.exit(main(process.argv));
}
