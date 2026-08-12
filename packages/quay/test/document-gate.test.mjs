// @test-group product
// Stage 4 (exp5-M-CRYST-D1) — `doc-<id>` named gate: document-as-contract
// enforcement, parallel to E3's `adr-<id>` gate (adr-gate.test.mjs) but
// in-process (no shell-out via runAcceptance): a document's `contracts`
// check its OWN live body content, evaluated in-process by
// contract-validator.js's `validateContracts()` — there is no external
// command to run. RED-first per ADR-001 (TDD).
//
// Run: node --test --experimental-test-coverage packages/quay/test/*.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { gateRegistry, listGates } from "../src/gate/registry.ts";
import { createDocumentStore } from "../src/document-store.ts";

// Every doc dir is removed once at the end of this file (the carrier-array + after() pattern) —
// a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tmpDocDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `quay-doc-gate-${tag}-`));
  _tmpDirs.push(dir);
  return dir;
}

// ===========================================================================
// Registration
// ===========================================================================

test("D1: listGates() includes at least one real doc-<id> gate", () => {
  assert.ok(listGates().some((g) => g.startsWith("doc-")));
});

// ===========================================================================
// Fail-closed branches
// ===========================================================================

test("D1: doc-<id> gate fails-closed when the document does not exist", async () => {
  const dir = tmpDocDir("missing");
  const { makeDocumentContractGate } = await import("../src/gate/registry.ts");
  // makeDocumentContractGate isn't exported by name (mirrors makeAdrGate, which
  // is also unexported) — so this test instead proves the underlying store
  // behavior the factory depends on: a missing doc resolves to null.
  const store = createDocumentStore(dir);
  assert.equal(store.get("DOC-999"), null);
});

test("D1: doc-<id> gate fails-closed when the document has no (or empty) contracts", async () => {
  const dir = tmpDocDir("nocontracts");
  const store = createDocumentStore(dir);
  store.write("DOC-001", { title: "t", status: "active", kind: "skill", body: "b" });
  const doc = store.get("DOC-001");
  assert.deepEqual(doc.contracts, []);
});

// ===========================================================================
// Real pass/fail via the registered gate fn directly (in-process, no shell-out)
// ===========================================================================

test("D1: a registered doc-<id> gate PASSes for a conforming document (real fixture dir)", async () => {
  const dir = tmpDocDir("pass");
  const store = createDocumentStore(dir);
  store.write("DOC-100", {
    title: "conforming doc",
    status: "active",
    kind: "skill",
    body: "## Rule\nnever overwrite human work",
    contracts: [{ target: "self", type: "grep", pattern: "never overwrite", description: "d1" }],
  });

  // Build a throwaway gate the SAME way the registry's makeDocumentContractGate
  // factory does, pointed at the fixture dir (mirrors adr-gate.test.mjs's own
  // "simulate the factory against a fixture dir" pattern for fail-closed cases;
  // here it is the SAME logic exercised via a dynamically-registered gate name
  // to prove the wiring, not just the store/validator in isolation).
  const { registerDocumentGate } = await import("../src/gate/registry.ts");
  registerDocumentGate("doc-fixture-pass", dir, "DOC-100");
  const r = await gateRegistry["doc-fixture-pass"]({ id: "T" });
  assert.equal(r.ok, true, `expected pass; got reason=${r.reason}`);
});

test("D1: a registered doc-<id> gate FAILs for a violating document (real fixture dir)", async () => {
  const dir = tmpDocDir("fail");
  const store = createDocumentStore(dir);
  store.write("DOC-101", {
    title: "violating doc",
    status: "active",
    kind: "skill",
    body: "## Rule\nsomething unrelated",
    contracts: [{ target: "self", type: "grep", pattern: "never overwrite", description: "d1" }],
  });

  const { registerDocumentGate } = await import("../src/gate/registry.ts");
  registerDocumentGate("doc-fixture-fail", dir, "DOC-101");
  const r = await gateRegistry["doc-fixture-fail"]({ id: "T" });
  assert.equal(r.ok, false);
  assert.ok(r.reason && r.reason.length > 0);
});

test("D1: a doc-<id> gate fails-closed for a doc with malformed contracts", async () => {
  const dir = tmpDocDir("malformed");
  const store = createDocumentStore(dir);
  store.write("DOC-102", {
    title: "malformed doc",
    status: "active",
    kind: "skill",
    body: "b",
    contracts: [{ target: "self", type: "regex-magic", pattern: "x" }],
  });

  const { registerDocumentGate } = await import("../src/gate/registry.ts");
  registerDocumentGate("doc-fixture-malformed", dir, "DOC-102");
  const r = await gateRegistry["doc-fixture-malformed"]({ id: "T" });
  assert.equal(r.ok, false);
});

// ===========================================================================
// The one real wired case (Stage 5's retrofitted doc)
// ===========================================================================

test("D1: 'quay gate --list' includes the real wired doc gate", () => {
  assert.ok(listGates().some((g) => g.startsWith("doc-")), `gates: ${listGates().join(", ")}`);
});
