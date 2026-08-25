// @test-group lowconc
// @load-sensitive real-install
// KNOWN-LOAD-SENSITIVE (real-install e2e — each test spawns a real quay-init.sh → python3 children).
// quay-init-loop-vendor-user-scope-fresh.test.mjs — split out of quay-init-loop-vendor.test.mjs
// (gap-suite-split-long-multi-test-files): AC4 — a user-scope dist whose embedded version MATCHES the
// vendored package.json is NOT flagged stale. Test body byte-identical to the original.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeTmp, cleanup, runInit, writeFakeBundles, makePluginCopy, readVendoredVersion,
} from "./quay-init-loop-helpers.mjs";

test('AC4 — a user-scope dist whose embedded version MATCHES the vendored package.json is NOT flagged stale', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    const declared = readVendoredVersion(plugin);
    writeFakeBundles(plugin, `console.log("${declared}")\n`, '// native bundle\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /STALE \(user-scope vendor runtime\)/, 'a version-consistent user-scope dist must NOT be flagged stale');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});
