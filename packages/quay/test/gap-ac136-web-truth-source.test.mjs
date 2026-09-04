// @test-group product
// gap-ac136-web-truth-source-follows-driver — web 观测面随真相源切换（AC1/AC2）.
//
// After the promotion-driver takes over todo→ready promotion (AC130–135), the web observation surface
// must read the driver's outcome carrier — or be caliber-consistent with it — and must NOT keep reading
// the retired outer dispatch path (a fresh cold-call of slot-refill.ts). This test pins three things:
//
//   1. AC1 (parse): parsePromotionRoundRecords parses the `.quay/promotion-round.jsonl` JSONL carrier
//      and skips malformed lines (never throws, never fabricates a reading — hard rule ③b).
//   2. AC1 (negative control, falsifiable): readManager's pool is 未接入 (status "empty") when the driver
//      has produced NO round record — even when a valid task store exists. If readPoolMetrics still
//      cold-called slot-refill (the old path), it would report "ok" on a valid store. "empty" is the
//      structural proof the web no longer reads the old path.
//   3. AC2 (falsifiable): construct a driver-completed promotion (todo→ready) — one --once driver round
//      against the REAL ready-pool-check --apply — and assert BOTH web views reflect it within their
//      read cycle: the pool metric (readManager) surfaces the promoted id via lastPromoted, and the
//      task ledger (readTaskSummary over the task store the driver wrote) shows the task as ready.
//
// Run (scoped): node --no-warnings --experimental-strip-types --test packages/quay/test/gap-ac136-web-truth-source.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readManager, clearPoolMetricsCache, parsePromotionRoundRecords } from "../src/observation.ts";
import { readTaskSummary, clearTaskSummaryCache } from "../src/serve-handlers.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DRIVER = path.join(REPO_ROOT, "plugin", "scripts", "promotion-driver.ts");
const READY_POOL_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "ready-pool-check.ts");

// ── Fixtures (mirror plugin/test/promotion-driver.test.mjs's eligible-todo fixtures) ────────────────

function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ac136-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  return dir;
}

// A minimal contract-shape todo body carrying the four artifacts (Proposal/Contract/AC/DoD) + the
// C8 self-touch (own tasks/<id>.md in ## Touches) — the exact shape ready-pool-check --apply promotes.
function eligibleTodoBody(id) {
  return [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars long.",
    "## Contract",
    "measure   ready_pool = ready-pool-check stdout pool field, definitely over forty chars.",
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough to count as an item",
    "- [ ] another AC item that is long enough to count as an item",
    "- [ ] a third AC item that is long enough to count as an item",
    "- [ ] a fourth AC item that is long enough to count as an item",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned, over forty chars long.",
    "## Touches",
    `- tasks/${id}.md`,
  ].join("\n");
}

function writeTask(root, id, status = "todo") {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    `status: ${status}`,
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "extra:",
    "  schema: v1",
    "---",
  ].join("\n");
  fs.writeFileSync(path.join(root, "tasks", `${id}.md`), `${fm}\n\n${eligibleTodoBody(id)}`);
}

function readStatus(root, id) {
  const raw = fs.readFileSync(path.join(root, "tasks", `${id}.md`), "utf8");
  const m = raw.match(/^status:\s*(\w+)\s*$/m);
  return m ? m[1] : null;
}

function runDriver(root, args) {
  return execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root, ...args,
  ], { encoding: "utf8" });
}

// The real ready-pool-check --apply command (full pool + land promotions) against the temp task root.
// Injected via --ready-pool-cmd so the AC2 test exercises the REAL promotion path (not a fake).
function realReadyPoolCmd(root) {
  return `node --experimental-strip-types ${READY_POOL_SCRIPT} --root ${root} --cap 5 --apply --json`;
}

// A ProviderClient whose taskList reads the task files' frontmatter (the SAME store the driver
// writes) — the task ledger's truth source. This is what the native provider's walkTasks reads.
function fileReadingClient(root) {
  return {
    taskList: async () => {
      const tasks = [];
      for (const f of fs.readdirSync(path.join(root, "tasks"))) {
        if (!f.endsWith(".md")) continue;
        const raw = fs.readFileSync(path.join(root, "tasks", f), "utf8");
        const id = (raw.match(/^id:\s*(.+?)\s*$/m) || [])[1];
        const status = (raw.match(/^status:\s*(\w+)\s*$/m) || [])[1];
        if (id) tasks.push({ id: id.trim(), title: `fixture ${id}`, status, labels: [], updatedAt: 0 });
      }
      return { tasks, malformed: [] };
    },
  };
}

// ── AC1: parse the driver's round carrier ─────────────────────────────────────────────────────────

test("AC1: parsePromotionRoundRecords parses the JSONL carrier and skips malformed lines (never throws)", () => {
  const recs = parsePromotionRoundRecords(
    `${JSON.stringify({ ts: "t1", round: 1, action: "promote", pool: 7, promoted_ids: ["gap-a", "gap-b"], error: null })}\nnot-json\n${JSON.stringify({ ts: "t2", round: 2, action: "none", pool: 8, promoted_ids: [], error: null })}\n`,
  );
  assert.equal(recs.length, 2, "two valid records; the malformed line is skipped (never throws)");
  assert.equal(recs[0].pool, 7);
  assert.equal(recs[0].action, "promote");
  assert.deepEqual(recs[0].promoted_ids, ["gap-a", "gap-b"], "promoted_ids surfaced from the carrier");
  assert.equal(recs[1].action, "none");
  assert.equal(recs[1].pool, 8);
});

// ── AC1 (negative control, falsifiable): pool is 未接入 without a round record ─────────────────────

test("AC1: readManager pool is 未接入 (empty) when the driver has produced no round record — ⛔ not a slot-refill reading", async () => {
  const ws = makeRoot("no-round");
  try {
    clearPoolMetricsCache();
    writeTask(ws, "gap-empty-ctrl", "todo"); // a real todo exists, but NO round record
    const m = await readManager(ws);
    assert.equal(m.pool.status, "empty", "pool is empty (未接入) — proving readPoolMetrics no longer cold-calls slot-refill (which would report ok on a valid store)");
    assert.equal(m.pool.pool, null);
  } finally {
    clearPoolMetricsCache();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

// ── AC2 (falsifiable): a driver-completed promotion is reflected in both web views ─────────────────

test("AC2: a driver-completed promotion (todo→ready) is reflected in the pool metric + task ledger", async () => {
  const ws = makeRoot("ac2");
  try {
    clearPoolMetricsCache();
    clearTaskSummaryCache();
    writeTask(ws, "gap-ac136-eligible", "todo");
    assert.equal(readStatus(ws, "gap-ac136-eligible"), "todo", "precondition: the task is todo");

    // One driver round (--once) with the REAL ready-pool-check --apply against the temp workspace.
    runDriver(ws, ["--ready-pool-cmd", realReadyPoolCmd(ws), "--cap", "5", "--once"]);

    // (a) The driver actually completed the promotion: task file status todo→ready.
    assert.equal(readStatus(ws, "gap-ac136-eligible"), "ready", "the driver completed the todo→ready promotion on disk");

    // (b) The pool metric reflects the driver's round carrier (status ok + lastPromoted carries the id).
    const m = await readManager(ws);
    assert.equal(m.pool.status, "ok", "pool metric is ok (reads the driver's round record)");
    assert.ok(
      m.pool.lastPromoted.includes("gap-ac136-eligible"),
      `pool.lastPromoted reflects the driver promotion (got ${JSON.stringify(m.pool.lastPromoted)})`,
    );

    // (c) The task ledger reflects the promotion — readTaskSummary over the task store the driver wrote.
    const summary = await readTaskSummary(ws, fileReadingClient(ws));
    const promoted = summary.find((t) => t.id === "gap-ac136-eligible");
    assert.ok(promoted, "the promoted task is present in the task ledger");
    assert.equal(promoted.status, "ready", "task ledger shows the promoted task as ready");
  } finally {
    clearPoolMetricsCache();
    clearTaskSummaryCache();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
