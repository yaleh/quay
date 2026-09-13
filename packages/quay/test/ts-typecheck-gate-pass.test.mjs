// @test-group product
// ts-typecheck-gate-pass.test.mjs — split out of ts-typecheck-gate.test.mjs
// (gap-suite-split-long-multi-test-files): M63 A2 — the ts-typecheck gate PASSes for real against
// THIS repo's own root tsconfig.json (real `npx tsc --noEmit`, real process I/O). Split out so
// node:test's file-level concurrency can parallelize it.
// (gap-suite-wallclock-budgets-literals-depend-on-host-capacity: the body is no longer
// byte-identical to the original split — its `{ timeout: 120000 }` literal became a host-derived
// deadline.)

import { test } from "node:test";
import assert from "node:assert/strict";

import { gate, TS_TYPECHECK_DEADLINE_MS, pinHostAcceptanceDeadline } from "./ts-typecheck-gate-helpers.mjs";

test("M63 A2: ts-typecheck gate PASSes for real against THIS repo's own root tsconfig.json (real `npx tsc --noEmit`, real process I/O)", async () => {
  // Deadline = the workspace's own declared gate deadline × this host's live oversubscription reading
  // (⛔ no bare ms literal: a fixed one only holds on an idle authoring host — see the helper).
  pinHostAcceptanceDeadline();
  const r = await gate("ts-typecheck")({ id: "T", extra: {} });
  assert.equal(r.ok, true, `expected pass (tsc --noEmit green); got reason=${r.reason}`);
}, { timeout: TS_TYPECHECK_DEADLINE_MS });
