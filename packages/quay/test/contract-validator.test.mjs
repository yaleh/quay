// @test-group product
// Stage 3 (exp5-M-CRYST-D1) — single-source contract validator: the load-
// bearing piece that actually EVALUATES a document's `contracts:` self-
// assertions (document-store.js round-trips them verbatim; this module reads
// them). RED-first per ADR-001 (TDD).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateContracts } from "../src/contract-validator.ts";

test("no contracts -> ok:true, empty results", () => {
  const doc = { body: "anything" };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, true);
  assert.deepEqual(results, []);
});

test("contracts absent entirely (undefined) -> ok:true, empty results", () => {
  const { ok, results } = validateContracts({ body: "x" });
  assert.equal(ok, true);
  assert.deepEqual(results, []);
});

test("grep: pattern present in body -> that assertion passes", () => {
  const doc = {
    body: "## Rule\nnever overwrite human work",
    contracts: [{ target: "self", type: "grep", pattern: "never overwrite", description: "d1" }],
  };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, true);
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].pattern, "never overwrite");
  assert.equal(results[0].type, "grep");
  assert.equal(results[0].description, "d1");
});

test("grep: pattern absent from body -> that assertion fails, overall ok:false", () => {
  const doc = {
    body: "## Rule\nsomething else",
    contracts: [{ target: "self", type: "grep", pattern: "never overwrite", description: "d1" }],
  };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, false);
  assert.equal(results[0].ok, false);
});

test("not-grep: pattern absent from body -> that assertion passes", () => {
  const doc = {
    body: "## Rule\nclean",
    contracts: [{ target: "self", type: "not-grep", pattern: "TODO", description: "d2" }],
  };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, true);
  assert.equal(results[0].ok, true);
});

test("not-grep: pattern present in body -> that assertion fails, overall ok:false", () => {
  const doc = {
    body: "## Rule\nTODO: fix this",
    contracts: [{ target: "self", type: "not-grep", pattern: "TODO", description: "d2" }],
  };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, false);
  assert.equal(results[0].ok, false);
});

test("multiple contracts: overall ok is AND of all individual results", () => {
  const doc = {
    body: "## Rule\nnever overwrite human work",
    contracts: [
      { target: "self", type: "grep", pattern: "never overwrite", description: "pass" },
      { target: "self", type: "not-grep", pattern: "never overwrite", description: "fail-by-design" },
    ],
  };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, false);
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
});

test("malformed entry: unknown type fails closed with a reason citing it", () => {
  const doc = {
    body: "x",
    contracts: [{ target: "self", type: "regex-magic", pattern: "x", description: "bad" }],
  };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, false);
  assert.equal(results[0].ok, false);
  assert.match(results[0].reason, /unknown contract type/);
});

test("malformed entry: target other than 'self' fails closed (Stage 3 scope is self-only)", () => {
  const doc = {
    body: "x",
    contracts: [{ target: "other-doc", type: "grep", pattern: "x", description: "bad" }],
  };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, false);
  assert.match(results[0].reason, /unsupported contract target/);
});

test("malformed entry: missing pattern fails closed", () => {
  const doc = {
    body: "x",
    contracts: [{ target: "self", type: "grep", description: "no pattern" }],
  };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, false);
  assert.match(results[0].reason, /missing.*pattern/i);
});

test("contracts is not an array -> fails closed at the top level", () => {
  const doc = { body: "x", contracts: "not-an-array" };
  const { ok, results } = validateContracts(doc);
  assert.equal(ok, false);
  assert.equal(results.length, 1);
  assert.match(results[0].reason, /contracts must be an array/);
});
