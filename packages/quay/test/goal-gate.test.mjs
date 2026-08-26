// @test-group product
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-08-12 real shell criteria executed via the acceptance-runner shape; moved product→serial 2026-08-12 (8-lane flakes, isolated 5/5 — gap-suite-tiering-kind-heavy-not-a-mechanism 补缺省 kind)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — runs real shell-command criteria (criterion: "true"/"false" spawn shells)
// The `goal-<id>` gate — criterion-as-contract enforcement (SPEC §3), the third gate shape
// alongside `adr-<id>` (makeAdrGate, shell-out enforcement) and `doc-<id>` (makeDocumentContractGate,
// in-process contracts). A goal record's `criterion` is a runnable shell command executed via the
// task acceptance-runner shape (runAcceptance). Fails CLOSED when the record is missing or has no
// criterion — an unenforceable AC must never silently PASS (SPEC §2.4/§3).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { gateRegistry, registerGoalGate, listGates } from "../src/gate/registry.ts";
import { makeGoalGate } from "../src/gate/factories/goal.ts";
import { createGoalStore } from "../src/goal-store.ts";

const _createdDirs = [];
function tmpGoalDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-goal-gate-${tag}-`));
  _createdDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("goal gate fails-closed when the goal record does not exist", async () => {
  const dir = tmpGoalDir("missing");
  const r = await makeGoalGate("AC-999", dir)({ id: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no such goal/);
});

test("goal gate fails-closed when the criterion is empty/missing (AC2)", async () => {
  const dir = tmpGoalDir("nocriterion");
  const store = createGoalStore(dir);
  store.write("PHASE-001", { title: "p", status: "active", origin: "o" });
  store.write("AC-020", { title: "no-criterion", status: "active", phase: "PHASE-001", origin: "o" });
  const r = await makeGoalGate("AC-020", dir)({ id: "T" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /fail-closed/);
});

test("goal gate PASSes a criterion that exits 0 and FAILs one that exits non-zero", async () => {
  const dir = tmpGoalDir("real");
  const store = createGoalStore(dir);
  store.write("PHASE-001", { title: "p", status: "active", origin: "o" });
  store.write("AC-010", { title: "pass", status: "active", phase: "PHASE-001", criterion: "true", origin: "o" });
  store.write("AC-011", { title: "fail", status: "active", phase: "PHASE-001", criterion: "false", origin: "o" });

  const pass = await makeGoalGate("AC-010", dir)({ id: "T" });
  assert.equal(pass.ok, true, `expected pass; reason=${pass.reason}`);

  const fail = await makeGoalGate("AC-011", dir)({ id: "T" });
  assert.equal(fail.ok, false, `expected fail; reason=${fail.reason}`);
  assert.ok(fail.reason && fail.reason.length > 0);
});

test("a dynamically registered goal-<id> gate runs through the registry (same shape as doc/adr)", async () => {
  const dir = tmpGoalDir("registry");
  const store = createGoalStore(dir);
  store.write("PHASE-001", { title: "p", status: "active", origin: "o" });
  store.write("AC-100", { title: "conforming", status: "active", phase: "PHASE-001", criterion: "true", origin: "o" });
  registerGoalGate("goal-fixture-pass", dir, "AC-100");
  const r = await gateRegistry["goal-fixture-pass"]({ id: "T" });
  assert.equal(r.ok, true, `expected pass; reason=${r.reason}`);
});

test("listGates() includes a goal gate once one is registered", () => {
  const dir = tmpGoalDir("list");
  registerGoalGate("goal-list-check", dir, "AC-100");
  assert.ok(listGates().includes("goal-list-check"), `gates: ${listGates().join(", ")}`);
});
