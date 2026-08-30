// @test-group engine
// inner-blocked-signal.test.mjs — gap-no-explicit-blocked-signal-from-inner-layer +
// gap-the-blocked-channel-has-a-writer-nobody-calls: RED/GREEN tests for the inner layer's explicit
// "I am stopped and waiting" signal. The inner layer writes .quay/inner-blocked.json ONLY through
// this CLI (AC4 — never hand-written JSON); the outer reads the path back via `--read` (the
// inner-state.sh inotifywait monitor is RETIRED — gap-retire-inner-state-one-observer-targets-by-
// parameter; the block file's presence + `--read` is the signal); the readiness check prints it
// (AC5); the wait duration becomes telemetry
// (AC7).
//
// Covers: AC1 schema + gitignore, AC2 reason vocabulary (no new semantics), AC3 tick-file wiring,
// AC4 CLI (--assert-blocked/--clear/--read), AC5 readiness print, AC6 inotifywait monitor, AC7
// telemetry aggregation, AC9 @test-group engine, and — for the blocked-channel task — the REAL
// trigger path (AC1/AC6): `--detect-stop` writes the block as a MECHANICAL CONSEQUENCE of a
// detected stop condition (merge-conflict, task-over-90m), not because someone remembered to call
// --assert-blocked. AC4 (end-to-end replay) is both a behavioral test here (the outer reads the
// block record via `--read` within one tick) and a live drill recorded in the task body.
//
// Run:
//   scripts/test.sh plugin/test/inner-blocked-signal.test.mjs
//   node --test plugin/test/inner-blocked-signal.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

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
const CLI = path.join(REPO_ROOT, "plugin", "scripts", "inner-blocked-signal.ts");
const TELEMETRY = path.join(REPO_ROOT, "plugin", "scripts", "fast-mode-telemetry.ts");

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inner-blocked-"));
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

/**
 * Async variant of `runCli` — NON-BLOCKING spawn, so the TEST's own event loop (and with it any
 * `setInterval` background writer) keeps running while the CLI child executes. `spawnSync` would
 * block the event loop for the whole CLI run; a real-time activity test that needs a concurrent
 * transcript writer during the CLI's (slow-under-load) module load MUST use this form.
 */
function runCliAsync(root, env, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      ["--no-warnings", "--experimental-strip-types", CLI, "--root", root, ...args],
      { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += String(d); });
    child.stderr.on("data", (d) => { stderr += String(d); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ status: code ?? -1, stdout, stderr }));
  });
}

function runTelemetry(tmpRoot, ...args) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", TELEMETRY, "--root", tmpRoot, ...args], {
    encoding: "utf8",
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

async function importCli() {
  return import(CLI);
}

const BLOCKED_PATH = (root) => path.join(root, ".quay", "inner-blocked.json");

// ── AC1: schema defined + gitignored ─────────────────────────────────────────────────────────────────

test("AC1 — the module defines the .quay/inner-blocked.json schema (BLOCKED_RECORD_SCHEMA)", async () => {
  const cli = await importCli();
  assert.ok(cli.BLOCKED_RECORD_SCHEMA, "must export BLOCKED_RECORD_SCHEMA");
  assert.deepEqual(cli.BLOCKED_RECORD_SCHEMA.required, ["since", "taskId", "reason", "question"]);
  assert.deepEqual(cli.BLOCKED_RECORD_SCHEMA.optional, ["options", "evidence", "source"]);
  assert.equal(cli.BLOCKED_FILE_NAME, "inner-blocked.json");
});

test("AC1 — .gitignore contains the block record path", () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /inner-blocked\.json/, ".gitignore must contain inner-blocked.json");
});

// ── AC2: reason vocabulary = existing stop conditions, nothing new ───────────────────────────────────

test("AC2 — VALID_BLOCKED_REASONS is exactly the inner layer's existing stop conditions", async () => {
  const cli = await importCli();
  assert.deepEqual([...cli.VALID_BLOCKED_REASONS].sort(), [
    "merge-conflict",
    "needs-human-backlog",
    "queue-empty",
    "review-refuted",
    "ruling-required",
    "suite-red",
    "task-over-90m",
  ].sort(), "the 7 documented stop-and-wait conditions, no added semantics");
});

test("AC2 — --assert-blocked rejects a reason outside the vocabulary (fail-closed)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, "--assert-blocked", "--taskId", "gap-t", "--reason", "brand-new-semantics", "--question", "q");
    assert.notEqual(res.status, 0, "a non-vocabulary reason must fail closed");
    assert.match(res.stderr, /reason|merge-conflict/, `stderr should name the reason problem: ${res.stderr}`);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "no file must be written on a rejected reason");
  } finally {
    cleanup(tmp);
  }
});

// ── AC4: CLI is the only writer ──────────────────────────────────────────────────────────────────────

test("AC4 — --assert-blocked writes .quay/inner-blocked.json with the full record", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, "--assert-blocked", "--taskId", "gap-t1", "--reason", "merge-conflict",
      "--question", "A or B?", "--options", '["A: merge ours", "B: merge theirs"]',
      "--evidence", '["6 pass / 14 fail", "negative control also fails"]');
    assert.equal(res.status, 0, `--assert-blocked should exit 0, got ${res.status}\nstderr: ${res.stderr}`);

    const f = BLOCKED_PATH(tmp);
    assert.ok(fs.existsSync(f), `block file must exist at ${f}`);
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.equal(rec.taskId, "gap-t1");
    assert.equal(rec.reason, "merge-conflict");
    assert.equal(rec.question, "A or B?");
    assert.deepEqual(rec.options, ["A: merge ours", "B: merge theirs"]);
    assert.deepEqual(rec.evidence, ["6 pass / 14 fail", "negative control also fails"]);
    assert.equal(typeof rec.since, "number");
    assert.ok(rec.since > 0, "since must be a positive ms epoch");
  } finally {
    cleanup(tmp);
  }
});

test("AC4 — --read returns the record; --read on absent file exits 1", () => {
  const tmp = makeTmpWorkspace();
  try {
    const absent = runCli(tmp, "--read");
    assert.notEqual(absent.status, 0, "--read on absent file must exit nonzero");
    assert.match(absent.stderr, /no block/);

    runCli(tmp, "--assert-blocked", "--taskId", "gap-t", "--reason", "suite-red", "--question", "q?");
    const present = runCli(tmp, "--read");
    assert.equal(present.status, 0, present.stderr);
    const rec = JSON.parse(present.stdout);
    assert.equal(rec.reason, "suite-red");
    assert.equal(rec.question, "q?");
  } finally {
    cleanup(tmp);
  }
});

test("AC4 — double --assert-blocked fails closed (one block at a time)", () => {
  const tmp = makeTmpWorkspace();
  try {
    const first = runCli(tmp, "--assert-blocked", "--taskId", "gap-t", "--reason", "queue-empty", "--question", "q");
    assert.equal(first.status, 0, first.stderr);
    const second = runCli(tmp, "--assert-blocked", "--taskId", "gap-t", "--reason", "queue-empty", "--question", "q2");
    assert.notEqual(second.status, 0, "a second assert while already blocked must fail closed");
    assert.match(second.stderr, /already exists/);
    // The original record must be untouched (no partial overwrite).
    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.question, "q");
  } finally {
    cleanup(tmp);
  }
});

// ── AC4 + AC7: --clear removes the file and emits telemetry ──────────────────────────────────────────

test("AC4 — --clear deletes the block; idempotent when nothing blocked", () => {
  const tmp = makeTmpWorkspace();
  try {
    runCli(tmp, "--assert-blocked", "--taskId", "gap-t", "--reason", "review-refuted", "--question", "q");
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)));
    const res = runCli(tmp, "--clear");
    assert.equal(res.status, 0, `--clear should exit 0, got ${res.status}\nstderr: ${res.stderr}`);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "--clear must delete the file");
    assert.match(res.stdout, /wait \d+\.\ds/, `--clear should report the wait duration: ${res.stdout}`);

    const again = runCli(tmp, "--clear");
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /no block to clear/, "idempotent clear on absent file");
  } finally {
    cleanup(tmp);
  }
});

test("AC4/AC7 — --clear emits a schema-valid blocked telemetry event into .workflow-events/", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const cli = await importCli();
    runCli(tmp, "--assert-blocked", "--taskId", "gap-t", "--reason", "task-over-90m", "--question", "abort?");
    const clear = runCli(tmp, "--clear");
    assert.equal(clear.status, 0, clear.stderr);

    const eventsDir = path.join(tmp, ".workflow-events");
    assert.ok(fs.existsSync(eventsDir), ".workflow-events/ must exist after --clear");
    const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
    assert.equal(files.length, 1, `exactly one blocked event file, got ${files}`);
    const ev = JSON.parse(fs.readFileSync(path.join(eventsDir, files[0]), "utf8"));

    // Must pass A1a validation (the schema module is the single source of truth).
    const schema = await import(path.join(REPO_ROOT, "plugin", "scripts", "workflow-event-schema.mjs"));
    const v = schema.validateEvent(ev);
    assert.equal(v.ok, true, `blocked event must be A1a-valid: ${v.error}`);

    assert.equal(ev.eventKind, "blocked");
    assert.equal(ev.stage, "Fast");
    assert.equal(ev.blockedReason, "task-over-90m");
    assert.equal(ev.blockedQuestion, "abort?");
    assert.equal(typeof ev.timing.startedAtMs, "number");
    assert.equal(typeof ev.timing.endedAtMs, "number");
    assert.ok(ev.timing.endedAtMs >= ev.timing.startedAtMs, "endedAtMs must be >= startedAtMs (duration >= 0)");
    assert.match(ev.commandIdentity, /inner-blocked-signal:clear/);
    assert.equal(cli.BLOCKED_RECORD_SCHEMA.required.length, 4, "sanit check — schema still the 4 required fields");
  } finally {
    cleanup(tmp);
  }
});

// ── AC7: telemetry aggregation ───────────────────────────────────────────────────────────────────────

test("AC7 — aggregate() reports blocked waits with cumulative and longest durations", async () => {
  const cli = await importCli();
  const telemetry = await import(TELEMETRY);
  const root = "/tmp/fake-root";
  const e1 = cli.buildBlockedEvent({ taskId: "gap-a", reason: "ruling-required", question: "q", sinceMs: 1_000_000, clearedAtMs: 1_120_000, root });
  const e2 = cli.buildBlockedEvent({ taskId: "gap-b", reason: "suite-red", question: "q", sinceMs: 2_000_000, clearedAtMs: 2_040_000, root });

  const r = telemetry.aggregate([e1, e2]);
  assert.equal(r.blocked.length, 2, `two blocked waits expected, got ${r.blocked.length}`);
  assert.equal(r.blocked[0].taskId, "gap-a");
  assert.equal(r.blocked[0].reason, "ruling-required");
  assert.equal(r.blocked[0].durationMs, 120_000, "2 min wait");
  assert.equal(r.blocked[1].durationMs, 40_000, "40s wait");
  assert.equal(r.totalBlockedMs, 160_000, "cumulative = 2m40s");
  assert.equal(r.longestBlockedMs, 120_000, "longest = 2 min");

  // Blocked events must NOT leak into tasks/orphaned/inProgress pairing.
  assert.equal(r.tasks.length, 0);
  assert.equal(r.orphaned.length, 0);
  assert.equal(r.inProgress.length, 0);
});

test("AC7 — --report emits totalBlockedMs / longestBlockedMs after an assert→clear cycle", () => {
  const tmp = makeTmpWorkspace();
  try {
    runCli(tmp, "--assert-blocked", "--taskId", "gap-t", "--reason", "merge-conflict", "--question", "q");
    runCli(tmp, "--clear");

    const rep = runTelemetry(tmp, "--report", "--json");
    assert.equal(rep.status, 0, rep.stderr);
    const out = JSON.parse(rep.stdout);
    assert.ok("blocked" in out, "report must carry blocked[]");
    assert.ok("totalBlockedMs" in out, "report must carry totalBlockedMs");
    assert.ok("longestBlockedMs" in out, "report must carry longestBlockedMs");
    assert.equal(out.blocked.length, 1);
    assert.equal(out.blocked[0].reason, "merge-conflict");
    assert.ok(out.totalBlockedMs > 0, `cumulative dead time must be positive, got ${out.totalBlockedMs}`);
    assert.ok(out.longestBlockedMs === out.totalBlockedMs, "single wait == cumulative == longest");
  } finally {
    cleanup(tmp);
  }
});

test("AC7 — empty report: blocked metrics default to 0, never undefined", async () => {
  const telemetry = await import(TELEMETRY);
  const r = telemetry.aggregate([]);
  assert.deepEqual(r.blocked, []);
  assert.equal(r.totalBlockedMs, 0);
  assert.equal(r.longestBlockedMs, 0);
});

// ── AC3: tick file wiring ────────────────────────────────────────────────────────────────────────────

test("AC3 — the tick file requires assert-before-stop and clear-after-recovery", () => {
  const tick = fs.readFileSync(path.join(REPO_ROOT, "plugin", "loop", "fast-mode-loop-tick.md"), "utf8");
  // 40→6 consolidation (SPEC-instruments-behind-one-entry.md) was reverted (7642849a,
  // gap-forty-to-six-remerge-needs-tests-updated-first): the tick doc references the canonical bare
  // script `plugin/scripts/inner-blocked-signal.ts` (NOT the grouped entry `quay-deliver.ts
  // inner-blocked-signal`). The test asserts the SAME command name the tick doc uses (AC2: docs and
  // tests must not each write their own). Re-instate the `quay-deliver.ts` form when 40→6 is re-merged.
  assert.match(tick, /inner-blocked-signal\.ts/, "tick must reference the CLI");
  assert.match(tick, /--assert-blocked/, "tick must require writing the block before stopping");
  assert.match(tick, /--clear/, "tick must require clearing after recovery");
});

// ── Shared-root resolution (design-critical, AC4 footprint) ─────────────────────────────────────────

test("AC4 — findSharedRoot leaves a standalone workspace root unchanged (no accidental rewrite)", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    // A real workspace with its own .quay/config.yml and a real .git DIRECTORY is not a linked
    // worktree — the shared root must resolve to itself.
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "providers: {}\n", "utf8");
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    assert.equal(cli.findSharedRoot(tmp), tmp, "a standalone workspace must resolve to itself");
  } finally {
    cleanup(tmp);
  }
});

test("MINOR 6 — findSharedRoot fails closed when a linked worktree's shared root cannot be resolved", async () => {
  const cli = await importCli();
  const tmp = makeTmpWorkspace();
  try {
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".quay", "config.yml"), "providers: {}\n", "utf8");
    // A linked worktree's `.git` is a FILE — but here the gitdir it points at does not exist, so
    // the shared-root resolution must FAIL CLOSED (throw) rather than silently write the block to
    // the worktree root where the outer Monitor would never see it.
    fs.writeFileSync(path.join(tmp, ".git"), "gitdir: /nonexistent/.git/worktrees/x\n", "utf8");
    assert.throws(() => cli.findSharedRoot(tmp), /shared root/, "must throw, not silently fall back to the worktree root");
  } finally {
    cleanup(tmp);
  }
});

test("AC4 — findSharedRoot resolves the SHARED (main) checkout even from inside a linked worktree", async () => {
  const cli = await importCli();
  const resolved = cli.findSharedRoot(path.join(REPO_ROOT, "plugin", "scripts"));
  assert.ok(fs.existsSync(path.join(resolved, ".quay", "config.yml")), "resolved root must be a workspace");

  // The invariant: the shared root is the MAIN checkout (the parent of the common git dir),
  // wherever the caller sits — so a block written from a worktree lands where the outer watches.
  const common = spawnSync(
    "git", ["-C", REPO_ROOT, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  );
  assert.equal(common.status, 0, `git-common-dir must resolve: ${common.stderr}`);
  const mainCheckout = path.dirname(common.stdout.trim());
  assert.equal(fs.realpathSync(resolved), fs.realpathSync(mainCheckout),
    "shared root must equal the main checkout root (parent of --git-common-dir)");
});

// ── gap-the-blocked-channel-has-a-writer-nobody-calls: --detect-stop (MECHANICAL trigger) ─────────────

/**
 * Create a temp git workspace with an in-progress merge conflict (3 unmerged entries for f.txt).
 * @returns {{tmp: string}}
 */
function makeGitConflictWorkspace() {
  const tmp = makeTmpWorkspace();
  const git = (args) => spawnSync("git", ["-C", tmp, ...args], { encoding: "utf8" });
  const ok = (r, what) => { assert.equal(r.status, 0, `${what} failed: ${r.stderr}`); };
  ok(git(["init", "-q"]), "git init");
  ok(git(["config", "user.email", "test@test"]), "config email");
  ok(git(["config", "user.name", "test"]), "config name");
  fs.writeFileSync(path.join(tmp, "f.txt"), "base\n");
  ok(git(["add", "f.txt"]), "add base");
  ok(git(["commit", "-qm", "base"]), "commit base");
  ok(git(["checkout", "-qb", "side"]), "branch side");
  fs.writeFileSync(path.join(tmp, "f.txt"), "side\n");
  ok(git(["commit", "-qam", "side"]), "commit side");
  ok(git(["checkout", "-q", "master"]), "checkout master");
  fs.writeFileSync(path.join(tmp, "f.txt"), "master\n");
  ok(git(["commit", "-qam", "master"]), "commit master");
  const merge = git(["merge", "side"]);
  assert.notEqual(merge.status, 0, "the test fixture requires a real merge conflict");
  const unmerged = git(["ls-files", "-u"]).stdout.trim();
  assert.ok(unmerged.length > 0, "fixture must have unmerged paths");
  return { tmp };
}

/**
 * Write a synthetic telemetry start event backdated `msAgo` ms, so --detect-stop can observe it.
 * @param {string} tmp
 * @param {string} taskId
 * @param {number} msAgo
 */
async function writeBackdatedStartEvent(tmp, taskId, msAgo) {
  const telemetry = await import(TELEMETRY);
  const ev = telemetry.buildStartEvent({
    taskId,
    runId: telemetry.generateRunId(taskId),
    executionCwd: tmp,
    baseCommit: null,
    recordedAtMs: Date.now() - msAgo,
  });
  telemetry.writeEvent(ev, tmp);
}

/**
 * Write a task file (`tasks/<id>.md`) with the given `status` into the temp workspace, so
 * `detectTaskOver90m`'s task-status gate can observe the task's OWN status (the gate reads the
 * `status` frontmatter field — a telemetry bracket alone is not enough, see
 * gap-over-90m-false-signal-source-reads-telemetry-not-task-status).
 * @param {string} tmp
 * @param {string} taskId
 * @param {string} status
 */
function writeTaskFile(tmp, taskId, status) {
  const dir = path.join(tmp, "tasks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${taskId}.md`),
    `---\nid: ${taskId}\nstatus: ${status}\n---\n**type:** execution\n`,
    "utf8",
  );
}

// ── gap-the-one-condition-the-channel-was-built-for-still-has-no-trigger: the composite
// "ruling-required" trace (transcript stale + task in-progress + clean working tree) ───────────────
//
// AC1 finding recap (full write-up in the task body): the only OTHER candidate — the inner writing
// its question into its own tick narration — has NO stable schema (confirmed: `inner-idle-log.ts`'s
// `awaiting-ruling` reason has the identical "remember to append" shape and the identical
// non-adoption). The trace that exists WITHOUT requiring the inner to remember anything is this
// composite of three already-mechanical signals. `AC9c` (production heuristic, commit-age + clean
// tree only, see `docs/analysis/batch2-queue-state.md`) already proved that pair alone false-
// positives during legitimate fan-in (worktree committed+clean while still actively working) and
// needs a human to disambiguate by reading the pane — the tests below specifically exercise that
// exact false-positive shape and confirm the transcript-freshness conjunct resolves it mechanically.

/**
 * Create a temp git workspace with ONE commit and a clean tree (no conflict, no dirty changes) —
 * the "everything committed, nothing pending" shape a stalled task and a just-finished task share.
 * Ships a `.gitignore` for `.workflow-events/` and `.quay/`, MATCHING the real repo's own
 * `.gitignore` (`:30`/`:26-45`) — without it, `writeBackdatedStartEvent`'s own telemetry write
 * would show up as an untracked file and falsely poison the clean-tree check; a bare `git init`
 * fixture with no `.gitignore` is not representative of the real workspace this detector runs in.
 * @returns {{tmp: string}}
 */
function makeCleanGitWorkspace() {
  const tmp = makeTmpWorkspace();
  const git = (args) => spawnSync("git", ["-C", tmp, ...args], { encoding: "utf8" });
  const ok = (r, what) => { assert.equal(r.status, 0, `${what} failed: ${r.stderr}`); };
  ok(git(["init", "-q"]), "git init");
  ok(git(["config", "user.email", "test@test"]), "config email");
  ok(git(["config", "user.name", "test"]), "config name");
  fs.writeFileSync(path.join(tmp, ".gitignore"), ".workflow-events/\n.quay/\n", "utf8");
  fs.writeFileSync(path.join(tmp, "f.txt"), "base\n");
  ok(git(["add", "f.txt", ".gitignore"]), "add base");
  ok(git(["commit", "-qm", "base"]), "commit base");
  return { tmp };
}

/**
 * Write a fake transcript `.jsonl` file (in its OWN temp dir, never inside the git workspace —
 * real transcripts live under `~/.claude/projects/…`, never inside the repo; writing one inside
 * the workspace would itself be an untracked file and poison the clean-tree check) and set its
 * mtime `msAgo` ms in the past (or now if `msAgo` is 0/undefined).
 * @param {number} [msAgo]
 * @returns {string} the transcript path — caller should `cleanup(path.dirname(...))` when done
 */
function writeTranscriptAt(msAgo = 0) {
  const dir = makeTmpWorkspace();
  const p = path.join(dir, "transcript.jsonl");
  fs.writeFileSync(p, JSON.stringify({ type: "assistant", timestamp: new Date().toISOString() }) + "\n", "utf8");
  const t = new Date(Date.now() - msAgo);
  fs.utimesSync(p, t, t);
  return p;
}

test("AC1 — detectRulingRequiredStall is a no-op with no transcript config (never inferred)", async () => {
  const cli = await importCli();
  const { tmp } = makeCleanGitWorkspace();
  try {
    await writeBackdatedStartEvent(tmp, "gap-x", 35 * 60 * 1000);
    const r = await cli.detectRulingRequiredStall(tmp, {});
    assert.equal(r, null, "no --transcript ⇒ cannot detect, must not guess a path");
  } finally {
    cleanup(tmp);
  }
});

test("AC2/AC3 — --detect-stop --transcript writes ruling-required (real trigger: stale transcript + in-progress + clean tree)", async () => {
  const { tmp } = makeCleanGitWorkspace();
  let transcript;
  try {
    const staleMinutes = 35; // > 30m threshold, < 90m task-over-90m proxy — this is the whole point
    await writeBackdatedStartEvent(tmp, "gap-ruling-e2e", staleMinutes * 60 * 1000);
    transcript = writeTranscriptAt(staleMinutes * 60 * 1000);

    const before = Date.now();
    const res = runCli(tmp, "--detect-stop", "--transcript", transcript);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /STOP CONDITION — ruling-required/, `must report the real trigger: ${res.stdout}`);

    const f = BLOCKED_PATH(tmp);
    assert.ok(fs.existsSync(f), "block file must be auto-written on the composite stall condition");
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.equal(rec.reason, "ruling-required");
    assert.equal(rec.source, "auto", "mechanically detected — not a manual assert");
    assert.equal(rec.taskId, "gap-ruling-e2e");
    assert.match(rec.question, /transcript has not advanced/);
    assert.match(rec.question, /clean/);
    assert.ok(rec.evidence.some((e) => /working tree clean/.test(e)));

    // AC3 — detection_latency_min: how long the transcript had already been stale when the block
    // was written. Bounded by the CLI's own threshold (~35m fixture, well under 90m) — end-to-end
    // production latency additionally depends on tick cadence (~25m, see fast-mode-loop-tick.md),
    // which this fixture does not simulate (out of this task's Touches).
    const transcriptMtimeMs = fs.statSync(transcript).mtimeMs;
    const latencyMin = (rec.since - transcriptMtimeMs) / 60_000;
    assert.ok(latencyMin >= staleMinutes - 0.1 && latencyMin < 90, `detection_latency_min=${latencyMin} must be in [~35, 90)`);
    assert.ok(rec.since >= before, "since must be recorded at write time, not backdated");
  } finally {
    cleanup(tmp);
    cleanup(path.dirname(transcript));
  }
});

test("AC5 — a dirty working tree does NOT fire ruling-required even with a stale transcript + in-progress task", async () => {
  const { tmp } = makeCleanGitWorkspace();
  let transcript;
  try {
    await writeBackdatedStartEvent(tmp, "gap-dirty", 35 * 60 * 1000);
    transcript = writeTranscriptAt(35 * 60 * 1000);
    fs.writeFileSync(path.join(tmp, "f.txt"), "uncommitted change\n"); // dirty tree = actively producing work

    const res = runCli(tmp, "--detect-stop", "--transcript", transcript);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "dirty tree must suppress the composite trigger");
  } finally {
    cleanup(tmp);
    if (transcript) cleanup(path.dirname(transcript));
  }
});

test("AC4 — reverse negative control (real shape): a task in-progress 78 real minutes with a FRESH transcript must NOT be flagged", async () => {
  // This reconstructs the EXACT production false positive `AC9c` hit (docs/analysis/batch2-queue-
  // state.md, 2026-08-04 01:22Z): a task in-progress ~78 minutes, working tree clean (everything
  // committed) — under the commit-age-only heuristic this required a human pane-read to confirm the
  // agent was still genuinely working. Here the transcript stays FRESH throughout (as it did in
  // reality — the pane read found active tool calls), which is exactly the discriminator AC9c
  // lacked. If this test fires, the mechanism repeats the false positive; it must not.
  const { tmp } = makeCleanGitWorkspace();
  let transcript;
  try {
    await writeBackdatedStartEvent(tmp, "gap-e2e-78m", 78 * 60 * 1000);
    transcript = writeTranscriptAt(2 * 60 * 1000); // last activity 2m ago — well under 30m threshold

    const res = runCli(tmp, "--detect-stop", "--transcript", transcript);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)),
      "78-minute in-progress task with a fresh transcript must NOT be flagged — this is the AC9c false-positive shape and the whole reason for the transcript conjunct");
    assert.match(res.stdout, /no stop condition/);
  } finally {
    cleanup(tmp);
    if (transcript) cleanup(path.dirname(transcript));
  }
});

test("AC4 — reverse negative control (genuinely real-time, not backdated): continuous transcript activity suppresses the block; activity stopping triggers it", { timeout: 30_000 }, async () => {
  // Everything else in this file proves the LOGIC with backdated mtimes (same technique the
  // pre-existing task-over-90m tests already use — nobody waits 90 real minutes). This test proves
  // the TEMPORAL CAUSALITY is real: a short-but-real stall threshold (INNER_BLOCKED_RULING_STALL_MS
  // test-only override), a real background "still working" loop touching the transcript on a real
  // timer, real repeated --detect-stop invocations, and real elapsed wall-clock time — not a single
  // fabricated instant.
  const { tmp } = makeCleanGitWorkspace();
  const stallMs = 1200;
  const env = { ...process.env, INNER_BLOCKED_RULING_STALL_MS: String(stallMs) };
  let transcript;
  let keepAlive;
  try {
    await writeBackdatedStartEvent(tmp, "gap-realtime", 5 * 60 * 1000); // in-progress, well under 90m
    transcript = writeTranscriptAt(0);

    // Phase 1 — genuinely active. The transcript is kept fresh by a BACKGROUND writer — a real
    // interval timer (real wall-clock cadence) running in THIS process, concurrent with the CLI
    // --detect-stop invocations, exactly as production has a working inner agent writing its
    // transcript while the outer runs the detector. The CLI spawns are ASYNC (`runCliAsync`) so
    // this writer keeps firing DURING the CLI child's (slow-under-load) module load and execution.
    //   Why the old shape was load-fragile (2026-08-18 full-suite red): touching the transcript
    //   INSIDE the same loop as a BLOCKING `spawnSync` made the inter-touch gap equal to the CLI
    //   spawn + 300ms. `spawnSync` blocks the event loop, so nothing could refresh the mtime while
    //   the CLI loaded — under concurrency-8 load the node --experimental-strip-types module load
    //   alone exceeded the 1200ms stallMs, and the "active" phase falsely tripped the block. With a
    //   background writer the staleness any CLI invocation can observe is bounded by the touch
    //   cadence (200ms), never by the CLI's own latency. The real-time causality claim is unchanged:
    //   a genuinely-running writer keeps the heartbeat fresh; genuinely stopping it triggers the
    //   block.
    const touchEveryMs = 200;
    keepAlive = setInterval(() => {
      const t = new Date();
      fs.utimesSync(transcript, t, t);
    }, touchEveryMs);

    let sawBlockDuringActivity = false;
    for (let i = 0; i < 3; i++) {
      const r = await runCliAsync(tmp, env, "--detect-stop", "--transcript", transcript);
      assert.equal(r.status, 0, r.stderr);
      if (fs.existsSync(BLOCKED_PATH(tmp))) sawBlockDuringActivity = true;
      await new Promise((res) => setTimeout(res, 300));
    }
    clearInterval(keepAlive);
    keepAlive = null;
    assert.equal(sawBlockDuringActivity, false, "continuous real activity must never trigger the block");
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "no block after the active phase");

    // Phase 2 — activity genuinely stops: wait (real sleep) past stallMs, then check once more.
    await new Promise((res) => setTimeout(res, stallMs + 600));
    const r2 = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CLI, "--root", tmp, "--detect-stop", "--transcript", transcript], { encoding: "utf8", env });
    assert.equal(r2.status, 0, r2.stderr);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "activity genuinely stopping past the threshold must trigger the block");
    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.reason, "ruling-required");
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    cleanup(tmp);
    if (transcript) cleanup(path.dirname(transcript));
  }
});

test("AC1 — a fresh subagents/ file counts as activity even when the main transcript file is stale (busy delegating, not frozen)", async () => {
  const cli = await importCli();
  const { tmp } = makeCleanGitWorkspace();
  let transcript;
  try {
    await writeBackdatedStartEvent(tmp, "gap-delegating", 35 * 60 * 1000);
    transcript = writeTranscriptAt(35 * 60 * 1000); // main file stale
    const subDir = transcript.replace(/\.jsonl$/, "") + "/subagents"; // same sibling-dir convention transcriptHeartbeatMtimeMs reads
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "agent-1.jsonl"), "{}\n", "utf8"); // fresh (just written)

    const r = await cli.detectRulingRequiredStall(tmp, { transcriptPath: transcript });
    assert.equal(r, null, "a fresh subagent transcript must count as activity — not frozen, delegating");
  } finally {
    cleanup(tmp);
    if (transcript) cleanup(path.dirname(transcript));
  }
});

test("AC5 — --detect-stop without --transcript is byte-for-behavior unchanged (composite trigger never engages)", async () => {
  const { tmp } = makeCleanGitWorkspace();
  try {
    // Same shape that DOES fire when --transcript is given (see AC2/AC3 test above) — but no
    // --transcript here, so the pre-existing two conditions (merge-conflict, task-over-90m) are the
    // only ones evaluated, exactly as before this task.
    await writeBackdatedStartEvent(tmp, "gap-no-transcript-arg", 35 * 60 * 1000);
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "no --transcript ⇒ no composite detection, no false trigger");
    assert.match(res.stdout, /no stop condition/);
  } finally {
    cleanup(tmp);
  }
});

test("AC6 — an auto ruling-required-stall block auto-clears once the transcript resumes (mirrors the existing auto-clear path)", async () => {
  const { tmp } = makeCleanGitWorkspace();
  let transcript;
  try {
    await writeBackdatedStartEvent(tmp, "gap-resume", 35 * 60 * 1000);
    transcript = writeTranscriptAt(35 * 60 * 1000);

    const first = runCli(tmp, "--detect-stop", "--transcript", transcript);
    assert.equal(first.status, 0, first.stderr);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "stall ⇒ block written");

    // Resume: touch the transcript fresh (the inner is active again).
    const now = new Date();
    fs.utimesSync(transcript, now, now);
    const second = runCli(tmp, "--detect-stop", "--transcript", transcript);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /cleared/, "fresh transcript ⇒ condition resolved ⇒ auto block cleared");
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "resumed ⇒ block removed");
  } finally {
    cleanup(tmp);
    if (transcript) cleanup(path.dirname(transcript));
  }
});

// AC5 — the reverse negative control: normal work (no stop condition) must NOT produce the file.

test("AC5 — --detect-stop with no stop condition produces no block file", () => {
  const tmp = makeTmpWorkspace();
  try {
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "no stop condition ⇒ no block file");
    assert.match(res.stdout, /no stop condition/);
  } finally {
    cleanup(tmp);
  }
});

test("AC5 — a long in-progress task under the 90m budget does NOT produce a block", async () => {
  const tmp = makeTmpWorkspace();
  try {
    await writeBackdatedStartEvent(tmp, "gap-long", 85 * 60 * 1000);
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "85m task is long but under budget ⇒ no block");
  } finally {
    cleanup(tmp);
  }
});

// AC1/AC2/AC6 — the real trigger path: a stop condition ⇒ the block is WRITTEN as a consequence.

test("AC1/AC2/AC6 — --detect-stop writes the block for a task-over-90m (real trigger path)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    await writeBackdatedStartEvent(tmp, "gap-over", 91 * 60 * 1000);
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    const f = BLOCKED_PATH(tmp);
    assert.ok(fs.existsSync(f), "block file must be auto-written on a stop condition");
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.equal(rec.reason, "task-over-90m");
    assert.equal(rec.source, "auto", "an auto-detected block must be marked source:auto");
    assert.match(rec.question, /gap-over/, "question must name the stalled task");
    assert.match(rec.question, /90m/, "question must carry the budget fact");
    assert.match(rec.question, /rule on abort vs continue/, "AC2: actionable — what the outer must decide");
    assert.ok(rec.evidence.length > 0, "evidence carries the supporting observation");
  } finally {
    cleanup(tmp);
  }
});

// gap-over-90m-false-signal-source-reads-telemetry-not-task-status: detectTaskOver90m reads the
// telemetry bracket's startedAtMs (never the task's OWN status), so a crash-leftover bracket on a
// task whose file says status: ready/done fires a FALSE over-90m (3 recurrences in one night:
// 48m + 27m + os-anchor; all phantom in-flight — dead process, 0-commit worktree). The fix gates
// the bracket by the task file's `status` frontmatter: only a genuine in-progress task (or a task
// with no file) fires.

test("AC1 — over-90m does NOT fire for a status=ready task with a stale >90m bracket (negative control; reproduces tonight's os-anchor shape)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    await writeBackdatedStartEvent(tmp, "gap-os-anchor", 91 * 60 * 1000);
    writeTaskFile(tmp, "gap-os-anchor", "ready");
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "status=ready + stale >90m bracket ⇒ NO over-90m block");
  } finally {
    cleanup(tmp);
  }
});

test("AC2 — over-90m still fires for a status=in-progress task with a >90m bracket (positive control)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    await writeBackdatedStartEvent(tmp, "gap-real-over", 91 * 60 * 1000);
    writeTaskFile(tmp, "gap-real-over", "in-progress");
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "status=in-progress + >90m bracket ⇒ over-90m block fires");
    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.reason, "task-over-90m");
    assert.equal(rec.taskId, "gap-real-over");
  } finally {
    cleanup(tmp);
  }
});

test("AC2 — over-90m still fires when the task file is MISSING (bracket is the only signal; fail-closed toward fire)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    await writeBackdatedStartEvent(tmp, "gap-no-file", 91 * 60 * 1000);
    // No tasks/gap-no-file.md written — the bracket is the only signal, so over-90m must still fire.
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "missing task file ⇒ over-90m block still fires (bracket-only fail-closed)");
  } finally {
    cleanup(tmp);
  }
});

// gap-over90-clock-measures-queue-time-not-work-time DoD: a task deferred (touches-overlap) that
// QUEUES 80min then WORKS 20min must NOT trigger OVER90 — the 90-min clock counts WORK time only,
// never the queue segment. Mechanism under test: the pre-defer bracket is closed via --task-end
// --outcome deferred (leaving inProgress), and the fresh --task-start when work begins opens a NEW
// bracket whose startedAtMs is the WORK start. OVER90 reads inProgress — the only open bracket is the
// 20min-old work one.
test("OVER90-DEFER DoD — defer 80min then work 20min (total 100min) ⇒ NO over-90m block (queue excluded)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    const telemetry = await import(TELEMETRY);
    const taskId = "gap-defer-dod";
    const now = Date.now();
    // t=-100min: --task-start opens a bracket (pre-defer, at the dispatch decision point).
    const preRunId = telemetry.generateRunId(taskId);
    telemetry.writeEvent(telemetry.buildStartEvent({ taskId, runId: preRunId, executionCwd: tmp, baseCommit: null, recordedAtMs: now - 100 * 60_000 }), tmp);
    // t=-100min: defer decided → close the pre-defer bracket with outcome deferred (queue segment starts).
    telemetry.writeEvent(telemetry.buildEndEvent({ taskId, runId: preRunId, outcome: "deferred", executionCwd: tmp, baseCommit: null, recordedAtMs: now - 100 * 60_000 }), tmp);
    // t=-20min: work actually begins → FRESH --task-start (new runId, work clock starts).
    telemetry.writeEvent(telemetry.buildStartEvent({ taskId, runId: telemetry.generateRunId(taskId), executionCwd: tmp, baseCommit: null, recordedAtMs: now - 20 * 60_000 }), tmp);
    // The task is genuinely in-progress (working) — the task-status gate must NOT be what blocks the fire.
    writeTaskFile(tmp, taskId, "in-progress");

    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "total elapsed 100min but WORK only 20min ⇒ no over-90m block (queue time excluded)");
  } finally {
    cleanup(tmp);
  }
});

// POSITIVE CONTROL for the DoD: the same task, same in-progress status, but NO defer — a single
// bracket open for 91min of genuine work ⇒ OVER90 MUST still fire (the fix only excludes queue, it
// never masks a genuinely slow/long task).
test("OVER90-DEFER positive control — 91min of WORK (no defer) still fires over-90m", async () => {
  const tmp = makeTmpWorkspace();
  try {
    await writeBackdatedStartEvent(tmp, "gap-defer-real", 91 * 60 * 1000);
    writeTaskFile(tmp, "gap-defer-real", "in-progress");
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "a genuine 91min in-progress work bracket must still fire over-90m");
    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.taskId, "gap-defer-real");
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — os-anchor recurrence case side by side: status=ready stale bracket is skipped, the genuine in-progress one fires", async () => {
  const tmp = makeTmpWorkspace();
  try {
    // Tonight's recurrence shape: os-anchor's bracket is stale >90m but its task file says status: ready.
    await writeBackdatedStartEvent(tmp, "gap-os-anchor", 92 * 60 * 1000);
    writeTaskFile(tmp, "gap-os-anchor", "ready");
    // Genuine shape: an in-progress task genuinely over budget — must still fire.
    await writeBackdatedStartEvent(tmp, "gap-real-over", 91 * 60 * 1000);
    writeTaskFile(tmp, "gap-real-over", "in-progress");

    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "the genuine in-progress task must still produce an over-90m block");
    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.reason, "task-over-90m");
    assert.equal(rec.taskId, "gap-real-over", "the fired task must be the genuine in-progress one, never the ready os-anchor");
  } finally {
    cleanup(tmp);
  }
});

test("AC1/AC6 — --detect-stop writes the block for a merge conflict (real trigger path)", () => {
  const { tmp } = makeGitConflictWorkspace();
  try {
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    const f = BLOCKED_PATH(tmp);
    assert.ok(fs.existsSync(f), "a merge conflict must auto-write the block");
    const rec = JSON.parse(fs.readFileSync(f, "utf8"));
    assert.equal(rec.reason, "merge-conflict");
    assert.equal(rec.source, "auto");
    assert.match(rec.question, /merge conflict in progress/);
    assert.match(rec.question, /rule on how to resolve/, "AC2: actionable");
    assert.deepEqual(rec.evidence, ["f.txt"], "evidence dedupes the 3-stage unmerged entries");
  } finally {
    cleanup(tmp);
  }
});

// AC3 — release path: kept while the condition persists (negative control), cleared once resolved.

test("AC3 — --detect-stop keeps the block while the conflict persists and clears it once resolved", () => {
  const { tmp } = makeGitConflictWorkspace();
  try {
    const first = runCli(tmp, "--detect-stop");
    assert.equal(first.status, 0, first.stderr);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "conflict ⇒ block written");

    // Negative control: the conflict is NOT yet resolved — detect-stop must NOT clear it.
    const second = runCli(tmp, "--detect-stop");
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /still blocked/, "unresolved conflict ⇒ block stays");
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "unresolved ⇒ block must NOT be cleared");

    // Resolve the conflict (stage the file), then detect-stop clears the auto block.
    const resolve = spawnSync("git", ["-C", tmp, "checkout", "-q", "--theirs", "f.txt"], { encoding: "utf8" });
    assert.equal(resolve.status, 0, resolve.stderr);
    const add = spawnSync("git", ["-C", tmp, "add", "f.txt"], { encoding: "utf8" });
    assert.equal(add.status, 0, add.stderr);

    const third = runCli(tmp, "--detect-stop");
    assert.equal(third.status, 0, third.stderr);
    assert.match(third.stdout, /cleared/, "resolved conflict ⇒ block cleared");
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "resolved ⇒ block removed");
  } finally {
    cleanup(tmp);
  }
});

test("AC3 — --detect-stop never auto-clears a manual (judgment) block; only --clear does", () => {
  const tmp = makeTmpWorkspace();
  try {
    runCli(tmp, "--assert-blocked", "--taskId", "gap-r", "--reason", "ruling-required", "--question", "M243: A or B?");
    const res = runCli(tmp, "--detect-stop");
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /manual/, "detect-stop reports the manual block is left in place");
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "a manual block must survive --detect-stop with no conditions");
    const rec = JSON.parse(fs.readFileSync(BLOCKED_PATH(tmp), "utf8"));
    assert.equal(rec.reason, "ruling-required");
    assert.equal(rec.source, "manual");

    runCli(tmp, "--clear");
    assert.ok(!fs.existsSync(BLOCKED_PATH(tmp)), "--clear removes a manual block");
  } finally {
    cleanup(tmp);
  }
});

// AC4 — end-to-end replay: a stop condition ⇒ block ⇒ the outer's monitor emits BLOCKED in one tick.

test("AC4 — end-to-end: a stop condition produces the block and the outer reads the record (inner-state.sh retired)", async () => {
  const tmp = makeTmpWorkspace();
  try {
    await writeBackdatedStartEvent(tmp, "gap-e2e", 91 * 60 * 1000);
    const det = runCli(tmp, "--detect-stop");
    assert.equal(det.status, 0, det.stderr);
    assert.ok(fs.existsSync(BLOCKED_PATH(tmp)), "stop condition ⇒ block written");

    // The outer reads the block via `--read` (inner-state.sh is RETIRED —
    // gap-retire-inner-state-one-observer-targets-by-parameter; the block file's presence +
    // the --read record is the signal the outer consumes). The outer can judge within one tick.
    const read = runCli(tmp, "--read");
    assert.equal(read.status, 0, read.stderr);
    const rec = JSON.parse(read.stdout);
    assert.equal(rec.reason, "task-over-90m", "outer must see reason+question");
    assert.ok(rec.question, "the outer gets the question, not just 'stuck'");

    // The wait duration becomes telemetry on --clear (AC7), so the 68-minute class of dead time is
    // measurable, not inferred.
    const clear = runCli(tmp, "--clear");
    assert.equal(clear.status, 0, clear.stderr);
    assert.match(clear.stdout, /wait \d+\.\ds/);
  } finally {
    cleanup(tmp);
  }
});
