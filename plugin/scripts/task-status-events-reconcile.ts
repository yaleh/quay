#!/usr/bin/env node
// task-status-events-reconcile.ts — close the gaps in `.quay/task-status-events.jsonl` FROM GIT.
//
// WHY (tasks/gap-task-status-events-contract-v1-all-driver-writers, Plan §4): a v1 status-transition
// event is appended AFTER its status write, from inside the writer process. Two things therefore leave
// GAPS in the carrier, and neither may be papered over by guessing an event at write time:
//   · a crash between the status write and the event append;
//   · history written BEFORE the carrier existed (or before a writer was wired to it — measured:
//     139 ready→done transitions in the 2026-10-08 window produced 0 events).
// The ONLY admissible repair is the one the Plan states: compare the carrier against the status-line
// changes git actually recorded, and append an `inferred:true` event for each git-evidenced transition
// that has none. A transition with no git evidence is NEVER invented — the carrier is an OBSERVATION
// record, and an event nobody can evidence is a fabrication.
//
// MODES
//   (default)  report only: prints the per-edge table (git count / event count / missing) and writes
//              NOTHING. This is the mode the task's "coverage on real data" reading uses.
//   --apply    additionally appends the missing inferred events (idempotent: a second run appends 0,
//              because the inferred event carries `evidence.commit`, which matches commit-exactly).
//
// ⛔ SCOPE GUARD (the task body's non-goals): record-only. Nothing here dispatches, promotes or lands
// anything; it appends to ONE carrier and reads git. Zero model calls.
//
// EXIT CODES: 0 = ran (report or apply) · 2 = usage / environment error (unreadable ref, no derivable
// --since, unresolvable root) — fail-closed, never a silent empty report (硬规则 3b).

import path from "node:path";
import { execFileSync } from "node:child_process";
import { isDirectEntry, flagValue } from "./gate-script-base.ts";
import { splitTaskFile, statusFromFrontmatter } from "./task-ops.ts";
import {
  appendTaskStatusEvent,
  edgeKindFor,
  readTaskStatusEventCarrier,
} from "../../packages/quay/src/kernel/task-transition.ts";

const US = "\u001f"; // field separator inside the `git log --format`
const SHA_RE = /^[0-9a-f]{40,64}$/i;

/** Local git runner. ⛔ NOT the shared `git()` (gate-script-base.ts) for two reasons that are both
 *  real here, not stylistic:
 *    · the shared helper shells out through `execSync` with the DEFAULT 1 MB output cap, and
 *      `git log -p` over a few days of `tasks/` is already ~3 MB (measured on this repo);
 *    · the shared helper re-emits the child's stderr. This script legitimately asks for paths that do
 *      NOT exist in a parent commit (a task's FIRST registration — ~170 of them in the production
 *      window), and each of those would print a `fatal:` line, turning an expected outcome into
 *      crash-looking noise on stderr.
 *  Both are properties of the caller, not defects of the shared helper (which is deliberately
 *  fail-closed with stderr attached) — so the deviation is local and documented. */
function gitOut(args: string[], cwd: string): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export interface GitTransition {
  taskId: string;
  from: string;
  to: string;
  /** The non-merge commit whose diff flips the status line. */
  commit: string;
  /** The commit's committer date — the ONLY time an inferred event may carry (⛔ never "now"). */
  at: string;
}

export interface EdgeRow {
  edge: string;
  from: string;
  to: string;
  gitCount: number;
  eventCount: number;
  matchedByCommit: number;
  matchedByShape: number;
  missing: number;
  missingSamples: Array<{ taskId: string; commit: string }>;
}

/** The status word a task file's frontmatter carries, via the ONE frontmatter parser (task-ops.ts).
 *  `null` when the file does not exist at that ref or has no parseable frontmatter — 缺值 = 未查. */
function statusInFileText(text: string): string | null {
  const split = splitTaskFile(text);
  if (!split) return null;
  return statusFromFrontmatter(split.frontmatterRaw);
}

/** The git-evidenced status transitions in `<ref>` within the window: for every NON-MERGE commit that
 *  touched a `tasks/*.md`, compare the status line at the commit against the one at its first parent.
 *  A pair that cannot be read on either side (a first registration, a deletion, an unreadable blob) is
 *  NOT a transition and is skipped — it is not "equal", it is "not comparable" (硬规则 3/6). */
export function collectGitTransitions(
  root: string,
  ref: string,
  since: string,
  until: string | null,
): { ok: true; transitions: GitTransition[] } | { ok: false; reason: string } {
  const args = ["log", "--no-merges", `--format=%H${US}%cI`, `--since=${since}`];
  if (until !== null) args.push(`--until=${until}`);
  args.push("--name-only", ref, "--", "tasks/");
  const log = gitOut(args, root);
  if (!log.ok) return { ok: false, reason: `git log failed (is "${ref}" a readable ref?)` };

  const transitions: GitTransition[] = [];
  let current: { sha: string; at: string; files: string[] } | null = null;
  const flush = (c: { sha: string; at: string; files: string[] }): void => {
    for (const rel of c.files) {
      const taskId = path.basename(rel, ".md");
      // Read BOTH sides through the ONE frontmatter parser (task-ops.ts) rather than parsing the
      // diff text: a `-status:` line inside a task BODY (a fenced YAML sample, a quoted example) is
      // not a status change, and only the real frontmatter can say (硬规则 2 — by position, not by
      // keyword).
      const after = gitOut(["show", `${c.sha}:${rel}`], root);
      if (!after.ok) continue;
      const to = statusInFileText(after.stdout);
      if (to === null) continue;
      const before = gitOut(["show", `${c.sha}^:${rel}`], root);
      if (!before.ok) continue; // no first parent / file absent before ⇒ not a comparable change
      const from = statusInFileText(before.stdout);
      if (from === null || from === to) continue;
      transitions.push({ taskId, from, to, commit: c.sha, at: c.at });
    }
  };
  for (const line of log.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.includes(US)) {
      if (current !== null) flush(current);
      const [sha, at] = trimmed.split(US);
      current = { sha, at, files: [] };
      continue;
    }
    if (current !== null && trimmed.startsWith("tasks/") && trimmed.endsWith(".md")) current.files.push(trimmed);
  }
  if (current !== null) flush(current);
  transitions.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { ok: true, transitions };
}

interface CarrierEvent {
  index: number;
  taskId: string;
  from: string | null;
  to: string | null;
  commit: string | null;
  at: string | null;
  /** The raw record (v1 record or v0 legacy object) — for the report only. */
  raw: unknown;
  klass: "v0" | "v1";
}

/** Every carrier record, v0 and v1 alike, in one shape. A v0 line has no `evidence.commit` ⇒ its
 *  `commit` is null (it can still match a git transition BY SHAPE — see `reconcile`). */
export function readCarrierEvents(root: string): { events: CarrierEvent[]; corrupt: number; exists: boolean; path: string } {
  const carrier = readTaskStatusEventCarrier(root);
  const events: CarrierEvent[] = [];
  let corrupt = 0;
  for (const line of carrier.lines) {
    if (line.klass === "corrupt") {
      corrupt++;
      continue;
    }
    if (line.klass === "v1") {
      const r = line.record as unknown as Record<string, unknown>;
      const ev = (r.evidence ?? {}) as Record<string, unknown>;
      events.push({
        index: line.index,
        taskId: String(r.taskId),
        from: typeof r.from === "string" ? r.from : null,
        to: typeof r.to === "string" ? r.to : null,
        commit: typeof ev.commit === "string" ? ev.commit : null,
        at: typeof r.at === "string" ? r.at : null,
        raw: r,
        klass: "v1",
      });
      continue;
    }
    const r = (line.legacy ?? {}) as Record<string, unknown>;
    events.push({
      index: line.index,
      taskId: typeof r.taskId === "string" ? r.taskId : "",
      from: typeof r.from === "string" ? r.from : null,
      to: typeof r.to === "string" ? r.to : null,
      commit: null, // v0 carried no commit evidence — read as v0, never upgraded
      at: typeof r.ts === "string" ? r.ts : null,
      raw: r,
      klass: "v0",
    });
  }
  return { events, corrupt, exists: carrier.exists, path: carrier.path };
}

export interface ReconcileReport {
  root: string;
  ref: string;
  since: string;
  until: string | null;
  carrierPath: string;
  carrierExists: boolean;
  carrierEvents: number;
  carrierV0: number;
  carrierV1: number;
  carrierCorrupt: number;
  gitTransitions: number;
  matchedByCommit: number;
  matchedByShape: number;
  edges: EdgeRow[];
  /** The count, so a reader never has to length a field they may have serialized. */
  missingCount: number;
  /** The git-evidenced transitions the carrier has no event for — the exact set `--apply` appends. */
  missing: GitTransition[];
}

/** The pure core: pair git-evidenced transitions with carrier events. Two match classes, kept
 *  DISTINGUISHABLE (硬规则 3b — "the carrier has a commit-verified event for this flip" is not the
 *  same fact as "the carrier has an event that looks like it"):
 *    · byCommit — an unused event with the same (taskId, to, from) AND `evidence.commit` === the
 *      transition's commit. This is the class an inferred event lands in, which is what makes a
 *      second `--apply` append 0;
 *    · byShape  — an unused event with the same (taskId, from, to) and no commit evidence (a v0 line,
 *      or a v0-era writer). Greedy, one event per transition.
 *  Anything left over is MISSING and is what `--apply` appends for. */
export function reconcile(
  root: string,
  ref: string,
  since: string,
  until: string | null,
  transitions: GitTransition[],
  events: CarrierEvent[],
): ReconcileReport {
  const used = new Set<number>();
  const missing: GitTransition[] = [];
  let matchedByCommit = 0;
  let matchedByShape = 0;
  const perEdge = new Map<string, EdgeRow>();
  const rowFor = (from: string, to: string): EdgeRow => {
    const key = `${from}→${to}`;
    let row = perEdge.get(key);
    if (!row) {
      row = { edge: key, from, to, gitCount: 0, eventCount: 0, matchedByCommit: 0, matchedByShape: 0, missing: 0, missingSamples: [] };
      perEdge.set(key, row);
    }
    return row;
  };
  for (const e of events) rowFor(String(e.from), String(e.to)).eventCount++;

  for (const t of transitions) {
    const row = rowFor(t.from, t.to);
    row.gitCount++;
    const compatible = (e: CarrierEvent): boolean => e.taskId === t.taskId && e.to === t.to && (e.from === null || e.from === t.from);
    let idx = events.findIndex((e, i) => !used.has(i) && compatible(e) && e.commit === t.commit);
    let cls: "commit" | "shape" | null = idx === -1 ? null : "commit";
    if (idx === -1) {
      idx = events.findIndex((e, i) => !used.has(i) && compatible(e));
      if (idx !== -1) cls = "shape";
    }
    if (idx === -1) {
      row.missing++;
      if (row.missingSamples.length < 5) row.missingSamples.push({ taskId: t.taskId, commit: t.commit });
      missing.push(t);
      continue;
    }
    used.add(idx);
    if (cls === "commit") {
      matchedByCommit++;
      row.matchedByCommit++;
    } else {
      matchedByShape++;
      row.matchedByShape++;
    }
  }

  const carrier = readCarrierEvents(root);
  const edges = [...perEdge.values()].sort((a, b) => (b.missing - a.missing) || a.edge.localeCompare(b.edge));
  return {
    root,
    ref,
    since,
    until,
    carrierPath: carrier.path,
    carrierExists: carrier.exists,
    carrierEvents: events.length,
    carrierV0: carrier.events.filter((e) => e.klass === "v0").length,
    carrierV1: carrier.events.filter((e) => e.klass === "v1").length,
    carrierCorrupt: carrier.corrupt,
    gitTransitions: transitions.length,
    matchedByCommit,
    matchedByShape,
    edges,
    missingCount: missing.length,
    missing,
  };
}

/** The earliest time the carrier knows about — the default `--since` when the flag is absent. `null`
 *  when the carrier has no timestamped record (⇒ the caller must pass `--since`; ⛔ never "the
 *  beginning of time", which would silently reconcile the whole repository history). */
function earliestCarrierTime(events: CarrierEvent[]): string | null {
  const times = events.map((e) => e.at).filter((t): t is string => typeof t === "string" && t.length > 0);
  if (times.length === 0) return null;
  return times.reduce((a, b) => (a < b ? a : b));
}

function renderTable(report: ReconcileReport): string {
  const head = "edge".padEnd(22) + "git".padStart(6) + "events".padStart(9) + "byCommit".padStart(10) + "byShape".padStart(9) + "missing".padStart(9);
  const rows = report.edges.map(
    (r) => r.edge.padEnd(22) + String(r.gitCount).padStart(6) + String(r.eventCount).padStart(9) + String(r.matchedByCommit).padStart(10) + String(r.matchedByShape).padStart(9) + String(r.missing).padStart(9),
  );
  return [head, "-".repeat(head.length), ...rows].join("\n");
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(
      "task-status-events-reconcile.ts — report (default) or append (--apply) the task-status events git evidences but the carrier lacks\n" +
        "usage: node --experimental-strip-types plugin/scripts/task-status-events-reconcile.ts [--root <repo>] [--ref <ref>=develop]\n" +
        "         [--since <ISO>] [--until <ISO>] [--apply] [--json]\n" +
        "  --since defaults to the earliest timestamp in the carrier; with an empty carrier it is REQUIRED.\n",
    );
    return 0;
  }
  for (const known of ["--root", "--ref", "--since", "--until"]) {
    if (args.includes(known) && flagValue(args, known) === undefined) {
      process.stderr.write(`task-status-events-reconcile: ${known} requires a value\n`);
      return 2;
    }
  }
  const root = path.resolve(flagValue(args, "--root") ?? process.cwd());
  const ref = flagValue(args, "--ref") ?? "develop";
  const until = flagValue(args, "--until") ?? null;
  const apply = args.includes("--apply");
  const json = args.includes("--json");

  const carrierRead = readCarrierEvents(root);
  const since = flagValue(args, "--since") ?? earliestCarrierTime(carrierRead.events);
  if (since === null || since === undefined) {
    process.stderr.write(
      `task-status-events-reconcile: no --since given and ${carrierRead.path} has no timestamped record to derive one from — pass --since explicitly (refusing to reconcile the whole history by default)\n`,
    );
    return 2;
  }
  if (Number.isNaN(Date.parse(since))) {
    process.stderr.write(`task-status-events-reconcile: --since "${since}" is not a parseable timestamp\n`);
    return 2;
  }

  const collected = collectGitTransitions(root, ref, since, until);
  if (!collected.ok) {
    process.stderr.write(`task-status-events-reconcile: ${collected.reason}\n`);
    return 2;
  }
  const report = reconcile(root, ref, since, until, collected.transitions, carrierRead.events);

  let appended = 0;
  const appendErrors: string[] = [];
  if (apply) {
    for (const t of report.missing) {
      const rel = path.join("tasks", `${t.taskId}.md`);
      const blob = gitOut(["rev-parse", `${t.commit}:${rel}`], root);
      const res = appendTaskStatusEvent(root, {
        taskId: t.taskId,
        from: t.from,
        to: t.to,
        kind: edgeKindFor(t.from, t.to, { allowLegacy: true }),
        actor: { kind: "unknown", id: t.commit },
        at: t.at,
        source: "git",
        inferred: true,
        evidence: {
          commit: t.commit,
          ...(blob.ok && SHA_RE.test(blob.stdout) ? { statusBlobSha: blob.stdout } : {}),
        },
      });
      if (res.ok) appended++;
      else appendErrors.push(`${t.taskId} ${t.from}→${t.to} @${t.commit}: ${res.reason}`);
    }
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ...report, mode: apply ? "apply" : "report", appended, appendErrors }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `task-status-events-reconcile [${apply ? "apply" : "report"}] root=${root} ref=${ref} since=${since}${until ? ` until=${until}` : ""}\n` +
        `carrier=${report.carrierPath} exists=${report.carrierExists} events=${report.carrierEvents} (v0=${report.carrierV0} v1=${report.carrierV1} corrupt=${report.carrierCorrupt})\n` +
        `git transitions=${report.gitTransitions} matchedByCommit=${report.matchedByCommit} matchedByShape=${report.matchedByShape} missing=${report.missingCount}\n` +
        `${renderTable(report)}\n` +
        (apply ? `appended=${appended}${appendErrors.length > 0 ? ` errors=${appendErrors.length}\n${appendErrors.join("\n")}` : ""}\n` : ""),
    );
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "task-status-events-reconcile")) {
  process.exitCode = main(process.argv);
}
