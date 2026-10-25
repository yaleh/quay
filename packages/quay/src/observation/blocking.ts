// observation/blocking.ts — the CROSS-TASK BLOCKING seam (split out of observation.ts, task
// gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module).
//
// Responsibility: the declared-Touches / depends_on blocking relation between an in-flight task and
// the ready/todo pool, computed from the on-disk task store (`tasks/*.md`).
//
// ⛔ This is the display-surface relation (declared path sets), NOT the dispatch mechanism's
// expand-then-check — see the PARSE-SOURCE NOTE below, kept verbatim with the parser.
import fs from "node:fs";
import path from "node:path";
import { TASK_STATUS } from "../core/types.ts";
import { parseFrontmatter } from "../core/frontmatter-store-base.ts";
// Touches entry normalization — the ONE kernel definition, shared with plugin/scripts/touches-parser.ts
// (task gap-three-pure-judges-kernel-single-def for the full-width half,
// gap-routine-semantic-dedup-scan-strip-touch-annotation for the composite entry strip, and
// gap-routine-semantic-dedup-scan-parse-touch-paths for the whole bullet→path pipeline). The kernel
// is the one location both layers reach without a `packages/**` → `plugin/**` reverse edge.
import { parseTouchBulletPaths } from "../kernel/touches-annotation.ts";
import type { InFlightTask } from "./model.ts";

// ── Cross-task blocking visibility (gap-webui-cross-task-blocking-visibility) ───────────────────
// The blocking relation between an in-flight task and the ready/todo pool used to live ONLY in the
// outer loop's tick-log prose (`retry-cap` + `lock-stuck` deferred because their Touches overlapped
// the in-flight slice) — invisible on the web. This computes it mechanically from two on-disk facts:
//   1. `## Touches` set intersection — an in-flight task X holds the files it declared, so any
//      ready/todo task Y whose declared Touches OVERLAP X's is blocked from dispatch.
//   2. `depends_on` chain (frontmatter, already present across the store — measured 30 tasks carry
//      a non-empty chain) — Y.depends_on ∋ X means X blocks Y; X.depends_on ∋ Y means Y blocks X.
//
// PARSE-SOURCE NOTE (hard rule: single source of truth): the AUTHORITATIVE Touches parser is
// plugin/scripts/touches-parser.ts (parseTouchEntries / extractTouchesSection). Core cannot import
// plugin/ (packages/quay/src has zero plugin/ imports — readBoardLanding shells out instead), so the
// ENTRY pipeline is the kernel leaf `packages/quay/src/kernel/touches-annotation.ts`'s
// `parseTouchBulletPaths` — the same function object the plugin parser re-exports as
// `parseTouchEntries` (reachable from both layers without a `packages/**` → `plugin/**` reverse edge;
// it ships self-contained through build-plugin-dist's `coreSrcAliasPlugin`). Task
// gap-routine-semantic-dedup-scan-parse-touch-paths removed the hand-maintained copy that used to
// live here — a divergence is now structurally impossible, not prose-forbidden.
//
// It is a DECLARED-PATH SET intersection, deliberately NOT the dispatch mechanism's
// expand-then-check (checkTouchesPair/expandDeclaredTouches): the display shows "whose declared files
// overlap", which is the same judgment surface the tick-log prose describes, while slot-refill's own
// expand-and-check remains the single dispatch truth.
//
// ⚠️ The SECTION LOCATOR (`extractTouchesSection` below) is still a local simplification of the
// plugin's, NOT shared: it takes the FIRST heading matching /^touches\b/i, while the plugin's adds the
// exact-`Touches`-wins + highest-level tie-break selection rule (gap-touches-parser-early-subheading-
// latch-hides-declaration). The two agree on every task body in this store today; the difference only
// shows on an early `### Touches …` subheading, where core would latch early and read no entries.
// Left as-is by the extraction task above (its finding names the ENTRY pipeline): changing it also
// changes which rows the display shows, which needs its own before/after evidence.

/** A task's blocking-relevant facts, parsed from its on-disk `tasks/<id>.md`. */
export interface BlockingTask {
  id: string;
  status: string;
  /** Parsed `depends_on` frontmatter list (the task ids this task waits for). */
  dependsOn: string[];
  /** Parsed `## Touches` bullet paths (annotations stripped). */
  touches: string[];
}

/** Locate the `## Touches` section of a task body (mirrors touches-parser.ts extractTouchesSection). */
export function extractTouchesSection(body: string): { hasSection: boolean; section: string } {
  const lines = String(body ?? "").split(/\r?\n/);
  let inSection = false;
  let hasSection = false;
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      if (inSection) break; // the next heading of any depth ends the section
      inSection = /^touches\b/i.test(heading[1].trim());
      if (inSection) hasSection = true;
      continue;
    }
    if (inSection) out.push(line);
  }
  return { hasSection, section: out.join("\n") };
}

// Touches-entry pipeline: ONE definition in the kernel leaf (`./kernel/touches-annotation.ts`),
// shared with plugin/scripts/touches-parser.ts. This module used to carry a hand-maintained mirror of
// both halves — the composite annotation strip (removed by
// gap-routine-semantic-dedup-scan-strip-touch-annotation) and the eight-step bullet→path pipeline
// around it (removed by gap-routine-semantic-dedup-scan-parse-touch-paths). Re-exporting the kernel
// function object means the two layers cannot drift; `parseTouchPaths` stays as the name Core's own
// consumers import (observation.ts does `export *` from this module).

/** Parse a `## Touches` bullet list into bare path strings. Alias of the kernel's ONE pipeline. */
export { parseTouchBulletPaths as parseTouchPaths };

/**
 * The cross-task blocking computation — PURE (unit-testable). For each in-flight task id X:
 *   blocks[X]   = ready/todo tasks Y (Y ≠ X) where X's Touches overlap Y's Touches, OR Y.depends_on
 *                 names X (Y is declared to wait on X).
 *   blockedBy[X] = tasks Y (Y ≠ X) where X.depends_on names Y (X waits on Y), OR Y is another
 *                 in-flight task whose Touches overlap X's (symmetric contention — both hold the
 *                 same files).
 * Both lists are sorted and deduplicated by construction (each candidate Y is visited once).
 */
export function computeBlockingRelations(
  inFlightIds: string[],
  tasks: BlockingTask[],
): Map<string, { blocks: string[]; blockedBy: string[] }> {
  const inFlightSet = new Set(inFlightIds);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const touchesOf = (id: string): string[] => byId.get(id)?.touches ?? [];
  const result = new Map<string, { blocks: string[]; blockedBy: string[] }>();
  for (const x of inFlightIds) {
    const xTouches = new Set(touchesOf(x));
    const xDependsOn = new Set(byId.get(x)?.dependsOn ?? []);
    const blocks: string[] = [];
    const blockedBy: string[] = [];
    for (const y of tasks) {
      if (y.id === x) continue;
      const yReadyTodo = y.status === TASK_STATUS.READY || y.status === TASK_STATUS.TODO;
      const overlap = y.touches.some((p) => xTouches.has(p));
      const yDependsOnX = y.dependsOn.includes(x);
      if (yReadyTodo && (overlap || yDependsOnX)) blocks.push(y.id);
      if (xDependsOn.has(y.id) || (inFlightSet.has(y.id) && overlap)) blockedBy.push(y.id);
    }
    blocks.sort();
    blockedBy.sort();
    result.set(x, { blocks, blockedBy });
  }
  return result;
}

/**
 * Read every `tasks/*.md` into BlockingTask facts (id from filename, status/depends_on from
 * frontmatter, Touches from the body). A single malformed file is skipped (never throws) — the
 * display degrades to "that task has no blocking info", never a 500.
 */
export function readTaskBlockingInputs(root: string): BlockingTask[] {
  const tasksDir = path.join(root, "tasks");
  const out: BlockingTask[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return out; // tasks/ absent — no blocking info (the display shows no rows)
  }
  for (const file of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(tasksDir, file), "utf8");
    } catch {
      continue;
    }
    let frontmatter: Record<string, unknown>;
    let body: string;
    try {
      const parsed = parseFrontmatter(raw);
      frontmatter = parsed.frontmatter as Record<string, unknown>;
      body = parsed.body as string;
    } catch {
      continue; // malformed frontmatter — skip this one file
    }
    const id = typeof frontmatter.id === "string" && frontmatter.id.length > 0
      ? frontmatter.id
      : file.replace(/\.md$/, "");
    const status = typeof frontmatter.status === "string" ? frontmatter.status : "";
    const dependsOn = Array.isArray(frontmatter.depends_on)
      ? frontmatter.depends_on.filter((d): d is string => typeof d === "string")
      : [];
    const touches = parseTouchBulletPaths(extractTouchesSection(body).section);
    out.push({ id, status, dependsOn, touches });
  }
  return out;
}

/** Annotate in-flight tasks with blocks/blockedBy from the on-disk task store. Never throws. */
export function computeInFlightBlocking(root: string, inFlight: InFlightTask[]): InFlightTask[] {
  if (inFlight.length === 0) return inFlight;
  let tasks: BlockingTask[] = [];
  try {
    tasks = readTaskBlockingInputs(root);
  } catch {
    tasks = []; // a store-read failure degrades to "no blocking info", never a 500
  }
  const rels = computeBlockingRelations(inFlight.map((t) => t.taskId), tasks);
  return inFlight.map((t) => {
    const r = rels.get(t.taskId) ?? { blocks: [], blockedBy: [] };
    return { ...t, blocks: r.blocks, blockedBy: r.blockedBy };
  });
}
