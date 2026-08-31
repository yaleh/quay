// @test-group engine
// suite-driver.test.mjs — gap-suite-lifecycle-driver-kind (SPEC-suite-lifecycle-and-failure-semantics §3):
// per-task suite 生命周期收进一个常驻 driver kind——进程级父子 wait + 定时兜底静默检测，单飞锁回归纯
// 资源限制器。本文件验证 suite-driver.ts 的四条 AC（fake suite 命令缝，不真跑 19+min 全量套件）。
//
// Coverage map (task ACs):
//   AC1 — kind 落地复用骨架：DRIVER_KINDS.suite 存在且 driver="suite-driver.ts"、verbs 含五运维动词；
//         suite-driver.ts 从 driver-runtime.ts import（Layer 0 复用，⛔ 不新造接口/第二份 respawn/循环）。
//   AC2 — 进程级父子 + 三态：spawnSuiteAndWait 直接 spawn suite 并 wait，子进程退出立即得知；
//         三态 outcome 可分（done / red / hung），hung 是可区分独立取值（⛔ 与 red/done 同形）。
//   AC3 — 静默挂死自动检测：活着但无输出 ≥N 秒 ⇒ 自动判挂死 → SIGKILL + outcome=hung（不再靠人工 kill）。
//   AC4 — 取放槽同一执行点：spawn 前取槽（suite 运行期间槽被持）、子进程终结后释放（退出后槽空闲），
//         取/放都在 slotHolderArgv → suite_slot_holder 这【一个】执行点（suite-driver.ts 无独立 flock -u）。
//
// Run:
//   scripts/test.sh plugin/test/suite-driver.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DRIVER_KINDS,
} from "../scripts/driver-runtime.ts";
import {
  ROUND_LOG_REL,
  SUITE_CONTROL_STATE_REL,
  SILENCE_MS_DEFAULT,
  spawnSuiteAndWait,
  slotHolderArgv,
  parseSuiteRequest,
  computeSuiteRound,
  listPendingSuiteRequests,
  writeSuiteResult,
} from "../scripts/suite-driver.ts";
import { suiteLockBase, suiteLockSlotPaths } from "../scripts/suite-lock-slots.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const SUITE_DRIVER_SRC = path.join(REPO_ROOT, "plugin", "scripts", "suite-driver.ts");
const SLOT_LIB = path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh");

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "suite-driver-test-"));
}

/** flock -n 探测一个槽：HELD = 有进程持锁；FREE = 空闲（与 full-suite-runner.probeLockHeld 同手法）。 */
function probeSlot(slotFile) {
  try {
    execFileSync("flock", ["-n", slotFile, "true"], { stdio: "ignore" });
    return "FREE";
  } catch {
    return "HELD";
  }
}

/** 写一个 hermetic 槽 base 的临时目录（隔离真实 .quay/full-suite.lock，⛔ 不污染生产锁）。 */
function hermeticSuite(tmp) {
  const slotBase = path.join(tmp, "full-suite.lock");
  const logFile = path.join(tmp, "suite.log");
  return { slotBase, logFile };
}

// ── AC1 — kind 落地复用骨架 ────────────────────────────────────────────────────────────────

test("AC1: DRIVER_KINDS.suite 落地且复用五运维动词 + Layer 0（不新造接口）", () => {
  const spec = DRIVER_KINDS.suite;
  assert.ok(spec, "DRIVER_KINDS.suite must exist");
  assert.equal(spec.driver, "suite-driver.ts");
  assert.equal(spec.prefix, "suite-driver");
  assert.equal(spec.carriers[0], "suite-round.jsonl");
  assert.equal(spec.controlFile, "suite-control.json");
  // 五运维动词（start/stop/drain/resume/status/restart/liveness——与其它 kind 同族，非新造接口）。
  for (const v of ["start", "stop", "drain", "resume", "status", "restart", "liveness"]) {
    assert.ok(spec.verbs.includes(v), `suite kind must support verb ${v}`);
  }
  // Layer 0 复用（⛔ 不新造接口/第二份 respawn/循环）：suite-driver.ts 从 driver-runtime.ts import
  // DRIVER_KINDS / isHalted / appendHeartbeatLine——不是另写一份循环/心跳/判停。
  const src = fs.readFileSync(SUITE_DRIVER_SRC, "utf8");
  assert.match(src, /from "\.\/driver-runtime\.ts"/, "suite-driver.ts must import Layer 0 driver-runtime");
  assert.match(src, /DRIVER_KINDS/, "must reuse the DRIVER_KINDS registry (single source)");
  assert.match(src, /isHalted/, "must reuse Layer 0 stopCondition/halt (not re-implement)");
  // 取假（AC1 判据）：suite-driver.ts 不另写 respawn 循环（respawn 只在 driver-runtime.runSupervisor 一份）。
  assert.doesNotMatch(src, /runSupervisor\s*\(/, "must NOT re-implement supervisor respawn");
  assert.doesNotMatch(src, /function\s+respawn/i, "must NOT carry a second respawn loop");
});

// ── gap-verification-round-single-writer AC3 — 红平行写已删（runner 是唯一 writer）─────────────────
// writeRedSuiteRecord（suite-driver.ts 曾并行补写红 verification-round，红绿双 writer 混写）已删除：
// runner 的 appendVerificationRound 是机械路径唯一 writer（green+red 都记）。静态判据：suite-driver.ts
// 无 writeRedSuiteRecord 定义、plugin 源码树无残留调用点。

test("AC3 — writeRedSuiteRecord 已从 suite-driver.ts 删除，且 plugin 源码树无残留调用点", () => {
  const src = fs.readFileSync(SUITE_DRIVER_SRC, "utf8");
  assert.doesNotMatch(src, /writeRedSuiteRecord/, "writeRedSuiteRecord 定义不得存在于 suite-driver.ts");
  // 无残留调用点：plugin/scripts + plugin/workflows 的 .ts/.js/.mjs（非测试）文件均不得引用。
  const walk = (rel) => {
    const abs = path.join(REPO_ROOT, rel);
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(rel, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (/\.(ts|js|mjs)$/.test(ent.name) && !/\.test\.(mjs|ts)$/.test(ent.name)) {
        const text = fs.readFileSync(path.join(REPO_ROOT, p), "utf8");
        assert.ok(!text.includes("writeRedSuiteRecord"), `${p} 不得残留 writeRedSuiteRecord 调用点`);
      }
    }
  };
  walk("plugin/scripts");
  walk("plugin/workflows");
});

// ── AC2 — 进程级父子 + 三态 outcome（hung 可区分）─────────────────────────────────────────

test("AC2: 直接 spawn + wait，正常退出 ⇒ done（exit 0 立即得知）", async () => {
  const tmp = makeTmp();
  const { slotBase, logFile } = hermeticSuite(tmp);
  const r = await spawnSuiteAndWait({
    slotBase, slotLib: SLOT_LIB,
    suiteCommand: ["bash", "-c", "echo hello; echo world; exit 0"],
    logFile, silenceMs: 3000,
  });
  try {
    assert.equal(r.outcome, "done");
    assert.equal(r.exitCode, 0);
    assert.equal(r.signalCode, null);
    assert.equal(r.hungByWatchdog, false);
    assert.ok(r.durationMs >= 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2: 非零退出 ⇒ red（与 done 可分）", async () => {
  const tmp = makeTmp();
  const { slotBase, logFile } = hermeticSuite(tmp);
  const r = await spawnSuiteAndWait({
    slotBase, slotLib: SLOT_LIB,
    suiteCommand: ["bash", "-c", "echo failing; exit 3"],
    logFile, silenceMs: 3000,
  });
  try {
    assert.equal(r.outcome, "red");
    assert.equal(r.exitCode, 3);
    assert.equal(r.hungByWatchdog, false);
    assert.notEqual(r.outcome, "done");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC2: 被信号杀 ⇒ signalCode 可区分（非正常退出、非 hung）", async () => {
  const tmp = makeTmp();
  const { slotBase, logFile } = hermeticSuite(tmp);
  // node 杀自己：signalCode=SIGKILL，code=null——三种退出方式（正常/非零/信号）都可分。
  const r = await spawnSuiteAndWait({
    slotBase, slotLib: SLOT_LIB,
    suiteCommand: ["node", "-e", "process.kill(process.pid, 'SIGKILL')"],
    logFile, silenceMs: 3000,
  });
  try {
    assert.equal(r.outcome, "red");
    assert.equal(r.exitCode, null);
    assert.equal(r.signalCode, "SIGKILL");
    assert.equal(r.hungByWatchdog, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC3 — 静默挂死自动检测（可区分独立取值 hung）─────────────────────────────────────────

test("AC3: 活着但无输出 ≥N 秒 ⇒ 自动判挂死 → SIGKILL + outcome=hung（可区分独立取值）", async () => {
  const tmp = makeTmp();
  const { slotBase, logFile } = hermeticSuite(tmp);
  const t0 = Date.now();
  const r = await spawnSuiteAndWait({
    slotBase, slotLib: SLOT_LIB,
    suiteCommand: ["bash", "-c", "echo start; sleep 60"],   // 有输出后静默 60s（远超 silenceMs）
    logFile, silenceMs: 500,
  });
  try {
    assert.equal(r.outcome, "hung");
    assert.equal(r.hungByWatchdog, true);
    assert.equal(r.signalCode, "SIGKILL");
    // 独立取值（硬规则 3b）：hung 不与 red/done 同形。
    assert.notEqual(r.outcome, "red");
    assert.notEqual(r.outcome, "done");
    // 不再 33.7min/199.5min 靠人工 kill——静默检测在 silenceMs 附近就杀掉（远小于 sleep 60s）。
    assert.ok(Date.now() - t0 < 15_000, `hung must be detected promptly, took ${Date.now() - t0}ms`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("AC3: 有持续输出 ⇒ 不误判挂死（静默看门狗只对真静默开火）", async () => {
  const tmp = makeTmp();
  const { slotBase, logFile } = hermeticSuite(tmp);
  // 每 300ms 写一行（日志 mtime 持续推进），跑了 ~1.6s > silenceMs=500 仍不误杀。
  const r = await spawnSuiteAndWait({
    slotBase, slotLib: SLOT_LIB,
    suiteCommand: ["bash", "-c", "for i in 1 2 3 4 5; do echo tick$i; sleep 0.3; done; exit 0"],
    logFile, silenceMs: 500,
  });
  try {
    assert.equal(r.outcome, "done");
    assert.equal(r.hungByWatchdog, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── gap-mech-fan-in-suite-silence-watchdog-fired — 「driver 持槽」结构不变式 ─────────────────
// 机械 fan-in 路径（worker-driver.runMechanicalFanIn）曾【漏传】QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT=1，
// 与常驻 loop / --run 两调用点不一致 ⇒ scripts/test.sh --buckets 的 full_suite_lock_acquire 不跳过
// 再取槽，用自己的新 FD 对【同一把槽】再 flock（被 slot-holder 继承 FD 拒绝——flock 按
// open-file-description，同进程不同 FD 也互斥）⇒ 卡进无界 while 等槽循环 ⇒ 零输出 ≥15min ⇒ 静默
// 看门狗误当挂死 SIGKILL（生产：gap-web-session-drops-queue-operation-records 15:15 suite 步 red）。
// 修法：spawnSuiteAndWait 强制注入该 env（结构不变式——「driver 持槽」是 spawnSuiteAndWait 的事实，
// ⛔ 不是 caller 的选择），caller 不传也有、也不可覆盖。

test("spawnSuiteAndWait 强制注入 QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT=1（caller 漏传也不死锁）", async () => {
  const tmp = makeTmp();
  const { slotBase, logFile } = hermeticSuite(tmp);
  const outFile = path.join(tmp, "child-env.out");
  // ⛔ 不传 env —— 复现机械 fan-in 的调用形态（原缺陷：漏传 ⇒ test.sh 再取槽 ⇒ 死锁）。
  const r = await spawnSuiteAndWait({
    slotBase, slotLib: SLOT_LIB,
    suiteCommand: ["bash", "-c", `printf '%s' "\${QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT:-unset}" > "${outFile}"; exit 0`],
    logFile, silenceMs: 3000,
  });
  try {
    assert.equal(r.outcome, "done");
    assert.equal(r.hungByWatchdog, false);
    assert.equal(fs.readFileSync(outFile, "utf8"), "1", "child must see HOLDS_SLOT=1 even when the caller omits env");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("spawnSuiteAndWait 的 HOLDS_SLOT 不被 caller env 覆盖（结构不变式放最后）", async () => {
  const tmp = makeTmp();
  const { slotBase, logFile } = hermeticSuite(tmp);
  const outFile = path.join(tmp, "child-env.out");
  const r = await spawnSuiteAndWait({
    slotBase, slotLib: SLOT_LIB,
    suiteCommand: ["bash", "-c", `printf '%s' "\${QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT:-unset}" > "${outFile}"; exit 0`],
    logFile, silenceMs: 3000,
    env: { QUAY_TEST_SUITE_DRIVER_HOLDS_SLOT: "0" },   // 误传 "0" 也不得覆盖（否则死锁回归）
  });
  try {
    assert.equal(r.outcome, "done");
    assert.equal(fs.readFileSync(outFile, "utf8"), "1", "forced HOLDS_SLOT=1 must win over the caller env");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── AC4 — 取放槽同一执行点（释放原子）─────────────────────────────────────────────────────

test("AC4: spawn 前取槽、终结后释放槽（运行期间槽被持，退出后空闲）", async () => {
  const tmp = makeTmp();
  const { slotBase, logFile } = hermeticSuite(tmp);
  const slots = suiteLockSlotPaths(slotBase);
  assert.equal(slots.length, 1, "hermetic slot base defaults to S=1");
  const slot0 = slots[0];

  const p = spawnSuiteAndWait({
    slotBase, slotLib: SLOT_LIB,
    suiteCommand: ["bash", "-c", "echo start; sleep 1.2; echo end"],
    logFile, silenceMs: 5000,
  });
  await new Promise((r) => setTimeout(r, 400));
  // 运行期间：槽被 suite-driver 持有（spawn 前取槽）。
  assert.equal(probeSlot(slot0), "HELD", "slot must be HELD while the suite runs");
  const r = await p;
  assert.equal(r.outcome, "done");
  // 子进程终结后：槽已释放（同一执行点的释放，⛔ 无独立 watchdog 残留持锁）。
  assert.equal(probeSlot(slot0), "FREE", "slot must be FREE after the suite exits");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("AC4: 取/放是同一执行点（slot-holder 一个函数内 acquire+exec+release，无独立 flock -u）", () => {
  const src = fs.readFileSync(SUITE_DRIVER_SRC, "utf8");
  // 取放都在 slotHolderArgv → suite_slot_holder 这一个执行点：acquire（flock -n / -w）与 exec（持锁跨
  // exec、随子进程终结释放）在同一函数。取假（AC4 判据）：suite-driver.ts 里没有独立于 spawn 的
  // `flock -u` 释放调用（⛔ 取放分离 ⇒ 假——那正是 SPEC §1.1 泄漏① 的病）。
  const holder = slotHolderArgv({ slotBase: "/tmp/x", slotLib: SLOT_LIB, suiteCommand: ["true"] })[2];
  assert.match(holder, /suite_slot_holder\(\)/, "slot-holder function exists");
  assert.match(holder, /flock -n/, "acquire (non-blocking try) is in the holder");
  assert.match(holder, /exec "\$@"/, "release is co-located: exec holds the FD across the suite, auto-releases on exit");
  assert.doesNotMatch(src, /flock\s+-u/, "no separate `flock -u` release outside the single holder execution point");
  assert.doesNotMatch(src, /spawn_suite_lock_hold_watchdog/, "no separate hold-watchdog that releases the slot (取放分离的反例已被排除)");
});

// ── 协议 / 载体 / 常驻循环（辅：请求/结果/round 三态写端）──────────────────────────────────

test("parseSuiteRequest 读不懂 ⇒ null（硬规则 3b：不伪装已处理）", () => {
  assert.equal(parseSuiteRequest("{not json"), null);
  assert.equal(parseSuiteRequest("{}"), null);
  assert.equal(parseSuiteRequest(JSON.stringify({ task: "x", suiteCommand: [] })), null);
  const ok = parseSuiteRequest(JSON.stringify({ task: "gap-x", suiteCommand: ["bash", "true"], logFile: null, runId: "r", worktree: "/w", requestedAt: "t" }));
  assert.equal(ok.task, "gap-x");
  assert.deepEqual(ok.suiteCommand, ["bash", "true"]);
});

test("computeSuiteRound 三态 outcome 落进 round 记录（done/red/hung 字段可取假）", () => {
  const rec = computeSuiteRound({
    runId: "r", task: "gap-x", slotBase: "/tmp/b",
    result: { outcome: "hung", exitCode: null, signalCode: "SIGKILL", hungByWatchdog: true, startedAt: "s", finishedAt: "f", durationMs: 1, error: "x" },
  });
  assert.equal(rec.outcome, "hung");
  assert.equal(rec.hung_by_watchdog, true);
  assert.equal(rec.exit_code, null);
  assert.equal(rec.signal_code, "SIGKILL");
  assert.equal(rec.task, "gap-x");
});

test("writeSuiteResult + listPendingSuiteRequests：写结果后请求不再 pending（在飞/已处理可区分）", () => {
  const tmp = makeTmp();
  const reqDir = path.join(tmp, ".quay", "suite-requests");
  fs.mkdirSync(reqDir, { recursive: true });
  fs.writeFileSync(path.join(reqDir, "gap-x.json"), JSON.stringify({ task: "gap-x", suiteCommand: ["true"], logFile: null }), "utf8");
  const pending = listPendingSuiteRequests(tmp, new Set());
  assert.equal(pending.length, 1);
  assert.equal(pending[0].task, "gap-x");
  writeSuiteResult(tmp, "gap-x", { outcome: "done", exitCode: 0, signalCode: null, hungByWatchdog: false, startedAt: "s", finishedAt: "f", durationMs: 1, error: null, runId: "r" });
  assert.equal(listPendingSuiteRequests(tmp, new Set()).length, 0, "a written result makes the request no longer pending");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("suiteLockBase 复用 TS 单一真相源（suite-driver 与 full-suite-runner 同一 slot 语义）", () => {
  const base = suiteLockBase(REPO_ROOT);
  assert.ok(base.endsWith("full-suite.lock"), `suite lock base should resolve to full-suite.lock, got ${base}`);
  const n = suiteLockSlotPaths(base).length;
  assert.ok(n >= 1, `slot count must be >= 1, got ${n}`);
});

test("ROUND_LOG_REL / SUITE_CONTROL_STATE_REL 由 registry 派生（与其它 kind 同族）", () => {
  assert.equal(ROUND_LOG_REL, "suite-round.jsonl");
  assert.equal(SUITE_CONTROL_STATE_REL, ".quay/suite-control.json");
});

test("SILENCE_MS_DEFAULT 是正数（缺省 15min 同族；测试经 seam 覆盖）", () => {
  assert.ok(SILENCE_MS_DEFAULT > 0);
});
