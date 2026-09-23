// @test-group engine
// test-sh-entry-normalization.test.mjs — the READER for scripts/test.sh's entry-normalization block,
// for its second member: `unset QUAY_GOAL_ACCEPTANCE_ACTIVE`
// (gap-goal-acceptance-active-leaks-into-suite-via-driver-anchor-env).
//
// ── WHAT IS UNDER TEST ───────────────────────────────────────────────────────────────────────────
// `scripts/test.sh` normalizes the entry environment for EVERY child it spawns. Its first member is
// `unset FORCE_COLOR` (gap-suite-force-color-ansi-test-sh-normalize); the second is the goal layer's
// RE-ENTRANCY GUARD. The guard's meaning is a sentence about ONE process — "THIS process is running
// criteria" (packages/quay/src/goal-store.ts:118/:1784/:1992, plugin/scripts/goal-driver.ts:639) — so
// it must never be inherited by a process that is not that one. A resident driver-anchor started from
// a shell that had exported it carries it in its own environ and hands it to every worker/suite child;
// the goal-family test files then read a store that REFUSES (a distinct value — `evaluated:false` /
// `guardRefused:true`, ⛔ not an empty success) and go red for reasons unrelated to any task's delta.
//
// ── HOW THE READING IS TAKEN (⛔ never by reading the entry's source text — hard rule 2) ──────────
// Arm A reads it from THIS process. When the suite runs through scripts/test.sh, this file IS a child
// of the entry, so `process.env` here IS the entry's child environment — the reading is the entry's
// own output, not a parse of its text. The precondition is the entry's OWN child marker
// (`QUAY_TEST_NESTED=1`, exported by mark_nested() on every test-running path of test.sh): without it
// this process did not come through the entry and arm A is reported NOT-EVALUATED as a distinct
// outcome (hard rule 3b), never folded into "pass".
//
//   取数命令（父环境导出闸；最小形态 = --scoped，只跑本文件）：
//     QUAY_GOAL_ACCEPTANCE_ACTIVE=1 bash scripts/test.sh --scoped plugin/test/test-sh-entry-normalization.test.mjs
//   把修复回退后跑同一条命令 ⇒ arm A 必须翻红（两条读数见任务体 AC1）。
//
// Arm B is the falsifiability control (hard rule 4 — a量 that cannot be false is not a measurement):
// the SAME assertion is taken in a `node --test` child that carries the marker AND the guard injected,
// and it must FLIP. Without arm B, arm A could be green for the wrong reason (nothing exported the
// guard in the first place) and nobody would know.
//
// ── ⛔ WHY THIS FILE DOES NOT SPAWN scripts/test.sh ITSELF (the AC's literal form) ────────────────
// The test-isolation contract's R3 ratchet (plugin/test-isolation-violations.txt, scanner
// plugin/scripts/test-isolation-check.ts) is SHRINK-ONLY and its own message says what to do about a
// new hit: "a new violation was introduced … fix the test (… stop spawning scripts/test.sh …).
// Do NOT add it to the list." A file inside the canonical test glob therefore cannot open a child of
// the entry by spawn. The entry reaches this file as its parent instead (arm A), and the
// un-fixed-entry half of the control is taken by reverting the entry's unset — evidence pasted in the
// task body. No loophole is used: the spawn of the entry is not moved to a helper, it is not built
// from a path the scanner cannot see, and the baseline list is not grown.
//
// Run: scripts/test.sh --scoped plugin/test/test-sh-entry-normalization.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The re-entrancy guard (packages/quay/src/goal-store.ts `GOAL_ACCEPTANCE_ACTIVE_ENV`). The literal
 *  is repeated here on purpose: this file must stay importable by a plain `node --test` (no
 *  `--experimental-strip-types`), and the name is a WIRE value, not logic. */
const GUARD = "QUAY_GOAL_ACCEPTANCE_ACTIVE";
/** The entry's own child marker — exported by scripts/test.sh's mark_nested() on EVERY test-running
 *  path (run_selected / --scoped / --for-task / --buckets / explicit files). Its presence is the
 *  positional evidence "this process is a child of the entry" (⛔ not a keyword from the source). */
const ENTRY_CHILD_MARKER = "QUAY_TEST_NESTED";
/** Set only in arm B's control child, so arm B cannot recurse into itself. */
const CONTROL_CHILD_MARKER = "QUAY_ENTRY_NORMALIZATION_PROBE_CHILD";
/** A token unique to arm A's failure message — arm B checks the child flipped for THIS reason. */
const ARM_A_FAILURE_TOKEN = "arm A:";

const SELF = fileURLToPath(import.meta.url);

test("arm A — a child of scripts/test.sh sees no QUAY_GOAL_ACCEPTANCE_ACTIVE (entry-normalization reading)", (t) => {
  const seen = process.env[GUARD];
  if (process.env[ENTRY_CHILD_MARKER] !== "1") {
    // NOT-EVALUATED is an independent outcome (hard rule 3b): without the entry's marker this process
    // was not spawned by scripts/test.sh, so there is no entry environment to read. Reported loudly so
    // a vacuous green (硬规则 3b 的空转半边) is visible in the output.
    t.diagnostic(
      `arm A NOT-EVALUATED — ${ENTRY_CHILD_MARKER} is not "1": this process did not come through ` +
        `scripts/test.sh, so the entry-normalization reading has no object. ` +
        `Take it with: QUAY_GOAL_ACCEPTANCE_ACTIVE=1 bash scripts/test.sh --scoped plugin/test/test-sh-entry-normalization.test.mjs`,
    );
    return;
  }
  assert.equal(
    seen,
    undefined,
    `${ARM_A_FAILURE_TOKEN} this process IS a child of scripts/test.sh (${ENTRY_CHILD_MARKER}=1) yet ` +
      `sees ${GUARD}=${JSON.stringify(seen)}. The entry-normalization block of scripts/test.sh does not ` +
      `unset it, so the goal-layer re-entrancy guard leaks into the suite: every goal-family test whose ` +
      `subject runs a criterion reads a store that REFUSES (evaluated:false / guardRefused:true) and goes ` +
      `red for a reason unrelated to any delta. Fix the ENTRY (the \`unset\` next to \`unset FORCE_COLOR\`), ` +
      `never the individual test files.`,
  );
});

test("arm B — falsifiability control: the same assertion FLIPS when the guard is present", (t) => {
  if (process.env[CONTROL_CHILD_MARKER] === "1") {
    // We ARE the control child. Its designed red is arm A above; arm B must not spawn a grandchild.
    t.diagnostic(`arm B skipped — this process is the control child (${CONTROL_CHILD_MARKER}=1).`);
    return;
  }

  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Strip node:test's child-protocol vars so the control child runs as a normal top-level runner
    // (same reason as plugin/test/helpers/runner-grouping-list-groups-harness.mjs).
    if (k.startsWith("NODE_TEST_")) continue;
    env[k] = v;
  }
  env[ENTRY_CHILD_MARKER] = "1"; // force arm A's precondition: "this is a child of the entry"
  env[GUARD] = "1"; // …and export the guard the leak would have carried in
  env[CONTROL_CHILD_MARKER] = "1"; // arm B must not recurse in this child

  const r = spawnSync(process.execPath, ["--test", SELF], { env, encoding: "utf8", timeout: 120_000 });

  assert.equal(r.error, undefined, `arm B: the control child could not be spawned: ${r.error}`);
  assert.equal(r.signal, null, `arm B: the control child was killed by ${r.signal} (timeout?)`);
  assert.notEqual(
    r.status,
    0,
    `arm B: with ${ENTRY_CHILD_MARKER}=1 and ${GUARD}=1 injected, arm A must FLIP to red. It stayed ` +
      `green ⇒ arm A is a tautology (hard rule 4: a reading that cannot be false is not a measurement). ` +
      `status=${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
  );
  assert.ok(
    `${r.stdout}${r.stderr}`.includes(ARM_A_FAILURE_TOKEN),
    `arm B: the control child went red, but NOT for arm A's reason (token ${JSON.stringify(ARM_A_FAILURE_TOKEN)} ` +
      `absent from its output) — a crash is not a flipped reading (硬规则 3b).\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`,
  );
});
