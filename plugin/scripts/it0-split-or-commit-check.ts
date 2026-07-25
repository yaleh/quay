#!/usr/bin/env node
// it0-split-or-commit-check.ts — single-source enforcement for the split-or-commit rules
// from DIR-026 that were previously prose-only in OUTER-LOOP.md:
//
//   1. PARENT-DONE-IFF-CHILDREN: A milestone task marked `done` with `role:compound` (or
//      non-empty `children`) MUST have ALL children also `done`. A `done` parent whose subtree
//      contains a non-done child is a violation — the exact "do a slice, leave the parent
//      pending forever" failure DIR-026 was written to eliminate.
//
//   2. SELECT-SPLIT: A compound task with `status: todo` or `status: ready` and an EMPTY
//      children array is a violation — it should have been split into children before being
//      SELECTed for a milestone. Selecting a compound task without splitting first is
//      prohibited by DIR-026.
//
//   3. CHILD-LINK-SYMMETRY: A task declaring `parent: Y` MUST be listed in Y's `children` (and Y
//      must exist). A one-way link makes CHECK 1 exclude the orphaned child, so a parent/program
//      can be judged `done` while a real phase is still open — the exact modeling hole that made
//      M-TS-MIGRATION (children: [P0-only]) read as complete while P1-P4 were unlisted.
//
// D3·R7 enforcement pointer: OUTER-LOOP.md's prose description of parent-done-iff-children
// at Step 1 / SPLIT-OR-COMMIT references THIS script as the mechanical enforcement.
// <!-- enforcement: scripts/it0-split-or-commit-check.ts -->
//
// Reconciliation with store.js: packages/quay-native/src/store.js's `childrenStatus()`
// detects compound tasks with incomplete subtrees via a recursive view-model tree walk. This
// script uses a FLAT per-task check instead — each done compound task is checked against its
// direct children's stored status; deeper violations are caught at each level independently.
// A recursive walk is not needed (and would duplicate logic) for a gate that runs on the full
// task set: every boundary is checked by the same rule, one error per violated level.
// No store.js import is required; the check runs on raw task files without a running quay instance.
//
// Usage:
//   node it0-split-or-commit-check.ts <workspace-root>
//   node it0-split-or-commit-check.ts --selftest
//
// Exit codes:
//   0 = all checks PASS
//   1 = at least one violation found
//   2 = usage/environment error

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TaskFrontmatter {
  id: string | null;
  status: string | null;
  role: string | null;
  children: string[];
  labels: string[];
  parent: string | null;
}

// ── parseFrontmatter — extract id, status, role, children from YAML frontmatter. ─────────────────
// Lenient parser matching the existing task-schema.mjs pattern: handles block list and flow list for
// arrays (children/labels). Returns null if not a valid task file (no --- fences).
export function parseFrontmatter(text: string): TaskFrontmatter | null {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  // Scalar field: `key: value`
  function scalar(key: string): string | null {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
    return m ? m[1].replace(/^["']|["']$/g, "").trim() : null;
  }

  // Block list field: `key:\n  - val1\n  - val2` OR flow list: `key: [val1, val2]`
  function list(key: string): string[] {
    const flowM = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, "m"));
    if (flowM) {
      return flowM[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    const lines = fm.split(/\r?\n/);
    const idx = lines.findIndex((l) => new RegExp(`^${key}:\\s*$`).test(l));
    if (idx < 0) return [];
    const items: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s+-\s+(.+?)\s*$/);
      if (m) items.push(m[1].replace(/^["']|["']$/g, ""));
      else if (/^\S/.test(lines[i])) break;
    }
    return items;
  }

  return {
    id: scalar("id"),
    status: scalar("status"),
    role: scalar("role"),
    children: list("children"),
    labels: list("labels"),
    parent: scalar("parent"),
  };
}

// ── loadTasks — read all tasks/*.md from tasksDir, return a Map<id, task>. ───────────────────────
export function loadTasks(tasksDir: string): Map<string, TaskFrontmatter> {
  const taskMap = new Map<string, TaskFrontmatter>();
  if (!fs.existsSync(tasksDir)) return taskMap;
  const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const text = fs.readFileSync(path.join(tasksDir, file), "utf8");
    const t = parseFrontmatter(text);
    if (t && t.id) {
      taskMap.set(t.id, t);
    }
  }
  return taskMap;
}

// ── isCompound — a task is compound if role===compound OR it has a non-empty children array. ─────
function isCompound(t: TaskFrontmatter): boolean {
  return t.role === "compound" || (t.children && t.children.length > 0);
}

export interface CheckResult {
  failures: string[];
}

// ── runChecks — pure function: given a Map<id, task>, returns {failures: string[]}. ──────────────
// Reconciliation with store.js childrenStatus(): store.js does a recursive tree walk to build a
// view-model (propagating "stale-done" up to callers). This gate uses a FLAT per-task check
// instead: each done compound task is checked against its direct children's stored status. Deeper
// violations (e.g. grandparent→parent→grandchild) are caught at each level independently by the
// same rule when the gate runs on the full task set. This avoids duplicating the recursive walk
// and is the right shape for a gate: produce one clear error per violated boundary.
export function runChecks(taskMap: Map<string, TaskFrontmatter>): CheckResult {
  const failures: string[] = [];

  // CHECK 1: PARENT-DONE-IFF-CHILDREN
  // For every compound task with status `done`, verify all direct children also have status `done`.
  // Each level of a nested compound hierarchy is checked independently (flat, not recursive).
  for (const [id, t] of taskMap) {
    if (t.status !== "done") continue;
    if (!isCompound(t)) continue;
    const children = t.children || [];
    if (children.length === 0) continue; // done compound with no children is fine (leaf-compound)

    const nonDoneChildren: string[] = [];
    for (const childId of children) {
      const child = taskMap.get(childId);
      const childStatus = child ? child.status : "missing";
      if (childStatus !== "done") {
        nonDoneChildren.push(`${childId} (status: ${childStatus})`);
      }
    }
    if (nonDoneChildren.length > 0) {
      failures.push(
        `PARENT-DONE-IFF-CHILDREN: task "${id}" is done but has ${nonDoneChildren.length} non-done child(ren): ${nonDoneChildren.join(", ")} — a done parent requires ALL children done (DIR-026)`
      );
    }
  }

  // CHECK 2: SELECT-SPLIT
  // A compound task with `todo` or `ready` status and an EMPTY children array is a violation:
  // it means a compound task was SELECTed (or is open) without first being split into children.
  for (const [id, t] of taskMap) {
    if (t.status !== "todo" && t.status !== "ready") continue;
    if (t.role !== "compound") continue; // only explicit compound role triggers this check
    const children = t.children || [];
    if (children.length === 0) {
      failures.push(
        `SELECT-SPLIT: task "${id}" is a compound task with status "${t.status}" and NO children — compound tasks must be split into children before being SELECTed for a milestone (DIR-026)`
      );
    }
  }

  // CHECK 3: CHILD-LINK-SYMMETRY
  // For every task that declares `parent: Y`, Y must EXIST and must list this task in its `children`.
  // A one-way link (child points up, but the parent omits it from `children`) makes CHECK 1's
  // parent-done-iff-children computation silently EXCLUDE this child — so the parent can be marked
  // `done` while this orphaned phase is still open. This is the "program judged prematurely done"
  // hole: M-TS-MIGRATION's children listed only P0 (done) while P1 declared the parent but was
  // omitted, so the whole TS program read as complete before P1-P4 ran. A hard graph invariant over
  // the stored links — NOT a parse of proposal prose (which drifts, ADR-004).
  for (const [id, t] of taskMap) {
    const parentId = t.parent;
    if (!parentId || parentId === "null") continue; // no parent declared
    const parent = taskMap.get(parentId);
    if (!parent) {
      failures.push(
        `CHILD-LINK-SYMMETRY: task "${id}" declares parent "${parentId}" but no such task exists — dangling parent link (DIR-026)`
      );
      continue;
    }
    const siblings = parent.children || [];
    if (!siblings.includes(id)) {
      failures.push(
        `CHILD-LINK-SYMMETRY: task "${id}" declares parent "${parentId}" but "${parentId}".children omits it — a one-way link lets the parent be marked done while this child is excluded from parent-done-iff-children, judging the program prematurely complete (DIR-026)`
      );
    }
  }

  return { failures };
}

// ── selftest — runs fixture cases internally using temp task files. ───────────────────────────────
// RED case 1: parent `done` with a child that is `ready` → FAIL
// RED case 2: compound task with `todo` status and NO children → FAIL
// RED case 3: child declares `parent` but the parent's `children` omits it (link asymmetry) → FAIL
// RED case 4: child declares a `parent` that does not exist (dangling link) → FAIL
// GREEN case: parent `done` with all children `done` + compound `todo` with children + symmetric links → PASS
export function selftest(): boolean {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "it0-split-or-commit-"));
  let allPassed = true;

  interface TaskDef {
    status: string;
    role?: string;
    children?: string[];
    parent?: string;
  }

  function writeTask(dir: string, id: string, fields: TaskDef): void {
    const childrenBlock =
      fields.children && fields.children.length > 0
        ? `children:\n${fields.children.map((c) => `  - ${c}`).join("\n")}`
        : "children: []";
    const parentLine = `parent: ${fields.parent || "null"}`;
    const content = `---\nid: ${id}\nstatus: ${fields.status}\nrole: ${fields.role || "primitive"}\n${parentLine}\n${childrenBlock}\n---\n`;
    fs.writeFileSync(path.join(dir, `${id}.md`), content);
  }

  function runFixture(name: string, taskDefs: Record<string, TaskDef>, expectFail: boolean): void {
    const dir = path.join(tmpDir, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [id, fields] of Object.entries(taskDefs)) {
      writeTask(dir, id, fields);
    }
    const taskMap = loadTasks(dir);
    const { failures } = runChecks(taskMap);
    const didFail = failures.length > 0;
    if (didFail === expectFail) {
      console.log(`SELFTEST PASS: ${name} — ${expectFail ? `correctly detected ${failures.length} violation(s)` : "correctly found no violations"}`);
      if (failures.length > 0) {
        for (const f of failures) console.log(`  violation: ${f}`);
      }
    } else {
      console.error(`SELFTEST FAIL: ${name} — expected ${expectFail ? "FAIL" : "PASS"} but got ${didFail ? "FAIL" : "PASS"}`);
      if (failures.length > 0) {
        for (const f of failures) console.error(`  violation: ${f}`);
      }
      allPassed = false;
    }
  }

  // RED case 1: parent `done` with a child that is `ready`
  runFixture("red-parent-done-child-ready", {
    "parent-task": { status: "done", role: "compound", children: ["child-task"] },
    "child-task": { status: "ready", role: "primitive", children: [] },
  }, true /* expect FAIL */);

  // RED case 2: compound task with `todo` status and NO children (SELECT-split violation)
  runFixture("red-compound-todo-no-children", {
    "compound-unsplit": { status: "todo", role: "compound", children: [] },
  }, true /* expect FAIL */);

  // RED case 3: child declares `parent` but the parent's `children` omits it (link asymmetry) —
  // the exact TS-MIGRATION bug: parent looks done-able while an orphaned phase is still open.
  runFixture("red-child-link-asymmetry", {
    "prog-parent": { status: "done", role: "compound", children: ["phase-0"] },
    "phase-0": { status: "done", role: "primitive", parent: "prog-parent", children: [] },
    "phase-1": { status: "todo", role: "primitive", parent: "prog-parent", children: [] }, // omitted from parent.children
  }, true /* expect FAIL */);

  // RED case 4: child declares a `parent` that does not exist (dangling link)
  runFixture("red-dangling-parent", {
    "orphan": { status: "todo", role: "primitive", parent: "ghost-parent", children: [] },
  }, true /* expect FAIL */);

  // GREEN case: parent `done` with all children `done` + compound `todo` with children + SYMMETRIC links
  runFixture("green-compliant", {
    "parent-done": { status: "done", role: "compound", children: ["child-a", "child-b"] },
    "child-a": { status: "done", role: "primitive", parent: "parent-done", children: [] },
    "child-b": { status: "done", role: "primitive", parent: "parent-done", children: [] },
    "compound-with-children": { status: "todo", role: "compound", children: ["sub-x"] },
    "sub-x": { status: "todo", role: "primitive", parent: "compound-with-children", children: [] },
  }, false /* expect PASS */);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (allPassed) {
    console.log("SELFTEST: all 5 fixture cases PASS.");
    return true;
  } else {
    console.error("SELFTEST: one or more fixture cases FAILED.");
    return false;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error("usage: node it0-split-or-commit-check.ts [--tasks-dir <dir>] <workspace-root>");
  console.error("       node it0-split-or-commit-check.ts --selftest");
  process.exit(2);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }
  const wsRoot = args.find((a) => !a.startsWith("--"));
  if (!wsRoot) usage();
  const resolvedRoot = path.resolve(process.cwd(), wsRoot);
  // --tasks-dir: override the tasks subdirectory (default "tasks")
  let tasksDirRelative = "tasks";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tasks-dir") { tasksDirRelative = args[++i]; continue; }
  }
  const tasksDir = path.resolve(resolvedRoot, tasksDirRelative);
  if (!fs.existsSync(tasksDir)) {
    console.error(`ERROR: tasks directory not found: ${tasksDir}`);
    process.exit(2);
  }
  const taskMap = loadTasks(tasksDir);
  const { failures } = runChecks(taskMap);
  if (failures.length > 0) {
    console.log(`FAIL: ${failures.length} split-or-commit violation(s) found:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  } else {
    console.log(`PASS: ${taskMap.size} task(s) checked — no split-or-commit violations (parent-done-iff-children + SELECT-split + child-link-symmetry rules satisfied).`);
    process.exit(0);
  }
}
