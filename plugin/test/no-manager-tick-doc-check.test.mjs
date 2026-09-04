// @test-group engine
// no-manager-tick-doc-check.test.mjs — gap-manager-productization-five-constraints AC4 (C3):
// the OUTER tick docs must contain no create/drive/check manager STEPS.
//
//   AC4 — mechanical check: orchestrator-loop-tick.md + the plugin/loop outer template contain no
//         create/drive/check manager step (grep checker wired to static checks). C3
//         (SPEC-manager-productization §3): build ownership = quay outer/inner, run ownership =
//         human/loop, NEVER outer.
//
// The check is POSITION-BASED (like drive-contract-check), not keyword-based: actionable manager
// steps (`quay manager start`, 创建 manager, …) flag; boundary context ("manager 跨项目不属于项目
// 拓扑") is allowed and must NOT flag (a naive `grep manager` self-hits 100% on the outer tick doc's
// legitimate boundary mentions).
//
// Run:
//   scripts/test.sh plugin/test/no-manager-tick-doc-check.test.mjs
//   node --test plugin/test/no-manager-tick-doc-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "..");

const CHECKER = path.join(pluginDir, "scripts", "no-manager-tick-doc-check.ts");
const OUTER_TICK = path.join(pluginDir, "loop", "orchestrator-loop-tick.md");

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], { encoding: "utf8" });
}

test("AC4 — default scan of the two outer tick docs passes (no actionable manager step)", () => {
  const r = runChecker(["--root", repoRoot, "--json"]);
  assert.equal(r.status, 0, `default scan must pass:\n${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true, `must report ok:true:\n${r.stdout}`);
  assert.ok(j.scanned.includes("plugin/loop/orchestrator-loop-tick.md"), "must scan the plugin outer template");
  assert.ok(j.scanned.includes("orchestration/orchestrator-loop-tick.md"), "must scan the quay-local outer tick doc");
  assert.equal(j.violations.length, 0);
});

test("AC4 — the outer tick doc legitimately mentions manager as boundary context, and the checker ALLOWS it (position, not keyword)", () => {
  const src = fs.readFileSync(OUTER_TICK, "utf8");
  assert.ok(/manager/.test(src), "the outer tick doc DOES mention manager (boundary context)");
  // The checker's default scan must still pass — those are boundary mentions, not actionable steps.
  const r = runChecker(["--root", repoRoot, "--json"]);
  assert.equal(r.status, 0, `boundary mentions must not redden the checker:\n${r.stdout}`);
});

test("AC4 — positive control: an actionable manager step (quay manager start) flags, exit 1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtdc-pos-"));
  try {
    const doc = path.join(dir, "outer.md");
    fs.writeFileSync(doc, "## 冷启动\n先调 quay manager start 拉起 manager，再建单窗口。\n", "utf8");
    const r = runChecker(["--root", repoRoot, "--judge", doc, "--json"]);
    assert.equal(r.status, 1, `actionable step must fail (exit 1):\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false);
    assert.ok(j.violations.length >= 1, `must report at least one violation:\n${r.stdout}`);
    assert.match(j.violations[0].text, /quay manager start/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AC4 — negative control: boundary-only doc (manager 跨项目不属于项目拓扑) passes, exit 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtdc-neg-"));
  try {
    const doc = path.join(dir, "outer.md");
    fs.writeFileSync(doc, "调 quay-topology.sh 建单窗口（outer，manager 跨项目不属于项目拓扑，不建）。\n", "utf8");
    const r = runChecker(["--root", repoRoot, "--judge", doc, "--json"]);
    assert.equal(r.status, 0, `boundary-only doc must pass:\n${r.stdout}\n${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.equal(j.violations.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("AC4 — mutation case exists and passes (checker is mutation-tested per gap-checkers-have-never-been-shown-to-fail)", () => {
  const caseFile = path.join(pluginDir, "scripts", "checker-mutation-cases", "no-manager-tick-doc-check.sh");
  assert.ok(fs.existsSync(caseFile), "mutation case must exist (checker-mutation-check manifest requires it)");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nmtdc-mut-"));
  try {
    const r = spawnSync("bash", [caseFile, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, `mutation case must pass:\n${r.stdout}\n${r.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
