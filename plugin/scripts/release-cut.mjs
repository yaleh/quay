// release-cut.mjs — the RENDERER behind `bash plugin/scripts/release-cut.sh`: CUT A RELEASE, as one
// command instead of a remembered sequence.
//
// SPEC: orchestration/SPEC-release-and-hotfix-branching-2026-09-15.md §4 (release-branch protocol)
// and §12 (VERSION single source + build-mode suffix resolution). ADR-004: the protocol was prose,
// and prose gets paraphrased away — measured cost 2026-09-24: the v0.12.0 cut was performed as ~12
// hand-remembered steps, two of which bit:
//   1. `release-branch-finish.sh` needs HEAD == base (`develop`), so it could not be run from the
//      main checkout (HEAD=author) ⇒ the cut moved into an INDEPENDENT CLONE at
//      /data/scratch/yale/quay-release-cut-v0120;
//   2. the finish record then landed in THAT clone's `.quay/` — the main checkout's ledger last line
//      stayed at 2026-09-20 (AC-320 exists precisely because of this);
//   3. the next-version bump necessarily edited `docs/analysis/quay-init-closure-ratchet.baseline.json` (retired since — gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch)
//      (the bump changes `plugin/.claude-plugin/plugin.json`, a laydown source), which the prose
//      never mentioned — the cutter discovered it on the spot.
//
// What this command does, IN ORDER (each step's failure carries its OWN `CAUSE=` and exit code):
//   1. preflight, all read-only —
//        tag `v<version>` must not exist            CAUSE=release-cut-tag-exists
//        `--root` must be version-consistent        CAUSE=release-cut-version-inconsistent
//        `--root` must have no tracked edits        CAUSE=release-cut-dirty-tree
//        `develop` must resolve and not be BEHIND `origin/develop`
//                                                   CAUSE=release-cut-base-unresolvable /
//                                                   release-cut-develop-behind-remote /
//                                                   release-cut-develop-sync-unreadable
//   2. create a LINKED WORKTREE on `develop` (⛔ never an independent clone, ⛔ never a branch
//      switch in the main checkout) — `release-branch-finish.sh --cut` requires HEAD == base, and
//      the main checkout is normally NOT on `develop`;
//   3. cut the release branch there and land it in ONE invocation:
//      `release-branch-finish.sh release/v<version> --cut --tag v<version> --root <worktree>`
//      (merge back → tag the merge point → delete the branch — the SPEC's last three steps);
//   4. push the tag and `develop`;
//   5. dispatch `release.yml` on the tag — with an EXPLICIT `--ref` (see the `--dispatch-ref`
//      paragraph below) — and echo the run URL;
//   6. bump `VERSION` on `develop` to the NEXT version + `stamp-version.ts` + re-anchor the
//      closure-ratchet baseline, and commit;
//   7. remove the worktree it created.
//
// ⛔ The record's landing root is NOT a parameter of this script's own choice: the finish step is
// invoked with `--root <worktree>`, and `release-branch-finish.sh` resolves its ledger to the
// checkout that OWNS the shared git dir ⇒ the MAIN checkout's `.quay/release-branch-finish.jsonl`.
// The dry run prints that absolute path (asked of the carrier itself via `--trace-path`, so there
// is ONE derivation) — a reader can check the landing without running anything.
//
// ── `--ref`: WHICH release.yml GOVERNED THE RUN (the implicit-default defect this fixes) ────────
// Measured 2026-10-10 by the v0.18.0 release incident. `gh workflow run release.yml -f tag=<tag>`
// WITHOUT `--ref` runs the workflow file on the repository's DEFAULT BRANCH, and here the default
// branch is `master` — which only advances when a release finishes FULLY GREEN. So release N was
// always judged by release N−1's DEFINITION:
//   • v0.17.0's run 37620677788 executed `verify-plugin-channel` with 13 steps and NO assertions
//     step, although v0.17.0's own tree already carried that step — it ran v0.16.0's file;
//   • `git diff v0.17.0 v0.18.0 -- .github/workflows/release.yml` is 14 insertions / 13 deletions,
//     and v0.18.0's run was the FIRST to execute the new step — where it failed.
// Two distinct harms, both from the same implicitness:
//   (a) a step can first execute during a REAL release (`.github/workflows/ci.yml` never runs
//       `verify-plugin-channel-assertions` — grep is empty — so the release is its debut), and
//   (b) SELF-LOCK: if the broken file is release.yml itself, fixing it does not help, because the
//       fix is not on `master` and `master` cannot be advanced while the release keeps failing.
// The fix is to STOP DERIVING the ref silently: `--dispatch-ref <ref>` names it, and the preflight
// states in plain words which definition will govern the run and how it differs from the tree the
// tag names (P2 — visibility, hard rule 9: make the effective definition OBSERVABLE instead of
// leaning on a default-branch semantic). The default is the TAG ITSELF: the run is then governed by
// exactly the tree the tag names, so re-dispatching one tag reproduces one verdict — the property
// release.yml's own IDEMPOTENCY contract assumes. `--dispatch-ref develop` gates on the current
// mainline instead (fix the gate forward, push develop, re-dispatch the same tag) at the price of
// unbinding gate from artifact. ⛔ Which of the two is POLICY is a human ruling (task
// gap-release-workflow-definition-lags-one-release AC1); this flag makes either one a flag away
// rather than a silenced default.
// ⛔ The comparison below is against `--base`, ⛔ never against `refs/tags/<tag>`: the tag does not
// exist yet when the preflight runs (step 2 creates it at `--base`'s merge point), and by
// construction that merge point carries `--base`'s tree — reading a nonexistent ref would report
// "unreadable" for the ordinary, correct case.
//
// ── WHY THIS IS A `.mjs` AND THE `.sh` IS A THIN ENTRY (read before "simplifying" it back) ──────
// The one-command interface is WRITTEN DOWN as `bash plugin/scripts/release-cut.sh` — in this task's
// AC, in SPEC §4/§12, in `capability-catalog-declarations.json`'s key, and in the
// `experiments/quay-perpetual-stream/scripts/` symlink twin. That entry form is kept.
// What is NOT free is putting the implementation INSIDE the `.sh`:
//   `plugin/sh-census-baseline.json` is a SHRINK-ONLY ratchet whose `embeddedInterpreterLines` axis
//   charges a tracked `.sh` its WHOLE code-line count the moment it contains ONE counted invocation
//   (`node` with `--experimental-strip-types` / `-e` / a `.ts` argument), doubled here because the
//   experiments twin is a symlink that is counted per-path. The committed baseline is exactly the
//   current reading (zero slack), and both escape hatches — self-exempting the human-curated
//   `plugin/sh-census-exceptions.txt`, or raising a shrink-only baseline — are gate-gaming, so
//   neither is taken. The census's axis is "is this `.sh` a PROGRAM or GLUE?", and the honest way to
//   answer it is the repo's own thin-entry shape (`capability-catalog.sh`, `cap-from-gate.sh`): the
//   `.sh` resolves itself and execs a renderer, carrying none of the logic.
//   The renderer is plain ESM (⛔ not `--experimental-strip-types`) for a SECOND, independent
//   reason: a release tool must run under the `node` on PATH at cut time, and type-stripping needs
//   Node ≥22.6 while ESM needs none — the same "the Node-20-safe entry" rationale the repo already
//   documents for `scripts/stamp-version.mjs` (which `sync-vendor.sh` reaches the same way).
// The `.sh` header is the `--help` surface (`gate-script-lib.sh` `tool_help` prints it); this file's
// usage block below is for direct invocation.
//
// Usage:
//   node plugin/scripts/release-cut.mjs <version> [--root <repo>] [--worktree <path>]
//                  [--remote <name>] [--base <ref>] [--dispatch-ref <ref>]
//                  [--allow-workflow-drift] [--no-push] [--no-dispatch] [--dry-run]
//   <version>    bare X.Y.Z (⛔ no leading `v`, no suffix) — tag = v<version>, branch = release/v<version>
//   --root       the checkout to cut from (default: the MAIN checkout of the repo this script
//                lives in — `git rev-parse --git-common-dir`'s parent, so running this from a
//                linked worktree still cuts from the main checkout)
//   --worktree   where the linked worktree is created (default:
//                <dirname root>/<basename root>-worktrees/release-v<version>)
//   --remote     the remote to push to (default: origin)
//   --base       the ref the cut merges back into (default: develop)
//   --dispatch-ref <ref>
//                the ref `gh workflow run release.yml` is dispatched AGAINST (default: the release
//                tag itself, i.e. `--ref v<version>`). This decides WHICH copy of release.yml
//                governs the run — 🚫 omitting `--ref` would silently run the DEFAULT BRANCH's copy,
//                i.e. the PREVIOUS release's definition. `--dispatch-ref develop` gates on the
//                current mainline instead of on the tagged tree.
//   --allow-workflow-drift
//                proceed even when the governing release.yml differs from the tree the tag names;
//                without it that difference is a REFUSED preflight (see --dispatch-ref)
//   --no-push    do not push (steps 4 and 6's push) — used by tests and by offline cuts
//   --no-dispatch do not run `gh workflow run release.yml`
//   --dry-run    run every READ-ONLY preflight, print the whole plan (worktree path, the
//                `--root` the finish step gets, the ledger's absolute path, the bump and the
//                ratchet re-anchor), mutate NOTHING, exit 0 when the preflight passes
//
// Exit codes:
//   0  the cut completed (or the dry run's preflight passed)
//   1  a step AFTER the preflight failed (merge/tag/push/dispatch/bump) — CAUSE= names which; the
//      cut may be partially landed, and each such CAUSE= says what is already true
//   2  usage error, or a preflight failed — nothing was created
//
// ⛔ This command does NOT decide the version: `<version>` is required and is never parsed out of
// a branch name or guessed from VERSION (the same rule release-branch-finish.sh follows).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── the checkout THIS tool ships in (⛔ never `--root`) ────────────────────────────────────────
// In production the two are the same object (`--root` defaults to this tool's own main checkout).
// They differ only when `--root` names another tree (a fixture, or a deliberate cross-checkout cut),
// and there the pair that ships together must be the pair that runs: a newer release-cut driving an
// older `release-branch-finish.sh` would pass flags the carrier does not understand (`--trace-path`),
// and the failure would look like a broken carrier rather than a version skew. What IS judged from
// `--root` is the TREE: the checker takes `--root`, so the tree under test supplies its own VERSION
// and its own carrier files — only the table that reads them comes from here.
//
// `realpathSync` on the module file, not `import.meta.url` verbatim: the experiments-side twin is a
// SYMLINK, and an entry that resolved its siblings through whichever path it was invoked by would
// look for `release-branch-finish.sh` under `experiments/…/scripts/`.
const SELF = fs.realpathSync(fileURLToPath(import.meta.url));
const SCRIPT_DIR = path.dirname(SELF);
const SCRIPT_ROOT = path.dirname(path.dirname(SCRIPT_DIR));

/** Fail with the ONE shape every step uses: `CAUSE=<token> — <what is true>`, on stderr, exit <code>. */
function fail(cause, message, code) {
  process.stderr.write(`CAUSE=${cause} — ${message}\n`);
  process.exit(code);
}

/** A child process read whole. Never throws: a spawn error is reported as a non-zero status. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * The tail of a failed child's OWN diagnostic output, for folding into the caller's `CAUSE=`.
 *
 * ⛔ BOTH streams are read, deliberately. A repo checker built on `gate-script-base.ts`'s
 * `emitVerdict` family reports on **stdout** by default (`NOT-EVALUATED: …` / `FAIL: …`), while Node
 * and `bash` report their own errors on stderr. Capturing only one half would make the CAUSE text
 * depend on which stream the child happened to pick — and a child that is silent on the half you
 * captured reads exactly like a child that said nothing at all (硬规则 5: a search is only
 * conclusive over a COMPLETE source; 硬规则 3b: "could not read the reason" must not share an output
 * shape with "there was no reason"). Measured 2026-10-04 on a tool that put the ONLY copy of its
 * reason on stdout and exited 3 — capturing stderr alone would have shown just Node's
 * MODULE_TYPELESS warning.
 *
 * `(no output on stdout or stderr)` is its own value, never conflated with a short-but-real tail.
 *
 * ⛔ It keeps BOTH ends when it must clip. The reason this matters is measured, not stylistic: the
 * verdict token (`NOT-EVALUATED: …` / `FAIL: …`) sits at the HEAD of the child's stdout, and the noise
 * that pushes the text past `max` is Node's own MODULE_TYPELESS warning on stderr — whose length grows
 * with the RESOLVED SCRIPT PATH. A front-only clip therefore dropped the very verdict it exists to
 * carry once the child ran from a long worktree path (measured 2026-10-05: a 100-char worktree path put
 * `joined` at 815 > 800, and `…${slice(-800)}` began mid-token at `…LUATED`). Both ends survive now.
 */
export function diagnosticTail(r, max = 800) {
  const out = typeof r.stdout === "string" ? r.stdout.trim() : "";
  const err = typeof r.stderr === "string" ? r.stderr.trim() : "";
  const parts = [];
  if (out) parts.push(`stdout: ${out}`);
  if (err) parts.push(`stderr: ${err}`);
  if (parts.length === 0) return "the child wrote nothing to stdout or stderr";
  const joined = parts.join(" | ");
  if (joined.length <= max) return joined;
  const head = joined.slice(0, Math.ceil(max / 2));
  const tail = joined.slice(-Math.floor(max / 2));
  return `${head} … ${tail}`;
}

const git = (dir, ...args) => run("git", ["-C", dir, ...args]);

/**
 * The MAIN checkout of a checkout: the parent of its shared git dir.
 * Same order-independent derivation as `plugin/scripts/repo-root.ts` `mainCheckoutRoot`
 * (⛔ never `git worktree list`'s first entry — that order is not guaranteed). Used for TWO things:
 * the default `--root` (so running this from a linked worktree still cuts from the main checkout)
 * and the display of where the finish record lands. Returns "" when it cannot be derived.
 */
function mainRootOf(dir) {
  let commonDir = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir").stdout.trim();
  if (!commonDir) {
    const raw = git(dir, "rev-parse", "--git-common-dir").stdout.trim();
    if (!raw) return "";
    commonDir = path.isAbsolute(raw) ? raw : path.join(dir, raw);
  }
  try {
    return fs.realpathSync(path.dirname(commonDir));
  } catch {
    return "";
  }
}

const USAGE =
  "用法: bash plugin/scripts/release-cut.sh <X.Y.Z> [--root <repo>] [--worktree <path>] " +
  "[--remote <name>] [--base <ref>] [--dispatch-ref <ref>] [--allow-workflow-drift] " +
  "[--no-push] [--no-dispatch] [--dry-run]\n";

const argv = process.argv.slice(2);

// ── `--help` (the `.sh` entry intercepts it first and prints the full header; this is the direct
//    invocation's half, and it must carry no business side effect either) ───────────────────────
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.stdout.write("用法正本 = plugin/scripts/release-cut.sh 的头部注释（`bash plugin/scripts/release-cut.sh --help`）。\n");
  process.exit(0);
}

let version = "";
let root = "";
let worktree = "";
let remote = "origin";
let base = "develop";
let dispatchRefArg = "";
let allowWorkflowDrift = false;
let doPush = true;
let doDispatch = true;
let dryRun = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => (i + 1 < argv.length ? argv[++i] : "");
  switch (a) {
    case "--root": root = next(); break;
    case "--worktree": worktree = next(); break;
    case "--remote": remote = next(); break;
    case "--base": base = next(); break;
    case "--dispatch-ref": dispatchRefArg = next(); break;
    case "--allow-workflow-drift": allowWorkflowDrift = true; break;
    case "--no-push": doPush = false; break;
    case "--no-dispatch": doDispatch = false; break;
    case "--dry-run": dryRun = true; break;
    default:
      if (a.startsWith("-")) {
        process.stderr.write(`release-cut: unknown option: ${a}\n`);
        process.exit(2);
      }
      version = a;
      break;
  }
}

if (!root) {
  root = mainRootOf(SCRIPT_DIR);
  if (!root) {
    fail(
      "release-cut-root-unresolvable",
      `could not derive the main checkout of '${SCRIPT_DIR}' (git rev-parse --git-common-dir failed); pass --root <repo> explicitly`,
      2,
    );
  }
}

// ── the version and the two names derived from it (⛔ the version is never guessed) ────────────
function badVersion(why) {
  process.stderr.write(`CAUSE=release-cut-bad-version — ${why}\n`);
  process.stderr.write(USAGE);
  process.exit(2);
}
if (!version) badVersion("'' is not a version — a bare X.Y.Z is required (this command does not guess one)");
if (!/^[0-9]/.test(version) || /[^0-9.]/.test(version) || version.includes("..") || version.endsWith(".")) {
  badVersion(
    `'${version}' is not a bare X.Y.Z version (leading 'v', a suffix like '-dev', or a non-numeric part is refused: this command does not guess what you meant)`,
  );
}
const parts = version.split(".");
if (parts.length !== 3) {
  badVersion(`'${version}' must have three numeric parts (X.Y.Z), got ${parts.length}`);
}
if (!parts.every((p) => /^[0-9]+$/.test(p))) {
  badVersion(`'${version}' parts must all be numeric: '${version}'`);
}
const [vMajor, vMinor] = parts;
const tag = `v${version}`;
const branch = `release/v${version}`;
const nextVersion = `${vMajor}.${Number(vMinor) + 1}.0`;

// ── is `--root` a checkout at all? ─────────────────────────────────────────────────────────────
if (!fs.existsSync(path.join(root, ".git")) && git(root, "rev-parse", "--git-dir").status !== 0) {
  fail("release-cut-not-a-repo", `'--root ${root}' is not a git checkout; refusing to cut`, 2);
}
try {
  root = fs.realpathSync(root);
} catch {
  fail("release-cut-not-a-repo", `'--root ${root}' does not resolve to a readable directory`, 2);
}

// ── preflight (read-only; ⛔ nothing below this block runs if any check fails) ─────────────────
// ① the tag must not exist: re-pointing a version tag is the one thing a cut must never do.
if (git(root, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}`).status === 0) {
  fail(
    "release-cut-tag-exists",
    `tag '${tag}' already exists in ${root}; pick the next version (⛔ this command never re-points an existing version tag)`,
    2,
  );
}

// ② the tree's version carriers must agree with `VERSION` — the tag is about to name exactly this
// tree, and `version-consistency-check.ts` is the EXTERNAL single-source judgment over it.
const checker = path.join(SCRIPT_ROOT, "scripts", "version-consistency-check.ts");
if (!fs.existsSync(checker)) {
  fail(
    "release-cut-version-checker-missing",
    `'${checker}' does not exist, so 'is this tree version-consistent?' cannot be asked; refusing to cut a tree this command cannot judge (hard rule 3b)`,
    2,
  );
}
const vc = run("node", ["--experimental-strip-types", checker, "--root", root]);
if (vc.status !== 0) {
  process.stderr.write(
    `CAUSE=release-cut-version-inconsistent — ${checker} --root ${root} exited ${vc.status}: the version carriers do not agree with VERSION, so the tag would name a tree whose version is already wrong; run scripts/stamp-version.ts (and fix VERSION) first. Output:\n`,
  );
  process.stderr.write(vc.stdout);
  if (!vc.stdout.endsWith("\n")) process.stderr.write("\n");
  process.stderr.write(vc.stderr);
  process.exit(2);
}

// ③ no tracked edits: the merge stage needs a clean tree, and "the tree I validated" must be the
// tree that gets tagged. Untracked files do not block a merge, so they are not judged here.
if (git(root, "status", "--porcelain", "--untracked-files=no").stdout.trim() !== "") {
  fail(
    "release-cut-dirty-tree",
    `tracked files are modified in ${root}; commit or stash them first (the cut tags the tree it validated, so a dirty tree makes that validation meaningless)`,
    2,
  );
}

// ④ `develop` must resolve, must be FREE to check out, and must not be BEHIND the remote.
if (git(root, "rev-parse", "--verify", "--quiet", `${base}^{commit}`).status !== 0) {
  fail("release-cut-base-unresolvable", `'--base ${base}' does not resolve to a commit in ${root}`, 2);
}
// The landing face merges INTO `$base` and therefore requires HEAD == `$base`, so the worktree this
// command creates must have `$base` checked out — and git refuses to check out one branch in two
// worktrees at once. So an occupied `$base` is a real precondition, not a nuisance: in this repo
// the main checkout normally sits on `author` and this never fires.
if (git(root, "rev-parse", "--verify", "--quiet", `refs/heads/${base}`).status === 0) {
  const holders = [];
  for (const line of git(root, "worktree", "list", "--porcelain").stdout.split("\n")) {
    if (line.startsWith("worktree ")) holders.push({ wt: line.slice("worktree ".length).trim(), branch: "" });
    const m = /^branch (.*)$/.exec(line);
    if (m && holders.length > 0) holders[holders.length - 1].branch = m[1].trim();
  }
  const occupied = holders.filter((h) => h.branch === `refs/heads/${base}`).map((h) => h.wt);
  if (occupied.length > 0) {
    fail(
      "release-cut-base-checked-out",
      `'${base}' is already checked out at [${occupied.join(" ")}]; the cut must check '${base}' out in its own linked worktree (the landing face merges INTO '${base}' and requires HEAD == '${base}'), and git allows a branch in only ONE worktree. Check another branch out there first (in this repo the main checkout normally carries 'author')`,
      2,
    );
  }
}
// ... and it must not be BEHIND the remote: a tag cut from a develop the remote has already moved
// past would ship a release missing commits that are already published. ⚠️ This reads the
// LAST-FETCHED `origin/develop` and never fetches (a cut must not need the network).
if (base === "develop" && remote !== "" && doPush) {
  const remoteBaseRef = `refs/remotes/${remote}/develop`;
  if (git(root, "rev-parse", "--verify", "--quiet", remoteBaseRef).status !== 0) {
    fail(
      "release-cut-develop-sync-unreadable",
      `'${remoteBaseRef}' does not resolve in ${root}, so 'is develop behind the remote?' cannot be answered; refusing to cut (an unanswerable check must not read as 'in sync'). Fetch first, or pass --no-push for a deliberately local cut`,
      2,
    );
  }
  const behindRaw = git(root, "rev-list", "--count", `develop..${remoteBaseRef}`).stdout.trim();
  if (!/^[0-9]+$/.test(behindRaw)) {
    fail("release-cut-develop-sync-unreadable", `could not count develop..${remoteBaseRef} in ${root}`, 2);
  }
  if (Number(behindRaw) !== 0) {
    fail(
      "release-cut-develop-behind-remote",
      `'${remoteBaseRef}' carries ${behindRaw} commit(s) that local '${base}' does not; the cut would tag a tree missing already-published commits (fetch + merge, or pass --no-push for a deliberately local cut)`,
      2,
    );
  }
}

// ── preflight ⑤/P1+P2: WHICH release.yml will govern the run, and what that costs ─────────────
// `dispatchRef` is the ref `gh workflow run --ref` receives. Default: the tag itself (see the
// `--ref` block in the header) — the run is then governed by the very tree the tag names.
const dispatchRef = dispatchRefArg || tag;
const WORKFLOW_PATH = ".github/workflows/release.yml";
if (doDispatch) {
  // The tree the tag will name. The tag does not exist yet (step 2 creates it at the merge point of
  // `base`, which by construction carries `base`'s tree), so `base` IS that tree — see the header.
  const shippedRef = base;
  // When the run is dispatched against the tag, the governing definition IS the shipped one; saying
  // so explicitly is the point (the defect was that this was left to a default-branch semantic).
  const effectiveRef = dispatchRef === tag ? base : dispatchRef;
  const effectiveLabel = dispatchRef === tag
    ? `${tag} (the release tag; its tree is '${base}' at cut time)`
    : dispatchRef;

  const readWorkflowAt = (ref) => {
    const r = git(root, "show", `${ref}:${WORKFLOW_PATH}`);
    return r.status === 0 ? r.stdout : null;
  };
  // ENUMERATE, never boolean (hard rule 3/3b): "the ref does not resolve" and "the file is absent
  // at that ref" are distinct from "both copies were read and agree", and none of the three may
  // share an output shape with the others.
  if (git(root, "rev-parse", "--verify", "--quiet", `${effectiveRef}^{commit}`).status !== 0) {
    fail(
      "release-cut-dispatch-ref-unresolvable",
      `'--dispatch-ref ${dispatchRef}' does not resolve to a commit in ${root}, so 'which release.yml will govern the run?' cannot be answered; refusing to dispatch against a ref this command cannot read (硬规则 3b: 读不懂 ≠ 合格)`,
      2,
    );
  }
  const effectiveText = readWorkflowAt(effectiveRef);
  const shippedText = readWorkflowAt(shippedRef);
  if (effectiveText === null || shippedText === null) {
    fail(
      "release-cut-workflow-definition-unreadable",
      `'${WORKFLOW_PATH}' could not be read at ${effectiveText === null ? `--dispatch-ref ${effectiveRef}` : `'${shippedRef}'`} in ${root}; the governing definition is unknown, and "unknown" must not read as "unchanged" (硬规则 3b)`,
      2,
    );
  }
  const drifted = effectiveText !== shippedText;
  const numstat = drifted
    ? git(root, "diff", "--numstat", shippedRef, effectiveRef, "--", WORKFLOW_PATH).stdout.trim()
    : "";
  const diffstat = drifted
    ? (numstat || `${WORKFLOW_PATH} differs (numstat unreadable)`)
    : `0 insertions / 0 deletions (identical to '${shippedRef}')`;
  // P2 — MAKE IT VISIBLE. This line is the whole point: the release cutter can read, before
  // anything is created, which definition will judge the run and how far it is from the artifact.
  process.stdout.write(
    `preflight: the run will be governed by '${WORKFLOW_PATH}' at ${effectiveLabel}; vs '${shippedRef}': ${diffstat}\n`,
  );
  if (drifted && !allowWorkflowDrift) {
    fail(
      "release-cut-workflow-definition-drift",
      `the release.yml that would govern this run (at '--dispatch-ref ${dispatchRef}') DIFFERS from the one in the tree the tag names ('${shippedRef}') — ${diffstat}\n` +
        `    ⇒ the run would be judged by a definition the released artifact does not carry. Fix '${dispatchRef}', dispatch the tag itself (--dispatch-ref ${tag}), or pass --allow-workflow-drift to proceed deliberately`,
      2,
    );
  }
}

// ── the two paths, and the ledger's landing root (asked of the carrier, so there is ONE derivation)
if (!worktree) {
  worktree = path.join(path.dirname(root), `${path.basename(root)}-worktrees`, `release-${tag}`);
}
// Anchored on THIS tool's own directory (`SCRIPT_DIR`), ⛔ never re-derived from a root — the same
// rule `driver-runtime.ts::resolveKernelScriptsDir()` states for a kernel sibling (it resolves to
// `path.dirname(kernelSelfPath())`, and for a plain-ESM renderer that cannot import the `.ts` kernel
// this is its faithful expression). ⛔ `path.join(SCRIPT_ROOT, "plugin", "scripts", …)` is this same
// path in the dev tree and a nonexistent one in every other layout — the exact `target-root` form
// `kernel-sibling-resolution-check.ts` exists to reject (it reported this line).
const finishCarrier = path.join(SCRIPT_DIR, "release-branch-finish.sh");
if (!fs.existsSync(finishCarrier)) {
  fail(
    "release-cut-finish-carrier-missing",
    `'${finishCarrier}' does not exist, so the cut's landing face (merge → tag → delete) has no carrier in the checkout this command ships in`,
    2,
  );
}
// The landing root is asked of the carrier ITSELF (`--trace-path`), so this tool does not carry a
// second copy of the derivation. It is asked with `--root $root`, not `--root $worktree`, because
// the worktree does not exist yet and — by construction — a linked worktree resolves to the SAME
// ledger as the main checkout it was cut from (`--git-common-dir` is one object).
const traceProbe = run("bash", [finishCarrier, "--trace-path", "--root", root]);
let ledgerPath = traceProbe.stdout.trim();
if (!ledgerPath || traceProbe.status !== 0) {
  ledgerPath = "NOT-EVALUATED (release-branch-finish.sh --trace-path failed — the landing root could not be derived)";
}

if (dryRun) {
  const step4 = doPush ? `git -C ${root} push ${remote} ${base} refs/tags/${tag}` : "(skipped: --no-push)";
  const step5 = doDispatch
    ? `gh workflow run release.yml --ref ${dispatchRef} -f tag=${tag}`
        + `   (the governing definition is ${WORKFLOW_PATH} at ${dispatchRef === tag ? `${tag} — the tagged tree, ⛔ NOT the default branch` : dispatchRef})`
    : "(skipped: --no-dispatch)";
  const step7 = doPush ? `git -C ${root} push ${remote} ${base}   (the bump commit)` : "(skipped: --no-push)";
  const plan = [
    "dry-run: preflight PASSED — nothing was created and no ref was touched",
    `  1. create linked worktree '${worktree}' off '${base}' in ${root}`,
    `     (⛔ a LINKED WORKTREE off ${base} — not an independent clone, not a branch switch in the main checkout)`,
    "  1b. link node_modules into it (the bump stage's closure-ratchet re-anchor runs a real quay-init laydown)",
    `  2. create '${branch}' at '${base}'`,
    `  3. bash ${finishCarrier} ${branch} --cut --tag ${tag} --root ${worktree}`,
    `     → merge '${branch}' back into '${base}', tag ${tag} at the merge point, delete '${branch}'`,
    `     → the finish record lands at: ${ledgerPath}`,
    `  4. ${step4}`,
    `  5. ${step5}`,
    `  6. bump VERSION ${version} -> ${nextVersion} on '${base}' in ${worktree} + stamp-version.ts`,
    `  7. ${step7}`,
    `  8. git -C ${root} worktree remove ${worktree}`,
  ];
  process.stdout.write(plan.join("\n") + "\n");
  process.exit(0);
}

// ── step 1: the linked worktree ON `develop` (the landing face requires HEAD == base) ─────────
if (fs.existsSync(worktree)) {
  fail(
    "release-cut-worktree-exists",
    `'${worktree}' already exists; refusing to reuse it (a stale worktree is not a fresh base for a cut)`,
    2,
  );
}
if (git(root, "branch", branch, base).status !== 0) {
  fail(
    "release-cut-branch-create-failed",
    `could not create '${branch}' at '${base}' in ${root} (does it already exist?)`,
    1,
  );
}
if (git(root, "worktree", "add", worktree, base).status !== 0) {
  git(root, "branch", "-D", branch);
  fail(
    "release-cut-worktree-create-failed",
    `could not create the linked worktree at '${worktree}' on '${base}' (is '${base}' checked out in another worktree?); the branch '${branch}' was removed again, nothing was tagged`,
    1,
  );
}

// ── step 1b: PROVISION it (⛔ a bare `git worktree add` is not enough — measured) ──────────────
// `git worktree add` places only TRACKED files, and step 5's closure-ratchet re-anchor runs a REAL
// `quay-init --all --loop --manager` laydown, which needs esbuild/node from node_modules. Measured
// on a bare worktree off `develop` (2026-09-24): without node_modules the laydown exits non-zero and
// the ratchet reports NOT-EVALUATED ("unwritten: tasks goals .gitignore .claude/…", i.e. "cannot
// re-anchor without a measurement"); with a node_modules link — and nothing else — it PASSES and
// re-measures exactly the committed 3 files / 1022 bytes. So the gitignored carriers that
// `scripts/worktree-include.sh` copies (.quay/config.yml, the plugin/vendor dist bundles) are NOT
// needed for this stage, and calling it here would make the cut depend on the source checkout having
// built artifacts it does not need. ⛔ Never `npm install` per release worktree: the main checkout's
// installed deps are shared by symlink, exactly as plugin/scripts/dispatch-worktree-setup.sh step 1
// does (that script is the canonical provisioner but is TASK-branch-specific by design — it refuses
// a worktree whose branch is not `task/*`, and this one carries `$base`).
const rootModules = path.join(root, "node_modules");
const wtModules = path.join(worktree, "node_modules");
if (fs.existsSync(rootModules) && !fs.existsSync(wtModules)) {
  try {
    fs.symlinkSync(rootModules, wtModules);
  } catch {
    /* best-effort: the bump stage's own CAUSE= is the honest reporter if this was needed */
  }
}

// ── step 2: the cut's landing face, in ONE invocation (merge → tag → delete) ──────────────────
const finish = run("bash", [finishCarrier, branch, "--cut", "--tag", tag, "--root", worktree], {
  stdio: ["ignore", "inherit", "inherit"],
});
if (finish.status !== 0) {
  fail(
    "release-cut-finish-step-failed",
    `the landing face (merge '${branch}' into '${base}' → tag ${tag} → delete) failed; the linked worktree at '${worktree}' is LEFT IN PLACE for inspection (⛔ it is not removed for you), and the branch/tag state is whatever the step reported above`,
    1,
  );
}

// ── step 3: push the tag and develop ──────────────────────────────────────────────────────────
if (doPush) {
  if (git(root, "push", remote, base, `refs/tags/${tag}`).status !== 0) {
    fail(
      "release-cut-push-failed",
      `the cut landed locally (tag ${tag} exists, '${branch}' is deleted) but pushing '${base}' + ${tag} to '${remote}' failed; re-run the push by hand — ⛔ do NOT re-run this command, it would refuse on the existing tag`,
      1,
    );
  }
}

// ── step 4: dispatch release.yml on the tag, and echo the run URL ─────────────────────────────
if (doDispatch) {
  // ⛔ `ignore` is KEPT here, and it is the only all-ignore left in this file: this is a pure
  // EXISTENCE probe whose whole signal is the exit status. `command -v` writes the resolved path to
  // stdout and NOTHING to stderr on failure, so there is no diagnostic to fold in — the CAUSE
  // below already states the fact the probe measured ("'gh' is not on PATH"). Contrast the three
  // sites further down, where a FAILED command has its own reason to report.
  if (run("bash", ["-c", "command -v gh"], { stdio: ["ignore", "ignore", "ignore"] }).status !== 0) {
    fail(
      "release-cut-dispatch-unavailable",
      `'gh' is not on PATH, so release.yml was NOT dispatched; the cut itself is complete (tag ${tag} pushed). Dispatch by hand: gh workflow run release.yml --ref ${dispatchRef} -f tag=${tag}`,
      1,
    );
  }
  // ⛔ `--ref` is NOT optional here: without it `gh` runs the workflow file on the repository's
  // DEFAULT BRANCH, i.e. the PREVIOUS release's definition (see the header's `--ref` block).
  const dispatched = run("gh", ["workflow", "run", "release.yml", "--ref", dispatchRef, "-f", `tag=${tag}`], { stdio: ["ignore", "pipe", "pipe"] });
  if (dispatched.status !== 0) {
    fail(
      "release-cut-dispatch-failed",
      `'gh workflow run release.yml --ref ${dispatchRef} -f tag=${tag}' failed (gh exited ${dispatched.status}); the cut itself is complete. Dispatch by hand and record the run id. gh's own reason — ${diagnosticTail(dispatched)}`,
      1,
    );
  }
  // The run URL is an OUT-OF-BAND result (runner / billing problems are not this command's to
  // judge — see the task's DoD): echo it, and never turn a missing URL into a failed cut.
  run("bash", ["-c", "sleep 2"]);
  const listed = run("gh", ["run", "list", "--workflow", "release.yml", "--limit", "1", "--json", "url", "--jq", ".[0].url"]);
  const runUrl = listed.status === 0 ? listed.stdout.trim() : "";
  process.stdout.write(
    runUrl
      ? `dispatched: ${runUrl}\n`
      : `dispatched: release.yml on ${tag} (run URL not readable yet — gh run list returned nothing; check 'gh run list --workflow release.yml')\n`,
  );
}

// ── step 5: bump VERSION on develop to the NEXT version (+ stamp) ───────────────────────────────
// The bump is a commit ON `develop` with the next version, so the rolling channels advertise a
// version that does not exist yet rather than one that does (§4.3 选项 ii / §12).
// ⛔ The closure-ratchet re-anchor this step used to perform is GONE with the ratchet itself
// (gap-quay-init-sh-becomes-a-shim-over-bin-quay-init-and-callers-switch) — there is no committed
// baseline left to go stale when the bump changes plugin/.claude-plugin/plugin.json.
// `stamp-version.ts` lives in the REPO TREE's `scripts/` — outside `plugin/`, never shipped, and run
// as raw `.ts` — which is why a release cut is a DEV-TREE-ONLY operation by construction.
const stamper = path.join(SCRIPT_ROOT, "scripts", "stamp-version.ts");
if (!fs.existsSync(stamper)) {
  fail(
    "release-cut-bump-tooling-missing",
    `'${stamper}' is missing from ${root}, so the next-version bump cannot be performed; the cut itself is complete (tag ${tag}). Bump by hand: write VERSION=${nextVersion}, run scripts/stamp-version.ts, and commit on ${base}`,
    1,
  );
}
try {
  fs.writeFileSync(path.join(worktree, "VERSION"), `${nextVersion}\n`);
} catch (err) {
  fail("release-cut-bump-write-failed", `could not write VERSION=${nextVersion} in '${worktree}': ${err.message}`, 1);
}
const stamped = run("node", ["--experimental-strip-types", stamper, "--root", worktree], { stdio: ["ignore", "pipe", "pipe"] });
if (stamped.status !== 0) {
  fail(
    "release-cut-bump-stamp-failed",
    `scripts/stamp-version.ts failed against '${worktree}' (exited ${stamped.status}); the cut itself is complete (tag ${tag}), but the next-version bump did NOT land — 'develop' still advertises ${version}. stamp-version's own reason — ${diagnosticTail(stamped)}`,
    1,
  );
}
const added = git(worktree, "add", "-A");
const committed = added.status === 0
  ? git(worktree, "commit", "-q", "-m", `release: bump version to ${nextVersion} after ${tag} (SPEC §12: VERSION + stamp)`)
  : { status: 1 };
if (committed.status !== 0) {
  fail(
    "release-cut-bump-commit-failed",
    `could not commit the next-version bump in '${worktree}' (tree left dirty there; the cut itself is complete: tag ${tag})`,
    1,
  );
}
if (doPush && git(root, "push", remote, base).status !== 0) {
  fail(
    "release-cut-bump-push-failed",
    `the next-version bump is committed locally on '${base}' but pushing it to '${remote}' failed; push by hand (the tag ${tag} is already pushed)`,
    1,
  );
}

// ── step 6: remove the worktree this command created (⛔ only its own) ────────────────────────
if (git(root, "worktree", "remove", worktree).status !== 0) {
  fail(
    "release-cut-worktree-remove-failed",
    `the cut is COMPLETE, but the worktree at '${worktree}' could not be removed (is something still dirty there?); remove it by hand with 'git -C ${root} worktree remove ${worktree}'`,
    1,
  );
}

process.stdout.write(
  `cut: ${tag} landed on '${base}' (merge point tagged, '${branch}' deleted), released via release.yml, and '${base}' now carries ${nextVersion}\n`,
);
process.exit(0);
