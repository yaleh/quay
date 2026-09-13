// @test-group lowconc
// ts-typecheck-gate-config-wiring.test.mjs — split out of ts-typecheck-gate.test.mjs
// (gap-suite-split-long-multi-test-files): M63 D1 — the ts-typecheck gate PASSes against THIS
// repo's own real .quay/config.yml gates: wiring (the exact source the real OUTER-LOOP ABSORB gates
// against, not a fixture copy). Split out so node:test's file-level concurrency can parallelize it.
// (gap-suite-wallclock-budgets-literals-depend-on-host-capacity: the body is no longer byte-identical
// to the original split — its `{ timeout: 120000 }` literal became a host-derived deadline.)

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

import { gate, REPO_ROOT, TS_TYPECHECK_DEADLINE_MS, pinHostAcceptanceDeadline } from "./ts-typecheck-gate-helpers.mjs";

test("M63 D1: ts-typecheck gate PASSes against THIS repo's own real .quay/config.yml gates: wiring", async () => {
  // Deadline = the workspace's own declared gate deadline × this host's live oversubscription reading
  // (⛔ no bare ms literal: a fixed one only holds on an idle authoring host — see the helper).
  pinHostAcceptanceDeadline();
  const realConfigYml = path.join(REPO_ROOT, ".quay", "config.yml");
  assert.ok(fs.existsSync(realConfigYml), "real .quay/config.yml must exist in this worktree");
  const content = fs.readFileSync(realConfigYml, "utf8");
  assert.match(content, /ts-typecheck/, "real config.yml's gates: section must declare the ts-typecheck testPass gate");
  const r = await gate("ts-typecheck")({ id: "exp5-M-TS-MIGRATION-P0" });
  assert.equal(r.ok, true, `expected pass against this repo's real workspace; got reason=${r.reason}`);
}, { timeout: TS_TYPECHECK_DEADLINE_MS });
