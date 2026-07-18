import { test } from "node:test";
import assert from "node:assert/strict";
import { isEven } from "./iseven.mjs";

test("zero is even", () => assert.equal(isEven(0), true));
test("positive even", () => assert.equal(isEven(4), true));
test("positive odd", () => assert.equal(isEven(3), false));
test("negative even", () => assert.equal(isEven(-4), true));
test("negative odd", () => assert.equal(isEven(-3), false));
