// @test-group engine
// fan-in-workflow-retirement-check.test.mjs — fan-in workflow 退役防回归的 RED/GREEN/NOT-EVALUATED 测试
// (plugin/scripts/fan-in-workflow-retirement-check.ts, gap-fan-in-workflow-retirement-guard).
//
// Criterion (tasks/gap-fan-in-workflow-retirement-guard.md, verbatim):
//   AC2（退役彻底）: 两 fan-in-execute.js 路径不存在 + 引用面归零（归档白名单除外）。
//     （⛔ 路径仍存在 ⇒ 不可判（P3 未删除）; 引用未清零 ⇒ RED）
//   AC1 + AC3（防复活）: lock-events 非 wk-prod- 前缀 acquire 计数 = 0（窗口从 L1 落地起）。
//     （⛔ 非 wk-prod- acquire ⇒ RED; 文件缺失 ⇒ 不可判）
//
// Covered here — 负控制（能取假，硬规则 4）:
//   - RED (AC2 引用未清零): 双副本删除后仍有存活引用 ⇒ checkDualCopies references 非空。
//   - RED (AC1 非 wk-prod acquire): lock-events 里有非 wk-prod- 前缀 acquire ⇒ 非空。
//   - NOT-EVALUATED (AC2 双副本仍在): 路径仍存在 ⇒ evaluated=false（P3 未删）。
//   - NOT-EVALUATED (AC1 文件缺失): lock-events 文件不存在 ⇒ evaluated=false。
//   - PASS: 双副本删净 + 引用归零 + lock-events 只有 wk-prod ⇒ 全 verified。
//   - 位置判定: 注释里提 fan-in-execute 不算；字符串/命令位置算（硬规则 2）。
//   - 窗口: epoch < sinceEpoch 的非 wk-prod acquire 不计入。
//
// Run:
//   scripts/test.sh plugin/test/fan-in-workflow-retirement-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkDualCopies,
  checkLockEvents,
  runCheck,
  codeOnlyText,
  isMechanicalPrefix,
  deriveL1Epoch,
  WORKFLOW_PATHS,
} from "../scripts/fan-in-workflow-retirement-check.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** 建一个最小临时 root：可选双副本 + 可选可执行文件树 + 可选 lock-events。 */
function makeRoot({ dualCopies = false, lockEvents = null, files = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwr-"));
  fs.mkdirSync(path.join(tmp, ".quay"), { recursive: true });
  for (const p of WORKFLOW_PATHS) {
    const full = path.join(tmp, p);
    if (dualCopies) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "// fan-in-execute.js dual copy\n");
    } else {
      fs.rmSync(full, { force: true });
    }
  }
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  if (lockEvents !== null) {
    fs.writeFileSync(path.join(tmp, ".quay", "fan-in-lock-events.jsonl"), lockEvents);
  }
  return tmp;
}

function cleanup(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── AC2 负控制: 双副本仍在 ⇒ NOT-EVALUATED（P3 未删，退役彻底性不可判）───────────────────────────
test("AC2 NOT-EVALUATED: 双副本仍在 ⇒ checkDualCopies evaluated=false", () => {
  const tmp = makeRoot({ dualCopies: true });
  try {
    const r = checkDualCopies(tmp);
    assert.equal(r.evaluated, false, "dual copies present must be NOT-EVALUATED (P3 not done)");
    assert.deepEqual(r.existingPaths.sort(), [...WORKFLOW_PATHS].sort());
  } finally {
    cleanup(tmp);
  }
});

// ── AC2 负控制: 双副本删净但引用仍在 ⇒ RED ─────────────────────────────────────────────────────────
test("AC2 RED: 双副本删净后存活引用仍在 ⇒ references 非空", () => {
  const tmp = makeRoot({
    dualCopies: false,
    files: {
      // quay-init.sh 的 laydown 引用（字符串里的文件名 = 真实调用面）
      "plugin/scripts/quay-init.sh":
        '#!/usr/bin/env bash\ncp "$srcdir/.claude/workflows/fan-in-execute.js" "$target/.claude/workflows/"\n',
    },
  });
  try {
    const r = checkDualCopies(tmp);
    assert.equal(r.evaluated, true);
    assert.ok(r.references.length > 0, `expected a surviving reference, got: ${r.references.join(" | ")}`);
    assert.ok(r.references.some((p) => p.includes("quay-init.sh")), `quay-init.sh should be flagged: ${r.references}`);
  } finally {
    cleanup(tmp);
  }
});

// ── AC2 位置判定: 注释提及不算，字符串/命令位置算（硬规则 2）──────────────────────────────────────
test("AC2 位置判定: 注释提及不算引用，字符串/命令位置算", () => {
  const onlyComment = "#!/usr/bin/env bash\n# fan-in-execute.js is retired (documentation note)\n";
  const stringRef = '#!/usr/bin/env bash\nrun fan-in-execute.js\n';
  assert.equal(
    /fan-in-execute(?![\w-])/.test(codeOnlyText(onlyComment)),
    false,
    "a comment mentioning fan-in-execute must be masked (not a call surface)",
  );
  assert.equal(
    /fan-in-execute(?![\w-])/.test(codeOnlyText(stringRef)),
    true,
    "a string/command position mentioning fan-in-execute must be a call surface",
  );
  // fan-in-executor (同类异义) 不得命中
  assert.equal(
    /fan-in-execute(?![\w-])/.test(codeOnlyText("run fan-in-executor-check.ts\n")),
    false,
    "fan-in-executor must not match the fan-in-execute retirement token",
  );
});

// ── AC2 PASS: 双副本删净 + 引用归零 ⇒ 全 verified ──────────────────────────────────────────────────
test("AC2 PASS: 双副本删净且无存活引用 ⇒ references 空", () => {
  const tmp = makeRoot({ dualCopies: false });
  try {
    const r = checkDualCopies(tmp);
    assert.equal(r.evaluated, true);
    assert.deepEqual(r.references, []);
  } finally {
    cleanup(tmp);
  }
});

// ── AC1 负控制: lock-events 非 wk-prod- 前缀 acquire ⇒ RED ─────────────────────────────────────────
test("AC1 RED: lock-events 非 wk-prod- 前缀 acquire ⇒ nonWkProdAcquires 非空", () => {
  const lockEvents = [
    JSON.stringify({ event: "acquire", ts: "2026-08-31T00:00:00Z", epoch: 100, taskId: "t1", pid: 1, runId: "wk-prod-1", agentId: null }),
    JSON.stringify({ event: "acquire", ts: "2026-08-31T01:00:00Z", epoch: 200, taskId: "t2", pid: 2, runId: "fm-t2-1", agentId: null }),
    JSON.stringify({ event: "release", ts: "2026-08-31T02:00:00Z", epoch: 300, taskId: "t2", pid: 2, runId: "fm-t2-1", agentId: null }),
  ].join("\n") + "\n";
  const tmp = makeRoot({ lockEvents });
  try {
    const r = checkLockEvents(tmp);
    assert.equal(r.evaluated, true);
    assert.equal(r.nonWkProdAcquires.length, 1, `expected 1 non-wk-prod acquire, got: ${JSON.stringify(r.nonWkProdAcquires)}`);
    assert.equal(r.nonWkProdAcquires[0].runId, "fm-t2-1");
    assert.equal(r.totalAcquires, 2);
  } finally {
    cleanup(tmp);
  }
});

// ── AC1 窗口: epoch < sinceEpoch 的非 wk-prod acquire 不计入 ───────────────────────────────────────
test("AC1 窗口: since-epoch 之前的非 wk-prod acquire 不计入", () => {
  const lockEvents = [
    JSON.stringify({ event: "acquire", ts: "2026-08-30T00:00:00Z", epoch: 100, taskId: "t1", pid: 1, runId: "manager-manual-x", agentId: null }),
    JSON.stringify({ event: "acquire", ts: "2026-08-31T00:00:00Z", epoch: 200, taskId: "t2", pid: 2, runId: "wk-prod-1", agentId: null }),
  ].join("\n") + "\n";
  const tmp = makeRoot({ lockEvents });
  try {
    const r = checkLockEvents(tmp, 150);
    assert.equal(r.evaluated, true);
    assert.equal(r.nonWkProdAcquires.length, 0, "pre-window non-wk-prod acquire must be excluded");
    // 无窗口（sinceEpoch=0）则计入
    const r0 = checkLockEvents(tmp, 0);
    assert.equal(r0.nonWkProdAcquires.length, 1);
  } finally {
    cleanup(tmp);
  }
});

// ── AC1 PASS: lock-events 只有 wk-prod ⇒ 非空清单为空 ──────────────────────────────────────────────
test("AC1 PASS: lock-events 只有 wk-prod- 前缀 ⇒ nonWkProdAcquires 空", () => {
  const lockEvents = [
    JSON.stringify({ event: "acquire", ts: "2026-08-31T00:00:00Z", epoch: 100, taskId: "t1", pid: 1, runId: "wk-prod-1", agentId: null }),
    JSON.stringify({ event: "release", ts: "2026-08-31T01:00:00Z", epoch: 200, taskId: "t1", pid: 1, runId: "wk-prod-1", agentId: null }),
  ].join("\n") + "\n";
  const tmp = makeRoot({ lockEvents });
  try {
    const r = checkLockEvents(tmp);
    assert.equal(r.evaluated, true);
    assert.deepEqual(r.nonWkProdAcquires, []);
    assert.equal(r.totalAcquires, 1);
  } finally {
    cleanup(tmp);
  }
});

// ── AC1 机械前缀: mfi-*（per-suite 机械身份）不算非机械 acquire ───────────────────────────────────
test("AC1 机械前缀: mfi-*（per-suite 机械身份）不 flag，fm-*（旧路径）flag", () => {
  const lockEvents = [
    JSON.stringify({ event: "acquire", ts: "2026-08-31T00:00:00Z", epoch: 100, taskId: "t1", pid: 1, runId: "mfi-t1-1788158532259-manual3", agentId: null }),
    JSON.stringify({ event: "acquire", ts: "2026-08-31T01:00:00Z", epoch: 200, taskId: "t2", pid: 2, runId: "fm-t2-1", agentId: null }),
  ].join("\n") + "\n";
  const tmp = makeRoot({ lockEvents });
  try {
    const r = checkLockEvents(tmp, 0);
    assert.equal(r.evaluated, true);
    assert.deepEqual(
      r.nonWkProdAcquires.map((a) => a.runId),
      ["fm-t2-1"],
      "mfi-* must be treated as mechanical (not flagged); fm-* (old workflow) must be flagged",
    );
  } finally {
    cleanup(tmp);
  }
});

// ── 机械前缀判定 + L1 现算（单元级）───────────────────────────────────────────────────────────────
test("isMechanicalPrefix / deriveL1Epoch 判定", () => {
  assert.equal(isMechanicalPrefix("wk-prod-1788056585"), true);
  assert.equal(isMechanicalPrefix("mfi-t1-1788158532259-manual3"), true);
  assert.equal(isMechanicalPrefix("fm-t1-1"), false);
  assert.equal(isMechanicalPrefix("manager-manual-x"), false);
  // 非 git 检出（临时目录）⇒ deriveL1Epoch 回退 0（全文件，最严）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwr-l1-"));
  try {
    assert.equal(deriveL1Epoch(tmp), 0);
  } finally {
    cleanup(tmp);
  }
});

// ── AC1 NOT-EVALUATED: lock-events 文件缺失 ⇒ evaluated=false ──────────────────────────────────────
test("AC1 NOT-EVALUATED: lock-events 文件缺失 ⇒ evaluated=false", () => {
  const tmp = makeRoot({ lockEvents: null });
  try {
    const r = checkLockEvents(tmp);
    assert.equal(r.evaluated, false, "missing lock-events file must be NOT-EVALUATED, not a vacuous pass");
  } finally {
    cleanup(tmp);
  }
});

// ── 组合判定: RED 优先于 NOT-EVALUATED 优先于 PASS ─────────────────────────────────────────────────
test("组合判定: runCheck 的 RED > NOT-EVALUATED > PASS 优先级", () => {
  // RED（引用未清零）优先于 NOT-EVALUATED（lock-events 缺失）
  const redTmp = makeRoot({
    dualCopies: false,
    files: { "plugin/scripts/quay-init.sh": 'cp "fan-in-execute.js" x\n' },
    lockEvents: null,
  });
  try {
    const r = runCheck(redTmp);
    assert.equal(r.ok, false);
    assert.equal(r.notEvaluated, false);
    assert.ok(r.issues.some((i) => i.includes("AC2")), `expected an AC2 issue: ${r.issues.join(" | ")}`);
  } finally {
    cleanup(redTmp);
  }

  // NOT-EVALUATED（双副本仍在 + lock-events 缺失）
  const neTmp = makeRoot({ dualCopies: true, lockEvents: null });
  try {
    const r = runCheck(neTmp);
    assert.equal(r.ok, true);
    assert.equal(r.notEvaluated, true);
  } finally {
    cleanup(neTmp);
  }

  // PASS（全 verified）
  const passTmp = makeRoot({
    dualCopies: false,
    lockEvents: JSON.stringify({ event: "acquire", ts: "2026-08-31T00:00:00Z", epoch: 100, taskId: "t1", pid: 1, runId: "wk-prod-1", agentId: null }) + "\n",
  });
  try {
    const r = runCheck(passTmp);
    assert.equal(r.ok, true);
    assert.equal(r.notEvaluated, false);
    assert.deepEqual(r.issues, []);
  } finally {
    cleanup(passTmp);
  }
});

// ── 真实仓库 smoke: 结构完整（⛔ 不 pin 判定值——双副本/lock-events 状态随 P3 变化）────────────────
test("真实仓库 smoke: runCheck 返回结构完整的判定对象", () => {
  const r = runCheck(REPO_ROOT);
  assert.equal(typeof r.ok, "boolean");
  assert.equal(typeof r.notEvaluated, "boolean");
  assert.ok(Array.isArray(r.issues));
  assert.equal(typeof r.dualCopies.evaluated, "boolean");
  assert.equal(typeof r.lockEvents.evaluated, "boolean");
});
