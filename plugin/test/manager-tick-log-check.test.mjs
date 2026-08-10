// @test-group engine
// manager-tick-log-check.test.mjs — gap-manager-tick-log-check-row-criterion-and-shrink-ratchet.
// Pins the AC5b tick-log checker's TWO mechanism fixes plus the untouched AC5b semantics:
//
//   AC1 三输入构造 fixture（复现固化）：旧格式-only / 新格式-only / 缩水日志（+ 全截空日志）。
//   AC2 行判据认两种格式——新格式-only 日志判据①通过（修前旧正则只数 `| 2026-`，
//       最近 24 轮新格式行一条没数进；本测试就是那个回归）。分钟可能含防误读掩码 x。
//   AC3 缩水棘轮——行数低于基线 ⇒ 报红（277→5 缩水构造必报红）；基线在 git-tracked
//       sidecar（默认 <LOG>.baseline），不在被截的 log 内，同一截断带不走它。
//   AC5 不破坏既有语义——stale-hours 判据（mtime 新鲜度）保留；旧格式历史行 + 新鲜 mtime
//       不误报红；header-only 无 tick 行仍报 no-tick-row（而非缩水误报）。
//
// Run:
//   scripts/test.sh plugin/test/manager-tick-log-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKER = join(import.meta.dirname, "..", "scripts", "manager-tick-log-check.sh");

function runChecker(args) {
  return spawnSync("bash", [CHECKER, ...args], { encoding: "utf8" });
}

function makeDir() {
  return mkdtempSync(join(tmpdir(), "mtlc-"));
}

function jsonOf(res) {
  assert.equal(res.status, 0, `checker must exit 0:\n${res.stdout}\n${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

// ── AC1/AC2 — 行判据认两种格式：三种构造输入 ────────────────────────────────────────────────

test("AC1/AC2 — old-format-only log (| 2026-…) passes criterion ①", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "old.md");
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 2026-08-07 15:5xZ | no-action |\n", "utf8");
    const out = jsonOf(runChecker(["--log", log, "--stale-hours", "1", "--json"]));
    assert.equal(out.ok, true);
    assert.equal(out.tickRows, 1, "old-format row must be counted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC1/AC2 — new-format-only log (| HH:MMZ) passes criterion ① (regression: old regex counted 0)", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "new.md");
    // 真实新格式既有 digit-only（07:35Z）也有掩码分钟（17:3xZ）——两者都必须被数进。
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 17:3xZ | escalate |\n| 07:35Z | no-action |\n", "utf8");
    const out = jsonOf(runChecker(["--log", log, "--stale-hours", "1", "--json"]));
    assert.equal(out.ok, true, "new-format-only log must pass criterion ① (was silently failing)");
    assert.equal(out.tickRows, 2, "both new-format rows (masked + digit) must be counted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC1/AC2 — mixed formats both counted", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "mixed.md");
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 2026-08-07 15:5xZ | correct |\n| 17:3xZ | escalate |\n", "utf8");
    const out = jsonOf(runChecker(["--log", log, "--stale-hours", "1", "--json"]));
    assert.equal(out.ok, true);
    assert.equal(out.tickRows, 2, "one old + one new format row = 2");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── AC3 — 缩水棘轮：行数低于基线报红，基线不受同一截断影响 ──────────────────────────────────

test("AC3 — 277→5 缩水（保留若干旧格式行）必报红 shrink-detected，非静默 PASS", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "shrunk.md");
    // 基线 277（任务体重建后的行数）存在 sidecar；log 只剩 3 行且保留旧格式行。
    writeFileSync(`${log}.baseline`, "277\n", "utf8");
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 2026-08-04 06:4xZ | correct |\n", "utf8");
    const res = runChecker(["--log", log, "--stale-hours", "1", "--json"]);
    assert.equal(res.status, 1, "shrunk log must be red");
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.ok, false);
    assert.equal(out.reason, "shrink-detected");
    assert.equal(out.lines, 3);
    assert.equal(out.baseline, 277);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC3 — 全截（0 字节）也报红 shrink-detected", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "empty.md");
    writeFileSync(`${log}.baseline`, "277\n", "utf8");
    writeFileSync(log, "", "utf8");
    const res = runChecker(["--log", log, "--stale-hours", "1", "--json"]);
    assert.equal(res.status, 1);
    assert.equal(JSON.parse(res.stdout.trim()).reason, "shrink-detected");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC3 — 基线不在被截的 log 内：sidecar 独立存在且值不被 log 截断带走", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "log.md");
    writeFileSync(`${log}.baseline`, "277\n", "utf8");
    writeFileSync(log, "| 2026-08-04 06:4xZ | correct |\n", "utf8");
    // 检查器读 sidecar 判红；log 截断不影响 sidecar 的值。
    const res = runChecker(["--log", log, "--stale-hours", "1", "--json"]);
    assert.equal(res.status, 1);
    assert.equal(readFileSync(`${log}.baseline`, "utf8").trim(), "277", "baseline sidecar must survive log truncation");
    // sidecar 是独立文件（内容不是从 log 里来的）。
    assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1, "log is the truncated one");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC3 — 只增的棘轮：log 增长 ⇒ 基线自动上调；再缩水 ⇒ 报红", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "ratchet.md");
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 17:3xZ | no-action |\n", "utf8");
    const first = jsonOf(runChecker(["--log", log, "--stale-hours", "1", "--json"]));
    assert.equal(first.ok, true);
    assert.equal(first.baseline, 3, "first run bootstraps baseline to current lines");
    // 追加两行 → 5 行。
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 17:3xZ | no-action |\n| 17:4xZ | no-action |\n| 17:5xZ | no-action |\n", "utf8");
    const second = jsonOf(runChecker(["--log", log, "--stale-hours", "1", "--json"]));
    assert.equal(second.ok, true);
    assert.equal(second.baseline, 5, "ratchet must ratchet UP to the grown line count");
    // 再缩回 3 行（保留旧格式行）⇒ 报红。
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 2026-08-04 06:4xZ | correct |\n", "utf8");
    const third = runChecker(["--log", log, "--stale-hours", "1", "--json"]);
    assert.equal(third.status, 1);
    assert.equal(JSON.parse(third.stdout.trim()).reason, "shrink-detected");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── AC5 — 不破坏既有语义 ────────────────────────────────────────────────────────────────────

test("AC5 — stale-hours 判据保留：mtime 超时 ⇒ 报红 stale", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "stale.md");
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 2026-08-07 04:0xZ | no-action |\n", "utf8");
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    utimesSync(log, old, old);
    const res = runChecker(["--log", log, "--stale-hours", "1", "--json"]);
    assert.equal(res.status, 1);
    assert.equal(JSON.parse(res.stdout.trim()).reason, "stale");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC5 — 旧格式历史行 + 新鲜 mtime 不误报红（既有通过路径）", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "pass.md");
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n| 2026-08-07 15:5xZ | no-action |\n| 2026-08-08 09:1xZ | no-action |\n", "utf8");
    const out = jsonOf(runChecker(["--log", log, "--stale-hours", "1", "--json"]));
    assert.equal(out.ok, true, "historical old-format rows + fresh mtime must still pass");
    assert.equal(out.tickRows, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC5 — header-only 无 tick 行仍报 no-tick-row（首轮 bootstrap 不因缩水误报）", () => {
  const dir = makeDir();
  try {
    const log = join(dir, "header.md");
    writeFileSync(log, "| 时刻 | 动作 |\n|---|---|\n", "utf8");
    const res = runChecker(["--log", log, "--stale-hours", "1", "--json"]);
    assert.equal(res.status, 1);
    assert.equal(JSON.parse(res.stdout.trim()).reason, "no-tick-row");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

