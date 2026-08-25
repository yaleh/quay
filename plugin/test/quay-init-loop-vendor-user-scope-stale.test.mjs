// @test-group lowconc
// @load-sensitive real-install
// KNOWN-LOAD-SENSITIVE (real-install e2e — each test spawns a real quay-init.sh → python3 children).
// quay-init-loop-vendor-user-scope-stale.test.mjs — split out of quay-init-loop-vendor.test.mjs
// (gap-suite-split-long-multi-test-files): AC4 — a user-scope install cache (no packages/ source
// tree) whose dist embeds a DIFFERENT version than the vendored package.json is flagged STALE
// (prompt, not fail-closed). Test body byte-identical to the original.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeTmp, cleanup, runInit, writeFakeBundles, makePluginCopy, readVendoredVersion,
} from "./quay-init-loop-helpers.mjs";

test('AC4 — a user-scope install cache (no packages/ source tree) whose dist embeds a DIFFERENT version than the vendored package.json is flagged STALE (prompt, not fail-closed)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    // The dist bundle is runnable and echoes an OLD core version; the vendored package.json
    // (tracked in git, copied verbatim) declares the real version → version mismatch = stale.
    // No packages/ source tree exists here → the AC1 mtime check cannot fire, so the AC4 version
    // check owns it. The declared version is read from the copied plugin's vendor/package.json so
    // the test tracks the actual vendored version (was hardcoded 0.3.13; now 0.4.0).
    const declared = readVendoredVersion(plugin);
    // Make the fake embedded version unambiguously OLDER than declared (0.4.0 → 0.3.0): lower the
    // MINOR segment by 1 (patch is 0 at a version boundary, so decrementing patch alone would leave
    // 0.4.0 unchanged and the test would not be stale). The version-freshness check compares the
    // whole semver string, so any lower version is STALE.
    const dec = (v) => { const [maj, min, patch] = v.split('.'); return `${maj}.${String(Math.max(0, Number(min) - 1))}.${patch}`; };
    const embeddedStale = dec(declared);
    writeFakeBundles(plugin, `console.log("${embeddedStale}")\n`, '// native bundle\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, 'a stale user-scope runtime is a PROMPT, not a fail-closed (no source tree to rebuild from — AC4)');
      assert.match(r.stderr, /STALE \(user-scope vendor runtime\)/, 'must flag the user-scope stale dist (AC4 negative control: pre-fix treated the 06:01 dist as fresh)');
      assert.match(r.stderr, new RegExp(embeddedStale.replace(/\./g, '\\.')), 'must name the embedded stale version');
      assert.match(r.stderr, new RegExp(declared.replace(/\./g, '\\.')), 'must name the declared vendored version');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});
