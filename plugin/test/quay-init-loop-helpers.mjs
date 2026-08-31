// @test-group engine
// quay-init-loop-helpers.mjs — the quay-init-loop family's remaining helpers + a thin re-export of
// the shared install fixture (now in plugin/test/helpers/quay-init-install-fixture.mjs).
//
// SPLIT (gap-suite-extend-shared-install-cache, 2026-08-30): the install-fixture machinery
// (sharedFixture / laydownTemplate / laydownWorkspace / makeTmp / cleanup / diskWorktreeRoot /
// runInit / _hashOfRoots / _fixtureHash / pluginDir) moved to
// plugin/test/helpers/quay-init-install-fixture.mjs so packages/quay/test can import it (the
// tmp-workspace.mjs cross-package precedent — no dependency-direction gate). This file re-exports
// that surface so every existing quay-init-loop family importer keeps working unchanged, and keeps
// the family-specific helpers that are NOT fixture machinery (extractRefs / declaredSet / the
// upgrade-channel dist-stale fixtures).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { makeTmp, pluginDir } from "./helpers/quay-init-install-fixture.mjs";

export {
  makeTmp,
  cleanup,
  diskWorktreeRoot,
  runInit,
  pluginDir,
  _hashOfRoots,
  _fixtureHash,
  _pluginSurfaceHash,
  sharedFixture,
  laydownTemplate,
  laydownWorkspace,
  sharedFixtureVariant,
  laydownVariantWorkspace,
} from "./helpers/quay-init-install-fixture.mjs";

// extractRefs(pluginRoot, prefix): every `<prefix>/<file>` reference in the shipped skills + tick
// docs — the SAME extraction quay-init.sh's verify_referenced_landed uses, so the test's landing
// assertion and the installer's own check cannot disagree about what the referenced set is.
export function extractRefs(pluginRoot, prefix) {
  const files = [];
  for (const d of fs.readdirSync(path.join(pluginRoot, "skills"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(pluginRoot, "skills", d.name, "SKILL.md");
    if (fs.existsSync(f)) files.push(f);
  }
  const loopDir = path.join(pluginRoot, "loop");
  for (const f of fs.readdirSync(loopDir)) {
    if (f.endsWith(".md")) files.push(path.join(loopDir, f));
  }
  const re = new RegExp(`(?:${prefix})/[a-zA-Z0-9._-]+`, "g");
  const refs = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    let m;
    while ((m = re.exec(text)) !== null) refs.add(m[0]);
  }
  return [...refs].sort();
}

// declaredSet(pluginRoot, kind): the machine-readable `<!-- <kind>: <path> -->` declarations in
// plugin/skills/init/SKILL.md — `self-create` (local-state files the first run creates, AC8) and
// `reference-doc` (quay-specific template prose, not a loop-mechanism deliverable).
export function declaredSet(pluginRoot, kind) {
  const skill = fs.readFileSync(path.join(pluginRoot, "skills", "init", "SKILL.md"), "utf8");
  const re = new RegExp(`<!-- ${kind}: ([a-zA-Z0-9._/-]+) -->`, "g");
  const set = new Set();
  let m;
  while ((m = re.exec(skill)) !== null) set.add(m[1]);
  return set;
}

// ── upgrade-channel dist-stale fixtures ────────────────────────────────────────────────────────────
// Moved here from quay-init-loop-vendor.test.mjs when it was split into per-scenario files
// (gap-suite-split-long-multi-test-files): every split file resolves the SAME fake-bundle + plugin-
// copy + source-tree fixtures, so the shared definitions live here (the quay-init-loop-helpers split
// pattern). The test BODIES are byte-identical to the original — only their file placement changed.

export const OLD_MTIME = 1000000000;  // 2001-09-09 (bundle built first)
export const NEW_MTIME = 2000000000;  // 2033-05-18 (source updated after — the git-pull state)

export function writeFakeBundles(src, coreContent, nativeContent) {
  const fakeDist = path.join(src, 'vendor', 'quay', 'dist', 'quay.js');
  fs.mkdirSync(path.dirname(fakeDist), { recursive: true });
  fs.writeFileSync(fakeDist, coreContent, 'utf8');
  const fakeNativeDist = path.join(src, 'vendor', 'quay-native', 'dist', 'quay-native.js');
  fs.mkdirSync(path.dirname(fakeNativeDist), { recursive: true });
  fs.writeFileSync(fakeNativeDist, nativeContent, 'utf8');
  fs.writeFileSync(path.join(src, 'vendor', 'quay-native', 'provider.yml'), 'id: native\nname: "quay-native"\n', 'utf8');
}

/** Read the version the vendored package.json declares (the AC4 version-freshness comparison
 * target). The test tracks the ACTUAL vendored version — it was hardcoded 0.3.13 when written,
 * and drifted when the vendored version advanced. */
export function readVendoredVersion(plugin) {
  const pkg = path.join(plugin, 'vendor', 'quay', 'package.json');
  const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
  assert.ok(typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version),
    `vendored package.json must declare a semver version (got ${JSON.stringify(data.version)})`);
  return data.version;
}

// makePluginCopy: a plugin copy at <parent>/plugin whose SIBLING packages tree (<parent>/packages)
// is PER-TEST unique — the AC1 stale check resolves $PLUGIN_ROOT/../packages relative to the
// plugin root, so a shared sibling (plain /tmp) would leak a source tree between tests.
export function makePluginCopy() {
  const parent = makeTmp('upg-src-');
  const plugin = path.join(parent, 'plugin');
  fs.cpSync(pluginDir, plugin, { recursive: true });
  return { parent, plugin };
}

// writeSrcTree(parent, coreMtime, nativeMtime): the dev source tree lives at <parent>/packages/*/src
// (PLUGIN_ROOT = <parent>/plugin, so $PLUGIN_ROOT/../packages = <parent>/packages).
export function writeSrcTree(parent, coreMtime, nativeMtime) {
  const coreSrc = path.join(parent, 'packages', 'quay', 'src');
  fs.mkdirSync(coreSrc, { recursive: true });
  const v = path.join(coreSrc, 'version.ts');
  fs.writeFileSync(v, '// version\n', 'utf8');
  fs.utimesSync(v, NEW_MTIME, coreMtime);
  const nativeSrc = path.join(parent, 'packages', 'quay-native', 'src');
  fs.mkdirSync(nativeSrc, { recursive: true });
  const m = path.join(nativeSrc, 'manifest.ts');
  fs.writeFileSync(m, '// manifest\n', 'utf8');
  fs.utimesSync(m, NEW_MTIME, nativeMtime);
}
