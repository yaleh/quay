// @test-group engine
// writestate-atomicity-split.test.mjs — the negative-control test for the atomic state write
// (tasks/gap-writestate-atomicity-split).
//
// AC2: for one of the three pre-migration non-atomic writers, construct a CONCURRENT read that
// pre-migration could observe a torn (half-written) state file and post-migration cannot — the
// tmp+rename atomicity guarantee. The two writers exercised here are the exact two shapes the task
// split: an in-place same-fd write of a large JSON value (the pre-migration non-atomic shape)
// vs `writeJsonAtomic` (tmp + renameSync, the post-migration shape).
//
// Two tests:
//   1. atomic — a concurrent reader never observes a torn file while writeJsonAtomic repeatedly
//      overwrites a large state file. rename(2) atomicity makes this a HARD guarantee (not a
//      timing bet); it goes RED if writeJsonAtomic regresses to an in-place write.
//   2. negative control — the SAME reader DOES observe a torn file against an in-place
//      same-fd write, proving the reader can bite (the pre-migration premise). Without this,
//      test 1's zero-torn assertion would be vacuous (it could pass only because the reader cannot
//      detect tearing at all).

// SPLIT from writestate-atomicity-split.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/2 (1 test). Shared fixtures: ./helpers/writestate-atomicity-split-harness.mjs (single source).

import { test } from "node:test";
import { assert, runConcurrentRead, writeJsonAtomic } from "./helpers/writestate-atomicity-split-harness.mjs";

test("writeJsonAtomic: a concurrent reader never observes a torn state file", async () => {
  const { reads, torn, seen, code } = await runConcurrentRead("atomic");
  assert.equal(code, 0, "writer child must exit cleanly");
  assert.ok(reads > 0, "reader must have made reads during the write window");
  assert.equal(torn, 0, "an atomic write must never expose a torn file");
  // Liveness (NOT atomicity): at least one non-initial marker proves writes actually landed.
  // Requiring BOTH alternating markers (`seen.has("B") && seen.has("C")`) is a sampling bet —
  // each marker only exists for one write-window, and under 16-lane full load the reader's
  // sampling interval can stretch past a marker's window and miss it (round 719 flaky:
  // "reader must observe both written markers; saw A,C"). torn == 0 above is the atomicity
  // contract and is unchanged.
  assert.ok(
    seen.has("B") || seen.has("C"),
    `reader must observe at least one non-initial marker (writes actually landed); saw ${[...seen].join(",")}`
  );
});
