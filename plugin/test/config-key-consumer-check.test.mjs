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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  audit,
  classifyKey,
  extractWriterKeys,
  extractServeVersionKeys,
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

test("extractWriterKeys — an INDENTED comment inside the loop: block does not truncate the key set", () => {
  // Regression: the AC4 contract note written next to `test_command` inside quay-init's heredoc made
  // the old extractor stop at that comment, silently dropping every key after it (`fork_baseline` —
  // the block's last key — disappeared, and host-repo-surface-ratchet went red on the shrink).
  const src = [
    "loop:",
    "  repo_root: ${ROOT}",
    "  # a note about the key below (indented comment, not a key)",
    "  test_command: ${TEST}",
    "  fork_baseline: develop",
    "EOF",
  ].join("\n");
  assert.deepEqual(
    extractWriterKeys(src),
    ["fork_baseline", "repo_root", "test_command"],
    "a key written after an indented comment must still be enumerated",
  );
});

test("extractWriterKeys — a COLUMN-0 comment still terminates the block (negative control for the skip)", () => {
  // Without this half, the skip above would let the scan walk past the end of the loop: block into
  // the next top-level block and enumerate ITS indented keys as loop keys.
  const src = [
    "loop:",
    "  repo_root: ${ROOT}",
    "# a top-level comment ends the loop: block",
    "providers:",
    "  native:",
    "    tasks_dir: tasks",
  ].join("\n");
  assert.deepEqual(
    extractWriterKeys(src),
    ["repo_root"],
    "a column-0 comment terminates the block; the providers: block's keys are NOT loop keys",
  );
});

test("extractWriterKeys — a blank line still terminates the block (pre-existing contract unchanged)", () => {
  const src = [
    "loop:",
    "  repo_root: ${ROOT}",
    "",
    "  not_a_loop_key: x",
  ].join("\n");
  assert.deepEqual(extractWriterKeys(src), ["repo_root"], "a blank line ends the block");
});

// ── the SECOND writer face (gap-serve-binding-defaults-three-copies-to-one-definition-point P3.3) ──
// The `serve:` section is written by packages/quay/src/init.ts, not by quay-init.sh — reading only
// the shell face would leave these delivered keys un-enumerated (invisible to the very check whose
// job is to find delivered-but-unread keys).
test("serve: writer face — extractServeVersionKeys reads the SERVE_VERSION_DEFAULTS table, brace-balanced", () => {
  const src = [
    "export const SERVE_VERSION_DEFAULTS: Readonly<Record<string, unknown>> = {",
    "  host: SERVE_BINDING_FALLBACK.host,",
    "  port: SERVE_BINDING_FALLBACK.port,",
    "};",
    "",
    "export function unrelated() { return { not_a_key: 1 }; }",
  ].join("\n");
  assert.deepEqual(extractServeVersionKeys(src), ["host", "port"], "the table's keys ARE the delivered keys");
  // A nested value must not end the table early (the balanced-brace scan).
  const nested = [
    "export const SERVE_VERSION_DEFAULTS = {",
    "  host: \"x\",",
    "  extra: { a: 1 },",
    "  port: 0,",
    "};",
  ].join("\n");
  assert.deepEqual(extractServeVersionKeys(nested), ["extra", "host", "port"]);
  // Absent table ⇒ no keys (never a crash): the shell face is still the hard requirement.
  assert.deepEqual(extractServeVersionKeys("loop:\n  board: native\n"), []);
});

// ⛔ AC-330 INVERTS this test. It used to require the real-repo audit to ENUMERATE `serve.host` /
// `serve.port` — i.e. to hold that init.ts WRITES those keys (from `SERVE_VERSION_DEFAULTS`). That
// table is gone: no quay surface writes a `serve:` key any more, because every candidate value
// equalled the resolver's own fallback (`serve-binding.ts`), so writing one said nothing and made a
// fresh install and an upgrade disagree about the section's existence. What must hold now is the
// MIRROR: the reader half stays wired (`resolveServeBinding` still reads a user's pinned values),
// while the delivered-key audit no longer claims a writer face that does not write.
test("serve: the reader stays wired, and the audit no longer enumerates serve.* as a delivered key", () => {
  const res = run("--json");
  assert.equal(res.status, 0, `real-repo audit must pass:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  const keys = out.entries.map((e) => e.key);
  assert.ok(!keys.includes("serve.host"), `serve.host is no longer DELIVERED by any writer, got ${keys.join(", ")}`);
  assert.ok(!keys.includes("serve.port"), "…and neither is serve.port");
  assert.ok(!/init\.ts/.test(out.writer), `the report must not name a writer face that writes nothing (got: ${out.writer})`);
  assert.match(out.writer, /quay-init\.sh/, "the shell writer face is still named");

  // The READER half is untouched: a user who pinned serve.host/port still gets it honored. Asserted
  // against the reader's own source, so this half cannot be dropped silently by the same edit that
  // removed the writer.
  const readerSrc = fs.readFileSync(path.join(REPO_ROOT, "packages", "quay", "src", "serve-binding.ts"), "utf8");
  assert.match(readerSrc, /const serveHost =/, "resolveServeBinding still binds serve.host");
  assert.match(readerSrc, /const servePort =/, "…and serve.port");
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
