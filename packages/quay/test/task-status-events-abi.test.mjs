// @test-group product
// task-status-events-abi.test.mjs — gap-task-status-events-abi-writes-and-creation:
// the Provider-ABI surfaces emit v1 status events.
//
// The sibling driver work (gap-task-status-events-contract-v1-all-driver-writers) wired the DRIVER
// layer. This file pins the SURFACES A HUMAN OR AN AGENT SESSION ACTS THROUGH — the four the task's
// Proposal names and none of which emitted anything before:
//   (a) `quay task create`            → one `create` event, `from:null`;
//   (b) `quay task edit --status`     → one event per flip, and a REFUSED CAS emits zero;
//   (c) MCP `task_write`              → one event, `actor.kind:"mcp"`;
//   (d) a body-only edit              → zero events;
//   (e) `--correlation-id`            → carried through when given, ABSENT when not;
//   (f) lifecycle promote/retreat/complete → one event each.
//
// WHY THIS IS NOT COVERED BY store.test.mjs's own ACs: those pin the store's choke point (the store
// IS given the transition, the commit and the provenance). This file drives the REAL front doors —
// the Core CLI process, the Core MCP server — in a real (temp) git workspace, because the wiring
// between them is exactly what could silently rot: `patch.actorKind` dropped from a CLI handler, a
// provenance field stripped by the Provider's zod schema, a lifecycle verb that forgets to forward
// its args. A store-level test cannot see any of those (硬规则 4 推论三: a criterion only the seam can
// reach proves nothing about the production path).
//
// Run: node --test packages/quay/test/task-status-events-abi.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { readTaskStatusEventCarrier } from "../src/kernel/task-transition.ts";
import { QUAY_CLI, QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** A temp workspace that is a REAL git work tree — the event carrier lives at the workspace root, so
 *  a repo-less fixture would silently test the "no workspace to record into" path instead. */
function makeWorkspace() {
  const ws = makeTmpDir("task-status-events-abi-");
  execFileSync("git", ["init", "-q", "-b", "develop", ws]);
  execFileSync("git", ["-C", ws, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", ws, "config", "user.name", "Test"]);
  fs.writeFileSync(path.join(ws, "README.md"), "fixture\n", "utf8");
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".quay", "config.yml"), [
    "providers:",
    "  native:",
    "    enabled: true",
    `    path: "${nativeProviderDir}"`,
    `    mcp_entry: ["node", "${QUAY_NATIVE_CLI}", "mcp"]`,
    "    env:",
    `      QUAY_NATIVE_TASKS_DIR: "${path.join(ws, "tasks")}"`,
    "",
  ].join("\n"));
  execFileSync("git", ["-C", ws, "add", "-A"]);
  execFileSync("git", ["-C", ws, "commit", "-q", "--no-verify", "-m", "fixture"]);
  return ws;
}

/** Run the Core CLI with `cwd` INSIDE the workspace (config discovery walks up from cwd). */
function quay(args, ws) {
  try {
    const out = execFileSync("node", [QUAY_CLI, ...args], {
      encoding: "utf8",
      cwd: ws,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? String(err) };
  }
}

/** Every v1 record on the workspace's carrier, in append order. */
function events(ws) {
  return readTaskStatusEventCarrier(ws).lines.filter((l) => l.klass === "v1").map((l) => l.record);
}

// One workspace per test: each drives its own front door and asserts on ITS carrier, so a shared
// fixture would make one test's event the next test's extra line.
test("AC(a)+(b)+(d)+(e): `task create` / `task edit --status` emit exactly the flips, with provenance", () => {
  const ws = makeWorkspace();

  const created = quay(["task", "create", "EV-A", "--title", "A", "--status", "todo"], ws);
  assert.equal(created.status, 0, `task create must succeed: ${created.stderr}`);
  let ev = events(ws);
  assert.equal(ev.length, 1, `a creation must emit exactly one event; got ${JSON.stringify(ev)}`);
  assert.deepEqual([ev[0].from, ev[0].to, ev[0].kind], [null, "todo", "create"]);
  assert.equal(ev[0].actor.kind, "cli", "the Core CLI stamps its own class");

  // (b) the CLI CAS write: `--expect-status todo` matches, so the flip lands and emits.
  const flipped = quay(["task", "edit", "EV-A", "--status", "ready", "--expect-status", "todo"], ws);
  assert.equal(flipped.status, 0, `task edit must succeed: ${flipped.stderr}`);
  ev = events(ws);
  assert.equal(ev.length, 2, "exactly one further event for the flip");
  assert.deepEqual([ev[1].from, ev[1].to, ev[1].kind], ["todo", "ready", "promote"]);
  assert.match(String(ev[1].evidence.commit), /^[0-9a-f]{40}$/, "the ABI's own commit is the evidence");

  // (b) negative half: the SAME command again — `expectedStatus todo` no longer holds — is refused.
  const refused = quay(["task", "edit", "EV-A", "--status", "ready", "--expect-status", "todo"], ws);
  assert.notEqual(refused.status, 0, "a stale expectedStatus must be refused (non-zero exit)");
  assert.match(refused.stderr, /CAS conflict|conflict/i, `the refusal must name the CAS: ${refused.stderr}`);
  assert.equal(events(ws).length, 2, "a refused CAS wrote nothing, so it must emit nothing");

  // (d) a body-only edit is a WRITE, not a transition.
  const bodyOnly = quay(["task", "edit", "EV-A", "--body", "## Plan\n\nprose\n"], ws);
  assert.equal(bodyOnly.status, 0, `body-only edit must succeed: ${bodyOnly.stderr}`);
  assert.equal(events(ws).length, 2, "a body-only edit emits nothing");

  // (e) correlationId: carried when given…
  quay(["task", "edit", "EV-A", "--status", "needs-human", "--correlation-id", "op-9"], ws);
  ev = events(ws);
  assert.equal(ev.length, 3);
  assert.equal(ev[2].cause?.correlationId, "op-9", "the caller's --correlation-id reaches the record");

  // …and ABSENT (not empty) when not.
  quay(["task", "edit", "EV-A", "--status", "todo"], ws);
  ev = events(ws);
  assert.equal(ev.length, 4);
  assert.equal(ev[3].cause?.correlationId, undefined, "no --correlation-id ⇒ no correlationId key on the record");
});

test("AC(c): MCP `task_write` emits one event with actor.kind 'mcp'", async () => {
  const ws = makeWorkspace();
  // Seed through the CLI so the creation's own event is accounted for separately.
  assert.equal(quay(["task", "create", "EV-C", "--title", "C", "--status", "todo"], ws).status, 0);

  const core = new Client({ name: "task-status-events-abi", version: "0.0.1" });
  await core.connect(new StdioClientTransport({
    command: "node",
    args: [QUAY_CLI, "mcp"],
    cwd: ws,
    env: { ...process.env },
  }));
  try {
    const r = await core.callTool({
      name: "task_write",
      arguments: { id: "EV-C", status: "ready", expectedStatus: "todo", correlationId: "mcp-op-1" },
    });
    assert.ok(!r.isError, `task_write must succeed: ${JSON.stringify(r.content)}`);
    const ev = events(ws);
    assert.equal(ev.length, 2, "the MCP flip must emit exactly one further event");
    assert.deepEqual([ev[1].from, ev[1].to], ["todo", "ready"]);
    assert.equal(ev[1].actor.kind, "mcp", "the Core MCP server stamps its own class — not a caller-supplied one");
    assert.equal(ev[1].cause?.correlationId, "mcp-op-1");
  } finally {
    await core.close();
  }
});

test("AC(f): lifecycle `complete` / `retreat` / `promote` each emit exactly one event", () => {
  const ws = makeWorkspace();
  // A `ready` task whose acceptance meter is a real runnable command — `complete` and `promote`
  // (ready→done) both run it through the SAME acceptance runner the gate uses.
  const seeded = quay([
    "task", "create", "EV-F", "--title", "F", "--status", "ready", "--extra", '{"acceptance":"true"}',
  ], ws);
  assert.equal(seeded.status, 0, `seeding EV-F must succeed: ${seeded.stderr}`);
  assert.equal(events(ws).length, 1, "precondition: the creation's own event");

  const complete = quay(["complete", "EV-F"], ws);
  assert.equal(complete.status, 0, `quay complete must pass the acceptance meter: ${complete.stdout}${complete.stderr}`);
  let ev = events(ws);
  assert.equal(ev.length, 2, "`complete` must emit exactly one event for its ready→done flip");
  assert.deepEqual([ev[1].from, ev[1].to, ev[1].actor.kind], ["ready", "done", "cli"]);

  const retreat = quay(["retreat", "EV-F", "--reason", "ac-test retreat"], ws);
  assert.equal(retreat.status, 0, `quay retreat must succeed: ${retreat.stderr}`);
  ev = events(ws);
  assert.equal(ev.length, 3, "`retreat` must emit exactly one event for its done→ready flip");
  assert.deepEqual([ev[2].from, ev[2].to, ev[2].actor.kind], ["done", "ready", "cli"]);

  const promote = quay(["promote", "EV-F"], ws);
  assert.equal(promote.status, 0, `quay promote must succeed: ${promote.stdout}${promote.stderr}`);
  ev = events(ws);
  assert.equal(ev.length, 4, "`promote` on a ready task delegates to the complete path — one event, not two");
  assert.deepEqual([ev[3].from, ev[3].to, ev[3].actor.kind], ["ready", "done", "cli"]);

  // Every flip's evidence names a commit whose copy of the task file carries THAT status — the
  // record's whole purpose is to be checkable against git.
  for (const e of ev.slice(1)) {
    const atCommit = execFileSync("git", ["-C", ws, "show", `${e.evidence.commit}:tasks/EV-F.md`], { encoding: "utf8" });
    assert.match(atCommit, new RegExp(`^status: ${e.to}$`, "m"), `event ${e.seq} evidence.commit must carry status ${e.to}`);
  }
});

after(() => {
  // The tmp-workspace helper removes every directory it created (one cleanup point per file); the
  // per-test git repos live inside those directories, so nothing here needs its own rmSync.
});
