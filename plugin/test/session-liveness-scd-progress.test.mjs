// @test-group serial
// @load-sensitive wall-clock
// @load-sensitive-entry 2026-09-03 wall-clock (real tmux server + claude-probe probes flaky in lowconc — probe establish unstable / starved, reds unrelated fan-in suites); GROUP=serial deliberately
// KNOWN-LOAD-SENSITIVE (session-liveness SCD family — wall-clock tmux probe + session-liveness.sh
// per-round waits; the adaptive HANG_GUARD_MS floor absorbs load).
// session-liveness-scd-progress.test.mjs — split out of session-liveness.test.mjs
// (gap-suite-split-long-multi-test-files): the 新⑤ 合取项 (progress — heartbeat freshness)
// falsifiability — a fresh heartbeat (long task self-driving) ⇒ no emit; a stale heartbeat ⇒ emit.
// Test body byte-identical to the original.
// SPLIT CONCURRENCY SAFETY: this file owns the /tmp prefix "session-liveness-scd-h-" and its
// after() sweeps ONLY it (+ ol-prod-), so it can never delete a sibling file's active probe dir.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  setProbeTmpPrefix, sessionLivenessAfter, makeHermeticProbe, waitForAlive, spawnMonitor,
  waitForOutput, waitForRounds, HANG_GUARD_MS, tmuxAvailable, writeTranscript,
  assistantUsageRecord, userInputRecord, isoAgo, makeRepoWithDevelop,
} from "./session-liveness-helpers.mjs";

setProbeTmpPrefix("session-liveness-scd-h-");

after(() => {
  sessionLivenessAfter("session-liveness-scd-h-", "ol-prod-");
});

test("新⑤ 能取假 — 心跳新鲜（长任务推进中）⇒ 不报 DISABLED；心跳变陈旧（真失能）⇒ 仍报 (progress conjunct can take false)", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const p = makeHermeticProbe("ol-scd-h");
  const repo = path.join(p.tmp, "repo");
  try {
    makeRepoWithDevelop(repo, { backdateMin: 60 });   // develop silent ≥ T=5
    const satX = path.join(p.tmp, "sat.jsonl");
    // 饱和 fixture，但文件 mtime 只回拨 1 分钟（< T=5）⇒ 心跳【新鲜】= 会话在推进（长任务形态）。
    // 分类器读记录内容（isoAgo 时间戳），不读文件 mtime，所以饱和判定不受回拨影响。
    writeTranscript(satX, [assistantUsageRecord(isoAgo(0.1), 600000), userInputRecord(isoAgo(0.05))], 1);
    assert.ok(await waitForAlive(p.env, p.session), "probe must be alive");
    const mon = spawnMonitor({ ...p.env, SATURATION_SILENCE_MIN: "5" },
      `scd-h ${repo} ${p.session}`, { transcripts: `scd-h ${satX}` });
    try {
      // 长任务阶段：旧四元（①-④）全真，只有 ⑤ 因心跳新鲜而取假 ⇒ 不报 DISABLED。
      assert.ok(await waitForRounds(mon, 4, HANG_GUARD_MS),
        `monitor must complete long-task rounds:\n${mon.output()}`);
      assert.ok(!/SESSION-DISABLED scd-h/.test(mon.output()),
        `long task with FRESH heartbeat (session self-driving) MUST NOT emit SESSION-DISABLED — ⑤ is false:\n${mon.output()}`);
      // 真失能阶段：心跳变陈旧 ≥ T ⇒ ⑤ 翻真 ⇒ 复合判据发射（判据3：真失能仍报）。
      spawnSync("touch", ["-d", "10 minutes ago", satX], { encoding: "utf8" });
      assert.ok(await waitForOutput(mon, /SESSION-DISABLED scd-h/, 10000),
        `after the heartbeat goes stale (session genuinely stopped writing) the disabled composite MUST emit — ⑤ can take true:\n${mon.output()}`);
    } finally {
      mon.child.kill("SIGKILL"); mon.cleanup();
    }
  } finally {
    p.cleanup();
  }
});
