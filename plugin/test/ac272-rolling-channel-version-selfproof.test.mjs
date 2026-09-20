// @test-group engine
// ac272-rolling-channel-version-selfproof.test.mjs — the AC-272 regression guard
// (tasks/gap-ac272-rolling-channel-criterion-reads-unowned-local-ref; the criterion lives in
// goals/AC-272-*.md and is re-run every round by goal-driver, so this file is the SUITE-side guard
// that the criterion keeps reading the right ref).
//
// THE DEFECT THIS PINS. AC-272's criterion resolved the rolling channel with
// `git rev-parse --verify -q "dist-plugin^{commit}"`. git's ref dwim order is
// refs/<name> → refs/tags/<name> → refs/heads/<name> → refs/remotes/<name> and does NOT include
// refs/remotes/origin/<name>, so a bare `dist-plugin` can only ever hit a LOCAL branch — and that
// local branch has no owner: plugin/scripts/publish-dist-branch.sh deletes it on every publish
// (`branch -D`, so `checkout --orphan` can reuse the name) and builds the orphan in a throwaway
// worktree it removes afterwards. The criterion was the ONLY reader of that ref in the whole repo.
// So the criterion was structurally永假: it could only pass in a checkout nobody maintains, and it
// emitted a false red every round while the channel itself was fine.
//
// THE FIX BEING GUARDED: resolve a CANDIDATE LIST, remote-tracking first —
// refs/remotes/origin/dist-plugin (the branch the marketplace source
// {"source":"github","repo":"yaleh/quay","ref":"dist-plugin"} actually pulls) → refs/heads/dist-plugin
// (the local copy). NOTHING ELSE CHANGED: the two arms, the six CAUSE tokens and the exit codes are
// the ones the criterion already had.
//
// WHY THIS TEST IS NOT VACUOUS (hard rule 4: a quantity that structurally cannot be false is not a
// measurement). Every arm runs the criterion EXACTLY AS STORED — read out of the goal store, not
// copied into this file — through runAcceptance, the same runner `quay goal gate` calls. The scratch
// repos below give the criterion a channel that exists ONLY as refs/remotes/origin/dist-plugin, which
// is the production shape. THAT is what makes the reversion control falsifiable: put the bare
// `dist-plugin` back and the same scratch repo turns the criterion red (asserted explicitly at the
// bottom, so the mutation cannot silently stop applying).
//
// HERMETIC: bare `git` with no `-C` is what the criterion uses, so every arm is reproduced by running
// it with cwd = a throwaway repo under os.tmpdir(); the production checkout is never touched.
//
// Run: scripts/test.sh plugin/test/ac272-rolling-channel-version-selfproof.test.mjs
//      node --test plugin/test/ac272-rolling-channel-version-selfproof.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createGoalStore } from "../../packages/quay/src/goal-store.ts";
import { runAcceptance } from "../../packages/quay/src/gate/acceptance-runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const GOAL_ID = "AC-272";
const CHANNEL_REMOTE = "refs/remotes/origin/dist-plugin";
const CHANNEL_LOCAL = "refs/heads/dist-plugin";

// One scratch root for the whole file, removed in after(). Never a fixed __dirname/.tmp-* path
// (test-isolation contract in scripts/test.sh's header).
const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ac272-guard-"));
after(() => {
  fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

// A pinned identity in the CHILD env, never in repo config (fixture-git-identity memory): the
// scratch repos must be reproducible without depending on the host's git identity.
const GIT_ID = [
  "-c", "user.email=fixture@example.invalid",
  "-c", "user.name=fixture",
  "-c", "commit.gpgsign=false",
];

/** Run one git command in `cwd`, returning trimmed stdout. */
function git(cwd, ...args) {
  return execFileSync("git", [...GIT_ID, ...args], { cwd, encoding: "utf8" }).trim();
}

/** A fresh single-commit repo under SCRATCH_ROOT (so `git rev-parse --verify` has a real repo). */
function mkScratch(name) {
  const d = path.join(SCRATCH_ROOT, name);
  fs.mkdirSync(d, { recursive: true });
  git(d, "init", "-q", ".");
  git(d, "commit", "-q", "--allow-empty", "-m", "base");
  return d;
}

/**
 * A one-file (VERSION) commit on top of `parent`, with subject `subject`, in repo `d`. Plumbing
 * (hash-object / update-index / write-tree / commit-tree) so the fixture needs no working tree, no
 * checkout and no identity. `idxKey` keeps each call's index file distinct. Returns the sha.
 */
function mkCommit(d, parent, subject, version, idxKey) {
  fs.writeFileSync(path.join(d, "VERSION"), version + "\n");
  const blob = git(d, "hash-object", "-w", "VERSION");
  const env = { ...process.env, GIT_INDEX_FILE: path.join(d, `.idx-${idxKey}`) };
  const run = (args) => execFileSync("git", [...GIT_ID, ...args], { cwd: d, env, encoding: "utf8" }).trim();
  run(["read-tree", "--empty"]);
  run(["update-index", "--add", "--cacheinfo", `100644,${blob},VERSION`]);
  const tree = run(["write-tree"]);
  return run(["commit-tree", tree, "-p", parent, "-m", subject]);
}

/** Run a criterion string the way the gate does, in `cwd`. Returns the runner's own result. */
function runCriterion(criterion, cwd) {
  return runAcceptance({ command: criterion, cwd, timeoutMs: 60000 });
}

/** The criterion EXACTLY AS THE STORE HOLDS IT — never a copy pasted into this file. */
function storedCriterion() {
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const rec = store.get(GOAL_ID);
  assert.ok(rec, `${GOAL_ID} not found in the goal store — the record was renamed or removed`);
  const criterion = rec.criterion;
  assert.equal(typeof criterion, "string", `${GOAL_ID}.criterion is not a string (got ${typeof criterion})`);
  assert.notEqual(criterion.trim(), "", `${GOAL_ID}.criterion is empty — nothing to run`);
  return criterion;
}

/**
 * The REVERSION CONTROL's mutation: put the pre-fix ref source back (a bare local `dist-plugin`).
 * assert.notEqual is load-bearing — if the criterion's candidate list ever changes shape, the
 * replacement stops matching and this test must FAIL rather than quietly run the un-mutated text
 * (hard rule 3b: "could not build the control" must not render as "the control passed").
 */
function revertToBareLocalRef(criterion) {
  const mutated = criterion.replace(
    `for cand in ("${CHANNEL_REMOTE}", "${CHANNEL_LOCAL}"):`,
    'for cand in ("dist-plugin",):',
  );
  assert.notEqual(
    mutated,
    criterion,
    "the reversion mutation did not apply — AC-272's candidate list is no longer the two-entry tuple this control edits",
  );
  return mutated;
}

/** Read a scratch repo's resolution of a ref: true iff it resolves. */
function resolves(d, ref) {
  try {
    git(d, "rev-parse", "--verify", "-q", `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/** The criterion's candidate list, read AS DATA out of its `for cand in (...)` header.
 *
 *  ⛔ Deliberately NOT a substring search over the whole criterion. The CAUSE prose also names both
 *  refs (the branch-absent message explains which two it looked for), so `indexOf(REMOTE) < indexOf(LOCAL)`
 *  is satisfied by the MESSAGE even when the CODE reads a bare local ref — a measured false pass: with
 *  the pre-fix tuple restored the text-position assertion still went green while five arms went red.
 *  Extracting the tuple keeps the assertion about the code path it claims to be about. */
function candidateList(criterion) {
  const m = criterion.match(/for cand in \(([^)]*)\):/);
  assert.ok(m, "the criterion has no `for cand in (...)` header — its ref resolution changed shape");
  const cands = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(cands.length > 0, `the candidate list is empty (header: ${JSON.stringify(m[0])})`);
  return cands;
}

// ── the criterion's own text: the ref source is remote-tracking FIRST (positional, not keyword) ────
test("AC-272 resolves the channel from refs/remotes/origin/dist-plugin before the local branch", () => {
  const cands = candidateList(storedCriterion());
  assert.equal(
    cands[0],
    CHANNEL_REMOTE,
    `the FIRST candidate is ${cands[0]}, not ${CHANNEL_REMOTE} — the marketplace side must win`,
  );
  assert.deepEqual(
    cands,
    [CHANNEL_REMOTE, CHANNEL_LOCAL],
    `the candidate list is ${JSON.stringify(cands)} — expected the remote-tracking channel first, then the local copy`,
  );
  assert.ok(
    !cands.includes("dist-plugin"),
    "the pre-fix bare `dist-plugin` is back in the candidate list — git's dwim can only resolve that to the unowned local branch",
  );
  assert.ok(
    !storedCriterion().includes('"dist-plugin^{commit}"'),
    "the criterion still carries the pre-fix bare-local ref expression",
  );
});

// ── arm ① (green): the channel exists ONLY as a remote-tracking ref and IS the tagged build ─────────
test("AC-272 arm 1: green when the channel is the remote-tracking ref and equals the tagged build", () => {
  const d = mkScratch("arm1");
  const base = git(d, "rev-parse", "HEAD");
  const tagged = mkCommit(d, base, "release: v0.10.0", "0.10.0", "tagged");
  const tip = mkCommit(d, tagged, `dist-plugin: build from ${tagged}`, "0.10.0", "tip");
  git(d, "update-ref", CHANNEL_REMOTE, tip);
  git(d, "tag", "v0.10.0", tagged);

  // Fixture precondition: the local branch that the PRE-FIX criterion read must NOT exist, or arm 1
  // would pass for the wrong reason and the reversion control below would be indistinguishable.
  assert.equal(resolves(d, CHANNEL_LOCAL), false, "fixture bug: a local dist-plugin branch exists, so this arm cannot distinguish the two ref sources");

  const r = runCriterion(storedCriterion(), d);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code} — reason: ${r.reason}`);
});

// ── arm ② (green): the -dev suffix self-certifies a NON-release, so no tag is needed ───────────────
test("AC-272 arm 2: green on the -dev suffix arm without any tag", () => {
  const d = mkScratch("arm2");
  const base = git(d, "rev-parse", "HEAD");
  const tip = mkCommit(d, base, `dist-plugin: build from ${base}`, "0.99.99-dev", "tip");
  git(d, "update-ref", CHANNEL_REMOTE, tip);
  const r = runCriterion(storedCriterion(), d);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code} — reason: ${r.reason}`);
});

// ── arm ③ (red): a bare version with no same-named tag ─────────────────────────────────────────────
test("AC-272 arm 3: red with claims-a-version-that-was-never-released", () => {
  const d = mkScratch("arm3");
  const base = git(d, "rev-parse", "HEAD");
  const tip = mkCommit(d, base, `dist-plugin: build from ${base}`, "0.99.99", "tip");
  git(d, "update-ref", CHANNEL_REMOTE, tip);
  const r = runCriterion(storedCriterion(), d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /CAUSE=claims-a-version-that-was-never-released/);
});

// ── arm ④ (red): the tag exists but the channel tip records no build source ────────────────────────
test("AC-272 arm 4: red with build-source-unrecorded", () => {
  const d = mkScratch("arm4");
  const base = git(d, "rev-parse", "HEAD");
  const tip = mkCommit(d, base, "dist-plugin: refresh bundle (no marker)", "0.99.99", "tip");
  git(d, "update-ref", CHANNEL_REMOTE, tip);
  git(d, "tag", "v0.99.99", base);
  const r = runCriterion(storedCriterion(), d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /CAUSE=build-source-unrecorded/);
});

// ── arm ⑤ (red): the tag exists, the marker resolves, but it is a DIFFERENT commit ─────────────────
test("AC-272 arm 5: red with released-version-built-from-a-different-commit", () => {
  const d = mkScratch("arm5");
  const base = git(d, "rev-parse", "HEAD");
  const tagged = mkCommit(d, base, "release: v0.99.99", "0.99.99", "tagged");
  const elsewhere = mkCommit(d, tagged, "develop: unrelated", "0.99.99", "elsewhere");
  const tip = mkCommit(d, elsewhere, `dist-plugin: build from ${elsewhere}`, "0.99.99", "tip");
  git(d, "update-ref", CHANNEL_REMOTE, tip);
  git(d, "tag", "v0.99.99", tagged);
  const r = runCriterion(storedCriterion(), d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /CAUSE=released-version-built-from-a-different-commit/);
});

// ── arm ⑥ (red, INSTRUMENT state): no candidate ref resolves at all ────────────────────────────────
test("AC-272 arm 6: red with dist-plugin-branch-absent when no candidate ref resolves", () => {
  const d = mkScratch("arm6");
  assert.equal(resolves(d, CHANNEL_REMOTE), false, "fixture bug: the remote-tracking ref exists");
  assert.equal(resolves(d, CHANNEL_LOCAL), false, "fixture bug: the local ref exists");
  const r = runCriterion(storedCriterion(), d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /CAUSE=dist-plugin-branch-absent/);
});

// ── the candidate list is a LIST, not a rename: a channel present only as the LOCAL branch is green ─
test("AC-272: the local branch is still an accepted channel (the second candidate entry is live)", () => {
  const d = mkScratch("localonly");
  const base = git(d, "rev-parse", "HEAD");
  const tip = mkCommit(d, base, `dist-plugin: build from ${base}`, "0.99.99-dev", "tip");
  git(d, "update-ref", CHANNEL_LOCAL, tip);
  assert.equal(resolves(d, CHANNEL_REMOTE), false, "fixture bug: the remote-tracking ref exists");
  const r = runCriterion(storedCriterion(), d);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code} — reason: ${r.reason}`);
});

// ── REVERSION CONTROL: revert the ref source to the bare local name and the SAME repo goes red ─────
test("AC-272 reversion control: reverting the ref source to bare `dist-plugin` turns arm 1 red", () => {
  const d = mkScratch("reversion");
  const base = git(d, "rev-parse", "HEAD");
  const tagged = mkCommit(d, base, "release: v0.10.0", "0.10.0", "tagged");
  const tip = mkCommit(d, tagged, `dist-plugin: build from ${tagged}`, "0.10.0", "tip");
  git(d, "update-ref", CHANNEL_REMOTE, tip);
  git(d, "tag", "v0.10.0", tagged);

  const criterion = storedCriterion();
  const asStored = runCriterion(criterion, d);
  const asReverted = runCriterion(revertToBareLocalRef(criterion), d);

  assert.equal(asStored.code, 0, `the stored criterion must pass here; got ${asStored.code} — ${asStored.reason}`);
  assert.notEqual(
    asReverted.code,
    0,
    "reverting the ref source to the bare local name still passed — this test is not pinning the ref source",
  );
  assert.match(
    asReverted.reason,
    /CAUSE=dist-plugin-branch-absent/,
    `the reverted criterion must fail as an absent ref, not for some other reason: ${asReverted.reason}`,
  );
});
