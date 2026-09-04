#!/usr/bin/env node
// needs-human-recheck.ts — the needs-human measurement/aliveness axis
// (tasks/gap-needs-human-black-hole-human-dependency-unmeasurable).
//
// PROBLEM IT FIXES: a task parked `status: needs-human` has UNMEASURABLE wait time — nothing
// reports how long it has sat, whether a human decision is still actually awaited, or whether the
// mechanism it references is even alive. Before this script the needs-human pool was an
// indistinguishable mix of (a) tasks whose referenced mechanism ADR-022 retired
// (gap-plancheck-*, DIR-119-D2/D3/D4 — correctly parked but indistinguishable from…) and
// (b) ALIVE current-mechanism tasks stuck awaiting a human decision (DIR-100/103/109/101/105 …).
// `needs-human` could ENTER but not EXIT: no expiration, no re-review, nothing reported it. This
// script adds the two missing axes:
//
//   TIME axis (AC1): every needs-human task carries `ageDays` = days since its task file was last
//     touched (git log last-commit date — the survive-checkout truth; file mtime is
//     checkout-dependent). `stale` = ageDays > staleDays (default 7, `--stale-days N`). A stale
//     needs-human task is REPORTED for forced re-review — the "stuck awaiting a decision nobody
//     knows is still awaited" class (the DIR-109/100/103 class) is surfaced instead of rotting.
//
//   SURVIVAL axis (AC2): a needs-human task is `deadRetired` when its declared `## Touches` include
//     a path whose basename is one of the classic-pipeline scripts ADR-022 retired and deleted
//     (prepare-milestone.js / execute-milestone.js / milestone-worktree.ts). This REUSES the
//     strategic-doc-staleness-check.ts path-existence criterion — the SAME DELETED_SCRIPTS list,
//     IMPORTED (never duplicated), applied to the tasks/needs-human store (同尺子换对象, contract
//     invariant `same_ruler_on_needs_human`). A deadRetired task is an AUTO-SUPERSEDE candidate:
//     `--supersede` writes `status: superseded` + a `## Superseded` annotation. An alive task
//     (Touches resolve to live paths) is reported as-is. This (a)/(b) separation is what makes the
//     human-dependency count credible (AC3/AC4).
//
// A DETECTOR, not a gate (mirrors ready-pool-check.ts / task-status-drift-check.ts): in detector
// mode it exits 0 ALWAYS — the meter is runnable, not asserted. `--supersede` is the only write
// mode, and it writes ONLY the auto-classified deadRetired tasks (nothing else is ever mutated).
//
// Run:
//   node --experimental-strip-types plugin/scripts/needs-human-recheck.ts [--root <dir>]
//       [--stale-days <n>] [--supersede] [--json]
//
// Exit codes: 0 = OK (detector mode always 0; --supersede mode 0 when writes were applied or there
// was nothing to write); 2 = usage/env error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";
import { TASK_STATUS } from "./task-status.ts";
// SINGLE-SOURCE ruler (contract invariant same_ruler_on_needs_human): the SAME DELETED_SCRIPTS
// list strategic-doc-staleness-check.ts uses — imported, never re-declared.
import { DELETED_SCRIPTS } from "./strategic-doc-staleness-check.ts";
// SINGLE-SOURCE Touches parsing (ADR-004): the one bullet parser + the resolve check.
import { extractTouchesSection, parseTouchEntriesWithTags } from "./touches-parser.ts";
import { checkTaskTouchesResolve } from "./touches-orthogonality-check.ts";
import { readFrontmatter } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default staleness threshold (days). A needs-human task untouched longer than this is reported
 *  for forced re-review. Configurable via --stale-days (AC1: "N 可配，默认如 7 天"). */
export const DEFAULT_STALE_DAYS = 7;

/** Basenames of classic-pipeline scripts ADR-022 retired — the survival-axis dead signal. A
 *  needs-human task whose `## Touches` reference one of these paths targets a mechanism that no
 *  longer exists → dead-retired (auto-supersede candidate). */
export const RETIRED_BASENAMES: ReadonlySet<string> = new Set(DELETED_SCRIPTS);

export interface NeedsHumanTask {
  id: string;
  status: string;
  lastTouch: string | null; // ISO timestamp of the task file's last commit (mtime fallback)
  ageDays: number | null;
  stale: boolean;
  deadRetired: boolean;
  deadReason: string | null;
  alive: boolean;
  touches: string[];
  file: string;
}

/** Last-touch timestamp of a task file: the last commit that touched it (survives checkout;
 *  the honest "untouched since" signal). Falls back to the file's mtime when git is unavailable
 *  or the file is not yet committed. Returns an ISO string or null. */
export function lastTouchOf(root: string, rel: string): string | null {
  const abs = path.join(root, rel);
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cI", "--", rel],
      { cwd: root, encoding: "utf8", timeout: 10_000 },
    ).trim();
    if (out) return new Date(out).toISOString();
  } catch {
    /* fall through to mtime */
  }
  try {
    const st = fs.statSync(abs);
    if (st.mtimeMs) return new Date(st.mtimeMs).toISOString();
  } catch {
    /* no timestamp available */
  }
  return null;
}

/** The survival-axis dead signal: does the task's declared `## Touches` reference a retired
 *  classic-pipeline script path? Uses the SAME ruler as strategic-doc-staleness-check.ts
 *  (DELETED_SCRIPTS basenames), applied to the task's declared touch paths (同尺子换对象).
 *  Structural tags `(new)`/`(delete)` are EXCLUDED from the signal: a `(delete)`-tagged retired
 *  path is a CLEANUP action (alive), and a `(new)`-tagged one is ambiguous — the dead signal fires
 *  only when the task treats the retired path as an existing target of work (untagged). */
export function deadRetiredReason(taskBody: string): string | null {
  const { hasSection, section } = extractTouchesSection(taskBody);
  const entries = hasSection ? parseTouchEntriesWithTags(section) : [];
  const hits = entries.filter((e) => e.tag === null && RETIRED_BASENAMES.has(path.basename(e.path)));
  if (hits.length > 0) {
    return `## Touches reference ADR-022-retired classic-pipeline script(s): ${hits
      .map((h) => h.path)
      .join(", ")}`;
  }
  return null;
}

/** Resolve one needs-human task (read + classify). */
export function classifyTask(absFile: string, root: string, staleDays: number, now: Date): NeedsHumanTask {
  const src = fs.readFileSync(absFile, "utf8");
  const fm = readFrontmatter(absFile);
  const id = fm?.id || path.basename(absFile, ".md");
  const rel = path.relative(root, absFile);
  const lastTouch = lastTouchOf(root, rel);
  let ageDays: number | null = null;
  if (lastTouch) ageDays = (now.getTime() - new Date(lastTouch).getTime()) / 86_400_000;
  const stale = ageDays !== null && ageDays > staleDays;
  const deadReason = deadRetiredReason(src);
  const deadRetired = deadReason !== null;
  const { hasSection, section } = extractTouchesSection(src);
  const touches = (hasSection ? parseTouchEntriesWithTags(section) : []).map((e) => e.path);
  return {
    id,
    status: fm?.status ?? "unknown",
    lastTouch,
    ageDays: ageDays === null ? null : Math.round(ageDays * 10) / 10,
    stale,
    deadRetired,
    deadReason,
    alive: !deadRetired,
    touches,
    file: rel,
  };
}

/** Scan `tasks/*.md` for `status: needs-human` tasks and classify each (time + survival axes). */
export function scanNeedsHuman(root: string, staleDays: number, now: Date): NeedsHumanTask[] {
  const tasksDir = path.join(root, "tasks");
  if (!fs.existsSync(tasksDir)) return [];
  const out: NeedsHumanTask[] = [];
  for (const e of fs.readdirSync(tasksDir)) {
    if (!e.endsWith(".md")) continue;
    const abs = path.join(tasksDir, e);
    const fm = readFrontmatter(abs);
    if (fm?.status !== TASK_STATUS.NEEDS_HUMAN) continue;
    out.push(classifyTask(abs, root, staleDays, now));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Apply the survival axis: write `status: superseded` + a `## Superseded` annotation to every
 *  dead-retired needs-human task. Returns the ids written. ONLY deadRetired tasks are ever
 *  mutated — an alive task is never touched. */
export function applySupersede(root: string, tasks: NeedsHumanTask[], now: Date): string[] {
  const written: string[] = [];
  for (const t of tasks) {
    if (!t.deadRetired) continue;
    const abs = path.join(root, t.file);
    let src = fs.readFileSync(abs, "utf8");
    if (!/^status:\s*needs-human\b/m.test(src)) continue; // safety: only flip a needs-human task
    const iso = now.toISOString().slice(0, 10);
    const note =
      `\n\n## Superseded — ${iso} (needs-human-recheck auto)\n` +
      `Auto-superseded by the needs-human survival axis (plugin/scripts/needs-human-recheck.ts): ` +
      `this needs-human task's \`## Touches\` reference the classic-pipeline script(s) ` +
      `${t.deadReason!.replace(/^## Touches reference /, "")}, which ADR-022 retired and deleted. ` +
      `The referenced mechanism no longer exists, so the awaited human decision is moot; the task is ` +
      `separated from the ALIVE stuck needs-human pool (AC3) so the human-dependency count is credible.\n`;
    src = src.replace(/^status:\s*needs-human\b/m, "status: superseded");
    if (!src.endsWith("\n")) src += "\n";
    src += note;
    fs.writeFileSync(abs, src);
    written.push(t.id);
  }
  return written;
}

function usage(): never {
  console.error(
    "usage: node needs-human-recheck.ts [--root <dir>] [--stale-days <n>] [--supersede] [--json]\n" +
      "  Detector (exit 0 always) unless --supersede, which writes status:superseded to dead-retired tasks.",
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) usage();
  const asJson = args.includes("--json");
  const supersede = args.includes("--supersede");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  const sdIdx = args.indexOf("--stale-days");
  const staleDays = sdIdx !== -1 ? Number(args[sdIdx + 1]) : DEFAULT_STALE_DAYS;
  if (!Number.isFinite(staleDays) || staleDays < 0) usage();
  if (!fs.existsSync(root)) {
    console.error(`ERROR: root not found: ${root}`);
    process.exit(2);
  }
  const now = new Date();
  const tasks = scanNeedsHuman(root, staleDays, now);
  const stale = tasks.filter((t) => t.stale);
  const dead = tasks.filter((t) => t.deadRetired);
  const alive = tasks.filter((t) => !t.deadRetired);

  if (supersede) {
    const written = applySupersede(root, tasks, now);
    if (asJson) {
      console.log(JSON.stringify({ mode: "supersede", written, total: tasks.length, dead_retired: dead.length }, null, 2));
    } else {
      console.log(`needs-human-recheck --supersede — ${written.length} dead-retired task(s) written superseded`);
      for (const id of written) console.log(`  SUPERSEDED ${id}`);
      if (written.length === 0) console.log("  (no dead-retired needs-human tasks to supersede)");
    }
    return 0;
  }

  // ── detector output ──────────────────────────────────────────────────────────────────────────
  const report = {
    mode: "needs-human-recheck",
    root,
    stale_days: staleDays,
    generated_at: now.toISOString(),
    needs_human_total: tasks.length,
    needs_human_stale: stale.length, // ## Contract measure (band 0) — the time-axis count
    needs_human_dead_retired: dead.length, // the survival-axis (a) count — auto-supersede candidates
    needs_human_alive: alive.length, // the (b) count — alive-stuck, awaiting human decision
    tasks: tasks.map((t) => ({
      id: t.id,
      lastTouch: t.lastTouch,
      ageDays: t.ageDays,
      stale: t.stale,
      deadRetired: t.deadRetired,
      deadReason: t.deadReason,
      alive: t.alive,
      touches: t.touches,
    })),
  };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `needs-human-recheck — ${tasks.length} needs-human task(s); needs_human_stale(>${staleDays}d)=${stale.length}; ` +
        `needs_human_dead_retired=${dead.length}; needs_human_alive=${alive.length}`,
    );
    for (const t of tasks) {
      const kind = t.deadRetired ? "DEAD-RETIRED" : t.stale ? "ALIVE-STALE" : "alive";
      const age = t.ageDays === null ? "n/a" : `${t.ageDays}d`;
      console.log(`  [${kind}] ${t.id}  lastTouch=${t.lastTouch ?? "n/a"}  age=${age}`);
      if (t.deadReason) console.log(`            ${t.deadReason}`);
      if (t.stale && !t.deadRetired) console.log(`            FORCED RE-REVIEW: untouched ${age} > ${staleDays}d`);
    }
  }
  return 0;
}

if (isDirectEntry(import.meta, undefined, "needs-human-recheck")) {
  process.exit(main(process.argv));
}
