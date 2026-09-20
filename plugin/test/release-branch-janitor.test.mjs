// @test-group engine
// release-branch-janitor.test.mjs — tests for the SELF-ACTING carrier of the release protocol's
// last step (tasks/gap-ac271-finish-step-needs-self-acting-carrier).
//
// THE DEFECT THIS CARRIER CLOSES: AC-271 accepts two compliant terminal forms for a release branch —
// (a) it does not exist, or (b) `git tag --points-at <branch>` is non-empty. SPEC §12.2 (human
// ruling 2026-09-20) puts the version tag on the MERGE POINT back into develop, a CHILD of the
// branch tip ⇒ for any release cut performed by the SPEC's own procedure, form (b) is STRUCTURALLY
// UNREACHABLE and DELETE is the only reachable compliant form. That step was performed only by
// whoever remembered it — measured three times (release/v0.10.0, release/ac4-reading, release/v0.11.0
// all vanished with zero trace), the third time by the repo's own release cut.
//
// These tests hold the carrier's load-bearing properties at once, so a regression in any of them
// turns RED:
//   (a) it runs the SAME enumeration AC-271 runs, and dispatches each branch to exactly ONE of three
//       mutually-distinguishable outcomes (compliant ⇒ untouched; red+licensed ⇒ ended THROUGH
//       release-branch-finish.sh; red+unlicensed ⇒ LEFT IN PLACE);
//   (b) the "left in place" half is not a courtesy — the criterion must still be able to take FALSE
//       on that branch (hard rule 4: a janitor that "cleaned" it would make the judgment vacuous);
//   (c) an instrument failure ("could not look") never shares its output with "there were none"
//       (hard rule 3b) — asserted against a real fake-PATH shim with NO git on it;
//   (d) the record distinguishes "ran, nothing to handle" from "never ran" / "could not be read",
//       each with its OWN exit code and CAUSE= (hard rules 3b/9);
//   (e) the record's vocabulary does not re-use the neighbouring carriers' `form=` (finish) or
//       `shape=` (sandbox) words — checked mechanically against the script's own declaration, and
//       the CHECK ITSELF is exercised against a deliberately-collapsed vocabulary so it can take
//       false (hard rule 4: an assertion that cannot fail is not an assertion).
//
// ⛔ The tests never touch the real checkout: every fixture is a self-contained temp git repo, and the
// janitor's carrier is a COPY of the real release-branch-finish.sh running with `--root <fixture>`.
//
// Run:
//   scripts/test.sh plugin/test/release-branch-janitor.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const SCRIPT = join(repoRoot, "plugin", "scripts", "release-branch-janitor.ts");
const CARRIER_SRC = join(repoRoot, "plugin", "scripts", "release-branch-finish.sh");

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", SCRIPT, ...args], {
    encoding: "utf8",
    ...opts,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runJson(args, opts = {}) {
  const r = run([...args, "--json"], opts);
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

/** The enumerated release branches — the SAME read AC-271's criterion makes. */
function releaseBranches(root) {
  const r = git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads/release-*", "refs/heads/release/*");
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean).sort();
}

function tagsPointingAt(root, branch) {
  return git(root, "tag", "--points-at", `refs/heads/${branch}`).stdout.split("\n").filter(Boolean);
}

function branchExists(root, branch) {
  return git(root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).status === 0;
}

function readTrace(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

/**
 * A temp repo carrying a COPY of the REAL `release-branch-finish.sh` at the path the janitor looks
 * for it, so the deletion really goes through the carrier (⛔ never a re-implementation).
 */
function makeRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), `release-branch-janitor-${prefix}-`));
  assert.equal(git(root, "init", "-q", "-b", "develop").status, 0);
  git(root, "config", "user.name", "test");
  git(root, "config", "user.email", "test@example.com");
  mkdirSync(join(root, "plugin", "scripts"), { recursive: true });
  copyFileSync(CARRIER_SRC, join(root, "plugin", "scripts", "release-branch-finish.sh"));
  writeFileSync(join(root, ".gitignore"), ".quay/\n", "utf8");
  writeFileSync(join(root, "seed.txt"), "seed\n", "utf8");
  assert.equal(git(root, "add", "-A").status, 0);
  assert.equal(git(root, "commit", "-q", "-m", "seed").status, 0);
  return root;
}

function tempTrace(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `release-branch-janitor-trace-${prefix}-`));
  return { dir, file: join(dir, "janitor.jsonl") };
}

/**
 * Build the EXACT shape SPEC §12.2 produces: a release branch whose tip is NOT on a tag, with the
 * version tag on a DESCENDANT merge point that `develop` does NOT contain — so `tag --contains`
 * licenses the delete while `develop..<branch>` does not (the tag licence is isolated on purpose).
 * Returns the branch tip sha.
 */
function makeRedTaggedBranch(root, branch, tag) {
  const seed = git(root, "rev-parse", "HEAD").stdout.trim();
  git(root, "checkout", "-q", "-b", branch, seed);
  git(root, "commit", "-q", "--allow-empty", "-m", `${branch}: release work`);
  const tip = git(root, "rev-parse", "HEAD").stdout.trim();
  // The merge point lives on its OWN branch (not develop), so develop does not hold the tip.
  git(root, "checkout", "-q", "-b", `mergepoint-${tag}`, "develop");
  git(root, "merge", "-q", "--no-ff", "-m", `merge point for ${tag} (SPEC 12.2)`, branch);
  git(root, "tag", tag, "HEAD");
  git(root, "checkout", "-q", "develop");
  assert.deepEqual(tagsPointingAt(root, branch), [], "fixture must be form-(b)-unreachable");
  assert.equal(git(root, "tag", "--contains", branch).stdout.trim(), tag);
  assert.notEqual(git(root, "rev-list", "--count", `develop..${branch}`).stdout.trim(), "0");
  return tip;
}

// ── AC3: the three dispositions, in ONE pass, each with its own exit code ────────────────────────

test("AC3: one pass dispatches compliant / licensed-red / unlicensed-red to three distinct outcomes", () => {
  const root = makeRepo("three");
  const t = tempTrace("three");
  try {
    const seed = git(root, "rev-parse", "HEAD").stdout.trim();

    // (i) COMPLIANT: tip sits verbatim on a tag (`tag --points-at` non-empty).
    git(root, "branch", "release/parked", seed);
    git(root, "tag", "v-parked", "release/parked");

    // (ii) RED + LICENSED: exactly SPEC §12.2's shape — the tag is on the merge point, the branch
    // tip is its parent ⇒ `--points-at` is empty but `tag --contains` is not.
    const taggedTip = makeRedTaggedBranch(root, "release/tagged", "v-tagged");

    // (iii) RED + UNLICENSED: a commit that is in no tag and not merged into develop.
    git(root, "checkout", "-q", "-b", "release/nolicense", seed);
    git(root, "commit", "-q", "--allow-empty", "-m", "unreleased work");
    git(root, "checkout", "-q", "develop");

    assert.deepEqual(releaseBranches(root), ["release/nolicense", "release/parked", "release/tagged"]);

    const r = runJson(["--root", root, "--trace", t.file]);
    assert.equal(r.status, 3, `left-alone must win the run verdict here:\n${r.stdout}\n${r.stderr}`);

    const byBranch = new Map((r.payload?.decisions ?? []).map((d) => [d.branch, d]));
    assert.equal(byBranch.get("release/parked")?.disposition, "parked-compliant");
    assert.equal(byBranch.get("release/parked")?.exit, 0);
    assert.equal(byBranch.get("release/parked")?.license, "tag:v-parked");
    assert.equal(byBranch.get("release/tagged")?.disposition, "finished-via-carrier");
    assert.equal(byBranch.get("release/tagged")?.exit, 10);
    assert.equal(byBranch.get("release/tagged")?.license, "tag:v-tagged");
    assert.equal(byBranch.get("release/nolicense")?.disposition, "left-alone-no-license");
    assert.equal(byBranch.get("release/nolicense")?.exit, 13);
    assert.equal(byBranch.get("release/nolicense")?.license, "no-license");

    // (i) untouched — still there, still parked on its tag.
    assert.equal(branchExists(root, "release/parked"), true);
    assert.deepEqual(tagsPointingAt(root, "release/parked"), ["v-parked"]);
    // (ii) ended — and via the CARRIER, whose own trace carries the matching line.
    assert.equal(branchExists(root, "release/tagged"), false);
    const carrierTrace = readTrace(join(root, ".quay", "release-branch-finish.jsonl"));
    const carrierLine = carrierTrace.find((l) => l.branch === "release/tagged");
    assert.ok(carrierLine, "the finish must go through release-branch-finish.sh, which records it");
    assert.equal(carrierLine.result, "deleted-local");
    assert.equal(carrierLine.form, "tagged");
    assert.equal(carrierLine.sha, taggedTip);
    // (iii) left in place — the branch is STILL THERE and the run says so on stderr.
    assert.equal(branchExists(root, "release/nolicense"), true);
    assert.match(r.stderr, /CAUSE=release-branch-janitor-left-alone-no-license/);
    assert.match(r.stderr, /release\/nolicense/);

    // the janitor's own record: one line per branch decision + exactly one pass summary.
    const jan = readTrace(t.file);
    const branchLines = jan.filter((l) => l.scope === "branch");
    const passLines = jan.filter((l) => l.scope === "pass");
    assert.equal(branchLines.length, 3);
    assert.equal(passLines.length, 1);
    assert.equal(passLines[0].disposition, "pass-left-alone-no-license");
    assert.equal(passLines[0].exit, 3);
    const janTagged = branchLines.find((l) => l.branch === "release/tagged");
    assert.equal(janTagged.disposition, "finished-via-carrier");
    assert.equal(janTagged.license, "tag:v-tagged");
    assert.equal(janTagged.carrier_exit, 0, "the carrier's own exit code must be recorded");
  } finally {
    cleanup(root);
    cleanup(t.dir);
  }
});

test("AC3/S6: a branch fully merged back is licensed by the BASE, not by a tag", () => {
  const root = makeRepo("merged");
  const t = tempTrace("merged");
  try {
    const seed = git(root, "rev-parse", "HEAD").stdout.trim();
    git(root, "checkout", "-q", "-b", "release/mergedonly", seed);
    git(root, "commit", "-q", "--allow-empty", "-m", "release work");
    const tip = git(root, "rev-parse", "HEAD").stdout.trim();
    git(root, "checkout", "-q", "develop");
    // Merged back into develop; NO tag anywhere.
    git(root, "merge", "-q", "--no-ff", "-m", "merge release", "release/mergedonly");
    assert.deepEqual(tagsPointingAt(root, "release/mergedonly"), []);
    assert.equal(git(root, "tag", "--contains", "release/mergedonly").stdout.trim(), "");
    assert.equal(git(root, "rev-list", "--count", `develop..release/mergedonly`).stdout.trim(), "0");

    const r = runJson(["--root", root, "--trace", t.file]);
    assert.equal(r.status, 0, `a merged branch is licensed:\n${r.stdout}\n${r.stderr}`);
    assert.equal(r.payload?.verdict, "finished");
    assert.equal(r.payload?.decisions?.[0]?.license, "merged-into:develop");
    assert.equal(branchExists(root, "release/mergedonly"), false);
    const carrierLine = readTrace(join(root, ".quay", "release-branch-finish.jsonl")).find(
      (l) => l.branch === "release/mergedonly",
    );
    assert.ok(carrierLine, "the merged path must go through the carrier too");
    assert.equal(carrierLine.form, "merged");
    assert.equal(carrierLine.sha, tip);
  } finally {
    cleanup(root);
    cleanup(t.dir);
  }
});

// ── AC3 (instrument failure): "could not look" never reads as "there were none" ──────────────────

test("AC3: an instrument failure has its OWN exit code + CAUSE, never 'enumeration empty'", () => {
  const root = makeRepo("instr");
  try {
    // (a) the real thing: an empty namespace ⇒ exit 0 and the "nothing to handle" output.
    const t = tempTrace("instr-empty");
    const clean = run(["--root", root, "--trace", t.file]);
    assert.equal(clean.status, 0);
    assert.match(clean.stdout, /nothing to handle \(enumeration empty\)/);
    cleanup(t.dir);

    // (b) a PATH shim with NO git on it ⇒ the enumeration cannot be PERFORMED.
    const shimDir = mkdtempSync(join(tmpdir(), "release-branch-janitor-shim-"));
    writeFileSync(join(shimDir, "git"), "#!/bin/sh\nexit 127\n", "utf8");
    chmodSync(join(shimDir, "git"), 0o755);
    const t2 = tempTrace("instr-fail");
    try {
      const broken = run(["--root", root, "--trace", t2.file], {
        env: { ...process.env, PATH: shimDir },
      });
      assert.equal(broken.status, 2, "an unperformable enumeration is its own exit code");
      assert.match(broken.stderr, /CAUSE=release-branch-janitor-enumeration-failed/);
      // ⛔ the two outputs must not be the same shape (hard rule 3b).
      assert.doesNotMatch(broken.stdout, /nothing to handle/);
      assert.notEqual(broken.status, clean.status);
      assert.equal(existsSync(t2.file), false, "an instrument failure records no pass line");
    } finally {
      cleanup(shimDir);
      cleanup(t2.dir);
    }
  } finally {
    cleanup(root);
  }
});

// ── AC5: the record's three states, each with its own exit code + CAUSE ──────────────────────────

test("AC5: ran-and-empty / never-ran / unreadable are three distinct outputs", () => {
  const root = makeRepo("trace");
  const t = tempTrace("trace");
  try {
    // (1) never ran: the file does not exist.
    const missing = run(["--log", "--trace", t.file]);
    assert.equal(missing.status, 4);
    assert.match(missing.stderr, /CAUSE=release-branch-janitor-trace-missing/);

    // (2) ran, nothing to handle: a pass line exists, and `--log` reads it back.
    const pass = run(["--root", root, "--trace", t.file]);
    assert.equal(pass.status, 0);
    const logged = run(["--log", "--trace", t.file]);
    assert.equal(logged.status, 0, "a recorded pass must be readable");
    assert.match(logged.stdout, /disposition=pass-clean/);
    assert.match(logged.stdout, /trace: 1 record\(s\)/);
    assert.notEqual(logged.status, missing.status);

    // (3) exists but cannot be read: "could not look" is not "nothing there".
    chmodSync(t.file, 0o000);
    try {
      const unreadable = run(["--log", "--trace", t.file]);
      assert.equal(unreadable.status, 5);
      assert.match(unreadable.stderr, /CAUSE=release-branch-janitor-trace-unreadable/);
      assert.notEqual(unreadable.status, logged.status);
      assert.notEqual(unreadable.status, missing.status);
    } finally {
      chmodSync(t.file, 0o600);
    }
  } finally {
    cleanup(root);
    cleanup(t.dir);
  }
});

// ── AC5: the vocabulary does not re-use the neighbouring carriers' words (hard rule 8) ───────────

/**
 * The two NEIGHBOURING carriers' record vocabularies, transcribed with their definition sites. The
 * janitor's own side is NOT transcribed here — it is read from the script's single declaration via
 * `--vocabulary-json`, so this list can never drift into a second copy of the janitor's own words.
 */
const NEIGHBOUR_KEYS = ["form", "shape"];
const NEIGHBOUR_VALUES = [
  // .quay/release-branch-finish.jsonl — release-branch-finish.sh, property 4:
  "none",
  "merged",
  "tagged",
  "cut",
  // .quay/release-reading-sandbox.jsonl — release-reading-sandbox.ts:
  "release-branch",
  "non-release-branch",
];

/**
 * The mechanical assertion. Returns the list of collisions (empty ⇒ the vocabulary is its own).
 * ⛔ Pure and total: it is exercised against a deliberately-collapsed vocabulary below, so this
 * check is proved ABLE to fail (hard rule 4) rather than merely observed to pass.
 */
function vocabularyCollisions(v) {
  const collisions = [];
  for (const k of v.keys) if (NEIGHBOUR_KEYS.includes(k)) collisions.push(`key:${k}`);
  const values = [
    ...(v.dispositions ?? []),
    ...(v.passDispositions ?? []),
    ...(v.licenseKinds ?? []),
  ];
  for (const val of values) if (NEIGHBOUR_VALUES.includes(val)) collisions.push(`value:${val}`);
  return collisions;
}

test("AC5: the janitor's record vocabulary is disjoint from the neighbours' form= / shape=", () => {
  const r = run(["--vocabulary-json"]);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);

  // (a) the check can take FALSE — a collapsed vocabulary is reported, not waved through.
  assert.deepEqual(vocabularyCollisions({ ...v, keys: [...v.keys, "form"] }), ["key:form"]);
  assert.deepEqual(vocabularyCollisions({ ...v, dispositions: [...v.dispositions, "tagged"] }), [
    "value:tagged",
  ]);
  assert.deepEqual(vocabularyCollisions({ ...v, licenseKinds: [...v.licenseKinds, "none"] }), [
    "value:none",
  ]);

  // (b) the real declaration has no collision at all.
  assert.deepEqual(vocabularyCollisions(v), []);
  // (c) and it really is its own vocabulary, not an empty list that trivially passes.
  assert.ok(v.keys.length >= 6 && v.dispositions.length === 4 && v.passDispositions.length === 4);
  // (d) the pass-level words are a DISJOINT set from the branch-level ones (so a pass line can never
  //     be read as a branch decision).
  for (const p of v.passDispositions) assert.ok(!v.dispositions.includes(p), `pass word reused: ${p}`);
});

// ── dry-run: decides, mutates nothing, records nothing ───────────────────────────────────────────

test("dry-run decides and prints without mutating or recording", () => {
  const root = makeRepo("dry");
  const t = tempTrace("dry");
  try {
    makeRedTaggedBranch(root, "release/dry", "v-dry");

    const r = runJson(["--root", root, "--trace", t.file, "--dry-run"]);
    assert.equal(r.status, 0);
    assert.equal(r.payload?.decisions?.[0]?.disposition, "finished-via-carrier");
    assert.equal(branchExists(root, "release/dry"), true, "a dry run must delete nothing");
    assert.equal(existsSync(t.file), false, "a dry run must record nothing");
    assert.equal(existsSync(join(root, ".quay", "release-branch-finish.jsonl")), false);
  } finally {
    cleanup(root);
    cleanup(t.dir);
  }
});

// ── idempotence: a second pass finds nothing red ─────────────────────────────────────────────────

test("a second pass over an already-clean repo reports pass-clean", () => {
  const root = makeRepo("idem");
  const t = tempTrace("idem");
  try {
    makeRedTaggedBranch(root, "release/once", "v-once");

    assert.equal(run(["--root", root, "--trace", t.file]).status, 0);
    assert.deepEqual(releaseBranches(root), [], "the janitor's run must leave AC-271's enumeration empty");

    const second = runJson(["--root", root, "--trace", t.file]);
    assert.equal(second.status, 0);
    assert.equal(second.payload?.verdict, "clean");
    assert.equal(second.payload?.branchCount, 0);
  } finally {
    cleanup(root);
    cleanup(t.dir);
  }
});
