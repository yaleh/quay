// @test-group governance
// outer-doc-split.test.mjs — tasks/gap-ac38-outer-doc-split (AC38: outer 双份文档漂移未切分).
//
// AC38: `plugin/loop/orchestrator-loop-tick.md` (product behavior) vs
// `orchestration/orchestrator-loop-tick.md` (quay instance state) were near-duplicates
// (heavy common-line overlap = drift). The split follows the manager precedent
// (产品行为进 plugin / 本层实例状态留 orchestration). This test pins the split
// mechanically so the defect class cannot silently return:
//   AC2  — same-shape split: the plugin file is the GENERIC product template (config-referenced,
//         no hardcoded quay instance values), the orchestration file is the quay INSTANCE state
//         doc (carries the 本层状态 section + quay values).
//   AC3  — each file's unique content is role-coherent: plugin unique = product behavior,
//         orchestration unique = instance state (the split declaration in each names its role).
//   AC4  — split declaration present in the two loop-tick docs AND the two tick-core files
//         the touches name (orchestration/orchestrator-tick-core.md + plugin/loop/fast-mode-tick-core.md).
//   AC5  — the Contract measure (comm -3 ... | wc -l) runs and yields the unique-line count.
//
// Run:
//   scripts/test.sh plugin/test/outer-doc-split.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const PLUGIN_TICK = path.join(repoRoot, "plugin/loop/orchestrator-loop-tick.md");
const ORCH_TICK = path.join(repoRoot, "orchestration/orchestrator-loop-tick.md");
const ORCH_CORE = path.join(repoRoot, "orchestration/orchestrator-tick-core.md");
const FAST_CORE = path.join(repoRoot, "plugin/loop/fast-mode-tick-core.md");

const SPLIT_MARKER = "切分声明（AC38";

const pluginSrc = fs.readFileSync(PLUGIN_TICK, "utf8");
const orchSrc = fs.readFileSync(ORCH_TICK, "utf8");

// ── AC4 — split declaration present in the loop-tick docs + the named tick-core files ─────────────
test("AC4 — the split declaration (切分声明（AC38) is present in both loop-tick docs AND both named tick-core files", () => {
  for (const [name, p] of [
    ["plugin/loop/orchestrator-loop-tick.md", PLUGIN_TICK],
    ["orchestration/orchestrator-loop-tick.md", ORCH_TICK],
    ["orchestration/orchestrator-tick-core.md", ORCH_CORE],
    ["plugin/loop/fast-mode-tick-core.md", FAST_CORE],
  ]) {
    assert.ok(fs.readFileSync(p, "utf8").includes(SPLIT_MARKER),
      `${name} must carry the AC38 split declaration (${SPLIT_MARKER})`);
  }
});

test("AC4 — each split declaration names the file's role (plugin=产品行为正本 / orchestration=本层实例状态)", () => {
  assert.match(pluginSrc, /产品行为正本/, "the plugin file's declaration must call it 产品行为正本");
  assert.match(orchSrc, /本层实例状态/, "the orchestration file's declaration must call it 本层实例状态");
  assert.match(orchSrc, /产品行为正本/,
    "the orchestration file's declaration must reference the plugin product 正本");
  assert.match(orchSrc, /## 本层状态/, "the orchestration file must carry the 本层状态 (instance values) section");
});

// ── AC2 — the plugin file is the GENERIC product template (no hardcoded quay instance values) ──────
test("AC2 — the plugin product template has NO hardcoded quay instance values (config-referenced instead)", () => {
  // The quay project list as a required literal is instance state → must not be hardcoded in the product.
  assert.doesNotMatch(pluginSrc, /for d in quay archguard meta-cc/,
    "plugin template must not hardcode the quay project list as a runnable literal");
  assert.doesNotMatch(pluginSrc, /for t in \/home\/yale\/work\//,
    "plugin template must not hardcode quay repo paths as runnable literals");
  // The two-line branch model must be expressed via the config refs, not baked develop/integration.
  assert.doesNotMatch(pluginSrc, /git branch -f develop integration/,
    "plugin template must not bake the develop/integration branch names into the ff command");
  assert.doesNotMatch(pluginSrc, /git merge-base --is-ancestor develop integration/,
    "plugin template must not bake the develop/integration branch names into the ff precondition");
  // The config-reference convention must be present (the generic product is config-driven).
  assert.match(pluginSrc, /FORK_BASELINE/, "plugin template must reference FORK_BASELINE config value");
  assert.match(pluginSrc, /MERGE_TARGET/, "plugin template must reference MERGE_TARGET config value");
});

test("AC2 — the plugin template defers quay instance values to the orchestration 本层状态 (no duplicate ownership)", () => {
  // Where the plugin does name quay's instance values, it must point at the orchestration copy,
  // not claim to own them.
  assert.match(pluginSrc, /本层实例状态|本层状态/, "the plugin template must acknowledge the instance-state boundary");
});

// ── AC3 — the orchestration file is the quay INSTANCE state doc ───────────────────────────────────
test("AC3 — the orchestration file carries the quay instance values (本层状态 section)", () => {
  const instanceSection = orchSrc.slice(orchSrc.indexOf("## 本层状态"));
  assert.match(instanceSection, /develop/, "本层状态 must carry fork_baseline: develop");
  assert.match(instanceSection, /merge_target: develop/, "本层状态 must carry the single-line develop target (AC48 2026-08-13 retired integration)");
  assert.match(instanceSection, /quay \/ archguard \/ meta-cc/, "本层状态 must carry the quay project list");
  assert.match(instanceSection, /quay-0:inner/, "本层状态 must carry the tmux window layout");
});

// ── AC5 — the Contract measure runs and yields the unique-line count ──────────────────────────────
test("AC5 — the Contract measure (comm -3 ... | wc -l) runs and produces the unique-line count", () => {
  const bash =
    `comm -3 <(sort "${PLUGIN_TICK}") <(sort "${ORCH_TICK}") | wc -l`;
  const out = execFileSync("bash", ["-c", bash], { encoding: "utf8" }).trim();
  const n = Number(out);
  assert.ok(Number.isInteger(n) && n >= 0, `the measure must produce a non-negative integer, got: ${out}`);
  // After the split each file still has role-specific unique content (plugin=product, orch=instance),
  // so the unique-line count must be meaningfully > 0.
  assert.ok(n >= 50, `the split must leave substantial role-specific unique content, got ${n} unique lines`);
});
