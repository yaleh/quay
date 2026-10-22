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
// Touches annotation stripping — the ONE kernel definition, shared with plugin/scripts/touches-parser.ts
// (task gap-three-pure-judges-kernel-single-def for the full-width half, and
// gap-routine-semantic-dedup-scan-strip-touch-annotation for the composite entry strip). The kernel
// is the one location both layers reach without a `packages/**` → `plugin/**` reverse edge.
import { stripTouchAnnotation } from "../kernel/touches-annotation.ts";
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
// plugin/ (packages/quay/src has zero plugin/ imports — readBoardLanding shells out instead), and a
// subprocess would be overkill for a pure parse, so the display-surface parser below mirrors that
// module's documented behavior (quote/backtick strip → trailing (…)/（…） annotation strip → masked
// backtick strip → leading ./ strip). It is a DECLARED-PATH SET intersection, deliberately NOT the
// dispatch mechanism's expand-then-check (checkTouchesPair/expandDeclaredTouches): the display shows
// "whose declared files overlap", which is the same judgment surface the tick-log prose describes,
// while slot-refill's own expand-and-check remains the single dispatch truth. A parse divergence on
// an edge-case annotation can at worst mis-render ONE blocking row, never a dispatch decision.

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

// Touches-entry annotation strip: ONE definition in the kernel leaf
// (`./kernel/touches-annotation.ts`), shared with plugin/scripts/touches-parser.ts. This module
// used to carry a hand-maintained mirror of the composite algorithm (leading-path cut + both
// trailing annotation spellings to a fixed point); task
// gap-routine-semantic-dedup-scan-strip-touch-annotation removed that copy — the two files now
// delegate to the same function object, so they cannot drift.

/** Parse a `## Touches` bullet list into bare path strings (mirrors touches-parser.ts parseTouchEntries). */
export function parseTouchPaths(touchesSection: string): string[] {
  if (!touchesSection) return [];
  return touchesSection
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, "").trim())
    .map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim())
    .map(stripTouchAnnotation)
    .map((l) => l.replace(/^[`"'']+|[`"'']+$/g, "").trim())
    .map((l) => l.replace(/^\.\//, "").trim())
    .filter(Boolean);
}

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
    const touches = parseTouchPaths(extractTouchesSection(body).section);
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
