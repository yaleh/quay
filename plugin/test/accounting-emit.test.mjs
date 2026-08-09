// @test-group governance
// accounting-emit.test.mjs — the UNIFIED FOUR-TUPLE emitter
// (orchestration/SPEC-three-layer-unified-architecture-2026-08-09.md §2.5,
//  task gap-spec-p2-quad-tuple-unified-emitter).
//
// Pins the four-tuple emitter all three layers (outer/inner/manager) use to report their ledger:
//   Contract measure — `node plugin/scripts/accounting-emit.ts --layer <layer> --json` 的 stdout
//     field set:
//   band   — the three layers' JSON field set is IDENTICAL (same schema) — the unified format.
//   invariant quad_tuple_no_missing = 1 — any tuple field missing ⇒ mechanically reported
//     (`missing` names it, `complete` false, exit 1). 缺值 = 未执行.
//   invariant layer_exec_time_readable = 1 — the emitter reports
//     `mechanisms.exec_time_unreadable` when NO mechanism of the layer has a readable last real exec
//     time (the AC4 "每层「最近真实执行时刻」A 项可读" check).
//   AC4 — a mechanism with a judgement (已停用/已替代/是缺陷) is ACCOUNTED FOR even if never-run.
//   AC5 — on-disk trace auto-read: outer's `.quay/closure-pass-last-run.json` /
//     `.quay/verification-round.jsonl` / `.quay/full-suite-state.json` supply last real exec times.
//
// Run:
//   scripts/test.sh plugin/test/accounting-emit.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EMITTER = path.join(REPO_ROOT, "plugin", "scripts", "accounting-emit.ts");

function run(args = [], opts = {}) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", EMITTER, ...args],
    { encoding: "utf8", ...opts }
  );
}

function jsonRun(args = []) {
  const r = run([...args, "--json"]);
  assert.ok(r.stdout, `accounting-emit must produce stdout:\n${r.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    assert.fail(`accounting-emit --json must be valid JSON:\n${r.stdout}\n${e.message}`);
  }
  return { parsed, status: r.status };
}

const LAYERS = ["outer", "inner", "manager"];
const JUDGEMENTS = ["已停用", "已替代", "是缺陷"];

function tmpRoot(prefix = "accounting-emit-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── Contract band: three layers emit the SAME field set (unified schema) ─────────────────────────────
test("band — outer/inner/manager emit the same top-level + occupancy + mechanism-entry field set (unified_emitter_format)", () => {
  const now = Math.floor(Date.now() / 1000);
  const runs = LAYERS.map((layer) =>
    jsonRun([
      "--layer", layer,
      "--in-flight", "1",
      "--cap", "3",
      "--write-target", "integration",
      "--no-registry",
      "--mechanism", `m1:${now - 60}`,
      "--mechanism", `m2:${now - 120}:已停用`,
    ]).parsed
  );
  // Top-level key set identical across the three layers.
  const topKeys = runs[0] ? Object.keys(runs[0]).sort() : [];
  for (const p of runs) {
    assert.deepEqual(Object.keys(p).sort(), topKeys, `top-level field set identical for ${p.layer}`);
    assert.equal(p.schema_version, "quad-tuple/v1", "schema version carried");
    // Four tuple elements always present as keys (① ② ③ ④) — the band contract.
    for (const k of ["mechanisms", "occupancy", "write_target", "ledger_line"]) {
      assert.ok(k in p, `tuple element ${k} present for ${p.layer}`);
    }
  }
  // occupancy key set identical.
  const occKeys = Object.keys(runs[0].occupancy).sort();
  for (const p of runs) {
    assert.deepEqual(Object.keys(p.occupancy).sort(), occKeys, `occupancy field set identical for ${p.layer}`);
  }
  // mechanism-entry key set identical.
  const mechKeys = Object.keys(runs[0].mechanisms[0]).sort();
  for (const p of runs) {
    for (const m of p.mechanisms) {
      assert.deepEqual(Object.keys(m).sort(), mechKeys, `mechanism-entry field set identical for ${p.layer}`);
    }
  }
});

// ── ① ② ③ ④ complete four-tuple (all fields readable) ────────────────────────────────────────────────
test("complete — a fully-readable four-tuple reports complete:true, missing:[], exit 0", () => {
  const now = Math.floor(Date.now() / 1000);
  const { parsed, status } = jsonRun([
    "--layer", "inner",
    "--in-flight", "2",
    "--cap", "4",
    "--write-target", "integration",
    "--no-registry",
    "--mechanism", `ready-pool-check:${now - 60}`,
    "--mechanism", `slot-refill:${now - 120}:已停用`,
    "--mechanism", `fast-mode-telemetry --task-start:${now - 30}`,
  ]);
  assert.equal(status, 0, "complete four-tuple exits 0");
  assert.equal(parsed.complete, true);
  assert.deepEqual(parsed.missing, []);
  assert.deepEqual(parsed.warnings, []);
  // ① mechanisms — at least one readable last real exec time.
  assert.ok(parsed.mechanisms.some((m) => m.last_run_epoch !== null), "exec time readable");
  // ② occupancy — in_flight / effective_cap / ratio.
  assert.equal(parsed.occupancy.in_flight, 2);
  assert.equal(parsed.occupancy.effective_cap, 4);
  assert.equal(parsed.occupancy.ratio, 0.5);
  // ③ write_target.
  assert.equal(parsed.write_target, "integration");
  // ④ ledger_line — non-empty canonical line.
  assert.match(parsed.ledger_line, /^quad-tuple inner /);
  assert.match(parsed.ledger_line, /occ=2\/4/);
  assert.match(parsed.ledger_line, /wt=integration/);
});

// ── invariant quad_tuple_no_missing: any tuple field missing ⇒ mechanically reported ─────────────────
test("invariant — a never-run mechanism WITHOUT a judgement is a missing field (缺值 = 未执行), complete:false, exit 1", () => {
  const { parsed, status } = jsonRun([
    "--layer", "manager",
    "--no-registry",
    "--mechanism", "workflow:never",
  ]);
  assert.equal(status, 1, "missing field ⇒ exit 1 (mechanical report)");
  assert.equal(parsed.complete, false);
  assert.ok(parsed.missing.includes("mechanism:workflow.last_run_epoch"), `missing names the field: ${parsed.missing}`);
  assert.ok(parsed.missing.includes("mechanisms.exec_time_unreadable"), "AC4 — no readable exec time reported");
});

test("invariant — an overdue mechanism WITHOUT a judgement is a missing field (AC4 must judge 已停用/已替代/是缺陷)", () => {
  const now = Math.floor(Date.now() / 1000);
  const { parsed, status } = jsonRun([
    "--layer", "outer",
    "--in-flight", "1",
    "--cap", "3",
    "--no-registry",
    "--mechanism", `closure-lag:${now - 10_000_000}`, // way older than the 1h period
  ]);
  assert.equal(status, 1);
  assert.ok(parsed.mechanisms[0].overdue, "overdue detected");
  assert.ok(parsed.missing.includes("mechanism:closure-lag.judgement"), "AC4 — overdue without judgement is missing");
});

// ── AC4: a judgement (三选一) ACCOUNTS FOR a mechanism even if it never ran ──────────────────────────
test("AC4 — judged mechanisms are accounted for: never-run + 已停用/已替代/是缺陷 is NOT missing", () => {
  const now = Math.floor(Date.now() / 1000);
  for (const j of JUDGEMENTS) {
    const { parsed, status } = jsonRun([
      "--layer", "inner",
      "--in-flight", "1",
      "--cap", "3",
      "--no-registry",
      "--mechanism", `m:never:${j}`,
      "--mechanism", `live:${now - 30}`,
    ]);
    assert.equal(status, 0, `judged mechanism (${j}) does not make the tuple incomplete`);
    assert.equal(parsed.complete, true);
    const mech = parsed.mechanisms.find((m) => m.name === "m");
    assert.equal(mech.status, "judged");
    assert.equal(mech.judgement, j);
  }
});

test("AC4 — a FRESH mechanism needs no judgement (last real exec within its claimed period)", () => {
  const now = Math.floor(Date.now() / 1000);
  const { parsed, status } = jsonRun([
    "--layer", "outer",
    "--in-flight", "1",
    "--cap", "3",
    "--no-registry",
    "--mechanism", `fresh-m:${now - 30}`, // 30s ago < 1h period
  ]);
  assert.equal(status, 0);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.mechanisms[0].status, "fresh");
});

// ── AC5: on-disk trace auto-read (outer's real runtime trace files) ─────────────────────────────────
test("AC5 — outer auto-reads its real on-disk traces (.quay/closure-pass-last-run.json etc.)", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const nowEpoch = Math.floor(Date.now() / 1000);
  const nowIso = new Date().toISOString();
  fs.writeFileSync(path.join(root, ".quay", "closure-pass-last-run.json"), JSON.stringify({ ranAt: nowEpoch, flipped: 3 }), "utf8");
  fs.writeFileSync(path.join(root, ".quay", "verification-round.jsonl"), JSON.stringify({ round: 1, at: nowIso, suiteGreen: true, closed: [] }) + "\n", "utf8");
  fs.writeFileSync(path.join(root, ".quay", "full-suite-state.json"), JSON.stringify({ state: "green", finishedAt: nowIso }), "utf8");

  const { parsed } = jsonRun(["--layer", "outer", "--root", root]);
  const byName = Object.fromEntries(parsed.mechanisms.map((m) => [m.name, m]));
  // All three outer mechanisms read their exec time from traces.
  for (const name of ["closure-lag-check", "verification-round", "full-suite-runner"]) {
    assert.ok(byName[name], `mechanism ${name} present`);
    assert.equal(byName[name].source, "trace", `${name} sourced from its trace`);
    assert.ok(byName[name].last_run_epoch !== null, `${name} has a readable exec time`);
    assert.equal(byName[name].status, "fresh", `${name} within its claimed period`);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("AC5 — a trace file with an unparseable timestamp is still FOUND (trace present, unreadable) and reported missing", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "closure-pass-last-run.json"), JSON.stringify({ ranAt: "not-a-time" }), "utf8");
  const { parsed, status } = jsonRun(["--layer", "outer", "--root", root, "--in-flight", "1", "--cap", "3"]);
  const c = parsed.mechanisms.find((m) => m.name === "closure-lag-check");
  assert.equal(c.source, "trace", "file exists ⇒ trace present");
  assert.equal(c.last_run_epoch, null, "unparseable timestamp ⇒ null");
  assert.equal(c.status, "never-run");
  assert.ok(parsed.missing.includes("mechanism:closure-lag-check.last_run_epoch"), "unreadable exec time mechanically reported");
  assert.equal(status, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

// ── --layer validation ────────────────────────────────────────────────────────────────────────────────
test("usage — missing or unknown --layer is a usage error (exit 2)", () => {
  const noLayer = run(["--json"]);
  assert.equal(noLayer.status, 2);
  assert.match(noLayer.stderr, /--layer/);
  const badLayer = run(["--layer", "nope", "--json"]);
  assert.equal(badLayer.status, 2);
  assert.match(badLayer.stderr, /unknown layer/);
});

test("usage — an invalid --mechanism judgement or epoch is a usage error (exit 2)", () => {
  const badJudgement = run(["--layer", "inner", "--mechanism", "m:never:随便", "--json"]);
  assert.equal(badJudgement.status, 2);
  assert.match(badJudgement.stderr, /judgement/);
  const badEpoch = run(["--layer", "inner", "--mechanism", "m:oops", "--json"]);
  assert.equal(badEpoch.status, 2);
  assert.match(badEpoch.stderr, /epoch/);
});

// ── non-JSON output shape (the paste-into-tick-log human line) ───────────────────────────────────────
test("non-JSON — the default output carries the layer + ledger_line + per-mechanism lines", () => {
  const now = Math.floor(Date.now() / 1000);
  const r = run([
    "--layer", "outer",
    "--in-flight", "1",
    "--cap", "3",
    "--no-registry",
    "--mechanism", `m:${now - 60}`,
  ]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^layer=outer$/m);
  assert.match(r.stdout, /^ledger_line=quad-tuple outer /m);
  assert.match(r.stdout, /^mechanism\.m=/m);
  assert.match(r.stdout, /^write_target=integration$/m);
});
