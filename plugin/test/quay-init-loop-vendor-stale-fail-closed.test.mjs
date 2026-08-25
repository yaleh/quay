// @test-group lowconc
// @load-sensitive real-install
// KNOWN-LOAD-SENSITIVE (real-install e2e — each test spawns a real quay-init.sh → python3 children).
// quay-init-loop-vendor-stale-fail-closed.test.mjs — split out of quay-init-loop-vendor.test.mjs
// (gap-suite-split-long-multi-test-files): AC1 — a STALE vendored dist whose auto-rebuild cannot
// produce the bundles FAILS CLOSED (no complete). Test body byte-identical to the original.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  makeTmp, cleanup, runInit, OLD_MTIME, NEW_MTIME,
  writeFakeBundles, makePluginCopy, writeSrcTree,
} from "./quay-init-loop-helpers.mjs";

test('AC1 — a STALE vendored dist whose auto-rebuild cannot produce the bundles FAILS CLOSED (no complete)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// stale core v1\n', '// stale native v1\n');
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, OLD_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, OLD_MTIME);
    writeSrcTree(parent, NEW_MTIME, NEW_MTIME);
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, `#!/usr/bin/env bash
PLUGIN="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
rm -f "$PLUGIN/vendor/quay/dist/quay.js" "$PLUGIN/vendor/quay-native/dist/quay-native.js"
echo "[stub sync-vendor] rebuild failed" >&2
exit 1
`, 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.notEqual(r.status, 0, 'quay-init must FAIL CLOSED when the stale auto-rebuild cannot produce the bundles');
      assert.match(r.stderr, /vendor runtime STALE/, 'must report the STALE state before the fail-closed');
      assert.doesNotMatch(r.stdout, /quay-init complete/, 'must NOT report complete with a stale/missing runtime');
      assert.match(r.stderr, /FAILS CLOSED/, 'must state the fail-closed resolution');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});
