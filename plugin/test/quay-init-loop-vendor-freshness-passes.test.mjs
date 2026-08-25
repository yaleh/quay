// @test-group lowconc
// @load-sensitive real-install
// KNOWN-LOAD-SENSITIVE (real-install e2e — each test spawns a real quay-init.sh → python3 children).
// quay-init-loop-vendor-freshness-passes.test.mjs — split out of quay-init-loop-vendor.test.mjs
// (gap-suite-split-long-multi-test-files): AC2 — a target runtime that MATCHES the plugin's current
// vendored bundle passes the freshness verify. Test body byte-identical to the original.

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTmp, cleanup, runInit, writeFakeBundles, makePluginCopy } from "./quay-init-loop-helpers.mjs";

test('AC2 — a target runtime that MATCHES the plugin\'s current vendored bundle passes the freshness verify', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// current core\n', '// current native\n');
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed:\n${r.stderr}`);
      assert.match(r.stdout, /verify-provider-runtime-freshness: OK/, 'the freshness verify must report OK when the laid runtime matches the plugin bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});
