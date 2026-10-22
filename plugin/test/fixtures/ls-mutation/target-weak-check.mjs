// target-weak-check.mjs — the WEAK fixture check for AC1: it only asserts that the functions do not
// throw. Every mutant that leaves the function callable survives here, even though its ANSWER is
// wrong — exactly the "tests pass but behaviour is unconstrained" shape L_S is meant to expose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, combine, pick } from "./target.mjs";

test("classify does not throw", () => {
  assert.doesNotThrow(() => classify(0));
});

test("combine does not throw", () => {
  assert.doesNotThrow(() => combine(1, 2));
});

test("pick does not throw", () => {
  assert.doesNotThrow(() => pick(true));
});
