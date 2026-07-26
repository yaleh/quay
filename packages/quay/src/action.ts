// The host-owned trigger edge (proposal §6.4, design §7). NOT part of the
// Provider ABI. `quay action run` composes a payload from the Provider's
// declared action_buttons / status_skill_map (read from provider.yml, since
// that's peripheral config, not a runtime ABI call) and delivers it via
// whatever environment binding is available:
//   mock log file requested  -> write a structured JSON-lines record (deterministic,
//                                network-independent — see QN-042/DIR-009)
//   manda present            -> dispatch into a background worker session (async)
//   Claude Code, no manda    -> run inline / spawn one subagent (sync)
//   plain CLI, no agent      -> print the command (degrade)
//
// QN-042 (DIR-009) added the mock/file-log mode below as a THIRD, additive
// delivery mode, distinct from both the `manda` path and the stdout-print
// degrade path. It exists so automated tests of action-composition/delivery
// logic have a deterministic, structured, network-independent record to
// assert against, instead of either scraping stdout or gating pass/fail on a
// live manda session (per DIR-008/§2.3's standing constraint — see
// `experiments/quay-native-bootstrap/directives/archive/DIR-004-*.md` and `DIR-005-*.md`: live manda
// delivery has repeatedly been shown to be a per-session, per-moment fact,
// not a reliably available one, and this mode's whole purpose is to
// sidestep that, not re-verify it). It does NOT change `mandaAvailable()`
// or either existing path's behavior.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

export function composePayload({ providerManifest, task, actionId }) {
  const button = (providerManifest.action_buttons ?? []).find((b) => b.id === actionId);
  if (!button) {
    throw new Error(`no such action button: ${actionId}`);
  }
  if (typeof button.payload !== 'string' || button.payload.trim() === '') {
    throw new Error(`action button '${actionId}' has no payload defined in provider manifest`);
  }
  const skill = providerManifest.status_skill_map?.[task.status];
  const payload = button.payload.replaceAll("{{id}}", task.id);
  return { label: button.label, payload, skill, taskId: task.id, status: task.status };
}

/** Detect whether a manda daemon is armed for this workspace root. */
export async function mandaAvailable(root) {
  try {
    await execFileAsync("manda", ["events", "health", "--root", root], {
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Append one structured delivery record (JSON-lines: one JSON object per
 * line) to `mockLogPath`, creating the file (and its parent directory) if
 * needed. Each record carries at least `channel`, `payload`, and an ISO-8601
 * `timestamp` field, so an automated test can parse and assert on it
 * precisely rather than scraping freeform stdout text (QN-042/DIR-009,
 * requested action item 1).
 */
function appendMockDeliveryRecord({ mockLogPath, channel, payloadObj }) {
  const dir = path.dirname(mockLogPath);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    channel,
    payload: payloadObj.payload,
    taskId: payloadObj.taskId,
    status: payloadObj.status,
    skill: payloadObj.skill,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(mockLogPath, JSON.stringify(record) + "\n", "utf8");
  return record;
}

/**
 * Deliver a trigger. The manda-present path dispatches via
 * `manda-dispatch submit --to=worker` (DIR-005 item 1 — experiment 4,
 * 2026-07-17), routing to the `pending-worker` channel; a real
 * `manda monitor worker --root .` session subscribed via
 * `.manda/config.yml`'s `cross-session` adapter binding is the confirmed
 * consumer. (Superseded the earlier v0 walking-skeleton behavior of a raw
 * `manda send` on the task's own per-task channel, which had no confirmed
 * subscriber.) The plain-CLI degrade path prints the composed command for a
 * human/agent to run manually.
 *
 * QN-042 (DIR-009): if `mockLogPath` is supplied (explicitly, by the
 * caller — e.g. via the `QUAY_ACTION_MOCK_LOG` environment variable read by
 * `bin/quay.js`/`serve.js`, or passed directly by a test), delivery takes
 * this THIRD mode instead of either the `manda` or stdout-degrade path,
 * regardless of whether manda is available. This is a deliberate,
 * explicit-opt-in precedence (the mock mode is for verification harnesses
 * that want a deterministic record, not a silent fallback), and it never
 * touches `mandaAvailable()`'s own detection logic.
 */
export async function deliverTrigger({ root, channel, payloadObj, mockLogPath }) {
  if (mockLogPath) {
    const record = appendMockDeliveryRecord({ mockLogPath, channel, payloadObj });
    return { delivered: "mock", channel, mockLogPath, record };
  }
  const haveManda = await mandaAvailable(root);
  if (haveManda) {
    // DIR-005 item 1: a raw `manda send <channel> <json>` has no confirmed
    // subscriber — the message fires into the void unless something happens
    // to be watching that exact per-task channel at that exact moment.
    // Dispatch to an actual consumer instead, modeled on epicd's
    // `manda-dispatch submit -id=$TASK_ID -to=worker -async -args='{task:...}'`:
    // `--to=worker` routes to the `pending-worker` channel (manda-dispatch's
    // own routing, confirmed via `manda-dispatch submit --help`), which
    // `.manda/config.yml`'s `monitor.bindings` maps to the `cross-session`
    // adapter — consumed by a `manda monitor worker --root .` session.
    const dispatchArgs = JSON.stringify({ task: payloadObj.payload });
    await execFileAsync(
      "manda-dispatch",
      ["submit", `--id=${payloadObj.taskId}`, `--args=${dispatchArgs}`, "--async", "--to=worker"],
      { cwd: root },
    );
    return { delivered: "manda", channel, to: "worker" };
  }
  // Degrade: print the command for the user/agent to run manually.
  console.log(`[quay action run] manda not available — degraded delivery.`);
  console.log(`Run this to drive the task:\n  ${payloadObj.payload}`);
  return { delivered: "print" };
}
