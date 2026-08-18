// @test-group engine
// suite-slot-ssot-check.test.mjs — gap-suite-concurrency-ff-gate-and-slot-ssot AC4 行为层不变量.
//
// THE DEFECT THIS CLOSES: 「能跑几个 suite」曾经有三个互不一致的定义点 + 一处范畴错误 (lane 除数说 = S /
// 槽数说 = 2 写死 / ff 闸说 = 0 全局), 三者靠散文注释维系, 零可执行不变量。槽数 2 在源码里从未以数字 2
// 出现 (结构性编码), 字面量扫描器按构造看不见 ⇒ 不变量必须在行为层。
//
// This test pins the BEHAVIORAL invariants (each can take false):
//   * 槽文件数 == concurrentSuiteSlots() — S=1 ⇒ 仅 `.0`; S=3 ⇒ `.0/.1/.2` (能取假).
//   * lane × S ≤ nproc × oversub — 资源不超订.
//   * concurrentSuitesRunning 随 S — countHeldSuiteLocks 探测 S 个槽 (S=3 时持有 `.2` 也计入).
//   * bash canonical 与 TS canonical 槽数一致 (跨语言漂移检测).
//   * 静态检查器 (suite-slot-ssot-check.ts) 每条不变量能取假:
//       I1 (ff 闸无 full-suite.lock) / I2 (无硬编码槽字面量) / I3 (消费者读唯一实现) / I4 (bash==TS).
//
// Run:
//   scripts/test.sh plugin/test/suite-slot-ssot-check.test.mjs
//   node --test plugin/test/suite-slot-ssot-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

import { suiteLockSlotCount, suiteLockSlotPaths, suiteLockBase } from "../scripts/suite-lock-slots.ts";
import {
  concurrentSuiteSlots, defaultLaneCount, hostParallelism, countHeldSuiteLocks,
} from "../scripts/full-suite-runner.ts";
import {
  checkNoSlotPathLiterals, checkFfNoGlobalSuiteLock, checkConsumersReadCanonical, checkBashTsCountAgree,
} from "../scripts/suite-slot-ssot-check.ts";

function withSlots(value, fn) {
  const prev = process.env.QUAY_MAX_CONCURRENT_SUITES;
  process.env.QUAY_MAX_CONCURRENT_SUITES = String(value);
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prev;
  }
}

function bashSlotCount(env = process.env) {
  const r = spawnSync("bash", ["-c", `source "${path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh")}"; suite_slot_count`], { encoding: "utf8", env });
  assert.equal(r.status, 0, `suite_slot_count failed: ${r.stderr}`);
  return Number(r.stdout.trim());
}

function makeTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), `ssot-${prefix}-`)); }
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best-effort */ } }

// ── canonical slot count / paths (TS) ────────────────────────────────────────────────────────────────

test("canonical TS — suiteLockSlotPaths generates S slots: S=1 ⇒ [.0], S=3 ⇒ [.0,.1,.2] (AC2 能取假)", () => {
  withSlots(1, () => {
    assert.deepEqual(suiteLockSlotPaths("/x/full-suite.lock"), ["/x/full-suite.lock.0"]);
  });
  withSlots(3, () => {
    assert.deepEqual(suiteLockSlotPaths("/x/full-suite.lock"), ["/x/full-suite.lock.0", "/x/full-suite.lock.1", "/x/full-suite.lock.2"]);
  });
  withSlots(2, () => {
    assert.deepEqual(suiteLockSlotPaths("/x/full-suite.lock"), ["/x/full-suite.lock.0", "/x/full-suite.lock.1"]);
  });
});

test("canonical TS — invalid S fails open to the single default (never 0 slots)", () => {
  for (const bad of ["0", "abc", "-1"]) {
    withSlots(bad, () => {
      assert.equal(suiteLockSlotCount(), 2, `${bad} fails open to 2`);
    });
  }
});

test("concurrentSuiteSlots() delegates to the canonical slot count (one definition point)", () => {
  withSlots(3, () => {
    assert.equal(concurrentSuiteSlots(), 3);
    assert.equal(concurrentSuiteSlots(), suiteLockSlotCount());
  });
  withSlots(1, () => {
    assert.equal(concurrentSuiteSlots(), 1);
  });
});

// ── 槽文件数 == concurrentSuiteSlots() (runtime, the AC4 invariant) ─────────────────────────────────

test("AC4 — 槽文件数 == concurrentSuiteSlots(): S=1 只建 .0, S=3 建 .0/.1/.2 (能取假)", () => {
  for (const S of [1, 2, 3]) {
    withSlots(S, () => {
      const base = path.join(makeTmp("slots"), "full-suite.lock");
      const expected = suiteLockSlotPaths(base);
      for (const p of expected) fs.writeFileSync(p, "", "utf8"); // 模拟 test.sh 建槽文件
      const observed = fs.readdirSync(path.dirname(base)).filter((f) => f.startsWith("full-suite.lock.")).sort();
      assert.equal(observed.length, concurrentSuiteSlots(), `S=${S}: 槽文件数 == concurrentSuiteSlots()`);
      assert.equal(observed.length, expected.length, `S=${S}: 槽文件数与 canonical 路径数一致`);
      assert.deepEqual(observed.map((f) => path.join(path.dirname(base), f)).sort(), [...expected].sort(), `S=${S}: 实际槽文件集合 == canonical 路径集合`);
      cleanup(path.dirname(base));
    });
  }
});

test("bash canonical — suite_slot_count matches TS suiteLockSlotCount under the same env (S=1/2/3)", () => {
  for (const S of [1, 2, 3]) {
    withSlots(S, () => {
      assert.equal(bashSlotCount(), suiteLockSlotCount(), `S=${S}: bash canonical == TS canonical`);
    });
  }
});

// ── concurrentSuitesRunning 随 S (countHeldSuiteLocks probes S slots) ───────────────────────────────

test("AC3 — countHeldSuiteLocks probes S slots: S=3 with `.2` held ⇒ 1 held (the fixed two-slot destructure could never see `.2`)", async () => {
  const lockDir = makeTmp("held");
  const lockFile = path.join(lockDir, "full-suite.lock");
  const { spawn } = await import("node:child_process");
  const holder = spawn("flock", [lockFile + ".2", "-c", "sleep 30"], { stdio: "ignore", detached: true });
  try {
    await new Promise((r) => setTimeout(r, 250));
    const prevLock = process.env.FULL_SUITE_LOCK_FILE;
    process.env.FULL_SUITE_LOCK_FILE = lockFile;
    try {
      withSlots(3, () => {
        // S=3 ⇒ slots [.0,.1,.2]; holding ONLY `.2` must be seen (the old fixed [.0,.1] list never probed `.2`).
        assert.equal(countHeldSuiteLocks(REPO_ROOT), 1, "S=3: holding `.2` is counted (the old fixed two-slot destructure missed it)");
        assert.equal(concurrentSuiteSlots(), 3, "S=3 ⇒ concurrentSuiteSlots=3");
      });
      withSlots(2, () => {
        // S=2 ⇒ slots [.0,.1]; `.2` is NOT a slot ⇒ 0 held (the probe only looks at configured slots).
        assert.equal(countHeldSuiteLocks(REPO_ROOT), 0, "S=2: `.2` is not a configured slot ⇒ 0 held");
      });
    } finally {
      if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
      else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    }
  } finally {
    try { process.kill(-holder.pid, "SIGKILL"); } catch { /* already gone */ }
    try { holder.kill("SIGKILL"); } catch { /* already gone */ }
    cleanup(lockDir);
  }
});

// ── lane × S ≤ nproc × oversub (资源不超订) ─────────────────────────────────────────────────────────

test("AC4 — lane × S ≤ nproc × oversub (the pure-computation budget never oversubscribes)", () => {
  const prevNproc = process.env.RESOURCE_GATE_NPROC;
  const prevOversub = process.env.QUAY_MAX_OVERSUBSCRIPTION;
  try {
    process.env.RESOURCE_GATE_NPROC = "16";
    for (const S of [1, 2, 3]) {
      process.env.QUAY_MAX_CONCURRENT_SUITES = String(S);
      process.env.QUAY_MAX_OVERSUBSCRIPTION = "1";
      const lane = defaultLaneCount();
      const slots = concurrentSuiteSlots();
      const nproc = hostParallelism();
      const oversub = Number(process.env.QUAY_MAX_OVERSUBSCRIPTION ?? "1");
      assert.ok(slots * lane <= nproc * oversub, `S=${S}: ${slots}×${lane}=${slots * lane} ≤ ${nproc}×${oversub}=${nproc * oversub}`);
    }
    // oversub=2 expresses "one suite uses the whole host" — the trade-off knob, still bounded.
    process.env.QUAY_MAX_CONCURRENT_SUITES = "2";
    process.env.QUAY_MAX_OVERSUBSCRIPTION = "2";
    assert.equal(defaultLaneCount(), 16, "oversub=2, S=2, nproc=16 ⇒ lane=16 (single suite uses the whole host)");
    assert.ok(concurrentSuiteSlots() * defaultLaneCount() <= 16 * 2, "2×16=32 ≤ 16×2=32");
  } finally {
    if (prevNproc === undefined) delete process.env.RESOURCE_GATE_NPROC;
    else process.env.RESOURCE_GATE_NPROC = prevNproc;
    if (prevOversub === undefined) delete process.env.QUAY_MAX_OVERSUBSCRIPTION;
    else process.env.QUAY_MAX_OVERSUBSCRIPTION = prevOversub;
    delete process.env.QUAY_MAX_CONCURRENT_SUITES;
  }
});

// ── the static checker: GREEN on the real repo ──────────────────────────────────────────────────────

test("checker — all four invariants PASS on the real repo", () => {
  assert.equal(checkFfNoGlobalSuiteLock(REPO_ROOT).ok, true, "I1 — ff 闸无 full-suite.lock 读取");
  assert.equal(checkNoSlotPathLiterals(REPO_ROOT).ok, true, "I2 — 无硬编码槽字面量");
  assert.equal(checkConsumersReadCanonical(REPO_ROOT).ok, true, "I3 — 消费者读唯一实现");
  assert.equal(checkBashTsCountAgree(REPO_ROOT).ok, true, "I4 — bash canonical == TS canonical");
});

// ── the static checker: falsifiability (每条都能取假) ───────────────────────────────────────────────

function makeFakeRoot(files) {
  const root = makeTmp("fake");
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return root;
}

test("checker I2 — 能取假: a hardcoded slot-path form (numbered var / contiguous literal) in a scan-surface file ⇒ RED", () => {
  // The two historical manifestation forms: the test.sh numbered variable (FULL_SUITE_LOCK_0) and the
  // reaper contiguous literal (full-suite.lock.0 inside a template string).
  const root = makeFakeRoot({
    "scripts/test.sh": 'FULL_SUITE_LOCK_0="${FULL_SUITE_LOCK_FILE}.0"\n',
    "plugin/scripts/full-suite-runner.ts": 'return [`${base}.0`, `${base}.1`];\n',
    "plugin/scripts/worktree-process-reaper.ts": 'return [`${commonDir}/full-suite.lock.0`];\n',
  });
  try {
    const v = checkNoSlotPathLiterals(root);
    assert.equal(v.ok, false, "a hardcoded slot-path form (FULL_SUITE_LOCK_0 / full-suite.lock.0) must be RED");
  } finally { cleanup(root); }
});

test("checker I1 — 能取假: a fan-in-ff-merge.sh that reads full-suite.lock ⇒ RED", () => {
  const root = makeFakeRoot({
    "plugin/scripts/fan-in-ff-merge.sh": '#!/usr/bin/env bash\nfor s in "${suite_lock_dir}/full-suite.lock.0" "${suite_lock_dir}/full-suite.lock.1"; do flock -n "$s" true; done\n',
  });
  try {
    const v = checkFfNoGlobalSuiteLock(root);
    assert.equal(v.ok, false, "an ff gate that reads a global suite lock must be RED (AC1 收窄)");
  } finally { cleanup(root); }
});

test("checker I3 — 能取假: a consumer NOT reading the canonical ⇒ RED", () => {
  const root = makeFakeRoot({
    "scripts/test.sh": 'FULL_SUITE_LOCK_0="${FULL_SUITE_LOCK_FILE}.0"\n', // old hardcoded form, no canonical
    "plugin/scripts/full-suite-runner.ts": 'return [`${base}.0`, `${base}.1`];\n',
    "plugin/scripts/worktree-process-reaper.ts": 'return [`${commonDir}/full-suite.lock.0`];\n',
  });
  try {
    const v = checkConsumersReadCanonical(root);
    assert.equal(v.ok, false, "consumers that hardcode slots instead of reading the canonical must be RED");
    const i2 = checkNoSlotPathLiterals(root);
    assert.equal(i2.ok, false, "the hardcoded forms are also I2 violations");
  } finally { cleanup(root); }
});

test("checker I4 — 能取假: bash canonical != TS canonical under a mismatched env ⇒ RED", () => {
  // Drive the bash canonical via its RESOURCE_GATE_CONCURRENT_SUITES seam while the TS canonical reads
  // QUAY_MAX_CONCURRENT_SUITES — they disagree ⇒ I4 must be RED (the two canons drifted).
  const root = REPO_ROOT;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevSlots = process.env.QUAY_MAX_CONCURRENT_SUITES;
  try {
    process.env.RESOURCE_GATE_CONCURRENT_SUITES = "3";
    process.env.QUAY_MAX_CONCURRENT_SUITES = "2";
    const v = checkBashTsCountAgree(root);
    assert.equal(v.ok, false, `bash=3 != TS=2 must be RED, got: ${v.detail}`);
  } finally {
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevSlots === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevSlots;
  }
});
