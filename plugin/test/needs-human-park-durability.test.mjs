// @test-group engine
// plugin/test/needs-human-park-durability.test.mjs —
// gap-needs-human-park-overwritten-by-inflight-worker, AC3 (same-round promotion) half.
//
// THE DEFECT (measured 2026-11-06 on this host): a task parked `ready → needs-human` while a worker
// was in flight had its park reverted THREE times in ~15 minutes by the worker's own `task_write`
// (the commit diff was exactly one frontmatter line, `-status: needs-human` / `+status: todo`).
// The promotion driver then read `todo` and promoted it straight back to `ready` — the park was only
// as durable as the last in-flight worker's read, and each revert burned a full suite.
//
// AC3 asks for the SAME-ROUND half of the proof: after the park, a promotion round must leave the
// task at `needs-human` — not "promote then retreat" as a round trip. AC1's write-face proof lives in
// packages/quay-native/test/cas-write.test.mjs; this file proves the ROUND sees the preserved park.
//
// FALSIFIABILITY: the parked task is proven to be VISIBLE to the very same round (its id shows up in
// `candidates` the moment its status is `todo` — the pre-fix outcome), so "absent from candidates"
// is a real measurement of the park, not an artefact of a fixture the scan never looked at.
//
// Run: node --test plugin/test/needs-human-park-durability.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeTasks,
  fourArtifactBody,
  makeWorkspace,
  path,
  fs,
  writeTask,
} from "./helpers/ready-pool-check-harness.mjs";
import { createStore } from "../../packages/quay-native/src/store.ts";

const ID = "gap-park-durability";

test("a stale whole-task write cannot put a parked task back into the promotion round (AC3)", (t) => {
  const root = makeWorkspace("park-durability");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  writeTask(root, ID, { status: "ready", labels: ["gap"], body: fourArtifactBody() });
  const store = createStore(tasksDir);

  // 1. Park it — the human/manager write (`--status needs-human --expect-status ready`).
  assert.equal(store.write(ID, { status: "needs-human", expectedStatus: "ready" }).status, "needs-human");

  // 2. The in-flight worker replays the WHOLE task it read before the park (body + stale status).
  //    This is the measured incident shape; the status is the one it saw, the body is its AC tick.
  const stale = store.write(ID, {
    title: `fixture ${ID}`,
    status: "ready",
    labels: ["gap"],
    body: fourArtifactBody(),
  });
  assert.equal(stale.status, "needs-human", "the stale whole-task write did not revert the park");
  assert.equal(store.get(ID).status, "needs-human", "on-disk status is needs-human when the round starts");

  // 3. ONE promotion round (the exact `ready-pool-check` analysis the promotion driver runs).
  const round = analyzeTasks({ tasksDir, root });
  assert.equal(
    round.candidates.find((c) => c.id === ID),
    undefined,
    "AC3: the parked task is not a promotion candidate in the same round",
  );
  assert.equal(
    round.promotions.find((p) => p.id === ID),
    undefined,
    "AC3: the round issues no todo→ready promotion for it (no promote-then-retreat round trip)",
  );
  assert.equal(store.get(ID).status, "needs-human", "AC3: the task is still needs-human after the round");

  // 4. FALSIFIABILITY CONTROL — the same round DOES see the task once its status is `todo` (which is
  //    exactly what the pre-fix stale write produced). Without the fix, step 3's assertion above is
  //    the one that flips; with this control, "absent" cannot be an artefact of an unread fixture.
  store.write(ID, { status: "todo" });
  const afterRevert = analyzeTasks({ tasksDir, root });
  assert.ok(
    afterRevert.candidates.find((c) => c.id === ID),
    "control: with status todo the very same round lists the task as a promotion candidate",
  );
});
