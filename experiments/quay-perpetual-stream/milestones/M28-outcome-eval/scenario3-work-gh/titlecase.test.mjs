import { test } from "node:test";
import assert from "node:assert/strict";
import { titleCase } from "./titlecase.mjs";

test("empty string", () => assert.equal(titleCase(""), ""));
test("single word", () => assert.equal(titleCase("hello"), "Hello"));
test("multiple words", () => assert.equal(titleCase("hello world"), "Hello World"));
test("already-capitalized input", () => assert.equal(titleCase("Hello World"), "Hello World"));
