// @test-group product
// lifecycle-a3-retreat-todo.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A3 — runRetreat on a todo task throws illegal
// transition (todo cannot back). The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { runRetreat } from "../src/gate/lifecycle.ts";
import { stubClient, tmpLog } from "./lifecycle-helpers.mjs";

test("A3: runRetreat on a todo task throws illegal transition (todo cannot back)", async () => {
  const logPath = tmpLog("retreat-todo");
  const client = stubClient({ id: "T-9", status: "todo", extra: {} });
  await assert.rejects(
    () => runRetreat({ client, id: "T-9", reason: "x", logPath }),
    /illegal transition: todo cannot back/
  );
});
