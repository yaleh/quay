// @test-group product
// lifecycle-retreated-write-marker.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): RETREATED-WRITE [AC1] — runRetreat done→ready writes
// the **RETREATED marker to a string body. The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat, RETREATED_MARKER_RE } from "../src/gate/lifecycle.ts";
import { isRetreated } from "../../../plugin/scripts/ready-pool-check.ts";
import { stubClient, tmpLog, resetExit } from "./lifecycle-helpers.mjs";

test("RETREATED-WRITE [AC1]: runRetreat done→ready writes the **RETREATED marker to a string body", async () => {
  resetExit();
  const logPath = tmpLog("retreat-write-marker");
  const body = "## Proposal\nreal proposal text\n## AC\n- [x] done\n## DoD\n- [x] done\n";
  const client = stubClient({ id: "T-RW1", status: "done", extra: {}, body });
  const r = await runRetreat({ client, id: "T-RW1", reason: "load-induced red — wait for fix-scope gate", logPath });
  assert.equal(r.ok, true);
  assert.equal(r.to, "ready");
  assert.equal(client._state.status, "ready");
  assert.ok(RETREATED_MARKER_RE.test(client._state.body), `body must carry the **RETREATED marker; got: ${client._state.body}`);
  assert.match(client._state.body, /^> \*\*RETREATED \/ 搁置（load-induced red — wait for fix-scope gate）\*\*$/m, "marker is the line-start blockquote bold form carrying the reason");
  // The DETECTION side (ready-pool-check isRetreated — the same predicate slot-refill reuses)
  // must read what the write side produced.
  assert.equal(isRetreated({ body: client._state.body }), true, "ready-pool-check isRetreated reads the written marker");
  resetExit();
});
