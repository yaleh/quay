// @test-group engine
// Unit tests for it0-split-or-commit-check.ts — the DIR-026 single-source enforcement of the
// PARENT-DONE-IFF-CHILDREN, SELECT-SPLIT, and CHILD-LINK-SYMMETRY rules. Written to close the
// ADR-001 clause 2 gap: this load-bearing script (imported by nothing else, but wrapped/registered
// as the `split-or-commit` `.quay/gates.yml` testPass gate) had no sibling test until now — flagged
// by `loadbearing-test-gate.mjs` and the real `adr-001` gate FAILing against this repo's own tree.
// RED-first (ADR-001 / DIR-019 discipline): the fix for any failing case belongs in the MODULE,
// never in the fixtures.
// Run:
//   node --test experiments/quay-perpetual-stream/test/it0-split-or-commit-check.test.mjs
//   node --test --experimental-test-coverage experiments/quay-perpetual-stream/test/it0-split-or-commit-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFrontmatter,
  loadTasks,
  runChecks,
  selftest,
} from "../scripts/it0-split-or-commit-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "it0-split-or-commit-check.ts");
const REPO_ROOT = path.resolve(__dirname, "..", "..", ".."); // experiments/quay-perpetual-stream/test → repo root

function tmpTasksDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "split-or-commit-"));
  return dir;
}

function writeTaskFile(dir, id, frontmatterExtra) {
  fs.writeFileSync(path.join(dir, `${id}.md`), `---\nid: ${id}\n${frontmatterExtra}\n---\nbody text\n`);
}

// ── parseFrontmatter ─────────────────────────────────────────────────────────────────────────────
test("parseFrontmatter: scalar fields (id/status/role/parent)", () => {
  const t = parseFrontmatter("---\nid: T-1\nstatus: todo\nrole: primitive\nparent: T-0\n---\nbody\n");
  assert.equal(t.id, "T-1");
  assert.equal(t.status, "todo");
  assert.equal(t.role, "primitive");
  assert.equal(t.parent, "T-0");
});

test("parseFrontmatter: strips quotes from scalar values", () => {
  const t = parseFrontmatter('---\nid: "T-1"\nstatus: \'todo\'\n---\n');
  assert.equal(t.id, "T-1");
  assert.equal(t.status, "todo");
});

test("parseFrontmatter: block-list children/labels", () => {
  const t = parseFrontmatter("---\nid: T-1\nchildren:\n  - T-2\n  - T-3\nlabels:\n  - directive\n---\n");
  assert.deepEqual(t.children, ["T-2", "T-3"]);
  assert.deepEqual(t.labels, ["directive"]);
});

test("parseFrontmatter: flow-list children (bracket syntax)", () => {
  const t = parseFrontmatter("---\nid: T-1\nchildren: [T-2, T-3]\n---\n");
  assert.deepEqual(t.children, ["T-2", "T-3"]);
});

test("parseFrontmatter: missing children/labels/parent → empty arrays / null", () => {
  const t = parseFrontmatter("---\nid: T-1\nstatus: todo\n---\n");
  assert.deepEqual(t.children, []);
  assert.deepEqual(t.labels, []);
  assert.equal(t.parent, null);
});

test("parseFrontmatter: no --- fences → null (not a valid task file)", () => {
  assert.equal(parseFrontmatter("just some text, no frontmatter"), null);
});

// ── loadTasks ────────────────────────────────────────────────────────────────────────────────────
test("loadTasks: reads .md files from a dir into a Map keyed by id", () => {
  const dir = tmpTasksDir();
  writeTaskFile(dir, "T-1", "status: todo");
  writeTaskFile(dir, "T-2", "status: done");
  const map = loadTasks(dir);
  assert.equal(map.size, 2);
  assert.equal(map.get("T-1").status, "todo");
  assert.equal(map.get("T-2").status, "done");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadTasks: non-.md files are ignored", () => {
  const dir = tmpTasksDir();
  writeTaskFile(dir, "T-1", "status: todo");
  fs.writeFileSync(path.join(dir, "README.txt"), "not a task");
  const map = loadTasks(dir);
  assert.equal(map.size, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("loadTasks: missing directory → empty Map", () => {
  const map = loadTasks(path.join(os.tmpdir(), "does-not-exist-" + Date.now()));
  assert.equal(map.size, 0);
});

test("loadTasks: a .md file with no id is skipped", () => {
  const dir = tmpTasksDir();
  fs.writeFileSync(path.join(dir, "no-id.md"), "---\nstatus: todo\n---\nbody\n");
  const map = loadTasks(dir);
  assert.equal(map.size, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── runChecks: CHECK 1 — PARENT-DONE-IFF-CHILDREN ───────────────────────────────────────────────
test("runChecks CHECK1: done compound parent with a non-done child → FAIL", () => {
  const map = new Map([
    ["P", { id: "P", status: "done", role: "compound", children: ["C"], labels: [], parent: null }],
    ["C", { id: "C", status: "ready", role: "primitive", children: [], labels: [], parent: "P" }],
  ]);
  const { failures } = runChecks(map);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /PARENT-DONE-IFF-CHILDREN/);
  assert.match(failures[0], /C \(status: ready\)/);
});

test("runChecks CHECK1: done compound parent referencing a MISSING child → FAIL, reports 'missing'", () => {
  const map = new Map([
    ["P", { id: "P", status: "done", role: "compound", children: ["ghost"], labels: [], parent: null }],
  ]);
  const { failures } = runChecks(map);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /ghost \(status: missing\)/);
});

test("runChecks CHECK1: done compound parent with ALL children done → no failure", () => {
  const map = new Map([
    ["P", { id: "P", status: "done", role: "compound", children: ["C"], labels: [], parent: null }],
    ["C", { id: "C", status: "done", role: "primitive", children: [], labels: [], parent: "P" }],
  ]);
  assert.deepEqual(runChecks(map).failures, []);
});

test("runChecks CHECK1: done compound parent with EMPTY children → no failure (leaf-compound)", () => {
  const map = new Map([
    ["P", { id: "P", status: "done", role: "compound", children: [], labels: [], parent: null }],
  ]);
  assert.deepEqual(runChecks(map).failures, []);
});

test("runChecks CHECK1: non-done parent with non-done children → rule does not apply", () => {
  const map = new Map([
    ["P", { id: "P", status: "todo", role: "compound", children: ["C"], labels: [], parent: null }],
    ["C", { id: "C", status: "todo", role: "primitive", children: [], labels: [], parent: "P" }],
  ]);
  assert.deepEqual(runChecks(map).failures, []);
});

// ── runChecks: CHECK 2 — SELECT-SPLIT ───────────────────────────────────────────────────────────
test("runChecks CHECK2: compound task, status todo, NO children → FAIL", () => {
  const map = new Map([
    ["P", { id: "P", status: "todo", role: "compound", children: [], labels: [], parent: null }],
  ]);
  const { failures } = runChecks(map);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /SELECT-SPLIT/);
});

test("runChecks CHECK2: compound task, status ready, NO children → FAIL", () => {
  const map = new Map([
    ["P", { id: "P", status: "ready", role: "compound", children: [], labels: [], parent: null }],
  ]);
  assert.match(runChecks(map).failures[0], /SELECT-SPLIT/);
});

test("runChecks CHECK2: compound task WITH children → no failure", () => {
  const map = new Map([
    ["P", { id: "P", status: "todo", role: "compound", children: ["C"], labels: [], parent: null }],
    ["C", { id: "C", status: "todo", role: "primitive", children: [], labels: [], parent: "P" }],
  ]);
  assert.deepEqual(runChecks(map).failures, []);
});

test("runChecks CHECK2: non-compound (primitive) task with no children → rule does not apply", () => {
  const map = new Map([
    ["T", { id: "T", status: "todo", role: "primitive", children: [], labels: [], parent: null }],
  ]);
  assert.deepEqual(runChecks(map).failures, []);
});

test("runChecks CHECK2: compound task, status done, no children → rule does not apply (only todo/ready)", () => {
  const map = new Map([
    ["P", { id: "P", status: "done", role: "compound", children: [], labels: [], parent: null }],
  ]);
  assert.deepEqual(runChecks(map).failures, []);
});

// ── runChecks: CHECK 3 — CHILD-LINK-SYMMETRY ────────────────────────────────────────────────────
test("runChecks CHECK3: parent declared but does not exist → FAIL (dangling link)", () => {
  const map = new Map([
    ["C", { id: "C", status: "todo", role: "primitive", children: [], labels: [], parent: "ghost" }],
  ]);
  const { failures } = runChecks(map);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /CHILD-LINK-SYMMETRY/);
  assert.match(failures[0], /dangling parent link/);
});

test("runChecks CHECK3: parent exists but its children omit the declaring task → FAIL (asymmetry)", () => {
  const map = new Map([
    ["P", { id: "P", status: "todo", role: "compound", children: ["OTHER"], labels: [], parent: null }],
    ["C", { id: "C", status: "todo", role: "primitive", children: [], labels: [], parent: "P" }],
  ]);
  const { failures } = runChecks(map);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /CHILD-LINK-SYMMETRY/);
  assert.match(failures[0], /omits it/);
});

test("runChecks CHECK3: parent exists and lists the child → no failure", () => {
  const map = new Map([
    ["P", { id: "P", status: "todo", role: "compound", children: ["C"], labels: [], parent: null }],
    ["C", { id: "C", status: "todo", role: "primitive", children: [], labels: [], parent: "P" }],
  ]);
  assert.deepEqual(runChecks(map).failures, []);
});

test("runChecks CHECK3: no parent declared (null or literal 'null') → no failure", () => {
  const map = new Map([
    ["A", { id: "A", status: "todo", role: "primitive", children: [], labels: [], parent: null }],
    ["B", { id: "B", status: "todo", role: "primitive", children: [], labels: [], parent: "null" }],
  ]);
  assert.deepEqual(runChecks(map).failures, []);
});

test("runChecks: multiple simultaneous violations across all 3 checks are all reported", () => {
  const map = new Map([
    ["P", { id: "P", status: "done", role: "compound", children: ["C"], labels: [], parent: null }],
    ["C", { id: "C", status: "todo", role: "primitive", children: [], labels: [], parent: "P" }],
    ["Q", { id: "Q", status: "todo", role: "compound", children: [], labels: [], parent: null }],
    ["R", { id: "R", status: "todo", role: "primitive", children: [], labels: [], parent: "ghost" }],
  ]);
  const { failures } = runChecks(map);
  assert.equal(failures.length, 3);
  assert.ok(failures.some((f) => f.startsWith("PARENT-DONE-IFF-CHILDREN")));
  assert.ok(failures.some((f) => f.startsWith("SELECT-SPLIT")));
  assert.ok(failures.some((f) => f.startsWith("CHILD-LINK-SYMMETRY")));
});

// ── selftest() — the module's own embedded RED+GREEN fixture suite ─────────────────────────────────
test("selftest(): the module's own 4 RED + 1 GREEN fixture cases all behave as designed", () => {
  assert.equal(selftest(), true);
});

// ── CLI (isDirect block) — real subprocess invocation ───────────────────────────────────────────
test("CLI: --selftest → exit 0", () => {
  const r = spawnCli(["--selftest"]);
  assert.equal(r.status, 0);
});

test("CLI: no args → usage, exit 2", () => {
  const r = spawnCli([]);
  assert.equal(r.status, 2);
});

test("CLI: workspace root with no tasks/ dir → exit 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "split-or-commit-no-tasks-"));
  const r = spawnCli([dir]);
  assert.equal(r.status, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("CLI: real workspace with a violation → FAIL, exit 1", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "split-or-commit-cli-fail-"));
  fs.mkdirSync(path.join(root, "tasks"));
  writeTaskFile(path.join(root, "tasks"), "P", "status: todo\nrole: compound\nchildren: []");
  const r = spawnCli([root]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /SELECT-SPLIT/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("CLI: real workspace with no violations → PASS, exit 0", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "split-or-commit-cli-pass-"));
  fs.mkdirSync(path.join(root, "tasks"));
  writeTaskFile(path.join(root, "tasks"), "T", "status: todo\nrole: primitive");
  const r = spawnCli([root]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /PASS/);
  fs.rmSync(root, { recursive: true, force: true });
});

test("CLI: against THIS repo's own real tasks/ (D1 real-object demonstration) → PASS, exit 0", () => {
  const r = spawnCli([REPO_ROOT]);
  assert.equal(r.status, 0, `expected PASS against the real repo; got stdout=${r.stdout} stderr=${r.stderr}`);
});

// ── EMPTY-SET fail-closed (gap-checks-that-verify-an-empty-set-must-fail-closed) ────────────────
test("CLI: EMPTY tasks dir → exit 1 (empty-set fail-closed); --allow-empty → exit 0", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "split-or-commit-empty-"));
  fs.mkdirSync(path.join(root, "tasks"));
  try {
    const hard = spawnCli([root]);
    assert.equal(hard.status, 1, "an empty task set must fail-closed ('0 tasks checked' is indistinguishable from 'never looked')");
    assert.match(hard.stdout, /empty|fail-closed/i);
    const waived = spawnCli(["--allow-empty", root]);
    assert.equal(waived.status, 0, "--allow-empty waives the empty-set guard (default deny)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function spawnCli(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}
