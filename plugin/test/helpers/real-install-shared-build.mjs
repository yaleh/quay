// real-install-shared-build.mjs — ONCE-PER-SUITE build products for the real-install family
// (gap-real-install-family-build-dedup-once-per-suite).
//
// THE COST THIS REMOVES (measured 2026-10-27): every file in the real-install family ran the SAME
// build itself, and `plugin/test/release-cut.test.mjs` ran it once per `release-cut.sh` INVOCATION —
// 21 invocations, ~15 of which reach the shipped-set preflight, each spawning
// `plugin/scripts/publish-dist-branch.sh` (sync-vendor + build-plugin-dist + rewrite + stamp + prune)
// at ~23–40 s. That single file was the suite's longest at 654.7 s and the build, not the fixture
// clone, was the whole of it.
//
// WHAT THIS IS — and what it is NOT. It is a CACHE AROUND THE PRODUCT'S OWN BUILD, never a second
// implementation of it: the artifact is produced by `plugin/scripts/publish-dist-branch.sh` and the
// tarball by `packages/quay/scripts/package.sh`, unchanged. A cache hit therefore hands back a
// product of the real mechanism, so a criterion that consumes it still measures the real thing.
//
// WHY THE KEY IS A TREE OID, not a commit sha and not a timestamp: the build's output is determined
// by the CONTENT of the tree it is built from. `git rev-parse <ref>^{tree}` is that content, and it
// is the same for two commits that differ only in metadata (the release-cut fixtures each commit
// their own ceiling, so their develop SHAs all differ while their trees are identical — a
// commit-keyed cache would miss every one of them). A content key cannot go stale: two runs with the
// same key have, by construction, the same build input.
//
// WHY THE CACHE IS PROCESS-SHARED AND ON DISK: `node --test` runs each FILE in its own process
// (test-isolation = process), so an in-memory cache would be per-file. The family's files are what
// we want to dedup ACROSS, hence an on-disk entry under a resolved writable tmp root plus an atomic
// mkdir lock — two files racing to build the same entry produce ONE build and the loser waits for
// it (bounded; on timeout it reports `evaluated:false` rather than either blocking forever or
// silently building a duplicate).
//
// 硬规则 3b (读不懂 ≠ 合格): every failure path here answers `{ evaluated: false, reason }` — a
// distinct value, never an empty artifact directory that a consumer would read as "a clean build".

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { writableTmpRoot } from "./tmp-workspace.mjs";

/** Bump when the cache ENTRY LAYOUT (not the build) changes — old entries must not be read as new. */
const CACHE_FORMAT = 1;

/** How long a waiter blocks on a peer's in-flight build before reporting `evaluated:false`. */
const LOCK_WAIT_MS = 420_000;
const LOCK_POLL_MS = 250;

/**
 * The `release/*` prefix `scripts/resolve-version.ts`'s `--mode build` recognises — the ONE thing
 * that makes a build take the RELEASE form (`X.Y.Z`) instead of `X.Y.Z-dev`. `release-cut.mjs`
 * derives the same prefix from `.quay/config.yml`'s declared release globs
 * (`releaseBranchPrefix(releaseModel.globs)`); a helper cannot read that model without becoming a
 * second parser of it, so the value is named here and the caller that cares (`release-cut.test.mjs`)
 * passes `form: "release"`.
 */
const RELEASE_BRANCH_PREFIX = "release/";

/** One prune per process; entries older than this are unreachable in practice and just cost disk. */
const PRUNE_AGE_MS = 48 * 60 * 60 * 1000;
let _pruned = false;

/** Where the shared entries live. Never inside the checkout: a test may not mutate the repo tree. */
export function sharedBuildCacheRoot() {
  return process.env.QUAY_TEST_SHARED_BUILD_CACHE || join(writableTmpRoot(), "quay-real-install-build-cache");
}

function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * The content key for a build rooted at `repoRoot`'s `ref`.
 *
 * `extra` folds in build inputs that are NOT in the tree — the vendored runtime bundles are
 * gitignored, so for the `--no-build` form the working tree's copies are real inputs that a tree oid
 * cannot see (硬规则 4c: the quantity has to survive every layer between its producer and its
 * reader; a key that omits a real input makes a stale hit INDISTINGUISHABLE from a correct one).
 */
function contentKey(repoRoot, ref, form, extra = []) {
  const rev = git(repoRoot, ["rev-parse", "--verify", `${ref}^{tree}`]);
  if (rev.status !== 0) return { evaluated: false, reason: `'${ref}' does not resolve to a tree in ${repoRoot}: ${rev.stderr.trim()}` };
  return { evaluated: true, tree: rev.stdout.trim(), key: sha256([CACHE_FORMAT, form, rev.stdout.trim(), ...extra].join("\n")).slice(0, 32) };
}

/** A file's sha256, or a named absence — never a silent empty string folded into the key. */
function fileDigest(p) {
  try {
    return sha256(readFileSync(p));
  } catch {
    return "absent";
  }
}

function buildLocked(entry, buildFn) {
  const lock = `${entry}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let acquired = false;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lock);
      acquired = true;
      break;
    } catch (err) {
      if (err && err.code !== "EEXIST") throw err;
      // A peer is building this exact entry. Its publish completes or its process dies; either way
      // the poll below terminates (a dead peer's lock is reclaimed by the age check).
      if (existsSync(join(entry, "provenance.json"))) return { cacheHit: true };
      if (staleLock(lock)) {
        try { rmSync(lock, { recursive: true, force: true }); } catch { /* another waiter won the race */ }
        continue;
      }
      sleep(LOCK_POLL_MS);
    }
  }
  if (!acquired) return { evaluated: false, reason: `timed out after ${LOCK_WAIT_MS} ms waiting for a peer's build of ${entry}` };
  try {
    const tmp = `${entry}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    rmSync(tmp, { recursive: true, force: true });
    try {
      buildFn(tmp);
      rmSync(entry, { recursive: true, force: true });
      renameSync(tmp, entry);
      return { cacheHit: false };
    } catch (err) {
      // 硬规则 3b: a build that could not run answers "not evaluated", never an empty entry a
      // consumer would read as a clean build.
      return { evaluated: false, reason: `the shared build failed: ${err && err.message ? err.message : String(err)}` };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    try { rmSync(lock, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

function staleLock(lock) {
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_WAIT_MS;
  } catch {
    return false;
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pruneOldEntries(root) {
  if (_pruned) return;
  _pruned = true;
  let names;
  try { names = readdirSync(root); } catch { return; }
  for (const n of names) {
    const p = join(root, n);
    try {
      if (Date.now() - statSync(p).mtimeMs > PRUNE_AGE_MS) rmSync(p, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Build the shipped artifact the way `release-cut.mjs`'s preflight does: in a THROWAWAY linked
 * worktree at `ref`, via `publish-dist-branch.sh`, then `git archive` of the orphan branch (the
 * artifact a consumer receives — ⛔ never a copy of the working tree, which keeps its raw .ts).
 *
 * `form`:
 *   "release" — a `release/`-shaped branch, so `stamp-version --mode build` writes the RELEASE form
 *               (`X.Y.Z`). This is the form `release-cut.sh`'s own probe produces, so a shared
 *               artifact answers for it byte-for-byte.
 *   "dev"     — any other branch name; the stamp writes `X.Y.Z-dev`. What the shipped-set /
 *               shipped-shell-reachability stubs publish.
 */
export function ensureSharedShippedArtifact({ repoRoot, ref = "HEAD", form = "dev", syncVendor = true } = {}) {
  if (!existsSync(repoRoot)) return { evaluated: false, reason: `repoRoot does not exist: ${repoRoot}` };
  const cacheRoot = sharedBuildCacheRoot();
  pruneOldEntries(cacheRoot);

  // The vendored runtime is a real input of the `--no-build` form and is NOT in any tree (gitignored).
  const extra = syncVendor
    ? []
    : [
        fileDigest(join(repoRoot, "plugin", "vendor", "quay", "dist", "quay.js")),
        fileDigest(join(repoRoot, "plugin", "vendor", "quay-native", "dist", "quay-native.js")),
      ];
  const ck = contentKey(repoRoot, ref, `shipped-${form}`, extra);
  if (!ck.evaluated) return ck;

  const entry = join(cacheRoot, `shipped-${form}-${ck.key}`);
  const provenancePath = join(entry, "provenance.json");
  const artifactDir = join(entry, "artifact");

  const readEntry = () => {
    try {
      const p = JSON.parse(readFileSync(provenancePath, "utf8"));
      if (p && p.cacheFormat === CACHE_FORMAT && p.form === form && p.tree === ck.tree && existsSync(artifactDir)) {
        return p;
      }
    } catch { /* fall through to a build */ }
    return null;
  };

  let existing = readEntry();
  let cacheHit = true;
  if (!existing) {
    mkdirSync(cacheRoot, { recursive: true });
    const built = buildLocked(entry, (tmp) => {
      mkdirSync(join(tmp, "artifact"), { recursive: true });
      const r = buildArtifact({ repoRoot, ref, form, artifactDir: join(tmp, "artifact"), syncVendor });
      if (r.status !== 0) throw new Error(r.reason);
      writeFileSync(
        join(tmp, "provenance.json"),
        `${JSON.stringify(
          {
            cacheFormat: CACHE_FORMAT,
            form,
            tree: ck.tree,
            builtFrom: ref,
            sourceRepo: repoRoot,
            publisher: "plugin/scripts/publish-dist-branch.sh",
            syncVendor,
            builtAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    });
    if (built.evaluated === false) return built;
    cacheHit = built.cacheHit === true;
    existing = readEntry();
    if (!existing) return { evaluated: false, reason: `the shared build of '${ref}' did not produce a readable entry at ${entry}` };
  }

  return { evaluated: true, dir: artifactDir, entry, tree: ck.tree, form, provenance: existing, cacheHit };
}

/** Throwing build body; the caller turns a throw into `evaluated:false`. */
function buildArtifact({ repoRoot, ref, form, artifactDir, syncVendor }) {
  const parent = mkdtempSync(join(writableTmpRoot(), "quay-shared-shipped-build-"));
  const wt = join(parent, "tree");
  // ⛔ THE BUILD WORKTREE MUST BE ON A BRANCH, NOT DETACHED. `publish-dist-branch.sh` chains the
  // version stamp, the bundle-tree re-stamp and the unreachable-`.sh` PRUNE into one `&&` list, and
  // `resolve-version --mode build` answers NOT-EVALUATED (exit 3) on a DETACHED head carrying no
  // version tag; bash's errexit does not fire inside an `&&` list, so the rest of the chain is
  // silently SKIPPED — an artifact that never got pruned (measured in release-cut.mjs's own header:
  // 306 files / 16594 .sh lines detached vs 287 / 7345 release-shaped). A branch also decides the
  // version FORM: `release/*` ⇒ `X.Y.Z`, anything else ⇒ `X.Y.Z-dev`.
  const probeBranch = `${form === "release" ? RELEASE_BRANCH_PREFIX : ""}shared-probe-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const branch = `${form === "release" ? RELEASE_BRANCH_PREFIX : ""}shared-build-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    // A crashed earlier run can leave its scratch branch behind; `worktree add -b` refuses an
    // existing name, so clear it first (best-effort — the random suffix makes a collision unlikely,
    // and this is the only place that could turn one into a hard failure).
    git(repoRoot, ["branch", "-D", probeBranch]);
    git(repoRoot, ["branch", "-D", branch]);
    const added = git(repoRoot, ["worktree", "add", "-q", "-b", probeBranch, wt, ref]);
    if (added.status !== 0) return { status: 1, reason: `git worktree add at '${ref}' failed: ${added.stderr.trim()}` };

    // esbuild resolves npm imports by walking UP from each bundled file; a fresh worktree has no
    // node_modules (gitignored), so the build would fail outright without this. Same step, same
    // reason, as release-cut.mjs's own preflight.
    const nm = join(repoRoot, "node_modules");
    if (existsSync(nm)) {
      try { symlinkSync(nm, join(wt, "node_modules"), "dir"); } catch { /* best-effort */ }
    }

    const args = [join(wt, "plugin", "scripts", "publish-dist-branch.sh"), "--branch", branch];
    if (!syncVendor) args.push("--no-build");
    const published = run("bash", args, { cwd: wt });
    if (published.status !== 0) {
      return { status: 1, reason: `publish-dist-branch.sh exited ${published.status}: ${tail(published.stderr || published.stdout)}` };
    }

    const tar = join(parent, "artifact.tar");
    const archived = run("git", ["-C", wt, "archive", "-o", tar, branch]);
    if (archived.status !== 0) return { status: 1, reason: `git archive exited ${archived.status}: ${tail(archived.stderr)}` };
    const extracted = run("tar", ["-xf", tar, "-C", artifactDir]);
    if (extracted.status !== 0) return { status: 1, reason: `tar -xf exited ${extracted.status}: ${tail(extracted.stderr)}` };
    return { status: 0 };
  } finally {
    git(repoRoot, ["worktree", "remove", "--force", wt]);
    git(repoRoot, ["branch", "-D", branch]);
    git(repoRoot, ["branch", "-D", probeBranch]);
    git(repoRoot, ["worktree", "prune"]);
    rmSync(parent, { recursive: true, force: true });
  }
}

function tail(s, n = 1200) {
  const t = String(s ?? "").trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

/**
 * The `npm pack` tarball `package.sh` produces, shared across files.
 *
 * The build runs in a THROWAWAY git worktree of `repoRoot` — the repo's own layout, which is what
 * `package.sh` needs (`../../plugin`, `docs/analysis`, and the version carriers all resolve exactly
 * as they do in a real cut) — never in the shared checkout: `package.sh` stages
 * `packages/quay/plugin/` and builds `packages/quay/dist/`, and those are shared artifacts no single
 * test owns (test-isolation contract R2).
 */
export function ensureSharedPackedTarball({ repoRoot, ref = "HEAD" } = {}) {
  if (!existsSync(repoRoot)) return { evaluated: false, reason: `repoRoot does not exist: ${repoRoot}` };
  const cacheRoot = sharedBuildCacheRoot();
  pruneOldEntries(cacheRoot);

  // The packed plugin bundle carries the vendored runtime (gitignored ⇒ invisible to a tree oid).
  const extra = [
    fileDigest(join(repoRoot, "plugin", "vendor", "quay", "dist", "quay.js")),
    fileDigest(join(repoRoot, "plugin", "vendor", "quay-native", "dist", "quay-native.js")),
  ];
  const ck = contentKey(repoRoot, ref, "packed-tarball", extra);
  if (!ck.evaluated) return ck;

  const entry = join(cacheRoot, `packed-tarball-${ck.key}`);
  const provenancePath = join(entry, "provenance.json");
  const readEntry = () => {
    try {
      const p = JSON.parse(readFileSync(provenancePath, "utf8"));
      if (p && p.cacheFormat === CACHE_FORMAT && p.tree === ck.tree && p.tgz && existsSync(join(entry, p.tgz))) {
        return { ...p, tgzPath: join(entry, p.tgz) };
      }
    } catch { /* fall through to a build */ }
    return null;
  };

  let existing = readEntry();
  let cacheHit = true;
  if (!existing) {
    mkdirSync(cacheRoot, { recursive: true });
    const built = buildLocked(entry, (tmp) => {
      const r = buildTarball({ repoRoot, ref, dest: tmp });
      if (r.status !== 0) throw new Error(r.reason);
      writeFileSync(
        join(tmp, "provenance.json"),
        `${JSON.stringify(
          {
            cacheFormat: CACHE_FORMAT,
            tree: ck.tree,
            builtFrom: ref,
            sourceRepo: repoRoot,
            builder: "packages/quay/scripts/package.sh",
            tgz: r.tgzName,
            builtAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    });
    if (built.evaluated === false) return built;
    cacheHit = built.cacheHit === true;
    existing = readEntry();
    if (!existing) return { evaluated: false, reason: `the shared pack of '${ref}' did not produce a readable entry at ${entry}` };
  }

  return { evaluated: true, tgzPath: existing.tgzPath, tgzName: existing.tgz, entry, tree: ck.tree, provenance: existing, cacheHit };
}

function buildTarball({ repoRoot, ref, dest }) {
  const parent = mkdtempSync(join(writableTmpRoot(), "quay-shared-pack-build-"));
  const wt = join(parent, "tree");
  try {
    const added = git(repoRoot, ["worktree", "add", "-q", "--detach", wt, ref]);
    if (added.status !== 0) return { status: 1, reason: `git worktree add at '${ref}' failed: ${added.stderr.trim()}` };
    const nm = join(repoRoot, "node_modules");
    if (existsSync(nm)) {
      try { symlinkSync(nm, join(wt, "node_modules"), "dir"); } catch { /* best-effort */ }
    }
    const pkg = join(wt, "packages", "quay");
    // `package.sh` resolves the repo root two levels above the package dir and stages
    // packages/quay/plugin/ + dist/ THERE — a worktree keeps all of that inside the throwaway tree.
    const packed = run("bash", [join(pkg, "scripts", "package.sh")], { cwd: pkg });
    if (packed.status !== 0) {
      return { status: 1, reason: `package.sh exited ${packed.status}: ${tail(packed.stderr || packed.stdout)}` };
    }
    let tgzName;
    try {
      tgzName = readdirSync(pkg).filter((n) => n.startsWith("quay-") && n.endsWith(".tgz")).sort().pop();
    } catch { /* handled below */ }
    if (!tgzName) return { status: 1, reason: `package.sh produced no quay-*.tgz in ${pkg}` };
    const moved = run("cp", [join(pkg, tgzName), join(dest, tgzName)]);
    if (moved.status !== 0) return { status: 1, reason: `copying ${tgzName} out of the build tree failed: ${tail(moved.stderr)}` };
    return { status: 0, tgzName };
  } finally {
    git(repoRoot, ["worktree", "remove", "--force", wt]);
    git(repoRoot, ["worktree", "prune"]);
    rmSync(parent, { recursive: true, force: true });
  }
}
