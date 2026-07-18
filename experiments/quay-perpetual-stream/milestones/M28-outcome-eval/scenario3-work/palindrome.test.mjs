import { test } from "node:test";
import assert from "node:assert/strict";
import { isPalindrome } from "./palindrome.mjs";

test("empty string is a palindrome", () => assert.equal(isPalindrome(""), true));
test("single char is a palindrome", () => assert.equal(isPalindrome("a"), true));
test("even-length palindrome", () => assert.equal(isPalindrome("abba"), true));
test("odd-length palindrome", () => assert.equal(isPalindrome("abcba"), true));
test("non-palindrome", () => assert.equal(isPalindrome("abc"), false));
