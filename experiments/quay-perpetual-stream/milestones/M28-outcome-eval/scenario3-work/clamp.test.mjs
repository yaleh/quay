import { test } from "node:test";
import assert from "node:assert/strict";
import { clamp } from "./clamp.mjs";

test("below-min clamps to min", () => assert.equal(clamp(-5, 0, 10), 0));
test("above-max clamps to max", () => assert.equal(clamp(15, 0, 10), 10));
test("within-range returns unchanged", () => assert.equal(clamp(5, 0, 10), 5));
test("min==max clamps to that value", () => assert.equal(clamp(5, 3, 3), 3));
