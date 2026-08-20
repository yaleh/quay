// @test-group engine
// mirror-measure-history.test.mjs — gap-measure-history-detached-suite-mirror-write AC1/AC3: the fan-in
// detached-suite path (setsid bash scripts/test.sh) never goes through full-suite-runner.ts (the ONLY
// measure-history.jsonl writer) ⇒ the per-file duration ledger went stale (last record 2026-08-17T04:29:08Z;
// two days of detached-suite rounds with no records). This file pins the NEW thin writer
// (plugin/scripts/mirror-measure-history.ts) that appends a round parsed from the fan-in's REAL suite log
// to <shared-checkout>/.quay/measure-history.jsonl.
//
//   writer      — reuses landMeasureHistory (the SAME function full-suite-runner.ts:3933 calls) so the
//                 emitted {round,runAt,file,durationMs,passed,laneCount,logDigest} lines are IDENTICAL to
//                 the runner's direct writes (AC3: the measure-trend-check.ts consumer reads the same shape).
//   fail-closed — a missing --log / --lane-count / nonexistent log / unresolvable shared checkout exits 2
//                 and writes NOTHING (硬规则 3b); a no-perfile-lines / duplicate-log is a BENIGN no-op
//                 (exit 0, distinguishable from a real write — never a fabricated round).
//   shared path — without --history, the writer resolves the shared main checkout via git common-dir and
//                 writes <shared>/.quay/measure-history.jsonl (the MAIN repo's history, not a fork copy).
//
// Run:
//   scripts/test.sh plugin/test/mirror-measure-history.test.mjs
//   node --test plugin/test/mirror-measure-history.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { main } from "../scripts/mirror-measure-history.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
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

/** A real suite log carrying the measure-suite-reporter __PERFILE__ lines (the format scripts/test.sh's
 *  real-suite node --test runs emit, and the fan-in suite-launch block redirects to /tmp/fan-in-suite-<t>.log). */
function perfileLog(lines = [
  "__PERFILE__ duration_ms=1204.5 /home/yale/work/quay-worktrees/gap-demo/plugin/test/a.test.mjs passed=true",
  "__PERFILE__ duration_ms=842.25 /home/yale/work/quay-worktrees/gap-demo/plugin/test/b.test.mjs passed=true",
  "__PERFILE__ duration_ms=999999.5 /home/yale/work/quay-worktrees/gap-demo/plugin/test/c.test.mjs passed=false",
]) {
  const logFile = path.join(tmpDir("mirror-hist-log-"), "suite.log");
  fs.writeFileSync(logFile, lines.join("\n") + "\n", "utf8");
  return logFile;
}

/** Capture the --json output + exit code of a direct main() invocation. */
function runMain(args) {
  const out = [];
  const oldWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => {
    out.push(String(chunk));
    return oldWrite(chunk, ...rest);
  };
  let code;
  try {
    code = main(["node", "mirror-measure-history.ts", ...args]);
  } finally {
    process.stdout.write = oldWrite;
  }
  return { code, json: out.join("").trim().split("\n").filter((l) => l.trim().startsWith("{")).pop() ?? "" };
}

test("AC1/AC3 — a real suite log appends a full-suite-runner-compatible round (normalized worktree paths, identical record shape)", () => {
  const logFile = perfileLog();
  const historyFile = path.join(tmpDir("mirror-hist-"), "measure-history.jsonl");
  const r = runMain(["--log", logFile, "--lane-count", "8", "--run-at", "2026-08-20T04:30:00.000Z", "--history", historyFile, "--json"]);
  assert.equal(r.code, 0, `mirror must exit 0: ${r.json}`);
  const out = JSON.parse(r.json);
  assert.equal(out.ok, true);
  assert.equal(out.landed, true, "a real round must land");
  assert.equal(out.round, 1);
  assert.equal(out.files, 3);
  const lines = fs.readFileSync(historyFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 3, "one record per test file");
  for (const line of lines) {
    const rec = JSON.parse(line);
    // The record shape must match what full-suite-runner's landMeasureHistory writes (AC3 — the
    // measure-trend-check.ts consumer reads exactly these fields).
    assert.equal(typeof rec.round, "number");
    assert.equal(rec.runAt, "2026-08-20T04:30:00.000Z");
    assert.equal(typeof rec.file, "string");
    assert.equal(typeof rec.durationMs, "number");
    assert.equal(typeof rec.passed, "boolean");
    assert.equal(rec.laneCount, 8);
    assert.equal(typeof rec.logDigest, "string");
    // __PERFILE__ full paths are normalized to repo-root-relative keys (quay-worktrees prefix stripped),
    // so the fan-in mirror's records key consistently with the runner's direct writes.
    assert.equal(rec.file.includes("quay-worktrees"), false, "worktree root prefix must be stripped");
    assert.equal(rec.file.startsWith("plugin/test/"), true, `normalized repo-root-relative key: ${rec.file}`);
  }
  const b = JSON.parse(lines[1]);
  assert.equal(b.file, "plugin/test/b.test.mjs");
  assert.equal(b.durationMs, 842.25);
});

test("AC1 — the next round continues from the existing history's last round (monotonic, no clobber)", () => {
  const logFile = perfileLog();
  const historyFile = path.join(tmpDir("mirror-hist-"), "measure-history.jsonl");
  runMain(["--log", logFile, "--lane-count", "8", "--history", historyFile]);
  const logFile2 = perfileLog([
    "__PERFILE__ duration_ms=10.5 /home/yale/work/quay-worktrees/gap-demo/plugin/test/d.test.mjs passed=true",
  ]);
  const r2 = runMain(["--log", logFile2, "--lane-count", "8", "--history", historyFile, "--json"]);
  const out2 = JSON.parse(r2.json);
  assert.equal(out2.round, 2, "second round continues from round 1");
  const lines = fs.readFileSync(historyFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 4, "append-only: 3 + 1 records");
  assert.equal(JSON.parse(lines[3]).file, "plugin/test/d.test.mjs");
});

test("AC1 — a re-run over the SAME log is a benign duplicate-log no-op (exit 0, distinguishable, no duplicate round)", () => {
  const logFile = perfileLog();
  const historyFile = path.join(tmpDir("mirror-hist-"), "measure-history.jsonl");
  const r1 = runMain(["--log", logFile, "--lane-count", "8", "--history", historyFile, "--json"]);
  assert.equal(JSON.parse(r1.json).landed, true);
  const r2 = runMain(["--log", logFile, "--lane-count", "8", "--history", historyFile, "--json"]);
  assert.equal(r2.code, 0, "duplicate-log must exit 0 (idempotent re-run, never blocks the fan-in)");
  const out2 = JSON.parse(r2.json);
  assert.equal(out2.landed, false, "duplicate-log is a no-op");
  assert.equal(out2.reason, "duplicate-log");
  const lines = fs.readFileSync(historyFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 3, "no duplicate records from the same log digest");
});

test("AC1 — a log with no __PERFILE__ lines is a BENIGN no-perfile-lines no-op (exit 0, never a fabricated round)", () => {
  const logFile = path.join(tmpDir("mirror-hist-"), "suite.log");
  fs.writeFileSync(logFile, "some non-perfile output\n__OVERHEAD__ run_static_checks_ms=100\n", "utf8");
  const historyFile = path.join(tmpDir("mirror-hist-"), "measure-history.jsonl");
  const r = runMain(["--log", logFile, "--lane-count", "8", "--history", historyFile, "--json"]);
  assert.equal(r.code, 0, "no-perfile-lines must exit 0 (a static-only suite legitimately has no per-file durations)");
  const out = JSON.parse(r.json);
  assert.equal(out.landed, false);
  assert.equal(out.reason, "no-perfile-lines");
  assert.equal(fs.existsSync(historyFile), false, "nothing written for a no-op");
});

test("fail-closed — missing --log / --lane-count / nonexistent log exit 2 and write NOTHING (硬规则 3b)", () => {
  const historyFile = path.join(tmpDir("mirror-hist-"), "measure-history.jsonl");
  const noLog = runMain(["--lane-count", "8", "--history", historyFile, "--json"]);
  assert.equal(noLog.code, 2, "missing --log must exit 2");
  assert.match(JSON.parse(noLog.json).error ?? "", /--log/);
  const logFile = perfileLog();
  const noLane = runMain(["--log", logFile, "--history", historyFile, "--json"]);
  assert.equal(noLane.code, 2, "missing --lane-count must exit 2");
  assert.match(JSON.parse(noLane.json).error ?? "", /lane-count/);
  const noFile = runMain(["--log", "/tmp/definitely-not-a-suite-log-xyz.log", "--lane-count", "8", "--history", historyFile, "--json"]);
  assert.equal(noFile.code, 2, "nonexistent log must exit 2");
  assert.match(JSON.parse(noFile.json).error ?? "", /does not exist/);
  assert.equal(fs.existsSync(historyFile), false, "a fail-closed run writes nothing");
});

test("AC1 — WITHOUT --history, the writer resolves the SHARED checkout (git common-dir) and writes the MAIN repo's .quay/measure-history.jsonl", () => {
  // A temp git repo models the worktree: the writer resolves the shared main checkout from it and
  // lands the round in <main>/.quay/measure-history.jsonl — the file the consumers read, not a fork copy.
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-shared-"));
  _tmpDirs.push(worktree);
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: worktree, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  };
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "test@test"]);
  run(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(worktree, "README.md"), "base\n");
  run(["add", "README.md"]);
  run(["commit", "-qm", "base"]);
  const logFile = perfileLog();
  const r = runMain(["--log", logFile, "--lane-count", "8", "--root", worktree, "--json"]);
  assert.equal(r.code, 0, `mirror must exit 0: ${r.json}`);
  const historyFile = path.join(worktree, ".quay", "measure-history.jsonl");
  assert.ok(fs.existsSync(historyFile), "the shared checkout's .quay/measure-history.jsonl was written");
  const rec = JSON.parse(fs.readFileSync(historyFile, "utf8").trim().split("\n")[0]);
  assert.equal(typeof rec.round, "number");
  assert.equal(rec.file, "plugin/test/a.test.mjs", "record key is normalized repo-root-relative");
});

test("fail-closed — an unresolvable shared checkout (non-git root, no --history override) exits 2 and writes nothing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-nogit-"));
  _tmpDirs.push(root);
  const logFile = perfileLog();
  const r = runMain(["--log", logFile, "--lane-count", "8", "--root", root, "--json"]);
  assert.equal(r.code, 2, "non-git root without --history must exit 2 (cannot resolve the shared checkout)");
  assert.match(JSON.parse(r.json).error ?? "", /shared checkout/);
});
