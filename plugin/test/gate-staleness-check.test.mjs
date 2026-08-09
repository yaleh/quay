// @test-group engine
// gate-staleness-check.test.mjs — tasks/gap-spec-goal-store-third-sibling-kind, SPEC §7 risk 1:
// the gate engine was ~24h idle, and a mechanism that isn't running is indistinguishable from one
// that passes. AC status hung on a SILENT gate would show a collective false green. This test pins
// the mechanical "最近一次执行时刻 vs 声称周期" signal: plugin/scripts/gate-staleness-check.sh.
//
// Coverage map (task AC7 + Contract):
//   AC7 — gate ledger check: the probe reads .quay/gate-events.jsonl, takes the most recent event
//         timestamp, and reports when it is older than the claimed period (--timeout).
//   Contract measure — `bash plugin/scripts/gate-staleness-check.sh --json` exits 0 fresh /
//         1 stale / 2 usage-error and emits { last_gate_event_at, age_seconds, signal, ... }.
//   Contract invariant gate_staleness_reported — a gate that stopped running IS reported (stale or
//         ledger missing/never-ran both fire), never a silent green.
//   Negative control — a fresh ledger (recent timestamp within --timeout) exits 0 silent.
//   The goal gate runner appends events in the SAME format this probe reads (SPEC §3 reuse).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CHECK = join(repoRoot, "plugin", "scripts", "gate-staleness-check.sh");

function run(args, opts = {}) {
  const res = spawnSync("bash", [CHECK, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeWorkspace(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `gate-stale-${prefix}-`));
  mkdirSync(join(dir, ".quay"), { recursive: true });
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function writeLedger(root, lines) {
  if (lines.length === 0) return;
  writeFileSync(join(root, ".quay", "gate-events.jsonl"), lines.join("\n") + "\n", "utf8");
}

// A GateEvent in the EXACT shape the gate engine appends (goal gate included).
function eventLine(ts, verdict = "pass", id = "AC-028", gate = "goal") {
  return JSON.stringify({
    id: `u-${ts}`, item_id: id, pipeline_id: id, gate, actor: "goal-cli",
    verdict, timestamp: ts, payload: { reason: "x" },
  });
}

// ── AC7: stale ledger (older than --timeout) ⇒ exit 1 + WARN ──────────────────────────────────────

test("AC7 — a gate ledger whose last event is older than --timeout fires the stale signal", () => {
  const w = makeWorkspace("stale");
  try {
    const oldTs = new Date(Date.now() - 5000).toISOString();
    writeLedger(w, [eventLine(oldTs)]);
    const r = run(["--root", w, "--timeout", "1"]);
    assert.equal(r.status, 1, `stale must exit 1:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /GATE-STALE-WARN/);
    assert.match(r.stdout, /older than|claimed period/);
  } finally { cleanup(w); }
});

// ── AC7: ledger MISSING / gate never ran ⇒ signal (the 24h-silent defect class) ───────────────────

test("AC7 — a MISSING gate ledger (gate never ran) fires the signal", () => {
  const w = makeWorkspace("never");
  const r = run(["--root", w, "--timeout", "1"]);
  assert.equal(r.status, 1, `missing-ledger must exit 1:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /GATE-STALE-WARN/);
  assert.match(r.stdout, /never run|empty\/missing/);
});

// ── Negative control: fresh ledger ⇒ exit 0 silent ────────────────────────────────────────────────

test("negative control — a fresh gate ledger (within --timeout) exits 0 silent", () => {
  const w = makeWorkspace("fresh");
  try {
    const freshTs = new Date(Date.now() - 5).toISOString();
    writeLedger(w, [eventLine(freshTs)]);
    const r = run(["--root", w, "--timeout", "3600"]);
    assert.equal(r.status, 0, `fresh must exit 0:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /GATE-STALE-WARN/);
    assert.match(r.stdout, /ok/);
  } finally { cleanup(w); }
});

// ── Contract measure: --json reports the shape, never mutates, and the exit code IS the signal ────

test("Contract measure — --json reports last_gate_event_at/age_seconds/signal and never mutates", () => {
  const w = makeWorkspace("json");
  try {
    // stale ledger → --json exits 1 with signal=true
    const oldTs = new Date(Date.now() - 5000).toISOString();
    writeLedger(w, [eventLine(oldTs)]);
    const stale = run(["--root", w, "--timeout", "1", "--json"]);
    assert.equal(stale.status, 1, `stale --json must exit 1:\n${stale.stdout}${stale.stderr}`);
    const j = JSON.parse(stale.stdout);
    assert.equal(j.last_gate_event_at, oldTs);
    assert.ok(j.age_seconds > 1, "age exceeds timeout");
    assert.equal(j.gate_stale, true);
    assert.equal(j.signal, true);

    // fresh ledger → --json exits 0 with signal=false
    const freshTs = new Date(Date.now() - 5).toISOString();
    writeLedger(w, [eventLine(freshTs)]);
    const fresh = run(["--root", w, "--timeout", "3600", "--json"]);
    assert.equal(fresh.status, 0, `fresh --json must exit 0:\n${fresh.stdout}${fresh.stderr}`);
    const j2 = JSON.parse(fresh.stdout);
    assert.equal(j2.last_gate_event_at, freshTs);
    assert.equal(j2.signal, false);

    // --json never mutates the ledger (file content unchanged, no trace side-file).
    const ledgerPath = join(w, ".quay", "gate-events.jsonl");
    assert.equal(existsSync(ledgerPath), true);
    assert.match(readFileSync(ledgerPath, "utf8"), new RegExp(freshTs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { cleanup(w); }
});

// ── Usage / environment errors exit 2 ─────────────────────────────────────────────────────────────

test("usage/environment errors exit 2 (bad timeout, unknown arg, not a workspace)", () => {
  const w = makeWorkspace("err");
  try {
    const badTimeout = run(["--root", w, "--timeout", "abc"]);
    assert.equal(badTimeout.status, 2, "--timeout must be numeric");
    assert.match(badTimeout.stderr, /--timeout/);

    const badArg = run(["--root", w, "--bogus"]);
    assert.equal(badArg.status, 2, "unknown argument must exit 2");
    assert.match(badArg.stderr, /unknown argument/);

    const notAWorkspace = join(w, "empty");
    mkdirSync(notAWorkspace, { recursive: true });
    const noQuay = run(["--root", notAWorkspace]);
    assert.equal(noQuay.status, 2, "not-a-workspace (no .quay/) must exit 2");
  } finally { cleanup(w); }
});
