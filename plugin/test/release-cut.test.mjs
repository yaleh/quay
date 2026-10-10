// @test-group engine
// release-cut.test.mjs — tests for `plugin/scripts/release-cut.sh`, the ONE-COMMAND release cut
// (gap-release-cut-single-carrier-and-main-ledger-trace; SPEC-release-and-hotfix-branching
// §4 + §12; AC-320).
//
// WHY THIS FILE EXISTS: the 2026-09-24 v0.12.0 cut was performed as ~12 hand-remembered steps and
// two of them bit — the finish record landed in a scratch clone instead of the main checkout, and
// the next-version bump silently required a closure-ratchet re-anchor. The command under test is
// that sequence, mechanised. ADR-004: prose gets paraphrased away, so the rule ships with its
// execution face.
//
// What is pinned here:
//   • the DRY RUN: exits 0 on a healthy tree, prints EVERY step in order (the linked worktree path,
//     the `--root` the landing face receives, the ledger's ABSOLUTE path, the next-version bump and
//     the ratification re-anchor), and writes nothing (`git status --porcelain` byte-identical).
//   • the PREFLIGHT fails closed, and each failure has its OWN `CAUSE=` and creates NO worktree:
//     an existing tag, a tree whose version carriers disagree with VERSION, a tree with tracked
//     edits. Distinct CAUSEs matter: "the version is wrong" and "the tree is dirty" are different
//     repairs, and a shared output shape would make them indistinguishable.
//   • the LANDING ROOT: the ledger named by the dry run IS the main checkout's ledger, and a real
//     cut from the linked worktree this command creates writes there — the AC-320 property, checked
//     end-to-end rather than by reading the carrier's source.
//
// Fixtures are clones of THIS repository, cloned with `git clone --local --no-hardlinks` (no
// network, no `file://` transport; objects are COPIED) so the real
// `scripts/version-consistency-check.ts` and carrier files are present: the
// version-consistency preflight must be able to pass on a healthy fixture, or "it failed because
// VERSION was wrong" would be indistinguishable from "it failed because the checker was missing".
// ⛔ Nothing in the real checkout is mutated (R3 test-isolation); every fixture is removed in a
// `finally`, including the worktrees the command creates.
//
// Run:
//   scripts/test.sh plugin/test/release-cut.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, existsSync, appendFileSync, writeFileSync, readFileSync, symlinkSync, statSync, linkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const SCRIPT = join(repoRoot, "plugin", "scripts", "release-cut.sh");

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(args, opts = {}) {
  const res = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

/**
 * The `st_dev` of the filesystem holding `p`, or null when it cannot be read at all.
 * ⛔ null is its own value, never folded into a verdict: "I could not measure" and "I measured and
 * it is fine" must not share an output (硬规则 3b).
 */
function deviceOf(p) {
  try { return statSync(p).dev; } catch (_) { return null; }
}

/**
 * Did this run have to link clone objects ACROSS filesystems — the premise that makes a hardlinking
 * `git clone --local` die with `EXDEV`? An ENUMERATED reading (`same` | `cross` | `unknown`), not a
 * boolean `ok`: with a boolean, "cross-device" (the failure premise) and "not measured" would print
 * the same value and the reading would carry no information.
 *
 * `st_dev` is compared, deliberately NOT `statfsSync().type`: the latter is the filesystem's MAGIC
 * NUMBER, which two distinct filesystems of the same type (two xfs mounts) share — it would answer
 * "same device" for different devices, i.e. a proxy that drifts from the fact it stands for
 * (硬规则 4b). `st_dev` is the exact quantity `link(2)` itself compares.
 */
function cloneLocality(parent) {
  const srcDev = deviceOf(join(repoRoot, ".git", "objects")) ?? deviceOf(repoRoot);
  const dstDev = deviceOf(parent);
  if (srcDev === null || dstDev === null) return { locality: "unknown", srcDev, dstDev };
  return { locality: srcDev === dstDev ? "same" : "cross", srcDev, dstDev };
}

/**
 * A throwaway clone of this repository: no network, no `file://` transport, objects COPIED rather
 * than hardlinked. The clone IS the fixture's "main checkout" and the command's `--root`, so the
 * toolchain, the carrier files and `VERSION` are all the real ones at the real relative paths.
 *
 * WHY `--no-hardlinks`: bare `--local` makes git hardlink every object and `die_errno("failed to
 * create link")` with NO copy fallback, the moment the destination is on another filesystem. That
 * premise belongs to the HOST, not to this repository — 2026-09-25, the repo is on /data (xfs)
 * while `os.tmpdir()` is `/` (ext4), so every test in this file died with `EXDEV` (pristine
 * baseline: 6 tests, 0 pass, 6 fail) and every fan-in's full suite was red develop-wide.
 * `--no-hardlinks` gives up the hardlinking only — the one part that cannot work cross-device —
 * and keeps the original intent (no network, no `file://` transport). The locality reading below
 * records which kind of host the run saw, instead of leaving that premise implicit in a comment.
 *
 * Returns { parent, root, locality } — `parent` is where the command would create its worktree,
 * which is how "no worktree was created" is checked; `locality` is that enumerated reading.
 */
function makeClone(prefix) {
  const parent = mkdtempSync(join(tmpdir(), `release-cut-${prefix}-`));
  // ⛔ CLEAN UP ON OUR OWN FAILURE. Every caller does `const c = makeClone(...); try {…} finally
  // { cleanup(c.parent); }` — which does NOT run when this function THROWS, because `c` was never
  // assigned. What leaks is a FULL CLONE OF THIS REPOSITORY (measured ~503 MB in os.tmpdir()).
  // Measured 2026-09-26: a red run of this file left 68 `release-cut-*` trees / 7.8 GB under
  // /tmp — which lives on the 50 GB ROOT filesystem of this host — filling it to 99% and killing an
  // UNRELATED scoped-gate run with ENOSPC (its log was truncated mid-line). The fixture's own
  // failure must not be able to damage the shared host, so reclaim `parent` here and rethrow.
  try {
    return makeCloneIn(parent, prefix);
  } catch (e) {
    cleanup(parent);
    throw e;
  }
}

function makeCloneIn(parent, prefix) {
  const root = join(parent, "repo");
  const { locality, srcDev, dstDev } = cloneLocality(parent);
  process.stdout.write(`SUITE-RELEASE-CUT-FIXTURE clone-locality=${locality}`
    + ` repo-dev=${srcDev ?? "unreadable"} tmp-dev=${dstDev ?? "unreadable"}\n`);
  const args = [
    "clone",
    "--local",
    "--no-hardlinks",
    "-q",
    repoRoot,
    root,
  ];
  const r = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(r.status, 0, `clone must succeed (clone-locality=${locality}): ${r.stderr}`);
  git(root, "config", "user.name", "test");
  git(root, "config", "user.email", "test@example.com");
  // A local `develop` (a clone only materialises the default branch) — the branch the cut merges
  // back into. It is NOT the checkout's own branch: mirror PRODUCTION's shape, where the main
  // checkout carries `author`. The cut has to check `develop` out in its own worktree, and git
  // permits that only if no other worktree holds it — a fixture sitting on `develop` would test a
  // state production never has (and would trip `CAUSE=release-cut-base-checked-out`).
  // ⛔ NOT unconditional. `git clone` materialises the SOURCE's HEAD branch as a LOCAL branch, and
  // on the CI runner the checkout's HEAD *is* `develop` (ci.yml triggers on push to develop), so a
  // bare `git branch develop origin/develop` died with `fatal: a branch named 'develop' already
  // exists` (exit 128) — every one of this file's 7 tests red, on a host where the fixture's premise
  // ("the main checkout carries `author`", see the comment above) does not hold. Measured
  // 2026-09-26: 128 !== 0 at this line on a fresh clone whose source was on `develop`; green when
  // the source was on `author`. Create the branch only when the clone has not already done so; the
  // `checkout -B author` right below puts HEAD where the premise requires in EITHER case, so the
  // fixture still presents production's shape (a `develop` branch that is not the checked-out one)
  // rather than a weaker one.
  if (git(root, "rev-parse", "--verify", "-q", "refs/heads/develop").status !== 0) {
    assert.equal(git(root, "branch", "develop", "origin/develop").status, 0);
  }
  assert.equal(git(root, "checkout", "-q", "-B", "author", "origin/develop").status, 0);
  // node_modules is gitignored, so a clone never has it — but the command links `--root`'s
  // node_modules into the release worktree, and the bump stage's closure-ratchet re-anchor runs a
  // REAL quay-init laydown that needs esbuild/node from there. Giving the fixture one makes the
  // bump stage runnable, so the happy path below is the real one rather than a graceful failure.
  const nm = join(repoRoot, "node_modules");
  if (existsSync(nm)) symlinkSync(nm, join(root, "node_modules"));
  return { parent, root, locality };
}

/**
 * Make the fixture's `develop` carry a `scripts/stamp-version.ts` that FAILS with a distinctive,
 * greppable reason and a non-zero exit, COMMITTED so the fixture stays clean and the release worktree
 * — cut off `develop` — inherits it. The bump stage then dies in `CAUSE=release-cut-bump-stamp-failed`,
 * which is where `diagnosticTail` has to carry the CHILD's own words into the CAUSE line.
 *
 * ⛔ The vehicle changed (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch): it
 * used to be the closure ratchet, which is retired. The INVARIANT under test is unchanged — a
 * fixed-CAUSE failure must carry the child process's own reason, never just fixed prose — and the
 * stamper is the other child on that same path.
 */
function breakStamperOnDevelop(root) {
  assert.equal(git(root, "rev-parse", "--verify", "-q", "refs/heads/develop").status, 0,
    "the fixture must already carry a local `develop`");
  assert.equal(git(root, "checkout", "-q", "develop").status, 0, "checkout develop to commit the edit");
  writeFileSync(join(root, "scripts", "stamp-version.ts"),
    'process.stderr.write("STAMPER-BLEW-UP: the fixture wants this exact sentence carried through\\n");\nprocess.exit(3);\n');
  assert.equal(git(root, "add", "scripts/stamp-version.ts").status, 0, "stage the broken stamper");
  assert.equal(git(root, "commit", "-q", "-m", "fixture: make stamp-version.ts fail with its own reason").status, 0,
    "the edit must be COMMITTED — an uncommitted edit would trip the dirty-tree preflight instead");
  assert.equal(git(root, "checkout", "-q", "author").status, 0, "return HEAD to `author` (production's shape)");
  assert.equal(git(root, "status", "--porcelain", "--untracked-files=no").stdout.trim(), "",
    "the fixture must be clean, or the cut would refuse on CAUSE=release-cut-dirty-tree for the wrong reason");
}

/**
 * A ref in the fixture whose `.github/workflows/release.yml` DIFFERS from `develop`'s, so the
 * `--dispatch-ref` preflight has a real disagreement to judge. Committed on a throwaway branch and
 * HEAD returned to `author`, so the fixture stays clean (an uncommitted edit would make the cut
 * refuse on the dirty-tree arm instead — for the wrong reason).
 */
function makeDriftedWorkflowRef(root, name) {
  assert.equal(git(root, "checkout", "-q", "-B", name, "develop").status, 0,
    `the fixture must be able to branch '${name}' off develop`);
  // ONE appended line (release.yml ends with a newline), so the diffstat this test asserts is the
  // exact `1\t0` rather than a shape that happens to hold.
  appendFileSync(join(root, ".github", "workflows", "release.yml"), "# drift-line-for-release-cut-test\n");
  assert.equal(git(root, "add", ".github/workflows/release.yml").status, 0, "stage the drifted workflow");
  assert.equal(git(root, "commit", "-q", "-m", "fixture: a release.yml that differs from the tag's tree").status, 0,
    "the drift must be COMMITTED, not a working-tree edit");
  assert.equal(git(root, "checkout", "-q", "author").status, 0, "return HEAD to `author` (production's shape)");
  assert.equal(git(root, "status", "--porcelain", "--untracked-files=no").stdout.trim(), "",
    "the fixture must be clean after planting the drift");
}

/** Every path the command is allowed to create a worktree under. */
function worktreeDirs(parent) {
  const r = spawnSync("bash", ["-c", `ls -d ${JSON.stringify(parent)}/*-worktrees 2>/dev/null || true`], { encoding: "utf8" });
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The premise, made verifiable: does this host clone across filesystems, and does the fixture SAY so?
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("the fixture reports its clone locality as an ENUMERATED value that agrees with a real link() probe", () => {
  const c = makeClone("locality");
  try {
    assert.ok(["same", "cross"].includes(c.locality),
      `on a readable host the locality must be same|cross, got '${c.locality}' (a null device is reported as 'unknown')`);

    // An INDEPENDENT probe of the same premise, by the very mechanism git uses: `link(2)` from the
    // repo into the fixture's parent. EXDEV *is* the cross-device verdict and success *is* the
    // same-device verdict; any other errno is reported as its own value, never folded into either.
    // A reading that cannot disagree with this probe would be unfalsifiable (硬规则 4).
    const probeDst = join(c.parent, "link-probe");
    let probe;
    try {
      linkSync(join(repoRoot, "VERSION"), probeDst);
      unlinkSync(probeDst);
      probe = "same";
    } catch (e) {
      probe = e.code === "EXDEV" ? "cross" : `unknown:${e.code}`;
    }
    assert.equal(c.locality, probe,
      `the reported clone locality must agree with a real link() probe (got '${probe}')`);
  } finally {
    cleanup(c.parent);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// AC1 — the dry run: exit 0, every step listed, nothing written
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("--dry-run exits 0, lists every step in order (worktree path, --root, ledger path, bump), and writes nothing", () => {
  const c = makeClone("dryrun");
  try {
    const before = git(c.root, "status", "--porcelain").stdout;
    const refsBefore = git(c.root, "for-each-ref").stdout;

    const r = run(["9.9.9", "--dry-run", "--root", c.root]);
    assert.equal(r.status, 0, `the dry run must pass on a healthy tree: ${r.stdout}${r.stderr}`);

    // The steps, IN ORDER. Order is the assertion: a plan whose steps are right but shuffled does
    // not describe the command that would run.
    const idx = (re) => {
      const m = r.stdout.match(re);
      assert.ok(m, `the dry run must print ${re}: ${r.stdout}`);
      return r.stdout.indexOf(m[0]);
    };
    const iWorktree = idx(/create linked worktree '[^']*release-v9\.9\.9'/);
    const iBranch = idx(/create 'release\/v9\.9\.9' at 'develop'/);
    const iFinish = idx(/release-branch-finish\.sh release\/v9\.9\.9 --cut --tag v9\.9\.9 --root /);
    const iPush = idx(/git -C \S+ push origin develop refs\/tags\/v9\.9\.9/);
    // ⛔ `--ref` is part of the plan, not decoration: omitting it is the defect this pins
    // (gap-release-workflow-definition-lags-one-release — the run would execute the DEFAULT
    // BRANCH's release.yml, i.e. the previous release's definition).
    const iDispatch = idx(/gh workflow run release\.yml --ref v9\.9\.9 -f tag=v9\.9\.9/);
    const iBump = idx(/bump VERSION 9\.9\.9 -> 9\.10\.0/);
    const iRemove = idx(/worktree remove \S*release-v9\.9\.9/);
    assert.ok(iWorktree < iBranch && iBranch < iFinish && iFinish < iPush && iPush < iDispatch
      && iDispatch < iBump && iBump < iRemove,
      `the steps must be listed in the order they would run: ${r.stdout}`);

    // The three landing facts the AC names explicitly.
    assert.match(r.stdout, new RegExp(`create linked worktree '${join(c.parent, "repo-worktrees", "release-v9.9.9")}'`));
    assert.match(r.stdout, new RegExp(`--root ${join(c.parent, "repo-worktrees", "release-v9.9.9")}`));
    assert.match(r.stdout, new RegExp(`the finish record lands at: ${c.root}/\\.quay/release-branch-finish\\.jsonl`),
      "the ledger shown must be the MAIN checkout's, not the worktree's");

    // ⛔ Nothing was written: no ref moved, no file appeared, and the worktree was not created.
    assert.equal(git(c.root, "for-each-ref").stdout, refsBefore, "a dry run must not touch any ref");
    assert.equal(git(c.root, "status", "--porcelain").stdout, before, "a dry run must not write to the tree");
    assert.deepEqual(worktreeDirs(c.parent), [], "a dry run must not create the worktree");
    assert.equal(existsSync(join(c.root, ".quay", "release-branch-finish.jsonl")), false,
      "a dry run must not append to the ledger");
    assert.equal(git(c.root, "rev-parse", "--verify", "--quiet", "refs/heads/release/v9.9.9").status, 1,
      "a dry run must not create the release branch");
  } finally {
    cleanup(c.parent);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// AC4 — the preflight fails closed, each with its OWN CAUSE=, and creates NO worktree
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("preflight 1/3: an EXISTING tag refuses the cut — CAUSE=release-cut-tag-exists, no worktree", () => {
  const c = makeClone("tagexists");
  try {
    assert.equal(git(c.root, "tag", "v9.9.9").status, 0, "the fixture must really carry the tag");
    const refsBefore = git(c.root, "for-each-ref").stdout;

    const r = run(["9.9.9", "--root", c.root, "--no-push", "--no-dispatch"]);
    assert.equal(r.status, 2, `an existing version tag must refuse: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-cut-tag-exists/);
    assert.deepEqual(worktreeDirs(c.parent), [], "a refused preflight must not create a worktree");
    assert.equal(git(c.root, "rev-parse", "--verify", "--quiet", "refs/heads/release/v9.9.9").status, 1,
      "a refused preflight must not create the release branch");
    assert.equal(git(c.root, "for-each-ref").stdout, refsBefore, "a refused preflight must not move any ref");
  } finally {
    cleanup(c.parent);
  }
});

test("preflight 2/3: version carriers that disagree with VERSION refuse the cut — CAUSE=release-cut-version-inconsistent", () => {
  const c = makeClone("version");
  try {
    // A real drift, not a missing file: `plugin/.claude-plugin/plugin.json` is one of the 13
    // carriers, so changing its version is exactly the state `stamp-version.ts` exists to repair.
    const pluginJson = join(c.root, "plugin", ".claude-plugin", "plugin.json");
    const raw = readFileSync(pluginJson, "utf8");
    const stamped = raw.replace(/"version":\s*"[^"]*"/, '"version": "0.0.1-dev"');
    assert.notEqual(stamped, raw, "the fixture must really change a carrier version");
    writeFileSync(pluginJson, stamped, "utf8");

    const r = run(["9.9.9", "--root", c.root, "--no-push", "--no-dispatch"]);
    assert.equal(r.status, 2, `an inconsistent tree must refuse: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-cut-version-inconsistent/);
    // The checker's own verdict is relayed — a bare "it failed" would not say which carrier drifted.
    assert.match(r.stderr, /0\.0\.1-dev|drift/i);
    assert.deepEqual(worktreeDirs(c.parent), [], "a refused preflight must not create a worktree");
  } finally {
    cleanup(c.parent);
  }
});

test("preflight 3/3: tracked edits refuse the cut — CAUSE=release-cut-dirty-tree (a DIFFERENT cause from 2/3)", () => {
  const c = makeClone("dirty");
  try {
    // A tracked, NON-carrier file: the version carriers still agree with VERSION, so only the
    // dirty-tree arm can fire. Using a carrier here would make this test re-test 2/3.
    appendFileSync(join(c.root, "README.md"), "\nlocal edit\n", "utf8");
    assert.notEqual(git(c.root, "status", "--porcelain", "--untracked-files=no").stdout.trim(), "",
      "the fixture must really be dirty");

    const r = run(["9.9.9", "--root", c.root, "--no-push", "--no-dispatch"]);
    assert.equal(r.status, 2, `a dirty tree must refuse: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-cut-dirty-tree/);
    assert.doesNotMatch(r.stderr, /release-cut-version-inconsistent/,
      "a dirty-but-consistent tree must not be reported as a version problem — the two causes name different repairs");
    assert.deepEqual(worktreeDirs(c.parent), [], "a refused preflight must not create a worktree");
  } finally {
    cleanup(c.parent);
  }
});

test("the three preflight causes are DISJOINT — the same input never yields two of them", () => {
  const c = makeClone("disjoint");
  try {
    // Sanity that the healthy fixture passes all three arms (otherwise every CAUSE above would be
    // reachable for the wrong reason, and the disjointness claim would be vacuous).
    const dry = run(["9.9.9", "--dry-run", "--root", c.root]);
    assert.equal(dry.status, 0, `the healthy fixture must pass the preflight: ${dry.stdout}${dry.stderr}`);
    assert.doesNotMatch(dry.stderr, /CAUSE=release-cut-/);

    assert.equal(git(c.root, "tag", "v1.2.3").status, 0);
    const badVersion = run(["1.2.3", "--root", c.root, "--no-push", "--no-dispatch"]);
    assert.match(badVersion.stderr, /CAUSE=release-cut-tag-exists/);
    assert.doesNotMatch(badVersion.stderr, /release-cut-dirty-tree|release-cut-version-inconsistent/);
  } finally {
    cleanup(c.parent);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The cut itself (steps 1-2): linked worktree off develop → merge back → tag → delete,
// with the record landing in the ROOT checkout's ledger (the AC-320 property, end to end)
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("a real cut creates a LINKED WORKTREE, lands the branch+tag, writes the ledger in --root, and removes the worktree", () => {
  const c = makeClone("cut");
  try {
    const r = run(["9.9.9", "--root", c.root, "--no-push", "--no-dispatch"]);

    // ── the assertions that hold REGARDLESS of how far the cut got ────────────────────────────
    // The landing face runs BEFORE the bump stage, so a cut that stops later still landed the tag
    // and still wrote the record. Asserting these unconditionally is what keeps this test about
    // the carrier's guarantee rather than about the machine's load (the final stage runs a real
    // `quay-init` laydown, which is node-heavy and has been observed to fail under a loaded host —
    // that is a bump-stage failure with its own CAUSE, never a silent success).
    assert.equal(git(c.root, "rev-parse", "--verify", "--quiet", "refs/tags/v9.9.9").status, 0,
      `the tag must land: ${r.stdout}${r.stderr}`);
    assert.deepEqual(
      git(c.root, "for-each-ref", "--format=%(refname:short)", "refs/heads/release-*", "refs/heads/release/*").stdout.split("\n").filter(Boolean),
      [], "the release branch must be deleted by the cut itself (SPEC §4.1 合回后删除, no hand-run delete)");

    // The AC-320 property, end to end: the record landed in `--root`'s ledger (the main checkout),
    // names the tag, and exit=0. v0.12.0's hand cut put this in a scratch clone instead.
    const ledger = join(c.root, ".quay", "release-branch-finish.jsonl");
    assert.equal(existsSync(ledger), true, "the record must land in --root's ledger (the main checkout)");
    const text = readFileSync(ledger, "utf8");
    assert.match(text, /"exit":0/);
    assert.match(text, /"tag":"v9\.9\.9"/);
    assert.equal(existsSync(join(c.parent, "repo-worktrees", "release-v9.9.9", ".quay", "release-branch-finish.jsonl")), false,
      "and NOT in the worktree's own .quay/ — that is the defect AC-320 exists to catch");

    // `--log` reads it back from the root checkout, which is how the task's DoD reads it.
    const log = spawnSync("bash", [join(repoRoot, "plugin", "scripts", "release-branch-finish.sh"), "--log", "--root", c.root], { encoding: "utf8" });
    assert.equal(log.status, 0, log.stderr);
    assert.match(log.stdout, /tag=v9\.9\.9/);

    // ── the stage-specific halves ─────────────────────────────────────────────────────────────
    if (r.status === 0) {
      // "removes the worktree it created" = the LINKED WORKTREE leaf
      // (`<root>-worktrees/release-v9.9.9`), i.e. step 8's `git worktree remove` — ⛔ NOT the
      // `<root>-worktrees` PARENT dir. `git worktree remove` never removes a containing dir, and in
      // production that parent is the SHARED worktree root (`/home/yale/work/quay-worktrees`, which
      // also holds every task worktree), so removing it would be wrong. This arm mirrors the
      // else-branch's own leaf check just below. The old `worktreeDirs(c.parent) == []` demanded the
      // parent be gone, so it could only ever pass via the else-branch (bump-failure) arm — red on
      // any host fast enough for the bump stage to succeed (measured 2026-10-05: suite green at
      // 12:22 through the else arm, red at 12:25 on the same develop when the host was idle; a
      // manual cut on clean develop leaves `repo-worktrees/` empty, not absent).
      assert.equal(existsSync(join(c.parent, "repo-worktrees", "release-v9.9.9")), false,
        "a completed cut must clean up the worktree it created");
      // The next-version bump really landed on `develop`: VERSION moved to X.(Y+1).0.
      assert.equal(git(c.root, "show", "develop:VERSION").stdout.trim(), "9.10.0",
        "§12: the bump lands on develop as the NEXT version, with no de-suffixing commit");
    } else {
      assert.match(r.stderr, /CAUSE=release-cut-bump-/,
        `a cut that got past the preflight must fail with the bump stage's OWN CAUSE: ${r.stdout}${r.stderr}`);
      assert.equal(existsSync(join(c.parent, "repo-worktrees", "release-v9.9.9")), true,
        "a half-done cut must LEAVE its worktree in place (it does not silently clean up evidence)");
    }
  } finally {
    cleanup(c.parent);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// gap-release-cut-subprocess-stderr-discarded — a fixed-CAUSE failure must carry the CHILD's reason
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("a failing child on the REAL cut path carries its OWN reason into CAUSE= (not just fixed prose)", () => {
  // WHAT THIS PINS (unchanged): a fixed-CAUSE failure must carry the CHILD process's own words, never
  // just fixed prose. Before this existed, a cut died with "…the bump is NOT committed" and said
  // nothing about WHY (measured 2026-10-01 / 2026-10-04: two real cuts had to be hand-archaeologied
  // by re-running the swallowed command). The INVARIANT lives in `diagnosticTail`, which every such
  // CAUSE line funnels through.
  //
  // ⚠️ THE VEHICLE CHANGED (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch):
  // it used to be the closure ratchet, made to fail by breaking the FIXTURE's `develop` (the ratchet
  // ran `<worktree>/plugin/scripts/quay-init.sh`). The ratchet is RETIRED, and the remaining children
  // on the cut path run from the CUTTER's own tree, which a fixture cannot break without also
  // tripping the clean-tree preflight. `gh` is the one child reached purely through PATH — so the
  // test puts a FAILING `gh` there and drives the real dispatch step.
  const c = makeClone("childreason");
  const fakeBin = join(c.parent, "fakebin");
  try {
    mkdirSync(fakeBin, { recursive: true });
    const gh = join(fakeBin, "gh");
    writeFileSync(gh, '#!/usr/bin/env bash\necho "GH-BLEW-UP: the fixture wants this exact sentence carried through" >&2\nexit 5\n', { mode: 0o755 });

    const r = run(["9.9.7", "--root", c.root, "--no-push"], {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });

    // The cut got past the preflight and landed the tag; it then died in the dispatch step. Exit 1
    // (post-preflight failure), not 2 (refused preflight) — anything else means this test drove a
    // different arm and the assertions below would be vacuous.
    assert.equal(r.status, 1,
      `the cut must reach and fail in the dispatch stage: status=${r.status} ${r.stdout}${r.stderr}`);
    assert.equal(git(c.root, "rev-parse", "--verify", "--quiet", "refs/tags/v9.9.7").status, 0,
      `the cut landed the tag before the failing step: ${r.stderr}`);

    // THE POINT: the child's own sentence appears in the SAME output, AFTER the CAUSE token.
    assert.match(r.stderr, /CAUSE=release-cut-dispatch-failed/,
      `the dispatch stage's OWN CAUSE must be named: ${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-cut-dispatch-failed[^\n]*GH-BLEW-UP/,
      `the child's own reason must follow the CAUSE on the same line, not be discarded: ${r.stderr}`);
    // …and the CAUSE must name the SAME invocation that actually ran, `--ref` included. A message
    // that said `gh workflow run release.yml -f tag=…` while the call site passed `--ref` would be
    // exactly the text/behaviour split gap-release-workflow-definition-lags-one-release names.
    assert.match(r.stderr, /gh workflow run release\.yml --ref v9\.9\.7 -f tag=v9\.9\.7/,
      `the CAUSE text must name the invocation that really ran (with --ref): ${r.stderr}`);
  } finally {
    cleanup(c.parent);
  }
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// gap-release-workflow-definition-lags-one-release P1 (`--dispatch-ref`) / P2 (drift visibility)
//
// THE DEFECT: `gh workflow run release.yml -f tag=<tag>` carried NO `--ref`, so it executed the
// workflow file on the repository's DEFAULT BRANCH — i.e. release N was judged by release N−1's
// definition (measured: v0.17.0's run executed v0.16.0's release.yml; v0.18.0's was the first to
// run the new step, where it failed). These tests pin the two halves of the fix at the CALL SITE
// and at the PREFLIGHT, not by grepping the source for a flag name.
// ══════════════════════════════════════════════════════════════════════════════════════════════

test("P1: the dry run names the ref the dispatch will run under — ⛔ never the silent default branch", () => {
  const c = makeClone("dispatchref");
  try {
    // Default: bound to the TAG — the run is governed by the tree the tag names.
    const r = run(["9.9.9", "--dry-run", "--root", c.root]);
    assert.equal(r.status, 0, `the dry run must pass on a healthy tree: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /gh workflow run release\.yml --ref v9\.9\.9 -f tag=v9\.9\.9/,
      `the plan must print the dispatch WITH its --ref: ${r.stdout}`);
    assert.match(r.stdout, /the governing definition is \.github\/workflows\/release\.yml at v9\.9\.9/,
      `the plan must say WHICH definition governs the run: ${r.stdout}`);
    assert.match(r.stdout,
      /preflight: the run will be governed by '\.github\/workflows\/release\.yml' at v9\.9\.9 \(the release tag; its tree is 'develop' at cut time\); vs 'develop': 0 insertions \/ 0 deletions \(identical to 'develop'\)/,
      `the preflight must state the governing definition and its diffstat against the shipped tree: ${r.stdout}`);

    // `--dispatch-ref develop`: the plan follows the flag rather than a hardcoded literal.
    const d = run(["9.9.9", "--dry-run", "--root", c.root, "--dispatch-ref", "develop"]);
    assert.equal(d.status, 0, `--dispatch-ref develop must dry-run cleanly: ${d.stdout}${d.stderr}`);
    assert.match(d.stdout, /gh workflow run release\.yml --ref develop -f tag=v9\.9\.9/,
      `--dispatch-ref must reach the printed plan: ${d.stdout}`);
    assert.match(d.stdout, /the governing definition is \.github\/workflows\/release\.yml at develop/,
      `the plan must name the flag's ref as the governing definition: ${d.stdout}`);
  } finally {
    cleanup(c.parent);
  }
});

test("P2/AC3: a release.yml that DIFFERS at the dispatch ref is REFUSED — and the diffstat says how", () => {
  const c = makeClone("drift");
  const fakeBin = join(c.parent, "fakebin");
  try {
    makeDriftedWorkflowRef(c.root, "drifted");
    // ⛔ A FAKE `gh` ON PATH FOR EVERY ARM THAT REACHES THE DISPATCH. These runs are NOT `--dry-run`:
    // they exercise the real path, so if the refusal REGRESSES (mutate the comparison to "always
    // equal") the cut proceeds all the way to `gh workflow run` — measured 2026-10-10, the first
    // version of this test did exactly that and hit the LIVE GitHub API for repo `yaleh/quay`
    // ("HTTP 422: No ref found for: drifted"). A test whose failure mode is a real dispatch against
    // production is a defect in the test, not a stronger assertion.
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, "gh"), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

    // ── the positive control, first: the two refs really do differ, read from git, not assumed ──
    const driftedBlob = git(c.root, "show", "drifted:.github/workflows/release.yml");
    const developBlob = git(c.root, "show", "develop:.github/workflows/release.yml");
    assert.equal(driftedBlob.status, 0);
    assert.equal(developBlob.status, 0);
    assert.notEqual(driftedBlob.stdout, developBlob.stdout, "the fixture must really carry a diff");

    // ── a run governed by `drifted` would be judged by a definition the artifact does not carry ──
    const r = run(["9.9.9", "--root", c.root, "--no-push", "--dispatch-ref", "drifted"], { env });
    assert.equal(r.status, 2, `a drifted governing definition must REFUSE the cut: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-cut-workflow-definition-drift/,
      `the refusal must name its own cause: ${r.stderr}`);
    assert.match(r.stderr, /1\s+0\s+\.github\/workflows\/release\.yml/,
      `the refusal must carry the diffstat (1 insertion / 0 deletions), not just prose: ${r.stderr}`);
    assert.deepEqual(worktreeDirs(c.parent), [], "a refused preflight must not create a worktree");
    assert.equal(git(c.root, "rev-parse", "--verify", "--quiet", "refs/tags/v9.9.9").status, 1,
      "a refused preflight must not land the tag");

    // ── ENUMERATE, never boolean (hard rule 3b): a ref that cannot be read is its OWN cause, not
    //    silently folded into "the definitions agree" ──────────────────────────────────────────
    const gone = run(["9.9.9", "--root", c.root, "--no-push", "--dispatch-ref", "no-such-ref"], { env });
    assert.equal(gone.status, 2, `an unresolvable --dispatch-ref must refuse: ${gone.stdout}${gone.stderr}`);
    assert.match(gone.stderr, /CAUSE=release-cut-dispatch-ref-unresolvable/,
      `an unreadable ref must NOT read as "unchanged" (硬规则 3b): ${gone.stderr}`);
    assert.doesNotMatch(gone.stderr, /release-cut-workflow-definition-drift/,
      "the two causes name different repairs and must not share an output shape");

    // ── the deliberate override: P2 is VISIBILITY, and the difference may be accepted on purpose ─
    const forced = run(["9.9.9", "--dry-run", "--root", c.root, "--dispatch-ref", "drifted", "--allow-workflow-drift"]);
    assert.equal(forced.status, 0, `--allow-workflow-drift must let the cut proceed: ${forced.stdout}${forced.stderr}`);
    assert.match(forced.stdout, /1 insertions? \/ 0 deletions|1\s+0\s+\.github\/workflows\/release\.yml/,
      `the accepted drift must still be PRINTED, never silenced: ${forced.stdout}`);
    assert.match(forced.stdout, /gh workflow run release\.yml --ref drifted -f tag=v9\.9\.9/,
      `the plan must follow the accepted ref: ${forced.stdout}`);
  } finally {
    cleanup(c.parent);
  }
});

test("P1/AC2: the REAL dispatch argv carries `--ref` — recorded from the child, not grepped from the source", () => {
  const c = makeClone("dispatchargv");
  const fakeBin = join(c.parent, "fakebin");
  const log = join(c.parent, "gh-argv.log");
  try {
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(fakeBin, "gh"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$GH_ARGV_LOG"\nexit 0\n', { mode: 0o755 });

    const r = run(["9.9.7", "--root", c.root, "--no-push"], {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, GH_ARGV_LOG: log },
    });

    // The dispatch is step 4 — AFTER the landing face — so the tag proves this run really reached it.
    assert.equal(git(c.root, "rev-parse", "--verify", "--quiet", "refs/tags/v9.9.7").status, 0,
      `the cut must reach the dispatch step: ${r.stdout}${r.stderr}`);
    assert.equal(existsSync(log), true, `the fake gh must have been invoked at all: ${r.stdout}${r.stderr}`);

    const lines = readFileSync(log, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
    const dispatch = lines.find((l) => l.startsWith("workflow run release.yml"));
    assert.ok(dispatch, `the real dispatch invocation must be recorded, got: ${JSON.stringify(lines)}`);

    // POSITION-based (硬规则 2): `--ref` must be present AS A FLAG and carry the tag as its value —
    // a `--ref` appearing inside another token, or without an adjacent value, would not count.
    const toks = dispatch.split(" ");
    const i = toks.indexOf("--ref");
    assert.ok(i > 0, `the dispatch argv must carry a --ref FLAG, got: ${dispatch}`);
    assert.equal(toks[i + 1], "v9.9.7", `--ref's value must be the tag, got: ${dispatch}`);
    assert.ok(toks.includes("-f") && toks[toks.indexOf("-f") + 1] === "tag=v9.9.7",
      `the tag input must still be passed: ${dispatch}`);
  } finally {
    cleanup(c.parent);
  }
});

test("P1/AC2: with `gh` absent the hand-dispatch instruction names the SAME ref the tool would have used", () => {
  const c = makeClone("nogh");
  try {
    // A PATH with the directory that carries `gh` removed — and an independent probe that the
    // removal really took effect, so this test cannot pass by exercising the wrong branch.
    const ghPath = spawnSync("bash", ["-c", "command -v gh"], { encoding: "utf8" }).stdout.trim();
    assert.ok(ghPath, "the test host must carry a `gh` for this arm to mean anything");
    const ghDir = dirname(ghPath);
    const strippedPath = (process.env.PATH ?? "").split(":").filter((d) => d && d !== ghDir).join(":");
    const probe = spawnSync("bash", ["-c", "command -v gh || true"], {
      encoding: "utf8", env: { ...process.env, PATH: strippedPath },
    });
    assert.equal(probe.stdout.trim(), "", "the fixture must really have removed `gh` from PATH");

    const r = run(["9.9.6", "--root", c.root, "--no-push"], {
      env: { ...process.env, PATH: strippedPath },
    });

    assert.equal(r.status, 1, `the cut must reach and fail in the dispatch stage: ${r.stdout}${r.stderr}`);
    assert.equal(git(c.root, "rev-parse", "--verify", "--quiet", "refs/tags/v9.9.6").status, 0,
      `the cut landed the tag before the failing step: ${r.stderr}`);
    assert.match(r.stderr, /CAUSE=release-cut-dispatch-unavailable/,
      `the hand-dispatch cause must be named: ${r.stderr}`);
    // The instruction handed to the operator must be the SAME invocation — with its `--ref` — or the
    // operator re-introduces the very defect by following it.
    assert.match(r.stderr, /Dispatch by hand: gh workflow run release\.yml --ref v9\.9\.6 -f tag=v9\.9\.6/,
      `the hand-dispatch instruction must carry --ref: ${r.stderr}`);
  } finally {
    cleanup(c.parent);
  }
});
