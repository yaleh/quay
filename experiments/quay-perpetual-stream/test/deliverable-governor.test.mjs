// @test-group engine
// Unit + golden-oracle tests for deliverable-governor.ts — DIR-066. The governor is SOFT: it biases only
// the Round-1 shortlist composition and NEVER halts. RED-first (ADR-001 / DIR-019).
// Run: node --test experiments/quay-perpetual-stream/test/deliverable-governor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { floor, nextStreak, composeShortlist, replayFloors, K, CAP, DEFAULT_SMAX, main, } = await import("../scripts/deliverable-governor.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "scripts", "deliverable-governor-fixture.json");

// ── floor ───────────────────────────────────────────────────────────────────────────────────────
test("floor rises min(1, streak/6) and saturates at streak=6 (=CAP/K)", () => {
  assert.equal(floor(0), 0);
  assert.equal(Number(floor(3).toFixed(2)), 0.5);
  assert.equal(Number(floor(2).toFixed(2)), 0.33);
  assert.equal(floor(6), 1);
  assert.equal(floor(9), 1);            // clamped
  assert.equal(CAP / K, 6);             // saturation point
});
test("floor rejects bad streak", () => {
  assert.throws(() => floor(-1));
  assert.throws(() => floor(NaN));
});

// ── nextStreak ──────────────────────────────────────────────────────────────────────────────────
test("nextStreak: no increments, yes resets, exempt neutral", () => {
  assert.equal(nextStreak(3, "no"), 4);
  assert.equal(nextStreak(3, "yes"), 0);
  assert.equal(nextStreak(3, "no", true), 3);   // exempt streak-neutral
  assert.equal(nextStreak(3, "yes", true), 3);  // exempt neutral even for a D
});

// ── composeShortlist: the sim-confirmed scenarios (S ∈ [1, sMax]) ─────────────────────────────────
const mk = (n, deliverable) => Array.from({ length: n }, (_, i) => ({ id: `${deliverable}${i}`, deliverable, rank: i }));
const pool = (nD, nN) => [...mk(nD, "yes"), ...mk(nN, "no")];

test("streak 0: natural shortlist, all N-seats (0D/4N), S=4", () => {
  const r = composeShortlist({ candidates: pool(5, 5), streak: 0 });
  assert.equal(r.floor, 0);
  assert.equal(r.nSeats, 4);
  assert.equal(r.shortlist.filter((c) => c.deliverable === "yes").length, 0);
  assert.equal(r.size, 4);
  assert.equal(r.starvation, false);
});
test("streak 2 (M125): floor 0.33 → 1 D seat, S=4", () => {
  const r = composeShortlist({ candidates: pool(5, 5), streak: 2 });
  assert.equal(Number(r.floor.toFixed(2)), 0.33);
  assert.equal(r.shortlist.filter((c) => c.deliverable === "yes").length, 1);
  assert.equal(r.size, 4);
});
test("streak 6, plenty D: floor 1.0 → all-D shortlist, S=sMax", () => {
  const r = composeShortlist({ candidates: pool(5, 5), streak: 6 });
  assert.equal(r.floor, 1);
  assert.equal(r.nSeats, 0);
  assert.equal(r.shortlist.every((c) => c.deliverable === "yes"), true);
  assert.equal(r.size, DEFAULT_SMAX);
  assert.equal(r.starvation, false);
});
test("streak 6, ONLY 1 D: shortlist shrinks to S=1 (single forced D)", () => {
  const r = composeShortlist({ candidates: pool(1, 5), streak: 6 });
  assert.equal(r.size, 1);
  assert.equal(r.shortlist[0].deliverable, "yes");
  assert.equal(r.starvation, false);
});
test("streak 9, ONLY 1 D: still S=1 (floor clamped)", () => {
  const r = composeShortlist({ candidates: pool(1, 5), streak: 9 });
  assert.equal(r.size, 1);
});
test("streak 6, ZERO D: starvation → run best N, flag set", () => {
  const r = composeShortlist({ candidates: pool(0, 5), streak: 6 });
  assert.equal(r.starvation, true);
  assert.equal(r.shortlist.every((c) => c.deliverable === "no"), true);
  assert.equal(r.size, DEFAULT_SMAX);
});
test("composeShortlist honors rank (best-first) and validates args", () => {
  const cands = [{ id: "d1", deliverable: "yes", rank: 5 }, { id: "d0", deliverable: "yes", rank: 1 }, ...mk(3, "no")];
  const r = composeShortlist({ candidates: cands, streak: 6 });
  assert.equal(r.shortlist[0].id, "d0");   // lower rank first
  assert.throws(() => composeShortlist({ candidates: "x", streak: 0 }));
  assert.throws(() => composeShortlist({ candidates: [], streak: 0, sMax: 0 }));
});

// ── self-limiting: while ≥1 D is available, streak can never exceed 6 ─────────────────────────────
test("self-limiting: with D always available, a Round-2-picks-from-shortlist sim keeps streak ≤ 6", () => {
  // Round 2 = pick the best-ranked shortlist entry. As long as >=1 D exists, floor=1 forces an all-D
  // shortlist by streak 6, so the pick is D and streak resets. Prove streak never exceeds 6.
  let streak = 0, maxStreak = 0;
  for (let i = 0; i < 200; i++) {
    const r = composeShortlist({ candidates: pool(2, 5), streak });   // 2 D always available
    const pick = r.shortlist[0];                                       // Round-2 stand-in: best-ranked
    streak = nextStreak(streak, pick.deliverable, false);
    if (streak > maxStreak) maxStreak = streak;
  }
  assert.ok(maxStreak <= 6, `maxStreak ${maxStreak} must be <= 6 while D available`);
});
test("self-limiting boundary: only when availD=0 can streak climb past 6", () => {
  let streak = 0;
  for (let i = 0; i < 20; i++) {
    const r = composeShortlist({ candidates: pool(0, 5), streak });   // NO D ever
    streak = nextStreak(streak, r.shortlist[0].deliverable, false);
  }
  assert.ok(streak > 6, "with zero D, streak legitimately exceeds 6 (the starvation regime)");
});

// ── golden-oracle replay over the independently-derived M63–M125 fixture ──────────────────────────
test("golden-oracle: M63–M125 (independently-derived) pins the floor trajectory + deliverable share", () => {
  assert.ok(fs.existsSync(FIXTURE), "independently-derived fixture must be checked in");
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const r = replayFloors(fixture);
  const at = (m) => r.rows.find((x) => x.m === m);
  // The real self-focus run is M99–M115 (arch-metric refactors + P4 loop-script migration + parent-close
  // bookkeeping): floor saturates at 1.0 from M102 (streak 6) and stays there through M115 (streak 16).
  assert.equal(at("M102").floor, 1.0, "M102 (streak 6) — saturation begins");
  assert.equal(at("M112").floor, 1.0, "M112 — deep in the loop-machinery run");
  // Independent classification corrects the design conversation's bias: M71 is DELIVERABLE (portable
  // loop-driver skill proven on archguard), so it is NOT part of a long N-run.
  assert.equal(at("M71").floor, 0.0, "M71 is deliverable (not a biased N-run point)");
  // Both historical hard-halts read calm under the per-task deliverable signal:
  assert.equal(at("M120").floor, 0.0, "cp-120 (M120) calm — M116–M122 deliverable-heavy");
  assert.equal(Number(at("M125").floor.toFixed(2)), 0.33, "cp-125 (M125) mild — streak 2");
  assert.ok(Math.abs(r.deliverableShare - 0.41) <= 0.04, `deliverable share ${r.deliverableShare.toFixed(2)} ≈ 0.41`);
  // The un-governed history reaches streak 16; with the governor active it would have self-limited at 6
  // (proven by the synthetic self-limiting test above) — the replay shows where pressure WOULD have applied.
  assert.equal(r.maxStreak, 16, "un-governed history peaks at streak 16 during the M99–M115 run");
});

// ── pure-soft: the CLI/replay emits no halt token ─────────────────────────────────────────────────
test("main() replay emits no HALT-RECOMMENDED (pure-soft)", async () => {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  let code;
  try { code = await main(["node", "deliverable-governor.ts", FIXTURE]); }
  finally { process.stdout.write = orig; }
  assert.equal(code, 0);
  assert.equal(chunks.join("").includes("HALT-RECOMMENDED"), false);
});

