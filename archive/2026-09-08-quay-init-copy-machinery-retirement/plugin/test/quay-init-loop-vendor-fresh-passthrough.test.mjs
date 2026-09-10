// @test-group engine
// @load-sensitive real-install
// KNOWN-LOAD-SENSITIVE (real-install e2e — each test spawns a real quay-init.sh → python3 children).
// quay-init-loop-vendor-fresh-passthrough.test.mjs — split out of quay-init-loop-vendor.test.mjs
// (gap-suite-split-long-multi-test-files): AC1 — a FRESH dist (dist mtime > source mtime) is NOT
// rebuilt (passes through untouched). Test body byte-identical to the original.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  makeTmp, cleanup, runInit, OLD_MTIME, NEW_MTIME,
  writeFakeBundles, makePluginCopy, writeSrcTree,
} from "./quay-init-loop-helpers.mjs";

test('AC1 — a FRESH dist (dist mtime > source mtime) is NOT rebuilt (passes through untouched)', () => {
  const { parent, plugin } = makePluginCopy();
  try {
    writeFakeBundles(plugin, '// fresh core\n', '// fresh native\n');
    fs.utimesSync(path.join(plugin, 'vendor', 'quay', 'dist', 'quay.js'), NEW_MTIME, NEW_MTIME);
    fs.utimesSync(path.join(plugin, 'vendor', 'quay-native', 'dist', 'quay-native.js'), NEW_MTIME, NEW_MTIME);
    writeSrcTree(parent, OLD_MTIME, OLD_MTIME);  // source OLDER than dist → fresh
    const syncStub = path.join(plugin, 'scripts', 'sync-vendor.sh');
    fs.writeFileSync(syncStub, '#!/usr/bin/env bash\necho "[stub sync-vendor] should NOT run"\nexit 1\n', 'utf8');
    fs.chmodSync(syncStub, 0o755);
    const ws = makeTmp();
    try {
      const r = runInit(ws, ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test',
        '--tmux-session', 'proj-0:0.0', '--plugin-root', plugin]);
      assert.equal(r.status, 0, `fresh dist must pass through without a rebuild:\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /STALE/, 'a fresh dist must NOT be reported stale');
      assert.doesNotMatch(r.stderr, /\[stub sync-vendor\] should NOT run/, 'sync-vendor.sh must NOT run for a fresh dist');
      const laid = path.join(ws, '.quay', 'runtime', 'bin', 'quay.js');
      assert.equal(fs.readFileSync(laid, 'utf8'), '// fresh core\n', 'the laid Core runtime must be the existing fresh bundle');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});
