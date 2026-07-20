// ts-demo-word-count.test.ts — ADR-012 P0 (exp5-M-TS-MIGRATION-P0) demonstrator
// test, TDD RED-before-GREEN (ADR-001): proves `node --test` runs a `.test.ts`
// file directly under Node 25 native type-stripping, no build step, exercising
// a trivial `.ts` leaf module (ts-demo/word-count.ts) — no product behavior
// touched (this is a brand-new, standalone module, not a rewrite of existing
// JS). See ts-demo/word-count.ts for the module under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordCount } from "../src/ts-demo/word-count.ts";

test("wordCount counts space-separated words", () => {
  assert.equal(wordCount("hello world"), 2);
});

test("wordCount trims + collapses extra whitespace", () => {
  assert.equal(wordCount("  hello   world  foo "), 3);
});

test("wordCount returns 0 for empty/whitespace-only input", () => {
  assert.equal(wordCount(""), 0);
  assert.equal(wordCount("   "), 0);
});
