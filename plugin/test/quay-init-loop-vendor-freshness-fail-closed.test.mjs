// @test-group lowconc
// @load-sensitive real-install
// KNOWN-LOAD-SENSITIVE (real-install e2e — each test spawns a real quay-init.sh → python3 children).
// quay-init-loop-vendor-freshness-fail-closed.test.mjs — split out of quay-init-loop-vendor.test.mjs
// (gap-suite-split-long-multi-test-files): AC2 — the referenced-runtime verify checks FRESHNESS: a
// target runtime that differs from the plugin's current vendored bundle FAILS CLOSED (stale-runtime).
// Test body byte-identical to the original.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTmp, cleanup, runInit, writeFakeBundles, makePluginCopy } from "./quay-init-loop-helpers.mjs";

test('AC2 — the referenced-runtime verify checks FRESHNESS: a target runtime that differs from the plugin\'s current vendored bundle FAILS CLOSED (stale-runtime)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// current core v2\n', '// current native v2\n');
    const ws = makeTmp();
    try {
      // Legacy-install config: the mcp_entry points at a NON-standard path the lay-down never
      // refreshes. The file EXISTS (so the existence check passes) but is a stale dist from an
      // older install — the freshness check must catch it.
      fs.mkdirSync(path.join(ws, '.quay'), { recursive: true });
      fs.mkdirSync(path.join(ws, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(ws, 'bin', 'quay.js'), '// stale legacy core v1\n', 'utf8');
      fs.writeFileSync(path.join(ws, '.quay', 'config.yml'),
        `providers:\n  native:\n    enabled: true\n    path: "${ws}/vendor/quay-native"\n    tasks_dir: "${ws}/tasks"\n    mcp_entry: ["node", "${ws}/bin/quay.js", "mcp"]\n`, 'utf8');
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.notEqual(r.status, 0, 'quay-init must FAIL CLOSED when the referenced runtime is a stale dist (freshness, not just existence)');
      assert.match(r.stdout, /verify-provider-runtime-existence: OK/, 'the referenced file EXISTS — the existence check passes (AC2: existence alone was the pre-fix verify)');
      assert.match(r.stderr, /stale-runtime/, 'the freshness check must name the stale-runtime failure');
      assert.match(r.stderr, /bin\/quay\.js/, 'must name the stale referenced runtime');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});
