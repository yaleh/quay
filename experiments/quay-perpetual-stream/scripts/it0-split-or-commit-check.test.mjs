// it0-split-or-commit-check.test.mjs — Node built-in test runner suite for
// it0-split-or-commit-check.mjs (C1 / exp5-M-CRYST-C1).
//
// Tests the pure runChecks() + parseFrontmatter() exports with synthetic task data —
// does NOT depend on live tasks/ state.
//
// Run: node --test experiments/quay-perpetual-stream/scripts/it0-split-or-commit-check.test.mjs
//      (from repo root or worktree root)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter, runChecks, loadTasks, selftest } from "./it0-split-or-commit-check.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── parseFrontmatter tests ───────────────────────────────────────────────────────────────────────

describe("parseFrontmatter", () => {
  test("parses basic task frontmatter", () => {
    const text = `---
id: task-001
status: done
role: compound
children:
  - child-a
  - child-b
---
## Body
`;
    const t = parseFrontmatter(text);
    assert.equal(t.id, "task-001");
    assert.equal(t.status, "done");
    assert.equal(t.role, "compound");
    assert.deepEqual(t.children, ["child-a", "child-b"]);
  });

  test("parses flow-list children", () => {
    const text = `---
id: task-002
status: todo
role: compound
children: [child-x, child-y]
---
`;
    const t = parseFrontmatter(text);
    assert.deepEqual(t.children, ["child-x", "child-y"]);
  });

  test("parses empty children list", () => {
    const text = `---
id: task-003
status: todo
role: compound
children: []
---
`;
    const t = parseFrontmatter(text);
    assert.deepEqual(t.children, []);
  });

  test("returns null for non-frontmatter text", () => {
    const t = parseFrontmatter("no frontmatter here");
    assert.equal(t, null);
  });

  test("parses primitive task", () => {
    const text = `---
id: task-004
status: ready
role: primitive
children: []
---
`;
    const t = parseFrontmatter(text);
    assert.equal(t.role, "primitive");
    assert.deepEqual(t.children, []);
  });
});

// ── runChecks: PARENT-DONE-IFF-CHILDREN ────────────────────────────────────────────────────────

describe("runChecks — parent-done-iff-children", () => {
  test("RED: done parent with ready child → FAIL", () => {
    const taskMap = new Map([
      ["parent", { id: "parent", status: "done", role: "compound", children: ["child"] }],
      ["child", { id: "child", status: "ready", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /PARENT-DONE-IFF-CHILDREN/);
    assert.match(failures[0], /parent/);
    assert.match(failures[0], /child/);
  });

  test("RED: done parent with todo child → FAIL", () => {
    const taskMap = new Map([
      ["parent", { id: "parent", status: "done", role: "compound", children: ["child"] }],
      ["child", { id: "child", status: "todo", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /PARENT-DONE-IFF-CHILDREN/);
  });

  test("GREEN: done parent with all done children → PASS", () => {
    const taskMap = new Map([
      ["parent", { id: "parent", status: "done", role: "compound", children: ["a", "b"] }],
      ["a", { id: "a", status: "done", role: "primitive", children: [] }],
      ["b", { id: "b", status: "done", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 0);
  });

  test("GREEN: non-done (ready) parent — check does not fire", () => {
    const taskMap = new Map([
      ["parent", { id: "parent", status: "ready", role: "compound", children: ["child"] }],
      ["child", { id: "child", status: "todo", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 0);
  });

  test("GREEN: primitive done task (no children) → PASS", () => {
    const taskMap = new Map([
      ["task", { id: "task", status: "done", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 0);
  });

  test("RED: nested stale-done — grandparent done but grandchild not done → FAIL", () => {
    // grandparent: done, children: [parent]
    // parent: done (stale), children: [child]
    // child: todo
    // Checks: grandparent is done + compound → walks children → parent (done + compound) →
    //   effective status of parent is stale-done (child is not done) → grandparent has non-done child.
    const taskMap = new Map([
      ["grandparent", { id: "grandparent", status: "done", role: "compound", children: ["middle"] }],
      ["middle", { id: "middle", status: "done", role: "compound", children: ["leaf"] }],
      ["leaf", { id: "leaf", status: "todo", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    // At minimum, grandparent should fail (its child "middle" is effectively stale-done)
    // middle itself might also fail (its child "leaf" is not done)
    assert.ok(failures.length >= 1);
    const allText = failures.join(" ");
    assert.match(allText, /PARENT-DONE-IFF-CHILDREN/);
  });

  test("GREEN: done parent with missing child reference — no crash (missing child has special status)", () => {
    const taskMap = new Map([
      ["parent", { id: "parent", status: "done", role: "compound", children: ["nonexistent"] }],
    ]);
    // The missing child should not crash; it should be flagged as a non-done child
    const { failures } = runChecks(taskMap);
    // A missing child is not "done", so parent-done-iff-children should fail
    assert.equal(failures.length, 1);
    assert.match(failures[0], /PARENT-DONE-IFF-CHILDREN/);
  });
});

// ── runChecks: SELECT-SPLIT ────────────────────────────────────────────────────────────────────

describe("runChecks — SELECT-SPLIT", () => {
  test("RED: compound todo with no children → FAIL", () => {
    const taskMap = new Map([
      ["epic", { id: "epic", status: "todo", role: "compound", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /SELECT-SPLIT/);
    assert.match(failures[0], /epic/);
  });

  test("RED: compound ready with no children → FAIL", () => {
    const taskMap = new Map([
      ["epic", { id: "epic", status: "ready", role: "compound", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /SELECT-SPLIT/);
  });

  test("GREEN: compound todo with children → PASS", () => {
    const taskMap = new Map([
      ["epic", { id: "epic", status: "todo", role: "compound", children: ["sub"] }],
      ["sub", { id: "sub", status: "todo", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 0);
  });

  test("GREEN: compound done with no children → PASS (done state is fine)", () => {
    // A done compound with no children is not a SELECT-split violation (it completed).
    const taskMap = new Map([
      ["epic", { id: "epic", status: "done", role: "compound", children: [] }],
    ]);
    // The parent-done-iff-children check skips empty-children done tasks; SELECT-SPLIT only fires
    // for todo/ready. So no failures.
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 0);
  });

  test("GREEN: primitive todo with no children → PASS (not compound)", () => {
    const taskMap = new Map([
      ["task", { id: "task", status: "todo", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 0);
  });
});

// ── Combined fixtures ────────────────────────────────────────────────────────────────────────────

describe("runChecks — combined compliant state", () => {
  test("GREEN: a fully compliant milestone boundary — no violations", () => {
    const taskMap = new Map([
      ["milestone-parent", { id: "milestone-parent", status: "done", role: "compound", children: ["feat-a", "feat-b"] }],
      ["feat-a", { id: "feat-a", status: "done", role: "primitive", children: [] }],
      ["feat-b", { id: "feat-b", status: "done", role: "compound", children: ["feat-b-1", "feat-b-2"] }],
      ["feat-b-1", { id: "feat-b-1", status: "done", role: "primitive", children: [] }],
      ["feat-b-2", { id: "feat-b-2", status: "done", role: "primitive", children: [] }],
      // A future compound task that has been properly split:
      ["future-epic", { id: "future-epic", status: "todo", role: "compound", children: ["future-sub"] }],
      ["future-sub", { id: "future-sub", status: "todo", role: "primitive", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 0);
  });

  test("RED: multiple violations at once — both types detected", () => {
    const taskMap = new Map([
      // Violation 1: done parent with non-done child
      ["done-parent", { id: "done-parent", status: "done", role: "compound", children: ["not-done-child"] }],
      ["not-done-child", { id: "not-done-child", status: "ready", role: "primitive", children: [] }],
      // Violation 2: compound ready with no children
      ["unsplit-compound", { id: "unsplit-compound", status: "ready", role: "compound", children: [] }],
    ]);
    const { failures } = runChecks(taskMap);
    assert.equal(failures.length, 2);
    const types = new Set(failures.map((f) => f.split(":")[0]));
    assert.ok(types.has("PARENT-DONE-IFF-CHILDREN"));
    assert.ok(types.has("SELECT-SPLIT"));
  });
});

// ── selftest ─────────────────────────────────────────────────────────────────────────────────────

describe("selftest", () => {
  test("selftest() passes all five fixture cases", () => {
    const result = selftest();
    assert.equal(result, true);
  });
});

// ── loadTasks from real files ────────────────────────────────────────────────────────────────────

describe("loadTasks", () => {
  test("reads task files from a temp directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "it0-split-test-"));
    try {
      const content = `---\nid: test-task\nstatus: todo\nrole: primitive\nchildren: []\n---\n`;
      fs.writeFileSync(path.join(tmpDir, "test-task.md"), content);
      const taskMap = loadTasks(tmpDir);
      assert.equal(taskMap.size, 1);
      assert.ok(taskMap.has("test-task"));
      assert.equal(taskMap.get("test-task").status, "todo");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns empty map for non-existent directory", () => {
    const taskMap = loadTasks("/nonexistent/path/tasks");
    assert.equal(taskMap.size, 0);
  });
});
