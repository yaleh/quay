import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords } from "./wordcount.mjs";

test("empty string has 0 words", () => {
  assert.equal(countWords(""), 0);
});

test("single word has 1 word", () => {
  assert.equal(countWords("hello"), 1);
});

test("multiple words with extra whitespace", () => {
  assert.equal(countWords("  hello   world  foo "), 3);
});

test("newlines act as separators", () => {
  assert.equal(countWords("hello\nworld\n\nfoo"), 3);
});
