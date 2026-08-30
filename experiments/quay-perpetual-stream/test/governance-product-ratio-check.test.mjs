// @test-group engine
// Golden-replay + unit tests for governance-product-ratio-check.mjs — originally DIR-038-B. The frozen
// oracle is the recorded restart-window ratio (DIR-038 finding #2: governance:product ≈ 8:1, ≈6249:756).
// A breach is now INFORMATIONAL ONLY since DIR-066 (2026-07-23) retired the hard-halt wiring — it no
// longer trips HALT-RECOMMENDED. RED-first (ADR-001 / DIR-019).
// Run: node --test experiments/quay-perpetual-stream/test/governance-product-ratio-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { classifyPath, sumByClass, ratio, isBreach, evaluateRatio, DEFAULT_THRESHOLD, main, } = await import("../scripts/governance-product-ratio-check.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures", "gov-product");
const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const fx = (f) => path.join(FIX, f);
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

// ── classifyPath ─────────────────────────────────────────────────────────────────────────────────
test("classifyPath: packages/ and plugin/ are PRODUCT; everything else is GOVERNANCE", () => {
  assert.equal(classifyPath("packages/quay/src/x.js"), "product");
  assert.equal(classifyPath("plugin/scripts/y.mjs"), "product");
  assert.equal(classifyPath("./packages/quay-native/store.js"), "product");
  assert.equal(classifyPath("experiments/quay-perpetual-stream/dashboard.md"), "governance");
  assert.equal(classifyPath("tasks/DIR-038.md"), "governance");
  assert.equal(classifyPath("docs/proposals/x.md"), "governance");
  assert.equal(classifyPath("adr/ADR-012.md"), "governance");
});

test("classifyPath: PROSE (.md/.txt) is GOVERNANCE even under packages/ or plugin/ — closes the laundering hole", () => {
  // DIR-038-B audit finding: parking prose docs under packages/ laundered governance into "product".
  assert.equal(classifyPath("packages/quay/METHODOLOGY-NOTES.md"), "governance");
  assert.equal(classifyPath("plugin/docs/RETRO.md"), "governance");
  assert.equal(classifyPath("packages/quay/src/x.js"), "product"); // real code still product
  assert.equal(classifyPath("packages/quay/notes.txt"), "governance");
});

test("anti-laundering: the auditor's attack (8000 prose lines under packages/plugin) still BREACHES", () => {
  // 8000 lines of prose parked under packages/plugin + 20 code lines against 6249 governance.
  // Old classifier: ratio 0.78:1 (green). Fixed classifier: prose → governance → still a runaway.
  const t = sumByClass([
    { path: "packages/quay/METHODOLOGY-NOTES.md", added: 6000 }, // prose → governance
    { path: "plugin/docs/RETRO.md", added: 2000 },               // prose → governance
    { path: "packages/quay/src/real.js", added: 20 },            // code → product
    { path: "experiments/quay-perpetual-stream/dashboard.md", added: 6249 },
  ]);
  assert.equal(t.product, 20);
  assert.equal(t.governance, 6000 + 2000 + 6249);
  assert.equal(evaluateRatio(t).breach, true); // laundering no longer dilutes the ratio green
});

// ── GOLDEN REPLAY — reproduce the recorded ≈8:1 ───────────────────────────────────────────────────
test("golden: recorded restart window reproduces ≈8.27:1 (6249:756) and BREACHES the 5:1 threshold", () => {
  const t = load("recorded-window.json");
  assert.ok(near(ratio(t), 8.27), `got ${ratio(t)}`);
  assert.equal(isBreach(ratio(t)), true);
});

test("golden: sumByClass classifies numstat entries correctly (product=packages+plugin, governance=rest)", () => {
  const t = sumByClass(load("numstat-entries.json"));
  assert.equal(t.product, 150);      // packages 100 + plugin 50
  assert.equal(t.governance, 1200);  // dashboard 900 + tasks 300
  assert.equal(ratio(t), 8);
});

// ── breach / halt input ───────────────────────────────────────────────────────────────────────────
test("evaluateRatio: a runaway ratio → breach=true (informational only, DIR-066); a healthy ratio → breach=false", () => {
  assert.equal(evaluateRatio(load("recorded-window.json")).breach, true);
  assert.equal(evaluateRatio(load("healthy-window.json")).breach, false);
});

test("ratio: pure-governance window (product 0) → Infinity (maximal degradation); no activity → 0", () => {
  assert.equal(ratio({ governance: 500, product: 0 }), Infinity);
  assert.equal(isBreach(Infinity), true);
  assert.equal(ratio({ governance: 0, product: 0 }), 0);
});

test("threshold is tunable and generous by default (explore-cadence method-infra is not a breach)", () => {
  assert.equal(DEFAULT_THRESHOLD, 5.0);
  assert.equal(isBreach(4.9, 5.0), false); // ordinary instrument work below runaway
  assert.equal(isBreach(8.27, 3.0), true); // stricter threshold still catches the runaway
});

// ── fail-closed input validation ──────────────────────────────────────────────────────────────────
test("sumByClass / ratio: malformed input throws (fail-closed)", () => {
  assert.throws(() => sumByClass("nope"), /array/);
  assert.throws(() => sumByClass([{ path: "packages/x.js", added: -1 }]), /bad 'added'/);
  assert.throws(() => ratio({ governance: -1, product: 1 }), /non-negative/);
});

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
test("main: recorded window → exit 1 (BREACH); healthy → exit 0", async () => {
  assert.equal(await main(["node", "s", fx("recorded-window.json")]), 1);
  assert.equal(await main(["node", "s", fx("healthy-window.json")]), 0);
});

test("main: numstat entries file classified + exit 1 (breach); missing file → exit 2", async () => {
  assert.equal(await main(["node", "s", fx("numstat-entries.json")]), 1);
  assert.equal(await main(["node", "s", fx("nope.json")]), 2);
});

