// @test-group engine
// inner-idle-log.test.mjs — outer correction 2026-08-03T02:45:03Z (idle instrumentation):
// RED/GREEN tests for the append-only idle-reason log. Distinct from inner-blocked-signal —
// a block signal means "inner is stopped waiting for an outer ruling" (one meaning); an idle
// turn is waiting for its OWN loop and must NOT touch the block file (it would wake the outer
// on every turn end and block un-halt). This log is the silent, append-only channel for it.
//
// Covers: AC1 reason vocabulary (exactly the outer's five), AC2 append writes an ISO `at` line
// with no duration field, AC3 invalid reason fails closed (nothing appended), AC4 append-only
// ordering + per-reason counts (no-reason counted), AC5 gitignored, AC6 @test-group engine.
//
// Run:
//   scripts/test.sh plugin/test/inner-idle-log.test.mjs
//   node --test plugin/test/inner-idle-log.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "plugin", "scripts", "inner-idle-log.ts");

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inner-idle-"));
}

function cleanup(tmpRoot) {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runCli(tmpRoot, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", tmpRoot, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

async function importCli() {
  return import(CLI);
}

const LOG = (root) => path.join(root, "orchestration", "inner-idle-log.jsonl");

// ── AC1: reason vocabulary = exactly the outer's five ───────────────────────────────────────────────

test("AC1 — VALID_IDLE_REASONS is exactly the outer's five idle reasons", async () => {
  const cli = await importCli();
  assert.deepEqual([...cli.VALID_IDLE_REASONS].sort(), [
    "awaiting-ruling",
    "awaiting-subagent",
    "no-reason",
    "queue-empty",
    "rate-limited",
  ].sort(), "awaiting-subagent / queue-empty / awaiting-ruling / rate-limited / no-reason");
  // The outer's contract: no-reason is the fallback, and its COUNT is the next round's target.
  assert.ok(cli.VALID_IDLE_REASONS.includes("no-reason"));
});

// ── AC2: append writes a valid JSONL line, ISO at, no duration ──────────────────────────────────────

test("AC2 — --append writes {at, reason, note} with ISO `at` and NO duration field", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, "--append", "--reason", "awaiting-subagent", "--note", "waiting for dispatch-gate");
    assert.equal(res.status, 0, `append should exit 0, got ${res.status}\nstderr: ${res.stderr}`);

    const p = LOG(tmp);
    assert.ok(fs.existsSync(p), `log must exist at ${p}`);
    const lines = fs.readFileSync(p, "utf8").trim().split("\n");
    assert.equal(lines.length, 1, "exactly one line appended");
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.reason, "awaiting-subagent");
    assert.equal(rec.note, "waiting for dispatch-gate");
    assert.ok(typeof rec.at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(rec.at), `at must be ISO 8601 string, got ${rec.at}`);
    assert.ok(!("durationMs" in rec) && !("since" in rec), "idle entry must NOT carry a duration (outer computes it from transcript gaps)");
  } finally {
    cleanup(tmp);
  }
});

// ── AC3: invalid reason fails closed ────────────────────────────────────────────────────────────────

test("AC3 — --append rejects a reason outside the five (fail-closed, nothing written)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, "--append", "--reason", "turn-ended-idle", "--note", "legacy value");
    assert.notEqual(res.status, 0, "a non-vocabulary reason must fail closed");
    assert.match(res.stderr, /invalid reason|awaiting-subagent/, `stderr should name the problem: ${res.stderr}`);
    assert.ok(!fs.existsSync(LOG(tmp)), "nothing must be written on a rejected reason");
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — missing --note fails closed (usage), nothing written", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, "--append", "--reason", "queue-empty");
    assert.notEqual(res.status, 0);
    assert.ok(!fs.existsSync(LOG(tmp)), "nothing must be written on a malformed --append");
  } finally {
    cleanup(tmp);
  }
});

// ── AC4: append-only ordering + per-reason counts ──────────────────────────────────────────────────

test("AC4 — append preserves order; --counts tallies per reason (no-reason included)", () => {
  const tmp = makeTmpWorkspace();
  try {
    runCli(tmp, "--append", "--reason", "awaiting-subagent", "--note", "first");
    runCli(tmp, "--append", "--reason", "no-reason", "--note", "second");
    runCli(tmp, "--append", "--reason", "no-reason", "--note", "third");
    runCli(tmp, "--append", "--reason", "queue-empty", "--note", "fourth");

    // Order preserved (append-only): lines appear in the order appended.
    const read = runCli(tmp, "--read");
    assert.equal(read.status, 0, read.stderr);
    const recs = read.stdout.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(recs.map((r) => r.reason), [
      "awaiting-subagent", "no-reason", "no-reason", "queue-empty",
    ], "read must return entries in append order");

    const counts = runCli(tmp, "--counts");
    assert.equal(counts.status, 0, counts.stderr);
    const tally = Object.fromEntries(counts.stdout.trim().split("\n").map((l) => {
      const [r, n] = l.split("\t");
      return [r, Number(n)];
    }));
    assert.equal(tally["awaiting-subagent"], 1);
    assert.equal(tally["no-reason"], 2);
    assert.equal(tally["queue-empty"], 1);
    assert.equal(tally["awaiting-ruling"], 0);
    assert.equal(tally["rate-limited"], 0);
    // All five reasons present in the tally (no-reason's count is the next round's target).
    assert.equal(Object.keys(tally).length, 5);
  } finally {
    cleanup(tmp);
  }
});

// ── AC5: the log path is gitignored (raw data, same family as .workflow-events/) ───────────────────

test("AC5 — .gitignore contains orchestration/inner-idle-log.jsonl", () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /orchestration\/inner-idle-log\.jsonl/, ".gitignore must ignore the idle log");
});
