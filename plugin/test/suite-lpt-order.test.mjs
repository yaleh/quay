// @test-group engine
// suite-lpt-order.test.mjs — RED/GREEN tests for the M-bucket LPT ordering
// (gap-m-bucket-long-tail-lpt-scheduling).
//
// Defect: scripts/test.sh handed the M-bucket file list to `node --test` in glob/discovery order, so
// the 150–290s long tests that landed at the END of the list waited for the short tests to drain the
// lanes and serialized into a long tail (measured round 474/476/478: last 5% of files = 27%+ of wall
// clock). The fix: scripts/test.sh --buckets now LPT-orders the selected list — longest-KNOWN files
// FIRST — using the EXISTING per-file carrier (.quay/verification-round.jsonl perFile[].durationMs,
// rolling average of the most recent rounds), via plugin/scripts/suite-lpt-order.ts.
//
// Covered here:
//   - AC1 (structural pin): the --buckets branch of scripts/test.sh wires suite-lpt-order.ts behind the
//     QUAY_TEST_LPT_ORDER gate — removing the wiring flips the suite red.
//   - AC2 (take-false): orderByLpt sorts longest-known-first and keeps unknowns at the END (stable,
//     original relative order), so a known-long file lands in the first N.
//   - AC3 (fail-open): an absent carrier ⇒ the input list is emitted UNCHANGED (no history ⇒ current
//     behavior, never a dropped/empty file list).
//   - AC4 (normalization): repoRelKey folds a worktree absolute path and a main-checkout absolute path
//     to the SAME repo-relative key, so round-to-round durations match across worktree variants.
//
// Run:
//   scripts/test.sh plugin/test/suite-lpt-order.test.mjs
//   scripts/test.sh --for-task gap-m-bucket-long-tail-lpt-scheduling

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { repoRelKey, loadDurationAverages, orderByLpt } from "../scripts/suite-lpt-order.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Slice the `--buckets` elif branch out of scripts/test.sh (bounded by the next `elif`). */
function bucketsBranchSrc(testSh) {
  const lines = testSh.split("\n");
  const start = lines.findIndex((l) => l.includes('= "--buckets" ]'));
  assert.ok(start !== -1, "scripts/test.sh must contain the --buckets branch");
  const end = lines.findIndex((l, i) => i > start && /^elif\b/.test(l));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

/** Write a JSONL carrier with perFile records into a temp root's .quay/ (returns the root). */
function makeRootWithCarrier(rounds) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-root-"));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  const carrier = path.join(root, ".quay", "verification-round.jsonl");
  const lines = rounds
    .map(
      (files) =>
        JSON.stringify({
          round: 1,
          perFile: files.map(([file, durationMs]) => ({ file, durationMs, passed: true })),
        }) + "\n",
    )
    .join("");
  fs.writeFileSync(carrier, lines);
  return root;
}

test("AC1 — the --buckets branch wires suite-lpt-order.ts behind the QUAY_TEST_LPT_ORDER gate", () => {
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts", "test.sh"), "utf8");
  const branch = bucketsBranchSrc(testSh);
  assert.match(branch, /suite-lpt-order\.ts/, "the --buckets branch must invoke suite-lpt-order.ts");
  assert.match(branch, /QUAY_TEST_LPT_ORDER/, "the wiring must sit behind the QUAY_TEST_LPT_ORDER rollback gate");
});

test("AC2 — orderByLpt sorts longest-known-first and keeps unknowns at the END in original order", () => {
  const root = "/home/yale/work/quay";
  const avg = new Map([
    ["plugin/test/long-a.test.mjs", 240],
    ["plugin/test/long-b.test.mjs", 180],
    ["plugin/test/short.test.mjs", 1],
  ]);
  const input = [
    `${root}/plugin/test/short.test.mjs`,
    `${root}/plugin/test/unknown.test.mjs`,
    `${root}/plugin/test/long-a.test.mjs`,
    `${root}/plugin/test/long-b.test.mjs`,
  ];
  const out = orderByLpt(input, avg, root);
  assert.deepEqual(
    out.map((f) => f.replace(root + "/", "")),
    [
      "plugin/test/long-a.test.mjs", // 240
      "plugin/test/long-b.test.mjs", // 180
      "plugin/test/short.test.mjs", // 1
      "plugin/test/unknown.test.mjs", // 0 — unknown goes LAST
    ],
  );
});

test("AC2b — a known-long file lands in the first N (N = known-long count) of the sorted list", () => {
  const root = "/home/yale/work/quay";
  const avg = new Map([
    ["plugin/test/long.test.mjs", 200],
    ["plugin/test/other.test.mjs", 50],
  ]);
  const input = Array.from({ length: 20 }, (_, i) => `${root}/plugin/test/f${i}.test.mjs`).concat([
    `${root}/plugin/test/long.test.mjs`,
    `${root}/plugin/test/other.test.mjs`,
  ]);
  const out = orderByLpt(input, avg, root);
  assert.equal(out[0], `${root}/plugin/test/long.test.mjs`, "the longest-known file must lead");
  assert.equal(out[1], `${root}/plugin/test/other.test.mjs`);
  assert.equal(out.length, input.length, "every file is emitted exactly once (no drop, no dup)");
});

test("AC3 — absent carrier ⇒ loadDurationAverages is empty (fail-open: no history, no reorder)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-empty-"));
  try {
    const avg = loadDurationAverages(path.join(root, ".quay", "verification-round.jsonl"), root, 3);
    assert.equal(avg.size, 0, "an absent/unreadable carrier must yield an empty map");
    // And orderByLpt over an empty map returns the input unchanged (same order, same set).
    const input = ["a.test.mjs", "b.test.mjs"];
    assert.deepEqual(orderByLpt(input, avg, root), input);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3b — a short/empty helper result never empties the list (spawnSync round-trip over an absent carrier)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lpt-spawn-"));
  try {
    const helper = path.join(REPO_ROOT, "plugin", "scripts", "suite-lpt-order.ts");
    const r = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", helper, "--root", root, "--rounds", "3"],
      { input: "plugin/test/a.test.mjs\nplugin/test/b.test.mjs\n", encoding: "utf8" }
    );
    assert.equal(r.status, 0, `helper must exit 0 (stderr: ${r.stderr})`);
    // No carrier ⇒ input unchanged (a.test.mjs then b.test.mjs).
    assert.equal(r.stdout, "plugin/test/a.test.mjs\nplugin/test/b.test.mjs\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC4 — repoRelKey folds worktree + main-checkout absolute paths to the same repo-relative key", () => {
  const root = "/home/yale/work/quay";
  assert.equal(
    repoRelKey("/home/yale/work/quay-worktrees/gap-x-abc/plugin/test/foo.test.mjs", root),
    "plugin/test/foo.test.mjs",
    "worktree absolute path must strip the quay-worktrees prefix",
  );
  assert.equal(
    repoRelKey("/home/yale/work/quay/plugin/test/foo.test.mjs", root),
    "plugin/test/foo.test.mjs",
    "main-checkout absolute path must strip the repo-root prefix",
  );
  assert.equal(
    repoRelKey("plugin/test/foo.test.mjs", root),
    "plugin/test/foo.test.mjs",
    "an already repo-relative path is unchanged",
  );
});

test("AC5 — loadDurationAverages takes a rolling average over the most recent rounds and tolerates malformed lines", () => {
  const root = makeRootWithCarrier([
    [
      ["plugin/test/x.test.mjs", 100],
      ["plugin/test/y.test.mjs", 200],
    ],
    [["plugin/test/x.test.mjs", 300]], // y absent this round — averages only over appearances
  ]);
  try {
    const carrier = path.join(root, ".quay", "verification-round.jsonl");
    // Append a malformed line + a record without perFile — both must be skipped, not fatal.
    fs.appendFileSync(carrier, "{not json\n" + JSON.stringify({ round: 9, state: "red" }) + "\n");
    const avg = loadDurationAverages(carrier, root, 3);
    assert.equal(avg.get("plugin/test/x.test.mjs"), 200, "x averages (100+300)/2");
    assert.equal(avg.get("plugin/test/y.test.mjs"), 200, "y averages over its one appearance");
    assert.equal(avg.size, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
