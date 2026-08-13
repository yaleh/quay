// @test-group engine
// session-liveness-decision-import.test.mjs — session-liveness 决策层 import 直调测试
// (gap-session-liveness-decision-import-refactor, 2026-08-13)
//
// session-liveness.sh 的 108 分支里绝大多数是纯判定（pane 文本 + transcript 状态 + 阈值 → 发哪个
// 事件），旧覆盖只能靠起真 tmux（load-sensitive、对负载不免疫）。本任务把【判定】迁入
// pane-state-classify.ts（纯函数，importable）。本文件按任务 AC1 的测试分层：
//   * 决策测试（本文件）—— pane 文本 + transcript 状态 + 阈值 → 该发哪个事件：import 直调、
//     零真实时间、对负载免疫（不 sleep、不起 tmux、不写 /tmp 残留）。
//   * 管道测试（session-liveness-*-*.test.mjs）—— 循环真在轮询吗 / capture 真拿到吗 / 文件真写吗：
//     少量真实时间用例，预算只防挂死（不判对错）。
// 判定语义逐一镜像 session-liveness.sh 原 bash grep/tail 实现（tail 窗口、停止条件、缺省值），并
// 用少量 golden-replay（import 直调 vs shell 接缝输出逐字节一致）证明等价（AC4 断言不变）。
//
// Run: node --test plugin/test/session-liveness-decision-import.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  transcriptLastMessageType,
  trailingApiErrorCount,
  transcriptCacheReadTokens,
  lastMessageIsUnansweredInput,
  transcriptContextSaturation,
  lastUserInputEpoch,
  transcriptBusyFromMessageType,
  fusedIdle,
  idleReportReady,
  resumedReportReady,
  permPromptWarnVerdict,
  classifyPaneVerdict,
} from "../scripts/pane-state-classify.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "session-liveness.sh");

// ── synthetic transcript records (same shapes the shell seam tests use) ───────────────────────────
const userRecord = (ts, content = "hello") =>
  JSON.stringify({ type: "user", message: { role: "user", content }, timestamp: ts });
const assistantRecord = (ts, text = "ok") =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, timestamp: ts });
const apiErrorRecord = (ts) =>
  JSON.stringify({ type: "assistant", isApiErrorMessage: true, apiErrorStatus: 429,
    message: { role: "assistant", content: [{ type: "text", text: "API Error: Request rejected (429)" }] }, timestamp: ts });
const assistantToolUseRecord = (ts) =>
  JSON.stringify({ type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "true" } }] },
    timestamp: ts });
const assistantTextRecord = (ts, text = "ok") =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] }, timestamp: ts });
const userInputRecord = (ts, content = "hello") =>
  JSON.stringify({ type: "user", message: { role: "user", content }, timestamp: ts });
const assistantUsageRecord = (ts, cacheRead) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
    usage: { input_tokens: 89, cache_creation_input_tokens: 0, cache_read_input_tokens: cacheRead, output_tokens: 111 },
    timestamp: ts });
const isoAgo = (min) => new Date(Date.now() - min * 60000).toISOString();
const writeTranscript = (file, records) => fs.writeFileSync(file, records.join("\n") + "\n");
const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } };
/** Read a transcript the same way the classifier seam does: split("\n"), drop the ONE trailing "" a
 * final newline produces (tail's line semantics — a trailing newline is not an extra empty line). */
const readTranscriptLines = (file) => {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

// ── transcriptLastMessageType ─────────────────────────────────────────────────────────────────────

test("transcriptLastMessageType — last MESSAGE type drives busy/idle (stage-3 AC1)", () => {
  assert.equal(transcriptLastMessageType([]), "unknown", "no records → unknown");
  assert.equal(transcriptLastMessageType([assistantToolUseRecord(isoAgo(0.1))]), "pending-tool-use",
    "assistant + tool_use block = pending-tool-use (确定忙)");
  assert.equal(transcriptLastMessageType([assistantTextRecord(isoAgo(0.1))]), "pure-text",
    "assistant pure text = pure-text (候选闲)");
  assert.equal(transcriptLastMessageType([userInputRecord(isoAgo(0.1))]), "user-input",
    "user record = user-input (按忙处理, AC5 防漏报方向)");
  // 最后一条消息是 assistant 纯文本，但文件尾有元数据（last-prompt）——必须跳过元数据找真消息
  assert.equal(
    transcriptLastMessageType([assistantTextRecord(isoAgo(0.2)), JSON.stringify({ type: "last-prompt", lastPrompt: "x" })]),
    "pure-text", "trailing metadata (last-prompt) must be skipped; the last MESSAGE wins");
  // the LAST message wins; user checked before assistant (case order in the bash original)
  assert.equal(transcriptLastMessageType([assistantTextRecord(isoAgo(0.1)), userInputRecord(isoAgo(0.05))]), "user-input");
  // metadata records are not messages
  assert.equal(transcriptLastMessageType([JSON.stringify({ type: "mode", mode: "normal" })]), "unknown");
  // a content-block tool_use does NOT make a pure-text line pending — only a top-level assistant
  // record's content block counts, and assistantTextRecord has none
  assert.equal(transcriptLastMessageType([assistantTextRecord(isoAgo(0.1))]), "pure-text");
});

// ── trailingApiErrorCount ─────────────────────────────────────────────────────────────────────────

test("trailingApiErrorCount — counts TRAILING isApiErrorMessage only (AC9 / D4 timeliness)", () => {
  const err = (t) => apiErrorRecord(t);
  const ok = (t) => assistantTextRecord(t);
  const lines = [ok(isoAgo(3)), err(isoAgo(2)), err(isoAgo(1))];
  assert.equal(trailingApiErrorCount(lines), 2, "two trailing errors count");
  // a success boundary resets the count (D4: a recovered idle returns to plain SESSION-IDLE)
  const recovered = [err(isoAgo(3)), ok(isoAgo(2)), err(isoAgo(1))];
  assert.equal(trailingApiErrorCount(recovered), 1, "only trailing errors after the last success count");
  // metadata lines are skipped, not a boundary
  const withMeta = [ok(isoAgo(3)), err(isoAgo(2)), JSON.stringify({ type: "last-prompt", lastPrompt: "x" }), err(isoAgo(1))];
  assert.equal(trailingApiErrorCount(withMeta), 2, "metadata skipped between two trailing errors");
  assert.equal(trailingApiErrorCount([]), 0, "empty → 0");
  // the window slices the tail (mirrors `tail -n WINDOW | tac`)
  assert.equal(trailingApiErrorCount(lines, 1), 1, "window=1 sees only the newest error");
  assert.equal(trailingApiErrorCount(lines, 2), 2, "window=2 sees both");
  assert.equal(trailingApiErrorCount(lines, 200), 2, "default window sees all");
});

// ── transcriptCacheReadTokens / lastMessageIsUnansweredInput / transcriptContextSaturation ────────

test("transcriptCacheReadTokens — last usage.cache_read_input_tokens (stage-4 AC3)", () => {
  assert.equal(transcriptCacheReadTokens([]), null, "no records → null");
  assert.equal(transcriptCacheReadTokens([assistantTextRecord(isoAgo(0.1))]), null, "no usage record → null");
  assert.equal(transcriptCacheReadTokens([assistantUsageRecord(isoAgo(0.1), 600000)]), 600000);
  // the LAST usage record wins
  assert.equal(
    transcriptCacheReadTokens([assistantUsageRecord(isoAgo(0.2), 50000), assistantUsageRecord(isoAgo(0.1), 600000)]),
    600000);
});

test("lastMessageIsUnansweredInput — last message is user ⇒ unanswered (AC4)", () => {
  assert.equal(lastMessageIsUnansweredInput([userInputRecord(isoAgo(0.1))]), true);
  assert.equal(lastMessageIsUnansweredInput([assistantTextRecord(isoAgo(0.1))]), false);
  assert.equal(lastMessageIsUnansweredInput([assistantToolUseRecord(isoAgo(0.1))]), false);
  assert.equal(lastMessageIsUnansweredInput([]), false, "unknown → not unanswered");
});

test("transcriptContextSaturation — composite: high cache + unanswered user input (stage-4 AC4)", () => {
  const sat = [assistantUsageRecord(isoAgo(0.1), 600000), userInputRecord(isoAgo(0.05))];
  const answering = [userInputRecord(isoAgo(0.2)), assistantUsageRecord(isoAgo(0.05), 600000)];
  const healthy = [assistantUsageRecord(isoAgo(0.1), 50000), userInputRecord(isoAgo(0.05))];
  assert.equal(transcriptContextSaturation(sat, 450000), "saturated", "high context + unanswered = saturated (正控制)");
  assert.equal(transcriptContextSaturation(answering, 450000), "unsaturated", "high context but answering = unsaturated (auto-compact 正常)");
  assert.equal(transcriptContextSaturation(healthy, 450000), "unsaturated", "low context + unanswered = unsaturated (负控制)");
  assert.equal(transcriptContextSaturation([], 450000), "unknown", "no usage record → unknown (静默不猜)");
  // the threshold is a knob
  assert.equal(transcriptContextSaturation(healthy, 50000), "saturated", "SATURATION_TOKENS=50000 makes the 50000-cache read saturated");
});

test("lastUserInputEpoch — epoch of the last type=user record (AC7)", () => {
  assert.equal(lastUserInputEpoch([]), null);
  const ts = "2026-08-13T00:00:00Z";
  assert.equal(lastUserInputEpoch([userRecord(ts)]), Math.floor(Date.parse(ts) / 1000));
  // the last user record wins
  const later = "2026-08-13T00:05:00Z";
  assert.equal(lastUserInputEpoch([userRecord(ts), userRecord(later)]), Math.floor(Date.parse(later) / 1000));
  // assistant / metadata lines don't count as user input
  assert.equal(lastUserInputEpoch([assistantTextRecord(ts)]), null);
});

// ── event-decision helpers (moved from the main loop) ─────────────────────────────────────────────

test("transcriptBusyFromMessageType + fusedIdle — fused busy/idle (stage-3 AC1/AC5)", () => {
  assert.equal(transcriptBusyFromMessageType("pending-tool-use"), true);
  assert.equal(transcriptBusyFromMessageType("user-input"), true);
  assert.equal(transcriptBusyFromMessageType("pure-text"), false);
  assert.equal(transcriptBusyFromMessageType("unknown"), false);
  // zero idle-miss: a pending tool_use must never report idle even with an idle pane
  assert.equal(fusedIdle(false, transcriptBusyFromMessageType("pending-tool-use")), false);
  assert.equal(fusedIdle(true, transcriptBusyFromMessageType("pure-text")), false, "busy pane → not idle");
  assert.equal(fusedIdle(false, transcriptBusyFromMessageType("pure-text")), true, "both idle → idle");
});

test("idleReportReady / resumedReportReady — D5 debounce report gates (2026-08-08)", () => {
  // IDLE: consecutive fused-idle ≥ debounceRounds, this spell not yet reported, past the warm-up round
  assert.equal(idleReportReady({ idle: true, idleConsec: 2, idleReported: false, rounds: 2, debounceRounds: 2 }), true);
  assert.equal(idleReportReady({ idle: true, idleConsec: 2, idleReported: true, rounds: 2, debounceRounds: 2 }), false,
    "already reported this spell (IDLE_REPORTED edge)");
  assert.equal(idleReportReady({ idle: true, idleConsec: 1, idleReported: false, rounds: 2, debounceRounds: 2 }), false,
    "below the debounce depth");
  assert.equal(idleReportReady({ idle: true, idleConsec: 3, idleReported: false, rounds: 2, debounceRounds: 2 }), true,
    "-ge (not -eq): the counter keeps matching past the threshold — one spell's report right is not destroyed");
  assert.equal(idleReportReady({ idle: false, idleConsec: 2, idleReported: false, rounds: 2, debounceRounds: 2 }), false,
    "not idle");
  assert.equal(idleReportReady({ idle: true, idleConsec: 2, idleReported: false, rounds: 1, debounceRounds: 2 }), false,
    "warm-up round (ROUNDS>1) suppresses");
  // RESUMED: the busy spell must be confirmed ≥ debounceRounds and past the warm-up round
  assert.equal(resumedReportReady({ resumePending: true, busyConsec: 2, rounds: 2, debounceRounds: 2 }), true);
  assert.equal(resumedReportReady({ resumePending: true, busyConsec: 1, rounds: 2, debounceRounds: 2 }), false,
    "1-round busy blip does not produce an orphan RESUMED (D3 same-depth)");
  assert.equal(resumedReportReady({ resumePending: false, busyConsec: 2, rounds: 2, debounceRounds: 2 }), false,
    "not pending");
  assert.equal(resumedReportReady({ resumePending: true, busyConsec: 2, rounds: 1, debounceRounds: 2 }), false,
    "warm-up round suppresses");
});

// ── permPromptWarnVerdict / classifyPaneVerdict ───────────────────────────────────────────────────

test("permPromptWarnVerdict — candidate B pure verdict (AC4 no-infinite-silence fallback)", () => {
  assert.equal(permPromptWarnVerdict(3, 120), "warn", "stale transcript (120s > 60s window) at the round threshold ⇒ warn");
  assert.equal(permPromptWarnVerdict(3, 10), "ok", "fresh transcript (10s ≤ 60s window) = cross positive control ⇒ ok");
  assert.equal(permPromptWarnVerdict(2, 120), "ok", "below the consecutive-rounds threshold ⇒ ok");
  assert.equal(permPromptWarnVerdict(3, -1), "ok", "no transcript (-1) ⇒ ok (never warn on unconfirmed)");
  assert.equal(permPromptWarnVerdict(2, 120, { warnRounds: 2 }), "warn", "warnRounds knob");
  assert.equal(permPromptWarnVerdict(3, 120, { txWindow: 200 }), "ok", "txWindow knob: 120 ≤ 200 is fresh");
});

test("classifyPaneVerdict — full pane verdict mapping (AC5 anti-filter + intervention single-listing)", () => {
  const idle = "────\n❯ \n────\n  ⏵⏵ bypass permissions on · 1 monitor · ↓ to manage";
  const busy = "────\n❯ \n────\n  ⏵⏵ bypass permissions on · 1 monitor · esc to interrupt · ↓ to manage";
  const perm = "Quick safety check: Is this a project you created or one you trust?\nEnter to confirm";
  assert.deepEqual(
    classifyPaneVerdict(""),
    { state: "unknown", busy: true, intervention: false, work_in_flight: false, region_empty: true },
    "empty capture ⇒ busy (AC5 anti-filter: nothing to judge is never silently idle)");
  assert.equal(classifyPaneVerdict(idle).state, "waiting-input");
  assert.equal(classifyPaneVerdict(idle).busy, false, "waiting-input ⇒ idle");
  assert.equal(classifyPaneVerdict(busy).state, "busy");
  assert.equal(classifyPaneVerdict(busy).busy, true, "busy shape ⇒ busy");
  assert.equal(classifyPaneVerdict(perm).state, "permission-prompt");
  assert.equal(classifyPaneVerdict(perm).busy, false, "permission-prompt is NOT busy (gap-permission-prompt-merged-into-busy)");
  assert.equal(classifyPaneVerdict(perm).intervention, true, "permission-prompt ⇒ intervention");
  // blank-only input → empty bottom region ⇒ busy (AC5)
  assert.equal(classifyPaneVerdict("\n\n\n").busy, true, "blank-only pane ⇒ busy");
  assert.equal(classifyPaneVerdict("\n\n\n").region_empty, true);
});

// ── golden-replay: import 直调 vs shell 接缝逐字节一致（AC4 断言不变）────────────────────────────

test("golden-replay — import 直调与 shell 接缝逐字节一致（AC4 断言不变）", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sl-dec-import-"));
  try {
    const cases = {
      "pend.jsonl": [assistantToolUseRecord(isoAgo(0.1))],
      "pure.jsonl": [assistantTextRecord(isoAgo(0.1))],
      "user.jsonl": [userInputRecord(isoAgo(0.1))],
      "meta.jsonl": [assistantTextRecord(isoAgo(0.2)), JSON.stringify({ type: "last-prompt", lastPrompt: "x" })],
      "sat.jsonl": [assistantUsageRecord(isoAgo(0.1), 600000), userInputRecord(isoAgo(0.05))],
      "err.jsonl": [assistantTextRecord(isoAgo(3)), apiErrorRecord(isoAgo(2)), apiErrorRecord(isoAgo(1))],
      "empty.jsonl": [],
    };
    for (const [file, records] of Object.entries(cases)) {
      writeTranscript(path.join(tmp, file), records);
      const lines = readTranscriptLines(path.join(tmp, file));
      // --last-message-type (stdout only; the version fingerprint goes to stderr)
      const shellLastMt = spawnSync("bash", [SCRIPT, "--last-message-type", path.join(tmp, file)], { encoding: "utf8" }).stdout.trim();
      assert.equal(transcriptLastMessageType(lines), shellLastMt, `${file}: last-message-type import == shell`);
      // --api-errors
      const shellApi = spawnSync("bash", [SCRIPT, "--api-errors", path.join(tmp, file)], { encoding: "utf8" }).stdout.trim();
      assert.equal(String(trailingApiErrorCount(lines)), shellApi, `${file}: api-errors import == shell`);
      // --last-message-type is the ONLY seam that reads the file twice in the shell; --saturation
      // report formatting lives in the shell, but its saturation VERDICT comes from the classifier.
      const shellSat = spawnSync("bash", [SCRIPT, "--saturation", path.join(tmp, file)], { encoding: "utf8" }).stdout.trim();
      const expectedSat = transcriptContextSaturation(lines, 450000);
      if (expectedSat === "unknown") {
        assert.match(shellSat, /^unknown/, `${file}: saturation unknown import == shell`);
      } else {
        assert.ok(shellSat.startsWith(expectedSat), `${file}: saturation import==${expectedSat} shell==${shellSat}`);
      }
    }
    // --perm-warn-verdict golden-replay
    for (const [rounds, txAge, expected] of [[3, 120, "warn"], [3, 10, "ok"], [2, 120, "ok"], [3, -1, "ok"]]) {
      const shell = spawnSync("bash", [SCRIPT, "--perm-warn-verdict", String(rounds), String(txAge)], { encoding: "utf8" }).stdout.trim();
      assert.equal(permPromptWarnVerdict(rounds, txAge), shell, `perm-warn-verdict(${rounds},${txAge}) import == shell`);
      assert.equal(shell, expected, `perm-warn-verdict(${rounds},${txAge}) shell == ${expected}`);
    }
  } finally {
    cleanup(tmp);
  }
});
