// @test-group product
// serve-dashboard.test.mjs — gap-dashboard-live-swimlane-fixed-lane-gantt-timeline: the 循环脉搏卡
// swimlane becomes a fixed-5-lane gantt merging in-flight + worker-outcome history.
//   AC1 — mergeLiveAndHistoryIntervals dedups a run present in BOTH sources by (taskId, startMs) —
//         NOT run_id (which is the driver-round id shared by every task in that driver lifetime) — and
//         uses ended_at for historical end / now for in-flight end. A regression test pins that
//         distinct tasks sharing one run_id ALL survive (gap-dashboard-gantt-runid-dedup-collapses-
//         driver-round-shared-id).
//   AC2 — packLanes greedy packing: (a) non-overlap → one lane; (b) 5 overlap → exactly 5 lanes;
//         (c) a 6th overlap → overflow (no index clip, not silently dropped).
//   AC3 — renderLiveGanttSvg renders one <rect> per input interval + exactly 5 lane guide lines.
//   AC4 — every <rect> carries a native <title> with the task id + a duration.
//   AC5 — renderLiveCard keeps the in-flight mini-list AND renders the merged gantt (both present).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  renderLiveCard,
  renderLiveGanttSvg,
  renderTaskCard,
  mergeLiveAndHistoryIntervals,
  packLanes,
  FIXED_GANTT_LANES,
} from "../src/serve-dashboard.ts";
import { readLive, readWorkerOutcomeRecords, WORKER_OUTCOME_REL } from "../src/observation.ts";

const FIXED_NOW_MS = 1_700_000_000_000; // deterministic wall-clock anchor
const HOUR_MS = 3_600_000;

/** Build a temp workspace with a `.quay/` dir (the worker outcome carrier lives there) for the DoD
 *  e2e path — mirrors observation.test.mjs's workerWorkspace so the test writes real carrier data. */
function workerWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  return ws;
}

test("AC1: mergeLiveAndHistoryIntervals dedups a run in BOTH sources by (taskId, startMs), ends historical at ended_at and in-flight at now", () => {
  const nowMs = FIXED_NOW_MS;
  const winStart = nowMs - 3 * HOUR_MS;
  const endedMs = nowMs - 30 * 60_000;
  const inFlight = [
    { taskId: "T-shared", runId: "R1", startedAtMs: nowMs - 10 * 60_000, phase: "implementing" },
    { taskId: "T-live-only", runId: "R2", startedAtMs: nowMs - 5 * 60_000, phase: "fan-in" },
  ];
  // R1 appears in BOTH sources (in-flight + already-written outcome) — must dedup to one interval.
  const records = [
    { task: "T-shared", run_id: "R1", started_at: new Date(nowMs - 10 * 60_000).toISOString(), ended_at: new Date(nowMs - 20 * 60_000).toISOString(), final_state: "completed", mechanical_fan_in: null },
    { task: "T-hist-only", run_id: "R3", started_at: new Date(nowMs - 2 * HOUR_MS).toISOString(), ended_at: new Date(endedMs).toISOString(), final_state: "completed", mechanical_fan_in: { outcome: "landed" } },
  ];

  const out = mergeLiveAndHistoryIntervals(inFlight, records, winStart, nowMs);

  assert.equal(out.filter((i) => i.runId === "R1").length, 1, "R1 (in both sources) appears exactly once");
  const shared = out.find((i) => i.runId === "R1");
  assert.equal(shared.endMs, nowMs, "the deduped R1 keeps the in-flight end (now), not ended_at");
  assert.equal(shared.phase, "implementing", "the deduped R1 keeps its in-flight phase");

  const liveOnly = out.find((i) => i.runId === "R2");
  assert.equal(liveOnly.endMs, nowMs, "an in-flight-only interval ends at now");

  const histOnly = out.find((i) => i.runId === "R3");
  assert.equal(histOnly.endMs, endedMs, "a historical interval ends at ended_at");
  assert.equal(histOnly.fanInOutcome, "landed", "the mechanical fan-in outcome is carried through");
});

// gap-dashboard-gantt-runid-dedup-collapses-driver-round-shared-id AC1: the production shape that the
// old run_id-keyed dedup silently destroyed — one driver round (one shared run_id) dispatches MANY
// distinct tasks; every one must survive as its own interval.
test("regression: distinct tasks sharing one run_id (driver round id) are each kept, not collapsed", () => {
  const nowMs = FIXED_NOW_MS;
  const winStart = nowMs - 12 * HOUR_MS;
  const records = [
    { task: "gap-a", run_id: "wk-prod-1", started_at: new Date(nowMs - 5 * HOUR_MS).toISOString(), ended_at: new Date(nowMs - 4 * HOUR_MS).toISOString(), final_state: "completed", mechanical_fan_in: null },
    { task: "gap-b", run_id: "wk-prod-1", started_at: new Date(nowMs - 3 * HOUR_MS).toISOString(), ended_at: new Date(nowMs - 2 * HOUR_MS).toISOString(), final_state: "completed", mechanical_fan_in: { outcome: "landed" } },
    { task: "gap-c", run_id: "wk-prod-1", started_at: new Date(nowMs - 1 * HOUR_MS).toISOString(), ended_at: new Date(nowMs - 30 * 60_000).toISOString(), final_state: "failed", mechanical_fan_in: null },
  ];

  const out = mergeLiveAndHistoryIntervals([], records, winStart, nowMs);

  assert.equal(out.length, 3, "three distinct tasks sharing one run_id all survive");
  assert.deepEqual(out.map((i) => i.taskId).sort(), ["gap-a", "gap-b", "gap-c"], "each task keeps its own block");
});

// gap-dashboard-gantt-runid-dedup-collapses-driver-round-shared-id AC2: the dedup still fires for a
// genuinely-shared run — in-flight + its terminal outcome record, same taskId and same startedAtMs —
// because Date.parse(started_at) round-trips to the exact startedAtMs the in-flight side carries.
test("regression: the (taskId, startMs) key still dedups a run that is both in-flight AND terminal-outcome", () => {
  const nowMs = FIXED_NOW_MS;
  const winStart = nowMs - 3 * HOUR_MS;
  const startMs = nowMs - 10 * 60_000;
  const inFlight = [{ taskId: "T-shared", runId: "R1", startedAtMs: startMs, phase: "implementing" }];
  const records = [
    { task: "T-shared", run_id: "R1", started_at: new Date(startMs).toISOString(), ended_at: new Date(nowMs - 5 * 60_000).toISOString(), final_state: "completed", mechanical_fan_in: null },
  ];

  const out = mergeLiveAndHistoryIntervals(inFlight, records, winStart, nowMs);

  assert.equal(out.length, 1, "the same run in both sources collapses to one interval");
  assert.equal(out[0].endMs, nowMs, "in-flight wins: end is now, not the outcome ended_at");
  assert.equal(out[0].phase, "implementing", "in-flight wins: the phase survives");
});

test("AC2: packLanes greedy packing — non-overlap, exactly-cap overlap, and the overflow arm", () => {
  const nowMs = FIXED_NOW_MS;
  const mk = (runId, startMs, endMs) => ({ taskId: runId, runId, startMs, endMs, phase: null, finalState: "completed", fanInOutcome: null });

  // (a) non-overlapping intervals all pack onto lane 0.
  const non = [0, 1, 2, 3, 4].map((i) => mk(`N${i}`, nowMs + i * 2000, nowMs + i * 2000 + 1000));
  const a = packLanes(non, 5);
  assert.equal(a.lanes.length, 1, "(a) non-overlapping intervals all share one lane");
  assert.equal(a.lanes[0].length, 5, "(a) all five on lane 0");
  assert.equal(a.overflow, 0, "(a) no overflow");

  // (b) 5 fully-overlapping intervals exactly fill the 5 lanes.
  const five = [0, 1, 2, 3, 4].map((i) => mk(`O${i}`, nowMs, nowMs + 1000));
  const b = packLanes(five, 5);
  assert.equal(b.lanes.length, 5, "(b) 5 overlapping intervals occupy exactly 5 lanes");
  assert.ok(b.lanes.every((l) => l.length === 1), "(b) one interval per lane");
  assert.equal(b.overflow, 0, "(b) no overflow at exactly the cap");

  // (c) a 6th interval overlapping all five must hit the overflow arm, not be clipped or dropped.
  const six = [0, 1, 2, 3, 4, 5].map((i) => mk(`S${i}`, nowMs, nowMs + 1000));
  const c = packLanes(six, 5);
  assert.equal(c.overflow, 1, "(c) the 6th overlapping interval overflows");
  assert.ok(c.lanes.every((l) => l.length === 1), "(c) no lane carries two (no index clip)");
  const total = c.lanes.reduce((s, l) => s + l.length, 0);
  assert.equal(total + c.overflow, 6, "(c) overflow is counted, not silently dropped");
});

test("AC3: renderLiveGanttSvg renders one <rect> per interval + exactly 5 lane guide lines", () => {
  const nowMs = FIXED_NOW_MS;
  const ivs = [0, 1, 2].map((i) => ({
    taskId: `T${i}`,
    runId: `R${i}`,
    startMs: nowMs - i * 10 * 60_000,
    endMs: nowMs,
    phase: "implementing",
    finalState: null,
    fanInOutcome: null,
  }));
  const svg = renderLiveGanttSvg(ivs, 3, nowMs);

  const rects = svg.match(/<rect[^>]*>/g) ?? [];
  assert.equal(rects.length, ivs.length, "one <rect> per input interval (exact count, same convention)");
  const laneLines = svg.match(/class="lane-line"/g) ?? [];
  assert.equal(laneLines.length, FIXED_GANTT_LANES, "exactly 5 lane guide lines (the fixed concurrency cap), even when some lanes are empty");
});

test("AC4: every gantt <rect> carries a native <title> with the task id + a duration", () => {
  const nowMs = FIXED_NOW_MS;
  const ivs = [
    { taskId: "task-alpha", runId: "R1", startMs: nowMs - 10 * 60_000, endMs: nowMs, phase: "implementing", finalState: null, fanInOutcome: null },
    { taskId: "task-beta", runId: "R2", startMs: nowMs - 20 * 60_000, endMs: nowMs - 5 * 60_000, phase: null, finalState: "completed", fanInOutcome: "landed" },
  ];
  const svg = renderLiveGanttSvg(ivs, 3, nowMs);

  const titles = svg.match(/<title>([^<]*)<\/title>/g) ?? [];
  assert.equal(titles.length, ivs.length, "every <rect> carries a <title> child");
  for (const t of titles) {
    assert.match(t, /task-alpha|task-beta/, "title carries the task id");
    assert.match(t, /\d+(h\d+m|m\d+s|s)/, "title carries a duration");
  }
});

test("AC5: renderLiveCard keeps the in-flight mini-list AND renders the merged gantt", () => {
  const nowMs = FIXED_NOW_MS;
  const live = {
    status: "ok",
    liveState: "running",
    concurrency: 1,
    inFlight: [{ taskId: "T-1", runId: "R1", startedAtMs: nowMs - 60_000, phase: "implementing" }],
  };
  const records = [
    { task: "T-hist", run_id: "R9", started_at: new Date(nowMs - HOUR_MS).toISOString(), ended_at: new Date(nowMs - 30 * 60_000).toISOString(), final_state: "completed", mechanical_fan_in: { outcome: "landed" } },
  ];
  const html = renderLiveCard(live, nowMs, [], records, 3, "zh");

  // The mini-list (liveMiniList) is a hard constraint — its task-id anchor is UNIQUE to the mini-list
  // (the gantt svg has no <a>), so its presence proves the list was NOT removed by the gantt upgrade.
  assert.match(html, /<a href="\/task\/T-1"/, "the in-flight mini-list task-id anchor survives");
  assert.match(html, /实现中/, "the mini-list tag text renders");
  assert.match(html, /循环脉搏甘特图/, "the merged fixed-lane gantt svg renders");
  // Both must be in the SAME card render (indexOf order is irrelevant; coexistence is the assertion).
  assert.ok(html.includes('aria-label="循环脉搏甘特图'), "gantt svg present");

  // gap-webui-dashboard-body-copy-en-zh: the SAME card under `en` (the default) — structure
  // identical, copy switched. Asserting only the zh arm above would leave the default language
  // unwatched.
  const enHtml = renderLiveCard(live, nowMs, [], records, 3, "en");
  assert.match(enHtml, /<a href="\/task\/T-1"/, "the mini-list anchor survives in en too");
  assert.match(enHtml, /Implementing/, "the en mini-list tag text renders");
  assert.ok(!/[一-鿿]/.test(enHtml.replace(/<title>[^<]*<\/title>/g, "")),
    "the en liveCard carries no CJK outside the (data-bearing) gantt block <title> text");
});

// ── gap-dashboard-live-swimlane-fixed-lane-gantt-timeline DoD integration test ────────────────────
// The DoD is NOT pure-unit samples: it must prove the merge → pack → render three-stage pipeline is
// wired to PRODUCTION data shapes — a real `.quay/worker-outcome.jsonl` (read via readWorkerOutcomeRecords)
// + a real readLive() in-flight set (via the process-signal seam), fed through renderLiveCard, produces
// a fixed-5-lane gantt (historical + in-flight blocks) AND the untouched in-flight mini-list.
test("DoD: renderLiveCard gantt merges readLive() + worker-outcome.jsonl into one 5-lane gantt alongside the mini-list", () => {
  const ws = workerWorkspace("gantt-e2e");
  try {
    const nowMs = Date.parse("2026-08-24T08:00:00.000Z");
    // Two TERMINAL historical outcomes (completed-with-fan-in + failed) — the carrier's full shape.
    const hist = [
      { ts: "2026-08-24T07:41:00.000Z", task: "gap-hist-a", run_id: "wk-a", started_at: "2026-08-24T07:00:00.000Z", ended_at: "2026-08-24T07:41:00.000Z", final_state: "completed", mechanical_fan_in: { outcome: "landed" } },
      { ts: "2026-08-24T07:21:00.000Z", task: "gap-hist-b", run_id: "wk-b", started_at: "2026-08-24T07:10:00.000Z", ended_at: "2026-08-24T07:20:00.000Z", final_state: "failed" },
    ];
    fs.mkdirSync(path.dirname(path.join(ws, WORKER_OUTCOME_REL)), { recursive: true });
    fs.writeFileSync(path.join(ws, WORKER_OUTCOME_REL), hist.map((r) => JSON.stringify(r) + "\n").join(""));

    // One first-dispatched in-flight worker (no outcome record yet) via the process-signal seam.
    const live = readLive(ws, { nowMs, liveWorkers: [{ taskId: "gap-live-c", pid: "100", startedAtMs: Date.parse("2026-08-24T07:30:00.000Z") }] });

    const records = readWorkerOutcomeRecords(ws);
    const html = renderLiveCard(live, nowMs, [], records, 3, "zh");

    assert.match(html, /循环脉搏甘特图/, "the gantt svg renders from real readLive + worker-outcome data");
    const ganttStart = html.indexOf('aria-label="循环脉搏甘特图');
    assert.ok(ganttStart >= 0, "gantt svg anchor found");
    const rects = (html.slice(ganttStart).match(/<rect[^>]*>/g) ?? []);
    assert.equal(rects.length, 3, "2 historical + 1 in-flight interval → exactly 3 <rect> blocks (merge+pack+render wired)");
    assert.match(html, /<a href="\/task\/gap-live-c"/, "the in-flight mini-list task id survives alongside the gantt (hard constraint)");
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── gap-dashboard-taskcard-minilist-cap-too-small-raise-to-10 ─────────────────────────────────────
// 人裁定 2026-09-14：renderTaskCard 的 MINI_LIST_N 由 3 提到 10。范围仅此一个常量——不引入自适应
// 阈值、不新增「+N 更多」提示（renderLiveCard 的 live.inFlight.slice(0, 3) 已有溢出徽标，
// 该不一致已记录在案、留待以后单独立案）。
//
//   AC1 — 12 条 ready ⇒ ready mini-list 渲染出 **10** 行（不是 3 行），且是 updatedAt 最新的那 10 条。
//   AC2 — 5 条 todo（真实小项目场景）⇒ todo mini-list 完整渲染 5 行（真实数 < 新上限时必须全展示）。
//   AC3 — 负控制：两个终态（done/superseded）本来就只显示计数、无 mini-list；本任务不得给它们加上一个。

/** The mini-list rows are the ONLY `<a href="/task/…">` anchors renderTaskCard emits, so counting
 *  anchors inside one status's block is an exact row count (no shared-class ambiguity).
 *
 *  ⚠️ gap-webui-dashboard-body-copy-en-zh: the block's LABEL is language-dependent, and the
 *  DEFAULT is `en` — so every test below renders with an explicit `"zh"` and this locator keeps its
 *  original zh form. That is deliberate on both counts: the zh arm stays the regression guard the
 *  assertions were written as, and (the trap) `>done（最近 ` — a NEGATIVE assertion in AC3 — would
 *  become a TAUTOLOGY under `en`, where that string is absent for the wrong reason. */
function miniListBlock(html, status) {
  const start = html.indexOf(`>${status}（最近 `);
  assert.ok(start >= 0, `the ${status} mini-list label renders`);
  const rest = html.slice(start);
  // The block ends at the next mini-list label, else at the trailing /tasks link.
  const ends = ["ready", "todo", "needs-human"]
    .map((s) => rest.indexOf(`>${s}（最近 `, 1))
    .concat([rest.indexOf("查看任务列表")])
    .filter((i) => i > 0);
  return rest.slice(0, ends.length ? Math.min(...ends) : rest.length);
}
const miniListRows = (html, status) =>
  (miniListBlock(html, status).match(/<a href="\/task\//g) ?? []).length;

/** renderTaskCard 只读 id/title/status/updatedAt（updatedAt 必须是 number，否则该行被过滤掉）。 */
const summary = (id, status, updatedAt) => ({ id, title: `${id} title`, status, updatedAt });

test("AC1: 12 ready tasks ⇒ the ready mini-list renders 10 rows (the newest 10), not 3", () => {
  const base = Date.parse("2026-09-14T00:00:00.000Z");
  // r00 is OLDEST, r11 is NEWEST — so the rendered set discriminates sort-then-cap from "any 10".
  const tasks = Array.from({ length: 12 }, (_, i) =>
    summary(`r${String(i).padStart(2, "0")}`, "ready", base + i * 60_000));

  const html = renderTaskCard(tasks, "zh");

  assert.equal(miniListRows(html, "ready"), 10, "the ready mini-list shows exactly 10 rows (was 3)");
  // Cap-and-sort, not merely "10 happened to be present": the two OLDEST must be the ones dropped.
  const block = miniListBlock(html, "ready");
  assert.ok(!block.includes('/task/r00"'), "the oldest ready task (r00) is the one cut by the cap");
  assert.ok(!block.includes('/task/r01"'), "the second-oldest ready task (r01) is also cut");
  assert.ok(block.includes('/task/r11"'), "the newest ready task (r11) survives");
  assert.ok(block.includes('/task/r02"'), "the 10th-newest ready task (r02) survives");

  // gap-webui-dashboard-body-copy-en-zh: the en arm — same 10 rows, en label. The count is asserted
  // on the en render too, so "the cap is 10" is pinned in BOTH languages (a language-dependent
  // count would be a defect neither arm alone could see).
  const enHtml = renderTaskCard(tasks, "en");
  assert.ok(enHtml.includes(">ready (latest 10)"), "the en mini-list label renders");
  // The zh locator CANNOT be reused on the en render — it asserts its own label is present and would
  // throw rather than report 0. Count the anchors directly instead, so the en cap is measured.
  assert.equal((enHtml.match(/<a href="\/task\//g) ?? []).length, 10, "the en render shows exactly 10 rows too");
  assert.ok(!/[一-鿿]/.test(enHtml), "the en taskCard carries no CJK at all");
});

test("AC2: 5 todo tasks (a real small project) ⇒ the todo mini-list renders all 5, none truncated", () => {
  const base = Date.parse("2026-09-14T00:00:00.000Z");
  const tasks = Array.from({ length: 5 }, (_, i) =>
    summary(`t${i}`, "todo", base + i * 60_000));

  const html = renderTaskCard(tasks, "zh");

  assert.equal(miniListRows(html, "todo"), 5, "all 5 todo rows render — nothing silently truncated below the cap");
  for (let i = 0; i < 5; i++) {
    assert.ok(miniListBlock(html, "todo").includes(`/task/t${i}"`), `todo row t${i} is present`);
  }
});

test("AC3 (negative control): the terminal states done/superseded gain NO mini-list — they stay count-only", () => {
  const base = Date.parse("2026-09-14T00:00:00.000Z");
  const tasks = [
    ...Array.from({ length: 3 }, (_, i) => summary(`d${i}`, "done", base + i * 60_000)),
    ...Array.from({ length: 3 }, (_, i) => summary(`s${i}`, "superseded", base + i * 60_000)),
    summary("r0", "ready", base),
  ];

  const html = renderTaskCard(tasks, "zh");

  // No mini-list block for either terminal state (the label is the block's unmistakable marker)…
  assert.ok(!html.includes(">done（最近 "), "done renders NO mini-list block");
  assert.ok(!html.includes(">superseded（最近 "), "superseded renders NO mini-list block");
  // …and no stray anchors leak in for them: the card's ONLY anchors are the single ready row.
  assert.equal(miniListRows(html, "ready"), 1, "only the ready mini-list renders rows");
  for (const id of ["d0", "d1", "d2", "s0", "s1", "s2"]) {
    assert.ok(!html.includes(`/task/${id}"`), `${id} (terminal) must not appear as a mini-list row`);
  }
  // The count-only path is intact: both terminal states still report their numeric counts.
  assert.match(html, /<b>3<\/b> done/, "done is still shown as a count");
  assert.match(html, /<b>3<\/b> superseded/, "superseded is still shown as a count");
});
