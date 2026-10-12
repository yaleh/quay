// @test-group engine
// task-status-events-reconcile.test.mjs — AC1(e) of
// tasks/gap-task-status-events-contract-v1-all-driver-writers: the git-evidenced RECONCILE.
//
// WHAT IT PINS (the task's AC (e), verbatim):
//   · reconcile appends `inferred:true` events ONLY for git-evidenced transitions that are MISSING
//     from the carrier;
//   · and it is IDEMPOTENT — a second `--apply` appends 0, because the inferred event carries
//     `evidence.commit`, which matches commit-exactly on the next pass;
//   · report mode (the default) writes NOTHING.
// Plus the two boundary facts the contract rests on: a transition with no git evidence is never
// invented, and a v0 carrier line is read as v0 (matched BY SHAPE, never upgraded in place).
//
// The fixture is a REAL git repo with REAL commits — the "evidence" this script consumes IS git
// history, so a mocked git would test the mock (硬规则 4 推论三).
//
// Run: scripts/test.sh plugin/test/task-status-events-reconcile.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import { collectGitTransitions, readCarrierEvents, reconcile } from "../scripts/task-status-events-reconcile.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "scripts", "task-status-events-reconcile.ts");
/** A time before every fixture commit — the reconcile window always covers the whole fixture. */
const SINCE = "2000-01-01T00:00:00Z";

const TASK_BODY = (id, status) => `---\nid: ${id}\ntitle: "${id}"\nstatus: ${status}\nlabels:\n  - gap\n---\n## Proposal\nbody of ${id}\n`;

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeTask(root, id, status) {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), TASK_BODY(id, status), "utf8");
}

function commit(root, message) {
  git(root, "add", "-A", "--", "tasks/");
  git(root, "-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-q", "--no-verify", "-m", message, "--", "tasks/");
  return git(root, "rev-parse", "HEAD");
}

/** A v0 carrier line (the pre-v1 shape) — used as the shape-matched, commit-less event. */
function v0Line(taskId, from, to) {
  return JSON.stringify({
    ts: "2026-10-08T23:30:00.000Z", taskId, from, to, kind: "promote",
    actor: "ready-pool-check --apply", writerModule: "/x/y.ts", entry: null, pid: 1,
  });
}

/** The fixture: three git-evidenced transitions, ONE of which the carrier already covers (by shape,
 *  as a v0 line). ⇒ expected: 2 missing, 1 matchedByShape, 0 matchedByCommit. */
function makeFixture(tag, { withCarrier = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `reconcile-${tag}-`));
  git(root, "init", "-q", "-b", "main", ".");
  writeTask(root, "gap-a", "ready");
  writeTask(root, "gap-b", "ready");
  writeTask(root, "gap-c", "todo");
  commit(root, "c0: three tasks");
  writeTask(root, "gap-a", "done");
  const shaA = commit(root, "tasks: gap-a ready→done");
  writeTask(root, "gap-b", "done");
  const shaB = commit(root, "tasks: gap-b ready→done");
  writeTask(root, "gap-c", "ready");
  const shaC = commit(root, "tasks: gap-c todo→ready");
  if (withCarrier) {
    const file = path.join(root, ".quay", "task-status-events.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${v0Line("gap-b", "ready", "done")}\n`, "utf8");
  }
  return { root, shaA, shaB, shaC };
}

function runCli(args) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", SCRIPT, ...args], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function runJson(root, extra = []) {
  const r = runCli(["--root", root, "--ref", "main", "--since", SINCE, "--json", ...extra]);
  assert.equal(r.status, 0, `reconcile must exit 0: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const carrierLines = (root) => {
  const file = path.join(root, ".quay", "task-status-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
};

// ── the pure core ────────────────────────────────────────────────────────────────────────────────

test("collectGitTransitions: reads status changes from REAL commits, pairing each with its own commit", () => {
  const { root, shaA, shaB, shaC } = makeFixture("collect");
  try {
    const got = collectGitTransitions(root, "main", SINCE, null);
    assert.equal(got.ok, true);
    const byCommit = new Map(got.transitions.map((t) => [t.commit, t]));
    assert.deepEqual(
      [...byCommit.values()].map((t) => `${t.taskId} ${t.from}→${t.to}`).sort(),
      ["gap-a ready→done", "gap-b ready→done", "gap-c todo→ready"],
      "exactly the three flips — the initial registration (c0) is NOT a transition",
    );
    assert.equal(byCommit.get(shaC).to, "ready");
    // The window bound is real: a `--since` after the commits yields nothing. (2099, not 2999 — git's
    // approxidate silently drops a far-future `--since` and returns the whole log; measured.)
    const empty = collectGitTransitions(root, "main", "2099-01-01T00:00:00Z", null);
    assert.deepEqual(empty.transitions, []);
    assert.ok(byCommit.has(shaA) && byCommit.has(shaB) && byCommit.has(shaC));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reconcile: a v0 carrier line matches BY SHAPE; only the truly-missing transitions are reported", () => {
  const { root } = makeFixture("match");
  try {
    const collected = collectGitTransitions(root, "main", SINCE, null);
    const carrier = readCarrierEvents(root);
    assert.equal(carrier.events.length, 1);
    assert.equal(carrier.events[0].klass, "v0", "the pre-existing line is read as v0");
    assert.equal(carrier.events[0].commit, null, "a v0 line carries no commit evidence — never upgraded in place");
    assert.equal(carrier.corrupt, 0);

    const report = reconcile(root, "main", SINCE, null, collected.transitions, carrier.events);
    assert.equal(report.gitTransitions, 3);
    assert.equal(report.matchedByShape, 1, "gap-b's v0 event covers its flip by shape (same task, same from→to)");
    assert.equal(report.matchedByCommit, 0, "no carrier event carries a commit yet");
    assert.equal(report.missingCount, 2);
    assert.deepEqual(report.missing.map((t) => t.taskId).sort(), ["gap-a", "gap-c"]);
    const readyDone = report.edges.find((e) => e.edge === "ready→done");
    assert.deepEqual([readyDone.gitCount, readyDone.eventCount, readyDone.missing], [2, 1, 1], "per-edge table: git / event / missing");
    const todoReady = report.edges.find((e) => e.edge === "todo→ready");
    assert.deepEqual([todoReady.gitCount, todoReady.eventCount, todoReady.missing], [1, 0, 1]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── the CLI, end to end ──────────────────────────────────────────────────────────────────────────

test("report mode is the default and writes NOTHING (the production reading's mode)", () => {
  const { root } = makeFixture("report");
  try {
    const before = carrierLines(root);
    const out = runJson(root);
    assert.equal(out.mode, "report");
    assert.equal(out.appended, 0);
    assert.equal(out.missingCount, 2);
    assert.equal(out.carrierV0, 1);
    assert.equal(out.carrierV1, 0);
    assert.deepEqual(carrierLines(root), before, "report mode must leave the carrier byte-identical");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("(e) --apply appends inferred:true ONLY for git-evidenced transitions, then is idempotent (2nd run appends 0)", () => {
  const { root, shaA, shaC } = makeFixture("apply");
  try {
    const first = runJson(root, ["--apply"]);
    assert.equal(first.mode, "apply");
    assert.equal(first.appended, 2, "the two git-evidenced transitions with no event");

    const lines = carrierLines(root);
    assert.equal(lines.length, 3, "1 pre-existing v0 line + 2 inferred v1 lines — nothing else was invented");
    const inferred = lines.slice(1).map((l) => JSON.parse(l));
    for (const rec of inferred) {
      assert.equal(rec.inferred, true, "an inferred event declares itself");
      assert.equal(rec.source, "git", "and names its source");
      assert.equal(rec.actor.kind, "unknown", "the writer class is NOT inferred from a commit message (硬规则 2)");
      assert.match(rec.actor.id, /^[0-9a-f]{40}$/, "the actor id is the evidencing commit sha — a positional reading");
      assert.match(rec.evidence.commit, /^[0-9a-f]{40}$/);
      assert.equal(rec.kind, "promote", "the kind comes from LIFECYCLE_EDGES for both pairs");
      assert.equal(rec.at, rec.producer === undefined ? rec.at : rec.at, "at is the commit time, not the reconcile time");
      assert.equal(rec.schema, "task-status-event/v1");
    }
    const byTask = new Map(inferred.map((r) => [r.taskId, r]));
    assert.equal(byTask.get("gap-a").evidence.commit, shaA, "gap-a's event names the commit that flipped it");
    assert.equal(byTask.get("gap-c").evidence.commit, shaC);
    assert.equal(byTask.get("gap-a").from, "ready");
    assert.equal(byTask.get("gap-a").to, "done");
    // `at` never invents a time: it is the commit's own committer date.
    const commitTime = git(root, "show", "-s", "--format=%cI", shaA);
    assert.equal(byTask.get("gap-a").at, commitTime, "an inferred event may carry the commit time and nothing later");

    const second = runJson(root, ["--apply"]);
    assert.equal(second.appended, 0, "(e) idempotent: the inferred events now cover their transitions commit-exactly");
    assert.equal(second.missingCount, 0);
    assert.equal(second.matchedByCommit, 2, "…and they match BY COMMIT, which is what makes the second run a no-op");
    assert.equal(second.matchedByShape, 1);
    assert.equal(carrierLines(root).length, 3, "no third line was appended");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a transition with no git evidence is NEVER invented; a corrupt carrier line is counted, not fatal", () => {
  const { root } = makeFixture("noevidence", { withCarrier: false });
  try {
    // A carrier event with NO matching git transition (a fabricated flip) must not stop the run and
    // must not cause any OTHER event to be created in its name.
    const file = path.join(root, ".quay", "task-status-events.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${v0Line("gap-ghost", "todo", "done")}\n{"taskId": broken\n`, "utf8");

    const out = runJson(root, ["--apply"]);
    assert.equal(out.carrierCorrupt, 1, "the unparseable line is counted");
    assert.equal(out.appended, 3, "the three real flips, and nothing for gap-ghost");
    // Skip the two pre-existing lines (the v0 event and the corrupt one) — parsing them is not the point.
    const tasks = carrierLines(root)
      .slice(2)
      .map((l) => JSON.parse(l).taskId)
      .sort();
    assert.deepEqual(tasks, ["gap-a", "gap-b", "gap-c"], "⛔ no event was invented for the git-less gap-ghost flip");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fail-closed boundaries: an unreadable ref, and no derivable --since, both exit 2 (never a silent empty report)", () => {
  const { root } = makeFixture("fail");
  try {
    const badRef = runCli(["--root", root, "--ref", "no-such-ref", "--since", SINCE]);
    assert.equal(badRef.status, 2, "an unreadable ref is an environment error, not 'nothing to reconcile'");
    assert.match(badRef.stderr, /git log failed/);

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-nosince-"));
    try {
      git(empty, "init", "-q", "-b", "main", ".");
      const noSince = runCli(["--root", empty, "--ref", "main"]);
      assert.equal(noSince.status, 2, "an empty carrier with no --since refuses rather than reconciling all history");
      assert.match(noSince.stderr, /no --since given/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
