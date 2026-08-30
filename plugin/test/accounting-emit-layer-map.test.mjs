// @test-group engine
// accounting-emit-layer-map.test.mjs — AC39 layer→mechanisms mapping + three-layer emitter behavior
// (task gap-ac39-accounting-emit-layer, manager 034125).
//
// Pins the per-layer mechanism-membership table (plugin/scripts/accounting-emit-layer-map.ts) and the
// emitter's three-layer behavior after the fix:
//   invariant layer_map_correct = 1 — cap-from-gate/slot-refill ∈ inner, closure-lag-check ∈ outer,
//     cap-from-gate/slot-refill ∉ manager (the observed manager defect: manager's emit carried
//     INNER's mechanisms and was permanently missing them).
//   invariant in_flight_all_layers = 1 — occupancy.in_flight present in all three layers' emit.
//   band accounting_complete — three layers complete=true when each layer injects ITS OWN mechanisms
//     (per its mapping) + supplies occupancy (AC1 "修后三层 complete=True").
//
// Run:
//   node --experimental-strip-types --test plugin/test/accounting-emit-layer-map.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAYER_MECHANISMS, MECHANISM_DEFS } from "../scripts/accounting-emit-layer-map.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EMITTER = path.join(REPO_ROOT, "plugin", "scripts", "accounting-emit.ts");

function run(args = []) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", EMITTER, ...args], { encoding: "utf8" });
}

function jsonRun(args = []) {
  const r = run([...args, "--json"]);
  assert.ok(r.stdout, `accounting-emit must produce stdout:\n${r.stderr}`);
  return { parsed: JSON.parse(r.stdout), status: r.status };
}

// ── invariant layer_map_correct = 1 ──────────────────────────────────────────────────────────────────

test("layer_map — cap-from-gate/slot-refill 归 inner, closure-lag-check 归 outer, manager has its own set", () => {
  const inner = LAYER_MECHANISMS.inner;
  const outer = LAYER_MECHANISMS.outer;
  const manager = LAYER_MECHANISMS.manager;
  // cap-from-gate/slot-refill are INNER's mechanisms (the AC39 ruling).
  assert.ok(inner.includes("cap-from-gate"), "inner includes cap-from-gate");
  assert.ok(inner.includes("slot-refill"), "inner includes slot-refill");
  // closure-lag-check is OUTER's mechanism.
  assert.ok(outer.includes("closure-lag-check"), "outer includes closure-lag-check");
  // manager must NOT carry inner's mechanisms (the observed defect: manager's emit was permanently
  // missing cap-from-gate/slot-refill because they are not manager mechanisms).
  assert.ok(!manager.includes("cap-from-gate"), "manager does NOT include cap-from-gate");
  assert.ok(!manager.includes("slot-refill"), "manager does NOT include slot-refill");
  // closure-lag-check stays outer-only.
  assert.ok(!inner.includes("closure-lag-check"), "inner does NOT include closure-lag-check");
  assert.ok(!manager.includes("closure-lag-check"), "manager does NOT include closure-lag-check");
});

test("layer_map — every LAYER_MECHANISMS name resolves to a MECHANISM_DEFS entry (fail-closed map)", () => {
  for (const layer of Object.keys(LAYER_MECHANISMS)) {
    assert.ok(layer in LAYER_MECHANISMS, `map has layer '${layer}'`);
    assert.ok(LAYER_MECHANISMS[layer].length > 0, `layer '${layer}' has at least one mechanism`);
    for (const name of LAYER_MECHANISMS[layer]) {
      assert.ok(MECHANISM_DEFS[name], `MECHANISM_DEFS resolves '${name}' (layer '${layer}')`);
    }
  }
  // The three layers are exactly the emitter's --layer set.
  assert.deepEqual(Object.keys(LAYER_MECHANISMS).sort(), ["inner", "manager", "outer"]);
});

test("emitter — inner emits cap-from-gate/slot-refill/ready-pool-check --apply/fast-mode-telemetry --task-start, NOT closure-lag-check", () => {
  const { parsed } = jsonRun(["--layer", "inner"]);
  const names = parsed.mechanisms.map((m) => m.name);
  for (const n of ["cap-from-gate", "slot-refill", "ready-pool-check --apply", "fast-mode-telemetry --task-start"]) {
    assert.ok(names.includes(n), `inner emits '${n}'; got [${names.join(", ")}]`);
  }
  assert.ok(!names.includes("closure-lag-check"), "inner does NOT emit closure-lag-check");
});

test("emitter — outer emits closure-lag-check, NOT cap-from-gate/slot-refill", () => {
  const { parsed } = jsonRun(["--layer", "outer"]);
  const names = parsed.mechanisms.map((m) => m.name);
  assert.ok(names.includes("closure-lag-check"), `outer emits closure-lag-check; got [${names.join(", ")}]`);
  assert.ok(!names.includes("cap-from-gate"), "outer does NOT emit cap-from-gate");
  assert.ok(!names.includes("slot-refill"), "outer does NOT emit slot-refill");
});

test("emitter — manager emits its own (manager-tick-log/Workflow/session-liveness), NOT cap-from-gate/slot-refill", () => {
  const { parsed } = jsonRun(["--layer", "manager"]);
  const names = parsed.mechanisms.map((m) => m.name);
  for (const n of ["manager-tick-log", "Workflow", "session-liveness"]) {
    assert.ok(names.includes(n), `manager emits '${n}'; got [${names.join(", ")}]`);
  }
  assert.ok(!names.includes("cap-from-gate"), "manager does NOT emit cap-from-gate (AC39 root cause)");
  assert.ok(!names.includes("slot-refill"), "manager does NOT emit slot-refill (AC39 root cause)");
});

// ── invariant in_flight_all_layers = 1 (AC3) ────────────────────────────────────────────────────────

test("in_flight — occupancy.in_flight present in all three layers' emit (invariant in_flight_all_layers)", () => {
  const now = Math.floor(Date.now() / 1000);
  for (const layer of ["inner", "outer", "manager"]) {
    const { parsed } = jsonRun([
      "--layer", layer,
      "--in-flight", "2",
      "--cap", "4",
      "--no-registry",
      "--mechanism", `m:${now - 30}`,
    ]);
    assert.ok("in_flight" in parsed.occupancy, `${layer} occupancy carries the in_flight key`);
    assert.equal(parsed.occupancy.in_flight, 2, `${layer} occupancy.in_flight value`);
    assert.equal(parsed.occupancy.effective_cap, 4, `${layer} occupancy.effective_cap value`);
  }
});

// ── band accounting_complete (AC1: 修后三层 complete=True) ───────────────────────────────────────────

test("complete — three layers complete=true when each layer injects ITS OWN mechanisms + occupancy", () => {
  const now = Math.floor(Date.now() / 1000);
  const byLayer = {
    inner: ["cap-from-gate", "slot-refill", "ready-pool-check --apply", "fast-mode-telemetry --task-start"],
    outer: ["closure-lag-check", "verification-round", "full-suite-runner"],
    manager: ["manager-tick-log", "Workflow", "session-liveness"],
  };
  for (const layer of Object.keys(byLayer)) {
    const args = ["--layer", layer, "--in-flight", "1", "--cap", "3"];
    for (const m of byLayer[layer]) args.push("--mechanism", `${m}:${now - 60}`);
    const { parsed, status } = jsonRun(args);
    assert.equal(status, 0, `${layer} exits 0 (complete)`);
    assert.equal(parsed.complete, true, `${layer} complete=true; missing=[${parsed.missing.join(", ")}]`);
    assert.deepEqual(parsed.missing, [], `${layer} missing empty`);
    assert.equal(parsed.occupancy.in_flight, 1, `${layer} occupancy.in_flight present`);
    // The layer emits exactly its own mapped mechanisms — no strays.
    assert.deepEqual(
      parsed.mechanisms.map((m) => m.name).sort(),
      [...byLayer[layer]].sort(),
      `${layer} emits exactly its mapped mechanisms`
    );
  }
});
