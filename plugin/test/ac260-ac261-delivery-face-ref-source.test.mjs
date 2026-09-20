// @test-group engine
// ac260-ac261-delivery-face-ref-source.test.mjs — the AC-260 / AC-261 regression guard
// (tasks/gap-ac260-criterion-reads-unowned-local-dist-plugin-ref; both criteria live in goals/AC-260-*.md
// and goals/AC-261-*.md and are re-run every round by the goal-driver / the frozen-population rotation,
// so this file is the SUITE-side guard that they keep reading the right ref).
//
// THE DEFECT THIS PINS. Both criteria resolved the delivery face with a BARE `dist-plugin`. git's ref
// dwim order is refs/<name> → refs/tags/<name> → refs/heads/<name> → refs/remotes/<name> and does NOT
// include refs/remotes/origin/<name>, so a bare `dist-plugin` can only ever hit a LOCAL branch — and
// that local branch has no owner: plugin/scripts/publish-dist-branch.sh deletes it on every publish
// (`git branch -D`, so `checkout --orphan` can reuse the name) and builds the orphan in a throwaway
// worktree it removes afterwards. Neither criterion was the only reader of that ref at the time —
// AC-272 had already been fixed — but the sweep that fixed AC-272 grepped only plugin/ scripts/
// packages/ .github/ and MISSED goals/, which is exactly where the siblings live (hard rule 5b: the
// defect was fixed in the instance that was reported, not in the carrier that held the family).
// So both criteria were structurally false: they could only pass in a checkout nobody maintains, and
// they emitted a false red every round while the delivery face itself was fine (measured: channel
// commit f5721805, identical to `git ls-remote origin refs/heads/dist-plugin`, 175 dist references,
// 0 cwd-relative offenders, 0 dangling raw .ts).
//
// THE FIX BEING GUARDED: resolve a CANDIDATE LIST, remote-tracking first —
// refs/remotes/origin/dist-plugin (the branch the marketplace source
// {"source":"github","repo":"yaleh/quay","ref":"dist-plugin"} actually pulls) → refs/heads/dist-plugin
// (the local copy). For AC-260 NOTHING ELSE CHANGED: the three arms, the zero-count guard and the
// exit codes are the ones the criterion already had. For AC-261 the other four arms (work-tree shim
// present + executable, mode 100755 on the channel, minimal-PATH `quay --version` semver, `command -v
// quay` resolving to the shim) are untouched — only the ls-tree ref and the message naming it moved
// from the literal `dist-plugin` to the resolved CHAN.
//
// WHY THIS TEST IS NOT VACUOUS (hard rule 4: a quantity that structurally cannot be false is not a
// measurement). Every arm runs the criterion EXACTLY AS STORED — read out of the goal store, not
// copied into this file — through runAcceptance, the same runner `quay goal gate` calls. The scratch
// repos below give each criterion a channel that exists ONLY as refs/remotes/origin/dist-plugin, which
// is the production shape. THAT is what makes the reversion control falsifiable: put the bare
// `dist-plugin` back into the candidate list and the same scratch repo turns the criterion red
// (asserted explicitly at the bottom, so the mutation cannot silently stop applying).
//
// HERMETIC: bare `git` with no `-C` is what both criteria use, so every arm is reproduced by running
// the criterion with cwd = a throwaway repo under os.tmpdir(); the production checkout is never
// touched, and neither criterion is ever handed the real dist-plugin ref.
//
// Run: scripts/test.sh plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs
//      node --test plugin/test/ac260-ac261-delivery-face-ref-source.test.mjs

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

const AC260 = "AC-260";
const AC261 = "AC-261";
const CHANNEL_REMOTE = "refs/remotes/origin/dist-plugin";
const CHANNEL_LOCAL = "refs/heads/dist-plugin";

// One scratch root for the whole file, removed in after(). Never a fixed __dirname/.tmp-* path
// (test-isolation contract in scripts/test.sh's header).
const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ac260-guard-"));
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
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

/** Run one git command in `cwd`, returning trimmed stdout. */
function git(cwd, ...args) {
  return execFileSync("git", [...GIT_ID, ...args], { cwd, encoding: "utf8", env: GIT_ENV }).trim();
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
 * Point `ref` at a one-commit tree holding exactly `files` ([{ stage, path, mode, content }]).
 * Plumbing (hash-object / update-index / write-tree / commit-tree): the fixture needs no working
 * tree, no checkout and no identity. `stage` is where the bytes are written on disk to be hashed;
 * `path` is where they appear in the committed tree (they differ for AC-261, whose channel entry has
 * to be literally `bin/quay` while the fixture bytes may live anywhere).
 */
function putTree(d, ref, files) {
  const idx = path.join(d, `.idx-${Math.random().toString(36).slice(2)}`);
  const env = { ...GIT_ENV, GIT_INDEX_FILE: idx };
  const g = (...a) => execFileSync("git", [...GIT_ID, ...a], { cwd: d, encoding: "utf8", env }).trim();
  g("read-tree", "--empty");
  for (const f of files) {
    const full = path.join(d, f.stage);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, f.content);
    const blob = g("hash-object", "-w", f.stage);
    g("update-index", "--add", "--cacheinfo", `${f.mode},${blob},${f.path}`);
  }
  const tree = g("write-tree");
  const c = g("commit-tree", tree, "-m", `dist-plugin: build from ${git(d, "rev-parse", "HEAD")}`);
  git(d, "update-ref", ref, c);
  fs.rmSync(idx, { force: true });
}

/** A carrier file body that carries `n` correctly-anchored scripts/dist references. */
const CLEAN_CARRIER = "Use ${CLAUDE_PLUGIN_ROOT}/scripts/dist/foo.js here.\n";

/** The shim body AC-261's fourth arm accepts: any semver on stdout. */
const SHIM = "#!/bin/sh\necho 9.9.9\n";

/** Run a criterion string the way the gate does, in `cwd`. Returns the runner's own result. */
function runCriterion(criterion, cwd) {
  return runAcceptance({ command: criterion, cwd, timeoutMs: 120000 });
}

/** The criterion EXACTLY AS THE STORE HOLDS IT — never a copy pasted into this file. */
function storedCriterion(id) {
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const rec = store.get(id);
  assert.ok(rec, `${id} not found in the goal store — the record was renamed or removed`);
  const criterion = rec.criterion;
  assert.equal(typeof criterion, "string", `${id}.criterion is not a string (got ${typeof criterion})`);
  assert.notEqual(criterion.trim(), "", `${id}.criterion is empty — nothing to run`);
  return criterion;
}

/** The criterion's candidate list, read AS DATA out of its `for <x> in (...)` header.
 *
 *  ⛔ Deliberately NOT a substring search over the whole criterion. The instrument-state prose also
 *  names both refs (its message explains which two were tried), so `indexOf(REMOTE) < indexOf(LOCAL)`
 *  is satisfied by the MESSAGE even when the CODE reads a bare local ref — the exact measured false
 *  pass AC-272's guard records having hit (with the pre-fix tuple restored, the text-position
 *  assertion stayed green while five arms went red). Extracting the tuple keeps the assertion about
 *  the code path it claims to be about. */
function candidateList(criterion) {
  const m = criterion.match(/for\s+\w+\s+in\s+\(([^)]*)\):/);
  assert.ok(m, "the criterion has no `for <x> in (...)` header — its ref resolution changed shape");
  const cands = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(cands.length > 0, `the candidate list is empty (header: ${JSON.stringify(m[0])})`);
  return cands;
}

/** The REVERSION CONTROL's mutation: put the pre-fix ref source back (a bare local `dist-plugin`).
 *  assert.notEqual is load-bearing — if either criterion's candidate list ever changes shape, the
 *  replacement stops matching and this test must FAIL rather than quietly run the un-mutated text
 *  (hard rule 3b: "could not build the control" must not render as "the control passed"). */
function revertToBareLocalRef(criterion, headerRe) {
  const m = criterion.match(headerRe);
  assert.ok(m, `no candidate-list header matched ${headerRe} — the ref resolution changed shape`);
  const mutated = criterion.replace(headerRe, 'for _cand in ("dist-plugin",):');
  assert.notEqual(mutated, criterion, "the reversion mutation did not apply");
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

// ── each criterion's own text: the ref source is remote-tracking FIRST (positional, not keyword) ───
for (const id of [AC260, AC261]) {
  test(`${id} resolves the channel from refs/remotes/origin/dist-plugin before the local branch`, () => {
    const crit = storedCriterion(id);
    const cands = candidateList(crit);
    assert.equal(
      cands[0],
      CHANNEL_REMOTE,
      `${id}: the FIRST candidate is ${cands[0]}, not ${CHANNEL_REMOTE} — the marketplace side must win`,
    );
    assert.deepEqual(
      cands,
      [CHANNEL_REMOTE, CHANNEL_LOCAL],
      `${id}: the candidate list is ${JSON.stringify(cands)} — expected the remote-tracking channel first, then the local copy`,
    );
    assert.ok(
      !cands.includes("dist-plugin"),
      `${id}: the pre-fix bare \`dist-plugin\` is back in the candidate list — git's dwim can only resolve that to the unowned local branch`,
    );
    assert.ok(
      !/"dist-plugin"/.test(crit),
      `${id}: the criterion still carries the pre-fix bare-local ref literal`,
    );
  });
}

// ── AC-261: the message/expect must name the RESOLVED ref, never a hardcoded local branch ─────────
test("AC-261 names the resolved channel, never a hardcoded local branch, in its failure message", () => {
  const crit = storedCriterion(AC261);
  assert.ok(
    /cannot read %s bin\//.test(crit),
    "AC-261's ls-tree failure message no longer interpolates the resolved ref — it would claim a remote-tracking ref is a local branch",
  );
  const store = createGoalStore(path.join(REPO_ROOT, "goals"));
  const expect = store.get(AC261).expect ?? "";
  assert.ok(
    /随渠道\s*ref/.test(expect),
    "AC-261's `expect` still says the shim ships with a bare `dist-plugin`",
  );
  assert.ok(
    !/随 dist-plugin/.test(expect),
    "AC-261's `expect` still carries the pre-fix bare-ref phrase",
  );
});

// ── AC-260 arms ───────────────────────────────────────────────────────────────────────────────────
const C260 = storedCriterion(AC260);
const C260_HEADER = /for _cand in \("refs\/remotes\/origin\/dist-plugin", "refs\/heads\/dist-plugin"\):/;

test("AC-260 arm 1: green when the channel is the remote-tracking ref and the carrier is clean", () => {
  const d = mkScratch("a260-arm1");
  putTree(d, CHANNEL_REMOTE, [{ stage: "sub/SKILL.md", path: "sub/SKILL.md", mode: "100644", content: CLEAN_CARRIER }]);
  // Fixture precondition: the local branch the PRE-FIX criterion read must NOT exist, or this arm
  // would pass for the wrong reason and the reversion control would be indistinguishable.
  assert.equal(resolves(d, CHANNEL_LOCAL), false, "fixture bug: a local dist-plugin branch exists");
  const r = runCriterion(C260, d);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code} — reason: ${r.reason}`);
});

test("AC-260 arm 2: green when the channel is present ONLY as the local branch (second entry is live)", () => {
  const d = mkScratch("a260-arm2");
  putTree(d, CHANNEL_LOCAL, [{ stage: "sub/SKILL.md", path: "sub/SKILL.md", mode: "100644", content: CLEAN_CARRIER }]);
  assert.equal(resolves(d, CHANNEL_REMOTE), false, "fixture bug: the remote-tracking ref exists");
  const r = runCriterion(C260, d);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code} — reason: ${r.reason}`);
});

test("AC-260 arm 3 (instrument state): red and DISTINGUISHABLE when no candidate ref resolves", () => {
  const d = mkScratch("a260-arm3");
  assert.equal(resolves(d, CHANNEL_REMOTE), false, "fixture bug: the remote-tracking ref exists");
  assert.equal(resolves(d, CHANNEL_LOCAL), false, "fixture bug: the local ref exists");
  const r = runCriterion(C260, d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /INSTRUMENT STATE/, `the absent-ref arm must declare itself an instrument state: ${r.reason}`);
  assert.match(r.reason, /NOT been judged/, "the instrument state must say the face was not judged, not that it failed");
  assert.doesNotMatch(
    r.reason,
    /still carry a cwd-relative|point at files the publish strip step deleted/,
    "the instrument state must not be phrased as a delivery-face violation (hard rule 3b)",
  );
});

test("AC-260 arm 4 (offender): red with the count and the first 3 cwd-relative hits", () => {
  const d = mkScratch("a260-arm4");
  putTree(d, CHANNEL_REMOTE, [
    { stage: "SKILL.md", path: "SKILL.md", mode: "100644", content: "See plugin/scripts/dist/foo.js and plugin/scripts/dist/bar.js\n" },
  ]);
  const r = runCriterion(C260, d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /2 of 2 dist references/, `expected the total-and-offender counts: ${r.reason}`);
  assert.match(r.reason, /first 3:/, "the offending arm must print the first 3 actual hits (hard rule 2)");
});

test("AC-260 arm 5 (zero-count guard): red when the channel carries carriers but no dist reference", () => {
  const d = mkScratch("a260-arm5");
  putTree(d, CHANNEL_REMOTE, [
    { stage: "SKILL.md", path: "SKILL.md", mode: "100644", content: "Nothing to see here.\n" },
  ]);
  const r = runCriterion(C260, d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /zero scripts\/dist\/\*\.js references/, `a scan that matched nothing must not report PASS: ${r.reason}`);
});

// ── AC-261 arms ───────────────────────────────────────────────────────────────────────────────────
const C261 = storedCriterion(AC261);
const C261_HEADER = /for _cand in \("refs\/remotes\/origin\/dist-plugin", "refs\/heads\/dist-plugin"\):/;

/** A scratch repo carrying the executable work-tree shim AC-261's first two arms require. */
function mkShimRepo(name) {
  const d = mkScratch(name);
  fs.mkdirSync(path.join(d, "plugin/bin"), { recursive: true });
  fs.writeFileSync(path.join(d, "plugin/bin/quay"), SHIM, { mode: 0o755 });
  return d;
}

test("AC-261 arm 1: green when the shim is present and the remote-tracking channel ships bin/quay 100755", () => {
  const d = mkShimRepo("a261-arm1");
  putTree(d, CHANNEL_REMOTE, [{ stage: ".stage/bin/quay", path: "bin/quay", mode: "100755", content: SHIM }]);
  assert.equal(resolves(d, CHANNEL_LOCAL), false, "fixture bug: a local dist-plugin branch exists");
  const r = runCriterion(C261, d);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code} — reason: ${r.reason}`);
});

test("AC-261 arm 2 (instrument state): red and DISTINGUISHABLE when no candidate ref resolves", () => {
  const d = mkShimRepo("a261-arm2");
  assert.equal(resolves(d, CHANNEL_REMOTE), false, "fixture bug: the remote-tracking ref exists");
  assert.equal(resolves(d, CHANNEL_LOCAL), false, "fixture bug: the local ref exists");
  const r = runCriterion(C261, d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /INSTRUMENT STATE/, `the absent-ref arm must declare itself an instrument state: ${r.reason}`);
  assert.match(r.reason, /NOT been evaluated/, "the instrument state must say the AC was not evaluated");
  assert.doesNotMatch(
    r.reason,
    /carries no executable bin\/quay/,
    "the instrument state must not be phrased as a delivery-face violation (hard rule 3b)",
  );
});

test("AC-261 arm 3 (the shim arm still fires): red when the work-tree shim is absent", () => {
  const d = mkScratch("a261-arm3");
  const r = runCriterion(C261, d);
  assert.equal(r.code, 1, `expected exit 1, got ${r.code} — reason: ${r.reason}`);
  assert.match(r.reason, /plugin\/bin\/quay absent/, `the untouched shim arm must still be reachable: ${r.reason}`);
});

// ── REVERSION CONTROLS: revert the ref source to the bare local name and the SAME repos go red ────
test("AC-260 reversion control: reverting the ref source to bare `dist-plugin` turns arm 1 red", () => {
  const d = mkScratch("a260-reversion");
  putTree(d, CHANNEL_REMOTE, [{ stage: "sub/SKILL.md", path: "sub/SKILL.md", mode: "100644", content: CLEAN_CARRIER }]);

  const asStored = runCriterion(C260, d);
  const asReverted = runCriterion(revertToBareLocalRef(C260, C260_HEADER), d);

  assert.equal(asStored.code, 0, `the stored criterion must pass here; got ${asStored.code} — ${asStored.reason}`);
  assert.notEqual(
    asReverted.code,
    0,
    "reverting the ref source to the bare local name still passed — this test is not pinning the ref source",
  );
  assert.match(
    asReverted.reason,
    /INSTRUMENT STATE|128/,
    `the reverted criterion must fail on the unresolved ref, not for some other reason: ${asReverted.reason}`,
  );
});

test("AC-261 reversion control: reverting the ref source to bare `dist-plugin` turns arm 1 red", () => {
  const d = mkShimRepo("a261-reversion");
  putTree(d, CHANNEL_REMOTE, [{ stage: ".stage/bin/quay", path: "bin/quay", mode: "100755", content: SHIM }]);

  const asStored = runCriterion(C261, d);
  const asReverted = runCriterion(revertToBareLocalRef(C261, C261_HEADER), d);

  assert.equal(asStored.code, 0, `the stored criterion must pass here; got ${asStored.code} — ${asStored.reason}`);
  assert.notEqual(
    asReverted.code,
    0,
    "reverting the ref source to the bare local name still passed — this test is not pinning the ref source",
  );
});
