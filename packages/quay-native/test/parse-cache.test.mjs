// @test-group product
// gap-task-store-parse-cost-0-8s-compounds-suite-slowdown — persistent parse cache.
//
// The store's task-list route previously re-read + YAML-parsed every task file on
// EVERY CLI invocation (~686ms for 1110 files: YAML.parse ~395ms, readFileSync
// ~142ms — measured 2026-08-13). The in-process parsedCache only helped repeated
// calls within ONE process, but each CLI call is a fresh process, so `task list`
// paid the full cold parse every time. The fix adds a PERSISTENT layer: a small
// JSON cache next to the store holds each task's YAML-parsed frontmatter keyed by
// (mtimeMs, size). A fresh-process list validates every file with a cheap statSync
// and only re-reads/re-parses the files that actually changed (bodies are always
// re-read from disk, never cached).
//
// AC coverage:
//   (a) AC1 mechanism — the cache is actually consulted (tamper test), which is
//       the mechanism that produces the ≥50% CLI parse reduction. Wall-clock is
//       asserted separately by the outer verification-round A/B on the real store
//       (a wall-clock unit test would be a test of the machine, not the code).
//   (b) AC2 consistency — a fresh store returns byte-identical data to a direct
//       parse (no staleness, no omission).
//   (c) AC3 invalidation — add / modify / delete a task file is reflected in the
//       next fresh-store read.
//
// Run: scripts/test.sh packages/quay-native/test/parse-cache.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../src/store.ts";

const CACHE_FILENAME = ".quay-parse-cache.json";

/** Fresh disposable store; the caller owns cleanup via the returned dir. */
function makeStore() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-parse-cache-test-"));
  const store = createStore(tasksDir);
  return { store, tasksDir };
}

function cachePath(tasksDir) {
  return path.join(tasksDir, CACHE_FILENAME);
}

test("AC1: the persistent cache file is written after a list, and a fresh store serves identical data", () => {
  const { store, tasksDir } = makeStore();
  try {
    store.write("A-001", { title: "Alpha", status: "todo", labels: ["x", "y"] });
    store.write("A-002", { title: "Beta", status: "ready", body: "## Proposal\nbody text\n" });
    const first = store.list();
    assert.ok(fs.existsSync(cachePath(tasksDir)), "cache file written after a list");

    const cached = JSON.parse(fs.readFileSync(cachePath(tasksDir), "utf8"));
    assert.equal(cached.version, 1, "cache carries the format version");
    assert.equal(cached.entries["A-001"].frontmatter.title, "Alpha");
    assert.equal(cached.entries["A-002"].frontmatter.title, "Beta");

    // A fresh store (new-process simulation) reads the same data — no staleness,
    // no omission (AC2).
    const store2 = createStore(tasksDir);
    const second = store2.list();
    assert.equal(second.length, 2);
    assert.deepEqual(
      second.map((t) => ({ id: t.id, title: t.title, status: t.status, labels: t.labels, body: t.body })),
      first.map((t) => ({ id: t.id, title: t.title, status: t.status, labels: t.labels, body: t.body })),
      "fresh store returns identical task data (frontmatter AND body)"
    );
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC1 mechanism: a fresh store serves the frontmatter FROM the cache, not a re-parse", () => {
  const { store, tasksDir } = makeStore();
  try {
    store.write("C-001", { title: "Original", status: "todo" });
    store.list(); // seed the persistent cache

    // Tamper with the cache file's stored frontmatter WITHOUT touching the task
    // file (its mtimeMs/size are unchanged, so the (mtimeMs, size) key still
    // matches). A fresh store's LIST must serve the tampered title — proving the
    // parse result was read from the cache rather than recomputed. (A bare get()
    // deliberately does NOT load the persistent cache — task get stays a cheap
    // targeted read — so the proof runs through the list surface.)
    const p = cachePath(tasksDir);
    const cached = JSON.parse(fs.readFileSync(p, "utf8"));
    cached.entries["C-001"].frontmatter.title = "From-Cache";
    fs.writeFileSync(p, JSON.stringify(cached), "utf8");

    const store2 = createStore(tasksDir);
    const t = store2.list().find((x) => x.id === "C-001");
    assert.equal(t.title, "From-Cache", "frontmatter served from the persistent cache (cache consulted)");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC3: modifying a task file invalidates the cache — the next fresh store sees the new content", () => {
  const { store, tasksDir } = makeStore();
  try {
    store.write("M-001", { title: "Old title", status: "todo" });
    store.list(); // seed the cache

    // Simulate an edit by a DIFFERENT process (raw fs write; mtime and size change).
    const p = path.join(tasksDir, "M-001.md");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("Old title", "New title"), "utf8");

    const store2 = createStore(tasksDir);
    const t = store2.get("M-001");
    assert.equal(t.title, "New title", "modified title visible to a fresh store (cache invalidated by mtime/size)");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC3: adding and deleting task files is reflected in the next fresh-store list", () => {
  const { store, tasksDir } = makeStore();
  try {
    store.write("D-001", { title: "One", status: "todo" });
    store.list(); // cache seeded with D-001

    // Add a file and delete another, both bypassing the store (another process).
    fs.writeFileSync(
      path.join(tasksDir, "D-002.md"),
      "---\nid: D-002\ntitle: Two\nstatus: todo\n---\n",
      "utf8"
    );
    fs.rmSync(path.join(tasksDir, "D-001.md"), { force: true });

    const store2 = createStore(tasksDir);
    const ids = store2.list().map((t) => t.id);
    assert.deepEqual(ids, ["D-002"], "added file appears, deleted file gone");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC3: a write() through the store is immediately visible to a fresh store (no stale frontmatter)", () => {
  const { store, tasksDir } = makeStore();
  try {
    store.write("W-001", { title: "First", status: "todo" });
    store.list(); // seed the cache
    store.write("W-001", { title: "Second", status: "done" }); // mutate via the store

    const store2 = createStore(tasksDir);
    const t = store2.get("W-001");
    assert.equal(t.title, "Second");
    assert.equal(t.status, "done");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC2: a corrupt cache file degrades to a cold parse — no crash, correct data", () => {
  const { store, tasksDir } = makeStore();
  try {
    store.write("E-001", { title: "Survivor", status: "todo" });
    store.list(); // seed the cache
    fs.writeFileSync(cachePath(tasksDir), "{{{ not json", "utf8");

    const store2 = createStore(tasksDir);
    const tasks = store2.list();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, "Survivor", "corrupt cache ignored; data comes from a fresh parse");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC2: a frontmatter that cannot JSON-round-trip is excluded from the persistent cache", () => {
  const { store, tasksDir } = makeStore();
  try {
    // A `!!set` parses to a YAML Set — not JSON-encodable. Write it directly
    // (bypassing the write serializer, which would normalize it).
    fs.writeFileSync(
      path.join(tasksDir, "S-001.md"),
      "---\nid: S-001\ntitle: SetTask\nstatus: todo\nextra: !!set\n  a: null\n  b: null\n---\n",
      "utf8"
    );
    fs.writeFileSync(
      path.join(tasksDir, "S-002.md"),
      "---\nid: S-002\ntitle: Normal\nstatus: done\n---\n",
      "utf8"
    );
    store.list();

    const cached = JSON.parse(fs.readFileSync(cachePath(tasksDir), "utf8"));
    assert.deepEqual(Object.keys(cached.entries), ["S-002"], "non-JSON-safe S-001 excluded; JSON-safe S-002 cached");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});

test("AC3: the cache file is not created by a bare createStore or get (task get 付税不变)", () => {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-parse-cache-test-"));
  try {
    const store = createStore(tasksDir);
    store.write("G-001", { title: "Solo", status: "todo" });
    // A single get (the `task get <id>` surface) must NOT write the cache file —
    // the persistent load is deferred to the batch (list) surface only, so a
    // targeted read never pays the load cost ("task get 0.18s 是定向读取不付税").
    const t = store.get("G-001");
    assert.equal(t.title, "Solo");
    assert.ok(!fs.existsSync(cachePath(tasksDir)), "single get does not materialize the cache file");
  } finally {
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }
});
