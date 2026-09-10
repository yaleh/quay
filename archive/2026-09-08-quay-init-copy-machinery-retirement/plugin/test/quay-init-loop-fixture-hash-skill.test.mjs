// @test-group engine
// quay-init-loop-fixture-hash-skill.test.mjs — gap-fixture-hash-omits-skill-md.
//
// The shared install fixture (quay-init-install-fixture sharedFixture) is content-addressed by
// _fixtureHash() over the plugin surface. It walked plugin/scripts + loop + skills/init + the
// shipped workflows + the vendored bundles + package.json but MISSED the 12 non-init shipped
// skills' SKILL.md. The install reads the FULL glob skills/*/SKILL.md (the script-laydown
// derivation + the referenced ⊆ landed check), so a declaration/reference change in ANY shipped
// skill must invalidate the fixture. init was hashed alone before, so e.g. a manager-SKILL.md
// SPEC-index change reused a stale fixture and install-config-driven-e2e-upgrade went red
// (referenced-not-landed).
//
// These tests pin the coverage with temp plugin-shaped fixtures: a non-init SKILL.md content change
// MUST change the hash (and init must keep doing so — regression), while a reference/ subdir change
// (not read by the install) must NOT. The last test asserts the REAL production _fixtureHash()
// covers the full skills surface, not just init (not an empty-set pass).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _pluginSurfaceHash, _fixtureHash, _hashOfRoots, pluginDir } from "./quay-init-loop-helpers.mjs";

// A minimal plugin-shaped fixture — the temp-roots analog of the real plugin surface: scripts/ +
// several skills/*/SKILL.md (the surfaces the hash must cover) + a reference/ subdir to prove it is
// NOT swept in (the install reads only skills/*/SKILL.md, one level).
function makePluginShape() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qih-skill-"));
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "a.sh"), "#!/usr/bin/env bash\necho a\n");
  for (const skill of ["init", "manager", "quay-native-methodology"]) {
    fs.mkdirSync(path.join(root, "skills", skill), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", skill, "SKILL.md"), `${skill} v1\n`);
  }
  // A reference/ subdir file — NOT read by the install (the glob is skills/*/SKILL.md), so it must
  // be out of the hash's scope.
  fs.mkdirSync(path.join(root, "skills", "quay-native-methodology", "reference"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "quay-native-methodology", "reference", "patterns.md"), "patterns v1\n");
  return root;
}

test("AC1 — a NON-init skill's SKILL.md content change changes the hash (manager/SKILL.md, previously missed)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, "skills", "manager", "SKILL.md"), "manager v2\n");
    const after = _pluginSurfaceHash(root);
    assert.notEqual(after, before,
      "a skills/manager/SKILL.md-only change must invalidate the install fixture hash (AC1)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("AC1 regression — an init SKILL.md content change still changes the hash (init was always covered)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, "skills", "init", "SKILL.md"), "init v2\n");
    const after = _pluginSurfaceHash(root);
    assert.notEqual(after, before,
      "a skills/init/SKILL.md change must still change the hash (existing behavior preserved)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("negative control — a skills/*/reference/ change is NOT part of the hash (only SKILL.md is read)", () => {
  const root = makePluginShape();
  try {
    const before = _pluginSurfaceHash(root);
    fs.writeFileSync(path.join(root, "skills", "quay-native-methodology", "reference", "patterns.md"), "patterns v2\n");
    const after = _pluginSurfaceHash(root);
    assert.equal(after, before,
      "a skills/*/reference/ change must NOT change the hash (the install reads only skills/*/SKILL.md)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("stability — an unchanged tree hashes identically (the fixture-cache property)", () => {
  const root = makePluginShape();
  try {
    assert.equal(_pluginSurfaceHash(root), _pluginSurfaceHash(root),
      "the same tree must hash identically (fixture reuse across runs)");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the REAL _fixtureHash() now covers the full skills surface, not just init (not an empty-set pass)", () => {
  assert.ok(fs.existsSync(path.join(pluginDir, "skills", "manager", "SKILL.md")),
    "precondition: plugin/skills/manager/SKILL.md must exist");
  assert.ok(fs.existsSync(path.join(pluginDir, "skills", "cold-start", "SKILL.md")),
    "precondition: plugin/skills/cold-start/SKILL.md must exist");
  // The OLD root list (init skill alone) + the vendored bundles + package.json — the pre-fix
  // production hash. The real production hash must differ because it now folds in the 12 sibling
  // skills' SKILL.md (not an empty-set pass).
  const initOnlyRoots = [
    path.join(pluginDir, "scripts"),
    path.join(pluginDir, "loop"),
    path.join(pluginDir, "skills", "init"),
    path.join(pluginDir, "workflows"),
    path.join(pluginDir, "..", ".claude", "workflows"),
  ];
  for (const b of ["vendor/quay/dist/quay.js", "vendor/quay-native/dist/quay-native.js"]) {
    const p = path.join(pluginDir, b);
    if (fs.existsSync(p)) initOnlyRoots.push(p);
  }
  const pkg = path.join(pluginDir, "package.json");
  if (fs.existsSync(pkg)) initOnlyRoots.push(pkg);
  const initOnly = _hashOfRoots(initOnlyRoots, pluginDir);
  assert.notEqual(_fixtureHash(), initOnly,
    "the production fixture hash must include the sibling skills' SKILL.md (they were previously missed)");
});
