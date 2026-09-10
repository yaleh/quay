import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { joinFilePsiWindow } from "../scripts/psi-window-join.ts";

// fixture 注入的载体（临时目录，非真实生产文件）——覆盖 AC6 的三种情形：
//   ① 命中样本的正常联接  ② 载体缺失的 fail-closed  ③ 指定 file 在指定 runId 下不存在于 perFile。
function makeRoot({ withVerificationRound = true, withSuiteLoad = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "psi-window-join-"));
  const quay = path.join(dir, ".quay");
  fs.mkdirSync(quay, { recursive: true });
  if (withVerificationRound) {
    const round = {
      runId: "run-1",
      perFile: [
        { file: "a.test.mjs", startedAtMs: 1000, endedAtMs: 5000, passed: true },
        { file: "b.test.mjs", startedAtMs: 6000, endedAtMs: 9000, passed: false },
      ],
    };
    fs.writeFileSync(path.join(quay, "verification-round.jsonl"), JSON.stringify(round) + "\n");
  }
  if (withSuiteLoad) {
    const rows = [
      { t: 500, cpu_stall: 1 },
      { t: 1000, cpu_stall: 10 },
      { t: 2000, cpu_stall: 20 },
      { t: 3000, cpu_stall: 30 },
      { t: 4000, cpu_stall: 40 },
      { t: 5000, cpu_stall: 50 },
      { t: 6000, cpu_stall: 60 },
      { t: 9000, cpu_stall: 90 },
      { t: 10000, cpu_stall: 100 },
    ];
    fs.writeFileSync(
      path.join(quay, "suite-load-run-1.jsonl"),
      rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
    );
  }
  return dir;
}

test("命中样本的正常联接：window [1000,5000] 命中 5 个采样，mean/max/sampleCount 正确", () => {
  const dir = makeRoot();
  const r = joinFilePsiWindow(dir, "run-1", "a.test.mjs");
  assert.equal(r.found, true);
  assert.equal(r.sampleCount, 5);
  assert.deepEqual(
    r.samples.map((s) => s.cpu_stall),
    [10, 20, 30, 40, 50]
  );
  assert.equal(r.mean, 30);
  assert.equal(r.max, 50);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("窗口边界闭区间：结束时刻的采样也计入", () => {
  const dir = makeRoot();
  const r = joinFilePsiWindow(dir, "run-1", "b.test.mjs");
  assert.equal(r.found, true);
  assert.equal(r.sampleCount, 2);
  assert.equal(r.mean, 75);
  assert.equal(r.max, 90);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("载体缺失 fail-closed：无 verification-round.jsonl ⇒ found:false + reason 提及 not found", () => {
  const dir = makeRoot({ withVerificationRound: false });
  const r = joinFilePsiWindow(dir, "run-1", "a.test.mjs");
  assert.equal(r.found, false);
  assert.match(r.reason, /not found/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("载体缺失 fail-closed：无 suite-load 文件 ⇒ found:false", () => {
  const dir = makeRoot({ withSuiteLoad: false });
  const r = joinFilePsiWindow(dir, "run-1", "a.test.mjs");
  assert.equal(r.found, false);
  assert.match(r.reason, /not found/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("指定 file 在指定 runId 下不存在于 perFile ⇒ found:false", () => {
  const dir = makeRoot();
  const r = joinFilePsiWindow(dir, "run-1", "nonexistent.test.mjs");
  assert.equal(r.found, false);
  assert.match(r.reason, /not found/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("指定 runId 不存在 ⇒ found:false", () => {
  const dir = makeRoot();
  const r = joinFilePsiWindow(dir, "run-missing", "a.test.mjs");
  assert.equal(r.found, false);
  assert.match(r.reason, /not found/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
