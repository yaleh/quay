// @test-group product
// @load-sensitive child-spawn
// @load-sensitive-entry 2026-09-23 real `quay goal gate` CLI spawns + a stdio MCP session + real
//   shell criteria (including a ~1.2s deliberate timeout); the goal-gate path's own SUITE-lane peer
//   (goal-gate.test.mjs) is serial for the same reason.
//
// gap-goal-gate-verdict-single-mapping-not-evaluated — ONE verdict mapping, three write points.
//
// THE DEFECT THIS FILE PINS. A goal criterion that declared NOT-EVALUATED (exit 3 — this repo's
// convention), one that was KILLED at its deadline, one whose command could not be run at all
// (exit 126/127), and one that failed to spawn were ALL recorded as `verdict: "fail"` by two of the
// three GateEvent write points (`quay goal gate`, the ABI's `goal_gate`); only the sweep path knew
// the three-state convention. So "this was not measured" wore the exact output shape of "this is
// false" — hard rule 3b, and on the live claudecodeui ledger that was 61 timeouts + ~370 exit-127
// events (criteria whose scripts no longer exist) among 8185 `fail`s.
//
// WHAT IS PINNED:
//   1. The MAPPING (`verdictFromAcceptance`): 0 → pass, 3 → not-evaluated(declared), killed at the
//      deadline → not-evaluated(timeout), spawn failure → not-evaluated(spawn), 126/127 →
//      not-evaluated(not-runnable), anything else non-zero → fail. Unit-level, deterministic.
//   2. BOTH ENTRY POINTS really produce it: the real `quay goal gate` CLI and the native Provider's
//      `goal_gate` MCP tool, driven as subprocesses against a real disposable goal workspace — and
//      BOTH leave the verdict in the SAME ledger (`.quay/gate-events.jsonl`). A unit test of the
//      mapping alone would not have caught the defect: the mapping existed (in the sweep path) while
//      the two entries that lacked it kept writing `fail`.
//   3. The deadline is READABLE per record: a `timeoutMs` on the goal record is the deadline in
//      force (previously the goal paths hard-wired 60000 and the timeout reason told a goal reader
//      to raise a `gates.yml` key those paths never consult).
//
// Run: node --test packages/quay/test/goal-gate-verdict-mapping.test.mjs
//   or: scripts/test.sh packages/quay/test/goal-gate-verdict-mapping.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import {
  verdictFromAcceptance,
  verdictFromGateCheck,
  resolveAcceptanceTimeout,
  ACCEPTANCE_TIMEOUT_ENV,
} from "../src/gate/acceptance-runner.ts";
// ⛔ The default's ONE home is `kernel/gate-run-options.ts` (GOAL-034 moved the shared
// acceptance-runner primitives there from `gate/config/utils.ts`; the sibling task
// gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout had earlier moved it out of
// the runner — a second `60_000` literal in the runner is the drift that task removed). Imported
// from its home, not re-exported through the runner, so `grep` finds exactly one definition.
import { DEFAULT_ACCEPTANCE_TIMEOUT_MS } from "../src/kernel/gate-run-options.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch {
      /* best-effort */
    }
  }
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────

/** A disposable workspace root holding `goals/` (the records), `tasks/` (what the native Provider
 *  takes as its `QUAY_NATIVE_TASKS_DIR`, so the MCP goal dir resolves to our `goals/`) and `.quay/`
 *  (the ledger both entries append to). */
function makeGoalRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `quay-goal-verdict-${tag}-`));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const d of ["goals", "tasks", ".quay"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}

/** A record with every COMPLETE-shape field the store requires (criterion + expect + a body). */
function writeCriterion(root, id, { criterion, timeoutMs }) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: ${id} fixture`,
    "status: active",
    "kind: criterion",
    "goal: GOAL-001",
    `criterion: ${JSON.stringify(criterion)}`,
    "expect: the outcome this criterion proves",
    "origin: fixture",
    ...(timeoutMs === undefined ? [] : [`timeoutMs: ${timeoutMs}`]),
    "---",
    "## Rationale",
    "fixture record for the goal-gate verdict mapping",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "goals", `${id}-fixture.md`), fm, "utf8");
}

/** `quay goal gate <id> --root <root>` — the REAL Core CLI entry (cli/goal.ts delegates the
 *  store-level verb to the goal store's own dispatch; the exit code is the verdict contract). */
function runGoalGateCli(root, id) {
  const isTs = QUAY_CLI.endsWith(".ts");
  const r = spawnSync(
    "node",
    [...(isTs ? ["--experimental-strip-types"] : []), QUAY_CLI, "goal", "gate", id, "--root", root],
    { encoding: "utf8", env: { ...process.env, [ACCEPTANCE_TIMEOUT_ENV]: "" } },
  );
  let out = null;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = null;
  }
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out };
}

/** The ledger tail event for `id` — what a reader (dashboard / `quay gate-log` / a grep) sees. */
function ledgerTail(root, id) {
  const p = path.join(root, ".quay", "gate-events.jsonl");
  if (!fs.existsSync(p)) return null;
  const rows = fs
    .readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => (e.pipeline_id ?? e.item_id) === id && e.gate === "goal");
  return rows.length ? rows[rows.length - 1] : null;
}

// One MCP session per fixture root (each `goal_gate` call re-reads its record at call time, so one
// session serves every case against that root — a per-case spawn would pay the Provider's ~1s
// startup 10x). ⛔ Every session is CLOSED when it is superseded AND at the end of the file: a live
// stdio transport keeps the event loop non-empty, and `node --test` then never exits (the first
// version of this file leaked one session per root and hung after the last test).
const openClients = [];
let sharedClient = null;
let sharedClientRoot = null;
async function goalGateViaMcp(root, id) {
  if (sharedClient === null || sharedClientRoot !== root) {
    const previous = sharedClient;
    sharedClient = null;
    if (previous) await previous.close().catch(() => {});
    sharedClientRoot = root;
    const isTs = QUAY_NATIVE_CLI.endsWith(".ts");
    const transport = new StdioClientTransport({
      command: "node",
      args: [...(isTs ? ["--experimental-strip-types"] : []), QUAY_NATIVE_CLI, "mcp"],
      cwd: path.join(__dirname, "..", "..", "quay-native"),
      // The provider resolves the goal dir as `<dirname(tasksDir)>/goals` — point tasksDir at the
      // fixture root so BOTH entries act on the same records and the same ledger.
      env: { ...process.env, QUAY_NATIVE_TASKS_DIR: path.join(root, "tasks"), [ACCEPTANCE_TIMEOUT_ENV]: "" },
      stderr: "pipe",
    });
    transport.stderr?.on("data", () => {});
    const client = new Client({ name: "goal-gate-verdict-mapping-test", version: "0.0.1" });
    await client.connect(transport);
    openClients.push(client);
    sharedClient = client;
  }
  const res = await sharedClient.callTool({ name: "goal_gate", arguments: { id } });
  if (res.isError) throw new Error(`goal_gate isError: ${JSON.stringify(res.content)}`);
  const payload = res.structuredContent ?? JSON.parse(res.content[0].text);
  return payload;
}

after(async () => {
  for (const client of openClients.splice(0)) await client.close().catch(() => {});
});

// ── 1. the mapping itself (deterministic, no process) ────────────────────────────────────────────

const res = (o) => ({ ok: false, code: null, signal: null, timedOut: false, reason: "r", ...o });

test("verdictFromAcceptance: the 3-valued mapping, cause by cause", () => {
  assert.deepEqual(verdictFromAcceptance(res({ ok: true, code: 0, reason: "acceptance passed (exit 0)" })), {
    verdict: "pass",
    cause: null,
    reason: "acceptance passed (exit 0)",
  });
  // exit 3 = the criterion itself declared NOT-EVALUATED — this repo's convention.
  assert.equal(verdictFromAcceptance(res({ code: 3 })).verdict, "not-evaluated");
  assert.equal(verdictFromAcceptance(res({ code: 3 })).cause, "declared");
  // killed at the deadline. ⛔ Checked BEFORE the null-code branch: a timeout ALSO reports
  // `code: null` (SIGKILL), and reading it as a spawn failure would misname the knob to turn.
  const timedOut = verdictFromAcceptance(res({ timedOut: true, code: null, signal: "SIGKILL" }));
  assert.equal(timedOut.verdict, "not-evaluated");
  assert.equal(timedOut.cause, "timeout");
  // could not spawn a shell at all
  assert.equal(verdictFromAcceptance(res({ code: null })).cause, "spawn");
  // 126/127 — the criterion's own command does not exist / is not executable
  assert.equal(verdictFromAcceptance(res({ code: 127 })).cause, "not-runnable");
  assert.equal(verdictFromAcceptance(res({ code: 126 })).cause, "not-runnable");
  // a criterion that RAN AND SAID NO is the only thing that is `fail`
  const failed = verdictFromAcceptance(res({ code: 1, reason: "acceptance failed (exit 1)" }));
  assert.equal(failed.verdict, "fail");
  assert.equal(failed.cause, null);
  assert.equal(failed.reason, "acceptance failed (exit 1)", "a fail's reason is passed through unchanged");
  // the cause travels WITH the reason — a reader grepping the ledger for `not-runnable` finds it
  assert.match(verdictFromAcceptance(res({ code: 127, reason: "acceptance failed (exit 127)" })).reason, /not-runnable/);
});

test("verdictFromGateCheck: an already-resolved kind wins; a boolean-only check maps ok → pass/fail", () => {
  assert.equal(verdictFromGateCheck({ ok: false, kind: "not-evaluated" }), "not-evaluated");
  assert.equal(verdictFromGateCheck({ ok: true, kind: "pass" }), "pass");
  // taskCheck-shaped (no third answer to give) — reported as the complete mapping, not assumed
  assert.equal(verdictFromGateCheck({ ok: true }), "pass");
  assert.equal(verdictFromGateCheck({ ok: false }), "fail");
});

test("resolveAcceptanceTimeout: record > env > default, and an unreadable record value never disables the guard", () => {
  assert.deepEqual(resolveAcceptanceTimeout(120000, {}), { timeoutMs: 120000, source: "record" });
  assert.deepEqual(resolveAcceptanceTimeout(undefined, { [ACCEPTANCE_TIMEOUT_ENV]: "4500" }), {
    timeoutMs: 4500,
    source: "env",
  });
  assert.deepEqual(resolveAcceptanceTimeout(undefined, {}), {
    timeoutMs: DEFAULT_ACCEPTANCE_TIMEOUT_MS,
    source: "default",
  });
  // ⛔ Not coerced: `spawnSync({timeout: NaN})` means "NO deadline", so a record typo would silently
  // DISABLE the guard rather than fall back to it.
  for (const bogus of ["120000", 0, -1, NaN, null, {}]) {
    assert.equal(resolveAcceptanceTimeout(bogus, {}).source, "default", `bogus value ${String(bogus)} must fall through`);
  }
});

// ── 2. both entry points, end to end ─────────────────────────────────────────────────────────────

const CASES = [
  { label: "exit 0", criterion: "exit 0", verdict: "pass", cause: null, cliExit: 0 },
  { label: "exit 1", criterion: "exit 1", verdict: "fail", cause: null, cliExit: 1 },
  { label: "exit 3 (declared NOT-EVALUATED)", criterion: 'echo "NOT-EVALUATED: carrier absent" >&2; exit 3', verdict: "not-evaluated", cause: "declared", cliExit: 1 },
  { label: "killed at the deadline", criterion: "sleep 30; exit 0", verdict: "not-evaluated", cause: "timeout", cliExit: 1, timeoutMs: 1200 },
  { label: "unrunnable command (127)", criterion: "./scripts/no-such-script-exists.sh", verdict: "not-evaluated", cause: "not-runnable", cliExit: 1 },
];

for (const c of CASES) {
  test(`quay goal gate — ${c.label} ⇒ ${c.verdict}${c.cause ? ` (${c.cause})` : ""}`, () => {
    const root = makeGoalRoot(`cli-${c.cause ?? c.verdict}-${c.cliExit}`);
    const id = "AC-901";
    writeCriterion(root, id, { criterion: c.criterion, timeoutMs: c.timeoutMs });

    const r = runGoalGateCli(root, id);
    assert.ok(r.out, `expected JSON on stdout; got status=${r.status} stderr=${r.stderr}`);
    assert.equal(r.out.verdict, c.verdict, `stdout verdict; reason=${r.out.reason}`);
    assert.equal(r.out.cause, c.cause, `stdout cause; reason=${r.out.reason}`);
    // ⛔ `pass` is the only exit 0 — not-evaluated is NOT a pass (the driver reads this code).
    assert.equal(r.status, c.cliExit, `exit code; stdout=${r.stdout} stderr=${r.stderr}`);

    // …and the LEDGER says the same thing — the verdict the driver/dashboard actually reads.
    const tail = ledgerTail(root, id);
    assert.ok(tail, "a goal GateEvent must have been appended");
    assert.equal(tail.verdict, c.verdict, "ledger verdict");
    if (c.cause) assert.equal(tail.payload.cause, c.cause, "ledger payload.cause");
  });
}

for (const c of CASES) {
  test(`MCP goal_gate — ${c.label} ⇒ ${c.verdict}${c.cause ? ` (${c.cause})` : ""}`, async () => {
    const root = makeGoalRoot(`mcp-${c.cause ?? c.verdict}-${c.cliExit}`);
    const id = "AC-902";
    writeCriterion(root, id, { criterion: c.criterion, timeoutMs: c.timeoutMs });

    const out = await goalGateViaMcp(root, id);
    assert.equal(out.verdict, c.verdict, `MCP verdict; reason=${out.reason}`);
    assert.equal(out.cause, c.cause, `MCP cause; reason=${out.reason}`);

    // The MCP entry writes the SAME ledger event shape as the CLI entry — the second write point
    // that used to record a timeout / exit-127 as `fail` (hard rule 5b: fix the cluster).
    const tail = ledgerTail(root, id);
    assert.ok(tail, "the MCP entry must leave the verdict in the ledger, like `quay goal gate` does");
    assert.equal(tail.verdict, c.verdict, "ledger verdict");
    assert.equal(tail.actor, "goal-mcp", "the ledger event is attributable to the MCP entry");
    if (c.cause) assert.equal(tail.payload.cause, c.cause, "ledger payload.cause");
  });
}

test("the two entry points agree on the SAME record (no per-path mapping)", async () => {
  const root = makeGoalRoot("agree");
  const id = "AC-903";
  writeCriterion(root, id, { criterion: "sleep 30; exit 0", timeoutMs: 1200 });

  const cli = runGoalGateCli(root, id);
  const mcp = await goalGateViaMcp(root, id);
  assert.equal(cli.out.verdict, "not-evaluated");
  assert.equal(mcp.verdict, "not-evaluated");
  assert.equal(cli.out.cause, mcp.cause);
  assert.equal(cli.out.cause, "timeout");
});

// ── 3. the deadline is a readable knob, not a hard-wired 60000 ───────────────────────────────────

test("a record's `timeoutMs` is the deadline in force, and the timeout reason names THAT knob", () => {
  const root = makeGoalRoot("record-timeout");
  const id = "AC-904";
  // ⛔ Discriminating by CONSTRUCTION: with the old hard-wired 60000 this criterion would PASS; it
  // is only a timeout because the record's own 1200ms deadline was read.
  writeCriterion(root, id, { criterion: "sleep 30; exit 0", timeoutMs: 1200 });
  const r = runGoalGateCli(root, id);
  assert.equal(r.out.verdict, "not-evaluated", `reason=${r.out.reason}`);
  assert.equal(r.out.cause, "timeout");
  // The advice must name a knob THIS path reads (⛔ not gates.yml/--timeout, which the goal path
  // never consults — the discoverability half of the defect).
  assert.match(r.out.reason, /timeoutMs/);
  assert.doesNotMatch(r.out.reason, /gates\.yml/);
});

test("a record whose criterion finishes INSIDE its own deadline PASSes", () => {
  const root = makeGoalRoot("record-timeout-pass");
  const id = "AC-905";
  writeCriterion(root, id, { criterion: "sleep 1; exit 0", timeoutMs: 120000 });
  const r = runGoalGateCli(root, id);
  assert.equal(r.out.verdict, "pass", `reason=${r.out.reason}`);
  assert.equal(r.status, 0);
});

test(`${ACCEPTANCE_TIMEOUT_ENV} is read when the record declares no deadline`, () => {
  const root = makeGoalRoot("env-timeout");
  const id = "AC-906";
  writeCriterion(root, id, { criterion: "sleep 30; exit 0" });
  const isTs = QUAY_CLI.endsWith(".ts");
  const r = spawnSync(
    "node",
    [...(isTs ? ["--experimental-strip-types"] : []), QUAY_CLI, "goal", "gate", id, "--root", root],
    { encoding: "utf8", env: { ...process.env, [ACCEPTANCE_TIMEOUT_ENV]: "1200" } },
  );
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, "not-evaluated", `reason=${out.reason}`);
  assert.equal(out.cause, "timeout");
  assert.match(out.reason, new RegExp(ACCEPTANCE_TIMEOUT_ENV));
});
