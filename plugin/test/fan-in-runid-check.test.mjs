// @test-group governance
// fan-in-runid-check.test.mjs — gap-task-telemetry-6-percent-join: the fan-in runId existence
// checker (plugin/scripts/fan-in-runid-check.ts). The 6% join-rate defect (git fan-in commits vs
// telemetry records) is fixed by a fan-in commit subject carrying the telemetry runId at a fixed
// position — "merge: fan-in task/<id> (runId: fm-...)". This checker makes the Contract measure
// mechanical:
//   measure   fanin_runid_present = `git log -1 --format=%s <最新 fan-in merge>` 是否含 `runId:`
//   band      fanin_runid_present = true（新 fan-in 提交带 runId）
//
// Run:
//   scripts/test.sh plugin/test/fan-in-runid-check.test.mjs
//   node --test plugin/test/fan-in-runid-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const CHECKER = join(repoRoot, "plugin", "scripts", "fan-in-runid-check.ts");

function gitCmd(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runChecker(args) {
  const res = spawnSync("node", ["--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `faninrunid-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

/** Seed a repo with a master + task/<id> branch and (optionally) fan-in merge it with the given subject. */
function fanInRepo(prefix, { taskId, subject, merge = true } = {}) {
  const dir = makeTmp(prefix);
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", "fr-check");
  gitCmd(dir, "config", "user.email", "fr@example.com");
  writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "base");
  gitCmd(dir, "checkout", "-q", "-b", `task/${taskId}`);
  writeFileSync(join(dir, "work.txt"), "work\n", "utf8");
  gitCmd(dir, "add", "-A");
  gitCmd(dir, "commit", "-q", "-m", "work");
  gitCmd(dir, "checkout", "-q", "master");
  if (merge) {
    const m = gitCmd(dir, "merge", "--no-ff", `task/${taskId}`, "-m", subject);
    assert.equal(m.status, 0, m.stderr);
  }
  return dir;
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

// ── CLI end-to-end (real git fixtures) ──────────────────────────────────────────────────────────────

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
