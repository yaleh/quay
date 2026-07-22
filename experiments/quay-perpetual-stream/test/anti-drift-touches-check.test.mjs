// Unit tests for anti-drift-touches-check.mjs — the NON-WAIVABLE after-the-fact HARD guardrail
// (DIR-044 increment 4; charter Step 5). After a concurrent batch RAN, each build's ACTUAL touched
// files (from `git diff --numstat`) are checked against what it DECLARED: a build that wrote OUTSIDE
// its declared `touches`, or two builds that ACTUALLY overlapped (a mis-declared batch), is a HARD
// FAIL — the guardrail that keeps concurrency from silently corrupting shared state. RED-first
// (ADR-001 / DIR-019): the guardrail MUST bite a mis-declared fixture.
// Run: node --test experiments/quay-perpetual-stream/test/anti-drift-touches-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fileWithinDeclared,
  normalizePath,
  checkAntiDrift,
  main,
} from "../scripts/anti-drift-touches-check.ts";

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

// ── hardening from the increment-4 adversarial audit (H3 overbroad, H1 normalization) ─────────────
test("checkAntiDrift: an OVERBROAD declaration (packages/**) is rejected — closes audit H3", () => {
  // Without this, `packages/**` would absorb a stray write and the out-of-declared arm is toothless.
  const r = checkAntiDrift([
    { id: "A", declaredGlobs: ["packages/**"], actualFiles: ["packages/quay/x.js", "packages/UNRELATED/stray.js"] },
    { id: "B", declaredGlobs: ["experiments/**/z.js"], actualFiles: ["experiments/a/z.js"] },
  ]);
  assert.equal(r.ok, false);
  const ob = r.violations.find((v) => v.type === "overbroad-declaration");
  assert.ok(ob, "expected an overbroad-declaration violation");
  assert.equal(ob.build, "A");
  assert.equal(ob.glob, "packages/**");
});

test("checkAntiDrift: cross-build overlap survives path-shape differences (./ prefix) — closes audit H1", () => {
  const r = checkAntiDrift([
    { id: "A", declaredGlobs: ["shared/s.js"], actualFiles: ["./shared/s.js"] },
    { id: "B", declaredGlobs: ["shared/s.js"], actualFiles: ["shared/s.js"] },
  ]);
  assert.equal(r.ok, false);
  const ov = r.violations.find((v) => v.type === "cross-build-overlap");
  assert.ok(ov, "the ./-prefixed path must still be seen as the same file");
  assert.equal(ov.file, "shared/s.js");
});

test("normalizePath: strips leading ./, trailing /, collapses //, resolves ./.. segments", () => {
  assert.equal(normalizePath("./a/b.js"), "a/b.js");
  assert.equal(normalizePath("a//b.js"), "a/b.js");
  assert.equal(normalizePath("a/b/"), "a/b");
  assert.equal(normalizePath("a/./b.js"), "a/b.js");       // dot segment (audit H1 class)
  assert.equal(normalizePath("a/../a/b.js"), "a/b.js");    // parent segment
  assert.equal(normalizePath(".//a/b.js"), "a/b.js");      // the .// normalization bug
  assert.equal(normalizePath("a\\b.js"), "a/b.js");        // backslashes
});

test("checkAntiDrift: dot-segment path variants of the same file still collide (audit H1 dot-class)", () => {
  const r = checkAntiDrift([
    { id: "A", declaredGlobs: ["a/**"], actualFiles: ["a/./b.js"] },
    { id: "B", declaredGlobs: ["a/**"], actualFiles: ["a/b.js"] },
  ]);
  // NB: a/** is overbroad? no — "a" is 1 concrete segment before ** → overbroad. Use deeper decls:
  const r2 = checkAntiDrift([
    { id: "A", declaredGlobs: ["a/sub/**"], actualFiles: ["a/sub/../sub/b.js"] },
    { id: "B", declaredGlobs: ["a/sub/**"], actualFiles: ["a/sub/b.js"] },
  ]);
  assert.equal(r2.ok, false);
  assert.ok(r2.violations.find((v) => v.type === "cross-build-overlap" && v.file === "a/sub/b.js"));
});

test("checkAntiDrift: the audit's overbroad evasions (packages/**/*, **/*.js) are now HARD FAIL", () => {
  for (const g of ["packages/**/*", "**/*.js", "packages/*/**"]) {
    const r = checkAntiDrift([{ id: "A", declaredGlobs: [g], actualFiles: ["packages/UNRELATED/stray.js"] }]);
    assert.equal(r.ok, false, `expected ${g} to be rejected as overbroad`);
    assert.ok(r.violations.find((v) => v.type === "overbroad-declaration"), `no overbroad violation for ${g}`);
  }
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

test("main: RED manifest (overbroad declaration) → exit 1 (guardrail bites — audit H3)", async () => {
  assert.equal(await main(["node", "s", fx("red-overbroad.json")]), 1);
});

test("main: missing manifest → exit 2", async () => {
  assert.equal(await main(["node", "s", fx("nope.json")]), 2);
});

test("checkAntiDrift: malformed manifest (wrong field names) FAILS CLOSED — DIR-049 wiring audit", () => {
  // a wrong-field-name manifest must NOT silently pass a NON-WAIVABLE guardrail
  assert.throws(() => checkAntiDrift([{ id: "A", touches: ["x/a.js"] }]), /declaredGlobs|fail-closed/i);
  assert.throws(() => checkAntiDrift([{ id: "A", declaredGlobs: ["x/**"], writtenFiles: ["x/a.js"] }]), /actualFiles|fail-closed/i);
  assert.throws(() => checkAntiDrift([{ declaredGlobs: [], actualFiles: [] }]), /string id/i);
});

test("main: malformed manifest → exit 1 (HARD FAIL, not OK)", async () => {
  const bad = fx("malformed.json");
  fs.writeFileSync(bad, JSON.stringify([{ id: "A", touches: ["x/a.js"] }]));
  assert.equal(await main(["node", "s", bad]), 1);
  fs.rmSync(bad, { force: true });
});

test("main: no manifest arg → exit 2", async () => {
  assert.equal(await main(["node", "s"]), 2);
});
