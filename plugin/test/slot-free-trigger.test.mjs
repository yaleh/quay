// @test-group engine
// slot-free-trigger.test.mjs — the empty-slot EVENT executor
// (tasks/gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace).
//
// PROBLEM: `in_flight < cap ∧ dispatchable > 0` (a freed dispatch slot + a dispatchable candidate)
// only gets evaluated at the three-layer 20-25 min tick boundaries; when the tick wakes there is
// always something more urgent (red suite / fan-in / needs-human), so refilling an empty slot is
// always LAST and a missed refill leaves no trace (C17). This test pins the PRODUCT mechanism: a
// Monitor trigger (modeled on suite-state-trigger.ts) that reads the EXISTING slot/pool state and
// turns the slot-free CONDITION into a `SLOT-FREE` event + `.quay/slot-free-events.jsonl` append,
// so the outer can drive the inner to refill immediately and a missed refill is attributable.
//
// Coverage map (task ACs):
//   AC1 — 复现固化: the task Proposal carries the field reading (在飞 1/空槽 4/可派 11) — verified
//         in the task file (fixture), not re-derived here.
//   AC2 — slot-free-trigger: `in_flight<cap ∧ dispatchable>0` ⇒ SLOT-FREE event (Monitor push +
//         events.jsonl). Reads --slots (slotsRemaining) + ready-pool-check (dispatchable_disjoint).
//   AC3 — outer 接事件回填: the orchestrator docs wire SLOT-FREE ⇒ 立即驱动 inner 回填; 漏回填在事件
//        日志可追责 (events.jsonl append-only + event.at timestamp).
//   AC4 — inner 醒来第一件事: fast-mode-loop-tick.md wires the <task-notification> wake to run
//         A11/A12/A13 + refill BEFORE fan-in/report.
//   AC5 — no new scheduler: the trigger is Monitor event monitoring (no CronCreate/ScheduleWakeup/
//         /loop); cadence stays the outer cron. Negative control: slot full / no dispatchable ⇒ no
//         SLOT-FREE. Halt suppression: `.halt` present ⇒ no event (the outer cannot act on it).
//   Contract invoke — `tail -3 .quay/slot-free-events.jsonl` (贴 SLOT-FREE 事件 + 时间戳); measure
//         `slot_free_event_fired` = tail -1 含 SLOT-FREE.
//   Catalog — slot-free-trigger.ts is DECLARED in capability-catalog.sh (entry gate: an undeclared
//         plugin/scripts entry makes the catalog exit non-zero).
//
// Run:
//   scripts/test.sh plugin/test/slot-free-trigger.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseSlotsOutput,
  parsePoolOutput,
  evaluateSlotFree,
  detectSlotFreeEvent,
  runOnce,
  readSlotFreeEvents,
} from "../scripts/slot-free-trigger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const TRIGGER = path.join(REPO_ROOT, "plugin/scripts/slot-free-trigger.ts");
const CATALOG = path.join(REPO_ROOT, "plugin/scripts/capability-catalog.sh");
const OUTER_TICK = path.join(REPO_ROOT, "plugin/loop/orchestrator-loop-tick.md");
const INNER_TICK = path.join(REPO_ROOT, "plugin/loop/fast-mode-loop-tick.md");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sft-root-"));
}

/** The task's field reading (manager 04:2x): 在飞 1 / 空槽 4 / 可派 11, cap 5. */
function freeState(over = {}) {
  return {
    halted: false,
    slotsRemaining: 4,
    dispatchable_disjoint: 11,
    effectiveCap: 5,
    realInFlight: 1,
    subagentsInFlight: 0,
    closedButLiveCount: 0,
    ...over,
  };
}

// ── AC1: 复现固化（任务体已含——主检出 tasks/ 正本；本 worktree 内由 trigger 头注释固化读数）────

test("AC1 — the trigger artifact carries the reproduced field reading (在飞 1/空槽 4/可派 11)", () => {
  // The task Proposal (main-checkout tasks/gap-slot-free-not-an-event-slots-stay-empty-missed-without-trace.md)
  // records the field reading; the trigger's header comment固化 it in the artifact so the reproduction
  // survives into the shipped mechanism (the worktree forked before the task file existed).
  const src = read(TRIGGER);
  assert.ok(src.includes("空槽 4"), "reproduced 空槽 4 (effectiveCap 5 − in-flight 1)");
  assert.ok(src.includes("可派 11"), "reproduced 可派 11 (dispatchable_disjoint)");
  assert.ok(src.includes("budgetHit=False"), "subagent-budget ceiling excluded (不是预算触顶)");
  assert.ok(src.includes("醒来后的第一件事"), "root cause: 缺的不是触发器，是醒来后的第一件事");
});

// ── AC2: slot-free-trigger 纯函数 ─────────────────────────────────────────────────

test("AC2 unit — parseSlotsOutput / parsePoolOutput read the existing mechanism JSON", () => {
  const slots = parseSlotsOutput(
    JSON.stringify({ slotsRemaining: 4, realInFlight: 1, subagentsInFlight: 0, closedButLive: [], slotsTotal: 5 }),
  );
  assert.equal(slots.slotsRemaining, 4);
  assert.equal(slots.realInFlight, 1);
  assert.deepEqual(slots.closedButLive, []);

  const pool = parsePoolOutput(JSON.stringify({ pool: 20, dispatchable_disjoint: 11 }));
  assert.equal(pool.dispatchable_disjoint, 11);
  assert.equal(pool.pool, 20);
});

test("AC2 unit — evaluateSlotFree: in_flight<cap ∧ dispatchable>0 is the SLOT-FREE condition", () => {
  // the manager's exact field reading: in-flight 1 < cap 5 ∧ dispatchable 11 > 0 ⇒ free
  assert.equal(evaluateSlotFree(4, 11, false), true, "空槽 4 + 可派 11 ⇒ free");
  // negative controls
  assert.equal(evaluateSlotFree(0, 11, false), false, "in_flight ≥ cap ⇒ not free");
  assert.equal(evaluateSlotFree(4, 0, false), false, "dispatchable 0 ⇒ not free");
  assert.equal(evaluateSlotFree(4, 11, true), false, "halted ⇒ not free (the outer cannot act on it)");
});

test("AC2 unit — detectSlotFreeEvent is a pure transition detector (false→true fires, true→false is calm)", () => {
  assert.equal(detectSlotFreeEvent(false, true), "SLOT-FREE");
  assert.equal(detectSlotFreeEvent(null, true), "SLOT-FREE", "cold-start-into-free fires immediately");
  assert.equal(detectSlotFreeEvent(true, true), null, "stays free ⇒ no re-fire (no spam)");
  assert.equal(detectSlotFreeEvent(true, false), null, "filled ⇒ calm (the refill worked)");
  assert.equal(detectSlotFreeEvent(null, false), null, "cold-start-into-full ⇒ no event");
});

test("AC2 — runOnce fires SLOT-FREE on the in_flight<cap ∧ dispatchable>0 condition, records to events.jsonl", () => {
  const root = tmpRoot();
  try {
    const r = runOnce(root, { state: freeState() });
    assert.equal(r.free, true);
    assert.deepEqual(r.events.map((e) => e.event), ["SLOT-FREE"], "fires SLOT-FREE on the condition");
    const ev = r.events[0];
    assert.equal(ev.slots_free, 4, "event carries the free-slot count");
    assert.equal(ev.dispatchable_disjoint, 11, "event carries the dispatchable count");
    assert.equal(ev.in_flight_count, 1, "event carries the reconcile-aware in-flight count");
    assert.equal(ev.should_refill, true, "event speaks slot-refill's vocabulary");
    assert.ok(ev.at, "event.at is the measure hook (event → drive < 5min)");

    // durable append-only log (Contract invoke: tail -1 含 SLOT-FREE)
    const log = readSlotFreeEvents(root);
    assert.deepEqual(log.map((e) => e.event), ["SLOT-FREE"], "events.jsonl records the event");
    assert.ok(log[0].at, "the event timestamp is present");

    // no re-fire while the condition stays true (a transition detector, not a spammer)
    const again = runOnce(root, { state: freeState() });
    assert.equal(again.free, true);
    assert.deepEqual(again.events, [], "stays free ⇒ no second event");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 negative control — slot full OR no dispatchable ⇒ no SLOT-FREE", () => {
  const root = tmpRoot();
  try {
    const full = runOnce(root, { state: freeState({ slotsRemaining: 0 }) });
    assert.equal(full.free, false);
    assert.deepEqual(full.events, [], "in_flight ≥ cap ⇒ no event");
    const noCand = runOnce(root, { state: freeState({ dispatchable_disjoint: 0 }) });
    assert.equal(noCand.free, false);
    assert.deepEqual(noCand.events, [], "dispatchable 0 ⇒ no event");
    assert.deepEqual(readSlotFreeEvents(root), [], "nothing appended");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 halt suppression — `.halt` present ⇒ no SLOT-FREE (a free slot the outer cannot act on is noise)", () => {
  const root = tmpRoot();
  try {
    fs.writeFileSync(path.join(root, ".halt"), "paused for review");
    const r = runOnce(root, { state: freeState() });
    assert.equal(r.free, false);
    assert.deepEqual(r.events, [], "halted ⇒ no event");
    assert.deepEqual(readSlotFreeEvents(root), [], "nothing appended");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — runOnce cold-start-into-free fires immediately (the 'empty slot missed without trace' shape)", () => {
  const root = tmpRoot();
  try {
    // no memo file (fresh outer session after /clear); a slot is already free
    const r = runOnce(root, { state: freeState() });
    assert.equal(r.free, true);
    assert.deepEqual(r.events.map((e) => e.event), ["SLOT-FREE"], "cold-start-into-free fires immediately");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 — the trigger reads the EXISTING mechanisms (--slots + ready-pool-check), not a parallel copy", () => {
  const src = read(TRIGGER);
  assert.ok(src.includes("fast-mode-telemetry.ts"), "reads the reconcile-aware slot view (--slots)");
  assert.ok(src.includes("ready-pool-check.ts"), "reads the pool's dispatchable capacity");
  assert.ok(src.includes("--slots"), "invokes the --slots CLI");
  assert.ok(src.includes("dispatchable_disjoint"), "reads dispatchable_disjoint");
});

// ── AC3: outer 接事件回填 ────────────────────────────────────────────────────────

test("AC3 — the SLOT-FREE Monitor mount is retired (driver reconcile takes over); the doc keeps the mechanism as 理由档案", () => {
  const outer = read(OUTER_TICK);
  assert.ok(outer.includes("slot-free-trigger.ts"), "doc still names the trigger script (共享库 / 理由档案)");
  assert.ok(outer.includes("SLOT-FREE"), "doc still documents the SLOT-FREE event");
  assert.ok(outer.includes("gap-retire-outer-monitors-after-reconciler"), "doc names the retirement task");
  assert.ok(outer.includes("已退役"), "doc marks the Monitor mount retired");
  assert.ok(outer.includes("driver"), "doc routes the empty-slot response to the driver reconcile loop");
});

test("AC3 — orchestrator-tick-core retires the A18/B9 SLOT-FREE event-drive branch (driver per-pass reading takes over)", () => {
  const core = read(path.join(REPO_ROOT, "orchestration/orchestrator-tick-core.md"));
  assert.ok(core.includes("SLOT-FREE"), "tick-core names the SLOT-FREE event (retirement note)");
  assert.ok(core.includes("已退役"), "tick-core marks the event-drive branch retired");
  assert.ok(core.includes("gap-retire-outer-monitors-after-reconciler"), "tick-core names the retirement task");
});

// ── AC4: inner 醒来第一件事 ──────────────────────────────────────────────────────

test("AC4 — fast-mode-loop-tick wires the task-notification wake to run A11/A12/A13 + refill BEFORE fan-in/report", () => {
  const inner = read(INNER_TICK);
  assert.ok(inner.includes("醒来第一件事") || inner.includes("第一件事"), "doc: the wake's FIRST thing is the refill reads");
  assert.ok(inner.includes("ready-pool-check") && inner.includes("--apply"), "A11 — ready-pool-check --apply");
  assert.ok(inner.includes("slot-refill"), "A12 — slot-refill (refill evaluation)");
  assert.ok(inner.includes("--slots"), "A13 — slots 遥测 (fast-mode-telemetry --slots)");
  assert.ok(inner.includes("回填"), "refill comes BEFORE fan-in/report");
  // the reorder is the fix: fan-in/report must come AFTER the three必读 + refill
  const wakeIdx = inner.indexOf("task-notification");
  const refillIdx = inner.indexOf("回填");
  assert.ok(wakeIdx !== -1 && refillIdx !== -1, "both the wake and the refill are documented");
});

// ── AC5: no new scheduler + catalog declaration ──────────────────────────────────

test("AC5 — the trigger introduces NO new scheduling source", () => {
  const src = read(TRIGGER);
  for (const scheduler of ["CronCreate", "ScheduleWakeup", "/loop"]) {
    assert.ok(!src.includes(scheduler), `trigger must not create a new scheduling source: ${scheduler}`);
  }
  const outer = read(OUTER_TICK);
  assert.ok(outer.includes("不是新调度源"), "doc: cadence stays unique (outer cron)");
  assert.ok(outer.includes("节奏仍唯一"), "doc: the outer cron remains the only cadence");
});

test("AC5 — the trigger is declared in capability-catalog.sh (entry gate: undeclared ⇒ catalog exit non-zero)", () => {
  const catalog = read(CATALOG);
  assert.ok(catalog.includes("[slot-free-trigger.ts]="), "catalog declares slot-free-trigger.ts (QUESTION table)");
  const r = spawnSync("bash", [CATALOG, "--json"], { encoding: "utf8", cwd: REPO_ROOT });
  assert.equal(r.status, 0, `catalog entry gate passes:\n${r.stderr}`);
  const rows = JSON.parse(r.stdout);
  const row = rows.find((x) => x.file === "slot-free-trigger.ts");
  assert.ok(row, "slot-free-trigger.ts is a catalog row");
  assert.ok(row.question && row.question.length >= 20, "its declared question is specific (≥20 chars)");
  assert.equal(row.ships, true, "it ships");
  assert.ok(row.cadence, "cadence declared");
  assert.ok(row.invalidation, "失效前提 declared");
  assert.ok(row.last_reaffirmed, "last-reaffirmed declared");
  assert.ok(row.matching, "matching method declared");
});

test("AC6 — this file declares node:test and // @test-group engine", () => {
  const src = read(new URL(import.meta.url));
  assert.match(src, /^\/\/ @test-group engine/m, "declares @test-group engine");
});
