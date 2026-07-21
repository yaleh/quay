#!/usr/bin/env node
// it0-split-or-commit-check.mjs — single-source enforcement for the two split-or-commit rules
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
// D3·R7 enforcement pointer: OUTER-LOOP.md's prose description of parent-done-iff-children
// at Step 1 / SPLIT-OR-COMMIT references THIS script as the mechanical enforcement.
// <!-- enforcement: scripts/it0-split-or-commit-check.mjs -->
//
// Reconciliation with store.js: packages/quay-native/src/store.js's `childrenStatus()`
// function already detects compound tasks with incomplete subtrees (returning "stale-done").
// This script lifts that same invariant to the OUTER-LOOP milestone boundary without forking
// the logic — it reuses the same pattern (walk children, check status recursively) directly
// on the raw task files (no store.js import required; the check runs on the task directory
// without needing a running quay instance).
//
// Usage:
//   node it0-split-or-commit-check.mjs <workspace-root>
//   node it0-split-or-commit-check.mjs --selftest
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

// ── parseFrontmatter — extract id, status, role, children from YAML frontmatter. ─────────────────
// Lenient parser matching the existing task-schema.mjs pattern: handles block list and flow list for
// arrays (children/labels). Returns null if not a valid task file (no --- fences).
export function parseFrontmatter(text) {
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  // Scalar field: `key: value`
  function scalar(key) {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
    return m ? m[1].replace(/^["']|["']$/g, "").trim() : null;
  }

  // Block list field: `key:\n  - val1\n  - val2` OR flow list: `key: [val1, val2]`
  function list(key) {
    const flowM = fm.match(new RegExp(`^${key}:\\s*\\[([^\\]]*)\\]\\s*$`, "m"));
    if (flowM) {
      return flowM[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    const lines = fm.split(/\r?\n/);
    const idx = lines.findIndex((l) => new RegExp(`^${key}:\\s*$`).test(l));
    if (idx < 0) return [];
    const items = [];
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
export function loadTasks(tasksDir) {
  const taskMap = new Map();
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
function isCompound(t) {
  return t.role === "compound" || (t.children && t.children.length > 0);
}

// ── runChecks — pure function: given a Map<id, task>, returns {failures: string[]}. ──────────────
// Reconciliation with store.js childrenStatus(): the same recursive pattern is applied here
// (walk children, check each child's status, recurse for compound children) without importing
// store.js — a standalone check for the outer-loop gate context.
export function runChecks(taskMap) {
  const failures = [];

  // Collect violations. Use a cache to avoid redundant subtree walks.
  const statusCache = new Map();

  function effectiveStatus(id, visited = new Set()) {
    if (statusCache.has(id)) return statusCache.get(id);
    if (visited.has(id)) {
      // Cycle guard (same as store.js childrenStatus' cycle-safety pattern).
      return "missing";
    }
    const t = taskMap.get(id);
    if (!t) return "missing";
    if (!isCompound(t)) {
      statusCache.set(id, t.status);
      return t.status;
    }
    // Compound task: status is only truly "done" if ALL children are effectively done.
    const children = t.children || [];
    if (children.length === 0) {
      // Compound with no children: propagate stored status as-is for this sub-function;
      // SELECT-split violations are checked separately below.
      statusCache.set(id, t.status);
      return t.status;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(id);
    const allChildrenDone = children.every((cid) => effectiveStatus(cid, nextVisited) === "done");
    const effective = t.status === "done" && !allChildrenDone ? "stale-done" : t.status;
    statusCache.set(id, effective);
    return effective;
  }

  // CHECK 1: PARENT-DONE-IFF-CHILDREN
  // For every compound task with status `done`, verify all children are also effectively done.
  for (const [id, t] of taskMap) {
    if (t.status !== "done") continue;
    if (!isCompound(t)) continue;
    const children = t.children || [];
    if (children.length === 0) continue; // done compound with no children is fine (leaf-compound)

    const nonDoneChildren = [];
    for (const childId of children) {
      const childEffective = effectiveStatus(childId);
      if (childEffective !== "done") {
        const child = taskMap.get(childId);
        const childStatus = child ? child.status : "missing";
        nonDoneChildren.push(`${childId} (status: ${childEffective !== childStatus ? `${childStatus}/effective:${childEffective}` : childStatus})`);
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

  return { failures };
}

// ── selftest — runs three fixture cases internally using temp task files. ─────────────────────────
// RED case 1: parent `done` with a child that is `ready` → FAIL
// RED case 2: compound task with `todo` status and NO children → FAIL
// GREEN case: parent `done` with all children `done` + compound `todo` with children → PASS
export function selftest() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "it0-split-or-commit-"));
  let allPassed = true;

  function writeTask(dir, id, fields) {
    const childrenBlock =
      fields.children && fields.children.length > 0
        ? `children:\n${fields.children.map((c) => `  - ${c}`).join("\n")}`
        : "children: []";
    const content = `---\nid: ${id}\nstatus: ${fields.status}\nrole: ${fields.role || "primitive"}\n${childrenBlock}\n---\n`;
    fs.writeFileSync(path.join(dir, `${id}.md`), content);
  }

  function runFixture(name, taskDefs, expectFail) {
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

  // GREEN case: parent `done` with all children `done` + compound `todo` with children
  runFixture("green-compliant", {
    "parent-done": { status: "done", role: "compound", children: ["child-a", "child-b"] },
    "child-a": { status: "done", role: "primitive", children: [] },
    "child-b": { status: "done", role: "primitive", children: [] },
    "compound-with-children": { status: "todo", role: "compound", children: ["sub-x"] },
    "sub-x": { status: "todo", role: "primitive", children: [] },
  }, false /* expect PASS */);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (allPassed) {
    console.log("SELFTEST: all 3 fixture cases PASS.");
    return true;
  } else {
    console.error("SELFTEST: one or more fixture cases FAILED.");
    return false;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage() {
  console.error("usage: node it0-split-or-commit-check.mjs <workspace-root>");
  console.error("       node it0-split-or-commit-check.mjs --selftest");
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
  const tasksDir = path.join(resolvedRoot, "tasks");
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
    console.log(`PASS: ${taskMap.size} task(s) checked — no split-or-commit violations (parent-done-iff-children + SELECT-split rules satisfied).`);
    process.exit(0);
  }
}
