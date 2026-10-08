// @test-group engine
// driver-shared.test.mjs — gap-driver-resource-gate-path-anchored-at-root-third-party.
// resourceGateCheck 的缺省 argv 不再锚在 opts.root（第三方项目无 plugin/ ⇒ 恒 exit 127 ⇒ 永不派发），
// 改由 resolveResourceGateScript 从本 kernel 安装位置（或 QUAY_PLUGIN_ROOT 覆盖，同 AC-203 手法）解析。
// 双向覆盖（AC3）：kernel 侧有 resource-gate.sh ⇒ 非 127（GO/真实 WAIT）；kernel 侧无 ⇒ fail-closed
// 报「not found」（⛔ 不是 exit 127 command-not-found，也⛔ 不静默 GO）。
//
// Run:
//   node --test plugin/test/driver-shared.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveResourceGateScript, resourceGateCheck, residentLoopStop } from "../scripts/driver-shared.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 一个临时 plugin root：其 scripts 子目录下按 opts.withScript 决定放不放 resource-gate.sh。 */
function makePluginRoot(opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drv-shared-"));
  const scripts = path.join(root, "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  if (opts.withScript) fs.writeFileSync(path.join(scripts, "resource-gate.sh"), opts.withScript, "utf8");
  return root;
}

/** 保存/恢复 process.env.QUAY_PLUGIN_ROOT 的包装：把 env 指向 fake plugin root 跑 fn，再复原。 */
function withPluginRoot(root, fn) {
  const saved = process.env.QUAY_PLUGIN_ROOT;
  if (root) process.env.QUAY_PLUGIN_ROOT = root;
  else delete process.env.QUAY_PLUGIN_ROOT;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = saved;
  }
}

test("resolveResourceGateScript — dev tree 缺省（无 override）解析到本仓库 plugin/scripts/resource-gate.sh（非 null）", () => {
  const p = resolveResourceGateScript({ ...process.env, QUAY_PLUGIN_ROOT: undefined });
  assert.ok(p, "dev tree 缺省须解析到真实 resource-gate.sh");
  assert.equal(path.basename(p), "resource-gate.sh");
  assert.ok(fs.existsSync(p), `解析到的路径须存在：${p}`);
});

test("resolveResourceGateScript — QUAY_PLUGIN_ROOT 指向有 script 的 fake root ⇒ 解析到该路径", () => {
  const root = makePluginRoot({ withScript: "#!/bin/sh\nexit 0\n" });
  try {
    const p = resolveResourceGateScript({ QUAY_PLUGIN_ROOT: root });
    assert.equal(p, path.join(root, "scripts", "resource-gate.sh"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolveResourceGateScript — QUAY_PLUGIN_ROOT 指向无 script 的 fake root ⇒ null（fail-closed）", () => {
  const root = makePluginRoot({});
  try {
    const p = resolveResourceGateScript({ QUAY_PLUGIN_ROOT: root });
    assert.equal(p, null, "kernel 侧无 resource-gate.sh ⇒ null，调用方 fail-closed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — kernel 侧有 resource-gate.sh ⇒ resourceGateCheck 非 127（exit 0 ⇒ GO）", () => {
  const root = makePluginRoot({ withScript: "#!/bin/sh\nexit 0\n" });
  try {
    withPluginRoot(root, () => {
      const r = resourceGateCheck("/r", null);
      assert.equal(r.go, true, "exit 0 ⇒ GO（脚本被找到并运行，非 command-not-found）");
      assert.doesNotMatch(r.reason, /127/, `reason 不得含 exit 127：${r.reason}`);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — kernel 侧有 resource-gate.sh ⇒ 真实 WAIT（exit 1）而非 exit 127", () => {
  const root = makePluginRoot({ withScript: "#!/bin/sh\nexit 1\n" });
  try {
    withPluginRoot(root, () => {
      const r = resourceGateCheck("/r", null);
      assert.equal(r.go, false, "exit 1 ⇒ WAIT（fail-closed，脚本被找到并运行）");
      assert.match(r.reason, /WAIT/, `reason 应是真实 WAIT：${r.reason}`);
      assert.doesNotMatch(r.reason, /127/, `reason 不得含 exit 127：${r.reason}`);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC3 — kernel 侧无 resource-gate.sh ⇒ fail-closed 报 not found（⛔ 非 exit 127、非静默 GO）", () => {
  const root = makePluginRoot({});
  try {
    withPluginRoot(root, () => {
      const r = resourceGateCheck("/r", null);
      assert.equal(r.go, false, "找不到 ⇒ fail-closed WAIT");
      assert.match(r.reason, /not found/, `reason 须报找不到：${r.reason}`);
      assert.doesNotMatch(r.reason, /127/, `reason 不得含 exit 127：${r.reason}`);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2 负控制（改后）— 无 plugin/ 的第三方 root 走缺省解析 ⇒ 非 exit 127、非 not found（kernel 侧有）", () => {
  // 第三方项目 root：无 plugin/ 目录（quay-init 只写 config，不复制 plugin/）。缺省解析（无
  // QUAY_PLUGIN_ROOT）从本 kernel 安装位置（本仓库 plugin/scripts/resource-gate.sh）拿到脚本 ⇒
  // 跑真实 gate（GO 或真实 WAIT），⛔ 不再 `bash <不存在路径>` exit 127。
  const thirdParty = fs.mkdtempSync(path.join(os.tmpdir(), "drv-shared-3rd-"));
  try {
    withPluginRoot(null, () => {
      const r = resourceGateCheck(thirdParty, null);
      // go 是 true 还是 false 取决于真实负载——两种都合法，唯一非法的是 127（command-not-found）
      // 或 not found（kernel 侧也没有）。
      assert.doesNotMatch(r.reason, /127/, `reason 不得含 exit 127：${r.reason}`);
      assert.doesNotMatch(r.reason, /not found/, `kernel 侧有脚本 ⇒ 不得报 not found：${r.reason}`);
    });
  } finally {
    fs.rmSync(thirdParty, { recursive: true, force: true });
  }
});

// ── residentLoopStop：三常驻循环共用的停机控制器 ────────────────────────────────────────────────
// finding `driver-sleep-requeststop-triple`（semantic-dedup-scan，byte-identical-body）。此处覆盖
// 三个语义点：(1) 到点 resolve 且未停机；(2) requestStop 唤醒**在飞的** sleep（提前 resolve，⛔ 不等
// 满一个 interval）；(3) requestStop 后 isStopRequested 翻真且可重复调用。

test("residentLoopStop — 未停机时 sleep 到点 resolve，isStopRequested 保持 false", async () => {
  const ctl = residentLoopStop();
  assert.equal(ctl.isStopRequested(), false);
  const t0 = Date.now();
  await ctl.sleep(20);
  assert.ok(Date.now() - t0 >= 15, "应实际等到接近 20ms");
  assert.equal(ctl.isStopRequested(), false, "无人 requestStop ⇒ 仍是 false");
});

test("residentLoopStop — requestStop 唤醒在飞的 sleep（提前 resolve，⛔ 不等满 interval）", async () => {
  const ctl = residentLoopStop();
  const t0 = Date.now();
  const pending = ctl.sleep(60_000); // 一分钟后才到点
  ctl.requestStop();
  await pending; // 若未被唤醒，本 await 会挂约 60s（测试超时 ⇒ 判据能取假）
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 2_000, `requestStop 须立即唤醒：实测 ${elapsed}ms`);
  assert.equal(ctl.isStopRequested(), true);
});

test("residentLoopStop — requestStop 幂等；无在飞 sleep 时调用不抛", () => {
  const ctl = residentLoopStop();
  ctl.requestStop();
  assert.equal(ctl.isStopRequested(), true);
  ctl.requestStop(); // 无 wakeResolve 时再调用：⛔ 不抛
  assert.equal(ctl.isStopRequested(), true);
});

test("回归（dedup 守卫）— 三常驻 driver ⛔ 不再各自声明 wakeResolve 副本；均经 residentLoopStop", () => {
  // 硬规则 5b：缺陷成簇。此判据在【三个文件】上按位置查标识符（⛔ 不是关键词——注释里提到不算），
  // 防这次抽取被下一次「顺手复制四行」重新引入。
  const dir = path.resolve(__dirname, "..", "scripts");
  for (const f of ["outer-driver.ts", "promotion-driver.ts", "quality-gate-driver.ts"]) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.equal(
      (src.match(/let wakeResolve/g) ?? []).length,
      0,
      `${f} 不得再声明 wakeResolve 副本（应经 driver-shared residentLoopStop）`,
    );
    assert.match(src, /residentLoopStop\(\)/, `${f} 须调用 shared residentLoopStop()`);
  }
});
