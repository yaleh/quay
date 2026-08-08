// @test-group product
// user-scope-reinstall.test.mjs — gap-user-scope-install-reinstall-criterion-and-version (AC1-AC3).
//
// The defect: a user-scope plugin install (~/.local/share/quay-plugin/, where Claude Code's own
// /plugin install puts it) carried NO version marker and NO staleness criterion — the 06:01
// stale install (dist/scripts ~10h behind the plugin tree) was a LIVE consumption path with no
// mechanism telling the user "你装的这份落后了". This file tests the fix:
//   AC1  plugin/VERSION marks the plugin version; --install-user-scope stamps it on the install.
//   AC2  --check-user-scope reports STALE ("落后" + "stale") when the installed copy is BEHIND
//        or has NO VERSION marker (the pre-fix install); fresh when equal. Negative control:
//        before this check nothing reported the stale install.
//   AC3  --reinstall-criterion classifies by capability boundary: capability-add / security-fix /
//        inherited-defect ⇒ REINSTALL-IMMEDIATE; anything else ⇒ BATCHABLE.
//
// All assertions run the REAL plugin/sync.sh (bash), not a mock — the mechanism is the deliverable.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");
const syncSh = path.join(pluginDir, "sync.sh");
const versionFile = path.join(pluginDir, "VERSION");
const vendoredPkg = path.join(pluginDir, "vendor", "quay", "package.json");

const SEMVER = /^\d+\.\d+\.\d+$/;

function runSync(...args) {
  return spawnSync("bash", [syncSh, ...args], { encoding: "utf8" });
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "user-scope-reinstall-"));
}

function currentVersion() {
  return fs.readFileSync(versionFile, "utf8").split("\n")[0].trim();
}

function writeVersion(dir, version) {
  fs.writeFileSync(path.join(dir, "VERSION"), `${version}\n`, "utf8");
}

// ── AC1: version marker ───────────────────────────────────────────────────────────────────────────
test("AC1 — plugin/VERSION exists, is a semver, and matches the vendored package.json version (single source)", () => {
  assert.ok(fs.existsSync(versionFile), "plugin/VERSION must exist");
  const v = currentVersion();
  assert.match(v, SEMVER, `plugin/VERSION must be a semver string, got ${v}`);
  // Single-source-of-truth invariant: plugin/VERSION must equal the vendored package.json version
  // (written by sync-vendor.sh from packages/quay/package.json). A drift is a real mis-label —
  // the user-scope compare would compare against the WRONG version.
  assert.ok(fs.existsSync(vendoredPkg), "plugin/vendor/quay/package.json must exist");
  const declared = JSON.parse(fs.readFileSync(vendoredPkg, "utf8")).version;
  assert.equal(v, declared, "plugin/VERSION must match plugin/vendor/quay/package.json version");
});

test("AC1 — --install-user-scope copies the plugin tree and stamps VERSION on the install", () => {
  const dest = tmpdir();
  try {
    const r = runSync("--install-user-scope", dest);
    assert.equal(r.status, 0, `install-user-scope should succeed: ${r.stderr}`);
    const installed = path.join(dest, "VERSION");
    assert.ok(fs.existsSync(installed), "the installed copy must carry a VERSION marker");
    assert.equal(readInstalledVersion(dest), currentVersion(), "stamped VERSION must equal the plugin VERSION");
    // The mechanism must be installable into the real user-scope shape (a dir with skills/scripts).
    assert.ok(fs.existsSync(path.join(dest, "scripts")) || fs.existsSync(path.join(dest, "skills")),
      "the installed copy should contain the plugin distribution (scripts/skills)");
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

// ── AC2: staleness check ──────────────────────────────────────────────────────────────────────────
test("AC2 — negative control: an install with NO VERSION marker (a pre-fix install) is reported STALE", () => {
  const dest = tmpdir();
  try {
    fs.mkdirSync(path.join(dest, "scripts"), { recursive: true }); // a bare pre-fix install
    const r = runSync("--check-user-scope", dest);
    assert.equal(r.status, 1, "a pre-fix install (no VERSION) must fail the staleness check");
    const out = `${r.stdout}${r.stderr}`;
    assert.match(out, /stale/i, "must report the installed copy is stale");
    assert.ok(out.includes("落后"), "must say 你装的这份落后了");
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("AC2 — an install BEHIND current is reported STALE (落后 + stale), exit 1", () => {
  const dest = tmpdir();
  try {
    writeVersion(dest, "0.0.1"); // far behind current
    const r = runSync("--check-user-scope", dest);
    assert.equal(r.status, 1, "behind ⇒ exit 1");
    const out = `${r.stdout}${r.stderr}`;
    assert.ok(out.includes("落后"), "must say 你装的这份落后了");
    assert.match(out, /stale/i, "must carry the stale token (Contract measure grep '落后|stale')");
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("AC2 — an install AT current is NOT reported STALE (exit 0, no stale/落后)", () => {
  const dest = tmpdir();
  try {
    writeVersion(dest, currentVersion());
    const r = runSync("--check-user-scope", dest);
    assert.equal(r.status, 0, "equal version ⇒ exit 0");
    const out = `${r.stdout}${r.stderr}`;
    assert.doesNotMatch(out, /STALE \(user-scope plugin install\)/, "equal version must NOT be stale");
    assert.ok(!out.includes("落后"), "equal version must NOT say 落后");
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("AC2 — an install AHEAD of current is NOT stale (exit 0)", () => {
  const dest = tmpdir();
  try {
    writeVersion(dest, "9.9.9");
    const r = runSync("--check-user-scope", dest);
    assert.equal(r.status, 0, "ahead ⇒ not stale");
    const out = `${r.stdout}${r.stderr}`;
    assert.doesNotMatch(out, /STALE \(user-scope plugin install\)/, "ahead ⇒ no STALE status");
    assert.ok(!out.includes("落后"), "ahead ⇒ no 落后");
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("AC2 — Contract measure: version_stale_detected >= 1 when behind (grep '落后|stale')", () => {
  const dest = tmpdir();
  try {
    writeVersion(dest, "0.0.1");
    // The Contract measure is: `bash <version-check> 2>&1 | grep -c '落后\|stale'`
    const r = spawnSync("bash", ["-c", `${JSON.stringify(syncSh)} --check-user-scope ${JSON.stringify(dest)} 2>&1 | grep -c '落后\\|stale'`], { encoding: "utf8" });
    assert.equal(r.status, 0, "grep must find at least one line");
    assert.ok(Number(r.stdout.trim()) >= 1, `version_stale_detected must be >= 1, got ${r.stdout.trim()}`);
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test("AC2 — a NOT-installed directory (nonexistent) is NOT stale (informational only)", () => {
  const dest = path.join(tmpdir(), "does-not-exist");
  try {
    const r = runSync("--check-user-scope", dest);
    assert.equal(r.status, 0, "nothing installed ⇒ nothing to be behind ⇒ exit 0");
    const out = `${r.stdout}${r.stderr}`;
    assert.match(out, /NOT-INSTALLED/);
    assert.doesNotMatch(out, /stale/i);
  } finally {
    fs.rmSync(path.dirname(dest), { recursive: true, force: true });
  }
});

// ── AC3: reinstall criterion by capability boundary ───────────────────────────────────────────────
test("AC3 — capability-add / security-fix / inherited-defect each trigger REINSTALL-IMMEDIATE", () => {
  const cases = [
    ["new skill: quay-routines", "capability-add"],
    ["新增 skill: manager-observation", "capability-add"],
    ["新能力：新增 loop 文档", "capability-add"],
    ["crash fix in the session-liveness watchdog", "security-fix"],
    ["安全修复：崩溃成因", "security-fix"],
    ["dist stale — mcp_entry + version marker fix", "inherited-defect"],
  ];
  for (const [desc, cls] of cases) {
    const r = runSync("--reinstall-criterion", desc);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /REINSTALL-IMMEDIATE/, `${desc} (${cls}) must trigger immediate reinstall`);
    assert.match(r.stdout, new RegExp(cls), `must name the class ${cls}`);
  }
});

test("AC3 — ordinary changes are BATCHABLE (can accumulate)", () => {
  const r = runSync("--reinstall-criterion", "docs typo fix", "rename an internal variable");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /BATCHABLE/);
  assert.doesNotMatch(r.stdout, /REINSTALL-IMMEDIATE/);
  assert.match(r.stdout, /batchable: docs typo fix/);
  assert.match(r.stdout, /batchable: rename an internal variable/);
});

test("AC3 — a batch containing ANY immediate class is REINSTALL-IMMEDIATE (not silently batched)", () => {
  const r = runSync("--reinstall-criterion", "docs typo", "security-fix: watchdog crash", "refactor helper");
  assert.match(r.stdout, /REINSTALL-IMMEDIATE/);
  assert.match(r.stdout, /IMMEDIATE: security-fix/);
  // the batchables are still listed
  assert.match(r.stdout, /batchable: docs typo/);
  assert.match(r.stdout, /batchable: refactor helper/);
});

// ── version comparison primitive (used by AC2) ────────────────────────────────────────────────────
test("version comparison — behind/equal/ahead map to the right staleness verdicts", () => {
  const dest = tmpdir();
  try {
    writeVersion(dest, "0.3.9");
    assert.equal(runSync("--check-user-scope", dest).status, 1, "0.3.9 behind 0.4.0 ⇒ stale");
    writeVersion(dest, "0.4.0");
    assert.equal(runSync("--check-user-scope", dest).status, 0, "0.4.0 == current ⇒ fresh");
    writeVersion(dest, "1.0.0");
    assert.equal(runSync("--check-user-scope", dest).status, 0, "1.0.0 ahead ⇒ not stale");
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

function readInstalledVersion(dir) {
  return fs.readFileSync(path.join(dir, "VERSION"), "utf8").split("\n")[0].trim();
}
