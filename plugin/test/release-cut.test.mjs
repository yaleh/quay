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
import { mkdtempSync, rmSync, existsSync, appendFileSync, writeFileSync, readFileSync, symlinkSync, statSync, linkSync, unlinkSync } from "node:fs";
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
 * while `os.tmpdir()` is `/` (ext4), so all 7 tests in this file died with `EXDEV` and every
 * fan-in's full suite was red develop-wide. `--no-hardlinks` gives up only the hardlinking, which
 * is precisely the part that cannot work cross-device; the locality reading below records which
 * kind of host the run saw instead of leaving that premise implicit in a comment.
 *
 * Returns { parent, root, locality } — `parent` is where the command would create its worktree,
 * which is how "no worktree was created" is checked; `locality` is that enumerated reading.
 */
function makeClone(prefix) {
  const parent = mkdtempSync(join(tmpdir(), `release-cut-${prefix}-`));
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
  assert.equal(git(root, "branch", "develop", "origin/develop").status, 0);
  assert.equal(git(root, "checkout", "-q", "-B", "author", "origin/develop").status, 0);
  // node_modules is gitignored, so a clone never has it — but the command links `--root`'s
  // node_modules into the release worktree, and the bump stage's closure-ratchet re-anchor runs a
  // REAL quay-init laydown that needs esbuild/node from there. Giving the fixture one makes the
  // bump stage runnable, so the happy path below is the real one rather than a graceful failure.
  const nm = join(repoRoot, "node_modules");
  if (existsSync(nm)) symlinkSync(nm, join(root, "node_modules"));
  return { parent, root, locality };
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

test("--dry-run exits 0, lists every step in order (worktree path, --root, ledger path, bump, ratchet), and writes nothing", () => {
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
    const iDispatch = idx(/gh workflow run release\.yml -f tag=v9\.9\.9/);
    const iBump = idx(/bump VERSION 9\.9\.9 -> 9\.10\.0/);
    const iRatchet = idx(/re-anchor docs\/analysis\/quay-init-closure-ratchet\.baseline\.json/);
    const iRemove = idx(/worktree remove \S*release-v9\.9\.9/);
    assert.ok(iWorktree < iBranch && iBranch < iFinish && iFinish < iPush && iPush < iDispatch
      && iDispatch < iBump && iBump < iRatchet && iRatchet < iRemove,
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
      assert.deepEqual(worktreeDirs(c.parent), [], "a completed cut must clean up the worktree it created");
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
