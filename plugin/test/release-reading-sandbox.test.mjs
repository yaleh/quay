// @test-group engine
// release-reading-sandbox.test.mjs — tests for the isolated release-shaped version READING carrier
// (tasks/gap-ac271-build-reading-creates-shared-release-ref; SPEC-release-and-hotfix-branching-2026-09-15.md
// §4.1.2).
//
// THE DEFECT THIS CARRIER CLOSES: `resolve-version.ts` decides `build` mode BY BRANCH NAME, so every
// REAL build-mode verification must put HEAD on a REAL `release/*` branch — while AC-271 forbids a
// local `release/*` whose tip is not a tag. Measured 2026-09-20T04:51:07Z → 04:53:26Z: a worker took
// exactly that reading, AC-271 went `verdict=fail` (`release/ac4-reading`), and BOTH the creation and
// the cleanup left ZERO repository trace. Two individually-correct mechanisms, one conflict, no
// attributable record.
//
// The fix is NAMESPACE SEPARATION, not a looser criterion. These tests hold BOTH halves at once, so a
// regression in either turns RED:
//   (a) the reading really happens on a REALLY-NAMED release branch — proved by reading the kept
//       sandbox's own `symbolic-ref`, not by trusting the tool's stdout;
//   (b) the SOURCE repo's `refs/heads/release-*` / `refs/heads/release/*` enumeration stays empty
//       for the whole run — the same enumeration AC-271 makes;
//   (c) the sandbox is SELF-CLEANED (its path is gone; the source repo gains no worktree).
//
// Plus the paired negative control (hard rule 4 推论三 — a reading that can only ever produce one
// value is an echo, not a measurement): the SAME command gives the un-suffixed `X.Y.Z` on a
// `release/*` branch and `X.Y.Z-dev` on any other branch. Only the second reading proves the first
// one is taking a decision.
//
// Plus the record (hard rule 9): a taken reading is readable back with `--log`, and "never happened"
// (exit 4) / "unreadable" (exit 5) each keep their OWN exit code and `CAUSE=`, never sharing an
// output shape with "ran and recorded" (hard rule 3b). The record's vocabulary is checked here so a
// future edit cannot quietly re-use `.quay/release-branch-finish.jsonl`'s `form=` word (hard rule 8).
//
// All fixtures are self-contained temp git repos + temp trace paths; nothing in the real checkout is
// mutated (R3 test-isolation). `scripts/resolve-version.ts` is COPIED into each fixture so the
// reading runs the real judgment against a real git object — ⛔ never against the live repo.
//
// Run:
//   scripts/test.sh plugin/test/release-reading-sandbox.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const SCRIPT = join(repoRoot, "plugin", "scripts", "release-reading-sandbox.ts");
const RESOLVER = join(repoRoot, "scripts", "resolve-version.ts");

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(args, opts = {}) {
  const res = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", SCRIPT, ...args],
    { encoding: "utf8", ...opts },
  );
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runJson(args) {
  const r = run([...args, "--json"]);
  let payload = null;
  try {
    payload = JSON.parse(r.stdout);
  } catch {
    payload = null;
  }
  return { ...r, payload };
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

/** The enumerated release branches in a repo — the same read AC-271's criterion makes. */
function releaseBranches(root) {
  const r = git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads/release-*", "refs/heads/release/*");
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean).sort();
}

/** The enumerated worktrees of a repo (a sandbox must never appear here). */
function worktreePaths(root) {
  const r = git(root, "worktree", "list", "--porcelain");
  return r.stdout.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9)).sort();
}

/**
 * A temp repo carrying the REAL `scripts/resolve-version.ts` and a `VERSION` file, so the reading
 * this tool delegates to is the real judgment (not a re-implementation) running against a real git
 * object. `.quay/` is gitignored for the same reason the real repo gitignores its runtime carriers:
 * a fixture `git add -A` must not sweep the record into a commit.
 */
function makeRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), `release-reading-sandbox-${prefix}-`));
  assert.equal(git(root, "init", "-q").status, 0);
  git(root, "config", "user.name", "test");
  git(root, "config", "user.email", "test@example.com");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(RESOLVER, join(root, "scripts", "resolve-version.ts"));
  writeFileSync(join(root, "VERSION"), "9.9.9\n", "utf8");
  writeFileSync(join(root, ".gitignore"), ".quay/\n", "utf8");
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "seed").status, 0);
  assert.equal(git(root, "branch", "develop").status, 0);
  return { root };
}

function tempTracePath(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `release-reading-trace-${prefix}-`));
  return { dir, file: join(dir, "reading.jsonl") };
}

// ── the paired reading: the same command, two branch shapes (hard rule 4 推论三) ────────────────

test("paired reading: release/* gives the un-suffixed form, any other branch gives -dev", () => {
  const w = makeRepo("pair");
  const t = tempTracePath("pair");
  try {
    const rel = runJson([
      "--root", w.root,
      "--rev", "HEAD",
      "--branch", "release/v9.9.9-reading",
      "--trace", t.file,
    ]);
    assert.equal(rel.status, 0, `release-shaped reading must succeed:\n${rel.stdout}\n${rel.stderr}`);
    assert.equal(rel.payload?.shape, "release-branch");
    assert.equal(rel.payload?.version, "9.9.9", "a release/* branch must read with NO suffix");
    assert.equal(rel.payload?.evaluated, true);

    const plain = runJson([
      "--root", w.root,
      "--rev", "HEAD",
      "--branch", "reading-plain-271",
      "--trace", t.file,
    ]);
    assert.equal(plain.status, 0, `non-release reading must succeed:\n${plain.stdout}\n${plain.stderr}`);
    assert.equal(plain.payload?.shape, "non-release-branch");
    assert.equal(
      plain.payload?.version,
      "9.9.9-dev",
      "the SAME command on a non-release branch must give the -dev form — otherwise the release " +
        "reading is an echo of a constant, not a measurement",
    );

    // The two readings must be from the same resolver on the same commit: only the branch differs.
    assert.equal(rel.payload?.sha, plain.payload?.sha);
  } finally {
    cleanup(w.root);
    cleanup(t.dir);
  }
});

// ── namespace separation: the source repo's release namespace is untouched ──────────────────────

test("the reading never enters the SOURCE repo's release namespace (AC-271's own enumeration)", () => {
  const w = makeRepo("isolation");
  const t = tempTracePath("isolation");
  try {
    assert.deepEqual(releaseBranches(w.root), [], "fixture precondition: no release branch before");
    const worktreesBefore = worktreePaths(w.root);

    const r = runJson([
      "--root", w.root,
      "--branch", "release/v9.9.9-isolated",
      "--trace", t.file,
    ]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);

    assert.deepEqual(r.payload?.sourceReleaseRefsBefore, [], "BEFORE the reading: namespace empty");
    assert.deepEqual(r.payload?.sourceReleaseRefsAfter, [], "AFTER the reading: namespace still empty");
    assert.deepEqual(releaseBranches(w.root), [], "the tool must not have created a release branch here");
    // Asked by its exact ref name too, so "the enumeration returned nothing" cannot be an artefact
    // of the glob: the ref the reading used must not be resolvable in the source repo at all.
    assert.notEqual(
      git(w.root, "rev-parse", "--verify", "--quiet", "refs/heads/release/v9.9.9-isolated").status,
      0,
      "the release-shaped ref the reading used must not exist in the source repo",
    );

    // (c) self-cleanup: the sandbox path is gone and no worktree was added to the source repo.
    assert.equal(r.payload?.sandboxRemoved, true, "the sandbox must remove itself");
    assert.equal(existsSync(String(r.payload?.sandbox)), false, "the sandbox path must not exist afterwards");
    assert.deepEqual(worktreePaths(w.root), worktreesBefore, "no worktree may be added to the source repo");
  } finally {
    cleanup(w.root);
    cleanup(t.dir);
  }
});

test("--keep proves the branch really exists — IN THE SANDBOX, not in the source repo", () => {
  const w = makeRepo("keep");
  const t = tempTracePath("keep");
  let sandbox = null;
  try {
    const r = runJson([
      "--root", w.root,
      "--branch", "release/v9.9.9-kept",
      "--trace", t.file,
      "--keep",
    ]);
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    sandbox = String(r.payload?.sandbox);
    assert.equal(r.payload?.sandboxRemoved, false, "--keep must leave it on disk");

    // The reading was about a REAL branch of that name — read from the sandbox's own HEAD, not from
    // the tool's stdout (a tool that never created the branch could print the same line).
    assert.equal(existsSync(sandbox), true);
    assert.equal(
      git(sandbox, "symbolic-ref", "--short", "HEAD").stdout.trim(),
      "release/v9.9.9-kept",
      "the sandbox HEAD must really be the release-shaped branch",
    );
    assert.deepEqual(
      git(sandbox, "for-each-ref", "--format=%(refname:short)", "refs/heads/release-*", "refs/heads/release/*")
        .stdout.split("\n").map((s) => s.trim()).filter(Boolean),
      ["release/v9.9.9-kept"],
      "the release branch exists — in the sandbox",
    );
    // …and the source repo still holds none of it. This is the namespace separation, held at once.
    assert.deepEqual(releaseBranches(w.root), []);
  } finally {
    if (sandbox) cleanup(sandbox);
    cleanup(w.root);
    cleanup(t.dir);
  }
});

// ── fetch-by-sha: the repo's real offender is reachable from NO surviving ref ───────────────────

test("a commit reachable from no surviving ref can still be read (fetch by sha)", () => {
  const w = makeRepo("orphan");
  const t = tempTracePath("orphan");
  try {
    assert.equal(git(w.root, "checkout", "-q", "-b", "release/v9.9.9-doomed", "develop").status, 0);
    writeFileSync(join(w.root, "marker.txt"), "never merged\n", "utf8");
    assert.equal(git(w.root, "add", "-A").status, 0);
    assert.equal(git(w.root, "commit", "-q", "-m", "orphan tip").status, 0);
    const sha = git(w.root, "rev-parse", "HEAD").stdout.trim();
    assert.equal(git(w.root, "checkout", "-q", "develop").status, 0);
    // Delete the branch: the commit is now reachable from no ref at all — exactly the state
    // df538caa6 (the 2026-09-20 offender) was left in after `git branch -D release/ac4-reading`.
    assert.equal(git(w.root, "branch", "-D", "release/v9.9.9-doomed").status, 0);
    assert.notEqual(git(w.root, "rev-parse", "--verify", "--quiet", "release/v9.9.9-doomed").status, 0);
    assert.deepEqual(releaseBranches(w.root), []);

    const r = runJson([
      "--root", w.root,
      "--rev", sha,
      "--branch", "release/v9.9.9-orphan-reading",
      "--trace", t.file,
    ]);
    assert.equal(r.status, 0, `an unreachable-but-present commit must still be readable:\n${r.stderr}`);
    assert.equal(r.payload?.sha, sha);
    assert.equal(r.payload?.version, "9.9.9");
    assert.deepEqual(releaseBranches(w.root), [], "reading an orphan commit must not re-create a ref");
  } finally {
    cleanup(w.root);
    cleanup(t.dir);
  }
});

// ── the record: readable back, and "never happened" keeps its own value (hard rule 3b/9) ────────

test("a taken reading is readable back with --log (time / branch / shape / result)", () => {
  const w = makeRepo("log");
  const t = tempTracePath("log");
  try {
    assert.equal(run(["--root", w.root, "--branch", "release/v9.9.9-logged", "--trace", t.file]).status, 0);

    const back = run(["--log", "--trace", t.file]);
    assert.equal(back.status, 0, `--log on a written record must succeed:\n${back.stderr}`);
    assert.match(back.stdout, /release\/v9\.9\.9-logged/, "the branch name must be readable back");
    assert.match(back.stdout, /shape=release-branch/);
    assert.match(back.stdout, /version=9\.9\.9/);
    assert.match(back.stdout, /result=taken/);
    assert.match(back.stdout, /trace: 1 record\(s\)/);
    // The timestamp is present and ISO-shaped (the record answers "when", not only "what").
    assert.match(back.stdout, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  } finally {
    cleanup(w.root);
    cleanup(t.dir);
  }
});

test("repeated readings append — the record is a log, not a last-write-wins slot", () => {
  const w = makeRepo("append");
  const t = tempTracePath("append");
  try {
    assert.equal(run(["--root", w.root, "--branch", "release/v9.9.9-a", "--trace", t.file]).status, 0);
    assert.equal(run(["--root", w.root, "--branch", "reading-plain-b", "--trace", t.file]).status, 0);

    const back = run(["--log", "--trace", t.file]);
    assert.equal(back.status, 0);
    assert.match(back.stdout, /trace: 2 record\(s\)/);
    // Both shapes are in the record — the pair is auditable after the fact, not only on stdout.
    const lines = readFileSync(t.file, "utf8").split("\n").filter((l) => l.trim());
    assert.equal(lines.length, 2);
    assert.deepEqual(
      lines.map((l) => JSON.parse(l).shape).sort(),
      ["non-release-branch", "release-branch"],
    );
  } finally {
    cleanup(w.root);
    cleanup(t.dir);
  }
});

test("'never happened' is an INDEPENDENT value: exit 4 + its own CAUSE, never exit 0", () => {
  const t = tempTracePath("never");
  try {
    const r = run(["--log", "--trace", t.file]);
    assert.notEqual(r.status, 0, "an absent record must NOT read as a successful --log");
    assert.equal(r.status, 4, `expected the dedicated never-happened code, got ${r.status}`);
    assert.match(r.stderr, /CAUSE=release-reading-trace-missing/);
    // It must say "never recorded", not "recorded nothing".
    assert.doesNotMatch(r.stdout, /trace: 0 record\(s\)/);
  } finally {
    cleanup(t.dir);
  }
});

test("'could not look' is a THIRD value: exit 5 + release-reading-trace-unreadable (hard rule 3b)", () => {
  const t = tempTracePath("unreadable");
  try {
    // A directory at the record path exists but cannot be read as a record.
    const asDir = join(t.dir, "record-as-dir.jsonl");
    mkdirSync(asDir);

    const r = run(["--log", "--trace", asDir]);
    assert.equal(r.status, 5, `expected the dedicated unreadable code, got ${r.status}`);
    assert.match(r.stderr, /CAUSE=release-reading-trace-unreadable/);
    // Three states, three codes: taken (0) / never (4) / unreadable (5). No two share one shape.
    assert.notEqual(r.status, 4);
    assert.notEqual(r.status, 0);
  } finally {
    cleanup(t.dir);
  }
});

// ── vocabulary (hard rule 8): the record must not re-use the finish record's word ───────────────

test("the record's vocabulary does not re-use the finish record's `form=` word or values", () => {
  const w = makeRepo("vocab");
  const t = tempTracePath("vocab");
  try {
    assert.equal(run(["--root", w.root, "--branch", "release/v9.9.9-vocab", "--trace", t.file]).status, 0);
    const line = readFileSync(t.file, "utf8").split("\n").find((l) => l.trim());
    const rec = JSON.parse(line);

    assert.equal(Object.prototype.hasOwnProperty.call(rec, "form"), false,
      "the reading record must not carry a `form=` key — that word belongs to " +
      ".quay/release-branch-finish.jsonl, a different carrier answering a different question");
    // The values it DOES use are outside the finish record's vocabulary (none/merged/tagged/cut/…).
    const FINISH_FORM_VALUES = new Set(["none", "merged", "tagged", "cut"]);
    assert.equal(FINISH_FORM_VALUES.has(rec.shape), false, `shape=${rec.shape} collides with form= values`);
    assert.ok(
      ["release-branch", "non-release-branch"].includes(rec.shape),
      `unexpected shape vocabulary: ${rec.shape}`,
    );
    assert.ok(["taken", "not-evaluated", "reading-error"].includes(rec.result));
  } finally {
    cleanup(w.root);
    cleanup(t.dir);
  }
});

// ── instrument failures never read as "no release branch" (hard rule 3b) ────────────────────────

test("a non-repo --root is an INSTRUMENT failure (exit 2 + CAUSE), never an empty reading", () => {
  const plain = mkdtempSync(join(tmpdir(), "release-reading-notarepo-"));
  const t = tempTracePath("notarepo");
  try {
    const r = run(["--root", plain, "--trace", t.file]);
    assert.equal(r.status, 2, `expected an instrument failure, got ${r.status}:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-reading-source-unreadable/);
    // ⛔ The dangerous shape would be exit 0 with an empty namespace — "could not look" as "none".
    assert.doesNotMatch(r.stdout, /source release refs BEFORE = 0/);
  } finally {
    cleanup(plain);
    cleanup(t.dir);
  }
});

test("an unresolvable --rev is an instrument failure (exit 2 + its own CAUSE)", () => {
  const w = makeRepo("badrev");
  const t = tempTracePath("badrev");
  try {
    const r = run(["--root", w.root, "--rev", "no-such-rev-271", "--trace", t.file]);
    assert.equal(r.status, 2, `expected an instrument failure, got ${r.status}`);
    assert.match(r.stderr, /CAUSE=release-reading-rev-unresolvable/);
  } finally {
    cleanup(w.root);
    cleanup(t.dir);
  }
});

test("--help exits 0 and mutates nothing", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /usage:.*release-reading-sandbox/);
});
