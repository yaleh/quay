// @test-group engine
// develop-deliver-tgz-characterization.test.mjs — gap-arch-tsify-develop-deliver-tgz-python-heredocs
// (SPEC-architecture-consolidation §5 Phase 5.3, first stage).
//
// WHAT THIS FILE IS. A CHARACTERIZATION test, not a feature test: it pins the INPUT→OUTPUT contract
// of the twelve `python3` invocations embedded in plugin/scripts/develop-deliver-tgz.sh (ten `<<'PY'`
// heredoc bodies + two `python3 -c` one-liners) so that moving that logic into a TypeScript module
// is a MECHANICALLY CHECKED equivalence instead of a rewrite nobody can diff (§5's rule is
// 「把程序收进 TS，把胶水留在 bash」— the shell keeps the orchestration, the JSONL predicates move).
//
// WHY IT DRIVES THE PUBLIC FLAGS AND NOT THE EMBEDDED BODIES. Before the extraction there IS no
// callable unit — the bodies are stdin of a `python3` process launched in the middle of a bash
// function. The only contract that exists on BOTH sides of the migration is the one the script
// presents to a caller: the hermetic `--selfcheck*` modes (which each drive one predicate through
// positive + negative controls and print its verdict) and `--check` (which drives the two
// state-file readers). Those are the same inputs before and after, so this file is EXACTLY the
// right instrument for "迁移前后同一份输入下 stdout/退出码一致" — and it stays green only if the
// extracted module reproduces every one of the twelve contracts.
//
// WHICH HEREDOC EACH BLOCK PINS (line numbers at the pre-extraction revision):
//   H1  641-677  transport_evidence_append        record-identity dedup + append count
//   H2  716-743  check_evidence_completeness      COMPLETE / PARTIAL / ALL-MISSING
//   H3  782-824  check_e2e_pairing                (host, project_root) pairing — AC-240
//   H4  857-905  check_upgrade_pairing            same-root pairing — AC-239
//   H5  1350-1362  adrflip positive shape         `is False` / `is True` read of the two detects
//   H6  1364-1383  adrflip impostor shapes        0/1 and "false"/"true" must BOTH be refused
//   H7  1460-1475  complete-change positive       code-face ∧ doc-face ∧ task_id
//   H8  1477-1491  complete-change code-only      a perfect but ONE-SIDED union must not pass
//   H9  1493-1507  complete-change doc-only       the other one-sided union must not pass
//   H10 1509-1523  complete-change `./`-prefixed  the startswith("src/") branch must go false
//   H11 1661       read_state_field               `d.get(key,'')` with ALL failures ⇒ empty
//   H12 1673       age_seconds                    ISO-8601 → max(0, int(now-ts)); naive date ⇒ empty
//
// CAN THIS FILE TAKE FALSE? Yes — measured, not asserted (AC2's own negative control, reproduced in
// the task's Evidence section): injecting a single behavior change into the UNCHANGED bash (H2's
// `missing = sorted(exp - present)` → `missing = []`) reddens block 2; reverting restores green.
//
// Run:
//   scripts/test.sh plugin/test/develop-deliver-tgz-characterization.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "develop-deliver-tgz.sh");

function run(args) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

/** Every `--selfcheck*` mode is hermetic (temp dir, no build/scp/ssh) and self-asserting: a FAIL
 *  control makes it exit non-zero AND stop printing PASS. Both halves are asserted so a mode that
 *  silently stopped running cannot pass by printing nothing. */
function selfcheck(flag, passMarker) {
  const r = run([flag]);
  assert.equal(r.status, 0, `${flag} must exit 0:\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
  assert.match(r.stdout, passMarker, `${flag} must report PASS`);
  assert.doesNotMatch(r.stdout, /: FAIL/, `${flag} must print no FAIL verdict`);
  return r;
}

// ── H1 — transport_evidence_append: append count + record identity (dedup) ────────────────────────
test("H1 (heredoc 641-677) — append count is exact and a repeat transport is idempotent", () => {
  const r = selfcheck("--selfcheck-evidence", /selfcheck-evidence: positive PASS/);
  // The COUNT crosses the boundary: the python prints `appended` and the shell echoes it verbatim.
  assert.match(r.stdout, /positive first-append → EVIDENCE-TRANSPORT appended=2 carrier=/,
    "the first append must report exactly the 2 fixture records it wrote (the printed integer IS the heredoc's stdout)");
  assert.match(r.stdout, /positive repeat-append → EVIDENCE-TRANSPORT appended=0/,
    "re-transporting the SAME bytes must append 0 (identity = the record's FULL field set, so idempotence holds)");
  // The kind dimension (gap-ac203-two-distinct-kinds-no-production-run): two records identical in
  // (ts,ac,host,project_root) and differing ONLY in `kind` are two records, not one. An identity
  // that dropped a field would collapse them and print appended=1 here.
  assert.match(r.stdout, /selfcheck-evidence: kind-dimension carrier lines=2\n/,
    "two records differing only in `kind` must BOTH reach the carrier (a narrower identity signature silently eats the second)");
  assert.match(r.stdout, /kind-dimension repeat-append → EVIDENCE-TRANSPORT appended=0/,
    "and the wider identity must still be idempotent");
});

// ── H2 — check_evidence_completeness: three distinguishable verdicts ──────────────────────────────
test("H2 (heredoc 716-743) — COMPLETE(0) / PARTIAL(2) / ALL-MISSING(3) stay three distinguishable values", () => {
  const r = selfcheck("--selfcheck-evidence-completeness", /selfcheck-evidence-completeness: PASS/);
  assert.match(r.stdout, /partial → rc=2 .*PARTIAL present=2 missing=4 list=GOAL-009-AC-203,GOAL-009-AC-205,GOAL-009-AC-232,GOAL-015-AC-234/,
    "2 of 6 expected ac kinds ⇒ exit 2, present=2, missing=4, and the missing list enumerated IN SORTED ORDER");
  assert.match(r.stdout, /complete → rc=0 .*COMPLETE present=6/,
    "all 6 ⇒ exit 0 with present=6");
  assert.match(r.stdout, /all-missing → rc=1/,
    "an evidence file with NO expected kind ⇒ the distinct NOT-EVALUATED (mapped from the body's exit 3, never folded into PARTIAL)");
});

// ── H3 — check_e2e_pairing (AC-240) ───────────────────────────────────────────────────────────────
test("H3 (heredoc 782-824) — record-KIND completeness is not closure: the (host, root) pairing is judged", () => {
  const r = selfcheck("--selfcheck-e2e-pairing", /selfcheck-e2e-pairing: PASS/);
  assert.match(r.stdout, /positive → rc=0 .*E2E-PAIR OK host=hostB roots=\/home\/verify\/root-x/,
    "AC-203 + AC-207 sharing ONE root ⇒ exit 0 and an explicitly printed OK line");
  // Python's list repr — `['/x']` / `[]` — is part of the contract this test pins, not decoration.
  assert.match(r.stdout, /ac207-only → rc=2 .*E2E_PAIR_MISSING=1 .*AC203_roots=\[\] AC207_roots=\['\/home\/verify\/root-x'\]/,
    "AC-207 without AC-203 ⇒ exit 2, the PARTIAL marker, and BOTH per-host root sets printed in python list form");
  assert.match(r.stdout, /different-roots → rc=2 .*E2E_PAIR_MISSING=1 .*AC203_roots=\['\/home\/verify\/root-a'\] AC207_roots=\['\/home\/verify\/root-b'\]/,
    "'both present' is not 'paired': two roots ⇒ exit 2");
  assert.match(r.stdout, /empty-evidence → rc=1 NOT-EVALUATED/,
    "unreadable/empty evidence ⇒ exit 1, distinct from the exit-2 PAIR-MISSING verdict");
});

// ── H4 — check_upgrade_pairing (AC-239) ───────────────────────────────────────────────────────────
test("H4 (heredoc 857-905) — an AC-239 record only counts on a root its AC-238 proved upgraded", () => {
  const r = selfcheck("--selfcheck-upgrade-pairing", /selfcheck-upgrade-pairing: PASS/);
  assert.match(r.stdout, /positive → rc=0 .*UPGRADE-PAIR OK host=\S+ roots=\S+/,
    "a qualified AC-238 + AC-239 on ONE root ⇒ exit 0 with an explicit OK line");
  assert.match(r.stdout, /ac239-only \(no same-root AC-238\) → rc=2 .*UPGRADE_PAIR_MISSING=1 .*AC238_roots=\[\] AC239_roots=\['\/home\/verify\/up-root'\]/,
    "AC-239 with no AC-238 at all ⇒ exit 2 + UPGRADE_PAIR_MISSING=1, with both root sets printed");
  assert.match(r.stdout, /different-roots → rc=2 .*AC238_roots=\['\/home\/verify\/up-root'\] AC239_roots=\['\/home\/verify\/other-root'\]/,
    "two roots ⇒ exit 2 — the pairing is on the SAME root, not on 'both kinds present'");
  assert.match(r.stdout, /not-produced-by-driver → rc=2 .*AC239_roots=\[\]/,
    "produced_by_driver=false ⇒ exit 2 (the field predicate is not relaxed)");
  assert.match(r.stdout, /empty-evidence → rc=1 NOT-EVALUATED/,
    "missing/empty evidence ⇒ exit 1 (NOT-EVALUATED), the distinguishable third value");
});

// ── H5 + H6 — the two AC-248 JSON-boolean shape readings ──────────────────────────────────────────
test("H5/H6 (heredocs 1350-1362, 1364-1383) — `is False`/`is True` reads, and both impostor shapes refused", () => {
  const r = selfcheck("--selfcheck-adrflip-transport", /selfcheck-adrflip-transport: PASS/);
  assert.match(r.stdout, /json-bool-shape\(is-False\/is-True\) positive=1 impostors-refused=1 \(expect 1\/1/,
    "the positive sample must be read as pass=1 and BOTH impostor shapes (0/1 ints and \"false\"/\"true\" strings) must be refused=1 — a predicate that cannot take false would report 0 here");
});

// ── H7..H10 — the four AC-249 commit_files predicate readings ─────────────────────────────────────
test("H7-H10 (heredocs 1460-1475, 1477-1491, 1493-1507, 1509-1523) — code-face ∧ doc-face, and the prefix must be verbatim", () => {
  const r = selfcheck("--selfcheck-complete-change-transport", /selfcheck-complete-change-transport: PASS/);
  assert.match(r.stdout, /commit-files-predicate positive=1 impostors-refused\(code=1,doc=1,dot-slash=1\) \(expect 1\/1\/1\/1/,
    "the union sample must pass (1) and each of the three one-sided / `./`-prefixed impostors must be refused (1) — four independent readings, so a predicate stuck at either constant cannot report this line");
});

// ── H11 + H12 — read_state_field + age_seconds, driven through the real `--check` mode ────────────
//
// The two `python3 -c` one-liners are the ONLY readers of .quay/develop-deliver-state.json, and the
// trigger decision they feed is the script's whole self-throttle. `--check` is the hermetic surface
// that exposes them (it prints the decision + lastDelivered + age_seconds as JSON and exits 0
// without building anything), so it is the contract to pin.

/** A throw-away repo with the two things `--check` reads: a `refs/heads/develop` and (optionally)
 *  a state file. An env-isolated git so the fixture never inherits the developer's config
 *  (fixture-git-identity-must-go-in-child-env-not-repo-config). */
function makeCheckRoot(stateJson) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "devdeliver-check-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", env }).trim();
  git("init", "-q");
  git("config", "user.name", "characterization");
  git("config", "user.email", "char@example.com");
  git("commit", "-q", "--allow-empty", "-m", "base");
  git("branch", "-M", "develop");
  if (stateJson !== undefined) {
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(root, ".quay", "develop-deliver-state.json"), stateJson);
  }
  return { root, tip: git("rev-parse", "HEAD"), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function checkDecision(root) {
  const r = run(["--check", "--root", root]);
  assert.equal(r.status, 0, `--check must exit 0:\n${r.stdout}\n${r.stderr}`);
  const line = r.stdout.split("\n").find((l) => l.startsWith("{"));
  assert.ok(line, `--check must print its JSON record, got:\n${r.stdout}`);
  return { json: JSON.parse(line), stdout: r.stdout };
}

test("H11 (python3 -c @1661) — read_state_field returns the named field, and '' for anything unreadable", () => {
  // (a) the field is really read: lastDelivered == the develop tip ⇒ decision=fresh.
  const fresh = makeCheckRoot(JSON.stringify({ lastDelivered: "PLACEHOLDER", timestamp: "" }) + "\n");
  try {
    fs.writeFileSync(
      path.join(fresh.root, ".quay", "develop-deliver-state.json"),
      JSON.stringify({ lastDelivered: fresh.tip, timestamp: "" }) + "\n"
    );
    const { json } = checkDecision(fresh.root);
    assert.equal(json.decision, "fresh", "the value read back must be the state file's own lastDelivered — the trigger's whole input");
    assert.equal(json.lastDelivered, fresh.tip, "and it must be echoed into the decision record verbatim");
  } finally { fresh.cleanup(); }

  // (b) a MISSING key reads as empty (not as an error): timestamp absent ⇒ age_seconds=null, and with
  //     lastDelivered != tip the decision falls through to deliver.
  const noTs = makeCheckRoot(JSON.stringify({ lastDelivered: "deadbeef" }) + "\n");
  try {
    const { json } = checkDecision(noTs.root);
    assert.equal(json.age_seconds, null, "an absent `timestamp` must read as the EMPTY value ⇒ age_seconds null, never a fabricated 0");
    assert.equal(json.decision, "deliver", "no age ⇒ the hold cannot apply ⇒ deliver");
  } finally { noTs.cleanup(); }

  // (c) an UNPARSEABLE state file reads as empty rather than killing the script (`|| echo ""`):
  //     both fields empty, decision=deliver, exit 0.
  const broken = makeCheckRoot("{ this is not json\n");
  try {
    const { json } = checkDecision(broken.root);
    assert.equal(json.lastDelivered, "", "a corrupt state file must read as the empty value (the shell's `|| echo \"\"` contract)");
    assert.equal(json.age_seconds, null, "…for both fields");
    assert.equal(json.decision, "deliver", "…and the trigger still reaches a decision instead of aborting the entry point");
  } finally { broken.cleanup(); }
});

test("H12 (python3 -c @1673) — ISO-8601 age is an integer second count, floored at 0, and '' when unusable", () => {
  const iso = (secsAgo) => new Date(Date.now() - secsAgo * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  // (a) 120s ago ⇒ age_seconds ≈ 120 — the value the whole too-soon/deliver branch turns on.
  const aged = makeCheckRoot(JSON.stringify({ lastDelivered: "deadbeef", timestamp: iso(120) }) + "\n");
  try {
    const { json } = checkDecision(aged.root);
    assert.ok(
      typeof json.age_seconds === "number" && json.age_seconds >= 115 && json.age_seconds <= 130,
      `a 120s-old timestamp must read back ≈120 seconds (got ${JSON.stringify(json.age_seconds)})`
    );
    assert.equal(json.decision, "too-soon", "…and inside --max-age the hold applies (the age value is USED, not merely printed)");
  } finally { aged.cleanup(); }

  // (b) max-age 60 with a 120s-old deliver ⇒ the same age now yields deliver. Two readings of one
  //     quantity, so a constant printed into `age_seconds` cannot satisfy both.
  const aged2 = makeCheckRoot(JSON.stringify({ lastDelivered: "deadbeef", timestamp: iso(120) }) + "\n");
  try {
    const r = run(["--check", "--root", aged2.root, "--max-age", "60"]);
    assert.equal(r.status, 0, `--check --max-age 60 must exit 0:\n${r.stdout}\n${r.stderr}`);
    const json = JSON.parse(r.stdout.split("\n").find((l) => l.startsWith("{")));
    assert.equal(json.decision, "deliver", "the same age must cross a 60s hold ⇒ age_seconds is a real reading of the timestamp, not a shape");
  } finally { aged2.cleanup(); }

  // (c) an unparseable timestamp ⇒ empty (NOT 0): the shell's `[ -n "${age_seconds}" ]` guard then
  //     keeps the hold from being applied to a number nobody measured.
  const bad = makeCheckRoot(JSON.stringify({ lastDelivered: "deadbeef", timestamp: "not-a-timestamp" }) + "\n");
  try {
    const { json } = checkDecision(bad.root);
    assert.equal(json.age_seconds, null, "an unusable timestamp must read as empty ⇒ null, so the hold cannot be mis-applied to a fake 0");
    assert.equal(json.decision, "deliver", "…and the decision falls through honestly");
  } finally { bad.cleanup(); }
});
