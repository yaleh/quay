// @test-group governance
// tick-vocabulary.test.mjs — gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round.
//
// The dispatch vocabulary conflated two things under one word "batch":
//   1. dispatch is ROLLING (a slot freed ⇒ immediately re-evaluated, never accumulated into a
//      dispatch gate — proven by gap-eighty-two's empty-slot dispatch);
//   2. full-suite verification + closure bookkeeping is BATCHED (the outer's fan-in model).
// A future reader (including after a model change) reading tick-log / commit wording could
// misread "batch" as "dispatch must be gated" and drift behavior back. This task splits the
// vocabulary at the DOC level (the mechanism root, gap-closure-sync-..., already moved the batch
// boundary out of the inner):
//
//   dispatch is ROLLING — never batch-numbered, never a dispatch gate;
//   the verification/closure cadence is `verification-round-N` — about verification, NOT dispatch gating.
//
// This test pins the doc-side split mechanically (AC1/AC4/AC6):
//
//   AC1/AC4 measure — batch_misread_count = grep -rn '同批\|批派发\|batch-N' over the two tick docs
//         must be ZERO (zero batch wording readable as dispatch gating).
//   AC4 negative control — a constructed text containing 可同批 / 批派发 / batch-N MUST be flagged
//         by the same predicate (proving the whitelist is not a universal excuse).
//   AC4 classification — every line containing `batch` in the two tick docs must be classifiable
//         as one of: 机件真名 (concurrent-batch-scheduler.ts / {batch,deferred} / batch ⇒ field
//         reference / integration-batch-merge.sh), 任务 id (gap-closure-sync-is-the-true-batch-
//         boundary, gap-split-batch-vocabulary-...), 历史引用 (batch2-queue-state.md, batch4a/4b/4c,
//         「Close batch」), 审计检查机制 (reanchor-prompt.txt grep / self-report-vocab-audit /
//         "Batch of N fully merged" quote). NONE is unclassified gate-reading prose.
//   AC2/AC5 — the verification cadence is named `verification-round-N` with an explicit
//         "不是分派门控" annotation; both tick docs carry the normative statement
//         (分派是滚动的 / verification-round-N).
//   AC6 — this file uses `import { test } from "node:test"` + `// @test-group governance`.
//
// Run:
//   scripts/test.sh plugin/test/tick-vocabulary.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const DOCS = [
  path.join(repoRoot, "plugin/loop/fast-mode-loop-tick.md"),
  path.join(repoRoot, "plugin/loop/orchestrator-loop-tick.md"),
];

// AC1/AC4 Contract measure — the exact misread patterns (grep parity over the two tick docs).
const MISREAD_PATTERNS = ["同批", "批派发", "batch-N"];

// AC4 classification — a `batch` line is SAFE iff it contains at least one of these non-gating
// substrings. Each maps to a category in the task's AC4 grep classification table:
//   机件真名  concurrent-batch-scheduler.ts / {batch,deferred} / "batch ⇒" field reference /
//             integration-batch-merge.sh
//   任务 id    gap-closure-sync-is-the-true-batch-boundary / gap-split-batch-vocabulary-...
//   历史引用   batch2-queue-state.md / batch4a/4b/4c / 「Close batch」 (each annotated 历史引用)
//   审计机制   reanchor-prompt.txt grep / self-report-vocab-audit / "Batch of N fully merged"
const SAFE_SUBSTRINGS = [
  "concurrent-batch-scheduler.ts",
  "concurrent-batch-scheduler",     // 40→6 consolidated dispatch (SPEC-instruments-behind-one-entry.md):
                                    // the docs invoke it via `quay-dispatch.ts concurrent-batch-scheduler`
                                    // (subcommand name, no `.ts` suffix) — same 机件真名 as the file form.
  "quay-dispatch.ts",               // 40→6 consolidated dispatch ENTRY POINT (SPEC-instruments-behind-one-entry.md):
                                    // the docs reference the 6 grouped entry points (`quay-dispatch.ts`,
                                    // `quay-branch.ts`, …) as the surface form — entry-point reference is the
                                    // correct 机件真名, not gating prose (gap-tick-vocabulary-whitelist-stale).
  "integration-batch-merge.sh",
  "integration-batch-merge",        // 40→6 consolidated branch (SPEC-instruments-behind-one-entry.md):
                                    // the docs invoke it via `quay-branch.ts integration-batch-merge`
                                    // (subcommand name, no `.sh` suffix) — same 机件真名 as the file form.
  "quay-branch.ts",                 // 40→6 consolidated branch ENTRY POINT (SPEC-instruments-behind-one-entry.md):
                                    // the docs reference the 6 grouped entry points as the surface form —
                                    // entry-point reference is the correct 机件真名, not gating prose
                                    // (gap-tick-vocabulary-whitelist-stale-against-forty-to-six-entry-forms).
  "gap-closure-sync-is-the-true-batch-boundary",
  "gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round",
  "gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge",  // 任务 id (batch-merge boundary gate): the
                                                                   // tick doc names the task that moved the
                                                                   // full-suite gate to the batch-merge
                                                                   // boundary — mechanism reference, not gating.
  "{ batch, deferred }",
  "batch, deferred",
  "batch ⇒",
  "历史引用",
  "历史批名",          // the docs annotate batch4a/4b/4c as 历史批名 (synonym of 历史引用)
  "batch2-queue-state",
  "self-report-vocab-audit",
  "reanchor-prompt.txt",
  "Batch of N fully merged",
  "batch-free",
  // The vocabulary RULE's own meta-text: it names the forbidden batch phrasing to forbid it —
  // "batch + 编号 的措辞都只能是历史", "batch-4 = 门控语义漂移", "batch 式汇报 = 自述措辞审计".
  // These describe the split (batch = historical/forbidden), they do NOT gate dispatch.
  "batch + 编号",
  "batch 式",          // batch 式汇报 / batch 式自述 — the vocabulary rule's own meta-text
  "门控语义漂移",
];

function readDocs() {
  return DOCS.map((p) => ({ path: p, text: fs.readFileSync(p, "utf8") }));
}

function splitLines(docs) {
  const lines = [];
  for (const { path: p, text } of docs) {
    text.split("\n").forEach((line, i) => lines.push({ file: p, line: i + 1, text: line }));
  }
  return lines;
}

function findMisread(lines) {
  return lines.filter((l) => MISREAD_PATTERNS.some((pat) => l.text.includes(pat)));
}

test("AC1/AC4 — measure: zero misreadable batch phrasing (同批/批派发/batch-N) in the tick docs", () => {
  const hits = findMisread(splitLines(readDocs()));
  assert.equal(hits.length, 0,
    `batch_misread_count must be 0, got:\n${hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n")}`);
});

test("AC4 — negative control: a constructed 可同批/批派发/batch-N text MUST be flagged (whitelist is not a universal excuse)", () => {
  const fake = [
    { file: "fast-mode-loop-tick.md", line: 1, text: "两个任务可同批派发，等凑齐一批再派" },
    { file: "orchestrator-loop-tick.md", line: 2, text: "批派发门控：攒满 batch-N 才放行" },
  ];
  const hits = findMisread(fake);
  assert.equal(hits.length, 2, "constructed gate-reading batch phrasing must be flagged");
  for (const h of hits) {
    assert.ok(MISREAD_PATTERNS.some((pat) => h.text.includes(pat)),
      `flagged line should contain a misread pattern: ${h.text}`);
  }
});

test("AC4 — every `batch` line in the tick docs is classifiable (none is unclassified gate-reading prose)", () => {
  const unclassified = splitLines(readDocs()).filter(
    (l) => l.text.includes("batch") && !SAFE_SUBSTRINGS.some((s) => l.text.includes(s)),
  );
  assert.deepEqual(unclassified, [],
    `unclassified batch lines:\n${unclassified.map((u) => `${u.file}:${u.line}  ${u.text.trim()}`).join("\n")}`);

  // The whitelist must do REAL work — each category must be exercised in the docs, so a future
  // silent re-introduction of gate-reading prose cannot hide behind an empty whitelist.
  const allText = readDocs().map((d) => d.text).join("\n");
  for (const [name, sub] of [
    ["机件真名 scheduler", "concurrent-batch-scheduler.ts"],
    ["机件真名 merge script", "integration-batch-merge.sh"],
    ["任务 id closure-sync", "gap-closure-sync-is-the-true-batch-boundary"],
    ["历史引用 annotation", "历史引用"],
    ["审计机制 reanchor", "reanchor-prompt.txt"],
  ]) {
    assert.ok(allText.includes(sub), `whitelist category not exercised in the docs: ${name}`);
  }
});

test("AC2/AC5 — verification cadence is named verification-round-N with an explicit not-dispatch-gating annotation", () => {
  for (const { path: p, text } of readDocs()) {
    assert.ok(text.includes("verification-round-N"), `${p} must name the cadence verification-round-N`);
    assert.ok(text.includes("不是分派门控"), `${p} must explicitly note the cadence is NOT dispatch gating`);
    assert.ok(text.includes("分派是滚动的"), `${p} must carry the rolling-dispatch normative statement`);
  }
});

test("AC6 — this file is node:test + // @test-group governance", () => {
  const src = fs.readFileSync(new URL(import.meta.url), "utf8");
  assert.match(src, /import \{ test \} from "node:test"/);
  assert.match(src, /\/\/ @test-group governance/);
});
