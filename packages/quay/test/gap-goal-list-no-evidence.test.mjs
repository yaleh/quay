// @test-group product
// gap-goal-list-ledger-scan — `goal list --no-evidence` is the LEDGER-FREE projection.
//
// THE COST THIS REMOVES: every `goal list` call used to run `ledgerEvidenceMap(goalDir)` — a full
// scan + per-line JSON.parse of `.quay/gate-events.jsonl` (165MB / 587k rows in this repo, and
// append-only). That cost is ∝ LEDGER SIZE and INDEPENDENT of the goal count, so a consumer that
// only needs goal frontmatter (fleet overview / a status summariser) paid it for nothing.
//
// AC1 — CLI parity: the `--no-evidence` id set equals the full id set, and `evidence` /
//       `staleness` / `lastProgressAt` are ABSENT (checked on parsed JSON, i.e. after the
//       serialisation the AC pins). The control run proves the fixture can produce the difference —
//       all three keys must be PRESENT without the flag (otherwise the absence assertion is vacuous,
//       hard rule 4).
// AC2 — negative control, instrumented: a preload patches `fs.openSync`/`readFileSync`/`readFile`
//       and records every access to THIS workspace's ledger. ⛔ `scanGoalLedger` opens the ledger
//       with `openSync`, not `readFileSync` — patching only the latter would have produced a
//       permanently-empty trace and a vacuous pass.
// AC3 — MCP parity: the Core aggregator's `goal_list` forwards `includeEvidence:false` to the
//       Provider; the id set matches the CLI and the three keys are absent. The same call without
//       the argument carries them (control).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGoalStore } from "../src/core/goal-store.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NATIVE_PROVIDER_DIR = path.resolve(__dirname, "../../quay-native");

const _created = [];
function tmpDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `goal-no-evidence-${tag}-`));
  _created.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of _created) fs.rmSync(dir, { recursive: true, force: true });
});

const GOAL_BODY =
  "goal no-evidence fixture: background, scope, non-goals and exit conditions — long enough to satisfy the 40-char minimum";
const EXPECT = "the expected outcome this criterion proves";
const DERIVED_KEYS = ["evidence", "staleness", "lastProgressAt"];

/**
 * A REAL workspace: `.quay/config.yml` naming the native Provider, a `goals/` store with one GOAL +
 * its AC, and a `gate-events.jsonl` carrying one evidence row for the AC. The ledger row is what
 * the control run (no flag) must surface — without it, "key absent with the flag" would pass for the
 * wrong reason (a ledger with no matching rows also yields no `evidence`).
 */
function seedWorkspace(tag) {
  const root = tmpDir(tag);
  const tasksDir = path.join(root, "tasks");
  const goalsDir = path.join(root, "goals");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });

  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: ${JSON.stringify(NATIVE_PROVIDER_DIR)}`,
      `    tasks_dir: ${JSON.stringify(tasksDir)}`,
      `    mcp_entry: ["node", ${JSON.stringify(QUAY_NATIVE_CLI)}, "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: ${JSON.stringify(tasksDir)}`,
      "",
    ].join("\n"),
    "utf8"
  );

  const store = createGoalStore(goalsDir);
  // AC-first (a GOAL cannot be born into {draft, active} with zero ACs).
  store.write("AC-001", {
    title: "seeded criterion",
    status: "draft",
    goal: "GOAL-001",
    criterion: "true",
    origin: "fixture",
    expect: EXPECT,
  });
  store.write("GOAL-001", {
    title: "seeded goal",
    status: "draft",
    origin: "fixture",
    body: GOAL_BODY,
  });

  // ONE evidence row for the AC: the control run must project it into `evidence` and roll it up into
  // GOAL-001's `lastProgressAt`. Deliberately written AFTER the records so it is unambiguously the
  // derived (never stored) field the option turns off.
  fs.writeFileSync(
    path.join(root, ".quay", "gate-events.jsonl"),
    JSON.stringify({
      gate: "goal",
      pipeline_id: "AC-001",
      timestamp: "2026-10-16T12:00:00.000Z",
      verdict: "pass",
      payload: { reason: "seeded reading" },
    }) + "\n",
    "utf8"
  );

  return { root, ledger: path.join(root, ".quay", "gate-events.jsonl") };
}

function runGoalList(root, args, env = {}) {
  const r = spawnSync("node", [QUAY_CLI, "goal", "list", "--json", "--root", root, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, `goal list ${args.join(" ")} exits 0 (stderr: ${(r.stderr ?? "").slice(0, 500)})`);
  return { stdout: r.stdout ?? "", records: JSON.parse(r.stdout) };
}

const ids = (records) => records.map((g) => String(g.id)).sort();
const hasKey = (record, key) => Object.prototype.hasOwnProperty.call(record, key);

// ── AC1 — CLI parity + key absence (control proves the keys are otherwise there) ─────────────────
test("AC1: `goal list --json --no-evidence` keeps the full id set but drops evidence/staleness/lastProgressAt", () => {
  const { root } = seedWorkspace("ac1");

  const full = runGoalList(root, []);
  const lean = runGoalList(root, ["--no-evidence"]);

  assert.deepEqual(ids(lean.records), ids(full.records), "the no-evidence id set equals the full id set");
  assert.ok(lean.records.length >= 2, `fixture yields both records (got ${JSON.stringify(ids(lean.records))})`);

  for (const g of lean.records) {
    for (const key of DERIVED_KEYS) {
      assert.ok(!hasKey(g, key), `${g.id} carries no \`${key}\` key with --no-evidence (keys: ${Object.keys(g).join(",")})`);
    }
  }
  assert.ok(!/"evidence"\s*:/.test(lean.stdout), "--no-evidence stdout has no serialised evidence key");
  assert.ok(!/"staleness"\s*:/.test(lean.stdout), "--no-evidence stdout has no serialised staleness key");
  assert.ok(!/"lastProgressAt"\s*:/.test(lean.stdout), "--no-evidence stdout has no serialised lastProgressAt key");

  // CONTROL (hard rule 4): without the flag the SAME fixture produces all three keys. If this half
  // stops holding, the assertions above prove nothing about the flag.
  const byId = Object.fromEntries(full.records.map((g) => [String(g.id), g]));
  assert.ok(hasKey(byId["AC-001"], "evidence"), "control: AC-001 carries `evidence` without the flag");
  assert.ok(hasKey(byId["AC-001"], "lastProgressAt"), "control: AC-001 carries `lastProgressAt` without the flag");
  assert.ok(hasKey(byId["GOAL-001"], "staleness"), "control: GOAL-001 carries `staleness` without the flag");
  assert.ok(hasKey(byId["GOAL-001"], "lastProgressAt"), "control: GOAL-001's time is rolled up from its AC");
});

// ── AC2 — the flag is what removes the ledger read (fs-trace negative control) ──────────────────
const TRACE_PRELOAD = `"use strict";
// Records every access (open/read) to QUAY_TRACE_NEEDLE into QUAY_TRACE_FILE. Loaded via
// NODE_OPTIONS=--require, so it runs in the CLI AND in the Provider MCP child it spawns.
const fs = require("node:fs");
const out = process.env.QGNE_TRACE_FILE;
const needle = process.env.QGNE_TRACE_NEEDLE;
if (out && needle) {
  const openSync = fs.openSync;
  const readFileSync = fs.readFileSync;
  const readFile = fs.readFile;
  let writing = false;
  const note = (p) => {
    if (writing) return;
    try {
      if (typeof p === "string" && p.includes(needle)) {
        writing = true;
        fs.appendFileSync(out, p + "\\n");
        writing = false;
      }
    } catch {
      writing = false;
    }
  };
  fs.openSync = function (p, ...rest) { note(p); return openSync.call(this, p, ...rest); };
  fs.readFileSync = function (p, ...rest) { note(p); return readFileSync.call(this, p, ...rest); };
  fs.readFile = function (p, ...rest) { note(p); return readFile.call(this, p, ...rest); };
}
`;

function traceFileHits(traceDir, tag) {
  const p = path.join(traceDir, `${tag}.log`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean) : [];
}

test("AC2: `--no-evidence` performs ZERO reads of .quay/gate-events.jsonl; the unflagged call reads it", () => {
  const { root, ledger } = seedWorkspace("ac2");
  const traceDir = tmpDir("ac2-trace");
  const preload = path.join(traceDir, "trace.cjs");
  fs.writeFileSync(preload, TRACE_PRELOAD, "utf8");

  const traced = (tag, args) => {
    const traceFile = path.join(traceDir, `${tag}.log`);
    const r = spawnSync("node", [QUAY_CLI, "goal", "list", "--json", "--root", root, ...args], {
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: `--require ${preload}`,
        QGNE_TRACE_FILE: traceFile,
        QGNE_TRACE_NEEDLE: ledger,
      },
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `traced goal list ${args.join(" ")} exits 0 (stderr: ${(r.stderr ?? "").slice(0, 500)})`);
    return traceFileHits(traceDir, tag);
  };

  const withFlag = traced("with-flag", ["--no-evidence"]);
  const control = traced("control", []);

  assert.deepEqual(withFlag, [], `--no-evidence touches the ledger ZERO times (hits: ${JSON.stringify(withFlag)})`);
  // Positive control for the INSTRUMENT, not just the flag: the same preload, same workspace, same
  // command WITHOUT the flag must observe the ledger. If this half is empty the trace is broken and
  // the zero above is meaningless (hard rule 4 — a reading that is always zero carries no information).
  assert.ok(control.length > 0, "control: the unflagged call DOES read .quay/gate-events.jsonl (trace non-empty)");
  assert.ok(control.every((h) => h.includes("gate-events.jsonl")), `control hits name the ledger (got ${JSON.stringify(control)})`);
});

// ── AC3 — MCP parity through the Core aggregator ────────────────────────────────────────────────
test("AC3: MCP `goal_list` with includeEvidence:false matches the CLI (id set + the three keys absent)", async () => {
  const { root } = seedWorkspace("ac3");
  const cliLean = runGoalList(root, ["--no-evidence"]);

  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({
    command: "node",
    args: [QUAY_CLI, "mcp"],
    cwd: root,
    env: process.env,
  });
  const client = new Client({ name: "goal-no-evidence-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const lean = await client.callTool({ name: "goal_list", arguments: { includeEvidence: false } });
    assert.ok(lean.structuredContent, `MCP goal_list structuredContent present (got ${JSON.stringify(lean).slice(0, 300)})`);
    const mcpLean = lean.structuredContent.goals;
    assert.deepEqual(ids(mcpLean), ids(cliLean.records), "MCP includeEvidence:false id set matches the CLI --no-evidence id set");
    for (const g of mcpLean) {
      for (const key of DERIVED_KEYS) {
        assert.ok(!hasKey(g, key), `MCP ${g.id} carries no \`${key}\` with includeEvidence:false`);
      }
    }

    // Same closure as AC1's control: the argument, not the fixture, is what removed the keys.
    const full = await client.callTool({ name: "goal_list", arguments: {} });
    const mcpFull = full.structuredContent.goals;
    const byId = Object.fromEntries(mcpFull.map((g) => [String(g.id), g]));
    assert.ok(hasKey(byId["AC-001"], "evidence"), "MCP control: AC-001 carries `evidence` without includeEvidence:false");
    assert.ok(hasKey(byId["GOAL-001"], "staleness"), "MCP control: GOAL-001 carries `staleness` without includeEvidence:false");
  } finally {
    await client.close();
  }
});
