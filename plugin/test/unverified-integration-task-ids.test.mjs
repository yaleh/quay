// @test-group engine
// unverified-integration-task-ids.test.mjs — gap-ac19-two-line-model-actually-runs AC3: the
// unverified-integration-task-ids.ts helper that feeds the fork-baseline `--overlaps-unverified`
// argument with REAL task ids, so the overlap determination path can no longer be permanently dead.
//
// The two-line model's fork baseline (integration-branch-model.ts:47) has TWO determination paths:
//   * declaredDependency            — prose dependency declaration
//   * overlapsUnverifiedIntegration — the candidate's `## Touches` intersect an UNVERIFIED task
//     already merged to integration
// The dispatch caller feeds the second path via `--overlaps-unverified <id,...>`. The AC3 defect
// (2026-08-08 09:3x): the caller always passed the EMPTY string, so the overlap path could never
// fire. This helper extracts the real unverified task ids from `git log --oneline develop..integration`
// (the Contract invoke — integration-branch-model.ts:139) so the dispatch step pipes them in
// mechanically. Tests cover:
//   (a) a real git fixture with develop..integration fan-in merges → the extracted task ids
//   (b) integration an ancestor of develop (window closed) → empty stdout
//   (c) end-to-end: `integration-branch-model.ts --fork-baseline --overlaps-unverified <real ids>`
//       returns "integration" when the candidate's Touches overlap an unverified task's Touches,
//       "develop" when disjoint — the LIVE proof the overlap path is no longer dead.
//
// All fixtures are self-contained temp git repos; nothing in the real checkout is mutated (R3
// test-isolation).
//
// Run:
//   scripts/test.sh plugin/test/unverified-integration-task-ids.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { extractTaskIds } from "../scripts/unverified-integration-task-ids.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const helperCli = join(repoRoot, "plugin", "scripts", "unverified-integration-task-ids.ts");
const integrationModelCli = join(repoRoot, "plugin", "scripts", "integration-branch-model.ts");

// ── git-fixture helpers (branch-model.test.mjs style) ──────────────────────────────────────────────

function gitCmd(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runNode(args, opts = {}) {
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", ...args], {
    encoding: "utf8",
    ...opts,
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `uv-ids-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function initGitRepo(dir, user = "uv-ids-test", email = "uv@example.com") {
  gitCmd(dir, "init", "-q");
  gitCmd(dir, "config", "user.name", user);
  gitCmd(dir, "config", "user.email", email);
}

function commitAll(dir, message) {
  gitCmd(dir, "add", "-A");
  const res = gitCmd(dir, "commit", "-q", "-m", message);
  assert.equal(res.status, 0, `commit "${message}" failed: ${res.stderr}`);
}

function writeTask(dir, id, touchesLines) {
  mkdirSync(join(dir, "tasks"), { recursive: true });
  const body = `---\nid: ${id}\n---\n\n## Touches\n\n${touchesLines.map((t) => `- ${t}`).join("\n")}\n`;
  writeFileSync(join(dir, "tasks", `${id}.md`), body, "utf8");
}

// Fan in one task branch into integration with a realistic fan-in merge subject.
function fanInTask(dir, id, touchesLines, mergeMsg) {
  writeTask(dir, id, touchesLines);
  commitAll(dir, `add ${id} body`);
  gitCmd(dir, "checkout", "-q", "-b", `task/${id}`);
  writeFileSync(join(dir, `${id}.txt`), `${id} work\n`, "utf8");
  commitAll(dir, `${id} work`);
  gitCmd(dir, "checkout", "-q", "integration");
  const res = gitCmd(dir, "merge", "--no-ff", "-q", `task/${id}`, "-m", mergeMsg);
  assert.equal(res.status, 0, `merge of task/${id} failed: ${res.stderr}`);
}

// ── pure extraction (branch coverage) ──────────────────────────────────────────────────────────────

test("extractTaskIds: task/<id> and gap-<id> patterns, deduped, in first-seen order", () => {
  const msgs = [
    "merge: fan-in task/gap-uv-a...→integration",
    "inner fan-in: gap-uv-b (...) (parent gap-uv-a)",
    "Merge branch 'task/dir-124-b2'",
    "unrelated commit (no ids here)",
  ];
  assert.deepEqual(extractTaskIds(msgs), ["gap-uv-a", "gap-uv-b", "dir-124-b2"]);
});

test("extractTaskIds: gap- inside task/gap- dedupes (one id, not two)", () => {
  const msgs = ["merge: fan-in task/gap-abc...→integration"];
  assert.deepEqual(extractTaskIds(msgs), ["gap-abc"]);
});

test("extractTaskIds: empty messages → empty", () => {
  assert.deepEqual(extractTaskIds([]), []);
});

// ── (a) real git fixture: develop..integration fan-in merges → extracted task ids ─────────────────

test("(a) develop..integration fan-in merges yield the extracted task ids", () => {
  const dir = makeTmp("ids");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");

    fanInTask(dir, "gap-uv-a", ["plugin/loop/fast-mode-loop-tick.md"], "merge: fan-in task/gap-uv-a...→integration");
    fanInTask(dir, "gap-uv-b", ["plugin/scripts/some.ts"], "inner fan-in: gap-uv-b (...)");
    fanInTask(dir, "dir-124-b2", ["plugin/scripts/other.ts"], "Merge branch 'task/dir-124-b2'");

    const r = runNode([helperCli, "--root", dir]);
    assert.equal(r.status, 0, r.stderr);
    // `git log --oneline` is newest-first — the helper preserves git-log order (same as
    // fork-baseline.ts deriveUnverifiedTaskIds); order is irrelevant to the `some()` overlap check.
    assert.equal(r.stdout.trim(), "dir-124-b2,gap-uv-b,gap-uv-a", `got: ${r.stdout}`);
  } finally {
    cleanup(dir);
  }
});

// ── (b) integration an ancestor of develop → empty stdout ─────────────────────────────────────────

test("(b) integration an ancestor of develop (window closed) → empty stdout", () => {
  const dir = makeTmp("empty");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");
    // Develop advances alone (e.g. the batch merge already absorbed integration) →
    // develop..integration is empty.
    gitCmd(dir, "checkout", "-q", "develop");
    writeFileSync(join(dir, "dev.txt"), "dev\n", "utf8");
    commitAll(dir, "develop-only work");

    const r = runNode([helperCli, "--root", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "", "no unverified tasks when integration is an ancestor of develop");
  } finally {
    cleanup(dir);
  }
});

// ── (c) end-to-end: --fork-baseline with REAL ids — overlap ⇒ integration, disjoint ⇒ develop ────

test("(c) --fork-baseline with real unverified ids fires the overlap path (integration) and stays develop when disjoint", () => {
  const dir = makeTmp("e2e");
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "base.txt"), "base\n", "utf8");
    commitAll(dir, "base");
    gitCmd(dir, "branch", "-M", "develop");
    gitCmd(dir, "checkout", "-q", "-b", "integration");

    // The unverified task on integration touches plugin/loop/fast-mode-loop-tick.md.
    fanInTask(dir, "gap-uv-overlap", ["plugin/loop/fast-mode-loop-tick.md"], "merge: fan-in task/gap-uv-overlap...→integration");

    // Candidate A touches the SAME file → must fork from integration.
    writeTask(dir, "candidate-overlap", ["plugin/loop/fast-mode-loop-tick.md"]);
    // Candidate B touches a DISJOINT file → must fork from develop.
    writeTask(dir, "candidate-disjoint", ["plugin/scripts/something-else.ts"]);

    const ids = runNode([helperCli, "--root", dir]).stdout.trim();
    assert.equal(ids, "gap-uv-overlap", `helper must derive the unverified id: ${ids}`);

    const rOverlap = runNode([
      integrationModelCli,
      "--fork-baseline",
      join(dir, "tasks", "candidate-overlap.md"),
      "--overlaps-unverified", ids,
      "--root", dir,
    ]);
    assert.equal(rOverlap.status, 0, rOverlap.stderr);
    assert.equal(rOverlap.stdout.trim(), "integration", `overlapping candidate must fork from integration: ${rOverlap.stdout}`);

    const rDisjoint = runNode([
      integrationModelCli,
      "--fork-baseline",
      join(dir, "tasks", "candidate-disjoint.md"),
      "--overlaps-unverified", ids,
      "--root", dir,
    ]);
    assert.equal(rDisjoint.status, 0, rDisjoint.stderr);
    assert.equal(rDisjoint.stdout.trim(), "develop", `disjoint candidate must fork from develop: ${rDisjoint.stdout}`);
  } finally {
    cleanup(dir);
  }
});
