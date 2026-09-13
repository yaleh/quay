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
//   4. DEP-DONE-IFF-DEPS: A task marked `done` whose `depends_on:` prerequisites are NOT all `done`
//      is a violation — a task cannot be done before its declared prerequisites. `depends_on` is the
//      machine-readable home for prerequisites (gap-prerequisite-gates-prose-invisible-to-mechanisms):
//      the same edges the ready-pool author→ready gate and the A15② dispatch dependency-readiness
//      check read, so a prose-only prerequisite (a `[[task-id]]` wikilink in a "Do not dispatch until
//      … lands" paragraph) is visible here and caught before a dependent is judged complete.
//
//   5. DEP-DANGLING: A task declaring `depends_on: [X]` where X does not exist is a dangling
//      prerequisite edge — fail-closed (a missing dep file cannot be confirmed done), the same
//      family as CHILD-LINK-SYMMETRY's dangling-parent rule.
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
//   node it0-split-or-commit-check.ts --changed [--base <ref>] [--only <id,id,…>] <workspace-root>
//   node it0-split-or-commit-check.ts --selftest
//
// --changed: the DELTA-SCOPED mode (gap-it0-split-or-commit-check-needs-change-tier-companion).
// The five rules above are WHOLE-STORE invariants, so the full-tier registration defers them to the
// full-suite gate — and a violation introduced by task A then reddens an UNRELATED task B's fan-in
// (measured: `STATIC_CHECK_FAILED: it0-split-or-commit-check` 17× in
// `.quay/verification-round.jsonl`, every one of them `tests==0 ∧ fail==0` pure-static red, first
// 2026-08-13T14:24:11Z / last 2026-09-04T08:16:12Z). This mode narrows the JUDGMENT to the delta:
//
//   ① the delta's task files are the `tasks/*.md` this change added or modified — `git diff
//      <base>...HEAD` (three-dot ⇒ merge-base, so a base branch that moved ahead contributes
//      nothing) ∪ uncommitted tracked edits ∪ untracked, where <base> is `--base` or the first
//      resolvable of develop / origin/develop / master / origin/master — or the explicit `--only`
//      id list;
//   ② only those files are LOADED, plus their 1-hop neighbour closure (children / parent /
//      depends_on) — so the cost is ∝ the delta's fan-out, NOT the store size (measured: 0.06–0.09 s
//      for a 1-task delta vs 0.49 s for the 2090-task whole-store pass);
//   ③ the SAME `runChecks` rules are then applied to that closure, and a violation is reported only
//      when at least one task NAMED by it is a delta task — a violation with NO delta participant is
//      a pre-existing one elsewhere in the store and is left to the full-tier backstop (延迟发现 ≠
//      丢弃), which is why this is a companion and not a replacement.
//   No delta task file (or an unusable git context) ⇒ an explicit `NOT-EVALUATED:` line + exit 0 —
//   never exit 3: the scoped runner evaluates raw commands under `set -euo pipefail`, so a non-zero
//   here would abort an innocent task whose delta legitimately carries no task file.
//
// Exit codes:
//   0 = all checks PASS (also: `--changed` with nothing to evaluate — NOT-EVALUATED)
//   1 = at least one violation found
//   2 = usage/environment error

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { helpExit } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TaskFrontmatter {
  id: string | null;
  status: string | null;
  role: string | null;
  children: string[];
  labels: string[];
  parent: string | null;
  dependsOn: string[];
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
    dependsOn: list("depends_on"),
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

// ── readTaskFile — read ONE tasks/<id>.md by id (the delta-scoped loader's unit of work). ─────────
function readTaskFile(tasksDir: string, id: string): TaskFrontmatter | null {
  const p = path.join(tasksDir, `${id}.md`);
  if (!fs.existsSync(p)) return null;
  const t = parseFrontmatter(fs.readFileSync(p, "utf8"));
  return t && t.id ? t : null;
}

// ── loadClosure — the delta + its 1-hop neighbour closure (children / parent / depends_on). ──────
// WHY a closure and not the whole store: every one of the five rules above is decidable from a task
// and its DIRECT relations — CHECK 1 needs a done compound's children's statuses, CHECK 3 needs the
// declaring task's parent's `children` list, CHECK 4/5 need the declared prerequisites. So a delta
// task plus one hop of neighbours is a SUFFICIENT input for judging that delta task, and the cost
// stays ∝ the delta's fan-out instead of ∝ the store size. This is what makes the change-tier
// companion affordable on every scoped run (the reason the whole-store pass was deferred in the
// first place is exactly that it is not).
//
// ⚠️ Consequence, stated explicitly: a violation whose subject is NOT in the delta and whose named
// tasks do not intersect the delta is NOT produced here (its neighbours were never loaded). That is
// the intended division of labour — the full-tier registration still runs the whole-store pass, so
// 延迟发现 ≠ 丢弃. The delta-scoped mode exists to make the CHANGER pay for what the changer broke.
export function loadClosure(tasksDir: string, seedIds: string[]): Map<string, TaskFrontmatter> {
  const map = new Map<string, TaskFrontmatter>();
  for (const id of seedIds) {
    const t = readTaskFile(tasksDir, id);
    if (t) map.set(t.id as string, t);
  }
  const neighbours = new Set<string>();
  for (const t of map.values()) {
    for (const c of t.children || []) neighbours.add(c);
    if (t.parent && t.parent !== "null") neighbours.add(t.parent);
    for (const d of t.dependsOn || []) neighbours.add(d);
  }
  for (const nid of neighbours) {
    if (map.has(nid)) continue;
    const t = readTaskFile(tasksDir, nid);
    if (t) map.set(t.id as string, t);
  }
  return map;
}

// ── gitDeltaTaskIds — the delta's task ids, derived from git (never from ## Touches). ────────────
// Reading the delta from git — not from the task's declared `## Touches` — is deliberate: Touches ⊋
// delta is normal (a task authorizes more than it edits) and Touches ⊉ delta is the anti-drift
// defect, so Touches is the wrong source for "what did this change actually change".
//
// The construction is the SAME one the sibling change-tier companion uses
// (checker-mutation-check.sh --check-changed, gap-checker-mutation-check-has-no-change-tier-companion),
// and it is chosen to be robust to the base branch ADVANCING while this branch sits still — the
// normal state of this repo, where fan-ins land on develop every few minutes:
//
//   base   = the --base override, else the first resolvable of develop / origin/develop / master /
//            origin/master (portable to third-party projects that have no `develop`)
//   delta  = `git diff --name-only <base>...HEAD`   (three-dot ⇒ merge-base: MY side only, so a
//                                                     develop that moved ahead contributes nothing)
//          ∪ `git diff --name-only HEAD`             (uncommitted: staged + unstaged)
//          ∪ `git ls-files --others --exclude-standard` (a task file created but not yet committed —
//                                                     the `quay-file-task` → fan-in window)
export const DEFAULT_BASES = ["develop", "origin/develop", "master", "origin/master"];

export function gitDeltaTaskIds(
  root: string,
  base: string | null,
  tasksDirRelative: string,
): { ids: string[]; base: string | null; notEvaluated: string | null } {
  const rel = tasksDirRelative.replace(/\/+$/, "");
  const run = (argv: string[]): { ok: boolean; out: string } => {
    const r = spawnSync("git", ["-C", root, ...argv], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return { ok: r.status === 0, out: r.stdout || "" };
  };
  const resolves = (ref: string): boolean => run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).ok;
  let resolvedBase: string | null = null;
  if (base !== null) {
    if (!resolves(base)) return { ids: [], base: null, notEvaluated: `base ref "${base}" does not resolve in ${root}` };
    resolvedBase = base;
  } else {
    resolvedBase = DEFAULT_BASES.find((b) => resolves(b)) ?? null;
    if (resolvedBase === null) {
      return { ids: [], base: null, notEvaluated: `none of the base refs (${DEFAULT_BASES.join(", ")}) resolve in ${root}` };
    }
  }
  const committed = run(["diff", "--name-only", `${resolvedBase}...HEAD`, "--", `${rel}/`]);
  if (!committed.ok) return { ids: [], base: resolvedBase, notEvaluated: `git diff ${resolvedBase}...HEAD failed in ${root}` };
  const working = run(["diff", "--name-only", "HEAD", "--", `${rel}/`]);
  if (!working.ok) return { ids: [], base: resolvedBase, notEvaluated: `git diff HEAD failed in ${root}` };
  const untracked = run(["ls-files", "--others", "--exclude-standard", "--", `${rel}/`]);
  if (!untracked.ok) return { ids: [], base: resolvedBase, notEvaluated: `git ls-files failed in ${root}` };
  const files = [committed.out, working.out, untracked.out]
    .flatMap((s) => s.split("\n"))
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = [...new Set(
    files
      .filter((f) => f.startsWith(`${rel}/`) && f.endsWith(".md"))
      .map((f) => path.basename(f, ".md")),
  )].sort();
  return { ids, base: resolvedBase, notEvaluated: null };
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
export function runChecks(taskMap: Map<string, TaskFrontmatter>, attributeTo?: Set<string>): CheckResult {
  const failures: string[] = [];

  // ATTRIBUTION FILTER — used by `--changed` ONLY (undefined ⇒ whole-store behaviour, byte-identical
  // to every existing caller). A violation is a RELATION among named tasks; it is reported here only
  // when at least one of those tasks is in the delta, because that is what makes the red attributable
  // to THIS change by construction (the property the whole-store pass cannot have, and the reason the
  // full tier was deferred). A violation naming no delta task is a pre-existing one elsewhere in the
  // store: the full-tier registration still catches it, so this is deferred, never dropped.
  const keep = (ids: string[]): boolean => !attributeTo || ids.some((i) => attributeTo.has(i));

  // CHECK 1: PARENT-DONE-IFF-CHILDREN
  // For every compound task with status `done`, verify all direct children also have status `done`.
  // Each level of a nested compound hierarchy is checked independently (flat, not recursive).
  for (const [id, t] of taskMap) {
    if (t.status !== "done") continue;
    if (!isCompound(t)) continue;
    const children = t.children || [];
    if (children.length === 0) continue; // done compound with no children is fine (leaf-compound)

    const nonDoneChildren: string[] = [];
    const nonDoneChildIds: string[] = [];
    for (const childId of children) {
      const child = taskMap.get(childId);
      const childStatus = child ? child.status : "missing";
      if (childStatus !== "done") {
        nonDoneChildren.push(`${childId} (status: ${childStatus})`);
        nonDoneChildIds.push(childId);
      }
    }
    if (nonDoneChildren.length > 0 && keep([id, ...nonDoneChildIds])) {
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
    if (children.length === 0 && keep([id])) {
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
      if (keep([id, parentId])) {
        failures.push(
          `CHILD-LINK-SYMMETRY: task "${id}" declares parent "${parentId}" but no such task exists — dangling parent link (DIR-026)`
        );
      }
      continue;
    }
    const siblings = parent.children || [];
    if (!siblings.includes(id) && keep([id, parentId])) {
      failures.push(
        `CHILD-LINK-SYMMETRY: task "${id}" declares parent "${parentId}" but "${parentId}".children omits it — a one-way link lets the parent be marked done while this child is excluded from parent-done-iff-children, judging the program prematurely complete (DIR-026)`
      );
    }
  }

  // CHECK 4: DEP-DONE-IFF-DEPS
  // For every task marked `done`, all `depends_on:` prerequisites must ALSO be `done`. A task cannot
  // be done before its declared prerequisites — otherwise a dependent is judged complete while a
  // prerequisite is still open (the same "prematurely done" family PARENT-DONE-IFF-CHILDREN kills,
  // over the depends_on edge). This is the split-or-commit gate's half of making prerequisites
  // mechanism-visible: a prose-only prerequisite has no depends_on edge, so it is NOT checked here —
  // the ready-pool author→ready gate (prose-prereq-no-edge exclusion) blocks that shape at promotion.
  for (const [id, t] of taskMap) {
    if (t.status !== "done") continue;
    const deps = t.dependsOn || [];
    if (deps.length === 0) continue;
    const nonDoneDeps: string[] = [];
    const nonDoneDepIds: string[] = [];
    for (const depId of deps) {
      const dep = taskMap.get(depId);
      const depStatus = dep ? dep.status : "missing";
      if (depStatus !== "done") {
        nonDoneDeps.push(`${depId} (status: ${depStatus})`);
        nonDoneDepIds.push(depId);
      }
    }
    if (nonDoneDeps.length > 0 && keep([id, ...nonDoneDepIds])) {
      failures.push(
        `DEP-DONE-IFF-DEPS: task "${id}" is done but has ${nonDoneDeps.length} non-done prerequisite(s) in depends_on: ${nonDoneDeps.join(", ")} — a done task requires ALL its depends_on prerequisites done (gap-prerequisite-gates-prose-invisible-to-mechanisms)`
      );
    }
  }

  // CHECK 5: DEP-DANGLING
  // A task declaring `depends_on: [X]` where X does not exist is a dangling prerequisite edge — the
  // edge cannot be confirmed done (fail-closed). A prerequisite written in prose instead of the edge
  // is invisible here; a DANGLING edge is the opposite defect (the edge exists but points nowhere).
  for (const [id, t] of taskMap) {
    for (const depId of t.dependsOn || []) {
      if (!taskMap.has(depId) && keep([id, depId])) {
        failures.push(
          `DEP-DANGLING: task "${id}" declares depends_on "${depId}" but no such task exists — dangling prerequisite edge (gap-prerequisite-gates-prose-invisible-to-mechanisms)`
        );
      }
    }
  }

  return { failures };
}

// ── selftest — runs fixture cases internally using temp task files. ───────────────────────────────
// RED case 1: parent `done` with a child that is `ready` → FAIL
// RED case 2: compound task with `todo` status and NO children → FAIL
// RED case 3: child declares `parent` but the parent's `children` omits it (link asymmetry) → FAIL
// RED case 4: child declares a `parent` that does not exist (dangling link) → FAIL
// RED case 5: task `done` with a depends_on prerequisite that is `todo` (DEP-DONE-IFF-DEPS) → FAIL
// RED case 6: task declares a `depends_on` id that does not exist (DEP-DANGLING) → FAIL
// GREEN case: parent `done` with all children `done` + compound `todo` with children + symmetric
//   links + a done task whose depends_on deps are all done → PASS
export function selftest(): boolean {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "it0-split-or-commit-"));
  let allPassed = true;

  interface TaskDef {
    status: string;
    role?: string;
    children?: string[];
    parent?: string;
    dependsOn?: string[];
  }

  function writeTask(dir: string, id: string, fields: TaskDef): void {
    const childrenBlock =
      fields.children && fields.children.length > 0
        ? `children:\n${fields.children.map((c) => `  - ${c}`).join("\n")}`
        : "children: []";
    const dependsOnBlock =
      fields.dependsOn && fields.dependsOn.length > 0
        ? `depends_on:\n${fields.dependsOn.map((d) => `  - ${d}`).join("\n")}`
        : "depends_on: []";
    const parentLine = `parent: ${fields.parent || "null"}`;
    const content = `---\nid: ${id}\nstatus: ${fields.status}\nrole: ${fields.role || "primitive"}\n${parentLine}\n${childrenBlock}\n${dependsOnBlock}\n---\n`;
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

  // RED case 5: task `done` with a depends_on prerequisite that is `todo` (DEP-DONE-IFF-DEPS)
  runFixture("red-done-with-undone-dep", {
    "pre-req": { status: "todo", role: "primitive", children: [] },
    "dependent-done": { status: "done", role: "primitive", children: [], dependsOn: ["pre-req"] },
  }, true /* expect FAIL */);

  // RED case 6: task declares a `depends_on` id that does not exist (DEP-DANGLING)
  runFixture("red-dangling-dep", {
    "dep-user": { status: "ready", role: "primitive", children: [], dependsOn: ["ghost-dep"] },
  }, true /* expect FAIL */);

  // GREEN case: parent `done` with all children `done` + compound `todo` with children + SYMMETRIC
  // links + a done task whose depends_on deps are all done
  runFixture("green-compliant", {
    "parent-done": { status: "done", role: "compound", children: ["child-a", "child-b"] },
    "child-a": { status: "done", role: "primitive", parent: "parent-done", children: [] },
    "child-b": { status: "done", role: "primitive", parent: "parent-done", children: [] },
    "compound-with-children": { status: "todo", role: "compound", children: ["sub-x"] },
    "sub-x": { status: "todo", role: "primitive", parent: "compound-with-children", children: [] },
    "dep-a": { status: "done", role: "primitive", children: [] },
    "dep-b": { status: "done", role: "primitive", children: [] },
    "dep-dependent": { status: "done", role: "primitive", children: [], dependsOn: ["dep-a", "dep-b"] },
  }, false /* expect PASS */);

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });

  if (allPassed) {
    console.log("SELFTEST: all 7 fixture cases PASS.");
    return true;
  } else {
    console.error("SELFTEST: one or more fixture cases FAILED.");
    return false;
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
function usage(): never {
  console.error("usage: node it0-split-or-commit-check.ts [--allow-empty] [--tasks-dir <dir>] <workspace-root>");
  console.error("       node it0-split-or-commit-check.ts --changed [--base <ref>] [--only <id,id,…>] [--tasks-dir <dir>] <workspace-root>");
  console.error("       node it0-split-or-commit-check.ts --selftest");
  process.exit(2);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "it0-split-or-commit-check";
if (isDirect) {
  const args = process.argv.slice(2);
  const USAGE = "usage: node it0-split-or-commit-check.ts [--allow-empty] [--changed [--base <ref>] [--only <id,id,…>]] [--tasks-dir <dir>] <workspace-root>";
  if (args.includes("--help") || args.includes("-h")) helpExit(USAGE);
  if (args.includes("--selftest")) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
  }
  // Flag parsing: consume the VALUE of each value-taking flag so it can never be mistaken for the
  // positional workspace-root (the previous `args.find(a => !a.startsWith("--"))` returned the value
  // of `--tasks-dir` when that flag was used).
  const VALUE_FLAGS = new Set(["--tasks-dir", "--base", "--only"]);
  const flagValue = (name: string): string | null => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  };
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (args[i].startsWith("--")) continue;
    positionals.push(args[i]);
  }
  const wsRoot = positionals[0];
  if (!wsRoot) usage();
  const resolvedRoot = path.resolve(process.cwd(), wsRoot);
  // --tasks-dir: override the tasks subdirectory (default "tasks")
  const tasksDirRelative = flagValue("--tasks-dir") ?? "tasks";
  const tasksDir = path.resolve(resolvedRoot, tasksDirRelative);

  // ── --changed: the DELTA-SCOPED mode (see the header). ───────────────────────────────────────────
  if (args.includes("--changed")) {
    const base = flagValue("--base");
    const only = flagValue("--only");
    let seedIds: string[];
    let baseLabel = base ?? "(unresolved)";
    let notEvaluated: string | null = null;
    if (only !== null) {
      seedIds = only.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      const d = gitDeltaTaskIds(resolvedRoot, base, tasksDirRelative);
      seedIds = d.ids;
      notEvaluated = d.notEvaluated;
      if (d.base !== null) baseLabel = d.base;
    }
    if (notEvaluated !== null) {
      console.log(`NOT-EVALUATED: it0-split-or-commit-check --changed — ${notEvaluated}; the delta-scoped split-or-commit judgment could not be made (⛔ NOT conflated with PASS — hard rule 3b: 'could not read the input' must not share an output with 'checked and clean'). The full-tier whole-store registration still runs at the full-suite gate (deferred ≠ dropped).`);
      process.exit(0);
    }
    if (seedIds.length === 0) {
      console.log(`NOT-EVALUATED: it0-split-or-commit-check --changed — no task file in this delta (base ${baseLabel}); nothing for the delta-scoped judgment to attribute (⛔ NOT conflated with PASS). The full-tier whole-store registration still runs at the full-suite gate.`);
      process.exit(0);
    }
    if (!fs.existsSync(tasksDir)) {
      console.log(`NOT-EVALUATED: it0-split-or-commit-check --changed — tasks directory not found: ${tasksDir} (⛔ NOT conflated with PASS).`);
      process.exit(0);
    }
    const closure = loadClosure(tasksDir, seedIds);
    const deltaSet = new Set(seedIds);
    if (closure.size === 0) {
      console.log(`NOT-EVALUATED: it0-split-or-commit-check --changed — none of the ${seedIds.length} delta task file(s) resolved in ${tasksDir} (⛔ NOT conflated with PASS).`);
      process.exit(0);
    }
    const { failures } = runChecks(closure, deltaSet);
    if (failures.length > 0) {
      console.log(`FAIL: ${failures.length} split-or-commit violation(s) attributable to THIS delta (${seedIds.length} delta task file(s), ${closure.size} task(s) in the delta+1-hop closure — ⛔ not the whole store):`);
      for (const f of failures) console.log(`  - ${f}`);
      process.exit(1);
    }
    console.log(`PASS: ${seedIds.length} delta task file(s) + neighbours (${closure.size} task(s) total) — no split-or-commit violation attributable to this delta (base ${baseLabel}); the whole-store pass remains at the full-tier gate.`);
    process.exit(0);
  }

  if (!fs.existsSync(tasksDir)) {
    console.error(`ERROR: tasks directory not found: ${tasksDir}`);
    process.exit(2);
  }
  const taskMap = loadTasks(tasksDir);
  // EMPTY-SET guard (gap-checks-that-verify-an-empty-set-must-fail-closed): a workspace whose task
  // set is EMPTY would make every rule vacuous — "PASS: 0 task(s) checked" is indistinguishable from
  // "never looked". Fail-closed by default; an explicit --allow-empty waives it (default deny).
  const allowEmpty = args.includes("--allow-empty");
  if (taskMap.size === 0 && !allowEmpty) {
    console.log(`FAIL: 0 task(s) checked — the task set is empty, so this gate verified nothing (fail-closed: 'no problems' must not be indistinguishable from 'never looked'; pass --allow-empty to waive)`);
    process.exit(1);
  }
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
