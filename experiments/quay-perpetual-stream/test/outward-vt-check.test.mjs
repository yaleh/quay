// @test-group engine
// Tests for outward-vt-check.mjs — DIR-038-C (unbounded outward VT term). Golden/real oracle: this
// session's archguard signals. The term must be non-zero where the bounded cov ruler gave 0, and
// non-saturating. RED-first (ADR-001 / DIR-019).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { outwardVT, nonSaturating, rescore, DEFAULT_WEIGHTS, main } = await import("../scripts/outward-vt-check.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "..", "fixtures", "outward-vt");
const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const fx = (f) => path.join(FIX, f);

test("golden/real: the recorded archguard signals score a NON-ZERO outward term (cov gave ≈0)", () => {
  const s = load("archguard-signals.json");
  assert.equal(outwardVT(s), 1 * 10 + 9 * 1 + 5 * 5); // 44
  assert.ok(outwardVT(s) > 0);
});

test("non-saturating: the term is UNBOUNDED — no ceiling, strictly monotone in each signal", () => {
  assert.equal(nonSaturating(), true);
  // explicit: a huge input yields a huge score (a bounded cov [0,1] could never)
  assert.ok(outwardVT({ externalDeployments: 0, foreignTasksDriven: 1e6, newCapabilities: 0 }) >= 1e6);
  // monotone: more external value always scores strictly higher
  assert.ok(outwardVT({ externalDeployments: 2, foreignTasksDriven: 0, newCapabilities: 0 })
          > outwardVT({ externalDeployments: 1, foreignTasksDriven: 0, newCapabilities: 0 }));
});

test("rescore: M45 document-management (cov 0, no VT cell) gains a non-zero outward value → rescued", () => {
  const r = rescore(0, 1);
  assert.equal(r.cov, 0);
  assert.ok(r.outward > 0);
  assert.equal(r.rescued, true);
});

test("rescore: a case that DID score under cov is not falsely 'rescued'", () => {
  assert.equal(rescore(0.9, 1).rescued, false); // cov nonzero → not a rescue
});

test("outwardVT: fail-closed on negative / non-numeric signals", () => {
  assert.throws(() => outwardVT({ externalDeployments: -1, foreignTasksDriven: 0, newCapabilities: 0 }), /non-negative/);
  assert.throws(() => outwardVT({ externalDeployments: "x", foreignTasksDriven: 0, newCapabilities: 0 }), /non-negative/);
});

test("main: real signals → exit 0 (non-zero, non-saturating); missing file → exit 2", async () => {
  assert.equal(await main(["node", "s", fx("archguard-signals.json")]), 0);
  assert.equal(await main(["node", "s", fx("nope.json")]), 2);
});

