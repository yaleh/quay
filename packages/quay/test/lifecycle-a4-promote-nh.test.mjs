// @test-group product
// lifecycle-a4-promote-nh.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A4 [AC4] — runPromote on a needs-human task → illegal
// transition (needs-human cannot forward). The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runPromote } from "../src/gate/lifecycle.ts";
import { stubClient, tmpLog } from "./lifecycle-helpers.mjs";

test("A4 [AC4]: runPromote on a needs-human task → illegal transition (needs-human cannot forward)", async () => {
  const logPath = tmpLog("promote-nh");
  const client = stubClient({ id: "T-NH3", status: "needs-human", extra: {} });
  await assert.rejects(
    () => runPromote({ client, id: "T-NH3", logPath }),
    /illegal transition: needs-human cannot forward/
  );
});
