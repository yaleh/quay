// @test-group product
// DIR-039 (A): pins migrateTasks()/writeOneTask() — the generic ABI
// provider-to-provider migration engine. RED->GREEN per ADR-001: written
// before src/migrate.js existed; these fake source/target clients exercise
// the SAME shape connectProvider() returns (taskList/taskWrite), so this
// test is a faithful unit-level pin of the ABI contract without needing a
// live MCP transport or a real provider subprocess (those are covered by
// the end-to-end CLI test, cli-migrate.test.mjs, against a real spawned
// quay-native target).

import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateTasks, writeOneTask } from "../src/migrate.ts";

function makeFakeSource(tasks) {
  return {
    async taskList() {
      return { tasks, malformed: [] };
    },
  };
}

function makeFakeTarget() {
  const store = new Map();
  return {
    store,
    async taskWrite(patch) {
      if (patch.id === undefined) throw new Error("taskWrite: missing id");
      const existing = store.get(patch.id) ?? {};
      const written = { ...existing, ...patch };
      store.set(patch.id, written);
      return written;
    },
  };
}

test("migrateTasks copies every source task to the target via taskWrite", async () => {
  const tasks = [
    { id: "gh-1", title: "First", status: "todo", labels: ["a"], parent: null, children: [], body: "## Proposal\nbody one" },
    { id: "gh-2", title: "Second", status: "done", labels: [], parent: null, children: [], body: "## Proposal\nbody two" },
  ];
  const source = makeFakeSource(tasks);
  const target = makeFakeTarget();

  const result = await migrateTasks({ source, target });

  assert.equal(result.total, 2, "reports the correct source task count");
  assert.equal(result.migrated.length, 2, "migrated exactly 2 tasks");
  assert.equal(result.errors.length, 0, "no errors on a clean migration");
  assert.equal(target.store.size, 2, "target store now has 2 tasks");
  assert.equal(target.store.get("gh-1").title, "First");
  assert.equal(target.store.get("gh-1").status, "todo");
  assert.equal(target.store.get("gh-1").body, "## Proposal\nbody one");
  assert.equal(target.store.get("gh-2").status, "done");
});

test("migrateTasks preserves id/title/status/body fidelity for a spot-checked task", async () => {
  const tasks = [
    {
      id: "gh-42",
      title: "A task with a distinctive title",
      status: "ready",
      labels: ["important"],
      parent: null,
      children: [],
      body: "## Proposal\nSome distinctive body content.\n## Plan\nSteps.\n",
    },
  ];
  const source = makeFakeSource(tasks);
  const target = makeFakeTarget();

  await migrateTasks({ source, target });
  const written = target.store.get("gh-42");

  assert.equal(written.id, "gh-42");
  assert.equal(written.title, "A task with a distinctive title");
  assert.equal(written.status, "ready");
  assert.equal(written.body, "## Proposal\nSome distinctive body content.\n## Plan\nSteps.\n");
});

test("migrateTasks records a per-task error and continues past a failing write", async () => {
  const tasks = [
    { id: "gh-1", title: "OK", status: "todo", labels: [], parent: null, children: [], body: "" },
    { id: undefined, title: "Bad (no id)", status: "todo", labels: [], parent: null, children: [], body: "" },
    { id: "gh-3", title: "OK too", status: "todo", labels: [], parent: null, children: [], body: "" },
  ];
  const source = makeFakeSource(tasks);
  const target = makeFakeTarget();

  const result = await migrateTasks({ source, target });

  assert.equal(result.total, 3);
  assert.equal(result.migrated.length, 2, "the two good tasks still migrate");
  assert.equal(result.errors.length, 1, "the bad task is recorded as an error, not a thrown exception");
  assert.equal(result.errors[0].id, undefined);
});

test("migrateTasks reports onTask progress for each successfully migrated task", async () => {
  const tasks = [
    { id: "gh-1", title: "One", status: "todo", labels: [], parent: null, children: [], body: "" },
    { id: "gh-2", title: "Two", status: "todo", labels: [], parent: null, children: [], body: "" },
  ];
  const source = makeFakeSource(tasks);
  const target = makeFakeTarget();
  const seen = [];

  await migrateTasks({ source, target, onTask: (t) => seen.push(t.id) });

  assert.deepEqual(seen, ["gh-1", "gh-2"]);
});

test("writeOneTask forwards extra when present, and defaults labels/body when absent", async () => {
  const target = makeFakeTarget();
  await writeOneTask(target, { id: "x-1", title: "T", status: "todo", extra: { foo: "bar" } });
  const written = target.store.get("x-1");
  assert.equal(written.title, "T");
  assert.deepEqual(written.labels, []);
  assert.equal(written.body, "");
  assert.deepEqual(written.extra, { foo: "bar" });
});
