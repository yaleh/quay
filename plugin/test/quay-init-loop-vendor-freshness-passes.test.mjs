// @test-group engine
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
      // gap-quay-init-escalations-vendor-freshness-false-positive: a declared self-create
      // (orchestration/escalations.md is declared at init/SKILL.md:143) must never be false-positived
      // as referenced-not-landed. The full install above would have exited non-zero on that false
      // positive, so this assertion is a redundant-but-explicit pin of the gap's subject.
      assert.doesNotMatch(r.stderr, /referenced-not-landed/, 'a declared self-create must not be reported as referenced-not-landed');
    } finally { cleanup(ws); }
  } finally { cleanup(parent); }
});
