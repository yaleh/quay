// @test-group engine
// slot-refill-heartbeat.test.mjs — the tick heartbeat MUST unconditionally run slot-refill
// (tasks/gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat).
//
// The mechanism bug this pins: slot-refill was ONLY evaluated on <task-notification> COMPLETION
// events — a long-running task holding the only subagent left free slots invisible to the
// mechanism (manager mechanism-self-evidence 2026-08-06: in_flight=1 / slots_free=2 /
// should_refill=true / recommended non-empty, 34 min zero dispatch; the doc's line-83 negative
// control "no completion event = no dispatch evaluation" wrote the defect as correct behavior).
//
// Fix (fast-mode-loop-tick.md, the SOURCE OF TRUTH the inner follows each tick):
//   AC1  the tick heartbeat (every tick, incl. light touch) MUST unconditionally run slot-refill
//        and act on the result (should_refill=true + recommended non-empty ⇒ dispatch) — the
//        completion event is an ACCELERATOR, not the sole trigger.
//   AC4  the negative control is corrected: "no completion event AND no heartbeat arrived" =
//        zero dispatch; the heartbeat must ask every tick (only no-recommended /
//        should_refill=false = no dispatch).
//   AC2  the deployed copy (the template laid down under docs/analysis) is synced with the template —
//        the Contract measure greps it for the slot-refill invocation (band >= 1).
//
// This is a DOC-CONTRACT test (the behavior is the doc the inner mechanically follows), not a
// slot-refill.ts logic test — the helper's decision logic is already covered by
// plugin/test/slot-refill.test.mjs (node:test + @test-group engine).
//
// Run: scripts/test.sh plugin/test/slot-refill-heartbeat.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const templatePath = path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md");

test("template (source of truth) exists and carries the slot-refill invocation (AC1/measure)", () => {
  const template = fs.readFileSync(templatePath, "utf8");
  assert.match(template, /slot-refill\.ts/, "the tick doc must contain the slot-refill invocation command");
  // The heartbeat path must REQUIRE the tick heartbeat to run it unconditionally, on the SAME
  // line as the slot-refill command (step 4 + line 83).
  const heartbeatLines = template.split("\n").filter((l) => l.includes("tick 心跳") && l.includes("slot-refill"));
  assert.ok(heartbeatLines.length >= 1, "a line must tie the tick heartbeat to the slot-refill invocation");
  assert.ok(heartbeatLines.some((l) => l.includes("无条件")),
    "the tick-heartbeat slot-refill must be UNCONDITIONAL (not gated on a completion event)");
  // Completion event framed as the ACCELERATOR, not the sole trigger.
  assert.match(template, /完成事件（加速源）/, "completion event must be framed as the accelerating trigger source");
});

test("negative control corrected: no completion AND no heartbeat = zero dispatch (AC4)", () => {
  const template = fs.readFileSync(templatePath, "utf8");
  // The stale negative control — "no completion event = no dispatch evaluation" — must be gone.
  assert.ok(!template.includes("没有完成事件就没有派发评估"),
    "the stale negative control '没有完成事件就没有派发评估' must be removed");
  // The corrected negative control requires BOTH triggers absent.
  assert.match(template, /没有完成事件、且 tick 心跳没到/,
    "zero-dispatch must require no completion event AND no tick heartbeat");
});

test("deployed copy is synced with the template for the slot-refill wording (AC2/Contract measure)", () => {
  const deployedPath = path.join(repoRoot, "docs", "analysis", "fast-mode-loop-tick.md");
  if (!fs.existsSync(deployedPath)) {
    // The deployed copy is a quay-init laydown (runtime artifact; a bare plugin checkout may not
    // have it). When present it MUST carry the slot-refill wording — the Contract measure greps it.
    return;
  }
  const deployed = fs.readFileSync(deployedPath, "utf8");
  assert.match(deployed, /slot-refill\.ts/, "deployed copy must contain the slot-refill invocation (Contract measure band >= 1)");
  assert.ok(!deployed.includes("没有完成事件就没有派发评估"),
    "deployed copy must not carry the stale negative control");
});
