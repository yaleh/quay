// @test-group governance
// slot-refill.test.mjs — gap-dispatch-evaluated-only-at-inner-tick-boundary-not-slot-release. Pins
// the SLOT-RELEASE REFILL evaluator (plugin/scripts/slot-refill.ts) — the event-driven dispatch
// trigger the inner tick's "槽位释放回填" step invokes when a completion notification arrives (a slot
// frees) so a freed slot is refilled immediately, NOT at the next tick boundary (~20-25 min later).
//
//   AC2 — event-driven wiring: the helper is the mechanism the notification turn runs; the pure
//         decideRefill() answers GO exactly when a slot is free AND dispatchable work exists.
//   AC4 — negative control: the helper NEVER schedules itself / never polls — it is invoked BY the
//         completion turn (or tick heartbeat). No new polling source / no dual drive. The only
//         inputs are mechanical reads; a null/unknown input fails CLOSED (never GO on unknown).
//   AC5 — cap semantics unchanged: GO requires slotsRemaining >= 1 (realInFlight < cap); the cap
//         comes from the same adaptive source the tick's step 3.6/4 uses (or --cap override).
//   AC6 — accurate completion perception: slots come from fast-mode-telemetry --slots
//         (reconcile-aware realInFlight — brackets ≠ subagents; cross-ref
//         gap-telemetry-brackets-vs-subagents-no-slot-visibility). Pinned here by the integration
//         run against the real repo (reads --slots output live).
//
// Run:
//   scripts/test.sh plugin/test/slot-refill.test.mjs
//   node --test plugin/test/slot-refill.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { decideRefill, SLOT_REFILL_REASONS } from "../scripts/slot-refill.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root upward from " + startDir);
}
const REPO_ROOT = findRepoRoot(__dirname);
const REFILL_SH = path.join(REPO_ROOT, "plugin", "scripts", "slot-refill.sh");

// R6 carrier-array cleanup: every mkdtemp dir is tracked and removed after the run (no tmp leak).
const _createdDirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `slotrefill-${prefix}-`));
  _createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _createdDirs) fs.rmSync(d, { recursive: true, force: true });
});

// ── AC2: GO exactly when a slot is free AND dispatchable work exists ───────────────────────────────
test("AC2 — GO when slotsRemaining >= 1 and dispatchable_disjoint >= 1", () => {
  const d = decideRefill({ halted: false, slotsRemaining: 2, realInFlight: 1, cap: 3, dispatchableDisjoint: 4 });
  assert.equal(d.go, true);
  assert.match(d.reason, /slots-remaining 2, dispatchable_disjoint 4/);
});

// ── AC4 / AC5 negative cases: fail CLOSED, never GO on unknown or at-cap state ─────────────────────
test("AC4 — halted (.halt present) ⇒ NO-GO regardless of free slots", () => {
  const d = decideRefill({ halted: true, slotsRemaining: 5, realInFlight: 0, cap: 3, dispatchableDisjoint: 9 });
  assert.equal(d.go, false);
  assert.equal(d.reason, SLOT_REFILL_REASONS.HALT);
});

test("AC5 — cap reached (slotsRemaining 0) ⇒ NO-GO even with a full pool", () => {
  const d = decideRefill({ halted: false, slotsRemaining: 0, realInFlight: 3, cap: 3, dispatchableDisjoint: 12 });
  assert.equal(d.go, false);
  assert.match(d.reason, new RegExp(SLOT_REFILL_REASONS.CAP_REACHED));
});

test("AC4 — no dispatchable work (dispatchable_disjoint 0) ⇒ NO-GO even with a free slot", () => {
  const d = decideRefill({ halted: false, slotsRemaining: 3, realInFlight: 0, cap: 3, dispatchableDisjoint: 0 });
  assert.equal(d.go, false);
  assert.match(d.reason, new RegExp(SLOT_REFILL_REASONS.NO_DISPATCHABLE));
});

test("AC4 — unknown slots/cap (null inputs) ⇒ NO-GO fail-closed, never GO on unknown", () => {
  const d = decideRefill({ halted: false, slotsRemaining: null, realInFlight: null, cap: null, dispatchableDisjoint: 3 });
  assert.equal(d.go, false);
  assert.equal(d.reason, SLOT_REFILL_REASONS.CAP_UNKNOWN);
});

// ── Integration: the one-command composition actually runs against the real repo ───────────────────
test("integration — bash plugin/scripts/slot-refill.sh composes cap+slots+pool and exits 0 (read-only)", () => {
  const r = spawnSync("bash", [REFILL_SH, "--root", REPO_ROOT, "--cap", "3"], { encoding: "utf8" });
  assert.equal(r.status, 0, `slot-refill.sh exited non-zero: ${r.stderr}`);
  // A detector/evaluator — output must be a parseable REFILL GO/NO-GO line, never a dispatch.
  assert.match(r.stdout, /^REFILL (GO|NO-GO): /);
  // The real repo is healthy enough to be non-empty on both axes (slots + pool reads succeed).
  assert.doesNotMatch(r.stdout, /slots unknown/);
});

test("integration — --json output carries the mechanical fields the tick's Contract can read", () => {
  const r = spawnSync("bash", [REFILL_SH, "--root", REPO_ROOT, "--cap", "3", "--json"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.ok(["GO", "NO-GO"].includes(out.refill));
  assert.equal(typeof out.reason, "string");
  assert.equal(typeof out.slotsRemaining, "number");
  assert.equal(typeof out.dispatchableDisjoint, "number");
  assert.equal(out.cap, 3);
});
