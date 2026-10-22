// target-strong-check.mjs — the STRONG fixture check for AC1: it asserts the exact answers of
// target.mjs, so an operator that changes behaviour is detected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, combine, pick } from "./target.mjs";

test("classify distinguishes zero from nonzero", () => {
  assert.equal(classify(0), "zero");
  assert.equal(classify(7), "nonzero");
});

test("combine is logical AND", () => {
  assert.equal(combine(0, 5), 0);
  assert.equal(combine(3, 5), 5);
  assert.equal(combine(false, true), false);
});

test("pick maps the boolean literal to its word", () => {
  assert.equal(pick(true), "yes");
  assert.equal(pick(false), "no");
});
