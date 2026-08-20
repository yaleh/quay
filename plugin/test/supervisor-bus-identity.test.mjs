// @test-group governance
// supervisor-bus-identity.test.mjs — the supervisor IDENTITY interface
// (tasks/gap-supervisor-message-bus-with-identity, supervisor step ⑤; AC6: node:test +
// @test-group governance).
//
// The message bus was retired (tasks/gap-inbox-message-bus-teardown, 人 2026-08-20 裁定范围A);
// plugin/scripts/supervisor-bus-identity.sh is RETAINED as the control-plane identity shell
// with the message-bus-dependent subcommands (claim-human-test / inbox-summary) removed. The
// remaining contract is usage/exit behavior only:
//   bare invocation    → prints usage, exits 0
//   --help / -h        → prints help, exits 0
//   unknown subcommand → prints error + usage, exits 2 (fail loud)
//
// Run: scripts/test.sh plugin/test/supervisor-bus-identity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "supervisor-bus-identity.sh");

function run(args = []) {
  return spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8" });
}

// ── usage / exit behavior (the retained skeleton) ─────────────────────────────────────────────────

test("usage — bare invocation prints usage and exits 0", () => {
  const r = run([]);
  assert.equal(r.status, 0, "bare invocation → exit 0");
  assert.match(r.stderr + r.stdout, /supervisor-bus-identity/, "usage identifies the script");
});

test("usage — --help exits 0", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, "--help → exit 0");
});

test("usage — an unknown subcommand fails loud (exit 2)", () => {
  const r = run(["no-such-subcommand"]);
  assert.equal(r.status, 2, "unknown subcommand → exit 2");
  assert.match(r.stderr, /supervisor-bus-identity/, "the error names the script");
});
