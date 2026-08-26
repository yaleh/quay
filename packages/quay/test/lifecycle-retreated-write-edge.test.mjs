// @test-group product
// lifecycle-retreated-write-edge.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): RETREATED-WRITE edge-scoped — ready→todo /
// needs-human→todo write NO marker (no body patch). The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat, RETREATED_MARKER_RE } from "../src/gate/lifecycle.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("RETREATED-WRITE: edge-scoped — ready→todo / needs-human→todo write NO marker (no body patch)", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-edges");
  const body = "## Proposal\nreal proposal text\n";
  const client1 = stubClient({ id: "T-RW3", status: "ready", extra: {}, body });
  const r1 = await runRetreat({ client: client1, id: "T-RW3", reason: "re-triage", logPath });
  assert.equal(r1.to, "todo");
  assert.ok(!RETREATED_MARKER_RE.test(client1._state.body), "ready→todo writes NO marker (not a shelve — rolls back to todo)");

  const client2 = stubClient({ id: "T-RW4", status: "needs-human", extra: {}, body });
  const r2 = await runRetreat({ client: client2, id: "T-RW4", reason: "dependency installed", logPath });
  assert.equal(r2.to, "todo");
  assert.ok(!RETREATED_MARKER_RE.test(client2._state.body), "needs-human→todo writes NO marker");
  resetExit();
});
