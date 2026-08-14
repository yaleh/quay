// @test-group engine
// fast-mode-telemetry-gitignore.test.mjs — gap-b15-telemetry-snapshot-untracked: telemetry
// snapshots (`milestones/fast-mode-telemetry/*.json`) are RUNTIME telemetry, not code — the SAME
// family as `.quay/gate-events.jsonl` and `orchestration/manager-tick-log.md` (the `.gitignore:242`
// classification the task's Touches point at). Before this task, B6's per-tick `--snapshot` was
// committed ~14×/6h; each commit advanced develop and could interrupt ff-only fan-in inside an
// in-flight suite window (`fan-in-ff-merge.sh:123` requires `git status --porcelain` empty, and a
// tracked telemetry file dirties it). The fix: gitignore the glob + `git rm --cached` (history
// preserved, disk file kept ⇒ disk readers unaffected). This test is the executable guard:
//
//   * 判据1/3 — the glob is gitignored AND `git status --porcelain` for the telemetry dir is empty
//                even with a freshly-written snapshot on disk (runtime state must not appear in
//                porcelain — same family as the B15-fan-in-clean-tree gate).
//   * 判据2 — `git rm --cached` keeps the working-tree file (readers read DISK, not git: the
//                writer `writeAggregateReport` uses fs.writeFileSync to the disk path).
//   * 判据4 (能取假·真样本) — a checker that counts telemetry commits over a range goes RED on the
//                REAL 14-commit 6h sample (cc8bbed41..HEAD: 22431170@01:31 → d6db1483@06:03),
//                proving the failure mode was real and the check is not structurally always-green;
//                the green side is `git ls-files` empty (nothing left to commit) + porcelain clean.
//
// Run:
//   scripts/test.sh plugin/test/fast-mode-telemetry-gitignore.test.mjs
//   node --test plugin/test/fast-mode-telemetry-gitignore.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
const REPO_ROOT = findRepoRoot(__dirname);

const TELEMETRY_GLOB = "milestones/fast-mode-telemetry/*.json";
// A real, on-disk snapshot path (present in any worktree that has run B6 at least once; used for
// check-ignore which matches the pattern against the path regardless of disk presence).
const SNAPSHOT_SAMPLE = "milestones/fast-mode-telemetry/2026-08-14.json";

// The REAL sample: the 14 telemetry commits in the 6h window the task's §7 analysis measured
// (2026-08-14 01:31 22431170 → 06:03 d6db1483). `22431170~1` (= cc8bbed41) is the boundary below
// the oldest sample commit, so `cc8bbed41..HEAD` isolates exactly the measured window even as HEAD
// advances (this commit's gitignore change never touches telemetry files, so the count is stable).
const SAMPLE_RANGE_OLDEST = "22431170~1";
const SAMPLE_NEWEST_COMMIT = "d6db1483";

function countTelemetryCommits(range) {
  const out = execFileSync("git", ["log", "--format=%H %s", range, "--", "milestones/fast-mode-telemetry/"], {
    cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

function gitStatusPorcelainForTelemetry() {
  const out = execFileSync("git", ["status", "--porcelain", "--", "milestones/fast-mode-telemetry/"], {
    cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

test("AC1/AC3 — the telemetry glob is gitignored and porcelain stays clean for the dir", () => {
  // 判据1: git check-ignore must hit the glob (works even if the file is absent on disk).
  const out = execFileSync("git", ["check-ignore", SNAPSHOT_SAMPLE], {
    cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  assert.ok(out.trim().length > 0, `git check-ignore must hit ${SNAPSHOT_SAMPLE}, got empty`);

  // 判据3: nothing under the telemetry dir appears in porcelain (runtime state not in porcelain).
  const dirty = gitStatusPorcelainForTelemetry();
  assert.equal(dirty.length, 0, `git status --porcelain must be empty for the telemetry dir, got: ${JSON.stringify(dirty)}`);
});

test("AC1 — the .gitignore entry carries the :242-family classification comment", () => {
  const gitignore = fs.readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  assert.match(gitignore, /milestones\/fast-mode-telemetry\/\*\.json/,
    ".gitignore must contain the telemetry glob");
  assert.match(gitignore, /运行时遥测|运行时状态/,
    ".gitignore telemetry comment must classify it as runtime telemetry (same family as :242)");
  assert.match(gitignore, /git rm --cached|历史保留|历史 12 个提交/,
    ".gitignore telemetry comment must record the git rm --cached / history-preserved decision");
});

test("AC2 — writer uses the DISK path (fs.writeFileSync), and git rm --cached keeps the disk file", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "plugin", "scripts", "fast-mode-telemetry.ts"), "utf8");
  // Positional check: writeAggregateReport writes to <root>/milestones/fast-mode-telemetry/<date>.json
  // via fs.writeFileSync — a disk write that gitignore cannot affect. If a future refactor routes the
  // snapshot through git (e.g. `git commit`), readers of the disk file silently break — that is the
  // exact recurrence this fixture exists to catch.
  const writeBlock = src.slice(src.indexOf("export function writeAggregateReport"), src.indexOf("// ── Human-readable report"));
  assert.match(writeBlock, /fs\.writeFileSync\(file, /, "writeAggregateReport must write the snapshot via fs.writeFileSync");
  assert.match(writeBlock, /milestones[\"']?,?\s*[\"']fast-mode-telemetry/, "writeAggregateReport must target the milestones/fast-mode-telemetry dir");

  // git rm --cached (not `git rm`): the file must STAY on disk when it is present. In a worktree
  // that has run B6, the snapshot file exists on disk and must be readable (readers unaffected).
  if (fs.existsSync(path.join(REPO_ROOT, SNAPSHOT_SAMPLE))) {
    const stat = fs.statSync(path.join(REPO_ROOT, SNAPSHOT_SAMPLE));
    assert.ok(stat.size > 0, "the on-disk snapshot must remain present and readable after git rm --cached");
  }
});

test("AC4 — 真样本回放: the real 14-commit 6h window replays RED (telemetry WAS committed → could break ff)", () => {
  // 能取假 (negative control): count telemetry commits over the measured real window. Before
  // gitignore-ization each of these advanced develop and could interrupt ff-only fan-in inside an
  // in-flight suite window. The checker (git log count) is NOT structurally always-green — it must
  // find the real 14 commits. If a future refactor re-tracks telemetry and starts committing again,
  // this count grows and the red replay keeps catching it.
  const commits = countTelemetryCommits(`${SAMPLE_RANGE_OLDEST}..HEAD`);
  assert.ok(commits.length >= 14,
    `expected the real ≥14-commit 6h telemetry window, got ${commits.length}: [${commits.slice(0, 3).join(", ")}...]`);
  assert.ok(commits.some((c) => c.startsWith(SAMPLE_NEWEST_COMMIT)),
    `the newest 6h sample commit ${SAMPLE_NEWEST_COMMIT} must be present in the replay`);
});

test("AC4 — green side: nothing is left tracked to commit (git ls-files empty)", () => {
  const out = execFileSync("git", ["ls-files", "--", "milestones/fast-mode-telemetry/"], {
    cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  });
  const tracked = out.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.equal(tracked.length, 0,
    `git rm --cached must leave zero tracked telemetry files, got ${tracked.length}: [${tracked.join(", ")}]`);
});

test("AC1/AC3 — a freshly-written snapshot (the B6 per-tick write) does NOT dirty porcelain", () => {
  // Simulate B6's per-tick `--snapshot` write (writeAggregateReport → fs.writeFileSync). The new
  // file must be ignored immediately — porcelain must not list it, and check-ignore must hit it.
  const probe = path.join(REPO_ROOT, "milestones", "fast-mode-telemetry", "zz-gitignore-probe.json");
  const probeRel = "milestones/fast-mode-telemetry/zz-gitignore-probe.json";
  // git tracks no empty dir and the telemetry files are untracked+ignored, so a fresh checkout
  // never materializes milestones/fast-mode-telemetry/ — create it before writing the probe.
  fs.mkdirSync(path.dirname(probe), { recursive: true });
  fs.writeFileSync(probe, '{"probe":true}\n', "utf8");
  try {
    const dirty = gitStatusPorcelainForTelemetry();
    assert.equal(dirty.length, 0,
      `a fresh snapshot write must not dirty porcelain, got: ${JSON.stringify(dirty)}`);
    const out = execFileSync("git", ["check-ignore", probeRel], {
      cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    assert.ok(out.trim().length > 0, `fresh write ${probeRel} must be gitignored`);
  } finally {
    try { fs.unlinkSync(probe); } catch { /* already gone */ }
  }
});
