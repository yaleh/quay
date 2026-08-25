// @test-group product
// gap-ac146-human-interface-explicit-owner — /needs-human is the explicit human owner interface for
// needs-human tasks: it joins 当前待办 (store status) + 升级台账 (.quay/promotion-outcome.jsonl
// `action:"needs-human"`), so a human can see a needs-human without reading any transcript.
//
// AC1 (能取假, 显式承接者): a needs-human task (status + `## Needs-Human` 阻碍原因) renders on
//   /needs-human with its reason.
// AC2 (能取假, 负控制): a needs-human event whose store status has since MOVED ON (the exact
//   situation of the 3 real samples in `.quay/promotion-outcome.jsonl` — re-dispatched to
//   done/superseded) is still visible, because the page reads the LEDGER, not just the status.
//   Negative control: if the page dropped the ledger read, that sample would vanish.
//
// Run (scoped): node --test packages/quay/test/serve-needs-human.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { parsePromotionOutcomeRecords, readNeedsHumanLedger } from "../src/observation.ts";
import { extractNeedsHumanReason } from "../src/serve-needs-human.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "needs-human fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "fixture"], { cwd: ws });
  return { ws, tasksDir };
}

function seed(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}

/** The `## Needs-Human` body the promotion-driver.markNeedsHuman writes — carries the 阻碍原因 line. */
function needsHumanBody(reason) {
  return (
    `## Proposal\nA sufficiently long proposal section for the needs-human fixture.\n` +
    `## Plan\nA sufficiently long plan section for the needs-human fixture.\n` +
    `## Acceptance Criteria\n- [ ] a sufficiently long acceptance criterion line\n` +
    `## Definition of Done\n- [x] a sufficiently long definition-of-done line\n` +
    `## Needs-Human\n\n**执行 2026-08-23T09:09:46.037Z — promotion-driver AC133：连续修满上限仍不合格**\n\n- 阻碍原因：${reason}\n`
  );
}

test("extractNeedsHumanReason: reads the 阻碍原因 line, null when absent", () => {
  assert.equal(
    extractNeedsHumanReason(needsHumanBody("连续修满 3 次仍不合格（闸在重验证后仍判不合格）")),
    "连续修满 3 次仍不合格（闸在重验证后仍判不合格）",
    "extracts the reason from the 阻碍原因 line",
  );
  assert.equal(extractNeedsHumanReason("## Proposal\nno reason here\n"), null, "no reason line ⇒ null");
  assert.equal(extractNeedsHumanReason(undefined), null, "undefined body ⇒ null");
});

test("parsePromotionOutcomeRecords / readNeedsHumanLedger: action:needs-human ledger, newest first, malformed skipped", () => {
  const text = [
    JSON.stringify({ task_id: "A", action: "promote", result: { ok: true, detail: "todo->ready" }, ts: "2026-08-23T00:00:00.000Z" }),
    JSON.stringify({ task_id: "B", action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-08-23T04:14:47.064Z" }),
    "not-json\n",
    JSON.stringify({ task_id: "C", action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-08-23T09:09:46.037Z" }),
  ].join("\n");
  const all = parsePromotionOutcomeRecords(text);
  assert.equal(all.length, 3, "malformed line is skipped (3 of 4 parsed)");
  const nh = all.filter((r) => r.action === "needs-human");
  assert.deepEqual(nh.map((r) => r.task_id), ["B", "C"], "both needs-human records parsed");
  assert.equal(nh[0].detail, "retry-cap-exhausted", "result.detail is surfaced");

  // readNeedsHumanLedger reads from disk and sorts newest first.
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nh-ledger-"));
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "promotion-outcome.jsonl"), text);
  const ledger = readNeedsHumanLedger(ws);
  assert.deepEqual(ledger.map((r) => r.task_id), ["C", "B"], "ledger is newest-first (C then B)");
  fs.rmSync(ws, { recursive: true, force: true });

  // Absent ledger ⇒ [] (a real "none", not a throw).
  const emptyWs = fs.mkdtempSync(path.join(os.tmpdir(), "nh-empty-"));
  fs.mkdirSync(path.join(emptyWs, ".quay"), { recursive: true });
  assert.deepEqual(readNeedsHumanLedger(emptyWs), [], "absent ledger ⇒ []");
  fs.rmSync(emptyWs, { recursive: true, force: true });
});

test("AC1 + AC2: /needs-human renders 当前待办 (status+reason) AND 升级台账 (status-moved-on sample)", async () => {
  const { ws, tasksDir } = makeWorkspace("nh-page-");
  const cwd0 = process.cwd();
  let server;
  try {
    // AC1 — an ACTIVE needs-human task: store status needs-human + a ## Needs-Human reason.
    seed(tasksDir, "NH-ACTIVE", { title: "Active needs-human", status: "needs-human", body: needsHumanBody("连续修满 3 次仍不合格（闸在重验证后仍判不合格）") });
    // AC2 negative-control sample — a needs-human event whose store status has SINCE MOVED ON to
    // done (the real 3-sample situation). It must STILL be visible, via the ledger.
    seed(tasksDir, "NH-MOVED-ON", { title: "Re-dispatched", status: "done", body: needsHumanBody("was needs-human, now done") });
    fs.writeFileSync(
      path.join(ws, ".quay", "promotion-outcome.jsonl"),
      [
        JSON.stringify({ task_id: "NH-MOVED-ON", gate: { eligible: false, missing: [] }, action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-08-23T04:14:47.064Z" }),
        JSON.stringify({ task_id: "NH-ACTIVE", gate: { eligible: false, missing: [] }, action: "needs-human", result: { ok: true, detail: "retry-cap-exhausted" }, ts: "2026-08-23T09:09:46.037Z" }),
      ].join("\n") + "\n",
    );

    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const page = await get(port, "/needs-human");
    assert.equal(page.status, 200, "GET /needs-human returns 200");

    // AC1 — the active task and its reason are visible (no transcript read).
    assert.ok(page.body.includes("NH-ACTIVE"), "AC1: the active needs-human task id is rendered");
    assert.ok(page.body.includes("连续修满 3 次仍不合格"), "AC1: the 阻碍原因 reason is rendered");
    assert.ok(page.body.includes("当前待办") && page.body.includes("升级台账"),
      "AC1: the page renders both 当前待办 and 升级台账 sections");

    // AC2 — the status-moved-on sample is STILL visible via the ledger (the negative control: drop
    // the ledger read and this row vanishes even though the event really happened).
    assert.ok(page.body.includes("NH-MOVED-ON"), "AC2: the status-moved-on needs-human event is still visible via the ledger");
    assert.ok(page.body.includes("retry-cap-exhausted"), "AC2: the ledger detail (retry-cap-exhausted) is rendered");

    // The active task's id appears in BOTH sections is fine; the moved-on task appears ONLY in the
    // ledger (its store status is done, so the 当前待办 table must not contain it as an active row).
    // Split the body at the ledger HEADING (not the word 升级台账, which also appears in the meta
    // line above) to assert the active table does NOT render NH-MOVED-ON.
    const [activePart] = page.body.split("<h2>升级台账");
    assert.ok(activePart.includes("NH-ACTIVE"), "AC1/AC2: active section contains NH-ACTIVE");
    assert.ok(!activePart.includes("NH-MOVED-ON"), "AC2: the active section does NOT contain the done NH-MOVED-ON (ledger-only)");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("degradation: no needs-human tasks and no ledger still renders 200 (never a 500)", async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "nh-degrade-"));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  const cwd0 = process.cwd();
  let server;
  try {
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });
    const page = await get(port, "/needs-human");
    assert.equal(page.status, 200, "empty workspace still returns 200");
    assert.ok(page.body.includes("当前无 needs-human 任务"), "empty active table renders the none note");
    assert.ok(page.body.includes("无 needs-human 升级记录"), "empty ledger renders the none note");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
