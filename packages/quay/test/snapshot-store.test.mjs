// snapshot-store.test.mjs — the encapsulation contract for
// gap-dashboard-snapshot-store-encapsulate-state.
//
// These tests exist to make the CLASS's lifecycle falsifiable, not to re-test the pages. The three
// things that could silently regress when the dashboard/board state cluster moves from nine
// module-level Maps into one object are:
//   1. the TTL boundary (a hit inside the window, a miss outside it),
//   2. rebuild de-duplication — the in-flight marker is set while a build runs and DELETED when it
//      settles, which is what makes `isRebuilding` a real reading rather than a sticky flag
//      (AC7: assert the `.delete()` still lands at the right moment),
//   3. follow-up coalescing — many `after` callers join ONE queued build that starts only once the
//      incumbent settles, and the queue entry retires as that follow-up STARTS (not as it settles).
// Plus the two reset scopes (`clear()` vs `clearSnapshot()`) and the explicit per-module singletons.

import test from "node:test";
import assert from "node:assert/strict";

import { DashboardSnapshotStore } from "../src/serve/snapshot-store.ts";
import { dashboardSnapshotStore } from "../src/serve/serve-dashboard.ts";
import { boardSnapshotStore } from "../src/serve/serve-board.ts";

/** Poll `fn` until it returns truthy (or the deadline passes). Builds settle on microtasks, so a
 *  bare `await` would race the chained follow-up. */
async function until(fn, ms = 2_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return fn();
}

// ── the singletons (判据 c: explicit singleton, one per page module, never shared) ────────────────

test("each page module exports its OWN explicit store instance", () => {
  assert.ok(dashboardSnapshotStore instanceof DashboardSnapshotStore, "dashboardSnapshotStore is a DashboardSnapshotStore");
  assert.ok(boardSnapshotStore instanceof DashboardSnapshotStore, "boardSnapshotStore is a DashboardSnapshotStore");
  assert.notEqual(dashboardSnapshotStore, boardSnapshotStore, "the two pages must not share one instance (one page's clear() must not blank the other's cards)");
});

test("an injectable constructible instance is isolated from the module singletons", () => {
  const local = new DashboardSnapshotStore();
  assert.ok(local instanceof DashboardSnapshotStore);
  local.publish("iso-root", { builtAt: 1 });
  assert.deepEqual(local.snapshot("iso-root"), { builtAt: 1 });
  assert.equal(dashboardSnapshotStore.snapshot("iso-root"), null, "a constructed instance is a different store");
  assert.equal(boardSnapshotStore.snapshot("iso-root"), null);
});

// ── TTL caches: the hit/miss boundary ────────────────────────────────────────────────────────────

test("TTL read-through: fresh inside the window, a miss at/after it", () => {
  const s = new DashboardSnapshotStore();
  assert.equal(s.taskSummary("r", 60_000), null, "an unwritten cache is a miss, never a fabricated empty value");
  s.cacheTaskSummary("r", [{ id: "a" }]);
  assert.deepEqual(s.taskSummary("r", 60_000), [{ id: "a" }], "inside the TTL the cached reading is returned");
  assert.equal(s.taskSummary("r", 0), null, "a zero-length TTL is already expired (the boundary is `>=` ttlMs)");

  s.cacheLive("r", { status: "ok" });
  assert.deepEqual(s.live("r", 60_000), { status: "ok" });
  s.cacheSystem("r", { status: "ok" });
  assert.deepEqual(s.system("r", 60_000), { status: "ok" });
  s.cacheManagerLight("r", { status: "ok" });
  assert.deepEqual(s.managerLight("r", 60_000), { status: "ok" });
});

test("the fine-grained clears drop exactly their own cache", () => {
  const s = new DashboardSnapshotStore();
  s.cacheTaskSummary("r", [{ id: "a" }]);
  s.cacheLive("r", { status: "ok" });
  s.cacheSystem("r", { status: "ok" });
  s.cacheManagerLight("r", { status: "ok" });

  s.clearTaskSummary();
  assert.equal(s.taskSummary("r", 60_000), null, "clearTaskSummary drops the task-summary cache");
  assert.deepEqual(s.live("r", 60_000), { status: "ok" }, "…and nothing else");

  s.clearLive();
  assert.equal(s.live("r", 60_000), null);
  assert.deepEqual(s.system("r", 60_000), { status: "ok" });

  s.clearProbes();
  assert.equal(s.system("r", 60_000), null, "clearProbes drops the system reading");
  assert.equal(s.managerLight("r", 60_000), null, "clearProbes drops the manager-light reading");
});

// ── rebuild de-duplication + the marker's own .delete() (AC7) ────────────────────────────────────

test("rebuild: one in-flight marker per root, retired the moment the build settles", async () => {
  const s = new DashboardSnapshotStore();
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const build = async () => { started += 1; await gate; return { n: started }; };

  const p1 = s.followUp("r", "skip", build);
  assert.equal(s.isRebuilding("r"), true, "the marker is set while the build runs");
  assert.equal(started, 1);

  const p2 = s.followUp("r", "skip", build);
  assert.equal(p2, p1, "the tick's `skip` policy hands back the incumbent — it never starts a second build");
  assert.equal(started, 1, "…so exactly one build has started");

  release();
  await p1;
  assert.equal(s.isRebuilding("r"), false, "the marker is DELETED when the build settles (not left sticky)");
  assert.deepEqual(s.snapshot("r"), { n: 1 }, "the settled build's snapshot is installed");

  // A second, already-settled build must start fresh — the delete is per-build, not a one-shot latch.
  const p3 = s.rebuild("r", async () => ({ n: 99 }));
  assert.equal(s.isRebuilding("r"), true, "a new build re-sets the marker");
  await p3;
  assert.equal(s.isRebuilding("r"), false);
  assert.deepEqual(s.snapshot("r"), { n: 99 });
});

test("followUp('after') coalesces every concurrent caller onto ONE queued build", async () => {
  const s = new DashboardSnapshotStore();
  const gates = [];
  let started = 0;
  const build = () => {
    started += 1;
    const n = started;
    return new Promise((r) => gates.push(() => r({ n })));
  };

  const incumbent = s.followUp("r", "skip", build);
  assert.equal(started, 1);
  const a1 = s.followUp("r", "after", build);
  const a2 = s.followUp("r", "after", build);
  assert.equal(a1, a2, "two `after` callers join the SAME follow-up promise");
  assert.equal(started, 1, "…and neither starts a second build while the incumbent runs");
  assert.equal(s.isFollowUpQueued("r"), true, "the queue is observable while it waits");

  gates[0](); // settle the incumbent
  assert.ok(await until(() => started === 2), "the follow-up build starts once the incumbent settles");
  assert.equal(s.isFollowUpQueued("r"), false, "the queue entry retires as the follow-up STARTS (so a later `after` caller cannot be handed a build that began before its call)");

  gates[1](); // settle the follow-up
  await a1;
  assert.equal(s.isRebuilding("r"), false);
  assert.deepEqual(s.snapshot("r"), { n: 2 }, "the follow-up's snapshot is the one installed");
  void incumbent;
});

test("a failed build keeps the previous snapshot (a stale page is honest, a blanked one is a fabricated absence)", async () => {
  const s = new DashboardSnapshotStore();
  s.publish("r", { n: "previous" });
  await s.rebuild("r", async () => { throw new Error("boom"); });
  assert.deepEqual(s.snapshot("r"), { n: "previous" });
  assert.equal(s.isRebuilding("r"), false, "a failed build still retires its marker");
});

// ── the step hook ────────────────────────────────────────────────────────────────────────────────

test("setStepHook installs a hook that step() awaits; null restores the no-op", async () => {
  const s = new DashboardSnapshotStore();
  let calls = 0;
  s.setStepHook(async () => { calls += 1; });
  await s.step();
  await s.step();
  assert.equal(calls, 2);
  s.setStepHook(null);
  await s.step();
  assert.equal(calls, 2, "after null the step is a no-op");
});

// ── the two reset scopes ─────────────────────────────────────────────────────────────────────────

test("clearSnapshot() drops the snapshot lifecycle but keeps the TTL caches", async () => {
  const s = new DashboardSnapshotStore();
  s.cacheTaskSummary("r", [{ id: "a" }]);
  s.setStepHook(async () => {});
  let release;
  const gate = new Promise((r) => { release = r; });
  const build = () => gate.then(() => ({ n: 1 }));
  const p = s.rebuild("r", build);
  assert.equal(s.isRebuilding("r"), true);
  s.publish("other", { n: "x" });

  s.clearSnapshot();
  assert.equal(s.snapshot("other"), null, "every snapshot is dropped");
  assert.equal(s.isRebuilding("r"), false, "every in-flight marker is dropped");
  assert.deepEqual(s.taskSummary("r", 60_000), [{ id: "a" }], "the TTL caches survive clearSnapshot()");

  release();
  await p;
});

test("clear() drops the TTL caches AND the snapshot lifecycle", () => {
  const s = new DashboardSnapshotStore();
  s.cacheTaskSummary("r", [{ id: "a" }]);
  s.cacheLive("r", { status: "ok" });
  s.cacheSystem("r", { status: "ok" });
  s.cacheManagerLight("r", { status: "ok" });
  s.publish("r", { n: 1 });

  s.clear();
  assert.equal(s.taskSummary("r", 60_000), null);
  assert.equal(s.live("r", 60_000), null);
  assert.equal(s.system("r", 60_000), null);
  assert.equal(s.managerLight("r", 60_000), null);
  assert.equal(s.snapshot("r"), null);
});
