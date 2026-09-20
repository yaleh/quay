// @test-group engine
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-09-20 child-spawn (spawns the cross-machine-verify entry once per case; hermetic local git fixtures)
// cross-machine-verify-characterization.test.mjs — gap-arch-tsify-cross-machine-verify-sh
// (SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §5 Phase 5.2).
//
// WHAT THIS FILE IS. A CHARACTERIZATION test, not a feature test. It pins the INPUT→OUTPUT contract of
// plugin/scripts/cross-machine-verify.sh (489 code lines, five embedded `python3` invocations) so that
// moving the program into TypeScript is a MECHANICALLY CHECKED equivalence instead of a rewrite nobody
// can diff. It is written and committed BEFORE the rewrite (AC1), and it stays green AFTER it — the
// rewrite target is still reached through the same `cross-machine-verify.sh` entry, so the same inputs
// must still produce the same outputs.
//
// WHY IT DRIVES THE PUBLIC CLI AND NOT THE EMBEDDED BODIES. Before the extraction there IS no callable
// unit — the python is stdin/argv of a `python3` process launched mid-function. The only contract that
// exists on BOTH sides of the migration is the one the script presents to a caller: `--record-merge`,
// `--verify`, `--report [--json]`, `--gate-run`, and the fail-closed usage/preflight exits. Those are
// the same inputs before and after, so this file is EXACTLY the right instrument for
// 「迁移前后同一份输入下 stdout/退出码一致」.
//
// HERMETIC, BUT GENUINELY TWO-MACHINE. The mechanism's whole point is a SECOND machine, and a
// characterization that quietly collapsed both roles onto one checkout would not exercise the thing
// under test. The transport seam is a local BARE git repo used as `origin`, and TWO real clones of it
// (`machine-a`, `machine-b`) stand in for the two hosts: the same `refs/notes/*` fetch/push the real
// mechanism uses, over a file path instead of ssh. Machine IDENTITY is the `--machine <id>` flag (not
// `hostname`), so every pinned string below is host-independent, and `verifier_is_participant` is
// exercised for real (AC4's structural rule).
//
// THE FOUR INPUT CLASSES (AC2's table; each has its own block below):
//   C1 远端一致   — A records a merge, a NON-participant verifies it, and the verdict is visible on the
//                   OTHER machine's checkout after a fetch.
//   C2 远端落后   — a merge recorded on the shared remote that the verifying machine has not yet
//                   verified: `--report` exits 1 with the pending merge's wait as the failure surface.
//   C3 远端不可达 — the remote cannot be reached → exit 2 with a named CAUSE, ⛔ NOT the C1 shape
//                   (硬规则 3b).
//   C4 参数缺失   — missing/empty/unknown arguments and a missing branch → exit 2, each with its own
//                   message, never a partial run.
//
// TWO CURRENT BEHAVIORS THIS FILE PINS THAT ARE DEFECTS, NOT PROPERTIES. Both are labeled HAZARD below,
// so the rewrite cannot change them silently and a future reader is not told the wrong thing:
//   C1h — a COLD `--record-merge` never reaches the shared remote: `push_notes` pushes BOTH notes refs
//         in one `git push`, and git aborts the WHOLE push when one src refspec does not exist, so on a
//         machine whose `refs/notes/quay-cmv-verdict` has never been created the merge note stays local
//         and no other machine can ever see it.
//   C3b — a remote that is configured but DEAD degrades to the same shape as `nothing to verify`.
// Both were FOUND by this characterization and are recorded in the task's Evidence as findings; neither
// may be fixed here (this task transports existing behavior — 「只搬运现有行为，不扩展跨机器能力」).
//
// CAN THIS FILE TAKE FALSE? Yes — measured, not asserted (AC1's 取假 half): injecting a single behavior
// change into the UNCHANGED bash (the verdict-append's `"verdict":"${gv}"` → `"verdict":"green"`)
// reddens C2a's pending-merge assertions; reverting restores green. Both runs are in the task Evidence.
//
// Run:
//   scripts/test.sh plugin/test/cross-machine-verify-characterization.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "cross-machine-verify.sh");

// ── the script under test ───────────────────────────────────────────────────────────────────────────
// Default = the shipped ENTRY (`cross-machine-verify.sh`), which is what every caller in the tree
// invokes — before the rewrite it IS the implementation, after it is the thin wrapper around the TS.
// `CMV_UNDER_TEST` / `CMV_RUNNER` exist so the SAME assertions can be pointed at the pre-rewrite bash
// and at the TS implementation directly (AC2's differential table), ⛔ without a second copy of them.
const CMV_UNDER_TEST = process.env.CMV_UNDER_TEST ? path.resolve(process.env.CMV_UNDER_TEST) : DEFAULT_SCRIPT;
const CMV_RUNNER = process.env.CMV_RUNNER || (CMV_UNDER_TEST.endsWith(".ts") ? "node" : "bash");

/** Run the entry under test. `machine` is always explicit (never `hostname`) so every pinned string is
 *  host-independent. */
function cmv(args) {
  const bin = CMV_RUNNER === "bash" ? "bash" : "node";
  const argv =
    CMV_RUNNER === "bash" ? [CMV_UNDER_TEST, ...args] : ["--experimental-strip-types", CMV_UNDER_TEST, ...args];
  const r = spawnSync(bin, argv, { encoding: "utf8", timeout: 60_000 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── the hermetic two-machine fixture ────────────────────────────────────────────────────────────────
function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      ...env,
    },
  });
}

// Temp-dir lifecycle: the carrier array + `after()` pattern (the house form — `tmp-leak-pairing-check`
// and `test-isolation-check` both judge this file, and a `process.on("exit")` teardown reads to them as
// NO cleanup at all). Every temp tree goes through `tempRoot()` below, which pushes onto the
// carrier the `after()` hook drains. Each fixture is a bare repo + two working clones, so leaking one
// leaves four directories behind per case.
const TEMP_ROOTS = [];
after(() => {
  for (const d of TEMP_ROOTS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});
function tempRoot(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TEMP_ROOTS.push(d);
  return d;
}

/** Fixed commit dates so `at=<iso>` is a stable, assertable string. */
const D1 = "2026-01-02T03:04:05+00:00";
const D2 = "2026-01-02T04:05:06+00:00";

/** One merge commit on `develop` with a FIXED committer date, pushed to the shared remote. Returns
 *  its sha. (The push is what makes the merge a cross-machine fact at all — both machines track the
 *  same shared branches, so a merge only exists for the verifier once it is on `origin`.) */
function landMerge(repo, n, date) {
  git(repo, ["checkout", "-q", "-B", `side-${n}`, "develop"]);
  fs.writeFileSync(path.join(repo, `side-${n}.txt`), `${n}\n`);
  git(repo, ["add", `side-${n}.txt`]);
  git(repo, ["commit", "-q", "-m", `side ${n} work`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  git(repo, ["checkout", "-q", "develop"]);
  fs.writeFileSync(path.join(repo, `main-${n}.txt`), `${n}\n`);
  git(repo, ["add", `main-${n}.txt`]);
  git(repo, ["commit", "-q", "-m", `main ${n} work`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  git(repo, ["merge", "-q", "--no-ff", "-m", `merge side-${n} into develop`, `side-${n}`], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  git(repo, ["push", "-q", "origin", "develop"]);
  return sha;
}

/** machine-b tracks the same SHARED branches, so it must be at develop's tip for a merge to be
 *  attributable to `develop` on its side (`merge-base --is-ancestor <sha> refs/heads/develop`). */
function syncB(b) {
  git(b, ["pull", "-q", "--ff-only", "origin", "develop"]);
}

/**
 * `origin` = a BARE repo (the shared cross-machine channel); `machine-a` = the merging machine's
 * checkout (the bare repo's `develop` is born here); `machine-b` = the OTHER machine, a real clone.
 */
function setupMachines() {
  const tmp = tempRoot("cmv-char-");
  const origin = path.join(tmp, "origin.git");
  const a = path.join(tmp, "machine-a");
  const b = path.join(tmp, "machine-b");

  execFileSync("git", ["init", "--bare", "-q", "--initial-branch=develop", origin]);
  execFileSync("git", ["init", "-q", "--initial-branch=develop", a]);
  git(a, ["config", "user.email", "fixture@example.invalid"]);
  git(a, ["config", "user.name", "Fixture"]);
  git(a, ["remote", "add", "origin", origin]);

  fs.writeFileSync(path.join(a, "a.txt"), "a\n");
  git(a, ["add", "a.txt"]);
  git(a, ["commit", "-q", "-m", "base"], { GIT_AUTHOR_DATE: D1, GIT_COMMITTER_DATE: D1 });
  git(a, ["push", "-q", "origin", "develop"]);
  execFileSync("git", ["clone", "-q", origin, b]);
  git(b, ["config", "user.email", "fixture@example.invalid"]);
  git(b, ["config", "user.name", "Fixture"]);

  return { tmp, origin, a, b };
}

/** The refs the bare remote currently carries — the shared channel's own reading. */
function remoteRefs(origin) {
  return git(origin, ["for-each-ref", "--format=%(refname)", "refs/notes/"]).trim();
}

// `--root <repo> --branch develop` are always present: the fixtures have exactly one tracked branch,
// so the default `--branches "develop integration"` would fail the preflight for an unrelated reason.
function cmvOn(repo, args) {
  const hasBranchFlag = args.includes("--branch") || args.includes("--branches");
  return cmv(["--root", repo, ...(hasBranchFlag ? [] : ["--branch", "develop"]), ...args]);
}

/** Bring a fixture to the "warm" state: one merge recorded AND verified by machine-B, so BOTH notes
 *  refs exist and every later `push_notes` succeeds (see C1h for why a cold repo cannot push). */
function warm(a) {
  const sha = landMerge(a, 0, D1);
  cmvOn(a, ["--record-merge", sha, "--machine", "machine-A"]);
  cmvOn(a, ["--verify", "--machine", "machine-B", "--gate", "true"]);
  return sha;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// C1 — 远端一致: one machine records, a NON-participant verifies, the other machine sees the verdict
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("C1a — record-merge attaches the note as the MERGING machine with the commit's own timestamp", () => {
  const { a } = setupMachines();
  const sha = landMerge(a, 1, D2);
  const r = cmvOn(a, ["--record-merge", sha, "--machine", "machine-A"]);

  assert.equal(r.status, 0, `record-merge must exit 0:\n${r.stdout}\n${r.stderr}`);
  assert.match(
    r.stdout,
    new RegExp(`^recorded merge: ${sha.slice(0, 12)} branch=develop merger_machine=machine-A at=${D2.replace(/\+/g, "\\+")}$`, "m"),
    "the recorded line names the merge, its tracked branch, the RECORDING machine and the commit time",
  );
  assert.match(
    r.stdout,
    /^cross-machine-verify: record-merge done \(recorded 1 \/ skipped 0 \/ missing 0\)$/m,
    "the summary counts exactly one record and nothing skipped/missing",
  );
  assert.match(git(a, ["notes", "--ref=quay-cmv-merge", "list"]), new RegExp(` ${sha}$`, "m"), "the merge note exists locally");
});

test("C1b — record-merge is idempotent: a second record of the same sha is SKIPPED, never duplicated", () => {
  const { a } = setupMachines();
  const sha = landMerge(a, 1, D2);
  cmvOn(a, ["--record-merge", sha, "--machine", "machine-A"]);
  const again = cmvOn(a, ["--record-merge", sha, "--machine", "machine-A"]);
  assert.equal(again.status, 0);
  assert.match(
    again.stdout,
    /^cross-machine-verify: record-merge done \(recorded 0 \/ skipped 1 \/ missing 0\)$/m,
    "an already-noted merge is counted as skipped (the note is per-commit, not appendable)",
  );
  assert.doesNotMatch(again.stdout, /^recorded merge:/m, "no second note line is printed");
});

test("C1c — a NON-participant verify records a green verdict and reports verifier_is_participant=0", () => {
  const { a } = setupMachines();
  const sha = landMerge(a, 1, D2);
  cmvOn(a, ["--record-merge", sha, "--machine", "machine-A"]);

  const v = cmvOn(a, ["--verify", "--machine", "machine-B", "--gate", "true"]);
  assert.equal(v.status, 0, `verify must exit 0 on a green gate:\n${v.stdout}\n${v.stderr}`);
  assert.match(
    v.stdout,
    new RegExp(`^verify: verifying ${sha.slice(0, 12)} \\(merger=machine-A, verifier=machine-B\\) — running fast gate\\.\\.\\.$`, "m"),
    "the verifying line names BOTH machines — that pairing IS the AC4 structural requirement",
  );
  assert.match(
    v.stdout,
    new RegExp(`^verify: ${sha.slice(0, 12)} verdict=green post_merge_latency_h=[0-9.]+$`, "m"),
    "a green verdict line carries the post-merge latency",
  );
  assert.match(
    v.stdout,
    /^cross-machine-verify: verify done \(green 1 \/ red 0 \/ gate-error 0 \/ skipped-participant 0 \/ skipped-unattributed 0 \/ already-verified 0\)$/m,
    "the summary counts exactly one green and nothing else",
  );

  const rep = cmvOn(a, ["--report", "--json", "--machine", "machine-B"]);
  assert.equal(rep.status, 0, `a fully verified board must report exit 0:\n${rep.stdout}\n${rep.stderr}`);
  const j = JSON.parse(rep.stdout);
  assert.equal(j.merger_machine, "machine-A", "the report names the machine that RECORDED the merge");
  assert.equal(j.verifier_machine, "machine-B", "the report names the machine that gave the VERDICT, not the runner");
  assert.equal(j.verifier_is_participant, 0, "AC4: the verifier is not the merger — band 0");
  assert.equal(j.verified_merges, 1);
  assert.equal(j.unverified_merges, 0);
  assert.equal(j.merges.length, 1);
  assert.equal(j.merges[0].verified, true);
  assert.equal(j.merges[0].verdict, "green");
  assert.equal(j.merges[0].branch, "develop");
  assert.deepEqual(j.notes_refs, ["refs/notes/quay-cmv-merge", "refs/notes/quay-cmv-verdict"]);
});

test("C1d — the MERGER itself cannot verify its own merge (skipped-participant), and no verdict is written", () => {
  const { a } = setupMachines();
  const sha = landMerge(a, 1, D2);
  cmvOn(a, ["--record-merge", sha, "--machine", "machine-A"]);
  const v = cmvOn(a, ["--verify", "--machine", "machine-A", "--gate", "true"]);
  assert.equal(v.status, 0);
  assert.match(
    v.stdout,
    new RegExp(`^verify: skip ${sha.slice(0, 12)} — this machine \\(machine-A\\) IS the merger; a parent cannot verify its own merge \\(AC4\\)$`, "m"),
    "the parent-machine skip is stated, not silent",
  );
  assert.match(v.stdout, /skipped-participant 1 \/ skipped-unattributed 0 \/ already-verified 0\)$/m, "the skip is counted");

  // ⛔ No verdict note exists for that sha: the skip is structural, not a deferred retry.
  const notesText = git(a, ["notes", "--ref=quay-cmv-verdict", "list"]);
  assert.doesNotMatch(notesText, new RegExp(` ${sha}$`, "m"), "a participant write must leave NO verdict note");
});

test("C1e — a NON-participant's verdict is visible on the OTHER machine's checkout after its own fetch", () => {
  const { origin, a, b } = setupMachines();
  const sha = landMerge(a, 1, D2);
  cmvOn(a, ["--record-merge", sha, "--machine", "machine-A"]);
  cmvOn(a, ["--verify", "--machine", "machine-B", "--gate", "true"]);

  // The shared channel really carries both refs (this is what "远端一致" is a reading OF).
  const refs = remoteRefs(origin);
  assert.match(refs, /refs\/notes\/quay-cmv-merge/, "the merge note ref is on the shared remote");
  assert.match(refs, /refs\/notes\/quay-cmv-verdict/, "the verdict ref is on the shared remote");

  // …and machine-b, which never ran the verify itself, reaches the same conclusion by FETCHING.
  syncB(b);
  const rep = cmvOn(b, ["--report", "--json", "--machine", "machine-C"]);
  assert.equal(rep.status, 0, `machine-b must see the verdict as green:\n${rep.stdout}\n${rep.stderr}`);
  const j = JSON.parse(rep.stdout);
  assert.equal(j.verified_merges, 1, "machine-b fetched the verdict, it did not have it locally");
  assert.equal(j.verifier_machine, "machine-B", "and it attributes it to the machine that gave it");
  assert.equal(j.merger_machine, "machine-A");
  assert.equal(j.verifier_is_participant, 0);
});

test("C1f — --gate-run red names the failing file (the negative-control surface)", () => {
  const { a } = setupMachines();
  const gate = "bash -c 'echo \"not ok 1 - broken\"; echo \"  at plugin/scripts/example.test.mjs:12:3\"'; exit 1";
  const r = cmvOn(a, ["--gate-run", "--gate", gate]);
  assert.equal(r.status, 1, "a red gate exits 1 (not 2 — 2 is reserved for an ERROR verdict)");
  const g = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(g.verdict, "red");
  assert.deepEqual(
    g.files,
    ["plugin/scripts/example.test.mjs"],
    "the failing plugin path is extracted from the failure context — a gate that cannot name the file is no gate",
  );
});

test("C1g — --gate-run an ERROR gate exits 2 and labels the verdict `error` (never `red`)", () => {
  const { a } = setupMachines();
  const r = cmvOn(a, ["--gate-run", "--gate", "exit 3"]);
  assert.equal(r.status, 2, "a non-0/1 gate exit is an ERROR, and its exit code is 2");
  const g = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(g.verdict, "error");
  assert.deepEqual(g.files, []);
});

test("C1h — HAZARD (current behavior, NOT a property): a COLD record-merge never reaches the shared remote", () => {
  // `push_notes` pushes BOTH notes refs in ONE `git push`. git aborts the WHOLE push when one src
  // refspec does not exist ("error: src refspec refs/notes/quay-cmv-verdict does not match any"), so on
  // a machine whose `refs/notes/quay-cmv-verdict` has never been created the merge note stays LOCAL and
  // machine-b can never see it. Measured here; recorded as a finding in the task Evidence. ⛔ Pinned,
  // not fixed — this task transports existing behavior only.
  const { origin, a, b } = setupMachines();
  const sha = landMerge(a, 1, D2);
  const r = cmvOn(a, ["--record-merge", sha, "--machine", "machine-A"]);
  assert.equal(r.status, 0, "the LOCAL record succeeds and prints its summary — the failure is silent to the recorder");
  assert.match(git(a, ["notes", "--ref=quay-cmv-merge", "list"]), new RegExp(` ${sha}$`, "m"), "the note IS local");
  assert.equal(remoteRefs(origin), "", "and the shared remote received NOTHING — the push aborted as a whole");
  assert.match(
    cmvOn(b, ["--report", "--json", "--machine", "machine-B"]).stdout,
    /"verified_merges": 0/,
    "machine-b therefore sees a merge-free board — the mechanism's first record is invisible cross-machine",
  );
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// C2 — 远端落后: the merge is on the shared remote; the verifying machine has not verified it yet
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("C2a — a recorded-but-unverified merge reports exit 1 with its WAIT as the failure surface", () => {
  const { a, b } = setupMachines();
  warm(a); // both notes refs now exist, so the NEXT record really does reach the remote (C1h)
  const pending = landMerge(a, 1, D2);
  cmvOn(a, ["--record-merge", pending, "--machine", "machine-A"]);

  syncB(b);
  const rep = cmvOn(b, ["--report", "--json", "--machine", "machine-B"]);
  assert.equal(rep.status, 1, "an unverified merge makes the report exit 1 (the failure surface, not a warning)");
  const j = JSON.parse(rep.stdout);
  const pendingRow = j.merges.find((m) => m.sha === pending);
  assert.ok(pendingRow, "machine-b fetched the pending merge from the shared channel");
  assert.equal(pendingRow.verified, false);
  assert.equal(pendingRow.verdict, null);
  assert.equal(pendingRow.merger_machine, "machine-A");
  assert.equal(pendingRow.verifier_machine, null, "nobody verified it, so the verifier is null — ⛔ not the reporter's own name");
  assert.equal(j.unverified_merges, 1);
  assert.equal(j.verified_merges, 1, "the earlier, verified merge is still counted as verified");
  assert.equal(j.verifier_machine, null, "the top-level verifier is the PENDING merge's (null), not the older verdict's");
  assert.ok(j.post_merge_latency_h > 0, `the pending merge's wait IS the detection latency d (got ${j.post_merge_latency_h})`);

  const human = cmvOn(b, ["--report", "--machine", "machine-B"]);
  assert.equal(human.status, 1);
  assert.match(
    human.stdout,
    /^  UNVERIFIED — the detection latency d for each pending merge is its wait_h \(this is the failure surface\):$/m,
    "the human report names the failure surface explicitly",
  );
  assert.match(human.stdout, /^  verifier_is_participant: 0 {2}\(band 0\)$/m, "the band-0 invariant is printed");
});

test("C2b — verify records a RED verdict for a failing gate and makes the run exit 1", () => {
  const { a, b } = setupMachines();
  warm(a);
  const pending = landMerge(a, 1, D2);
  cmvOn(a, ["--record-merge", pending, "--machine", "machine-A"]);

  const v = cmvOn(a, ["--verify", "--machine", "machine-B", "--gate", "false"]);
  assert.equal(v.status, 1, "a red gate makes --verify exit 1");
  assert.match(
    v.stdout,
    new RegExp(`^verify: ${pending.slice(0, 12)} verdict=RED post_merge_latency_h=[0-9.]+ files=\\[\\] — DETECTED by cross-machine gate$`, "m"),
    "the RED line carries the same latency field and names the detection",
  );
  assert.match(v.stdout, /^cross-machine-verify: verify done \(green 0 \/ red 1 \/ gate-error 0 \//m);

  // machine-b reads the RED verdict off the shared channel.
  syncB(b);
  const rep = cmvOn(b, ["--report", "--json", "--machine", "machine-C"]);
  const row = JSON.parse(rep.stdout).merges.find((m) => m.sha === pending);
  assert.equal(row.verified, true, "a RED verdict is still a verdict — it counts as verified (the gate RAN)");
  assert.equal(row.verdict, "red");
  assert.equal(row.verifier_machine, "machine-B");
});

test("C2c — a merge that landed but was NEVER recorded is surfaced as unattributed (fail-closed)", () => {
  const { a } = setupMachines();
  warm(a);
  landMerge(a, 1, D2); // landed on develop with NO merge note: its record event was missed

  const rep = cmvOn(a, ["--report", "--json", "--machine", "machine-B"]);
  assert.equal(rep.status, 1, "an unattributed commit keeps the report at exit 1");
  const j = JSON.parse(rep.stdout);
  assert.ok(j.unattributed_commits >= 1, "the unrecorded commit is counted, not dropped");
  assert.match(
    cmvOn(a, ["--report", "--machine", "machine-B"]).stdout,
    /^  unattributed commits \(landed but NOT recorded by a merger — cannot prove non-participation, NOT verified\):$/m,
    "the human report states WHY they are not verified",
  );
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// C3 — 远端不可达: a DIFFERENT SHAPE from C1 (硬规则 3b)
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("C3a — an unresolvable remote is a NAMED fail-closed exit 2, not an empty-looking green report", () => {
  const { b } = setupMachines();
  const r = cmvOn(b, ["--report", "--json", "--machine", "machine-B", "--remote", "nope"]);
  assert.equal(r.status, 2, "the preflight fails closed (2), ⛔ not 0 and not 1");
  assert.match(r.stderr, /^cross-machine-verify: remote not found: nope$/m, "the CAUSE names the missing remote");
  assert.equal(r.stdout, "", "⛔ NOTHING is printed on stdout — an unreachable remote must not render as a report");

  // 硬规则 3b, stated as an assertion: the unreachable value is not isomorphic to the consistent one.
  const ok = cmvOn(b, ["--report", "--json", "--machine", "machine-B"]);
  assert.equal(ok.status, 0, "the reachable remote with nothing recorded reports 0");
  assert.notEqual(r.status, ok.status, "unreachable ≠ consistent: the exit codes differ");
  assert.notEqual(r.stdout, ok.stdout, "unreachable ≠ consistent: stdout differs in SHAPE (empty vs a JSON document)");
});

test("C3b — HAZARD (current behavior, NOT a property): a configured-but-DEAD remote reads as `nothing to verify`", () => {
  // `fetch_notes`/`push_notes` swallow every failure (`|| true`), so a remote that exists in the config
  // but cannot be talked to yields no notes, and a no-notes board reports "all recorded merges
  // cross-machine verified" with exit 0 — i.e. 「离线」 is ISOMORPHIC to 「无事可验」 (硬规则 3b's exact
  // shape). Pinned so the rewrite cannot change it silently; recorded as a finding in the Evidence.
  const { b } = setupMachines();
  git(b, ["remote", "add", "dead", path.join(path.dirname(b), "does-not-exist.git")]);
  const r = cmvOn(b, ["--report", "--json", "--machine", "machine-B", "--remote", "dead"]);
  assert.equal(r.status, 0, "CURRENT behavior: an unreachable-but-configured remote still reports exit 0");
  const j = JSON.parse(r.stdout);
  assert.equal(j.merges.length, 0, "CURRENT behavior: zero merges visible, indistinguishable from an empty board");
  assert.equal(j.unverified_merges, 0);
  assert.equal(j.unattributed_commits, 0, "and the unattributed fail-closed surface is empty too");

  const v = cmvOn(b, ["--verify", "--machine", "machine-B", "--gate", "true", "--remote", "dead"]);
  assert.equal(v.status, 0, "CURRENT behavior: --verify over a dead remote exits 0 having verified nothing");
  assert.match(v.stdout, /^cross-machine-verify: verify done \(green 0 \/ red 0 \/ gate-error 0 \//m, "and the summary says green 0");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// C4 — 参数缺失: every missing/invalid input fails closed with its own named CAUSE
// ════════════════════════════════════════════════════════════════════════════════════════════════════
test("C4a — --record-merge without a sha is a usage error (2), never a silent no-op", () => {
  const { a } = setupMachines();
  const r = cmvOn(a, ["--record-merge", "--machine", "machine-A"]);
  assert.equal(r.status, 2);
  assert.match(
    r.stderr,
    /^cross-machine-verify: --record-merge requires at least one <sha> \(the merges this machine just landed\)$/m,
  );
});

test("C4b — an unknown flag is a usage error (2) that names the flag", () => {
  const { a } = setupMachines();
  const r = cmvOn(a, ["--bogus"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^cross-machine-verify: unknown argument: --bogus$/m);
});

test("C4c — an EMPTY --branches is a usage error (2), not a run over `no branches`", () => {
  const { a } = setupMachines();
  const r = cmvOn(a, ["--branches", ""]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^cross-machine-verify: empty --branches$/m);
});

test("C4d — a --root that is not a git repo is a fail-closed exit 2", () => {
  const tmp = tempRoot("cmv-nonrepo-");
  const r = cmv(["--root", tmp, "--branch", "develop", "--machine", "machine-B"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(`^cross-machine-verify: not a git repo: ${tmp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
});

test("C4e — a tracked branch that does not exist locally is a fail-closed exit 2", () => {
  const { a } = setupMachines();
  const r = cmvOn(a, ["--branch", "no-such-branch", "--machine", "machine-B"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^cross-machine-verify: local branch not found: no-such-branch$/m);
});

test("C4f — a sha that is not a commit is counted `missing` and the run still exits 0", () => {
  const { a } = setupMachines();
  const bogus = "0123456789abcdef0123456789abcdef01234567";
  const r = cmvOn(a, ["--record-merge", bogus, "--machine", "machine-A"]);
  assert.equal(r.status, 0, "a missing sha is reported, not fatal — the SUMMARY is the verdict surface");
  assert.match(r.stderr, new RegExp(`^cross-machine-verify: not a commit: ${bogus}$`, "m"));
  assert.match(r.stdout, /^cross-machine-verify: record-merge done \(recorded 0 \/ skipped 0 \/ missing 1\)$/m);
});
