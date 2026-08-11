// @test-group governance
// release-freshness-check.test.mjs — unit tests for the release freshness check
// (gap-release-freshness-no-recut-mechanism, AC2/AC3).
//
// The check answers "is the latest release fresh?" with two mechanical signals:
//   1. 重切触发 (AC2) — release_ahead = `git rev-list --count <tag>..<develop>`; > threshold ⇒
//      recut WARN (default threshold 500, overridable).
//   2. 漂移闸 (AC3) — per-dir delivery-surface count at the release tag vs at develop; any
//      difference ⇒ drift_dirs > 0, reported mechanically (delivery-inventory idea on the release
//      surface). --list-drift lists file-level A/D/M.
//
// Coverage map (task ACs + Contract):
//   AC2 — recut trigger: ahead > threshold ⇒ exit 1 + recut_warn=1 + verdict STALE; threshold
//         override high ⇒ recut_warn=0. Both directions, no drift confounder.
//   AC3 — drift gate: a develop-only delivery-dir addition ⇒ drift_dirs=1 + verdict STALE even
//         with recut_warn=0; a fresh recut (tag at develop HEAD) ⇒ drift_dirs=0 + FRESH.
//   Contract measure release_ahead — the JSON output carries the literal count.
//   Contract invariant release_drift_gate = 1 — drift is mechanically reportable (exit 1 + named
//         dirs + --list-drift file-level lines).
//   Single source — DELIVERY_DIRS in the .sh mirrors DELIVERY_INVENTORY in verify-delivery-surface.ts
//         (a dir added to the TS ⇒ this selfcheck goes red until the .sh list is updated).
//   Exit 2 — usage/environment (missing refs, not a git repo).
//
// Run:
//   scripts/test.sh plugin/test/release-freshness-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECK = path.join(REPO_ROOT, "plugin", "scripts", "release-freshness-check.sh");
const VERIFY_TS = path.join(REPO_ROOT, "plugin", "scripts", "verify-delivery-surface.ts");

// Governance self-skip (AC7 @test-group governance, ADR-019 decision #1): in a DEFAULT
// (product,engine) run this file reports `skipped`, not absent — QUAY_TEST_GROUPS is set to
// product,engine on the default path, so the real tests run only with `--group governance`
// or in the explicit-file form (QUAY_TEST_GROUPS unset).
const GOV_SKIP_REASON =
  process.env.QUAY_TEST_GROUPS && !process.env.QUAY_TEST_GROUPS.split(",").includes("governance")
    ? "set QUAY_TEST_GROUPS=governance to run"
    : false;
function t(name, fn) {
  test(name, GOV_SKIP_REASON ? { skip: GOV_SKIP_REASON } : {}, fn);
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr ?? ""}`);
  return r.stdout.trim();
}

/** The 8 delivery-surface dirs — mirror of DELIVERY_DIRS in the .sh (selfchecked below). */
const DELIVERY_DIRS = [
  "plugin/scripts",
  "plugin/gate-scripts",
  "plugin/skills",
  "plugin/probes",
  "plugin/loop",
  "plugin/workflows",
  "plugin/agents",
  "plugin/vendor",
];

/**
 * Build a temp git repo: tag v0.1.0 on a baseline commit, then a `develop` branch at the same
 * commit (so a fresh repo has ahead=0 / drift=0). Callers add files on develop to create drift
 * and/or extra commits to create ahead.
 */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-freshness-"));
  for (const d of DELIVERY_DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@test");
  git(root, "config", "user.name", "t");
  fs.writeFileSync(path.join(root, "plugin", "scripts", "a.sh"), "#!/usr/bin/env bash\necho a\n");
  fs.writeFileSync(path.join(root, "plugin", "probes", "p1.json"), "{}\n");
  fs.writeFileSync(path.join(root, "plugin", "loop", "l1.md"), "# l1\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "baseline");
  git(root, "tag", "v0.1.0");
  git(root, "checkout", "-q", "-b", "develop");
  return root;
}

/** Run the check against a root. */
function runCheck(root, extraArgs = []) {
  const res = spawnSync("bash", [CHECK, "--root", root, ...extraArgs], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// ── single source (DELIVERY_DIRS mirrors DELIVERY_INVENTORY) ──────────────────────────────────────

t("single source — DELIVERY_DIRS in the .sh mirrors DELIVERY_INVENTORY in verify-delivery-surface.ts", () => {
  const script = fs.readFileSync(CHECK, "utf8");
  const ts = fs.readFileSync(VERIFY_TS, "utf8");
  const sm = script.match(/DELIVERY_DIRS=\(([^)]*)\)/);
  assert.ok(sm, "script must declare DELIVERY_DIRS=(...)");
  const scriptDirs = sm[1].trim().split(/\s+/).filter(Boolean);
  // Extract ONLY the DELIVERY_INVENTORY array block's `dir:` values (the TS has other dir: uses).
  const start = ts.indexOf("export const DELIVERY_INVENTORY");
  const end = ts.indexOf("];", start);
  const block = ts.slice(start, end);
  const tsDirs = [...block.matchAll(/\bdir:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(tsDirs.length > 0, "DELIVERY_INVENTORY must declare dir entries");
  assert.deepEqual(
    [...scriptDirs].sort(),
    [...tsDirs].sort(),
    "DELIVERY_DIRS must mirror DELIVERY_INVENTORY dirs (add the dir to both)"
  );
});

// ── --help contract ───────────────────────────────────────────────────────────────────────────────

t("GREEN — --help exits 0, first line starts with 用法, no business side effects", () => {
  const res = spawnSync("bash", [CHECK, "--help"], { encoding: "utf8" });
  assert.equal(res.status, 0, "--help must exit 0");
  const first = (res.stdout ?? "").split("\n")[0];
  assert.match(first, /用法|usage/, `first line must be the usage token, got: ${first}`);
});

// ── fresh (recut: tag at develop HEAD) ────────────────────────────────────────────────────────────

t("GREEN — FRESH: tag at develop HEAD ⇒ ahead=0, drift=0, exit 0", () => {
  const root = makeRepo();
  try {
    git(root, "tag", "v0.2.0"); // recut: newest tag sits on develop HEAD
    const r = runCheck(root);
    assert.equal(r.status, 0, `fresh repo must pass:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /verdict=FRESH/);
    assert.match(r.stdout, /release_ahead=0/);
    assert.match(r.stdout, /drift_dirs=0/);
  } finally { rmrf(root); }
});

t("GREEN — FRESH JSON is valid and carries the Contract measure release_ahead", () => {
  const root = makeRepo();
  try {
    git(root, "tag", "v0.2.0");
    const r = runCheck(root, ["--json"]);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.verdict, "FRESH");
    assert.equal(j.release_ahead, 0);
    assert.equal(j.drift_dirs, 0);
    assert.equal(j.recut_warn, 0);
    assert.equal(j.release_tag, "v0.2.0");
  } finally { rmrf(root); }
});

// ── recut trigger (AC2) ───────────────────────────────────────────────────────────────────────────

t("RED — recut trigger: develop ahead of the tag over the threshold ⇒ recut_warn=1, exit 1", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "README.md"), "# readme\n"); // ahead WITHOUT delivery-surface drift
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "non-delivery commit");
    const r = runCheck(root, ["--threshold", "0"]); // ahead=1 > 0 ⇒ recut WARN
    assert.equal(r.status, 1, "ahead over threshold must be STALE");
    assert.match(r.stdout, /release_ahead=1/);
    assert.match(r.stdout, /recut_warn=1/);
    assert.match(r.stdout, /verdict=STALE/);
    assert.match(r.stderr, /WARN.*recut/, "recut WARN must be on stderr");
  } finally { rmrf(root); }
});

t("GREEN — threshold override high suppresses the recut WARN (ahead without drift)", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "README.md"), "# readme\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "non-delivery commit");
    const r = runCheck(root, ["--threshold", "999"]); // ahead=1 <= 999 ⇒ no recut WARN, no drift ⇒ FRESH
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /recut_warn=0/);
    assert.match(r.stdout, /verdict=FRESH/);
  } finally { rmrf(root); }
});

t("RED — recut trigger fires in JSON mode too", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "README.md"), "# readme\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "non-delivery commit");
    const r = runCheck(root, ["--json", "--threshold", "0"]);
    assert.equal(r.status, 1, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.recut_warn, 1);
    assert.equal(j.verdict, "STALE");
    assert.equal(j.release_ahead, 1);
  } finally { rmrf(root); }
});

// ── drift gate (AC3) ──────────────────────────────────────────────────────────────────────────────

t("RED — drift gate: a develop-only delivery-dir addition ⇒ drift_dirs=1, exit 1 even with recut_warn=0", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "plugin", "scripts", "b.sh"), "#!/usr/bin/env bash\necho b\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "add a script on develop");
    // ahead=1, but default threshold 500 ⇒ recut_warn=0; drift is the ONLY stale signal.
    const r = runCheck(root);
    assert.equal(r.status, 1, "delivery-surface drift must be STALE");
    assert.match(r.stdout, /drift_dirs=1/);
    assert.match(r.stdout, /plugin\/scripts:1->2/, "drift must name the drifted dir + counts");
    assert.match(r.stdout, /verdict=STALE/);
    assert.match(r.stdout, /recut_warn=0/, "drift must fire independently of the recut WARN");
    assert.match(r.stderr, /WARN.*漂移/, "drift WARN must be on stderr");
  } finally { rmrf(root); }
});

t("RED — --list-drift prints file-level A/D/M for the drifted dir", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "plugin", "probes", "p2.json"), "{}\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "add a probe on develop");
    const r = runCheck(root, ["--list-drift"]);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /plugin\/probes:1->2/);
    assert.match(r.stdout, /file-level A\/D\/M/);
    assert.match(r.stdout, /A\tplugin\/probes\/p2\.json/, "--list-drift must name the added file");
  } finally { rmrf(root); }
});

t("RED — recut + drift together: both stale signals reported", () => {
  const root = makeRepo();
  try {
    fs.writeFileSync(path.join(root, "plugin", "loop", "l2.md"), "# l2\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "add a loop doc on develop");
    const r = runCheck(root, ["--threshold", "0"]);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /recut_warn=1/);
    assert.match(r.stdout, /drift_dirs=1/);
    assert.match(r.stdout, /plugin\/loop:1->2/);
    assert.match(r.stdout, /verdict=STALE/);
  } finally { rmrf(root); }
});

// ── usage / environment (exit 2) ──────────────────────────────────────────────────────────────────

t("exit 2 — missing develop ref", () => {
  const root = makeRepo();
  try {
    const r = runCheck(root, ["--develop", "no-such-branch"]);
    assert.equal(r.status, 2, "missing develop ref must be an env error");
    assert.match(r.stderr, /no-such-branch/);
  } finally { rmrf(root); }
});

t("exit 2 — missing tag ref", () => {
  const root = makeRepo();
  try {
    const r = runCheck(root, ["--tag", "v9.9.9"]);
    assert.equal(r.status, 2, "missing tag ref must be an env error");
    assert.match(r.stderr, /v9\.9\.9/);
  } finally { rmrf(root); }
});

t("exit 2 — not a git repo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-freshness-nogit-"));
  try {
    const r = runCheck(root);
    assert.equal(r.status, 2, "non-repo root must be an env error");
    assert.match(r.stderr, /not a git worktree/);
  } finally { rmrf(root); }
});

t("exit 2 — threshold must be a non-negative integer", () => {
  const root = makeRepo();
  try {
    const r = runCheck(root, ["--threshold", "abc"]);
    assert.equal(r.status, 2, "non-integer threshold must be an env error");
    assert.match(r.stderr, /--threshold/);
  } finally { rmrf(root); }
});
