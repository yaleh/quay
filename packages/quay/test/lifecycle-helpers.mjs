// @test-group product
// lifecycle-helpers.mjs — shared helpers for the lifecycle test family.
//
// Split out of lifecycle.test.mjs (gap-suite-split-long-multi-test-files): the original 905-line
// file carried 55 independent node:test cases (Phase A pure-module via stub client + tmp logPath,
// and Phase C the real `quay complete|adjudicate|promote|retreat` CLI against a disposable
// native-provider workspace). Splitting lets node:test's file-level concurrency run them in
// PARALLEL instead of one long sequential lane. Shared helpers live here so every split file
// resolves the SAME lifecycle surface (the session-liveness split pattern,
// session-liveness-helpers.mjs).
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

export function stubClient(task) {
  const state = { ...task };
  return {
    async taskGet() {
      return { ...state };
    },
    // taskCheck: ready => fail (stub), anything else => pass (matches plan's stub).
    async taskCheck() {
      return { ok: state.status === "ready" ? false : true, reason: "stub" };
    },
    async taskWrite({ status, expectedStatus, body }) {
      if (expectedStatus && state.status !== expectedStatus) throw new Error("ConflictError");
      state.status = status;
      // Preserve body writes so tests can assert the marker/uncheck landed on the stored task
      // (existing tests pass no body — a bodyless stub stays bodyless).
      if (body !== undefined) state.body = body;
      return { ...state };
    },
    _state: state,
  };
}

export function tmpLog(tag) {
  return path.join(makeTmpDir(`quay-qeng3-${tag}-`), "gate-events.jsonl");
}

// process.exitCode is a shared global; each run* fn sets it. Reset around each
// unit test so an earlier fail-path doesn't leak into a later assertion.
export function resetExit() {
  process.exitCode = 0;
}

export function makeWorkspace(tag) {
  return makeTmpWorkspace(`quay-qeng3-${tag}`, { nativeBin, nativeProviderDir });
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

// exp5-M-GATE-CLI-ERROR-UX (AC1): the guarded illegal-transition throws previously fell through
// to the generic top-level catch, which prints `err.stack` (a raw Node stack trace). The CLI error
// UX tests assert BOTH the clean one-line message AND the absence of any stack frame.
export const STACK_FRAME_PATTERN = /\bat (Object\.|async |\S+\s\()/;

export const SLOT_REFILL_CLI = path.join(__dirname, "..", "..", "..", "plugin", "scripts", "slot-refill.ts");

/** A native-provider workspace whose tasks dir IS `<root>/tasks` — so the same root
 *  can be handed to slot-refill (`--root`) for the detection half of the E2E. */
export function makeSlotNativeWorkspace(tag) {
  const root = makeTmpDir(`quay-qeng3-${tag}-`);
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(root, "code"), { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      `    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"`,
      `    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      `    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]`,
      "    env:",
      `      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"`,
      "",
    ].join("\n")
  );
  return { root, tasksDir };
}
