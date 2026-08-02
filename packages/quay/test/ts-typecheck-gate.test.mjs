// @test-group product
// ts-typecheck-gate.test.mjs — ADR-012 P0 (exp5-M-TS-MIGRATION-P0): the
// `tsc --noEmit` type gate, wired as a `testPass` entry in the workspace's
// gates config (DIR-120: `.quay/config.yml`'s own `gates:` section for THIS
// repo; a legacy `.quay/gates.yml` only for a workspace with no
// `config.yml`) — DIR-042-A's `makeTestPassGate` factory (REUSED, not a new
// factory, per ADR-013 data-driven-gates discipline: the actual
// `npx tsc --noEmit` invocation is workspace data, never hardcoded in
// packages/quay/src/**). Mirrors delivery-standalone-smoke-gate.test.mjs's
// shape (real script/command invocation via resolveGate, real CLI path via
// `quay gate <task> --gate ...`, and a D1-style check against THIS repo's
// own real gates wiring).
//
// Run: node --test packages/quay/test/*.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

import { resolveGate, listGates } from "../src/gate/registry.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quayBin = path.join(__dirname, "..", "bin", "quay.ts");
// repo root: packages/quay/test -> repo root is 3 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const gate = (name) => resolveGate(name, REPO_ROOT);

function runQuay(args, cwd, extraEnv = {}) {
  try {
    const out = execFileSync("node", [quayBin, ...args], {
      encoding: "utf8",
      cwd,
      env: { ...process.env, ...extraEnv },
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

// ===========================================================================
// A1 — listGates() + real command invocation (against THIS repo's own workspace).
// ===========================================================================

test("M63 A1: listGates() includes 'ts-typecheck'", () => {
  assert.ok(listGates(REPO_ROOT).includes("ts-typecheck"));
});

test("M63 A2: ts-typecheck gate PASSes for real against THIS repo's own root tsconfig.json (real `npx tsc --noEmit`, real process I/O)", async () => {
  const r = await gate("ts-typecheck")({ id: "T", extra: {} });
  assert.equal(r.ok, true, `expected pass (tsc --noEmit green); got reason=${r.reason}`);
}, { timeout: 120000 });

// ===========================================================================
// C1 — real CLI path: `quay gate <task> --gate ts-typecheck` against THIS repo.
// ===========================================================================

test("M63 C1: `quay gate --list` includes 'ts-typecheck'", () => {
  const r = runQuay(["gate", "--list"], REPO_ROOT);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.split("\n").includes("ts-typecheck"), `got: ${r.stdout}`);
});

test("M63 C1: `quay gate <task> --gate ts-typecheck` PASSes for real against this repo and appends a real GateEvent", () => {
  const logFile = path.join(fs.mkdtempSync(path.join(REPO_ROOT, ".quay-tmp-test-")), "g.jsonl");
  try {
    const r = runQuay(
      ["gate", "exp5-M-TS-MIGRATION-P0", "--gate", "ts-typecheck", "--file", logFile],
      REPO_ROOT
    );
    assert.equal(r.status, 0, `expected PASS; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
    assert.match(r.stdout, /PASS/);

    const log = runQuay(["gate-log", "exp5-M-TS-MIGRATION-P0", "--json", "--file", logFile], REPO_ROOT);
    assert.equal(log.status, 0);
    const events = JSON.parse(log.stdout);
    assert.equal(events.length, 1);
    assert.equal(events[0].gate, "ts-typecheck");
    assert.equal(events[0].verdict, "pass");
  } finally {
    fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
  }
}, { timeout: 120000 });

// ===========================================================================
// D1 — real-world demonstration against THIS repo's own real gates wiring
// (the exact same source the real OUTER-LOOP ABSORB gates against), not a fixture copy.
//
// DIR-120 Phase 2 (2026-07-28): root `.quay/gates.yml` has been physically
// deleted and its reader fallback removed — `.quay/config.yml`'s own
// `gates:` section is now the ONLY source THIS workspace's readers can
// resolve gates from (see loader.ts's own doc comment). This test's ground
// truth moves with it: the "real wiring" this test demonstrates against is
// now config.yml, not a legacy gates.yml that no longer exists here.
// ===========================================================================

test("M63 D1: ts-typecheck gate PASSes against THIS repo's own real .quay/config.yml gates: wiring", async () => {
  const realConfigYml = path.join(REPO_ROOT, ".quay", "config.yml");
  assert.ok(fs.existsSync(realConfigYml), "real .quay/config.yml must exist in this worktree");
  const content = fs.readFileSync(realConfigYml, "utf8");
  assert.match(content, /ts-typecheck/, "real config.yml's gates: section must declare the ts-typecheck testPass gate");
  const r = await gate("ts-typecheck")({ id: "exp5-M-TS-MIGRATION-P0" });
  assert.equal(r.ok, true, `expected pass against this repo's real workspace; got reason=${r.reason}`);
}, { timeout: 120000 });
