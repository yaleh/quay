// @test-group product
// DIR-039 (B): pins backlog-client.js — the read-only Backlog.md board
// reader/mapper. RED->GREEN per ADR-001: written before src/backlog-client.js
// existed. Uses a small synthetic fixture directory (isolated tmp dir) for
// the mechanism pins; the REAL archguard board round-trip (TASK-1 via
// quay migrate) is exercised separately by
// packages/quay/test/cli-migrate-backlog.test.mjs and the milestone's own
// captured live-run evidence (see the ABSORB record).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBacklogClient, mapStatus } from "../src/backlog-client.ts";

// Every fixture board dir is removed once at the end of this file (the carrier-array + after()
// pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeFixtureBoard(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-backlog-fixture-"));
  _tmpDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

test("mapStatus maps any 'Done'-containing status to done, everything else to todo", () => {
  assert.equal(mapStatus("Done"), "done");
  assert.equal(mapStatus("Basic: Done"), "done");
  assert.equal(mapStatus("Epic: Done"), "done");
  assert.equal(mapStatus("Basic: Backlog"), "todo");
  assert.equal(mapStatus("In Progress"), "todo");
  assert.equal(mapStatus(undefined), "todo");
  assert.equal(mapStatus(null), "todo");
});

test("list() reads every *.md file in the board dir and maps the view-model shape", () => {
  const dir = makeFixtureBoard({
    "task-1.md": [
      "---",
      "id: TASK-1",
      "title: First fixture task",
      "status: 'Basic: Done'",
      "labels:",
      "  - kind:basic",
      "dependencies: []",
      "ordinal: 1000",
      "---",
      "",
      "## Description",
      "Fixture body one.",
      "",
    ].join("\n"),
    "task-2.md": [
      "---",
      "id: TASK-2",
      "title: Second fixture task",
      "status: 'Basic: Backlog'",
      "labels: []",
      "dependencies:",
      "  - TASK-1",
      "ordinal: 2000",
      "---",
      "",
      "## Description",
      "Fixture body two.",
      "",
    ].join("\n"),
  });

  const client = createBacklogClient(dir);
  const tasks = client.list();

  assert.equal(tasks.length, 2, "reads both fixture files");
  const t1 = tasks.find((t) => t.id === "TASK-1");
  const t2 = tasks.find((t) => t.id === "TASK-2");
  assert.equal(t1.title, "First fixture task");
  assert.equal(t1.status, "done", "'Basic: Done' maps to done");
  assert.deepEqual(t1.labels, ["kind:basic"]);
  assert.ok(t1.body.includes("Fixture body one."));
  assert.equal(t2.status, "todo", "'Basic: Backlog' maps to todo");
  assert.deepEqual(t2.extra.dependencies, ["TASK-1"], "dependencies preserved verbatim in extra, not forced into parent/children");
  assert.equal(t2.parent, null, "Backlog.md has no parent/child concept — always null/[]");
  assert.deepEqual(t2.children, []);
});

test("get() returns one task by id, or null when not found", () => {
  const dir = makeFixtureBoard({
    "task-1.md": ["---", "id: TASK-1", "title: Only task", "status: Done", "---", "", "Body."].join("\n"),
  });
  const client = createBacklogClient(dir);
  const t = client.get("TASK-1");
  assert.equal(t.id, "TASK-1");
  assert.equal(t.title, "Only task");
  assert.equal(client.get("NOPE"), null);
});

test("list() with a status filter applies the MAPPED status, not the raw Backlog.md string", () => {
  const dir = makeFixtureBoard({
    "a.md": ["---", "id: TASK-A", "title: A", "status: Done", "---", "", "Body A"].join("\n"),
    "b.md": ["---", "id: TASK-B", "title: B", "status: 'Basic: Backlog'", "---", "", "Body B"].join("\n"),
  });
  const client = createBacklogClient(dir);
  const done = client.list({ status: "done" });
  assert.equal(done.length, 1);
  assert.equal(done[0].id, "TASK-A");
});

test("check() reports ok:false 'not supported' — this Provider is read-only, no gate", () => {
  const dir = makeFixtureBoard({
    "a.md": ["---", "id: TASK-A", "title: A", "status: Done", "---", "", "Body A"].join("\n"),
  });
  const client = createBacklogClient(dir);
  const result = client.check("TASK-A");
  assert.equal(result.ok, false);
  assert.match(result.reason, /read-only/);
});

test("a malformed task file (no frontmatter) throws a clear error, not a silent skip", () => {
  const dir = makeFixtureBoard({ "bad.md": "no frontmatter here at all" });
  const client = createBacklogClient(dir);
  assert.throws(() => client.list(), /missing YAML frontmatter/);
});

test("list() against a non-existent board dir returns an empty array, not a throw", () => {
  const client = createBacklogClient("/tmp/quay-backlog-does-not-exist-xyz");
  assert.deepEqual(client.list(), []);
});
