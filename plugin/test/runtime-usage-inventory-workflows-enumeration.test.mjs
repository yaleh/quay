// @test-group engine
// runtime-usage-inventory-workflows-enumeration.test.mjs — gap-ac160-runtime-usage-inventory-blind-spot.
// The NAMED regression test pinned by goal AC-160's criterion: readTranscripts MUST enumerate the
// workflow-agent layer <session>/subagents/workflows/<run>/agent-*.jsonl. Hermetic fixture — the
// transcript below is planted ONLY in the workflows layer (there is NO direct subagents layer), so
// it carries the sole execution evidence for the synthetic script. A reader that only enumerates
// the direct subagents layer (the unfixed code) misses it entirely and this test goes RED.
//
// Run:
//   node --experimental-strip-types --test plugin/test/runtime-usage-inventory-workflows-enumeration.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildInventory } from "../scripts/runtime-usage-inventory.ts";

// Every synthetic-repo dir is removed once at the end of this file (the carrier-array + after()
// pattern) — a mkdtemp fixture without cleanup leaks a /tmp dir per run.
const _tmpDirs = [];
after(() => {
  for (const dir of _tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test("workflow-layer-only transcript is enumerated (executed > 0)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rui-ac160-"));
  _tmpDirs.push(tmp);
  const root = path.join(tmp, "repo");
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  // The known script whose ONLY execution evidence is planted in the workflows layer.
  fs.writeFileSync(path.join(root, "plugin", "scripts", "workflow-layer-only.ts"), "export const w = 1;\n");

  const sessions = path.join(tmp, "sessions");
  const sid = "wf-session";
  // Plant the transcript ONLY under <sid>/subagents/workflows/<run>/agent-*.jsonl — no direct
  // subagents layer, so a direct-layer-only reader (the unfixed code) misses it entirely.
  const agentDir = path.join(sessions, sid, "subagents", "workflows", "wf_run1");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "agent-workflow.jsonl"),
    JSON.stringify({ timestamp: "2026-09-03T12:00:00.000Z", type: "assistant", message: { content: [
      { type: "tool_use", name: "Bash", input: { command: "node plugin/scripts/workflow-layer-only.ts" } },
    ] } }) + "\n",
  );

  const since = "2026-09-03T00:00:00.000Z";
  const until = "2026-09-04T00:00:00.000Z";
  const inv = buildInventory(root, sessions, since, until, 72, { innerSessions: new Set([sid]) });
  const byRel = new Map(inv.scripts.map((s) => [s.relPath, s]));
  const script = byRel.get("plugin/scripts/workflow-layer-only.ts");
  assert.ok(script, "synthetic script enumerated");
  assert.equal(script.main.executed, 1, "workflow-layer transcript execution is counted (executed > 0)");
  assert.equal(script.class, "live", "workflow-layer-only script is live");
});
