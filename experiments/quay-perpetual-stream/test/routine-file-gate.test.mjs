// @test-group engine
// Tests for routine-file-gate.mjs — DIR-051 mechanical quality/dedup/rate gate. RED-first.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findingKey, isActionable, gateFinding, boardKeys, DEFAULT_RATE, main } from "../scripts/routine-file-gate.ts";

const actionable = "## Finding\nrolling-slope-check.mjs windowSlope returns NaN when deltas=[]; repro `node scripts/rolling-slope-check.mjs x.json` exit 2.\n## Requested action\nfix";
const vague = "## Finding\nthe code could be cleaner\n## Requested action\nimprove";

test("isActionable: a real finding with evidence passes; a vague one fails", () => {
  assert.equal(isActionable(actionable), true);
  assert.equal(isActionable(vague), false);
  assert.equal(isActionable("## Proposal\nno finding section"), false);
});

test("gateFinding: rejects vague (quality), duplicate (dedup), over-rate (rate); accepts a good novel one", () => {
  assert.equal(gateFinding(vague).accept, false);
  assert.match(gateFinding(vague).reason, /quality/);
  const key = findingKey(actionable);
  assert.equal(gateFinding(actionable, { existingKeys: [key] }).accept, false); // dedup
  assert.match(gateFinding(actionable, { existingKeys: [key] }).reason, /dedup/);
  assert.equal(gateFinding(actionable, { recentCount: 3, K: 3 }).accept, false); // rate
  assert.match(gateFinding(actionable, { recentCount: 3, K: 3 }).reason, /rate/);
  assert.equal(gateFinding(actionable, { existingKeys: [], recentCount: 0, K: 3 }).accept, true);
});

test("boardKeys: gathers finding keys from a board dir; dedup catches a re-file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-"));
  fs.writeFileSync(path.join(dir, "TASK-1.md"), actionable);
  const keys = boardKeys(dir);
  assert.equal(keys.has(findingKey(actionable)), true);
  assert.equal(gateFinding(actionable, { existingKeys: keys }).accept, false); // already filed
  fs.rmSync(dir, { recursive: true, force: true });
});

test("main: good finding → exit 0; vague → exit 1 (rejected); missing → exit 2", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-"));
  const good = path.join(dir, "good.md"); fs.writeFileSync(good, actionable);
  const bad = path.join(dir, "bad.md"); fs.writeFileSync(bad, vague);
  assert.equal(await main(["node", "s", good]), 0);
  assert.equal(await main(["node", "s", bad]), 1);
  assert.equal(await main(["node", "s", path.join(dir, "nope.md")]), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
