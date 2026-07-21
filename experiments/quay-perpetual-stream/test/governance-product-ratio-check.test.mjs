// Golden-replay + unit tests for governance-product-ratio-check.mjs — DIR-038-B. The frozen oracle is
// the recorded restart-window ratio (DIR-038 finding #2: governance:product ≈ 8:1, ≈6249:756). A
// breach IS degradation → a HALT-RECOMMENDED input. RED-first (ADR-001 / DIR-019).
// Run: node --test experiments/quay-perpetual-stream/test/governance-product-ratio-check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyPath,
  sumByClass,
  ratio,
  isBreach,
  haltInput,
  DEFAULT_THRESHOLD,
  main,
} from "../scripts/governance-product-ratio-check.mjs";

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
test("haltInput: a runaway ratio → halt=true (degradation); a healthy ratio → halt=false", () => {
  assert.equal(haltInput(load("recorded-window.json")).halt, true);
  assert.equal(haltInput(load("healthy-window.json")).halt, false);
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
