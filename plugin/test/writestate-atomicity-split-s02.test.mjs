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

// SPLIT from writestate-atomicity-split.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/2 (1 test). Shared fixtures: ./helpers/writestate-atomicity-split-harness.mjs (single source).

import { test } from "node:test";
import { assert, runConcurrentRead } from "./helpers/writestate-atomicity-split-harness.mjs";

test("negative control: an in-place writeFileSync IS observably torn to a concurrent reader", async () => {
  const { reads, torn, code } = await runConcurrentRead("nonatomic");
  assert.equal(code, 0, "writer child must exit cleanly");
  assert.ok(reads > 0, "reader must have made reads during the write window");
  assert.ok(torn > 0, "an in-place write must be observably torn (proves the reader can bite)");
});
