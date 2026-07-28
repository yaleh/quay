// Unit tests for wiring-coverage-check.mjs — the DIR-117/DIR-122 shared mechanism-claim wiring
// coverage check. RED/GREEN pair per both directives' AC: an uncovered mechanism claim FAILS; the
// same claim with a matching, evidence-requiring AC item PASSES.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMechanismClaims, bulletsOf, checkWiringCoverage } from "../scripts/wiring-coverage-check.ts";

test("extractMechanismClaims: wiring-verb sentence with >=2 backtick identifiers is a claim", () => {
  const text = "The new `foo.ts` module invokes `bar.ts` to enforce read-only access on the shard.";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 1);
  assert.deepEqual(claims[0].identifiers.sort(), ["bar.ts", "foo.ts"]);
});

test("extractMechanismClaims: no wiring verb -> no claim", () => {
  const text = "`foo.ts` and `bar.ts` are both new files added in this change.";
  assert.equal(extractMechanismClaims(text).length, 0);
});

test("extractMechanismClaims: wiring verb but only 1 identifier -> no claim", () => {
  const text = "`foo.ts` now enforces read-only access on every incoming request.";
  assert.equal(extractMechanismClaims(text).length, 0);
});

test("extractMechanismClaims: multiple independent claims in one section", () => {
  const text =
    "`select-preflight.ts` dispatches `composite-preflight.ts` before Build.\n\n" +
    "Separately, `composite-land.ts` owns `dashboard.md` writes during Land.";
  const claims = extractMechanismClaims(text);
  assert.equal(claims.length, 2);
});

test("bulletsOf: joins wrapped continuation lines into one bullet", () => {
  const ac = "## Acceptance Criteria\n- [ ] `foo.ts` invoking `bar.ts` is proven by real\n  production callsite evidence.\n- [ ] second item\n";
  const bullets = bulletsOf(ac);
  assert.equal(bullets.length, 2);
  assert.match(bullets[0], /production callsite evidence\.$/);
});

// ── RED: uncovered mechanism claim -> FAIL ────────────────────────────────────────────────────────
test("checkWiringCoverage: RED — claimed mechanism with no matching AC item fails", () => {
  const source = "The new `wiring-coverage-check.ts` module invokes `task-schema.ts` to enforce coverage.";
  const ac = "- [ ] some unrelated acceptance item with no identifiers at all";
  const result = checkWiringCoverage(source, ac);
  assert.equal(result.ok, false);
  assert.equal(result.code, "wiring-coverage-uncovered");
  assert.equal(result.uncovered.length, 1);
});

// ── GREEN: same claim, matching AC item -> PASS ──────────────────────────────────────────────────
test("checkWiringCoverage: GREEN — same claim with a matching, evidence-requiring AC item passes", () => {
  const source = "The new `wiring-coverage-check.ts` module invokes `task-schema.ts` to enforce coverage.";
  const ac = "- [ ] Real production callsite evidence confirms `wiring-coverage-check.ts` invokes `task-schema.ts`.";
  const result = checkWiringCoverage(source, ac);
  assert.equal(result.ok, true);
  assert.equal(result.code, "wiring-coverage-complete");
  assert.equal(result.uncovered.length, 0);
});

test("checkWiringCoverage: no claims at all -> PASS vacuously", () => {
  const result = checkWiringCoverage("plain prose with no wiring verbs or identifiers", "- [ ] anything");
  assert.equal(result.ok, true);
  assert.equal(result.code, "wiring-coverage-none-claimed");
});

test("checkWiringCoverage: identifiers matched but no evidence keyword in the bullet -> still uncovered", () => {
  const source = "`a.ts` calls `b.ts` to route requests.";
  const ac = "- [ ] `a.ts` and `b.ts` are both mentioned here as new files";
  const result = checkWiringCoverage(source, ac);
  assert.equal(result.ok, false);
});
