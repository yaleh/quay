// @test-group governance
// fast-mode-loop-tick-dedup.test.mjs — tasks/gap-fast-mode-loop-tick-duplicate-paste-blocks.
//
// The inner tick doc (`plugin/loop/fast-mode-loop-tick.md`) had 4 confirmed duplicate paste blocks
// (two ① self-check rows, two rebase/merge fan-in step-0/1 blocks, the concurrent-batch-scheduler
// deferred `(overlap: <file>)` comment residue, two step-6 ScheduleWakeup paragraphs) plus one
// interleaved duplicate in the 判绿三条件 paragraph. Each rule's mechanical key line is now
// single-sourced. This test pins the dedup mechanically so the duplicate-paste defect class cannot
// silently return:
//   - AC2/AC3 (Contract measure): each rule's key line appears EXACTLY once in the doc.
//   - AC4 (invariant no_new_duplicate_block): no run of >=4 consecutive identical lines, and no
//     4-line block repeats anywhere in the doc.
//   - The ① row's field name is consistent (realConcurrency, not the hyphenated real-concurrency).
//
// Run:
//   scripts/test.sh plugin/test/fast-mode-loop-tick-dedup.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const DOC = path.join(repoRoot, "plugin/loop/fast-mode-loop-tick.md");

/** The 4 rules' mechanical key lines (the task's `grep -c "<各规则关键行>"` measure). */
const KEY_LINES = [
  "| ① | 在飞 agent 是否符合文档 |",
  "git -C $WORKTREE_ROOT/<slug> rebase ",
  "(overlap: <file>)",
  "ScheduleWakeup`，间隔 **1200–1800 秒**",
];

test("AC2/AC3 — each deduped rule's key line appears EXACTLY once", () => {
  const src = fs.readFileSync(DOC, "utf8");
  for (const key of KEY_LINES) {
    const count = src.split("\n").filter((l) => l.includes(key)).length;
    assert.equal(count, 1, `expected exactly 1 occurrence of key line: ${key}, got ${count}`);
  }
});

test("AC3 — the ① self-check row uses one consistent field name (realConcurrency, not real-concurrency)", () => {
  const src = fs.readFileSync(DOC, "utf8");
  const row = src.split("\n").find((l) => l.includes("| ① | 在飞 agent 是否符合文档 |"));
  assert.ok(row, "self-check item ① must exist");
  assert.match(row, /realConcurrency/, "item ① must read the reconcile-aware realConcurrency signal");
  assert.doesNotMatch(row, /real-concurrency/, "item ① must not use the hyphenated (wrong) field name");
});

test("AC4 — invariant no_new_duplicate_block: no >=4 consecutive identical lines in the tick doc", () => {
  const lines = fs.readFileSync(DOC, "utf8").split("\n");
  for (let i = 0; i + 4 <= lines.length; i++) {
    const block = lines.slice(i, i + 4);
    if (new Set(block).size === 1) {
      assert.fail(`4+ consecutive identical lines at ${i + 1}: ${JSON.stringify(block[0].slice(0, 60))}`);
    }
  }
});

test("AC4 — invariant no_new_duplicate_block: no 4-line block repeats elsewhere in the tick doc", () => {
  const lines = fs.readFileSync(DOC, "utf8").split("\n");
  const seen = new Map();
  for (let i = 0; i + 4 <= lines.length; i++) {
    const key = lines.slice(i, i + 4).join("\n");
    if (seen.has(key)) {
      assert.fail(`duplicate 4-line block at ${seen.get(key) + 1} and ${i + 1}: ${JSON.stringify(lines[i].slice(0, 60))}`);
    }
    seen.set(key, i);
  }
});
