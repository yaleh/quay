// @test-group engine
// suite-duration-exceed-check.test.mjs — gap-preverified-suite-bypasses-verification-round-ledger
// AC4: an INDEPENDENT, explicit signal when a full-suite verification round exceeds AC101's 600s
// target — not dependent on the fan-in being stuck. The checker reads verification-round.jsonl and
// goes RED (exit 1, SUITE-DURATION-EXCEEDED) when the latest round (ANY scope — the pre-verified
// worktree rows ARE the landing path, round227-style) or the latest MAIN-scope round (AC101's own
// `scope != worktree` definition) has durationMs > limitMs. No rows ⇒ NOT-EVALUATED (never conflated
// with green — 硬规则 3b).
//
//   RED    latest round 936.5s (the round227 shape) ⇒ exceeded
//   RED    latest main-scope round 642.3s (the round222 shape) ⇒ exceeded
//   GREEN  latest round 500.8s (the round224 shape) ⇒ ok
//   NOT-EVALUATED  empty ledger (no rows to judge)
//   --since-epoch  filters to post-enforcement rows (a stale slow row outside the window does not fire)
//
// Run:
//   scripts/test.sh plugin/test/suite-duration-exceed-check.test.mjs
//   node --test plugin/test/suite-duration-exceed-check.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  parseRoundRow,
  latestRound,
  latestMainScopeRound,
  checkSuiteDuration,
  DEFAULT_LIMIT_MS,
} from "../scripts/suite-duration-exceed-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "suite-duration-exceed-check.ts");

const _tmpDirs = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const d of _tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  }
});

/** A full-suite-runner-style round row (the shape the writer + runner both emit). */
function round(round, startedAt, durationMs, scope, state, commit) {
  return { round, startedAt, durationMs, scope, state, commit };
}

const ROWS = [
  round(224, "2026-08-17T00:12:12.138Z", 500803, "main", "green", "fe0d951aa538acf72088011d7a2090cb1eeba05a"),
  round(226, "2026-08-17T02:57:52.272Z", 621588, "worktree", "green", "d2cf473f639290cffb18f42356fe262f679e12d4"),
  round(227, "2026-08-17T04:13:31.545Z", 936519, "worktree", "green", "426b21ceaabbe7502334d92d79ce4a4a8d935fe9"),
];

// ── parsing ────────────────────────────────────────────────────────────────────────────────────────

test("parseRoundRow — parses a suite-round line; malformed → null", () => {
  const r = parseRoundRow(JSON.stringify(ROWS[2]));
  assert.ok(r);
  assert.equal(r.round, 227);
  assert.equal(r.durationMs, 936519);
  assert.equal(r.scope, "worktree");
  assert.equal(r.state, "green");
  assert.equal(r.commit, "426b21ceaabbe7502334d92d79ce4a4a8d935fe9");
  assert.equal(parseRoundRow("not json"), null);
  assert.equal(parseRoundRow(JSON.stringify({ noRound: true })), null);
});

// ── latest / latestMainScope selection ─────────────────────────────────────────────────────────────

test("latestRound — the highest round wins regardless of append order", () => {
  assert.equal(latestRound(ROWS).round, 227);
  assert.equal(latestRound([ROWS[2], ROWS[0], ROWS[1]]).round, 227);
  assert.equal(latestRound([]), null);
});

test("latestMainScopeRound — the highest round with scope != worktree (AC101's definition; missing scope counts as main)", () => {
  assert.equal(latestMainScopeRound(ROWS).round, 224);
  // A legacy row with NO scope field counts as main (AC101: scope != worktree).
  const legacy = [round(223, "2026-08-16T23:04:29.579Z", 44774, null, "red", "d1f4e6a8")];
  assert.equal(latestMainScopeRound(legacy).round, 223);
  assert.equal(latestMainScopeRound([]), null);
});

// ── AC4: the exceed judgment ───────────────────────────────────────────────────────────────────────

test("AC4 — latest round (ANY scope) 936.5s over 600s ⇒ RED (the round227 shape — the pre-verified landing path slowness)", () => {
  const v = checkSuiteDuration(ROWS);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, false);
  assert.equal(v.latestExceeded, true, "round227 936.5s exceeds the 600s target");
  assert.equal(v.reason, "SUITE-DURATION-EXCEEDED — latest=round227:936519ms exceed 600000ms (AC101 600s target)");
});

test("AC4 — latest MAIN-scope round 642.3s over 600s ⇒ RED (the round222 shape — main-scope slow)", () => {
  const rows = [
    round(222, "2026-08-16T21:22:00.000Z", 642288, "main", "green", "abc"),
    round(227, "2026-08-17T04:13:31.545Z", 500000, "worktree", "green", "def"),
  ];
  const v = checkSuiteDuration(rows);
  assert.equal(v.ok, false);
  assert.equal(v.mainScopeExceeded, true, "the latest main-scope round 642.3s exceeds");
  assert.equal(v.latestExceeded, false, "the latest any-scope round 500s does not exceed");
  assert.match(v.reason, /latestMainScope=round222:642288ms/);
});

test("AC4 — a fast latest round (500.8s) and fast latest main-scope round ⇒ GREEN (the round224 shape)", () => {
  const rows = [round(224, "2026-08-17T00:12:12.138Z", 500803, "main", "green", "fe0d951a")];
  const v = checkSuiteDuration(rows);
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, true);
  assert.equal(v.latestExceeded, false);
  assert.equal(v.mainScopeExceeded, false);
  assert.match(v.reason, /SUITE-DURATION-OK/);
});

test("AC4 — a round exactly AT the limit (600000ms) is OK (the criterion is > limit, not >=)", () => {
  const rows = [round(230, "2026-08-17T06:00:00.000Z", 600000, "main", "green", "abc")];
  assert.equal(checkSuiteDuration(rows).ok, true);
  const over = [round(231, "2026-08-17T06:30:00.000Z", 600001, "main", "green", "abc")];
  assert.equal(checkSuiteDuration(over).ok, false);
});

test("AC4 — an empty ledger ⇒ NOT-EVALUATED (never conflated with green — 硬规则 3b)", () => {
  const v = checkSuiteDuration([]);
  assert.equal(v.ok, true);
  assert.equal(v.evaluated, false);
  assert.match(v.reason, /NOT-EVALUATED/);
});

test("AC4 — --since-epoch filters to post-enforcement rows (a stale slow row outside the window does not fire)", () => {
  const rows = [
    round(200, "2026-08-16T10:00:00.000Z", 900000, "main", "green", "abc"),
    round(224, "2026-08-17T00:12:12.138Z", 500803, "main", "green", "def"),
  ];
  const since = Date.parse("2026-08-16T17:00:00.000Z");
  const v = checkSuiteDuration(rows, { sinceEpoch: since });
  assert.equal(v.evaluated, true);
  assert.equal(v.ok, true, "the stale slow round 200 is outside the since-window");
  assert.equal(v.latest.round, 224);
});

test("AC4 — DEFAULT_LIMIT_MS is 600000 (AC101's 600s target)", () => {
  assert.equal(DEFAULT_LIMIT_MS, 600_000);
});

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────

function writeFixtureLedger(dir, rows) {
  const p = path.join(dir, ".quay", "verification-round.jsonl");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

test("CLI — a slow latest round ⇒ exit 1 + SUITE-DURATION-EXCEEDED", () => {
  const dir = tmpDir("sdec-red-");
  writeFixtureLedger(dir, ROWS);
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", dir], { encoding: "utf8" });
  assert.equal(r.status, 1, `must exit 1 when exceeded: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /SUITE-DURATION-EXCEEDED/);
  assert.match(r.stdout, /round227/);
});

test("CLI — a fast latest round ⇒ exit 0 + SUITE-DURATION-OK", () => {
  const dir = tmpDir("sdec-ok-");
  writeFixtureLedger(dir, [round(224, "2026-08-17T00:12:12.138Z", 500803, "main", "green", "fe0d951a")]);
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, `must exit 0 when ok: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /SUITE-DURATION-OK/);
});

test("CLI — an empty/absent ledger ⇒ exit 0 + NOT-EVALUATED (never a red)", () => {
  const dir = tmpDir("sdec-ne-");
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", dir], { encoding: "utf8" });
  assert.equal(r.status, 0, `absent ledger must be NOT-EVALUATED (exit 0): ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /NOT-EVALUATED/);
});

test("CLI — --json returns the verdict object", () => {
  const dir = tmpDir("sdec-json-");
  writeFixtureLedger(dir, ROWS);
  const r = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", dir, "--json"], { encoding: "utf8" });
  assert.equal(r.status, 1, "json red still exits 1");
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.evaluated, true);
  assert.equal(out.latestExceeded, true);
  assert.equal(out.limitMs, 600000);
});

test("CLI — --limit-ms override", () => {
  const dir = tmpDir("sdec-limit-");
  writeFixtureLedger(dir, [round(230, "2026-08-17T06:00:00.000Z", 700000, "main", "green", "abc")]);
  const low = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", dir, "--limit-ms", "600000"], { encoding: "utf8" });
  assert.equal(low.status, 1, "700s > 600s limit ⇒ RED");
  const high = spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", dir, "--limit-ms", "800000"], { encoding: "utf8" });
  assert.equal(high.status, 0, "700s < 800s limit ⇒ OK");
});
