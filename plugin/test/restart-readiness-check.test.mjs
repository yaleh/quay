// @test-group engine
// restart-readiness-check.test.mjs — gap-no-explicit-blocked-signal-from-inner-layer (AC5): the
// mechanical resume (quay driver resume) go/no-go must PRINT the inner-layer block signal when one is
// asserted (「内层在等裁定 ≠ 可以 resume」). Two layers of verification:
//   (a) source contract — the script reads the block via the CLI (single parser, AC4) and prints
//       reason + question; and
//   (b) BEHAVIORAL — run the actual script against a temp workspace (RR_ONLY_BLOCK_CHECK + the
//       QUAY_RR_ROOT test seams) with a present block → it HARD-FAILS (exit 1) and prints the
//       record; with an absent block → exit 0.
//
// Run:
//   scripts/test.sh plugin/test/restart-readiness-check.test.mjs
//   node --test plugin/test/restart-readiness-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "restart-readiness-check.sh");

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rr-check-"));
}

function cleanup(tmpRoot) {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

/** Write a schema-valid fake block record under tmp/.quay/. */
function seedBlock(tmpRoot, { reason = "ruling-required", question = "A or B?" } = {}) {
  fs.mkdirSync(path.join(tmpRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, ".quay", "inner-blocked.json"),
    JSON.stringify({ since: Date.now(), taskId: "gap-test", reason, question }, null, 2) + "\n",
    "utf8",
  );
}

/** Run the real readiness script in RR_ONLY_BLOCK_CHECK mode against a temp ROOT. */
function runBlockCheck(tmpRoot) {
  // The block check reads via "$ROOT/plugin/scripts/inner-blocked-signal.ts" — mirror the real
  // scripts dir into the temp root so the real CLI (single parser) is exercised.
  fs.mkdirSync(path.join(tmpRoot, "plugin"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "plugin", "scripts"), path.join(tmpRoot, "plugin", "scripts"), "dir");
  return spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, QUAY_RR_ROOT: tmpRoot, RR_ONLY_BLOCK_CHECK: "1" },
  });
}

// ── AC4 (gap-stranded-worktree-branches-have-no-alarm-channel): stranded branches are PRINTED but ──
// ── are NOT a hard blocker (an un-halt can proceed with stranded work waiting to merge/adjudicate). ─

/** Turn tmpRoot into a real git repo with one stranded `milestone/*` branch ahead of master. */
function seedStrandedBranch(tmpRoot) {
  const g = (...args) => execFileSync("git", args, { cwd: tmpRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-b", "master", "-q", ".");
  g("config", "user.email", "test@example.com");
  g("config", "user.name", "Test");
  fs.writeFileSync(path.join(tmpRoot, "base.txt"), "base\n");
  g("add", ".");
  g("commit", "-q", "-m", "init");
  g("checkout", "-qb", "milestone/M9/iteration-0");
  fs.writeFileSync(path.join(tmpRoot, "work.ts"), "work\n");
  g("add", ".");
  g("commit", "-q", "-m", "stranded work");
  g("checkout", "-q", "master");
  fs.mkdirSync(path.join(tmpRoot, "plugin"), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, "plugin", "scripts"), path.join(tmpRoot, "plugin", "scripts"), "dir");
}

/** Run the real readiness script in RR_ONLY_STRANDED_CHECK mode against a temp ROOT. */
function runStrandedCheck(tmpRoot) {
  return spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, QUAY_RR_ROOT: tmpRoot, RR_ONLY_STRANDED_CHECK: "1" },
  });
}

test("AC4 — restart-readiness-check.sh delegates to task-status-drift-check.ts --stranded and never hard-fails on it", () => {
  const script = fs.readFileSync(SCRIPT, "utf8");
  assert.match(script, /task-status-drift-check\.ts --stranded/, "readiness check must invoke the named stranded-branch check");
  assert.match(script, /check_stranded_branches/, "the check must be a named function");
  // The stranded alarm is INFORMATIONAL — it must print, never trip the hard-fail (bad) path.
  assert.match(script, /\[info\] STRANDED worktree branches/, "stranded branches must be PRINTED");
  assert.doesNotMatch(script, /bad ".*stranded/i, "a stranded branch must NOT hard-fail the readiness gate");
  assert.match(script, /RR_ONLY_STRANDED_CHECK/, "behavioral test seam present");
});

test("AC4 (behavioral) — a stranded branch is printed but does NOT block (exit 0)", () => {
  const tmp = makeTmpWorkspace();
  try {
    seedStrandedBranch(tmp);
    const res = runStrandedCheck(tmp);
    assert.equal(res.status, 0, `stranded branch must NOT block, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /milestone\/M9\/iteration-0/, "must print the stranded branch");
    assert.match(res.stdout, /has-commits/, "must classify it");
    assert.match(res.stdout, /READY ✓/, "summary must still say READY (informational, not a hard fail)");
  } finally {
    cleanup(tmp);
  }
});

test("AC4 (behavioral) — a clean repo reports no stranded branches and exits 0", () => {
  const tmp = makeTmpWorkspace();
  try {
    seedStrandedBranch(tmp);
    // Remove the stranded branch → negative control.
    execFileSync("git", ["branch", "-D", "milestone/M9/iteration-0"], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
    const res = runStrandedCheck(tmp);
    assert.equal(res.status, 0, `clean repo → exit 0, got ${res.status}`);
    assert.match(res.stdout, /no stranded worktree branches/, "must report the clean state");
    assert.match(res.stdout, /READY ✓/, "summary must say READY");
  } finally {
    cleanup(tmp);
  }
});

// ── Source contract (AC5) ────────────────────────────────────────────────────────────────────────────

test("AC5 — restart-readiness-check.sh prints the inner-layer block record via the CLI", () => {
  const script = fs.readFileSync(SCRIPT, "utf8");
  assert.match(script, /inner-blocked\.json/, "readiness check must reference the block path");
  assert.match(script, /inner-blocked-signal\.ts/, "readiness check must read via the CLI (single parser, AC4)");
  assert.match(script, /is BLOCKED|BLOCKED/, "readiness check must print the block state");
  assert.match(script, /question/, "the printed record must include the ruling question");
  // The block must be a HARD FAIL (not informational): resuming into a blocked inner layer hands
  // the loop a self-stopping state. The task's own AC5 parenthetical: "内层在等裁定 ≠ 可以 resume".
  assert.match(script, /bad "inner layer is BLOCKED/, "a present block must trip the hard-fail path");
  assert.match(script, /ok "no inner-layer block signal/, "an absent block must be reported ok");
});

// ── Behavioral: present block → hard fail + printed record ───────────────────────────────────────────

test("AC5 (behavioral) — a present inner-blocked.json makes the readiness check exit 1 and print reason + question", () => {
  const tmp = makeTmpWorkspace();
  try {
    seedBlock(tmp, { reason: "merge-conflict", question: "A or B?" });
    const res = runBlockCheck(tmp);
    assert.equal(res.status, 1, `blocked → hard fail (exit 1), got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /inner layer is BLOCKED/, "must print the BLOCKED state");
    assert.match(res.stdout, /merge-conflict/, "must print the reason");
    assert.match(res.stdout, /A or B\?/, "must print the question");
    assert.match(res.stdout, /NOT READY ✗/, "summary must say NOT READY");
  } finally {
    cleanup(tmp);
  }
});

test("AC5 (behavioral) — an absent block passes (exit 0) and reports no block signal", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runBlockCheck(tmp);
    assert.equal(res.status, 0, `absent block → exit 0, got ${res.status}\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /no inner-layer block signal/, "must report the absent signal");
    assert.match(res.stdout, /READY ✓/, "summary must say READY");
  } finally {
    cleanup(tmp);
  }
});
