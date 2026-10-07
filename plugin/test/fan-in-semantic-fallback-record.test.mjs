// @test-group engine
// fan-in-semantic-fallback-record.test.mjs — 语义兜底路径遥测的写侧 + 读侧测试
// (plugin/scripts/worker-driver.ts 的 SEMANTIC_FALLBACK_* / aggregateSemanticFallback /
//  `--record-semantic-fallback` / `--semantic-fallback-report`)。
//
// 来源任务: tasks/gap-fan-in-execute-semantic-fallback-telemetry-blind.md（## Finding / ## AC / ## DoD）
//   AC2 要求：一个查询能回答「语义兜底跑过几次、结果如何」，且必须返回**具体计数**（即便为 0），
//            ⛔ 而不是「载体读不到 ⇒ 说不清」。
//   DoD 要求：载体能把「经语义兜底落地」与「经机械路径落地」区分开，证据是**真实记录**或**具体的零计数**。
//
// 覆盖（能取假，硬规则 3/4）：
//   - 负控制①（硬规则 4，位置判定）：actor="quay-driver"（机械路径）的 complete 事件**不**被计成语义兜底落地。
//   - 负控制②：gate != "complete" 的事件（即便 actor 相同）不被计入。
//   - 负控制③：两个载体都读不到 ⇒ evaluated=false（⛔ 不与「查过且为零」同形，硬规则 3b）。
//   - 配对：有 start 无 end ⇒ unfinished 计到；start+end ⇒ unfinished 归零。
//   - 词表：--phase end 缺 --fallback-outcome ⇒ exit 2（fail-closed，⛔ 不静默写一条读不懂的记录）。
//   - 读不懂的行不进任何计数（坏 JSON / 词表外 phase）。
//
// Run:
//   scripts/test.sh plugin/test/fan-in-semantic-fallback-record.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  SEMANTIC_FALLBACK_LEDGER_REL,
  SEMANTIC_FALLBACK_GATE_ACTOR,
  appendSemanticFallbackRecord,
  aggregateSemanticFallback,
} from "../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.resolve(__dirname, "..", "scripts", "worker-driver.ts");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "smf-"));
}

function rec(root, over) {
  return appendSemanticFallbackRecord(root, {
    ts: "2026-10-07T00:00:00.000Z",
    task: "gap-x",
    runId: null,
    phase: "start",
    outcome: null,
    reason: null,
    actor: SEMANTIC_FALLBACK_GATE_ACTOR,
    ...over,
  });
}

function writeGateEvents(root, records) {
  const file = path.join(root, ".quay", "gate-events.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return file;
}

function runCli(args) {
  return spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", DRIVER, ...args],
    { encoding: "utf8" },
  );
}

test("writer + reader round-trip: start/end pair reports one landed run", () => {
  const root = tmpRoot();
  rec(root, { phase: "start", runId: "smf-1" });
  rec(root, { phase: "end", runId: "smf-1", outcome: "landed" });
  const r = aggregateSemanticFallback(root);
  assert.equal(r.evaluated, true);
  assert.equal(r.ledgerPresent, true);
  assert.equal(r.gateEventsPresent, false);
  assert.equal(r.attempts, 1);
  assert.equal(r.completions, 1);
  assert.equal(r.runs, 1);
  assert.equal(r.landings, 1);
  assert.equal(r.unfinished, 0, "a paired start/end must leave nothing unfinished");
  assert.deepEqual(r.tasks, ["gap-x"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("unpaired start ⇒ unfinished (ran, no result recorded); red/aborted counted separately", () => {
  const root = tmpRoot();
  rec(root, { phase: "start", runId: "smf-a" }); // never completed
  rec(root, { phase: "start", runId: "smf-b" });
  rec(root, { phase: "end", runId: "smf-b", outcome: "red" });
  rec(root, { phase: "start", runId: "smf-c" });
  rec(root, { phase: "end", runId: "smf-c", outcome: "aborted" });
  const r = aggregateSemanticFallback(root);
  assert.equal(r.attempts, 3);
  assert.equal(r.completions, 2);
  assert.equal(r.runs, 3);
  assert.equal(r.landings, 0);
  assert.equal(r.reds, 1);
  assert.equal(r.aborted, 1);
  assert.equal(r.unfinished, 1, "smf-a started with no end");
  fs.rmSync(root, { recursive: true, force: true });
});

test("NEGATIVE CONTROL (硬规则 4): neither carrier readable ⇒ evaluated=false, NOT zero", () => {
  const root = tmpRoot();
  const r = aggregateSemanticFallback(root);
  assert.equal(r.evaluated, false, "absent carriers must not be conflated with a measured zero");
  assert.equal(r.ledgerPresent, false);
  assert.equal(r.gateEventsPresent, false);
  assert.equal(r.attempts, 0);
  assert.deepEqual(r.gateEventLandings, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("existing carrier: only actor=quay-fan-in-workflow ∧ gate=complete counts as a landing", () => {
  const root = tmpRoot();
  writeGateEvents(root, [
    // the REAL shape (.quay/gate-events.jsonl, 2026-09-24) — this is the semantic-fallback landing
    { id: "e1", item_id: "gap-landed-by-fallback", gate: "complete", actor: SEMANTIC_FALLBACK_GATE_ACTOR, timestamp: "2026-09-24T04:11:49.063Z" },
    // NEGATIVE CONTROL ①: the mechanical path's own complete events must NOT be counted here
    { id: "e2", item_id: "gap-landed-mechanically", gate: "complete", actor: "quay-driver", timestamp: "2026-09-24T05:00:00.000Z" },
    { id: "e3", item_id: "gap-landed-by-cli", gate: "complete", actor: "quay-cli", timestamp: "2026-09-24T05:01:00.000Z" },
    // NEGATIVE CONTROL ②: same actor but a different gate is not a landing
    { id: "e4", item_id: "gap-something", gate: "dod", actor: SEMANTIC_FALLBACK_GATE_ACTOR, timestamp: "2026-09-24T05:02:00.000Z" },
  ]);
  const r = aggregateSemanticFallback(root);
  assert.equal(r.evaluated, true);
  assert.equal(r.ledgerPresent, false, "no new ledger ⇒ attempts 0, but the carrier still answers");
  assert.equal(r.attempts, 0);
  assert.equal(r.gateEventLandings.length, 1, "exactly the one semantic-fallback landing");
  assert.equal(r.gateEventLandings[0].task, "gap-landed-by-fallback");
  assert.equal(r.gateEventLandings[0].ts, "2026-09-24T04:11:49.063Z");
  fs.rmSync(root, { recursive: true, force: true });
});

test("unreadable lines never become readings (bad JSON / out-of-vocabulary phase)", () => {
  const root = tmpRoot();
  const file = path.join(root, SEMANTIC_FALLBACK_LEDGER_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      "{ not json",
      JSON.stringify({ ts: "2026-10-07T00:00:00.000Z", task: "gap-x", phase: "middle", outcome: null }),
      JSON.stringify({ ts: "2026-10-07T00:00:01.000Z", task: "gap-x", phase: "start", runId: "smf-1" }),
    ].join("\n") + "\n",
    "utf8",
  );
  const r = aggregateSemanticFallback(root);
  assert.equal(r.attempts, 1, "only the well-formed start counts");
  assert.equal(r.completions, 0);
  assert.equal(r.firstTs, "2026-10-07T00:00:01.000Z");
  fs.rmSync(root, { recursive: true, force: true });
});

test("CLI write path is fail-closed on missing/invalid arguments", () => {
  const root = tmpRoot();
  const ledger = path.join(root, SEMANTIC_FALLBACK_LEDGER_REL);

  const noTask = runCli(["--record-semantic-fallback", "--root", root, "--phase", "start"]);
  assert.equal(noTask.status, 2, "no --task ⇒ exit 2");
  assert.equal(fs.existsSync(ledger), false, "a refused write must not create the ledger");

  const badPhase = runCli(["--record-semantic-fallback", "--task", "gap-x", "--root", root, "--phase", "middle"]);
  assert.equal(badPhase.status, 2, "out-of-vocabulary --phase ⇒ exit 2");

  const endNoOutcome = runCli(["--record-semantic-fallback", "--task", "gap-x", "--root", root, "--phase", "end"]);
  assert.equal(endNoOutcome.status, 2, "--phase end without --fallback-outcome ⇒ exit 2");

  const startWithOutcome = runCli([
    "--record-semantic-fallback", "--task", "gap-x", "--root", root, "--phase", "start", "--fallback-outcome", "landed",
  ]);
  assert.equal(startWithOutcome.status, 2, "--phase start takes no result ⇒ exit 2");

  assert.equal(fs.existsSync(ledger), false, "no refused invocation may have written a line");
  fs.rmSync(root, { recursive: true, force: true });
});

test("CLI round-trip: write via --record-semantic-fallback, read via --semantic-fallback-report", () => {
  const root = tmpRoot();
  const w1 = runCli(["--record-semantic-fallback", "--task", "gap-x", "--root", root, "--phase", "start", "--run-id", "smf-1"]);
  assert.equal(w1.status, 0, w1.stderr);
  const w2 = runCli(["--record-semantic-fallback", "--task", "gap-x", "--root", root, "--phase", "end", "--fallback-outcome", "landed", "--run-id", "smf-1"]);
  assert.equal(w2.status, 0, w2.stderr);

  const q = runCli(["--semantic-fallback-report", "--root", root]);
  assert.equal(q.status, 0, q.stderr);
  const report = JSON.parse(q.stdout);
  assert.equal(report.evaluated, true);
  assert.equal(report.attempts, 1);
  assert.equal(report.landings, 1);
  assert.equal(report.unfinished, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
