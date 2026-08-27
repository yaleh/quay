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
  checkRuntimeConcurrencyCapped, runConcurrencyProbe, holderScript,
} from "../scripts/suite-slot-ssot-check.ts";

function withSlots(value, fn) {
  const prev = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  let tmp;
  // Hermetic against the PRODUCTION lock state (gap-suite-slot-ssot-i5-false-positive): the production
  // `<suiteLockBase>.concurrency` scalar (a live-suite S=1 file) would otherwise SHADOW the knob this
  // helper drives — the `.concurrency` file has priority over QUAY_MAX_CONCURRENT_SUITES. When the
  // caller has NOT already pinned FULL_SUITE_LOCK_FILE, pin the base to an isolated temp dir carrying
  // `value` in THAT base's `.concurrency` file; a caller that set FULL_SUITE_LOCK_FILE itself (e.g.
  // the countHeldSuiteLocks test, which controls WHERE the probe looks) keeps its base — its own
  // override already neutralizes the production scalar.
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  process.env.QUAY_MAX_CONCURRENT_SUITES = String(value);
  if (prevLock === undefined) {
    tmp = makeTmp("slots");
    const base = path.join(tmp, "full-suite.lock");
    fs.writeFileSync(`${base}.concurrency`, String(value), "utf8");
    process.env.FULL_SUITE_LOCK_FILE = base;
  }
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prev;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    if (tmp) cleanup(tmp);
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
      assert.equal(suiteLockSlotCount(), 1, `${bad} fails open to 1`);
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

test("seam symmetry (gap-suite-lock-slot-seam-asymmetry AC1) — TS suiteLockSlotCount reads the RESOURCE_GATE_CONCURRENT_SUITES test seam FIRST, same as the bash canonical; empty seam falls through to the knob (`:-` semantics)", () => {
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  // Pin the base to an isolated temp dir (NO `.concurrency` file there) so the empty-seam fall-through
  // really reaches the knob — the production `<suiteLockBase>.concurrency` scalar (a live-suite S=1
  // file) would otherwise shadow the knob and break the "empty seam → knob" step (the same
  // production-lock interference class as gap-suite-slot-ssot-i5-false-positive).
  const tmp = makeTmp("seamsym");
  process.env.FULL_SUITE_LOCK_FILE = path.join(tmp, "full-suite.lock");
  try {
    // seam ONLY (knob unset): both sides read the seam — the pre-fix TS read the knob (default 2) and
    // drifted from bash (1) ⇒ the asymmetry this task closes.
    delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    process.env.RESOURCE_GATE_CONCURRENT_SUITES = "1";
    assert.equal(suiteLockSlotCount(), 1, "TS reads the seam (RESOURCE_GATE_CONCURRENT_SUITES=1) with the knob unset");
    assert.equal(bashSlotCount(), 1, "bash reads the seam too");
    assert.equal(suiteLockSlotCount(), bashSlotCount(), "TS == bash under a seam-only env");
    // seam wins over a DIFFERENT knob (precedence: seam FIRST, then knob).
    process.env.QUAY_MAX_CONCURRENT_SUITES = "3";
    assert.equal(suiteLockSlotCount(), 1, "seam shadows the knob (seam-first precedence)");
    assert.equal(bashSlotCount(), 1, "bash agrees: seam shadows the knob");
    // empty seam (`:-` semantics) falls through to the knob — NOT read as a value.
    process.env.RESOURCE_GATE_CONCURRENT_SUITES = "";
    assert.equal(suiteLockSlotCount(), 3, "empty seam falls through to the knob (same as bash :-)");
    assert.equal(bashSlotCount(), 3, "bash agrees on the empty-seam fall-through");
  } finally {
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    cleanup(tmp);
  }
});

// ── `.concurrency` scalar file (gap-suite-concurrency-env-to-file-fresh-read) ──────────────────────
// AC1/AC2 — the two canons BOTH read `<suiteLockBase>.concurrency` raw (bash `[ -f ] && cat`, TS
// `fs.existsSync && readFileSync().trim()`), in the precedence seam → file → knob → default. These
// tests are hermetic: `FULL_SUITE_LOCK_FILE` pins the base to a temp dir so no ambient production
// `.concurrency` file (nor the real git-common-dir) can interfere, and the file is cleaned up.

test("AC1 — both canonicals independently read the same `.concurrency` scalar file; I4 stays GREEN under the file scheme (evaluated:true, bash==TS)", () => {
  const tmp = makeTmp("concurrency");
  const base = path.join(tmp, "full-suite.lock");
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  process.env.FULL_SUITE_LOCK_FILE = base;
  try {
    // no file yet → falls through to the env knob / default (probe the current ambient knob).
    const noFileTs = suiteLockSlotCount();
    const noFileBash = bashSlotCount();
    assert.equal(noFileTs, noFileBash, "no file: bash == TS");

    // write the scalar file (trailing newline, like `echo 1 >` would leave) → both read it raw.
    fs.writeFileSync(`${base}.concurrency`, "3\n", "utf8");
    assert.equal(suiteLockSlotCount(), 3, "TS reads the .concurrency file (readFileSync + trim)");
    assert.equal(bashSlotCount(), 3, "bash reads the same .concurrency file ([ -f ] && cat, trimmed)");
    assert.equal(bashSlotCount(), suiteLockSlotCount(), "bash == TS under the file scheme");

    // I4 — the static checker must still evaluate (NOT-EVALUATED would be the 硬规则③b shape) and pass.
    const v = checkBashTsCountAgree(REPO_ROOT);
    assert.equal(v.evaluated, true, `I4 must be evaluated under the file scheme, got: ${v.detail}`);
    assert.equal(v.ok, true, `I4 must be GREEN under the file scheme (bash==TS), got: ${v.detail}`);
  } finally {
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    cleanup(tmp);
  }
});

test("AC2 — precedence: seam > `.concurrency` file > knob > default (both canonicals agree)", () => {
  const tmp = makeTmp("prec");
  const base = path.join(tmp, "full-suite.lock");
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  process.env.FULL_SUITE_LOCK_FILE = base;
  try {
    // file=3, knob unset → file wins over the default.
    delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    fs.writeFileSync(`${base}.concurrency`, "3", "utf8");
    assert.equal(suiteLockSlotCount(), 3, "file wins over the default (no env)");
    assert.equal(bashSlotCount(), 3, "bash agrees");

    // file=3, knob=1 → file wins over the env knob (文件优先).
    process.env.QUAY_MAX_CONCURRENT_SUITES = "1";
    assert.equal(suiteLockSlotCount(), 3, "file wins over the knob (file > QUAY_MAX_CONCURRENT_SUITES)");
    assert.equal(bashSlotCount(), 3, "bash agrees");

    // seam=2, file=3, knob=1 → test seam wins.
    process.env.RESOURCE_GATE_CONCURRENT_SUITES = "2";
    assert.equal(suiteLockSlotCount(), 2, "test seam wins over the file");
    assert.equal(bashSlotCount(), 2, "bash agrees");

    // invalid file 'abc' → falls through to the knob.
    fs.writeFileSync(`${base}.concurrency`, "abc", "utf8");
    delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    assert.equal(suiteLockSlotCount(), 1, "non-numeric file falls through to the knob");
    assert.equal(bashSlotCount(), 1, "bash agrees");

    // invalid file 'abc' + knob unset → falls through to the default.
    delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    assert.equal(suiteLockSlotCount(), 1, "non-numeric file + no knob → default 1");
    assert.equal(bashSlotCount(), 1, "bash agrees");
  } finally {
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
    cleanup(tmp);
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
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  // Isolate the base (no `.concurrency` file there): the production scalar (a live-suite S=1 file)
  // would otherwise shadow this test's knob and make concurrentSuiteSlots() read 1 for every S —
  // defaultLaneCount() then derives 16×2/1=32 instead of 16 (gap-suite-slot-ssot-i5-false-positive
  // class: production lock state must not perturb the test's derived slot count).
  const tmp = makeTmp("lane");
  process.env.FULL_SUITE_LOCK_FILE = path.join(tmp, "full-suite.lock");
  try {
    // This test drives the KNOB — the seam (read FIRST by suiteLockSlotCount since
    // gap-suite-lock-slot-seam-asymmetry) must be cleared or it shadows the knob.
    delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
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
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    cleanup(tmp);
  }
});

// ── the static checker: GREEN on the real repo ──────────────────────────────────────────────────────

test("checker — all four invariants PASS on the real repo", () => {
  assert.equal(checkFfNoGlobalSuiteLock(REPO_ROOT).ok, true, "I1 — ff 闸无 full-suite.lock 读取");
  assert.equal(checkNoSlotPathLiterals(REPO_ROOT).ok, true, "I2 — 无硬编码槽字面量");
  assert.equal(checkConsumersReadCanonical(REPO_ROOT).ok, true, "I3 — 消费者读唯一实现");
  assert.equal(checkBashTsCountAgree(REPO_ROOT).ok, true, "I4 — bash canonical == TS canonical");
});

// ── I5 — 运行时并发 suite 数 ≤ S (行为层排他性, gap-suite-slot-lock-not-enforcing-concurrency AC1/AC3) ─

test("I5 — exclusive flock: S+2 concurrent acquirers ⇒ exactly S hold (the AC2 negative control)", () => {
  for (const S of [1, 2, 3]) {
    withSlots(S, () => {
      const tmp = makeTmp("i5");
      const base = path.join(tmp, "full-suite.lock");
      const lib = path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh");
      const { acquired, status } = runConcurrencyProbe(holderScript(lib, "-n"), base, S + 2);
      assert.equal(status, 0, `S=${S}: probe must run clean`);
      assert.equal(acquired, S, `S=${S}: exactly ${S} of ${S + 2} acquirers hold a slot (exclusive flock)`);
      cleanup(tmp);
    });
  }
});

test("I5 — 能取假: shared flock injection ⇒ all S+2 acquire ⇒ RED (the 4-concurrent manifestation)", () => {
  withSlots(2, () => {
    const tmp = makeTmp("i5red");
    const base = path.join(tmp, "full-suite.lock");
    const lib = path.join(REPO_ROOT, "plugin", "scripts", "suite-slot-lib.sh");
    const { acquired } = runConcurrencyProbe(holderScript(lib, "-s -n"), base, 4);
    assert.equal(acquired, 4, "shared flock: all 4 acquirers hold (the injected non-exclusive lock)");
    assert.ok(acquired > 2, "4 > S=2 ⇒ the concurrency-cap judgment goes RED");
    cleanup(tmp);
  });
});

test("I5 — checker verdict: GREEN on the real repo (exclusive flock, acquired ≤ S)", () => {
  const v = checkRuntimeConcurrencyCapped(REPO_ROOT);
  assert.equal(v.evaluated, true, "I5 must be evaluated on the real repo");
  assert.equal(v.ok, true, `I5 must be GREEN, got: ${v.detail}`);
});

test("I5 — checker stays GREEN when the production `.concurrency` file says S=1 AND a real suite holds a slot at the production base (the false-positive reproduction: the probe's slot count is pinned to the checker's S, not the ambient default 2, and the probe is hermetic — the real holder is invisible)", async () => {
  const tmp = makeTmp("i5prod");
  const prodBase = path.join(tmp, "prod-full-suite.lock");
  fs.writeFileSync(`${prodBase}.concurrency`, "1\n", "utf8"); // the production scalar (S=1, the reported symptom)
  const prevLock = process.env.FULL_SUITE_LOCK_FILE;
  const prevSeam = process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  const prevKnob = process.env.QUAY_MAX_CONCURRENT_SUITES;
  process.env.FULL_SUITE_LOCK_FILE = prodBase;
  delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
  delete process.env.QUAY_MAX_CONCURRENT_SUITES;
  // A REAL live-suite holder on the production base's only slot (`.0`): a genuine concurrent suite
  // mid-run. The probe must neither see it (hermetic base) nor be perturbed by it.
  const { spawn } = await import("node:child_process");
  const holder = spawn("flock", [`${prodBase}.0`, "-c", "sleep 30"], { stdio: "ignore", detached: true });
  try {
    await new Promise((r) => setTimeout(r, 250));
    const v = checkRuntimeConcurrencyCapped(REPO_ROOT);
    assert.equal(v.evaluated, true, `I5 must be evaluated under a production S=1 .concurrency file, got: ${v.detail}`);
    // The false positive was "2/3 held (> S=1)" — with the probe pinned to S=1, exactly 1 of 3 holds.
    assert.equal(v.ok, true, `I5 must be GREEN while a real suite holds the production slot, got: ${v.detail}`);
    // Hermetic isolation: the probe must NOT create/contend on slot files at the production base —
    // the live suite holding `.0` here must be invisible to (and unperturbed by) the probe. (The
    // `.concurrency` scalar WE wrote is expected; the probe must not add any OTHER `.<digit>` slot file.)
    const prodSlots = fs.readdirSync(tmp).filter((f) => /^prod-full-suite\.lock\.\d+$/.test(f));
    assert.deepEqual(prodSlots, ["prod-full-suite.lock.0"], "the probe must be hermetic — the only slot file at the production base is the live holder's own `.0`");
  } finally {
    try { process.kill(-holder.pid, "SIGKILL"); } catch { /* already gone */ }
    try { holder.kill("SIGKILL"); } catch { /* already gone */ }
    if (prevLock === undefined) delete process.env.FULL_SUITE_LOCK_FILE;
    else process.env.FULL_SUITE_LOCK_FILE = prevLock;
    if (prevSeam === undefined) delete process.env.RESOURCE_GATE_CONCURRENT_SUITES;
    else process.env.RESOURCE_GATE_CONCURRENT_SUITES = prevSeam;
    if (prevKnob === undefined) delete process.env.QUAY_MAX_CONCURRENT_SUITES;
    else process.env.QUAY_MAX_CONCURRENT_SUITES = prevKnob;
    cleanup(tmp);
  }
});

test("I5 — checker itself can go RED end-to-end (硬规则 3b): QUAY_TEST_SSOT_I5_FLOCK=shared injection ⇒ all S+2 acquire ⇒ the checker verdict goes RED, not just the raw probe", () => {
  const prev = process.env.QUAY_TEST_SSOT_I5_FLOCK;
  process.env.QUAY_TEST_SSOT_I5_FLOCK = "shared";
  try {
    const v = checkRuntimeConcurrencyCapped(REPO_ROOT);
    assert.equal(v.evaluated, true, `I5 must be evaluated under the shared-flock injection, got: ${v.detail}`);
    assert.equal(v.ok, false, `I5 must go RED when the probe's flock is shared (exclusivity broken), got: ${v.detail}`);
  } finally {
    if (prev === undefined) delete process.env.QUAY_TEST_SSOT_I5_FLOCK;
    else process.env.QUAY_TEST_SSOT_I5_FLOCK = prev;
  }
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

test("checker I4 — 能取假: a bash canonical that disagrees with TS ⇒ RED (injected drift)", () => {
  // The TS canonical now reads the SAME seam precedence as bash, so a mismatched env can no longer make
  // them differ — that WAS the seam asymmetry (bash read the seam, TS read the knob). I4 stays
  // falsifiable: inject a bash canonical that returns a different count and the checker must go RED.
  const root = makeFakeRoot({
    "plugin/scripts/suite-slot-lib.sh": 'suite_slot_count() { echo 5; }\n',
  });
  try {
    const v = checkBashTsCountAgree(root);
    assert.equal(v.ok, false, `bash=5 != TS (real env) must be RED, got: ${v.detail}`);
  } finally { cleanup(root); }
});
