// @test-group product
// ts-typecheck-gate-config-wiring.test.mjs — split out of ts-typecheck-gate.test.mjs
// (gap-suite-split-long-multi-test-files): M63 D1 — the ts-typecheck gate PASSes against THIS
// repo's own real .quay/config.yml gates: wiring (the exact source the real OUTER-LOOP ABSORB gates
// against, not a fixture copy). The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

import { gate, REPO_ROOT } from "./ts-typecheck-gate-helpers.mjs";

test("M63 D1: ts-typecheck gate PASSes against THIS repo's own real .quay/config.yml gates: wiring", async () => {
  const realConfigYml = path.join(REPO_ROOT, ".quay", "config.yml");
  assert.ok(fs.existsSync(realConfigYml), "real .quay/config.yml must exist in this worktree");
  const content = fs.readFileSync(realConfigYml, "utf8");
  assert.match(content, /ts-typecheck/, "real config.yml's gates: section must declare the ts-typecheck testPass gate");
  const r = await gate("ts-typecheck")({ id: "exp5-M-TS-MIGRATION-P0" });
  assert.equal(r.ok, true, `expected pass against this repo's real workspace; got reason=${r.reason}`);
}, { timeout: 120000 });
