// @test-group engine
// needs-human-recheck.test.mjs — tasks/gap-needs-human-black-hole-human-dependency-unmeasurable:
// the needs-human measurement/aliveness axis (time axis + survival axis).
//
// Coverage map (task ACs):
//   AC1 — TIME axis: a needs-human task untouched longer than N days (default 7, --stale-days N) is
//         reported `stale` for forced re-review. Tested via a real git fixture with controlled
//         commit dates (git log is the survive-checkout "last touched" truth).
//   AC2 — SURVIVAL axis: a needs-human task whose `## Touches` reference an ADR-022-retired
//         classic-pipeline script (prepare-milestone.js / execute-milestone.js /
//         milestone-worktree.ts) is classified `deadRetired` — the SAME ruler as
//         strategic-doc-staleness-check.ts (its DELETED_SCRIPTS list, imported, never duplicated).
//   AC3 — (a)/(b) separable, two-way control: a DIR-109-like alive-stuck task (Touches reference
//         LIVE scripts) is reported alive (stale → FORCED RE-REVIEW); a gap-plancheck-like
//         dead task (Touches reference retired scripts) is deadRetired.
//   AC4 — the real repo's needs-human pool is classified dead/alive (asserted against the real
//         store so the human-dependency count has a truth value; full output pasted in the task body).
//   AC5 — this file uses node:test and declares // @test-group engine.
//
// No global counts are hardcoded where the assertion is about a FIXTURE (the fixture is authored in
// the test). The real-repo assertion (AC4) is relative: it only requires the deadRetired set to be
// non-empty and DISJOINT from the alive set (dead tasks are never also alive) — it does not pin the
// exact count, so the test does not rot as the board evolves.
//
// Run:
//   scripts/test.sh plugin/test/needs-human-recheck.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/needs-human-recheck.ts");
const RETIRED_RULER = path.join(REPO_ROOT, "plugin/scripts/strategic-doc-staleness-check.ts");

/** Run the checker in a given root. */
function run(root, ...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, ...args],
    { encoding: "utf8" },
  );
}

/** A temp workspace with a tasks/ dir. Cleaned by the caller (or left for the OS in CI). */
function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "nhr-check-"));
}

function writeTask(root, id, status, touches) {
  const bullets = (touches ?? [])
    .map((t) => `- \`${t}\``)
    .join("\n");
  const body =
    `---\nid: ${id}\ntitle: "fixture"\nstatus: ${status}\nlabels: []\n---\n\n` +
    `## Proposal\n\nFixture task for needs-human-recheck.\n\n` +
    (bullets ? `## Touches\n\n${bullets}\n` : "");
  const file = path.join(root, "tasks", `${id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

/** Init a git repo in `root` and commit all current files at `when` (ISO or Date-compatible). */
function gitCommitAll(root, when) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: new Date(when).toISOString(),
    GIT_COMMITTER_DATE: new Date(when).toISOString(),
  };
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync(
    "git",
    ["-c", "user.email=fixture@example.com", "-c", "user.name=fixture", "commit", "-q", "-m", "fixture"],
    { cwd: root, env },
  );
}

test("AC1 — a needs-human task untouched > N days is reported stale (git last-commit truth)", () => {
  const ws = makeWorkspace();
  const now = new Date();
  writeTask(ws, "OLD", "needs-human", ["packages/quay/src/gate/engine.ts"]);
  gitCommitAll(ws, new Date(now.getTime() - 12 * 86_400_000)); // 12 days ago

  const res = run(ws, "--stale-days", "7", "--json");
  assert.equal(res.status, 0, `detector must exit 0, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  const t = out.tasks.find((x) => x.id === "OLD");
  assert.ok(t, `OLD task not found in output:\n${res.stdout}`);
  assert.equal(t.stale, true, `12d-old task must be stale, got ${JSON.stringify(t)}`);
  assert.ok(t.ageDays > 7, `ageDays should exceed 7, got ${t.ageDays}`);
  assert.equal(out.needs_human_stale, 1, `needs_human_stale measure must be 1, got ${out.needs_human_stale}`);

  // Configurability (AC1 "N 可配"): with N=14 the same task is NOT stale.
  const res2 = run(ws, "--stale-days", "14", "--json");
  const out2 = JSON.parse(res2.stdout);
  assert.equal(out2.tasks.find((x) => x.id === "OLD").stale, false, `N=14 must clear a 12d task`);
  assert.equal(out2.needs_human_stale, 0);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("AC1 — a fresh needs-human task is NOT stale", () => {
  const ws = makeWorkspace();
  writeTask(ws, "FRESH", "needs-human", ["packages/quay/src/gate/engine.ts"]);
  gitCommitAll(ws, new Date(Date.now() - 2 * 86_400_000)); // 2 days ago
  const res = run(ws, "--stale-days", "7", "--json");
  const out = JSON.parse(res.stdout);
  const t = out.tasks.find((x) => x.id === "FRESH");
  assert.equal(t.stale, false, `2d-old task must not be stale, got ${JSON.stringify(t)}`);
  assert.equal(out.needs_human_stale, 0);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("AC2 — a needs-human task whose Touches reference a retired classic-pipeline script is deadRetired (same ruler)", () => {
  const ws = makeWorkspace();
  // gap-plancheck-like: Touches reference prepare-milestone.js / execute-milestone.js (ADR-022-deleted).
  writeTask(ws, "DEAD", "needs-human", [
    "plugin/scripts/proposal-convergence.ts",
    ".claude/workflows/prepare-milestone.js",
    "plugin/workflows/prepare-milestone.js",
  ]);
  gitCommitAll(ws, new Date(Date.now() - 2 * 86_400_000));
  const res = run(ws, "--json");
  const out = JSON.parse(res.stdout);
  const t = out.tasks.find((x) => x.id === "DEAD");
  assert.equal(t.deadRetired, true, `retired-script Touches must be deadRetired, got ${JSON.stringify(t)}`);
  assert.equal(t.alive, false);
  assert.ok(t.deadReason.includes("prepare-milestone.js"), `deadReason should name the retired script, got ${t.deadReason}`);
  assert.equal(out.needs_human_dead_retired, 1);

  // SAME-RULER invariant (contract same_ruler_on_needs_human): the dead signal comes from
  // strategic-doc-staleness-check's DELETED_SCRIPTS list, imported — not re-declared.
  const checkerSrc = fs.readFileSync(CHECKER, "utf8");
  assert.ok(
    checkerSrc.includes('import { DELETED_SCRIPTS } from "./strategic-doc-staleness-check.ts"'),
    "the checker must import DELETED_SCRIPTS (same ruler), not re-declare it",
  );
  const rulerSrc = fs.readFileSync(RETIRED_RULER, "utf8");
  assert.ok(rulerSrc.includes("prepare-milestone.js"), "ruler must still define prepare-milestone.js");
  fs.rmSync(ws, { recursive: true, force: true });
});

test("AC3 — two-way control: DIR-109-like alive-stuck vs gap-plancheck-like dead are separable", () => {
  const ws = makeWorkspace();
  // DIR-109-like: Touches reference LIVE mechanisms (scripts/test.sh, test files, CLAUDE.md).
  writeTask(ws, "LIVE-STUCK", "needs-human", [
    "scripts/test.sh",
    "packages/quay/test/serve-github.test.mjs",
    "CLAUDE.md",
  ]);
  // gap-plancheck-like: Touches reference a RETIRED mechanism.
  writeTask(ws, "DEAD-PARKED", "needs-human", [
    "plugin/scripts/proposal-convergence.ts",
    ".claude/workflows/prepare-milestone.js",
  ]);
  gitCommitAll(ws, new Date(Date.now() - 12 * 86_400_000)); // both old → both stale
  const res = run(ws, "--stale-days", "7", "--json");
  const out = JSON.parse(res.stdout);
  const live = out.tasks.find((x) => x.id === "LIVE-STUCK");
  const dead = out.tasks.find((x) => x.id === "DEAD-PARKED");

  // The (b) class — alive-stuck: reported for forced re-review, NOT dead.
  assert.equal(live.deadRetired, false, `LIVE-STUCK must not be dead, got ${JSON.stringify(live)}`);
  assert.equal(live.alive, true);
  assert.equal(live.stale, true, `old alive-stuck must be reported stale (forced re-review)`);
  // The (a) class — correctly-parked dead: deadRetired, even though it is also old.
  assert.equal(dead.deadRetired, true, `DEAD-PARKED must be deadRetired, got ${JSON.stringify(dead)}`);
  assert.equal(dead.alive, false);
  // Separation: no task is BOTH dead and alive.
  for (const t of out.tasks) {
    assert.notEqual(t.deadRetired && t.alive, true, `task ${t.id} cannot be both dead and alive`);
  }
  // The two-way count: 1 dead, 1 alive.
  assert.equal(out.needs_human_dead_retired, 1);
  assert.equal(out.needs_human_alive, 1);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("--supersede — writes status:superseded ONLY to dead-retired tasks, leaves alive tasks untouched", () => {
  const ws = makeWorkspace();
  writeTask(ws, "DEAD", "needs-human", [".claude/workflows/execute-milestone.js"]);
  const liveFile = writeTask(ws, "ALIVE", "needs-human", ["scripts/test.sh"]);
  gitCommitAll(ws, new Date());
  const beforeLive = fs.readFileSync(liveFile, "utf8");

  const res = run(ws, "--supersede", "--json");
  assert.equal(res.status, 0, `--supersede must exit 0, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.deepEqual(out.written, ["DEAD"], `only DEAD should be written, got ${JSON.stringify(out.written)}`);

  const deadSrc = fs.readFileSync(path.join(ws, "tasks", "DEAD.md"), "utf8");
  assert.ok(/^status:\s*superseded\b/m.test(deadSrc), `DEAD must now be superseded:\n${deadSrc}`);
  assert.ok(deadSrc.includes("## Superseded"), `DEAD must carry a Superseded annotation:\n${deadSrc}`);
  assert.ok(!/^status:\s*needs-human\b/m.test(deadSrc), `DEAD must no longer be needs-human`);

  // Alive task is byte-identical.
  assert.equal(fs.readFileSync(liveFile, "utf8"), beforeLive, "an alive task must never be mutated");
  fs.rmSync(ws, { recursive: true, force: true });
});

test("AC2 — a (delete)-tagged retired path is a CLEANUP action, not a dead signal", () => {
  const ws = makeWorkspace();
  // Touches reference a retired script path but explicitly tagged (delete) → the task will REMOVE
  // the stale reference (cleanup), it does not target the retired mechanism as work → alive.
  writeTask(ws, "CLEANUP", "needs-human", [
    ".claude/workflows/prepare-milestone.js (delete)",
    "scripts/test.sh",
  ]);
  gitCommitAll(ws, new Date());
  const res = run(ws, "--json");
  const out = JSON.parse(res.stdout);
  const t = out.tasks.find((x) => x.id === "CLEANUP");
  assert.equal(t.deadRetired, false, `(delete)-tagged retired path must NOT be dead, got ${JSON.stringify(t)}`);
  assert.equal(t.alive, true);
  assert.equal(out.needs_human_dead_retired, 0);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("--supersede — no dead-retired tasks → nothing written, exit 0", () => {
  const ws = makeWorkspace();
  writeTask(ws, "ALIVE", "needs-human", ["scripts/test.sh"]);
  gitCommitAll(ws, new Date());
  const res = run(ws, "--supersede", "--json");
  assert.equal(res.status, 0);
  assert.deepEqual(JSON.parse(res.stdout).written, []);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("AC4 — the REAL repo's needs-human pool is classified dead/alive (partition is consistent)", () => {
  const res = run(REPO_ROOT, "--stale-days", "7", "--json");
  assert.equal(res.status, 0, `real-repo detector must exit 0, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.ok(out.needs_human_total > 0, `real repo must have needs-human tasks, got ${out.needs_human_total}`);
  // The credible-count guarantee is the PARTITION, not the current board's split: every needs-human
  // task is classified exactly one way (dead XOR alive), the classes sum to the total, and a
  // dead-retired task always carries a retired-mechanism reason. (Do not pin dead/alive counts to
  // today's board — they change the moment the outer loop runs `--supersede`; the partition
  // consistency is what survives.)
  assert.equal(out.needs_human_dead_retired + out.needs_human_alive, out.needs_human_total,
    `dead+alive must equal total, got ${out.needs_human_dead_retired}+${out.needs_human_alive} vs ${out.needs_human_total}`);
  for (const t of out.tasks) {
    assert.notEqual(t.deadRetired && t.alive, true, `real task ${t.id} cannot be both dead and alive`);
    assert.equal(t.deadRetired, t.deadReason !== null, `task ${t.id} deadRetired must match deadReason presence`);
    if (t.deadRetired) {
      assert.ok(
        /prepare-milestone\.js|execute-milestone\.js|milestone-worktree\.ts/.test(t.deadReason),
        `task ${t.id} deadReason must name a retired script, got ${t.deadReason}`,
      );
    }
  }
});
