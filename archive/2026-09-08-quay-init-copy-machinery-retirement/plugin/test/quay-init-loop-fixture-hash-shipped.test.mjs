// @test-group engine
// quay-init-loop-fixture-hash-shipped.test.mjs — gap-fixture-hash-omits-shipped-files.
//
// _fixtureHash() content-addresses the shared install fixture over the plugin surface. It had grown
// root-by-root (workflows, then skills/*/SKILL.md, then the vendored dist bundles) but each growth
// was a single discovered gap, not a sweep. The complete-sweep task enumerates EVERY shipped file
// class the --loop install READS or LAYS VERBATIM and found five more un-hashed classes:
//   1. plugin/vendor/quay-native/provider.yml — laid into .quay/runtime/provider.yml (the native
//      bundle resolves ../provider.yml relative to its own location).
//   2. plugin/probes/* — the routine-track probe specs (DIR-056), laid verbatim.
//   3. plugin/.claude/launch.settings.json — laid verbatim as the per-role launch template.
//   4. plugin/.quay/profiles.yml — laid verbatim as the profile carrier.
//   5. plugin/.claude-plugin/plugin.json — READ for the plugin version (recorded in the state file
//      + the auto-commit message), so a version bump changes the captured install output.
// Each is a shipped (git-tracked) file class whose change must invalidate the fixture; a stale reuse
// otherwise lays an OLD copy of the changed file into every fresh install (the same stale-runtime
// failure mode as the three prior gaps).
//
// These tests pin the coverage with temp plugin-shaped fixtures: a content change in EACH new class
// MUST change the hash, while an out-of-scope change (plugin/agents/ — the --agents/--all install
// category, NOT laid by --loop, which is what the fixture builds) must NOT. The last test asserts the
// REAL production _fixtureHash() now folds in the five new classes (not an empty-set pass).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _pluginSurfaceHash, _fixtureHash, _hashOfRoots, pluginDir } from "./quay-init-loop-helpers.mjs";

// A minimal plugin-shaped fixture covering every class _pluginSurfaceHash reads: scripts/ + loop/ +
// workflows/ + probes/ + one skill + the vendored provider.yml + the shipped config/declaration files
// + agents/ (the negative-control class) + .mcp.json (a second, clearly-not-read file).
function makePluginShape() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qih-shipped-"));
  for (const sub of ["scripts", "loop", "workflows", "probes", "agents",
                     ".claude", ".claude-plugin", ".quay",
                     "skills/init", "vendor/quay-native"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "scripts", "a.sh"), "#!/usr/bin/env bash\necho a\n");
  fs.writeFileSync(path.join(root, "loop", "tick.md"), "# tick v1\n");
  fs.writeFileSync(path.join(root, "workflows", "wf.js"), "// wf v1\n");
  fs.writeFileSync(path.join(root, "probes", "history-mining.md"), "# probe v1\n");
  fs.writeFileSync(path.join(root, "skills", "init", "SKILL.md"), "init v1\n");
  fs.writeFileSync(path.join(root, "vendor", "quay-native", "provider.yml"), "provider: v1\n");
  fs.writeFileSync(path.join(root, ".claude", "launch.settings.json"), '{"model":"v1"}\n');
  fs.writeFileSync(path.join(root, ".quay", "profiles.yml"), "profiles: v1\n");
  fs.writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), '{"version":"1.0.0"}\n');
  fs.writeFileSync(path.join(root, "agents", "executor.md"), "# agent v1\n");
  fs.writeFileSync(path.join(root, ".mcp.json"), '{"quay":{}}\n');
  return root;
}

test("AC1 — a vendored provider.yml content change changes the hash (laid into .quay/runtime/provider.yml)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, "vendor", "quay-native", "provider.yml"), "provider: v2\n");
    const after = _pluginSurfaceHash(root);
    assert.notEqual(after, before,
      "a plugin/vendor/quay-native/provider.yml-only change must invalidate the install fixture hash (AC1)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("AC1 — a probe-spec content change changes the hash (laid verbatim into plugin/probes/)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, "probes", "history-mining.md"), "# probe v2\n");
    const after = _pluginSurfaceHash(root);
    assert.notEqual(after, before,
      "a plugin/probes/*-only change must invalidate the install fixture hash (AC1)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("AC1 — a launch.settings.json content change changes the hash (laid verbatim into .claude/)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, ".claude", "launch.settings.json"), '{"model":"v2"}\n');
    const after = _pluginSurfaceHash(root);
    assert.notEqual(after, before,
      "a plugin/.claude/launch.settings.json-only change must invalidate the install fixture hash (AC1)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("AC1 — a profiles.yml content change changes the hash (laid verbatim into .quay/)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, ".quay", "profiles.yml"), "profiles: v2\n");
    const after = _pluginSurfaceHash(root);
    assert.notEqual(after, before,
      "a plugin/.quay/profiles.yml-only change must invalidate the install fixture hash (AC1)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("AC1 — a plugin.json version change changes the hash (READ for the plugin version)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), '{"version":"2.0.0"}\n');
    const after = _pluginSurfaceHash(root);
    assert.notEqual(after, before,
      "a plugin/.claude-plugin/plugin.json-only change must invalidate the install fixture hash (AC1)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("negative control — a plugin/agents/ change is NOT part of the hash (--loop does not lay --agents)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, "agents", "executor.md"), "# agent v2\n");
    const after = _pluginSurfaceHash(root);
    assert.equal(after, before,
      "a plugin/agents/* change must NOT change the hash (the fixture builds with --loop, which does not lay --agents)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("negative control — a plugin/.mcp.json change is NOT part of the hash (not read by quay-init --loop)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, ".mcp.json"), '{"quay":{"env":{}}}\n');
    const after = _pluginSurfaceHash(root);
    assert.equal(after, before,
      "a plugin/.mcp.json change must NOT change the hash (the plugin's own MCP registration is not read by --loop)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("stability — an unchanged tree hashes identically (the fixture-cache property)", () => {
  const root = makePluginShape();
  try {
    assert.equal(_pluginSurfaceHash(root), _pluginSurfaceHash(root),
      "the same tree must hash identically (fixture reuse across runs)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the REAL _fixtureHash() now covers the five new shipped classes (not an empty-set pass)", () => {
  for (const f of [
    "vendor/quay-native/provider.yml",
    ".claude/launch.settings.json",
    ".quay/profiles.yml",
    ".claude-plugin/plugin.json",
  ]) {
    assert.ok(fs.existsSync(path.join(pluginDir, f)), `precondition: plugin/${f} must exist`);
  }
  assert.ok(fs.existsSync(path.join(pluginDir, "probes")), "precondition: plugin/probes must exist");
  // The PRE-FIX root list (scripts + loop + workflows + .claude/workflows + skills/*/SKILL.md +
  // the vendored dist bundles + package.json — everything EXCEPT the five new classes). The real
  // production hash must differ because it now folds them in (not an empty-set pass).
  const preFixRoots = [
    path.join(pluginDir, "scripts"),
    path.join(pluginDir, "loop"),
    path.join(pluginDir, "workflows"),
    path.join(pluginDir, "..", ".claude", "workflows"),
  ];
  let skillDirs = [];
  try { skillDirs = fs.readdirSync(path.join(pluginDir, "skills"), { withFileTypes: true }); } catch { /* none */ }
  for (const d of skillDirs) {
    if (!d.isDirectory()) continue;
    const skill = path.join(pluginDir, "skills", d.name, "SKILL.md");
    if (fs.existsSync(skill)) preFixRoots.push(skill);
  }
  for (const b of ["vendor/quay/dist/quay.js", "vendor/quay-native/dist/quay-native.js"]) {
    const p = path.join(pluginDir, b);
    if (fs.existsSync(p)) preFixRoots.push(p);
  }
  const pkg = path.join(pluginDir, "package.json");
  if (fs.existsSync(pkg)) preFixRoots.push(pkg);
  const preFix = _hashOfRoots(preFixRoots, pluginDir);
  assert.notEqual(_fixtureHash(), preFix,
    "the production fixture hash must include the five new shipped classes (they were previously missed)");
});
