// @test-group engine
// config-key-consumer-check.test.mjs — tasks/gap-config-key-consumer-check-mechanical-enumeration
// (GOAL-015 退出条件③ / AC-235).
//
// Coverage map (task ACs):
//   AC1 — the real-repo audit exits 0 with no_consumer_to_wire === 0 (every delivered config key
//         has a consumer or a documented reason). merge_target was the known zero-consumer key; it
//         is deleted from the writer face (quay-init.sh), so the enumeration must show zero.
//   AC3 — the three-state vocabulary is distinguishable: has-consumer / no-consumer-to-wire /
//         documented-with-reason, and a documented-with-reason exemption carries a reviewable
//         reason text (blank reason is rejected fail-closed).
//   AC4 — merge_target no longer appears in the .ts consumer face (deleted from the writer; the
//         checker derives keys from quay-init.sh and must not enumerate it).
//
// No global counts are hardcoded beyond the writer face's own derived size — assertions are relative
// to the real-repo enumeration and to pure-function fixtures.
//
// Run:
//   scripts/test.sh plugin/test/config-key-consumer-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  audit,
  classifyKey,
  extractWriterKeys,
  validateExemptions,
} from "../scripts/config-key-consumer-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/config-key-consumer-check.ts");

/** Run the checker against the REAL repo; returns the spawnSync result. */
function run(...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", REPO_ROOT, ...args],
    { encoding: "utf8" },
  );
}

test("AC1 — the real-repo audit passes: every delivered config key has a consumer (no_consumer_to_wire === 0)", () => {
  const res = run("--json");
  assert.equal(res.status, 0, `real-repo audit must pass, got ${res.status}:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.mode, "config-key-consumer-audit");
  assert.equal(out.no_consumer_to_wire, 0, `zero-consumer keys must be 0, got ${JSON.stringify(out.entries)}`);
  assert.equal(out.states["no-consumer-to-wire"], 0, "the state tally must agree with no_consumer_to_wire");
  assert.ok(out.keys_total >= 4, `the writer face must enumerate the loop: keys, got ${out.keys_total}`);
  for (const e of out.entries) {
    assert.ok(
      e.state === "has-consumer" || e.state === "documented-with-reason",
      `no key may be no-consumer-to-wire: ${e.key}`,
    );
  }
});

test("AC4 — merge_target is gone from the writer face (deleted dead key is not enumerated)", () => {
  const res = run("--json");
  assert.equal(res.status, 0, `real-repo audit must pass, got ${res.status}:\n${res.stderr}`);
  const out = JSON.parse(res.stdout);
  const keys = out.entries.map((e) => e.key);
  assert.ok(!keys.includes("merge_target"), `merge_target must not be enumerated (deleted), got ${keys.join(", ")}`);
});

test("extractWriterKeys — derives keys from BOTH the heredoc `loop:` block and the python `loop[\"key\"] =` writer", () => {
  const src = [
    "loop:",
    "  repo_root: ${ROOT}",
    "  test_command: ${TEST}",
    "EOF",
    'loop["tmux_session"] = tmux if tmux else None',
    'loop["worktree_root"] = wtroot',
  ].join("\n");
  const keys = extractWriterKeys(src);
  assert.deepEqual(
    keys,
    ["repo_root", "test_command", "tmux_session", "worktree_root"],
    "both writer forms must contribute, deduped and sorted",
  );
});

test("AC3 — the three states are distinguishable (has-consumer / no-consumer-to-wire / documented-with-reason)", () => {
  const consumers = new Map([["plugin/scripts/a.ts", "reads consumed_key somewhere"]]);
  assert.equal(classifyKey("consumed_key", consumers, []).state, "has-consumer");
  assert.equal(classifyKey("orphan_key", consumers, []).state, "no-consumer-to-wire");
  const documented = classifyKey("orphan_key", consumers, [{ key: "orphan_key", reason: "kept for human-readable config" }]);
  assert.equal(documented.state, "documented-with-reason");
  assert.equal(documented.reason, "kept for human-readable config", "the exemption reason must be carried and reviewable");
});

test("AC3 — a documented-with-reason exemption requires a non-blank reason (fail-closed, 豁免不是无理由 allowlist)", () => {
  assert.equal(validateExemptions([{ key: "k", reason: "kept for X" }]), null, "a real reason validates");
  assert.ok(
    validateExemptions([{ key: "k", reason: "" }]) !== null,
    "a blank reason must be rejected (fail-closed)",
  );
  assert.ok(
    validateExemptions([{ key: "k", reason: "   " }]) !== null,
    "a whitespace-only reason must be rejected",
  );
});
