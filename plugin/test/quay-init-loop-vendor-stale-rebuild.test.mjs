// @test-group engine
// @load-sensitive real-install
// KNOWN-LOAD-SENSITIVE (real-install e2e — each test spawns a real quay-init.sh → python3 children).
// quay-init-loop-vendor-stale-rebuild.test.mjs — split out of quay-init-loop-vendor.test.mjs
// (gap-suite-split-long-multi-test-files): AC1 — a STALE vendored dist (source mtime > dist mtime)
// with a working auto-rebuild makes quay-init AUTO-REBUILD and lay the fresh runtime. Test body
// byte-identical to the original; only its file placement changed so node:test's file-level
// concurrency can parallelize the sequential real-install scenarios.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  makeTmp, cleanup, runInit, OLD_MTIME, NEW_MTIME,
  writeFakeBundles, makePluginCopy, writeSrcTree,
} from "./quay-init-loop-helpers.mjs";

test('AC1 — when the vendored dist is STALE (source mtime > dist mtime) and auto-rebuild works, quay-init AUTO-REBUILDS and lays the fresh runtime (AC3 B-machine scenario)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// stale core v1\n', '// stale native v1\n');
    // Dist bundles are OLD; source files are NEW → the exact state a git pull leaves (new src, gitignored dist not rebuilt).
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, OLD_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, OLD_MTIME);
    writeSrcTree(parent, NEW_MTIME, NEW_MTIME);
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, `#!/usr/bin/env bash
PLUGIN="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$PLUGIN/vendor/quay/dist" "$PLUGIN/vendor/quay-native/dist"
printf '// rebuilt core\\n' > "$PLUGIN/vendor/quay/dist/quay.js"
printf '// rebuilt native\\n' > "$PLUGIN/vendor/quay-native/dist/quay-native.js"
echo "[stub sync-vendor] rebuilt"
`, 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `quay-init must succeed after the stale auto-rebuild:\n${r.stderr}`);
      assert.match(r.stderr, /vendor runtime STALE/, 'must report the STALE state (AC1 negative control: pre-fix code only rebuilt on missing, never on stale)');
      assert.match(r.stderr, /auto-rebuilt STALE vendor runtime via sync-vendor\.sh/, 'must report the stale auto-rebuild (AC1)');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.ok(fs.existsSync(laid), 'the rebuilt Core runtime must be laid into the target');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// rebuilt core\n', 'the laid Core runtime must be the REBUILT bundle, not the stale one');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});
