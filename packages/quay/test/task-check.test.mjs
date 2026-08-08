// @test-group product
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
// QN-072 (iteration 86): added compound (epic) `childrenStatus`-rollup
// coverage — see that block's own comment below for the specific,
// previously-uncovered gap it closes (Core's taskCheck() passthrough had
// never been exercised for a compound task, on either Provider, despite
// store.js#check()/github-client.js#checkGate() both having compound-aware
// branches since QN-012/QN-035).
//
// Run: node test/task-check.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { connectProvider } from "../src/provider-client.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
// Pinned to the SOURCE bin dir (not path.dirname(nativeBin), which resolves to dist/ when
// the prebuilt bundle is fresh) — same definition as unparseable-frontmatter /
// build-dist-smoke / serve-github / serve.test.mjs. 98e23f5b deleted this definition while
// leaving the `cwd: nativeProviderDir` usage below, producing a ReferenceError in the full
// suite; restored here per gap-task-check-test-nativeproviderdir-undefined.
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

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
  // gap-both-gates-read-one-signal-so-done-costs-nothing: an UNCHECKED AC box
  // no longer fails author->ready (checked-state belongs to ready->done), so
  // the old FAIL-1 fixture (acDodUnchecked) would now PASS. A genuine
  // author->ready failure is an AC section with NO machine-checkable
  // checkboxes at all.
  const acNoCheckbox =
    "## AC\nThis acceptance criteria section is written in prose only, with no machine-checkable checkbox lines at all, comfortably past forty non-whitespace characters.\n" +
    "## DoD\n- [x] a sufficiently long definition-of-done line for the minimum-content check\n";
  execFileSync("node", [nativeBin, "task", "create", "PASS-1", "--title", "Passing task",
    "--body", validSections + acDodChecked], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });
  execFileSync("node", [nativeBin, "task", "create", "FAIL-1", "--title", "Failing task",
    "--body", validSections + acNoCheckbox], {
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
  });

  const client = await connectProvider({
    command: "node",
    args: [nativeBin, "mcp"],
    // Run the MCP server from the source bin dir so any relative provider paths resolve
    // (A-layer spawn conversion intent — nativeProviderDir is pinned to the SOURCE bin dir).
    cwd: nativeProviderDir,
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
    assert(fail.ok === false, `AC-no-checkbox task gates ok:false (got ok:${fail.ok}, reason:${fail.reason})`);
    assert(typeof fail.reason === "string" && fail.reason.length > 0, "failing result still includes a reason string");

    // Confirm the passthrough round-trips the whole structuredContent object
    // (not a hand-picked subset) — same key-set as MCP task_check declares,
    // i.e. whatever quay-native's own gate returns is what Core sees, with
    // no field silently dropped along the way (the QN-007 class of bug).
    const keys = Object.keys(pass).sort();
    assert(keys.includes("id") && keys.includes("ok") && keys.includes("reason"),
      `result carries at least id/ok/reason (got keys: ${JSON.stringify(keys)})`);

    // QN-069 (iteration 66): QN-068 (iteration 64) added direct-Provider unit
    // test coverage for the gate's `needs-human` soft-stop and unrecognized-
    // status fallthrough shapes on both store.js#check() and
    // github-client.js#checkGate() directly, but never touched Core's own
    // generic taskCheck() passthrough (provider-client.js) at all. This is a
    // distinct, previously-uncovered path: does Core's passthrough forward
    // these two shapes unchanged, end-to-end over a real MCP connection?
    // Both new task files are hand-edited on disk (bypassing store.write()'s
    // own VALID_STATUSES write-time guard), the same disclosed technique
    // QN-068 used directly against store.js, applied here one layer up
    // through Core's client instead.
    execFileSync("node", [nativeBin, "task", "create", "NH-1", "--title", "Needs-human task",
      "--body", validSections + acDodUnchecked], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const nhFile = path.join(tasksDir, "NH-1.md");
    fs.writeFileSync(nhFile, fs.readFileSync(nhFile, "utf8").replace("status: todo", "status: needs-human"));

    const needsHuman = await client.taskCheck("NH-1");
    assert(
      needsHuman.gate === "none" && needsHuman.ok === false &&
        needsHuman.reason === "soft stop; human action required",
      `Core's taskCheck() passthrough surfaces the needs-human soft-stop shape unchanged ` +
        `(got: ${JSON.stringify(needsHuman)})`
    );

    execFileSync("node", [nativeBin, "task", "create", "BAD-1", "--title", "Bogus-status task",
      "--body", validSections + acDodUnchecked], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const badFile = path.join(tasksDir, "BAD-1.md");
    fs.writeFileSync(badFile, fs.readFileSync(badFile, "utf8").replace("status: todo", "status: bogus-status-value"));

    const unrecognized = await client.taskCheck("BAD-1");
    assert(
      unrecognized.gate === "unknown" && unrecognized.ok === false &&
        unrecognized.reason === "unrecognized status bogus-status-value",
      `Core's taskCheck() passthrough surfaces the unrecognized-status shape unchanged ` +
        `(got: ${JSON.stringify(unrecognized)})`
    );

    // QN-072 (iteration 86): a genuinely distinct, previously-uncovered
    // passthrough shape — the COMPOUND (epic) `childrenStatus` rollup.
    // QN-012 (iteration 6) made store.js#check() compound-aware
    // (childrenStatus/stale-done/missing-child branches), and
    // compound-gate.test.mjs/compound-gate-recursive.test.mjs both
    // thoroughly exercise that logic directly against store.js — but
    // neither those files nor this one (QN-027/QN-069, until now) nor
    // mcp-server.test.mjs ever call Core's own generic taskCheck()
    // passthrough (provider-client.js) for a compound task. Confirmed by
    // grep across every *.test.mjs in the repo before writing this: no
    // existing test connects `childrenStatus`/`stale-done` fixture data to
    // a `connectProvider()`/`quay mcp` call. This is the same class of gap
    // QN-069/QN-071 closed (Core-passthrough fidelity for a Provider gate
    // shape, not yet proven to survive the extra MCP hop) applied to the
    // one remaining untested `check()` branch shape: the epic rollup.
    execFileSync("node", [nativeBin, "task", "create", "CHILD-DONE", "--title", "Compound-fixture child (done)",
      "--status", "done", "--body", validSections + acDodChecked], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    execFileSync("node", [nativeBin, "task", "create", "CHILD-TODO", "--title", "Compound-fixture child (still todo)",
      "--body", validSections + acDodUnchecked], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    execFileSync("node", [nativeBin, "task", "create", "EPIC-STALE-DONE", "--title", "Epic marked done but a child regressed",
      "--status", "done", "--body", validSections + acDodChecked], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    execFileSync("node", [nativeBin, "task", "edit", "EPIC-STALE-DONE", "--children", "CHILD-DONE,CHILD-TODO"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });

    const staleDone = await client.taskCheck("EPIC-STALE-DONE");
    assert(
      staleDone.gate === "none" && staleDone.ok === false &&
        typeof staleDone.reason === "string" &&
        staleDone.reason.includes("CHILD-TODO") &&
        Array.isArray(staleDone.childrenStatus) &&
        staleDone.childrenStatus.length === 2,
      `Core's taskCheck() passthrough surfaces the compound "done but a child regressed" ` +
        `shape unchanged, including the childrenStatus array (got: ${JSON.stringify(staleDone)})`
    );

    execFileSync("node", [nativeBin, "task", "create", "EPIC-ALL-DONE", "--title", "Epic with all children genuinely done",
      "--status", "done", "--body", validSections + acDodChecked], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    execFileSync("node", [nativeBin, "task", "edit", "EPIC-ALL-DONE", "--children", "CHILD-DONE"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const allDone = await client.taskCheck("EPIC-ALL-DONE");
    assert(
      allDone.gate === "none" && allDone.ok === true &&
        Array.isArray(allDone.childrenStatus) && allDone.childrenStatus.length === 1 &&
        allDone.childrenStatus[0].id === "CHILD-DONE" && allDone.childrenStatus[0].status === "done",
      `Core's taskCheck() passthrough surfaces the compound "all children done" positive ` +
        `shape unchanged, including per-child ids/statuses (got: ${JSON.stringify(allDone)})`
    );

    // Adversarial: confirm this new coverage has real teeth, not merely
    // exercising already-tested machinery under a new name — sever the
    // parent/child link (edit EPIC-STALE-DONE to zero children) and confirm
    // Core's passthrough now reports the unconditional-done shape instead
    // (no childrenStatus field, ok:true, reason:"terminal"), proving the
    // childrenStatus assertion above was actually load-bearing.
    execFileSync("node", [nativeBin, "task", "edit", "EPIC-STALE-DONE", "--children", ""], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const severed = await client.taskCheck("EPIC-STALE-DONE");
    assert(
      severed.ok === true && severed.reason === "terminal" && severed.childrenStatus === undefined,
      `adversarial check: severing EPIC-STALE-DONE's children makes Core's passthrough report ` +
        `the plain-leaf terminal shape (got: ${JSON.stringify(severed)}), confirming the prior ` +
        `compound-shape assertions were genuinely exercising the childrenStatus rollup, not a ` +
        `coincidental pass`
    );

    // QN-073 (iteration 87): a distinct, previously-uncovered passthrough
    // shape one branch over from QN-072's — the `status: ready` compound
    // (epic) rollup, i.e. the execute->done gate (store.js#check()'s
    // `t.status === "ready"` branch), NOT the done-terminal branch QN-072
    // covered. This is genuinely different code (a separate `if` block in
    // store.js, guarded by its own `childrenOk` computation) and, unlike
    // QN-072's `done`-branch rollup (which is purely informational/
    // corrective metadata on an already-`ok`-computed result), here
    // `childrenOk` is directly ANDed into the gate's own `ok` value
    // (`const ok = acOk && childrenOk`) — i.e. a false-negative or
    // false-positive bug in this branch would silently let (or block) a
    // real ready->done transition, not just omit informational metadata.
    // Confirmed via grep before writing this: no existing test (this file,
    // compound-gate.test.mjs, compound-gate-recursive.test.mjs, or
    // mcp-server.test.mjs) connects a `status: ready` compound fixture to
    // Core's taskCheck() passthrough over a real MCP connection —
    // compound-gate.test.mjs's own Cases 4/5 (ready-compound) call
    // store.check() directly, never through provider-client.js.
    execFileSync("node", [nativeBin, "task", "create", "EPIC-READY-CHILD-TODO", "--title", "Ready epic blocked on a child",
      "--status", "ready", "--body", validSections + acDodChecked], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    execFileSync("node", [nativeBin, "task", "edit", "EPIC-READY-CHILD-TODO", "--children", "CHILD-DONE,CHILD-TODO"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const readyBlocked = await client.taskCheck("EPIC-READY-CHILD-TODO");
    assert(
      readyBlocked.gate === "execute->done" && readyBlocked.ok === false &&
        typeof readyBlocked.reason === "string" &&
        readyBlocked.reason.includes("CHILD-TODO") &&
        Array.isArray(readyBlocked.childrenStatus) && readyBlocked.childrenStatus.length === 2,
      `Core's taskCheck() passthrough surfaces the ready-compound "AC complete but a child ` +
        `still todo" shape unchanged, including the childrenStatus array (got: ${JSON.stringify(readyBlocked)})`
    );

    execFileSync("node", [nativeBin, "task", "create", "EPIC-READY-ALL-DONE", "--title", "Ready epic with all children done",
      "--status", "ready", "--body", validSections + acDodChecked], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    execFileSync("node", [nativeBin, "task", "edit", "EPIC-READY-ALL-DONE", "--children", "CHILD-DONE"], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const readyAllDone = await client.taskCheck("EPIC-READY-ALL-DONE");
    assert(
      readyAllDone.gate === "execute->done" && readyAllDone.ok === true &&
        Array.isArray(readyAllDone.childrenStatus) && readyAllDone.childrenStatus.length === 1 &&
        readyAllDone.childrenStatus[0].id === "CHILD-DONE" && readyAllDone.childrenStatus[0].status === "done",
      `Core's taskCheck() passthrough surfaces the ready-compound "AC complete and all ` +
        `children done" positive shape unchanged, including per-child ids/statuses (got: ${JSON.stringify(readyAllDone)})`
    );

    // Adversarial: confirm this new coverage has real teeth. Sever
    // EPIC-READY-CHILD-TODO's children and confirm Core's passthrough now
    // reports ok:true (pure-AC gate, no compound rollup applied), proving
    // the prior ok:false/childrenStatus assertion was genuinely exercising
    // the ready-compound rollup, not a coincidental pass from AC state alone
    // (EPIC-READY-CHILD-TODO's own AC is fully checked, so ok:false could
    // only have come from the children check).
    execFileSync("node", [nativeBin, "task", "edit", "EPIC-READY-CHILD-TODO", "--children", ""], {
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    });
    const readySevered = await client.taskCheck("EPIC-READY-CHILD-TODO");
    assert(
      readySevered.gate === "execute->done" && readySevered.ok === true &&
        readySevered.childrenStatus === undefined,
      `adversarial check (QN-073): severing EPIC-READY-CHILD-TODO's children makes Core's ` +
        `passthrough report ok:true with no childrenStatus (got: ${JSON.stringify(readySevered)}), ` +
        `confirming the prior ok:false assertion was genuinely gated on the children check, not AC state`
    );
  } finally {
    await client.close();
    fs.rmSync(tasksDir, { recursive: true, force: true });
  }

  console.log(failures === 0 ? "\nAll QN-027/QN-069/QN-072 taskCheck passthrough tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
