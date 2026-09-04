// @test-group engine
// reanchor-prompt.test.mjs — gap-inner-has-no-periodic-anchor-prose-only-drives-drift.
//
// The inner loop's ONLY anchor used to be outer drive prose (inner Cron count = 0, all overnight
// drives were send-keys), while the outer is force-re-read of the shipped doc every 20 min. This
// anchor asymmetry is the structural root of inner behavior drift. The ruling: give the inner a
// periodic, wording-independent re-anchor to the shipped doc via the OUTER's existing cron
// relaying a FIXED re-anchor prompt — with a strict conformance-check-only wake contract so the
// cron NEVER becomes a second dispatch source.
//
//   AC3 — anti-double-dispatch-source mechanical guarantee: the re-anchor prompt constant carries
//         ZERO dispatch language (no 派发 / 排序 / batch / 批). Enforced here by grep, not prose.
//   AC4 — wording-independence: the re-anchor is a CHECKED-IN FIXED CONSTANT
//         (plugin/scripts/reanchor-prompt.txt), NOT outer ad-hoc prose each tick; the outer tick
//         doc relays that constant verbatim (referenced by path, not re-written).
//   AC5 — the shipped inner doc (plugin/loop/fast-mode-loop-tick.md) carries the mechanical
//         状态自检清单 section the inner runs on re-anchor (in-flight / pool / closure /
//         stop-conditions), so "check state conforms" is mechanically executable, not prose.
//   AC7 — this file uses `import { test } from "node:test"` + `// @test-group engine`.
//
// Run:
//   scripts/test.sh plugin/test/reanchor-prompt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const PROMPT_FILE = path.join(repoRoot, "plugin/scripts/reanchor-prompt.txt");
const OUTER_TICK = path.join(repoRoot, "plugin/loop/orchestrator-loop-tick.md");
const INNER_TICK = path.join(repoRoot, "plugin/loop/fast-mode-loop-tick.md");

// AC3 forbidden dispatch-language substrings (the task's Contract `invoke` greps these exact four).
const FORBIDDEN_DISPATCH = ["派发", "排序", "batch", "批"];

function read(file) {
  return fs.readFileSync(file, "utf8");
}

test("AC4 — the re-anchor constant is a checked-in, non-empty fixed file", () => {
  assert.ok(fs.existsSync(PROMPT_FILE), `re-anchor constant missing: ${PROMPT_FILE}`);
  const text = read(PROMPT_FILE);
  assert.ok(text.trim().length > 0, "re-anchor constant must not be empty");
  // Wording-independence: the constant must point at the shipped doc it re-anchors to, by name.
  assert.ok(
    text.includes("fast-mode-loop-tick.md"),
    're-anchor constant must name the shipped doc it points at (fast-mode-loop-tick.md)',
  );
});

test("AC3 — the re-anchor constant contains ZERO dispatch language (派发/排序/batch/批)", () => {
  const text = read(PROMPT_FILE);
  for (const word of FORBIDDEN_DISPATCH) {
    assert.ok(!text.includes(word), `re-anchor constant contains forbidden dispatch word: ${word}`);
  }
  // Stricter guard: no dispatch verb at all (派 / 调度) — the constant must never read as a
  // scheduling instruction, only a "re-read the doc and conformance-check" wake.
  for (const verb of ["派", "调度"]) {
    assert.ok(!text.includes(verb), `re-anchor constant contains dispatch-flavored verb: ${verb}`);
  }
});

test("AC3 — the wake contract is conformance-check, not scheduling (four checks + self-correct, no action decided)", () => {
  const text = read(PROMPT_FILE);
  // The conformance checks the wake must enumerate (in-flight / pool / closure / stop-conditions).
  for (const check of ["在飞", "就绪池", "收尾", "停止条件"]) {
    assert.ok(text.includes(check), `re-anchor constant missing conformance check: ${check}`);
  }
  // On a clear deviation it self-corrects TOWARD the doc — it does not decide new work.
  assert.ok(text.includes("无操作"), "constant must allow conform => no-op");
  assert.ok(text.includes("向出厂文档对齐自我修正"), "constant must self-correct toward the doc on deviation");
});

test("AC4 — the outer tick relays the checked-in constant, not ad-hoc prose", () => {
  const tick = read(OUTER_TICK);
  assert.ok(
    tick.includes("plugin/scripts/reanchor-prompt.txt"),
    "outer tick must reference the checked-in constant path plugin/scripts/reanchor-prompt.txt",
  );
  // The tick must relay the constant VERBATIM (read the file), not re-write a new paragraph.
  assert.ok(
    /reanchor-prompt\.txt/.test(tick) && /逐字|原样|verbatim|cat plugin\/scripts\/reanchor-prompt/.test(tick),
    "outer tick must relay the constant verbatim (cat/re-read), not rewrite it",
  );
});

test("AC5 — the shipped inner doc carries the mechanical 状态自检清单 section", () => {
  const inner = read(INNER_TICK);
  assert.ok(inner.includes("状态自检清单"), "inner doc must contain the 状态自检清单 section");
  // The checklist must be mechanically executable: it names the four checks and a mechanical
  // judgment for each (commands / concrete state reads), not prose.
  for (const check of ["在飞", "就绪池", "收尾", "停止条件"]) {
    assert.ok(inner.includes(check), `状态自检清单 missing mechanical check item: ${check}`);
  }
});
