// @test-group engine
// cross-machine-verify.test.mjs — tasks/gap-no-post-merge-cross-machine-verification-detection-latency-is-luck.
// The cross-machine VERIFICATION mechanism: every merge landing on the tracked branches must get a
// gate verdict from a machine that did NOT participate in the merge (AC4), the latency d is
// mechanically readable (AC5/AC2), and the fast gate must catch a deliberately-broken change and
// name the file (AC3). Shared state = git notes (refs/notes/quay-cmv-merge / quay-cmv-verdict),
// pushed to the shared remote — the same cross-machine channel the sync mechanism uses.
//
// Coverage map (task ACs):
//   AC4 — a merge recorded by machine A is verified by machine B (--machine b); the report's
//         verifier_machine != merger_machine ⇒ verifier_is_participant = 0 (band 0).
//   AC4-structural — machine A running --verify on its OWN merge SKIPS it (a parent cannot verify
//         its own merge — the "parent environment masks parent defects" structural requirement).
//   AC5 — --report --json lists unverified merges with wait_h (the current detection latency d) and
//         the verifier/merger/post_merge_latency_h fields; a pending merge is surfaced, not assumed.
//   AC3 — --gate-run against a deliberately-broken fixture file: the gate goes RED and names the file
//         (the negative control; a gate that cannot see a broken change is no gate).
//   fail-closed — unattributed merges (no merge note) are NOT verified; not-a-git-repo / missing
//         branch exit 2.
//
// All fixtures are self-contained temp git repos (bare origin + machine clones); nothing in the real
// checkout is mutated (R3 test-isolation). The default fast gate (laydown-set-check.sh) needs a full
// quay tree, so these tests use `--gate` overrides for the gate verdict, and the gate itself is the
// subject of the AC3 negative-control case (a fixture gate that names its failing file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const script = join(repoRoot, "plugin", "scripts", "cross-machine-verify.sh");

function git(cwd, ...args) {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function run(scriptPath, args, opts = {}) {
  const res = spawnSync("bash", [scriptPath, ...args], { encoding: "utf8", ...opts });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function makeTmp(prefix) {
  return mkdtempSync(join(tmpdir(), `cmv-${prefix}-`));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function commit(cwd, msg, content = msg) {
  writeFileSync(join(cwd, "file.txt"), `${content}\n`, "utf8");
  assert.equal(git(cwd, "add", "-A").status, 0, "git add");
  assert.equal(git(cwd, "commit", "-q", "-m", msg).status, 0, `git commit ${msg}`);
  return git(cwd, "rev-parse", "HEAD").stdout.trim();
}

// World: bare origin (the shared GitHub point) + a machine clone. Both develop and integration exist.
function makeWorld(prefix) {
  const root = makeTmp(prefix);
  const shared = join(root, "origin.git");
  const m = join(root, "machine");
  assert.equal(git(root, "init", "-q", "--bare", shared).status, 0, "init bare origin");
  assert.equal(git(root, "clone", "-q", shared, m).status, 0, "clone machine");
  git(m, "config", "user.name", "machine");
  git(m, "config", "user.email", "m@example.com");
  git(m, "checkout", "-q", "-b", "develop");
  commit(m, "develop base");
  assert.equal(git(m, "push", "-q", "-u", "origin", "develop").status, 0, "publish develop");
  git(m, "checkout", "-q", "-b", "integration");
  commit(m, "integration base");
  assert.equal(git(m, "push", "-q", "-u", "origin", "integration").status, 0, "publish integration");
  git(m, "checkout", "-q", "develop");
  return { root, shared, m };
}

// A gate override that emits a failing-file name when the marker is missing (the AC3 shape).
function writeFailGate(dir, marker) {
  const gate = join(dir, "gate.sh");
  writeFileSync(
    gate,
    `#!/usr/bin/env bash
if grep -q "${marker}" file.txt; then
  echo "gate-ok"
  exit 0
else
  echo "FAIL plugin/scripts/broken.sh"
  exit 1
fi
`,
    "utf8"
  );
  return gate;
}

// ── AC4: cross-machine verify — merger A, verifier B, verifier_is_participant = 0 ────────────────

test("AC4: a merge recorded by machine A is verified by machine B and the report proves verifier != merger (verifier_is_participant=0)", () => {
  const w = makeWorld("ac4");
  try {
    // Machine A lands a merge on develop (the land event = a new commit on the tracked branch).
    const mergeSha = commit(w.m, "landed merge work");
    const r1 = run(script, ["--record-merge", mergeSha, "--root", w.m, "--machine", "machine-a"]);
    assert.equal(r1.status, 0, `record-merge failed: ${r1.stdout}${r1.stderr}`);
    assert.match(r1.stdout, /merger_machine=machine-a/, "the merger is recorded as machine A");

    // Before any non-participant verifies, the report shows the merge PENDING (AC5 surface) and
    // exits 1 (fail-closed resume signal: do not assume verified).
    const rep1 = run(script, ["--report", "--root", w.m, "--machine", "machine-a", "--json"]);
    assert.equal(rep1.status, 1, "report exits 1 while a merge is unverified");
    const j1 = JSON.parse(rep1.stdout);
    assert.equal(j1.unverified_merges, 1, "one pending merge before verification");
    assert.equal(j1.merges[0].merger_machine, "machine-a", "merger recorded");
    assert.equal(j1.merges[0].verified, false, "not yet verified");

    // Machine A CANNOT verify its own merge (AC4 structural — parent masks parent defects).
    const selfV = run(script, ["--verify", "--root", w.m, "--machine", "machine-a", "--gate", "true"]);
    assert.match(selfV.stdout, /IS the merger/, "A's verify skips its own merge");
    assert.match(selfV.stdout, /skipped-participant 1/, "one participant skipped");

    // Machine B (a NON-participating machine) verifies the merge with the fast gate.
    const r2 = run(script, ["--verify", "--root", w.m, "--machine", "machine-b", "--gate", "true"]);
    assert.equal(r2.status, 0, `verify (machine-b) failed: ${r2.stdout}${r2.stderr}`);
    assert.match(r2.stdout, /verdict=green/, "B's fast gate went green");
    assert.match(r2.stdout, /post_merge_latency_h=\d/, "B measured the detection latency");

    // The report now PROVES verifier_is_participant = 0 (AC4 band).
    const rep2 = run(script, ["--report", "--root", w.m, "--machine", "machine-a", "--json"]);
    const j2 = JSON.parse(rep2.stdout);
    assert.equal(j2.verified_merges, 1, "the merge is now cross-machine verified");
    assert.equal(j2.merger_machine, "machine-a", "merger is A");
    assert.equal(j2.verifier_machine, "machine-b", "verifier is B");
    assert.equal(j2.verifier_is_participant, 0, "verifier_is_participant = 0 (band 0)");
    assert.ok(Number(j2.post_merge_latency_h) >= 0, `post_merge_latency_h readable: ${j2.post_merge_latency_h}`);
  } finally {
    cleanup(w.root);
  }
});

// ── AC5: the report is the mechanically readable "who is unverified / how long each has waited" ────

test("AC5: --report --json lists unverified merges with their wait_h and the verifier/merger/latency fields", () => {
  const w = makeWorld("ac5");
  try {
    const mergeSha = commit(w.m, "a merge needing verification");
    assert.equal(run(script, ["--record-merge", mergeSha, "--root", w.m, "--machine", "machine-a"]).status, 0, "record");

    const rep = run(script, ["--report", "--root", w.m, "--machine", "machine-a", "--json"]);
    assert.equal(rep.status, 1, "report exits 1 while a merge is unverified (fail-closed)");
    const j = JSON.parse(rep.stdout);
    assert.equal(j.unverified_merges, 1, "report surfaces the pending merge");
    assert.equal(j.verified_merges, 0, "nothing verified yet");
    assert.equal(j.merges.length, 1, "the merge is listed");
    const m0 = j.merges[0];
    assert.equal(m0.merger_machine, "machine-a");
    assert.equal(m0.verified, false);
    assert.ok(m0.wait_h >= 0, `wait_h is a number: ${m0.wait_h}`);
    // The ## Contract measure fields are present and machine-readable.
    for (const k of ["verifier_machine", "merger_machine", "verifier_is_participant", "post_merge_latency_h"]) {
      assert.ok(k in j, `report has field ${k}`);
    }
  } finally {
    cleanup(w.root);
  }
});

// ── AC3: negative control — the fast gate must go RED and name the file for a broken change ───────

test("AC3: negative control — the fast gate goes RED and names the file for a deliberately-broken change", () => {
  const w = makeWorld("ac3");
  try {
    const gate = writeFailGate(w.root, "GOOD_MARKER");
    // The fixture file does NOT contain GOOD_MARKER → the gate must go red and name the file.
    writeFileSync(join(w.m, "file.txt"), "BROKEN_MARKER\n", "utf8");
    const r = run(script, ["--gate-run", "--gate", `bash ${gate}`, "--root", w.m]);
    assert.equal(r.status, 1, "gate must exit 1 (red) on a broken change");
    assert.match(r.stdout, /"verdict":"red"/, "verdict is red");
    assert.match(r.stdout, /broken\.sh/, "the gate names the failing file");
    assert.match(r.stdout, /"files":\[.*broken\.sh/, "files array names the broken file");

    // Positive control: the same gate with the marker present goes green (the gate can see good code).
    writeFileSync(join(w.m, "file.txt"), "GOOD_MARKER\n", "utf8");
    const r2 = run(script, ["--gate-run", "--gate", `bash ${gate}`, "--root", w.m]);
    assert.equal(r2.status, 0, "gate exits 0 (green) when the change is sound");
    assert.match(r2.stdout, /"verdict":"green"/, "verdict is green");
  } finally {
    cleanup(w.root);
  }
});

// ── fail-closed: unattributed merges are NOT verified; bad usage exits 2 ─────────────────────────

test("fail-closed: a merge with NO merge note is NOT verified (cannot prove non-participation); not-a-git-repo/missing-branch exit 2", () => {
  const w = makeWorld("fc");
  try {
    // Record a first merge → the mechanism baseline is established.
    const recSha = commit(w.m, "recorded merge (baseline)");
    assert.equal(run(script, ["--record-merge", recSha, "--root", w.m, "--machine", "machine-a"]).status, 0, "record baseline");

    // A SECOND commit lands on develop but is never --record-merge'd (the land event was missed).
    const mergeSha = commit(w.m, "merge with no record");

    // --verify verifies the RECORDED baseline merge (machine-b is a non-participant), but CANNOT
    // verify the unattributed one: there is no merger identity to prove non-participation.
    const v = run(script, ["--verify", "--root", w.m, "--machine", "machine-b", "--gate", "true"]);
    assert.equal(v.status, 0, "verify still succeeds");
    assert.match(v.stdout, /skipped-unattributed 1/, "the unattributed merge is skipped, not verified");
    assert.match(v.stdout, /green 1/, "the recorded baseline merge IS verified by the non-participant");

    // --report still surfaces the un-recorded merge as unattributed (not silently assumed verified);
    // the recorded baseline merge is now cross-machine verified (machine-b's verdict, via the notes).
    const rep = run(script, ["--report", "--root", w.m, "--machine", "machine-a", "--json"]);
    const j = JSON.parse(rep.stdout);
    assert.equal(j.unattributed_commits, 1, "the un-recorded merge is surfaced as unattributed");
    assert.equal(j.unverified_merges, 0, "the recorded baseline merge is verified by machine-b");
    assert.equal(j.verified_merges, 1, "one cross-machine verified merge");

    // Fail-closed usage: not a git repo → exit 2; missing branch → exit 2.
    const notGit = join(w.root, "notgit");
    spawnSync("mkdir", ["-p", notGit]);
    const r1 = run(script, ["--report", "--root", notGit]);
    assert.equal(r1.status, 2, "not-a-git-repo must exit 2");
    assert.match(r1.stderr, /not a git repo/);

    const r2 = run(script, ["--report", "--root", w.m, "--branches", "no-such-branch"]);
    assert.equal(r2.status, 2, "missing branch must exit 2");
    assert.match(r2.stderr, /branch not found/);

    void mergeSha;
  } finally {
    cleanup(w.root);
  }
});

// ── idempotency: re-recording an already-recorded merge is a no-op ────────────────────────────────

test("idempotent: re-running --record-merge on an already-recorded merge skips it", () => {
  const w = makeWorld("idem");
  try {
    const mergeSha = commit(w.m, "merge to record twice");
    const r1 = run(script, ["--record-merge", mergeSha, "--root", w.m, "--machine", "machine-a"]);
    assert.match(r1.stdout, /recorded 1/, "first record");
    const r2 = run(script, ["--record-merge", mergeSha, "--root", w.m, "--machine", "machine-a"]);
    assert.match(r2.stdout, /skipped 1/, "second record skips the existing note");
    assert.match(r2.stdout, /recorded 0/, "nothing new recorded");
  } finally {
    cleanup(w.root);
  }
});
