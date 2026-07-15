// The host-owned trigger edge (proposal §6.4, design §7). NOT part of the
// Provider ABI. `quay action run` composes a payload from the Provider's
// declared action_buttons / status_skill_map (read from provider.yml, since
// that's peripheral config, not a runtime ABI call) and delivers it via
// whatever environment binding is available:
//   manda present            -> dispatch into a background worker session (async)
//   Claude Code, no manda    -> run inline / spawn one subagent (sync)
//   plain CLI, no agent      -> print the command (degrade)

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function composePayload({ providerManifest, task, actionId }) {
  const button = (providerManifest.action_buttons ?? []).find((b) => b.id === actionId);
  if (!button) {
    throw new Error(`no such action button: ${actionId}`);
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
 * Deliver a trigger. v0 (walking skeleton, G5): the manda-present path
 * sends a manda message on the task's own channel; a real background worker
 * session subscribed to that channel is the seed-driven consumer for
 * iteration 0 (see experiment/iterations/iteration-0.md — the seed stands in
 * for quay:author/quay:execute at σ=0). The plain-CLI degrade path prints
 * the composed command, which is exactly what iteration 0 exercises when run
 * non-interactively.
 */
export async function deliverTrigger({ root, channel, payloadObj }) {
  const haveManda = await mandaAvailable(root);
  if (haveManda) {
    const json = JSON.stringify(payloadObj);
    await execFileAsync("manda", ["send", channel, json], { cwd: root });
    return { delivered: "manda", channel };
  }
  // Degrade: print the command for the user/agent to run manually.
  console.log(`[quay action run] manda not available — degraded delivery.`);
  console.log(`Run this to drive the task:\n  ${payloadObj.payload}`);
  return { delivered: "print" };
}
