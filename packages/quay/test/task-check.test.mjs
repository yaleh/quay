// QN-027 (iteration 13): regression test for provider-client.js's new
// taskCheck() passthrough. Prior to this task, Core had taskList/taskGet/
// taskWrite passthroughs but no taskCheck, so the task_check MCP tool
// (which quay-native's own provider.yml declares as `gate: true`) was never
// exercised through Core's provider-agnostic client at all. This test
// exercises the real passthrough end-to-end against a real quay-native MCP
// server (spun up over stdio, same as abi-symmetry.mjs does), covering both
// the ok:true and ok:false cases, and confirms `connectProvider()`'s
// returned object actually exposes `taskCheck`.
//
// Run: node test/task-check.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { connectProvider } from "../src/provider-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = path.join(__dirname, "..", "..", "quay-native", "bin", "quay-native.js");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function main() {
  const tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-task-check-"));

  // Seed a primitive task with all AC/DoD checked (should pass gate) and a
  // second with unchecked AC (should fail gate) — mirrors gate-correctness's
  // own fixture style, but seeded via the native CLI's `task create` +
  // `task edit --body` convenience (create is CLI-only, not part of the ABI).
  // Each artifact section must exceed MIN_SECTION_CHARS (40 non-whitespace
  // chars, store.js) to count as "present" — short one-word sections would
  // silently fail the gate for an unrelated reason (QN-005 phase 1's own
  // fix), so these fixtures use realistic-length prose per section.
  const validSections =
    "## Proposal\nThis is a sufficiently long proposal section so the gate's minimum-content check passes cleanly.\n" +
    "## Plan\nThis is a sufficiently long plan section so the gate's minimum-content check passes cleanly.\n";
  const acDodChecked =
    "## AC\n- [x] a sufficiently long acceptance criterion line for the minimum-content check\n" +
    "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";
  const acDodUnchecked =
    "## AC\n- [ ] a sufficiently long acceptance criterion line for the minimum-content check\n" +
    "## DoD\n- [ ] a sufficiently long definition-of-done line for the minimum-content check\n";
  execFileSync("node", [nativeBin, "task", "create", "PASS-1", "--title", "Passing task",
    "--body", validSections + acDodChecked], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "FAIL-1", "--title", "Failing task",
    "--body", validSections + acDodUnchecked], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });

  const client = await connectProvider({
    command: "node",
    args: [nativeBin, "mcp"],
    cwd: path.dirname(nativeBin),
    env: { QUAY_NATIVE_TASKS_DIR: tasksDir },
  });

  try {
    assert(typeof client.taskCheck === "function", "connectProvider() exposes a taskCheck function");

    const pass = await client.taskCheck("PASS-1");
    assert(pass !== null, "taskCheck returns a non-null result for an existing task");
    assert(pass.id === "PASS-1", "result.id matches the requested task id");
    assert(pass.ok === true, `fully-checked AC/DoD task gates ok:true (got ok:${pass.ok}, reason:${pass.reason})`);
    assert(typeof pass.reason === "string" && pass.reason.length > 0, "result includes a non-empty reason string");

    const fail = await client.taskCheck("FAIL-1");
    assert(fail.ok === false, `unchecked-AC task gates ok:false (got ok:${fail.ok})`);
    assert(typeof fail.reason === "string" && fail.reason.length > 0, "failing result still includes a reason string");

    // Confirm the passthrough round-trips the whole structuredContent object
    // (not a hand-picked subset) — same key-set as MCP task_check declares,
    // i.e. whatever quay-native's own gate returns is what Core sees, with
    // no field silently dropped along the way (the QN-007 class of bug).
    const keys = Object.keys(pass).sort();
    assert(keys.includes("id") && keys.includes("ok") && keys.includes("reason"),
      `result carries at least id/ok/reason (got keys: ${JSON.stringify(keys)})`);
  } finally {
    await client.close();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nAll QN-027 taskCheck passthrough tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
