// @test-group governance
// judgment-consumer-check.test.mjs — tasks/gap-judgment-computed-not-wired-to-action (AC2/AC3).
//
// Coverage map (task ACs):
//   AC2 — the class-level discipline "每个机械判据必须有消费它的动作" is made MECHANICAL by the
//         audit: the registry (judgment-consumer-check.ts) lists every audited judgment with the
//         action that consumes it, and the real-repo audit passes (all `wired` entries verify).
//   AC3 — the systematic audit "判据→消费动作" mapping: the real-repo audit lists the three 2026-08-10
//         instances (deficit / not-yet-flipped / self-touch-scan). self-touch-scan's candidate-backfill
//         consumer landed (gap-slot-refill-c8-reject-no-backfill 84a64047) so ALL judgments are wired
//         — no consumer listed unfinished (invariant no_consumer_listed_unfinished = 0).
//   AC4 — the negative control via --judge-entry: a judgment declared `wired` whose consumer pattern
//         is MISSING must exit 1 (the defect class: signal computed, no action wired); restoring the
//         consumer returns to exit 0. The unfinished-stale direction (fix-marker present while still
//         declared unfinished) must also exit 1.
//
// No global counts are hardcoded beyond the registry's own declared size — the assertions are
// relative to the real-repo registry and to ad-hoc --judge-entry fixtures.
//
// Run:
//   scripts/test.sh plugin/test/judgment-consumer-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/judgment-consumer-check.ts");

/** Run the checker against the REAL repo; returns the spawnSync result. */
function run(...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", REPO_ROOT, ...args],
    { encoding: "utf8" },
  );
}

/** Run --judge-entry against a temp fixture root (a `doc` path with `content`), returns { res, dir }. */
function judgeEntryFixture(entryJson, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "judgment-consumer-"));
  fs.mkdirSync(path.join(dir, "orchestration"), { recursive: true });
  fs.writeFileSync(path.join(dir, "orchestration", "orchestrator-tick-core.md"), content);
  const res = spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", dir, "--judge-entry", entryJson],
    { encoding: "utf8" },
  );
  return { res, dir };
}

const WIRED_ENTRY = JSON.stringify({
  judgment: "test-deficit",
  verify: [{ file: "orchestration/orchestrator-tick-core.md", pattern: "deficit\\s*>\\s*0", expect: "present" }],
  status: "wired",
});

test("AC2/AC3 — real-repo audit passes: 6 judgments, 6 wired, self-touch-scan now wired (backfill landed)", () => {
  const res = run("--json");
  assert.equal(res.status, 0, `real-repo audit must pass, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.mode, "judgment-consumer-audit");
  assert.equal(out.judgments_total, 6, `registry must have 6 audited judgments, got ${out.judgments_total}`);
  assert.equal(out.wired, 6, `6 judgments wired, got ${out.wired}`);
  assert.equal(out.drift, false, "no drift — every wired entry verifies its consumer");
  assert.equal(
    out.unfinished.length,
    0,
    `no-consumer judgment must be zero (self-touch-scan backfill landed), got ${JSON.stringify(out.unfinished)}`,
  );
});

test("AC3 — the registry lists the three 2026-08-10 instances with consumers (deficit / not-yet-flipped / self-touch-scan)", () => {
  const res = run("--list");
  assert.equal(res.status, 0, `--list must pass, got ${res.status}:\n${res.stderr}`);
  assert.match(res.stdout, /deficit/, "deficit (instance-3) must be in the registry");
  assert.match(res.stdout, /not-yet-flipped/, "not-yet-flipped (instance-1) must be in the registry");
  assert.match(res.stdout, /self-touch-scan/, "self-touch-scan (instance-2) must be in the registry");
  assert.match(res.stdout, /wired/, "the wired marker must be visible in --list");
  // every entry carries a consumer action (hasConsumer invariant).
  assert.match(res.stdout, /consumer:/, "every registry entry declares its consuming action");
});

test("AC3 — every wired entry verifies its consumer (each_judgment_has_consumer)", () => {
  const res = run("--json");
  const out = JSON.parse(res.stdout);
  const wiredEntries = out.entries.filter((e) => e.status === "wired");
  assert.ok(wiredEntries.length >= 4, `at least the 4 wired + dispatchable entries, got ${wiredEntries.length}`);
  for (const e of wiredEntries) {
    assert.equal(e.verified, true, `wired judgment must verify its consumer: ${e.judgment}`);
    assert.equal(e.hasConsumer, true, `wired judgment must declare a consumer: ${e.judgment}`);
    assert.equal(e.failures.length, 0, `wired judgment must have zero failures: ${e.judgment}`);
  }
});

test("AC4 negative control — a judgment declared wired whose consumer is MISSING exits 1", () => {
  // The consumer pattern is absent (the doc says the trigger was deleted) while the judgment is
  // still declared `wired` — the exact 2026-08-10 defect class (signal computed, no action wired).
  const { res, dir } = judgeEntryFixture(WIRED_ENTRY, "B9 触发器已删——没有 deficit 触发器了\n");
  try {
    assert.equal(res.status, 1, `wired-with-missing-consumer must exit 1, got ${res.status}:\n${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /VIOLATION/, "the violation must be named");
    assert.match(res.stdout, /expect:present got:absent/, "the failure must say the consumer is absent");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — restoring the consumer returns to exit 0 (wired verifies)", () => {
  const { res, dir } = judgeEntryFixture(
    WIRED_ENTRY,
    "B9 第三触发器：deficit > 0 ⇒ ready-pool-check --apply（恢复）\n",
  );
  try {
    assert.equal(res.status, 0, `wired-with-consumer-present must exit 0, got ${res.status}:\n${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /clean/, "the clean verdict must be named");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 — an unfinished judgment whose fix-marker is present (stale status) exits 1", () => {
  // A judgment declared `unfinished` whose expect-absent fix-marker IS present is stale drift —
  // the fix landed but the status was never flipped to wired.
  const staleEntry = JSON.stringify({
    judgment: "test-stale",
    verify: [{ file: "orchestration/orchestrator-tick-core.md", pattern: "backfill", expect: "absent" }],
    status: "unfinished",
  });
  const { res, dir } = judgeEntryFixture(staleEntry, "slot-refill 已接 backfill 回填逻辑\n");
  try {
    assert.equal(res.status, 1, `unfinished-with-fix-marker-present must exit 1 (stale status), got ${res.status}`);
    assert.match(res.stdout, /expect:absent got:present/, "the failure must say the fix-marker is present");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
