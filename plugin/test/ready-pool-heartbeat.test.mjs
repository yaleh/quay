// @test-group governance
// ready-pool-heartbeat.test.mjs — the tick heartbeat MUST unconditionally run ready-pool-check and
// apply the pool<floor promotions (tasks/gap-ready-pool-promotion-same-class-as-slot-refill).
//
// The mechanism bug this pins: fast-mode-loop-tick.md step 3.6 ("就绪池 < floor ⇒ 本 tick 补晋") was a
// FORCED prose step whose execution depended on the inner's volition — pool=5 < floor sustained ~3h
// with ready-pool-check recommending 7 promotions and nothing mechanically guaranteed to ask it
// (manager mechanism-self-evidence 2026-08-06). SAME root cause as
// gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat (a detector answers, nothing
// mechanically guarantees the tick asks it) — this is the SECOND instance of that root cause.
//
// Fix (fast-mode-loop-tick.md, the SOURCE OF TRUTH the inner follows each tick):
//   AC1  the tick heartbeat (every tick, incl. light touch) MUST unconditionally run
//        ready-pool-check.ts --apply — pool < floor && promotions non-empty ⇒ the promotion LANDS ON
//        DISK (status todo → ready), no volition.
//   AC3  negative control: pool ≥ floor OR promotions empty ⇒ no promotion (no busy-work).
//   AC2  the deployed copy (the template laid down under docs/analysis) carries the --apply wording.
//
// This is a DOC-CONTRACT test (the behavior is the doc the inner mechanically follows), not a
// ready-pool-check.ts logic test — the apply-mode logic is covered by
// plugin/test/ready-pool-check.test.mjs (node:test + @test-group governance).
//
// Run: scripts/test.sh plugin/test/ready-pool-heartbeat.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const templatePath = path.join(repoRoot, "plugin", "loop", "fast-mode-loop-tick.md");

test("template (source of truth) carries the ready-pool-check --apply heartbeat invocation (AC1/measure)", () => {
  const template = fs.readFileSync(templatePath, "utf8");
  // The heartbeat command must be the --apply form (lands promotions on disk).
  assert.match(template, /ready-pool-check\.ts[^\n]*--apply/, "the tick doc must carry the --apply heartbeat invocation");
  // The heartbeat path must be UNCONDITIONAL (every tick, incl. light touch) — not gated on an event.
  const heartbeatLines = template.split("\n").filter((l) => l.includes("tick 心跳") && l.includes("ready-pool-check"));
  assert.ok(heartbeatLines.length >= 1, "a line must tie the tick heartbeat to the ready-pool-check invocation");
  assert.ok(heartbeatLines.some((l) => l.includes("无条件")), "the tick-heartbeat ready-pool-check must be UNCONDITIONAL");
  // Same-root-cause cross-reference (AC2): this is the second instance of the slot-refill root cause.
  assert.match(template, /gap-slot-refill-only-triggered-on-completion-not-tick-heartbeat/, "cross-reference to the slot-refill same-root-cause instance");
});

test("negative control: pool ≥ floor OR promotions empty ⇒ no promotion (AC3)", () => {
  const template = fs.readFileSync(templatePath, "utf8");
  // The step-3.6 mechanism must state the no-busy-work negative control.
  assert.match(template, /pool ≥ floor 或 promotions 空/, "no-promotion must cover pool ≥ floor OR promotions empty");
  assert.match(template, /零写入/, "the no-promotion case must be zero writes");
});

test("deployed copy carries the ready-pool-check --apply wording (AC2/Contract measure)", () => {
  const deployedPath = path.join(repoRoot, "docs", "analysis", "fast-mode-loop-tick.md");
  if (!fs.existsSync(deployedPath)) {
    // The deployed copy is a quay-init laydown (runtime artifact; a bare plugin checkout may not
    // have it). When present it MUST carry the --apply wording — the Contract measure greps it.
    return;
  }
  const deployed = fs.readFileSync(deployedPath, "utf8");
  assert.match(deployed, /ready-pool-check\.ts[^\n]*--apply/, "deployed copy must contain the --apply invocation (Contract measure band >= 1)");
  assert.match(deployed, /pool ≥ floor 或 promotions 空/, "deployed copy must carry the negative control wording");
});
