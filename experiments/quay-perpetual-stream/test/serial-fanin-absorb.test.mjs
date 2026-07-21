// Unit tests for serial-fanin-absorb.mjs — the deterministic serial fan-in ABSORB plan (DIR-044
// increment 3). Background builds finish in NONDETERMINISTIC order, so the fan-in must be
// reproducible: it merges one-at-a-time in a deterministic order (sorted by milestone id), advances
// milestone_counter by exactly N, and appends N dashboard entries in that same order. RED-first
// (ADR-001 / DIR-019). This module computes the PLAN (the shared-state mutations the parallel builds
// deferred); the driver executes the git merges + file writes from it.
// Run: node --test experiments/quay-perpetual-stream/test/serial-fanin-absorb.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeFanIn,
  verifyMonotonic,
  renderDashboardAppend,
  main,
} from "../scripts/serial-fanin-absorb.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures", "fanin");
const fx = (f) => path.join(FIX, f);

const builds = [
  { id: "M-alpha", dashboardEntry: "alpha did X" },
  { id: "M-beta", dashboardEntry: "beta did Y" },
];

// ── computeFanIn ─────────────────────────────────────────────────────────────────────────────────
test("computeFanIn: counter advances by exactly N", () => {
  const p = computeFanIn(73, builds);
  assert.equal(p.counterBefore, 73);
  assert.equal(p.counterAfter, 75);
  assert.equal(p.entries.length, 2);
});

test("computeFanIn: milestone numbers are contiguous, in deterministic (id-sorted) order", () => {
  const p = computeFanIn(73, builds);
  assert.deepEqual(p.order, ["M-alpha", "M-beta"]);
  assert.deepEqual(p.entries.map((e) => e.milestone), [74, 75]);
  assert.equal(p.entries[0].id, "M-alpha");
  assert.equal(p.entries[1].id, "M-beta");
});

test("computeFanIn: DETERMINISTIC — input completion order does not change the plan", () => {
  const p1 = computeFanIn(73, [builds[0], builds[1]]);
  const p2 = computeFanIn(73, [builds[1], builds[0]]); // builds "finished" in reverse
  assert.deepEqual(p1, p2);
});

test("computeFanIn: duplicate build ids → throws (a batch cannot contain the same milestone twice)", () => {
  assert.throws(() => computeFanIn(73, [{ id: "X", dashboardEntry: "a" }, { id: "X", dashboardEntry: "b" }]), /duplicate/i);
});

test("computeFanIn: empty builds → throws (nothing to absorb)", () => {
  assert.throws(() => computeFanIn(73, []), /empty|no builds/i);
});

test("computeFanIn: non-integer / negative counter → throws", () => {
  assert.throws(() => computeFanIn(1.5, builds), /integer/i);
  assert.throws(() => computeFanIn(-1, builds), /integer|negative/i);
});

test("computeFanIn: a build missing a dashboardEntry → throws (every absorbed milestone records one)", () => {
  assert.throws(() => computeFanIn(73, [{ id: "X" }]), /dashboardEntry|entry/i);
});

// ── verifyMonotonic ──────────────────────────────────────────────────────────────────────────────
test("verifyMonotonic: a well-formed plan verifies", () => {
  assert.equal(verifyMonotonic(computeFanIn(73, builds)), true);
});

test("verifyMonotonic: a plan whose counterAfter != before+N is rejected", () => {
  const p = computeFanIn(73, builds);
  const tampered = { ...p, counterAfter: 76 };
  assert.equal(verifyMonotonic(tampered), false);
});

test("verifyMonotonic: a plan with a non-contiguous milestone number is rejected", () => {
  const p = computeFanIn(73, builds);
  const tampered = { ...p, entries: [p.entries[0], { ...p.entries[1], milestone: 99 }] };
  assert.equal(verifyMonotonic(tampered), false);
});

// ── renderDashboardAppend ────────────────────────────────────────────────────────────────────────
test("renderDashboardAppend: emits each entry in plan order with its milestone number", () => {
  const p = computeFanIn(73, builds);
  const md = renderDashboardAppend(p);
  const iAlpha = md.indexOf("M-alpha");
  const iBeta = md.indexOf("M-beta");
  assert.ok(iAlpha >= 0 && iBeta >= 0 && iAlpha < iBeta, "entries appear in plan order");
  assert.match(md, /74/);
  assert.match(md, /75/);
});

// ── main() over a JSON manifest fixture ──────────────────────────────────────────────────────────
test("main: valid manifest → plan printed, exit 0", async () => {
  assert.equal(await main(["node", "s", "--counter", "73", fx("two-build-manifest.json")]), 0);
});

test("main: missing manifest → exit 2", async () => {
  assert.equal(await main(["node", "s", "--counter", "73", fx("nope.json")]), 2);
});

test("main: missing --counter → exit 2", async () => {
  assert.equal(await main(["node", "s", fx("two-build-manifest.json")]), 2);
});
