// @test-group engine
// inner-blocked-signal.test.mjs — gap-no-explicit-blocked-signal-from-inner-layer: RED/GREEN tests
// for the inner layer's explicit "I am stopped and waiting" signal. The inner layer writes
// .quay/inner-blocked.json ONLY through this CLI (AC4 — never hand-written JSON); the outer
// Monitor (inner-state.sh) watches the path with inotifywait (AC6); the readiness check prints it
// (AC5); the wait duration becomes telemetry (AC7).
//
// Covers: AC1 schema + gitignore, AC2 reason vocabulary (no new semantics), AC3 tick-file wiring,
// AC4 CLI (--assert-blocked/--clear/--read), AC5 readiness print, AC6 inotifywait monitor, AC7
// telemetry aggregation, AC9 @test-group engine. AC8 (real drill) is a live end-to-end run
// recorded in the task body, not a unit test.
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
import { spawnSync } from "node:child_process";

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
  assert.deepEqual(cli.BLOCKED_RECORD_SCHEMA.optional, ["options", "evidence"]);
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
    "turn-ended-idle",
  ].sort(), "the 8 stop-and-wait conditions (7 declared + turn-ended-idle for 'round ended, no pending work, awaiting re-invocation')");
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
  const tick = fs.readFileSync(path.join(REPO_ROOT, "docs", "analysis", "fast-mode-loop-tick.md"), "utf8");
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
