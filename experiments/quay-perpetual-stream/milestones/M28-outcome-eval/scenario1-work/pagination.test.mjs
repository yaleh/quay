import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "./pagination.mjs";

test("empty input returns empty page", () => {
  assert.deepEqual(paginate([], 10, 0), []);
});

test("exact page boundary returns full page", () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(paginate(items, 5, 0), [0, 1, 2, 3, 4]);
  assert.deepEqual(paginate(items, 5, 1), [5, 6, 7, 8, 9]);
});

test("partial last page returns remainder only", () => {
  const items = Array.from({ length: 7 }, (_, i) => i);
  assert.deepEqual(paginate(items, 5, 1), [5, 6]);
});

test("invalid pageSize (<=0) throws", () => {
  assert.throws(() => paginate([1, 2, 3], 0, 0), /pageSize/);
  assert.throws(() => paginate([1, 2, 3], -1, 0), /pageSize/);
});

test("out-of-range pageIndex returns empty array", () => {
  const items = [1, 2, 3];
  assert.deepEqual(paginate(items, 2, 5), []);
});
