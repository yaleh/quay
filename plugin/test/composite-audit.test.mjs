// composite-audit.test.mjs — sibling test for composite-audit.ts (ADR-001 Decision clause 2:
// load-bearing method-infra MUST carry a `<name>.test.mjs` sibling — loadbearing-test-gate.sh
// enforces this by exact filename match).
//
// Run: node --test experiments/quay-perpetual-stream/test/composite-audit.test.mjs
// (or: node --experimental-strip-types --test experiments/quay-perpetual-stream/test/composite-audit.test.mjs)
// Byte-identical mirror: plugin/test/composite-audit.test.mjs (the relative ../scripts/ import
// resolves against each location's own scripts/ dir — G3 mirror byte-identity).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  runReadOnlyAuditShard,
  combineShardVerdicts,
  selftest,
  takeGitSnapshot,
  diffGitSnapshots,
  guardShardReadOnly,
} from "../scripts/composite-audit.ts";

const __filename = fileURLToPath(import.meta.url);
const CLI_PATH = path.join(path.dirname(__filename), "..", "scripts", "composite-audit.ts");

function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Real disposable git repository: init + one committed file (the fixture pattern of
// composite-manifest-synthesis.test.mjs's execFileSync fixtures). Untracked scratch files for
// CLI snapshot transport go to a SEPARATE tmp dir — never inside the repo under snapshot.
function makeTempRepo() {
  const dir = mkTmpDir("composite-audit-fixture-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "tracked.txt"), "line1\n");
  execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "add", "tracked.txt"], { cwd: dir });
  execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-q", "-m", "init"], { cwd: dir });
  return dir;
}

function runAuditCli(args, cwd) {
  return spawnSync("node", ["--experimental-strip-types", CLI_PATH, ...args], { cwd, encoding: "utf8" });
}

test("composite-audit.ts embedded selftest() suite passes (includes the negative-control read-only checks)", () => {
  assert.equal(selftest(), true);
});

const makeState = () => ({
  tasks: { "T-0": { status: "ready", checkboxes: { "ac-0": false } } },
  absorbDispositions: {},
  dashboardEntries: [],
  milestoneCounter: 41,
});

test("a well-behaved shard reads state and returns a result — no violation", () => {
  const state = makeState();
  const outcome = runReadOnlyAuditShard(state, (view) => (view.tasks["T-0"].status === "ready" ? "PASS" : "REFUTED"));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result, "PASS");
});

test("NEGATIVE CONTROL: a shard attempting to flip task status is blocked and real state is untouched", () => {
  const state = makeState();
  const before = JSON.stringify(state);
  const outcome = runReadOnlyAuditShard(state, (view) => {
    view.tasks["T-0"].status = "done";
    return "unreachable";
  });
  assert.equal(outcome.ok, false);
  assert.equal(JSON.stringify(state), before, "the real state object must be byte-identical after a hostile mutation attempt");
});

test("NEGATIVE CONTROL: a shard attempting to write an absorb disposition is blocked", () => {
  const state = makeState();
  const before = JSON.stringify(state);
  const outcome = runReadOnlyAuditShard(state, (view) => {
    view.absorbDispositions["T-0"] = "forged";
    return "unreachable";
  });
  assert.equal(outcome.ok, false);
  assert.equal(JSON.stringify(state), before);
});

test("NEGATIVE CONTROL: a shard attempting to push a dashboard entry is blocked", () => {
  const state = makeState();
  const before = JSON.stringify(state);
  const outcome = runReadOnlyAuditShard(state, (view) => {
    view.dashboardEntries.push("forged entry");
    return "unreachable";
  });
  assert.equal(outcome.ok, false);
  assert.equal(JSON.stringify(state), before);
});

test("NEGATIVE CONTROL: a shard attempting to bump the milestone counter is blocked", () => {
  const state = makeState();
  const before = JSON.stringify(state);
  const outcome = runReadOnlyAuditShard(state, (view) => {
    view.milestoneCounter = 999;
    return "unreachable";
  });
  assert.equal(outcome.ok, false);
  assert.equal(JSON.stringify(state), before);
});

test("the shard function receives an isolated clone, never a reference to the real state object", () => {
  const state = makeState();
  let captured = null;
  runReadOnlyAuditShard(state, (view) => {
    captured = view;
    return null;
  });
  assert.notEqual(captured, state);
});

test("combineShardVerdicts: any REFUTED verdict anywhere makes the bundle REFUTED", () => {
  const shardResults = [
    { shardId: "s0", shardVerdict: "PASS", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }] },
    { shardId: "s1", shardVerdict: "REFUTED", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "REFUTED", detail: "gap" }] },
  ];
  const bundle = combineShardVerdicts(shardResults, "c-1");
  assert.equal(bundle.bundleVerdict, "REFUTED");
});

test("combineShardVerdicts: all-PASS shards produce a PASS bundle", () => {
  const shardResults = [
    { shardId: "s0", shardVerdict: "PASS", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }] },
    { shardId: "s1", shardVerdict: "PASS", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" }] },
  ];
  const bundle = combineShardVerdicts(shardResults, "c-2");
  assert.equal(bundle.bundleVerdict, "PASS");
});

test("one audit shard may cover several homogeneous tasks with distinct per-task verdicts", () => {
  const shardResults = [
    {
      shardId: "s-homogeneous",
      shardVerdict: "PASS",
      verdicts: [
        { taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" },
        { taskId: "T-1", acIndex: 0, verdict: "PASS", detail: "" },
        { taskId: "T-2", acIndex: 0, verdict: "PASS", detail: "" },
      ],
    },
  ];
  const bundle = combineShardVerdicts(shardResults, "c-3");
  assert.equal(bundle.shardResults[0].verdicts.length, 3);
});

// ── DIR-119-D3 (M211): mechanically-enforced read-only shard dispatch — snapshot/guard/combine ──
//
// AC4 RED/GREEN: a hostile shard window (planted untracked file + tracked modification) is caught
// by guardShardReadOnly with the EXACT violation string audit-shard-write-violation:<id>; a
// compliant zero-write window passes — both states asserted, never GREEN-only.
// AC5: the in-process deepFreeze/structuredClone isolation is PROVABLY BLIND to a shard's real
// filesystem write (the negative half, asserted not narrated), while the mechanical git-status
// diff catches that same write — the real enforcement point.

test("AC4 RED: a hostile shard window (untracked drop + tracked modification) is caught with the exact violation string", () => {
  const repo = makeTempRepo();
  const before = takeGitSnapshot(repo);
  // Plant BOTH hostile write classes: a NEW untracked file (the primary hostile case —
  // --untracked-files=all is load-bearing) AND a modification of the tracked file.
  fs.writeFileSync(path.join(repo, "hostile-untracked.txt"), "forged\n");
  fs.appendFileSync(path.join(repo, "tracked.txt"), "modified\n");
  const after = takeGitSnapshot(repo);
  const result = guardShardReadOnly("sX", before, after);
  assert.equal(result.ok, false);
  assert.equal(result.violation, "audit-shard-write-violation:sX");
  assert.ok(result.delta.length >= 2, `delta must surface both hostile writes: ${JSON.stringify(result.delta)}`);
  assert.ok(result.delta.some((l) => l.includes("hostile-untracked.txt")), JSON.stringify(result.delta));
  assert.ok(result.delta.some((l) => l.includes("tracked.txt")), JSON.stringify(result.delta));
});

test("AC4 GREEN fixture: a compliant shard window with zero writes passes", () => {
  const repo = makeTempRepo();
  const before = takeGitSnapshot(repo);
  // Read-only inspection work only — no writes of any kind between the two snapshots.
  const after = takeGitSnapshot(repo);
  const result = guardShardReadOnly("sCompliant", before, after);
  assert.deepEqual(result, { ok: true });
});

test("diffGitSnapshots: empty delta for identical snapshots; order-stable added/removed multiset delta otherwise", () => {
  assert.deepEqual(diffGitSnapshots([], []), []);
  assert.deepEqual(diffGitSnapshots(["a", "b"], ["b", "a"]), [], "order-insensitive equality");
  assert.deepEqual(diffGitSnapshots(["a"], ["a", "?? new.txt"]), ["+ ?? new.txt"]);
  assert.deepEqual(diffGitSnapshots(["a", "b"], ["a"]), ["- b"]);
  // Multiset: two copies added is two delta lines, not one.
  assert.deepEqual(diffGitSnapshots(["a"], ["a", "x", "x"]), ["+ x", "+ x"]);
});

test("AC4 RED (CLI form): --guard exits 1 with the violation JSON on stdout for a hostile window", () => {
  const repo = makeTempRepo();
  const scratch = mkTmpDir("composite-audit-cli-");
  const before = takeGitSnapshot(repo);
  fs.writeFileSync(path.join(repo, "hostile.txt"), "x\n");
  fs.appendFileSync(path.join(repo, "tracked.txt"), "y\n");
  const after = takeGitSnapshot(repo);
  const beforeFile = path.join(scratch, "before.json");
  const afterFile = path.join(scratch, "after.json");
  fs.writeFileSync(beforeFile, JSON.stringify(before));
  fs.writeFileSync(afterFile, JSON.stringify(after));
  const res = runAuditCli(["--guard", "--shard-id", "sX", "--before", beforeFile, "--after", afterFile], repo);
  assert.equal(res.status, 1, `expected exit 1; stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.equal(parsed.ok, false);
  assert.equal(parsed.violation, "audit-shard-write-violation:sX");
  assert.ok(Array.isArray(parsed.delta) && parsed.delta.length > 0);
});

test("AC4 GREEN (CLI form): --guard exits 0 with {ok:true} for a clean window (fresh --after snapshot)", () => {
  const repo = makeTempRepo();
  const scratch = mkTmpDir("composite-audit-cli-");
  const beforeFile = path.join(scratch, "before.json");
  fs.writeFileSync(beforeFile, JSON.stringify(takeGitSnapshot(repo)));
  // No --after flag: the CLI takes a fresh snapshot itself (cwd = the repo).
  const res = runAuditCli(["--guard", "--shard-id", "sClean", "--before", beforeFile], repo);
  assert.equal(res.status, 0, `expected exit 0; stderr: ${res.stderr}`);
  assert.deepEqual(JSON.parse(res.stdout.trim()), { ok: true });
});

test("--snapshot prints git status porcelain lines (tracked AND untracked) as JSON and exits 0", () => {
  const repo = makeTempRepo();
  fs.writeFileSync(path.join(repo, "new-untracked.md"), "z\n");
  fs.appendFileSync(path.join(repo, "tracked.txt"), "w\n");
  const res = runAuditCli(["--snapshot"], repo);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const parsed = JSON.parse(res.stdout.trim());
  assert.ok(Array.isArray(parsed.snapshot));
  assert.ok(parsed.snapshot.some((l) => l.startsWith("??") && l.includes("new-untracked.md")), JSON.stringify(parsed.snapshot));
  assert.ok(parsed.snapshot.some((l) => l.startsWith(" M") && l.includes("tracked.txt")), JSON.stringify(parsed.snapshot));
});

test("--combine-json wraps the REAL combineShardVerdicts (byte-equal to the direct-import result)", () => {
  const scratch = mkTmpDir("composite-audit-combine-");
  const shardResults = [
    { shardId: "shard-a-ac", verdicts: [{ taskId: "T-0", acIndex: 0, verdict: "PASS", detail: "" }], shardVerdict: "PASS" },
    { shardId: "shard-integration", verdicts: [{ taskId: "T-1", acIndex: 0, verdict: "CONCERNS", detail: "note" }], shardVerdict: "CONCERNS" },
  ];
  const inFile = path.join(scratch, "shard-results.json");
  fs.writeFileSync(inFile, JSON.stringify(shardResults));
  const res = runAuditCli(["--combine-json", "--in", inFile, "--candidate-id", "c-1"], scratch);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  const viaCli = JSON.parse(res.stdout.trim());
  // Compare at the JSON transport level (an absent optional generationId and an
  // `undefined`-valued one are the same wire value — JSON.stringify drops undefined keys).
  const viaImport = JSON.parse(JSON.stringify(combineShardVerdicts(shardResults, "c-1")));
  assert.deepEqual(viaCli, viaImport, "CLI output must equal the exported combineShardVerdicts result — proves the CLI wraps the real export, not a rewrite");
  assert.equal(viaCli.bundleVerdict, "CONCERNS");
  assert.equal(viaCli.candidateId, "c-1");
  assert.equal(viaCli.shardResults.length, 2);
});

test("--combine-json with malformed input JSON exits 1 with a stderr message", () => {
  const scratch = mkTmpDir("composite-audit-combine-bad-");
  const inFile = path.join(scratch, "bad.json");
  fs.writeFileSync(inFile, "{not json");
  const res = runAuditCli(["--combine-json", "--in", inFile, "--candidate-id", "c-1"], scratch);
  assert.equal(res.status, 1);
  assert.ok(res.stderr.length > 0, "malformed input must produce a stderr diagnostic");
});

test("AC5: in-process deepFreeze/structuredClone isolation is PROVABLY BLIND to a real filesystem write, while the mechanical git-status diff catches that same write", () => {
  const repo = makeTempRepo();
  const before = takeGitSnapshot(repo);
  const state = makeState();
  const outcome = runReadOnlyAuditShard(state, () => {
    // A REAL filesystem write inside the audited repo — the exact effect class a dispatched
    // audit-shard agent produces and the in-process isolation cannot observe.
    fs.writeFileSync(path.join(repo, "fs-write-through-isolation.txt"), "the shard wrote to disk despite isolation\n");
    return "shard-returned-normally";
  });
  // Negative half (asserted, not narrated): the isolation saw NO violation — outcome.ok is true
  // even though a real write landed. deepFreeze/structuredClone binds only in-process JS object
  // mutation; it has zero visibility into the filesystem.
  assert.equal(outcome.ok, true, "runReadOnlyAuditShard must be blind to the FS write");
  assert.equal(outcome.result, "shard-returned-normally");
  // Positive half: the mechanical diff — the workflow's real enforcement point — catches that
  // exact write.
  const delta = diffGitSnapshots(before, takeGitSnapshot(repo));
  assert.ok(delta.length > 0, "the git-status diff must catch the write the in-process isolation missed");
  assert.ok(delta.some((l) => l.includes("fs-write-through-isolation.txt")), JSON.stringify(delta));
});
