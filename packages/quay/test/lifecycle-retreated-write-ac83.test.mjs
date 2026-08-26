// @test-group product
// lifecycle-retreated-write-ac83.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): RETREATED-WRITE [AC1+AC83] — runRetreat done→ready
// unchecks AC boxes AND writes the marker (they compose). The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat, RETREATED_MARKER_RE } from "../src/gate/lifecycle.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("RETREATED-WRITE [AC1+AC83]: runRetreat done→ready unchecks AC boxes AND writes the marker (they compose)", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-ac83");
  const body = "## Proposal\nreal proposal text\n## AC\n- [x] a-c-1\n- [X] a-c-2\n## DoD\n- [x] dod-1\n";
  const client = stubClient({ id: "T-RW2", status: "done", extra: {}, body });
  const r = await runRetreat({ client, id: "T-RW2", reason: "rework", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.match(client._state.body, /## AC\n- \[ \] a-c-1\n- \[ \] a-c-2/, "AC boxes unchecked (AC83)");
  assert.ok(RETREATED_MARKER_RE.test(client._state.body), "marker present alongside the uncheck");
  resetExit();
});
