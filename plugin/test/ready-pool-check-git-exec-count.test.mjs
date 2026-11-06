// @test-group engine
// ready-pool-check-git-exec-count.test.mjs — the GIT-FORK ACCOUNTING FIXTURE for
// tasks/gap-anchor-polling-git-fork-storm.
//
// WHY THIS FILE EXISTS: "ready-pool-check forks too many git processes" was, until this task, only
// observable as a HOST-WIDE bpftrace reading (31,918 git execve/10 s attributed by parent process).
// Nothing inside the checker could answer "how many git processes did ONE call spawn, and does that
// grow with the task count?" — so every candidate optimisation was unfalsifiable from here.
//
// THE INSTRUMENT (not a wall-clock inference, not a monkey-patched child_process): the checker's own
// `gitExec()` wrapper appends one JSON line per REAL git spawn to `$QUAY_GIT_EXEC_LOG`. These tests
// spawn the REAL CLI over synthetic workspaces and COUNT LINES. A slow host cannot move this number;
// only a code change can.
//
// AC MAP:
//   AC1 — one call's git-subprocess count is bounded and does NOT grow with the task count:
//         count(N=100) / count(N=10) < 2  (both numbers asserted non-trivially: > 0).
//   AC2 — cache hit: two consecutive ticks with an unchanged workspace ⇒ the second tick pays only a
//         constant probe set (asserted EQUAL at N=10 and N=100, and enumerated from the report).
//   AC3 — invalidation, BOTH directions: change a task file between ticks ⇒ the key breaks, the
//         tick is a FULL derivation, and the READING IS CORRECT (the changed task shows up);
//         change nothing ⇒ the tick stays a replay.
//   AC5 — after K=3 unchanged ticks the next tick's exec count / wall clock drops vs tick #1.
//
// Run: scripts/test.sh plugin/test/ready-pool-check-git-exec-count.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "ready-pool-check.ts");

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/** A REAL git workspace (git init + commit) with `n` ready tasks on `develop`.
 *  ⛔ It must be a git repo, not just a directory: the backoff state lives in the git common dir
 *  (`<git-common-dir>/quay-ready-pool-cache/`), and a non-git root has no cache dir at all — the
 *  fixture would then be measuring the uncached path and prove nothing about the cache. */
function makeGitWorkspace(tag, n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rpc-gitcount-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  git(dir, "init", "-q", "-b", "develop");
  git(dir, "config", "user.email", "fixture@example.invalid");
  git(dir, "config", "user.name", "fixture");
  for (let i = 0; i < n; i++) writeTask(dir, `gap-fixture-${String(i).padStart(3, "0")}`, "ready");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture: seed");
  return dir;
}

/** A contract-shape task body carrying the four artifacts (Proposal / Contract / AC / DoD), so the
 *  task is a REAL pool member rather than an artifact-incomplete reject. */
function bodyFor(id, { checked = false } = {}) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = ≥3",
    "invariant promotion_order = gap-first",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   pool<3 有合格候选 ⇒ 推荐；否则不推荐",
    "resume    分两次提交",
    "## Touches",
    `- tasks/${id}.md`,
    "## Acceptance Criteria",
    checked ? "- [x] an AC item that is long enough" : "- [ ] an AC item that is long enough",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
}

function writeTask(root, id, status, opts = {}) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${bodyFor(id, opts)}\n`);
}

/** Run the real CLI once and return `{ execs, tags, report }` where `execs` is the number of REAL git
 *  leaf spawns it made (counted from the instrument log, never inferred). */
function tick(root, tag) {
  const logFile = path.join(root, `.git-exec-${tag}.log`);
  fs.rmSync(logFile, { force: true });
  const started = Date.now();
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", SCRIPT, "--root", root, "--json"],
    {
      encoding: "utf8",
      timeout: 300_000,
      env: {
        ...process.env,
        CHECKER_COST_SKIP: "1",
        QUAY_GIT_EXEC_LOG: logFile,
        QUAY_READY_POOL_CACHE: "1",
      },
    },
  );
  const ms = Date.now() - started;
  assert.equal(r.status, 0, `ready-pool-check exited ${r.status}: ${r.stderr}`);
  const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean) : [];
  const tags = {};
  for (const line of lines) {
    const j = JSON.parse(line);
    tags[j.tag] = (tags[j.tag] || 0) + 1;
  }
  return { execs: lines.length, tags, ms, report: JSON.parse(r.stdout) };
}

test("AC1 — one ready-pool-check call's git-subprocess count does NOT grow with the task count", (t) => {
  const w10 = makeGitWorkspace("n10", 10);
  const w100 = makeGitWorkspace("n100", 100);
  t.after(() => { fs.rmSync(w10, { recursive: true, force: true }); fs.rmSync(w100, { recursive: true, force: true }); });

  const a = tick(w10, "a");
  const b = tick(w100, "b");

  // The readings must be REAL (a zero would mean the instrument never fired — hard rule 3b: an
  // unmeasured zero must never share a shape with a measured one).
  assert.ok(a.execs > 0 && b.execs > 0, `both counts must be non-zero (got ${a.execs}, ${b.execs})`);
  assert.ok(
    b.execs / a.execs < 2,
    `git execs must not scale with the task count: N=10 → ${a.execs} (${JSON.stringify(a.tags)}), ` +
      `N=100 → ${b.execs} (${JSON.stringify(b.tags)})`,
  );
  // Both workspaces are the same shape ⇒ the count is not merely "under 2×", it is the SAME bounded
  // probe set (the strongest form of "independent of N").
  assert.equal(b.execs, a.execs, `the git-exec count is a constant, not merely sub-linear: N=10 ${a.execs} vs N=100 ${b.execs}`);
  console.log(`  AC1: N=10 → ${a.execs} git execs | N=100 → ${b.execs} git execs | ratio ${(b.execs / a.execs).toFixed(2)}`);
});

test("AC2 — an unchanged second tick pays only a CONSTANT probe set (enumerated from the report)", (t) => {
  const w10 = makeGitWorkspace("cache10", 10);
  const w100 = makeGitWorkspace("cache100", 100);
  t.after(() => { fs.rmSync(w10, { recursive: true, force: true }); fs.rmSync(w100, { recursive: true, force: true }); });

  const cold10 = tick(w10, "1");
  const warm10 = tick(w10, "2");
  const cold100 = tick(w100, "1");
  const warm100 = tick(w100, "2");

  // The second tick is a REPLAY of the first (same complete input fingerprint).
  assert.equal(warm10.report.backoff.mode, "cache-hit", "the second unchanged tick is a cache hit");
  assert.equal(warm100.report.backoff.mode, "cache-hit", "the second unchanged tick is a cache hit (N=100)");
  assert.ok(warm10.report.backoff.replayed_report_from, "the report names the tick it was replayed from");

  // The counters the report ENUMERATES are exactly the git spawns the tick paid for.
  const enumerated = warm10.report.backoff.probes.map((p) => p.tag).sort();
  assert.deepEqual(
    enumerated,
    ["probe-head", "probe-land-ref", "probe-refs"],
    "the replaying tick's change-key probes are enumerated one by one",
  );

  // Constant in N (the whole point): the same bounded probe set at 10 and at 100 tasks.
  assert.equal(
    warm100.execs,
    warm10.execs,
    `the cache-hit tick is constant in the task count: N=10 → ${warm10.execs} (${JSON.stringify(warm10.tags)}), ` +
      `N=100 → ${warm100.execs} (${JSON.stringify(warm100.tags)})`,
  );
  // And strictly cheaper than the cold tick that populated the caches.
  assert.ok(warm10.execs < cold10.execs, `cache hit must be cheaper than the cold tick: ${warm10.execs} vs ${cold10.execs}`);
  // The replayed report is the SAME answer (a cache must not change the verdict).
  assert.equal(warm10.report.pool, cold10.report.pool, "the replayed report carries the same pool reading");
  assert.equal(warm100.report.pool, cold100.report.pool, "the replayed report carries the same pool reading (N=100)");
  console.log(
    `  AC2: cold ${cold10.execs} execs / ${cold10.ms} ms → unchanged tick ${warm10.execs} execs / ${warm10.ms} ms ` +
      `| enumerated probes ${JSON.stringify(warm10.tags)}`,
  );
});

test("AC3 — invalidation is DIRECTIONAL: a task-file change breaks the key and the reading stays correct", (t) => {
  const root = makeGitWorkspace("invalidate", 6);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const first = tick(root, "1");
  const unchanged = tick(root, "2");
  assert.equal(unchanged.report.backoff.mode, "cache-hit", "control arm: nothing changed ⇒ replay");

  // ── CHANGE ARM: add a NEW ready task (a task-store change that must show up in the reading) ────
  writeTask(root, "gap-newly-added", "ready");
  const changed = tick(root, "3");
  assert.equal(changed.report.backoff.mode, "full", "a changed task store must break the change key");
  assert.notEqual(changed.report.backoff.change_key, unchanged.report.backoff.change_key, "the key actually changed");
  assert.ok(
    changed.report.ready.includes("gap-newly-added"),
    `the reading is CORRECT after invalidation — the new ready task is in the pool: ${JSON.stringify(changed.report.ready)}`,
  );
  assert.ok(changed.execs > unchanged.execs, `the invalidated tick does real work again: ${changed.execs} vs ${unchanged.execs}`);

  // ── CONTROL ARM: nothing changed again ⇒ back to a replay, with the SAME (new) answer ──────────
  const quiescent = tick(root, "4");
  assert.equal(quiescent.report.backoff.mode, "cache-hit", "control arm: no change ⇒ replay");
  assert.deepEqual(quiescent.report.ready, changed.report.ready, "the replayed answer is the one the change produced");
  console.log(
    `  AC3: unchanged ${unchanged.execs} execs → changed ${changed.execs} execs (pool ${changed.report.pool}) → ` +
      `unchanged again ${quiescent.execs} execs`,
  );
});

test("AC5 — after K=3 unchanged ticks the next tick's exec count and wall clock drop vs tick #1", (t) => {
  const root = makeGitWorkspace("backoff", 20);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const readings = [];
  for (let i = 1; i <= 4; i++) readings.push(tick(root, String(i)));
  assert.equal(readings[3].report.backoff.unchanged_streak >= 3, true, "tick #4 has K=3 unchanged ticks behind it");
  assert.equal(readings[3].report.backoff.threshold_k, 3, "K is the AC's value");
  assert.ok(
    readings[3].execs < readings[0].execs,
    `tick #4 must fork fewer git processes than tick #1: ${readings[3].execs} vs ${readings[0].execs}`,
  );
  assert.ok(
    readings[3].ms < readings[0].ms,
    `tick #4 must be faster than tick #1: ${readings[3].ms}ms vs ${readings[0].ms}ms`,
  );
  console.log(
    `  AC5: ` + readings.map((r, i) => `tick#${i + 1} ${r.execs} execs/${r.ms}ms (${r.report.backoff.mode})`).join(" | "),
  );
});
