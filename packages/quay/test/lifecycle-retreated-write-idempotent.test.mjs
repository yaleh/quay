// @test-group product
// lifecycle-retreated-write-idempotent.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): RETREATED-WRITE idempotent — a done task whose body
// already carries the marker is not stacked on re-retreat. The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("RETREATED-WRITE: idempotent — a done task whose body already carries the marker is not stacked on re-retreat", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-idem");
  const body = "> **RETREATED / 搁置（first）**\n\n## Proposal\nreal proposal text\n";
  const client = stubClient({ id: "T-RW5", status: "done", extra: {}, body });
  const r = await runRetreat({ client, id: "T-RW5", reason: "second retreat", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  const matches = client._state.body.match(/\*\*RETREATED/g) ?? [];
  assert.equal(matches.length, 1, "exactly one marker line — no duplicate");
  resetExit();
});
