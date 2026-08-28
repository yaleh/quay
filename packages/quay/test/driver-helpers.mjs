// @test-group product
// driver-helpers.mjs — shared helpers for the driver test family.
//
// Split out of driver.test.mjs (gap-suite-split-long-multi-test-files): the original 466-line file
// carried 23 independent node:test cases (Phase A pure-module via stub client + tmp logPath, and
// Phase C the real `quay run` CLI against a disposable native-provider workspace). Splitting lets
// node:test's file-level concurrency run them in PARALLEL instead of one long sequential lane.
// Shared helpers live here so every split file resolves the SAME driver surface (the
// session-liveness split pattern, session-liveness-helpers.mjs).
//
// SPLIT CONCURRENCY SAFETY: Phase A uses a stub client (in-memory, per-test) + a per-tag tmp
// logPath; Phase C uses makeTmpWorkspace with a per-tag tmp dir. Every dir is registered with the
// tmp-workspace helper's per-importing-file after() hook, so each split file cleans up only the
// dirs IT created — no sibling file can collide. process.exitCode (resetExit) is a per-process
// global, isolated because each split file is its own node process.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

import { makeTmpDir, makeTmpWorkspace } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const quayBin = QUAY_CLI;
export const nativeBin = QUAY_NATIVE_CLI;
export const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

// tasks: [{ id, status, extra }]. taskCheck reads extra.acceptance:
//   "true" => pass, anything else => fail — matching the acceptance meter's
//   contract (a runnable command; here the meter value IS the verdict).
export function stubClient(tasks) {
  const state = new Map(tasks.map((t) => [t.id, { ...t }]));
  return {
    async taskList({ status } = {}) {
      return {
        tasks: [...state.values()]
          .filter((t) => !status || t.status === status)
          .map((t) => ({ ...t })),
        malformed: [],
      };
    },
    async taskGet(id) {
      const t = state.get(id);
      return t ? { ...t } : null;
    },
    async taskCheck(id) {
      const m = state.get(id)?.extra?.acceptance;
      return { ok: m === "true", reason: m === "true" ? "ok" : "meter failed" };
    },
    async taskWrite({ id, status, expectedStatus }) {
      const t = state.get(id);
      if (expectedStatus && t.status !== expectedStatus) throw new Error("ConflictError");
      t.status = status;
      return { ...t };
    },
    _state: state,
  };
}

export function tmpLog(tag) {
  const dir = makeTmpDir(`quay-qeng4-${tag}-`);
  return path.join(dir, "gate-events.jsonl");
}

// A disposable cfg.workspaceRoot for runLoop's sentinel path. `stop` pre-creates
// the .quay/.stop sentinel so the loop test is bounded (cannot hang).
export function tmpWorkspace(tag, { stop = false } = {}) {
  const workspaceRoot = makeTmpDir(`quay-qeng4-${tag}-ws-`);
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  if (stop) fs.writeFileSync(path.join(workspaceRoot, ".quay", ".stop"), "");
  return { workspaceRoot };
}

// process.exitCode is a shared global; runComplete (via runOnce/runLoop) sets it.
export function resetExit() {
  process.exitCode = 0;
}

export function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-qeng4-${tag}`, { nativeBin, nativeProviderDir });
}

export function runQuay(args, cwd) {
  try {
    const out = execFileSync("node", [quayBin, ...args], { encoding: "utf8", cwd });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

export function runNative(args, tasksDir) {
  return execFileSync("node", [nativeBin, ...args], {
    encoding: "utf8",
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
}

export const validSections =
  "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
  "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
export const acDodChecked =
  "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
  "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";

// Seed a `ready` task with a runnable acceptance meter (the meter IS what
// `quay run` gates on): passing = "true", failing = "false".
export function seedReadyTask(id, tasksDir, workspaceRoot, meter) {
  runNative(["task", "create", id, "--title", id, "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", id, "--acceptance", meter], workspaceRoot);
}
