// @test-group engine
// @load-sensitive real-install
// @load-sensitive-entry 2026-09-04 real quay-init --loop re-runs onto a fixture-laid workspace (install/quay-init family, same root cause as quay-init-loop-core)
// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族") — real-install e2e:
// each test spawns real `quay-init.sh --loop` re-runs (python3 children) into a fixture-laid workspace.
// The install/quay-init family rotated flakes across groups under full-suite load, so the whole
// family is consolidated into the concurrency-1 serial phase
// (gap-install-family-tests-rotate-flakes-under-full-suite).
// quay-init-conflict-state-hash.test.mjs — gap-quay-init-write-state-file-corrupts-hash-after-conflict:
// a CONFLICT-preserved user edit must NOT be re-hashed into .quay/quay-init-state.json laidFiles, or a
// zero-change next run mis-reads the edit as stale-installed and silently overwrites it (the pre-fix
// round 3 eats the edit without reporting CONFLICT). Reuses the shared install fixture (laydownWorkspace)
// for the round-1 install and re-runs quay-init --loop for rounds 2 and 3.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanup, runInit, laydownWorkspace } from "./quay-init-loop-helpers.mjs";

// quay-init.sh's write_state_file records laidFiles keys as POSIX rel paths (its python joins with
// "/"), so this key must stay "/"-joined regardless of host OS — expressed via path.posix.join.
const REL = path.posix.join("orchestration", "orchestrator-loop-tick.md");
const MARKER = "<!-- local customisation marker (gap-quay-init-write-state-file-corrupts-hash-after-conflict) -->";

function readLaidHash(ws) {
  const state = JSON.parse(fs.readFileSync(path.join(ws, ".quay", "quay-init-state.json"), "utf8"));
  return state.laidFiles?.[REL] ?? null;
}

test('AC3 — a CONFLICT-preserved edit keeps its laidFiles hash across rounds (round 3 does not silently eat it)', () => {
  const { ws, install: r1 } = laydownWorkspace();
  try {
    const args = ['--loop', '--root', ws, '--project', 'proj', '--test-command', 'node --test', '--tmux-session', 'proj-0:0.0'];
    assert.equal(r1.status, 0, `round 1 install must exit 0:\n${r1.stderr}`);
    const outerPath = path.join(ws, 'orchestration', 'orchestrator-loop-tick.md');
    const firstContent = fs.readFileSync(outerPath, 'utf8');

    // Round 1: the laid-down hash is the product content (before any edit).
    const h1 = readLaidHash(ws);
    assert.match(h1 ?? "", /^[0-9a-f]{64}$/, 'round 1 must record a sha256 laidFiles hash for the tick doc');

    // User edit: append a marker line (a genuine customization of a laid-down managed file).
    fs.writeFileSync(outerPath, firstContent + "\n" + MARKER + "\n", 'utf8');

    // Round 2: the edit is reported as CONFLICT and preserved; laidFiles keeps the product hash.
    const r2 = runInit(ws, args);
    assert.equal(r2.status, 0, `round 2 must exit 0:\n${r2.stderr}`);
    assert.match(r2.stdout, /CONFLICT/, 'round 2 must report CONFLICT for the edited tick doc');
    assert.ok(fs.readFileSync(outerPath, 'utf8').includes(MARKER), 'round 2 must preserve the edit');
    const h2 = readLaidHash(ws);
    assert.equal(h2, h1, 'round 2 must NOT re-hash the preserved edit into laidFiles (keeps the product hash)');

    // Round 3 (zero other changes): STILL CONFLICT + preserved — the pre-fix bug silently replaced
    // the edit here because round 2 had mis-recorded the edit as "laid".
    const r3 = runInit(ws, args);
    assert.equal(r3.status, 0, `round 3 must exit 0:\n${r3.stderr}`);
    assert.match(r3.stdout, /CONFLICT/, 'round 3 must STILL report CONFLICT (never silently overwritten)');
    assert.ok(fs.readFileSync(outerPath, 'utf8').includes(MARKER), 'round 3 must preserve the edit');
    const h3 = readLaidHash(ws);
    assert.equal(h3, h2, 'round 3 laidFiles hash must equal round 2 (unchanged by the disk edit)');
    assert.equal(h3, h1, 'the laidFiles hash stays pinned to the last actually-written product content');
  } finally { cleanup(ws); }
});
