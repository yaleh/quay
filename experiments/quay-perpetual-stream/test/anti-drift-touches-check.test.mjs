// Unit tests for anti-drift-touches-check.mjs — the NON-WAIVABLE after-the-fact HARD guardrail
// (DIR-044 increment 4; charter Step 5). After a concurrent batch RAN, each build's ACTUAL touched
// files (from `git diff --numstat`) are checked against what it DECLARED: a build that wrote OUTSIDE
// its declared `touches`, or two builds that ACTUALLY overlapped (a mis-declared batch), is a HARD
// FAIL — the guardrail that keeps concurrency from silently corrupting shared state. RED-first
// (ADR-001 / DIR-019): the guardrail MUST bite a mis-declared fixture.
// Run: node --test experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fileWithinDeclared,
  checkAntiDrift,
  main,
} from "../scripts/anti-drift-touches-check.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures", "antidrift");
const fx = (f) => path.join(FIX, f);

// ── fileWithinDeclared ───────────────────────────────────────────────────────────────────────────
test("fileWithinDeclared: a file matching a declared glob is within", () => {
  assert.equal(fileWithinDeclared("pkg/a/x.js", ["pkg/a/**"]), true);
  assert.equal(fileWithinDeclared("pkg/b/x.js", ["pkg/a/**"]), false);
  assert.equal(fileWithinDeclared("pkg/a/x.js", []), false); // nothing declared → nothing is within
});

// ── checkAntiDrift ───────────────────────────────────────────────────────────────────────────────
const clean = [
  { id: "A", declaredGlobs: ["pkg/a/**"], actualFiles: ["pkg/a/x.js", "pkg/a/y.js"] },
  { id: "B", declaredGlobs: ["pkg/b/**"], actualFiles: ["pkg/b/z.js"] },
];

test("checkAntiDrift: a clean batch (actual ⊆ declared, no cross-overlap) → ok", () => {
  const r = checkAntiDrift(clean);
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test("checkAntiDrift: a build that ACTUALLY overlapped another (mis-declared) → HARD FAIL", () => {
  const misdeclared = [
    { id: "A", declaredGlobs: ["pkg/a/**", "shared/s.js"], actualFiles: ["pkg/a/x.js", "shared/s.js"] },
    { id: "B", declaredGlobs: ["pkg/b/**", "shared/s.js"], actualFiles: ["pkg/b/z.js", "shared/s.js"] },
  ];
  const r = checkAntiDrift(misdeclared);
  assert.equal(r.ok, false);
  const overlap = r.violations.find((v) => v.type === "cross-build-overlap");
  assert.ok(overlap, "expected a cross-build-overlap violation");
  assert.equal(overlap.file, "shared/s.js");
});

test("checkAntiDrift: a build that WROTE OUTSIDE its declared touches → HARD FAIL", () => {
  const strayWrite = [
    { id: "A", declaredGlobs: ["pkg/a/**"], actualFiles: ["pkg/a/x.js", "pkg/OTHER/stray.js"] },
    { id: "B", declaredGlobs: ["pkg/b/**"], actualFiles: ["pkg/b/z.js"] },
  ];
  const r = checkAntiDrift(strayWrite);
  assert.equal(r.ok, false);
  const stray = r.violations.find((v) => v.type === "out-of-declared");
  assert.ok(stray, "expected an out-of-declared violation");
  assert.equal(stray.file, "pkg/OTHER/stray.js");
  assert.equal(stray.build, "A");
});

test("checkAntiDrift: a build with NO declared touches but real writes → all writes are violations", () => {
  const r = checkAntiDrift([{ id: "A", declaredGlobs: [], actualFiles: ["pkg/a/x.js"] }]);
  assert.equal(r.ok, false);
  assert.equal(r.violations[0].type, "out-of-declared");
});

test("checkAntiDrift: a build that touched nothing → ok (a no-op build is not drift)", () => {
  const r = checkAntiDrift([{ id: "A", declaredGlobs: ["pkg/a/**"], actualFiles: [] }]);
  assert.equal(r.ok, true);
});

test("checkAntiDrift: three builds, one pair overlaps → the specific pair is reported", () => {
  const r = checkAntiDrift([
    { id: "A", declaredGlobs: ["a/**"], actualFiles: ["a/x.js"] },
    { id: "B", declaredGlobs: ["b/**", "a/x.js"], actualFiles: ["b/y.js", "a/x.js"] }, // overlaps A
    { id: "C", declaredGlobs: ["c/**"], actualFiles: ["c/z.js"] },
  ]);
  assert.equal(r.ok, false);
  const ov = r.violations.find((v) => v.type === "cross-build-overlap");
  assert.deepEqual([ov.a, ov.b].sort(), ["A", "B"]);
});

// ── main() over JSON manifests (green + the two RED guardrail-bites cases) ────────────────────────
test("main: GREEN manifest (clean batch) → exit 0", async () => {
  assert.equal(await main(["node", "s", fx("green.json")]), 0);
});

test("main: RED manifest (cross-build overlap) → exit 1 (guardrail bites)", async () => {
  assert.equal(await main(["node", "s", fx("red-overlap.json")]), 1);
});

test("main: RED manifest (wrote outside declared) → exit 1 (guardrail bites)", async () => {
  assert.equal(await main(["node", "s", fx("red-stray.json")]), 1);
});

test("main: missing manifest → exit 2", async () => {
  assert.equal(await main(["node", "s", fx("nope.json")]), 2);
});

test("main: no manifest arg → exit 2", async () => {
  assert.equal(await main(["node", "s"]), 2);
});
