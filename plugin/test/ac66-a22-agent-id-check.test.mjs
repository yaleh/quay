// @test-group engine
// ac66-a22-agent-id-check.test.mjs — AC66 判据2 A22 样板负控制 fixture (A22 真样本回放, D2 不构造).
// plugin/scripts/ac66-a22-agent-id-check.ts. The real absence samples (the pre-fix tick-log lines
// where ready-pool-check ran on the MAIN thread and the reading line carried NO agent id) MUST each
// replay RED — that is the "能取假" requirement (AC66 判据3). The real COMPLIANT lines (the A22 lines
// that carried the subagent's agent id) MUST replay GREEN. NOT-EVALUATED when the log has no A22
// reading line (硬规则 3b — 无法评估 ≠ 合格).
//
// Real samples embedded verbatim from orchestration/tick-log.md (2026-08-14):
//   absence  「A22 心跳：promotions=AC76+AC77（todo→ready，fddb20b8）；pool 7/floor 20。」        (08:0xZ)
//   absence  「A22 后台心跳已跑（--cap 5 校正后 pool 7/floor 20/deficit 13，本次无新晋——AC73 已 ready）」 (05:19Z)
//   absence  「A22 后台 subagent 心跳：`ready-pool-check --apply` 晋 AC73 todo→ready（416cd1d2 已提交）」  (05:07Z — has "subagent" but the parenthesized 416cd1d2 is a COMMIT SHA, not the agent id)
//   absence  「A22 晋 AC56/AC61/AC62 ready（cbb1791e——AC55 done 解封 deps）」                      (02:45Z)
//   compliant「本轮 A22 由后台 subagent（agentId afb5faed96138c7c6）执行，读数：POOL=4 / FLOOR=20 / DEFICIT=16 / PROMOTIONS=NONE」 (02:10Z)
//   compliant「A22 后台 subagent（a841b6b1db36f0098）晋 AC66 ready（6f0e6f3a）」                   (03:08Z)
//
// Run:
//   scripts/test.sh plugin/test/ac66-a22-agent-id-check.test.mjs
//   node --test plugin/test/ac66-a22-agent-id-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  isA22ReadingLine,
  hasAgentId,
  extractA22ReadingLines,
  judgeLatestA22Line,
} from "../scripts/ac66-a22-agent-id-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "ac66-a22-agent-id-check.ts");

// ── the REAL samples (verbatim from orchestration/tick-log.md 2026-08-14, D2 不构造) ────────────────

const REAL_ABSENCE_SAMPLES = [
  "A22 心跳：promotions=AC76+AC77（todo→ready，fddb20b8）；pool 7/floor 20。",
  "A22 心跳 pool 6/floor 20/deficit 14、promotions=[]（AC72 deps-blocked on AC67、DIR-127 缺 dod / DIR-128 缺 plan、cold-start compound）。",
  "A22 后台心跳已跑（--cap 5 校正后 pool 7/floor 20/deficit 13，本次无新晋——AC73 已 ready）",
  "A22 后台 subagent 心跳：`ready-pool-check --apply` 晋 AC73 todo→ready（416cd1d2 已提交）。",
  "A22 晋 AC56/AC61/AC62 ready（cbb1791e——AC55 done 解封 deps）",
  "A22 无晋（pool 5/deficit 15）",
  "A22 心跳：pool 5/floor 20/deficit 15、promotions=2（B15-pool-quality + B15-telemetry，todo→ready，e5d1ba5e 已提交——manager ④ 止损指出这俩 M 状态会破 clean-tree 闸硬阻 AC64/67 ff，即时提交）。",
  "A22 心跳 pool 8/floor 20/deficit 12、promotions=[]（AC72 deps-blocked）",
  "A22 心跳 pool 9/floor 20/deficit 11、promotions=[]",
];

const REAL_COMPLIANT_SAMPLES = [
  "本轮 A22 由后台 subagent（agentId afb5faed96138c7c6）执行，读数：POOL=4 / FLOOR=20 / DEFICIT=16 / PROMOTIONS=NONE（无候选可晋——AC56 deps 卡 AC55 在飞、test-isolation not-yet-flipped，结构性）。",
  "**A22 由后台 subagent 执行（ae01be3e9be8c95cb）——连续二轮合规（不在主线程跑）**，读数 POOL=4/FLOOR=20/DEFICIT=16/PROMOTIONS=NONE（结构性不可晋）。",
  "A22 后台 subagent（a841b6b1db36f0098）晋 AC66 ready（6f0e6f3a）。",
];

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ac66a22-${prefix ?? ""}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

function runChecker(args) {
  return spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--json", ...args], { encoding: "utf8" });
}

function jsonOut(r) {
  return JSON.parse(r.stdout);
}

// ── PURE: line classification ─────────────────────────────────────────────────────────────────────────

test("PURE isA22ReadingLine — A22 as a TOPIC token + a ready-pool result ⇒ reading line", () => {
  assert.equal(isA22ReadingLine("A22 心跳：pool 7/floor 20。"), true);
  assert.equal(isA22ReadingLine("**A22 由后台 subagent 执行（ae01be3e9be8c95cb）**，读数 POOL=4/FLOOR=20"), true);
  assert.equal(isA22ReadingLine("A22 晋 AC66 ready（6f0e6f3a）"), true);
  assert.equal(isA22ReadingLine("A22 无晋（pool 5/deficit 15）"), true);
  // the five-inequality evidence mentions A22 as an ASIDE, not a topic — NOT a reading line
  assert.equal(isA22ReadingLine("②pool<floor→晋级补池 [当前真:pool=4<20,已跑A22 promotions=[] 结构不可晋]"), false);
  assert.equal(isA22ReadingLine("A22 违规修复首跑"), false); // mentions A22 but no ready-pool result
  assert.equal(isA22ReadingLine(""), false);
});

test("PURE hasAgentId — agentId=… or a parenthesized id near agent/subagent; a trailing COMMIT SHA is not", () => {
  assert.equal(hasAgentId("agentId afb5faed96138c7c6"), true);
  assert.equal(hasAgentId("A22 由后台 subagent 执行（ae01be3e9be8c95cb）"), true);
  assert.equal(hasAgentId("A22 后台 subagent（a841b6b1db36f0098）晋 AC66 ready"), true);
  assert.equal(hasAgentId("agentId=902b4528-bc95-4ec6-9e10-5c2a0c47c4bb"), true);
  // subagent present but the parenthesized token is a 8-hex COMMIT SHA far past the 24-char proximity
  assert.equal(hasAgentId("A22 后台 subagent 心跳：`ready-pool-check --apply` 晋 AC73 todo→ready（416cd1d2 已提交）"), false);
  assert.equal(hasAgentId("A22 晋 AC56/AC61/AC62 ready（cbb1791e——AC55 done 解封 deps）"), false);
  assert.equal(hasAgentId("A22 心跳：pool 7/floor 20。"), false);
});

test("PURE extractA22ReadingLines — pulls only A22 reading lines out of a log body", () => {
  const body = [
    "- 五条不等式: ②pool<floor→晋级补池 [当前真:pool=4<20,已跑A22 promotions=[] 结构不可晋]",
    "- `02:10Z` — **A22 由后台 subagent 执行（ae01be3e9be8c95cb）**，读数 POOL=4/FLOOR=20/DEFICIT=16/PROMOTIONS=NONE。",
    "- `08:0xZ` — **A22 心跳**：promotions=AC76+AC77（todo→ready，fddb20b8）；pool 7/floor 20。",
  ].join("\n");
  const lines = extractA22ReadingLines(body);
  assert.equal(lines.length, 2, "only the two A22-as-topic reading lines, not the 五条不等式 aside");
  assert.ok(lines[0].includes("ae01be3e9be8c95cb"));
  assert.ok(lines[1].includes("pool 7/floor 20"));
});

// ── PURE: 判据2 — latest A22 reading line must carry an agent id (forward-only) ─────────────────────

test("PURE judgeLatestA22Line — latest without agent id ⇒ red; with agent id ⇒ green; none ⇒ not-evaluated", () => {
  assert.equal(judgeLatestA22Line([]).evaluated, false);
  assert.equal(judgeLatestA22Line([]).ok, true);
  const red = judgeLatestA22Line(REAL_ABSENCE_SAMPLES);
  assert.equal(red.ok, false);
  assert.equal(red.evaluated, true);
  assert.equal(red.reason, "all-a22-reading-lines-lack-agent-id");
  const green = judgeLatestA22Line(REAL_COMPLIANT_SAMPLES);
  assert.equal(green.ok, true);
  assert.equal(green.evaluated, true);
  // forward-only: a non-compliant line EARLIER + a compliant line LATEST ⇒ green (history not retroactively red)
  const forwardOnly = judgeLatestA22Line([REAL_ABSENCE_SAMPLES[0], REAL_COMPLIANT_SAMPLES[0]]);
  assert.equal(forwardOnly.ok, true);
  assert.equal(forwardOnly.reason, "latest-a22-reading-carries-agent-id");
  // a compliant line EARLIER + a non-compliant line LATEST ⇒ red (the behavior regressed)
  const regression = judgeLatestA22Line([REAL_COMPLIANT_SAMPLES[0], REAL_ABSENCE_SAMPLES[0]]);
  assert.equal(regression.ok, false);
  assert.equal(regression.reason, "latest-a22-reading-lacks-agent-id");
});

// ── 判据3 — real-sample replay through the CLI (D2 不构造) ───────────────────────────────────────────

test("判据3 — EVERY real absence sample replays RED (exit 1)", () => {
  for (const sample of REAL_ABSENCE_SAMPLES) {
    const r = runChecker(["--line", sample]);
    assert.equal(r.status, 1, `real absence sample must be RED: ${sample} → ${r.stdout}${r.stderr}`);
    const j = jsonOut(r);
    assert.equal(j.ok, false);
    assert.equal(j.evaluated, true);
  }
});

test("判据3 — EVERY real compliant sample replays GREEN (exit 0)", () => {
  for (const sample of REAL_COMPLIANT_SAMPLES) {
    const r = runChecker(["--line", sample]);
    assert.equal(r.status, 0, `real compliant sample must be GREEN: ${sample} → ${r.stdout}${r.stderr}`);
    const j = jsonOut(r);
    assert.equal(j.ok, true);
    assert.equal(j.evaluated, true);
  }
});

test("判据3 — a log body with NO A22 reading line ⇒ NOT-EVALUATED (exit 0, evaluated:false)", () => {
  const r = runChecker(["--line", "- 五条不等式: ①in_flight<cap且recommended非空→假\n- `03:00Z` no-action：无动作"]);
  assert.equal(r.status, 0, "no A22 reading line must NOT be red");
  const j = jsonOut(r);
  assert.equal(j.ok, true);
  assert.equal(j.evaluated, false);
  assert.match(j.reason, /NOT-EVALUATED/);
});

// ── CLI: --log fixture + missing log ────────────────────────────────────────────────────────────────

test("CLI --log — a fixture log whose latest A22 line lacks agent id ⇒ RED (exit 1)", () => {
  const dir = makeTmp("log");
  try {
    const log = path.join(dir, "tick-log.md");
    fs.writeFileSync(log, [
      "- `02:10Z` — 本轮 A22 由后台 subagent（agentId afb5faed96138c7c6）执行，读数 POOL=4。",
      "- `08:0xZ` — **A22 心跳**：promotions=AC76+AC77（todo→ready，fddb20b8）；pool 7/floor 20。",
    ].join("\n") + "\n", "utf8");
    const r = runChecker(["--log", log]);
    assert.equal(r.status, 1, `latest line without agent id must be RED: ${r.stdout}${r.stderr}`);
    const j = jsonOut(r);
    assert.equal(j.ok, false);
    assert.equal(j.evaluated, true);
    assert.equal(j.checks[0].check, "a22-latest-reading-agent-id");
  } finally {
    cleanup(dir);
  }
});

test("CLI --log — a fixture log whose latest A22 line carries agent id ⇒ PASS (exit 0)", () => {
  const dir = makeTmp("loggreen");
  try {
    const log = path.join(dir, "tick-log.md");
    fs.writeFileSync(log, [
      "- `02:10Z` — A22 心跳：pool 7/floor 20。",
      "- `08:0xZ` — 本轮 A22 由后台 subagent（agentId afb5faed96138c7c6）执行，读数 POOL=4。",
    ].join("\n") + "\n", "utf8");
    const r = runChecker(["--log", log]);
    assert.equal(r.status, 0, `latest line with agent id must be GREEN: ${r.stdout}${r.stderr}`);
    const j = jsonOut(r);
    assert.equal(j.ok, true);
    assert.equal(j.evaluated, true);
  } finally {
    cleanup(dir);
  }
});

test("CLI --log — a missing tick-log ⇒ NOT-EVALUATED (exit 0), not red", () => {
  const dir = makeTmp("nolog");
  try {
    const r = runChecker(["--log", path.join(dir, "does-not-exist.md")]);
    assert.equal(r.status, 0);
    const j = jsonOut(r);
    assert.equal(j.ok, true);
    assert.equal(j.evaluated, false);
    assert.match(j.reason, /no-tick-log/);
  } finally {
    cleanup(dir);
  }
});

test("--help exits 0 with usage on stdout", () => {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ac66-a22-agent-id-check/);
  assert.match(r.stdout, /--log/);
});
