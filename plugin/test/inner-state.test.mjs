// @test-group engine
// inner-state.test.mjs — gap-no-explicit-blocked-signal-from-inner-layer (AC6): the OUTER Monitor
// (orchestration/watch/inner-state.sh) must watch .quay/inner-blocked.json with inotifywait and
// emit events carrying `reason` + `question` — so the outer starts adjudicating in seconds, not
// after a 20-minute tick. Two layers of verification:
//   (a) source contract — inotifywait + the event format; and
//   (b) BEHAVIORAL — run the actual script's one-shot check_blocked_state seam
//       (INNER_STATE_BLOCK_ROOT + INNER_STATE_WORK_ROOT) against a temp workspace with a present
//       block → it emits the real `BLOCKED reason=… question=…` event line.
//
// Run:
//   scripts/test.sh plugin/test/inner-state.test.mjs
//   node --test plugin/test/inner-state.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function _findRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Cannot find repo root: no .quay/config.yml found upward from " + startDir);
}
const REPO_ROOT = _findRepoRoot(__dirname);
const MONITOR = path.join(REPO_ROOT, "orchestration", "watch", "inner-state.sh");

function makeTmpWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "inner-state-"));
}

function cleanup(tmpRoot) {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ── Source contract (AC6) ────────────────────────────────────────────────────────────────────────────

test("AC6 — inner-state.sh watches the block path with inotifywait and emits reason+question", () => {
  const script = fs.readFileSync(MONITOR, "utf8");
  assert.match(script, /inotifywait/, "monitor must use inotifywait (second-level latency, not a 20-min tick)");
  assert.match(script, /inner-blocked\.json/, "monitor must watch the block path");
  assert.match(script, /BLOCKED reason=/, "event must carry reason");
  assert.match(script, /question=/, "event must carry question");
  assert.match(script, /UNBLOCKED/, "monitor must also emit when the block clears");
});

// ── Behavioral: a present block emits the real BLOCKED event line ────────────────────────────────────

test("AC6 (behavioral) — a present inner-blocked.json makes the monitor emit BLOCKED with reason + question", () => {
  const tmp = makeTmpWorkspace();
  try {
    fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".quay", "inner-blocked.json"),
      JSON.stringify({ since: Date.now(), taskId: "gap-test", reason: "task-over-90m", question: "abort it?" }, null, 2) + "\n",
      "utf8",
    );
    // INNER_STATE_WORK_ROOT: the checkout that has plugin/scripts/inner-blocked-signal.ts (the
    // worktree pre-merge, the main checkout post-merge — either way REPO_ROOT resolves it).
    // INNER_STATE_BLOCK_ROOT: where the fake block lives.
    const res = spawnSync("bash", [MONITOR], {
      encoding: "utf8",
      env: {
        ...process.env,
        INNER_STATE_WORK_ROOT: REPO_ROOT,
        INNER_STATE_BLOCK_ROOT: tmp,
      },
    });
    assert.equal(res.status, 0, `one-shot mode should exit 0, got ${res.status}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /BLOCKED reason=task-over-90m/, `must emit BLOCKED with the reason: ${res.stdout}`);
    assert.match(res.stdout, /question=abort it\?/, `must emit BLOCKED with the question: ${res.stdout}`);
  } finally {
    cleanup(tmp);
  }
});
