// @test-group product
// ts-typecheck-gate-cli-event.test.mjs — split out of ts-typecheck-gate.test.mjs
// (gap-suite-split-long-multi-test-files): M63 C1 — `quay gate <task> --gate ts-typecheck` PASSes
// for real against this repo and appends a real GateEvent. The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it. SPLIT CONCURRENCY SAFETY: the GateEvent log lives in a per-file mkdtemp path, so no sibling
// file can collide.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { runQuay, REPO_ROOT } from "./ts-typecheck-gate-helpers.mjs";

test("M63 C1: `quay gate <task> --gate ts-typecheck` PASSes for real against this repo and appends a real GateEvent", () => {
  const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "quay-ts-typecheck-gate-")), "g.jsonl");
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
