// @test-group governance
// fan-in-runid-check.test.mjs — gap-task-telemetry-6-percent-join: the fan-in runId existence +
// traceability checker (plugin/scripts/fan-in-runid-check.ts). The 6% join-rate defect (git fan-in
// commits vs telemetry records) is fixed by a fan-in commit subject carrying the telemetry runId at
// a fixed position — "merge: fan-in task/<id> (runId: fm-...)". This checker makes the Contract
// measure mechanical:
//   measure   fanin_runid_present = `git log -1 --format=%s <最新 fan-in merge>` 是否含 `runId:`
//   band      fanin_runid_present = true（新 fan-in 提交带 runId）
//   invariant telemetry_traceable = 1（遥测 taskId → git 分支机械可回溯）
//
// MERGED 2026-08-12: this file unifies the integration-side (our) checker tests with the vhs-side
// checker tests. The --help convention was reconciled to the integration-side behavior (exit 0,
// usage on stdout) — the vhs-side test asserted exit 2 + stderr, which is mutually exclusive with
// the integration-side exit 0 + stdout, so one convention had to win (integration won).
//
// Run:
//   scripts/test.sh plugin/test/fan-in-runid-check.test.mjs
//   node --test plugin/test/fan-in-runid-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "fan-in-runid-check.ts");
const TELEMETRY_CLI = path.join(REPO_ROOT, "plugin", "scripts", "fast-mode-telemetry.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function gitCmd(cwd, ...args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function runChecker(args) {
  // no --root injected — the checker auto-derives it (integration-side harness)
  return spawnSync("node", ["--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
}

function runCheck(dir, ...args) {
  return spawnSync("node", ["--experimental-strip-types", CHECKER, "--root", dir, ...args], { encoding: "utf8" });
}

function runTelemetry(dir, ...args) {
  return spawnSync("node", ["--experimental-strip-types", TELEMETRY_CLI, "--root", dir, ...args], { encoding: "utf8" });
}

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `faninrunid-${prefix ?? ""}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function initGitRepo(dir) {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "fan-in-runid-test");
  gitCmd(dir, "config", "user.email", "fir@example.com");
}

function commitAll(dir, message) {
  gitCmd(dir, "add", "-A");
  const res = gitCmd(dir, "commit", "-q", "-m", message);
  assert.equal(res.status, 0, `commit "${message}" failed: ${res.stderr}`);
}

/** Seed a repo with a master + task/<id> branch and (optionally) fan-in merge it with the given subject. */
function fanInRepo(prefix, { taskId, subject, merge = true } = {}) {
  const dir = makeTmp(prefix);
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "base");
  gitCmd(dir, "checkout", "-q", "-b", `task/${taskId}`);
  fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "work");
  gitCmd(dir, "checkout", "-q", "master");
  if (merge) {
    const m = gitCmd(dir, "merge", "--no-ff", `task/${taskId}`, "-m", subject);
    assert.equal(m.status, 0, m.stderr);
  }
  return dir;
}

/**
 * Create a tmp git repo with one task branch `task/<id>` merged back to the base branch with a
 * fan-in merge whose message is `merge: fan-in task/<id> (runId: <runId>)` (or the given subject).
 * Returns { dir, sha } where sha is the fan-in merge commit's sha.
 */
function makeFanInRepo(id, { subject, runId } = {}) {
  const dir = makeTmp("vhs");
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
  commitAll(dir, "base");
  gitCmd(dir, "checkout", "-q", "-b", `task/${id}`);
  fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
  commitAll(dir, `work for ${id}`);
  gitCmd(dir, "checkout", "-q", "-");
  const msg = subject ?? `merge: fan-in task/${id} (runId: ${runId})`;
  const merge = gitCmd(dir, "merge", "--no-ff", `task/${id}`, "-m", msg, "-q");
  assert.equal(merge.status, 0, `fan-in merge failed: ${merge.stderr}`);
  const sha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();
  return { dir, sha };
}

/** git commits with a 2030 committer/author date — see the AC3 auto-derive test for the rationale. */
function gitCmd2030(dir, ...args) {
  return spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_COMMITTER_DATE: "2030-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2030-01-01T00:00:00Z" },
  });
}

// ── Pure verdict function (imported from the checker) ───────────────────────────────────────────────

test("checkRunIdPresence — a fan-in sha+subject WITH a runId is ok; missing runId / missing commit fail closed", async () => {
  const { checkRunIdPresence } = await import(CHECKER);
  const ok = checkRunIdPresence("abc123", "merge: fan-in task/gap-x (runId: fm-gap-x-1750-abc)");
  assert.deepEqual(ok, { ok: true, runIdPresent: true, runId: "fm-gap-x-1750-abc", reason: "runId-present", sha: "abc123" });

  const noRunId = checkRunIdPresence("abc123", "merge: fan-in task/gap-x (old style, no runId)");
  assert.equal(noRunId.ok, false);
  assert.equal(noRunId.reason, "fan-in-subject-missing-runId");
  assert.equal(noRunId.runId, null);

  const noCommit = checkRunIdPresence(null, null);
  assert.equal(noCommit.ok, false);
  assert.equal(noCommit.reason, "no-fan-in-commit");
});

// ── integration-side CLI end-to-end (real git fixtures) ─────────────────────────────────────────────

test("default — the LATEST fan-in merge carries a runId ⇒ exit 0, band true", () => {
  const dir = fanInRepo("ok", { taskId: "gap-ok", subject: "merge: fan-in task/gap-ok (runId: fm-gap-ok-1750-abc)" });
  try {
    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 0, `latest runId-carrying fan-in must pass: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /runId present: YES/);
    assert.match(r.stdout, /band fanin_runid_present=true/);
  } finally {
    cleanup(dir);
  }
});

test("default — the LATEST fan-in merge WITHOUT a runId ⇒ exit 1, band false (negative control)", () => {
  const dir = fanInRepo("noid", { taskId: "gap-noid", subject: "merge: fan-in task/gap-noid (no runId here)" });
  try {
    const r = runChecker(["--root", dir]);
    assert.equal(r.status, 1, "a runId-less fan-in must fail the band");
    assert.match(r.stdout, /runId present: NO/);
    assert.match(r.stdout, /FAIL — fan-in-subject-missing-runId/);
  } finally {
    cleanup(dir);
  }
});

test("--task <id> — traces THAT task's fan-in commit and checks its runId (AC3 surface)", () => {
  const dir = fanInRepo("task", { taskId: "gap-traced", subject: "merge: fan-in task/gap-traced (runId: fm-gap-traced-1750-xyz)" });
  try {
    const r = runChecker(["--root", dir, "--task", "gap-traced"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /runId present: YES/);
    // A task with NO fan-in commit fails closed.
    const missing = runChecker(["--root", dir, "--task", "gap-never-landed"]);
    assert.equal(missing.status, 1, "a task never fan-in'd must fail closed");
    assert.match(missing.stdout, /FAIL — no-fan-in-commit/);
  } finally {
    cleanup(dir);
  }
});

test("--json — the machine-readable output carries runIdPresent / runId / reason", () => {
  const dir = fanInRepo("json", { taskId: "gap-json", subject: "merge: fan-in task/gap-json (runId: fm-gap-json-1-abc)" });
  try {
    const r = runChecker(["--root", dir, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.runIdPresent, true);
    assert.equal(out.runId, "fm-gap-json-1-abc");
    assert.equal(out.reason, "runId-present");
    assert.equal(typeof out.fanInCommitSha, "string");
    assert.equal(out.subject, "merge: fan-in task/gap-json (runId: fm-gap-json-1-abc)");
  } finally {
    cleanup(dir);
  }
});

test("--help — usage printed, exit 0, no business side effect", () => {
  const r = runChecker(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /fan-in-runid-check\.ts/);
});

// ── vhs-side AC2: fan-in commits carry a runId ──────────────────────────────────────────────────────

test("AC2 — a fan-in commit with (runId: fm-…) PASSES the checker (--commit mode)", () => {
  const runId = "fm-gap-x-123456-ab12cd";
  const { dir, sha } = makeFanInRepo("gap-x", { runId });
  try {
    const res = runCheck(dir, "--commit", sha);
    assert.equal(res.status, 0, `checker should pass a runId-bearing fan-in commit: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /fanin_runid_present=true/);
    assert.match(res.stdout, new RegExp(runId));
  } finally {
    cleanup(dir);
  }
});

test("AC2 (negative control) — a fan-in commit WITHOUT a runId FAILS the checker", () => {
  const { dir, sha } = makeFanInRepo("gap-x", { subject: "merge: fan-in task/gap-x" });
  try {
    const res = runCheck(dir, "--commit", sha);
    assert.notEqual(res.status, 0, "a fan-in commit without runId must fail the checker");
    assert.match(res.stdout, /fanin_runid_present=false/);
  } finally {
    cleanup(dir);
  }
});

test("AC2 — default scan mode finds the LATEST fan-in commit on HEAD and checks its runId", () => {
  const runId = "fm-gap-y-654321-zyxwvu";
  const { dir } = makeFanInRepo("gap-y", { runId });
  try {
    const res = runCheck(dir);
    assert.equal(res.status, 0, `default scan should find the runId-bearing fan-in commit: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /fanin_runid_present=true/);
  } finally {
    cleanup(dir);
  }
});

test("AC2 — --run-id <expected> requires the fan-in commit's runId to match", () => {
  const runId = "fm-gap-z-111111-aaaaaa";
  const { dir, sha } = makeFanInRepo("gap-z", { runId });
  try {
    const ok = runCheck(dir, "--commit", sha, "--run-id", runId);
    assert.equal(ok.status, 0, "matching expected runId passes");
    const bad = runCheck(dir, "--commit", sha, "--run-id", "fm-other-999999-zzzzzz");
    assert.notEqual(bad.status, 0, "a mismatched expected runId fails");
  } finally {
    cleanup(dir);
  }
});

// ── vhs-side AC3: telemetry taskId → fan-in commit traceability ─────────────────────────────────────

test("AC3 — telemetry_traceable=1: the fan-in commit's runId resolves to a telemetry record for the taskId", () => {
  const dir = makeTmp("ac3");
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");

    // Dispatch bracket: --task-start records a runId under .workflow-events/<runId>.jsonl.
    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-trace");
    assert.equal(start.status, 0, `--task-start failed: ${start.stderr}`);
    const runId = start.stdout.trim();
    assert.match(runId, /^fm-gap-trace-/);

    // Fan-in merge carries THAT runId.
    gitCmd(dir, "checkout", "-q", "-b", "task/gap-trace");
    fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
    commitAll(dir, "work for gap-trace");
    gitCmd(dir, "checkout", "-q", "-");
    const msg = `merge: fan-in task/gap-trace (runId: ${runId})`;
    assert.equal(gitCmd(dir, "merge", "--no-ff", "task/gap-trace", "-m", msg, "-q").status, 0);
    const sha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();

    // Checker with --taskId: the runId → telemetry direction AND the taskId → runId direction.
    const res = runCheck(dir, "--commit", sha, "--taskId", "gap-trace");
    assert.equal(res.status, 0, `traceable fan-in should pass: ${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /telemetry_traceable=true/);
  } finally {
    cleanup(dir);
  }
});

test("AC3 (negative control) — a runId whose telemetry references a DIFFERENT taskId is NOT traceable", () => {
  const dir = makeTmp("ac3neg");
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");

    // The runId's telemetry references gap-other, but the checker is asked to trace gap-x.
    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-other");
    assert.equal(start.status, 0);
    const runId = start.stdout.trim();

    gitCmd(dir, "checkout", "-q", "-b", "task/gap-x");
    fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
    commitAll(dir, "work for gap-x");
    gitCmd(dir, "checkout", "-q", "-");
    const msg = `merge: fan-in task/gap-x (runId: ${runId})`;
    assert.equal(gitCmd(dir, "merge", "--no-ff", "task/gap-x", "-m", msg, "-q").status, 0);
    const sha = gitCmd(dir, "rev-parse", "HEAD").stdout.trim();

    const res = runCheck(dir, "--commit", sha, "--taskId", "gap-x");
    assert.notEqual(res.status, 0, "taskId↔runId mismatch must fail the traceability check");
    assert.match(res.stdout, /telemetry_traceable=false/);
  } finally {
    cleanup(dir);
  }
});

// ── telemetry side: --fanInCommit records the sha; --report carries fanInCommit; --run-id-for ─────────

test("telemetry — --task-end --fanInCommit records the sha; --report tasks carry fanInCommit", () => {
  const dir = makeTmp("fc");
  try {
    // No git here on purpose: the explicit --fanInCommit path must not depend on a repo, and
    // without git firstKnownCommitMs returns null so no startedAtMsUnreliable distortion.
    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-fc");
    assert.equal(start.status, 0);
    const runId = start.stdout.trim();
    const sha = "a".repeat(40);

    const end = runTelemetry(dir, "--task-end", "--taskId", "gap-fc", "--runId", runId, "--outcome", "done", "--fanInCommit", sha);
    assert.equal(end.status, 0, `--task-end failed: ${end.stderr}`);
    assert.match(end.stdout, /fanInCommit aaaa/);

    const report = runTelemetry(dir, "--report", "--json");
    assert.equal(report.status, 0);
    const parsed = JSON.parse(report.stdout);
    assert.equal(parsed.tasks.length, 1);
    assert.equal(parsed.tasks[0].taskId, "gap-fc");
    assert.equal(parsed.tasks[0].fanInCommit, sha, "--report must carry the recorded fanInCommit");
  } finally {
    cleanup(dir);
  }
});

test("telemetry — --task-end WITHOUT --fanInCommit auto-derives the fan-in commit sha from the runId", () => {
  const dir = makeTmp("auto");
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");

    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-auto");
    assert.equal(start.status, 0);
    const runId = start.stdout.trim();

    // 2030 git dates: the fan-in commit's committer time is strictly AFTER the ms start, so the
    // completed pair is NOT flagged startedAtMsUnreliable (would otherwise leave tasks[]).
    gitCmd2030(dir, "checkout", "-q", "-b", "task/gap-auto");
    fs.writeFileSync(path.join(dir, "work.txt"), "work\n", "utf8");
    gitCmd2030(dir, "add", "-A");
    gitCmd2030(dir, "commit", "-q", "-m", "work for gap-auto");
    gitCmd2030(dir, "checkout", "-q", "-");
    assert.equal(gitCmd2030(dir, "merge", "--no-ff", "task/gap-auto", "-m", `merge: fan-in task/gap-auto (runId: ${runId})`, "-q").status, 0);
    const sha = gitCmd2030(dir, "rev-parse", "HEAD").stdout.trim();

    // No --fanInCommit: the CLI must resolve the fan-in commit whose subject carries the runId.
    const end = runTelemetry(dir, "--task-end", "--taskId", "gap-auto", "--runId", runId, "--outcome", "done");
    assert.equal(end.status, 0, `--task-end failed: ${end.stderr}`);
    assert.match(end.stdout, new RegExp(`fanInCommit ${sha.slice(0, 8)}`), "auto-derived fanInCommit should be logged");

    const report = runTelemetry(dir, "--report", "--json");
    assert.equal(report.status, 0);
    const parsed = JSON.parse(report.stdout);
    assert.equal(parsed.tasks.length, 1, `expected 1 completed task, got ${JSON.stringify(parsed.tasks)}${JSON.stringify(parsed.unreliable)}`);
    assert.equal(parsed.tasks[0].fanInCommit, sha, "auto-derived fanInCommit should appear in the report");
  } finally {
    cleanup(dir);
  }
});

test("telemetry — --run-id-for prints the open bracket's runId (the A6 merge-message input), then empty after close", () => {
  const dir = makeTmp("rid");
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");

    const start = runTelemetry(dir, "--task-start", "--taskId", "gap-rid");
    assert.equal(start.status, 0);
    const runId = start.stdout.trim();

    const read = runTelemetry(dir, "--run-id-for", "--taskId", "gap-rid");
    assert.equal(read.status, 0);
    assert.equal(read.stdout.trim(), runId, "--run-id-for should return the open bracket's runId");

    const end = runTelemetry(dir, "--task-end", "--taskId", "gap-rid", "--runId", runId, "--outcome", "done");
    assert.equal(end.status, 0);

    const after = runTelemetry(dir, "--run-id-for", "--taskId", "gap-rid");
    assert.equal(after.status, 0);
    assert.equal(after.stdout.trim(), "", "after close there is no open bracket → empty");
  } finally {
    cleanup(dir);
  }
});
