// @test-group product
// Stage 5 (exp5-M-CRYST-D1) — proves the doc-<id> gate's FAIL path end-to-end
// against a REAL synthetic violating document fixture (never a real doc
// deliberately broken — see experiments/quay-perpetual-stream/fixtures/
// document-contracts/violating-doc.md's own header comment), mirroring
// adr-gate.test.mjs's own conforming/violating fixture-pinned pattern (E3).
//
// Run: node --test --experimental-test-coverage packages/quay/test/*.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { gateRegistry, registerDocumentGate } from "../src/gate/registry.ts";
import { createDocumentStore } from "../src/document-store.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = QUAY_CLI;
// repo root: packages/quay/test -> repo root is 3 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const VIOLATING_FIXTURE = path.join(
  REPO_ROOT,
  "experiments/quay-perpetual-stream/fixtures/document-contracts/violating-doc.md"
);

function loadFixtureIntoTmpDocsDir() {
  const dir = makeTmpDir("quay-doc-gate-fixture-");
  fs.copyFileSync(VIOLATING_FIXTURE, path.join(dir, "DOC-999-violating.md"));
  return dir;
}

test("D1 A(Stage5): the synthetic violating document fixture round-trips as expected via document-store.js", () => {
  const dir = loadFixtureIntoTmpDocsDir();
  const store = createDocumentStore(dir);
  const doc = store.get("DOC-999");
  assert.ok(doc, "expected the fixture to load");
  assert.equal(doc.status, "active");
  assert.equal(doc.contracts.length, 1);
  assert.equal(doc.contracts[0].type, "grep");
});

test("D1 A(Stage5): a doc-<id> gate registered against the violating fixture FAILs (real object, real gate fn)", async () => {
  const dir = loadFixtureIntoTmpDocsDir();
  registerDocumentGate("doc-fixture-violating-e2e", dir, "DOC-999");
  const r = await gateRegistry["doc-fixture-violating-e2e"]({ id: "T" });
  assert.equal(r.ok, false, `expected FAIL; got reason=${r.reason}`);
  assert.match(r.reason, /deliberately absent/);
});

test("D1 A(Stage5): 'quay gate <fixture-task> --gate doc-quay-directive-skill' exits 0 end-to-end against the REAL retrofitted doc (real CLI, real GateEvent)", () => {
  // DOCUMENTS_DIR is a fixed repo-root constant (mirrors ADR_DIR — no
  // per-test env override, by design), so the CLI-level end-to-end proof
  // runs against the REAL wired case (Stage 5's retrofitted quay-directive
  // skill doc, already proven conforming above) — the exact same shape
  // adr-gate.test.mjs's own CLI end-to-end test uses (real repo, real ADR).
  // The FAIL direction is proven above (previous test) directly against the
  // gate fn on a REAL synthetic violating document object — `engine.js`'s CLI
  // handler maps a gateFn's `ok:false` to `process.exitCode = 1` uniformly
  // for every gate (already covered generically by gate.test.mjs), so a
  // second CLI-level FAIL round-trip would not exercise any additional code
  // path this gate's own wiring owns.
  const fixtureId = "T-doc-gate-e2e-fixture";
  const realTasksDir = path.join(REPO_ROOT, "tasks");
  const fixturePath = path.join(realTasksDir, `${fixtureId}.md`);
  const logDir = makeTmpDir("quay-doc-cli-e2e-log-");
  const logFile = path.join(logDir, "gate-events.jsonl");
  fs.writeFileSync(
    fixturePath,
    `---\nid: ${fixtureId}\ntitle: fixture task\nstatus: todo\nlabels: []\nparent: null\nchildren: []\n---\nbody\n`
  );
  try {
    const r = execFileSync(
      "node",
      [quayBin, "gate", fixtureId, "--gate", "doc-quay-directive-skill", "--file", logFile],
      { encoding: "utf8", cwd: REPO_ROOT }
    );
    assert.match(r, /PASS/);
    const logOut = execFileSync(
      "node",
      [quayBin, "gate-log", fixtureId, "--json", "--file", logFile],
      { encoding: "utf8", cwd: REPO_ROOT }
    );
    const events = JSON.parse(logOut);
    assert.equal(events.length, 1);
    assert.equal(events[0].gate, "doc-quay-directive-skill");
    assert.equal(events[0].verdict, "pass");
  } finally {
    fs.rmSync(fixturePath, { force: true });
  }
});
