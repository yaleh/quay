// @test-group engine
// quay-init-loop-fixture-hash.test.mjs — gap-fixture-hash-omits-workflows-dirs.
//
// The shared install fixture (quay-init-loop-helpers sharedFixture) is content-addressed by
// _fixtureHash() over the plugin surface. It walked plugin/scripts + loop + skills/init + the
// vendored bundles + package.json but MISSED the workflow dirs (.claude/workflows at the repo root
// AND plugin/workflows). A workflow-only change (e.g. fan-in-execute.js — the high-frequency
// suite-optimization touch point) left the hash unchanged, so the STALE fixture was reused, and
// real-target-verify compared the fixture's old workflow bytes against the current plugin → a false
// would-conflict (occurrence 2/日 2026-08-17: ec434eb8, gap-fan-in-turn-budget-suite-timeout; both
// papered over by manually deleting /var/tmp fixtures).
//
// These tests pin the coverage with temp fixture inputs (the byte-difference simulation the AC
// asks for): a workflow-file content change MUST change the hash, in EITHER workflow root, while an
// unchanged tree stays stable and non-workflow changes keep working. The last test asserts the REAL
// production _fixtureHash() now covers the workflow roots (not an empty-set pass).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _hashOfRoots, _fixtureHash, pluginDir } from "./quay-init-loop-helpers.mjs";

// A minimal plugin-shaped fixture — the temp-roots analog of the real plugin surface: scripts/ +
// workflows/ + .claude/workflows/ (the two workflow roots the hash previously missed) + a
// non-workflow .claude/skills/ dir to prove the whole .claude/ tree is NOT swept in.
function makePluginShape() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qih-hash-"));
  for (const sub of ["scripts", "workflows", ".claude/workflows", ".claude/skills"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "scripts", "a.sh"), "#!/usr/bin/env bash\necho a\n");
  fs.writeFileSync(path.join(root, "workflows", "fan-in-execute.js"), "// workflow v1\n");
  fs.writeFileSync(path.join(root, ".claude", "workflows", "fan-in-execute.js"), "// workflow v1\n");
  fs.writeFileSync(path.join(root, ".claude", "skills", "SKILL.md"), "local skill\n");
  return root;
}

// The two workflow roots + the existing roots, mirroring _fixtureHash()'s real root list.
function rootsOf(root) {
  return [
    path.join(root, "scripts"),
    path.join(root, "workflows"),
    path.join(root, ".claude", "workflows"),
  ];
}

test("AC1 — a plugin/workflows-only content change changes the hash (the shipped copy, previously missed)", () => {
  const root = makePluginShape();
  try {
    const before = _hashOfRoots(rootsOf(root), root);
    fs.writeFileSync(path.join(root, "workflows", "fan-in-execute.js"), "// workflow v2\n");
    const after = _hashOfRoots(rootsOf(root), root);
    assert.notEqual(after, before,
      "a plugin/workflows-only change must invalidate the install fixture hash (AC1)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("AC1 — a repo-root .claude/workflows-only content change changes the hash (the live dual-copy source)", () => {
  const root = makePluginShape();
  try {
    const before = _hashOfRoots(rootsOf(root), root);
    fs.writeFileSync(path.join(root, ".claude", "workflows", "fan-in-execute.js"), "// live workflow v2\n");
    const after = _hashOfRoots(rootsOf(root), root);
    assert.notEqual(after, before,
      "a .claude/workflows-only change must change the hash (the live copy is a workflow root)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("negative control — .claude/ non-workflow files are NOT part of the hash (only the workflows dir)", () => {
  const root = makePluginShape();
  try {
    const before = _hashOfRoots(rootsOf(root), root);
    fs.writeFileSync(path.join(root, ".claude", "skills", "SKILL.md"), "local skill v2\n");
    const after = _hashOfRoots(rootsOf(root), root);
    assert.equal(after, before,
      "a .claude/skills change must NOT change the hash (only workflows-related files are in scope)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("AC1 — non-workflow changes still change the hash (existing behavior preserved)", () => {
  const root = makePluginShape();
  try {
    const before = _hashOfRoots(rootsOf(root), root);
    fs.writeFileSync(path.join(root, "scripts", "a.sh"), "#!/usr/bin/env bash\necho b\n");
    const after = _hashOfRoots(rootsOf(root), root);
    assert.notEqual(after, before, "a scripts change must still change the hash");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("stability — an unchanged tree hashes identically (the fixture-cache property)", () => {
  const root = makePluginShape();
  try {
    assert.equal(_hashOfRoots(rootsOf(root), root), _hashOfRoots(rootsOf(root), root),
      "the same tree must hash identically (fixture reuse across runs)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the REAL _fixtureHash() now covers the workflow roots (not an empty-set pass)", () => {
  // Both workflow roots must exist in the real plugin layout...
  assert.ok(fs.existsSync(path.join(pluginDir, "workflows")),
    "precondition: plugin/workflows must exist");
  assert.ok(fs.existsSync(path.join(pluginDir, "..", ".claude", "workflows")),
    "precondition: repo-root .claude/workflows must exist");
  // ...and adding them to the root list must change the production digest — i.e. the shipped
  // fixture hash is NOT the old (workflow-blind) hash.
  const rootsWithoutWorkflows = [
    path.join(pluginDir, "scripts"),
    path.join(pluginDir, "loop"),
    path.join(pluginDir, "skills", "init"),
  ];
  const without = _hashOfRoots(rootsWithoutWorkflows, pluginDir);
  assert.notEqual(_fixtureHash(), without,
    "the production fixture hash must include the workflow dirs (they were previously missed)");
});
