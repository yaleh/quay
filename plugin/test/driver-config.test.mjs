// driver-config.test.mjs — 声明式 driver 配置单一真相源（AC155）的单测。
// (tasks/gap-ac155-config-merge-control-state-split-event-polling)
//
// 验证 AC1 取假消点：并发 cap 只有一份解析（driverCap → loadDriverConfig → drivers.yml），
// 三份旧真相源（CAP_DEFAULT / resolveConcurrency env / FIXED_EFFECTIVE_CAP）全部派生自它。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DRIVERS_CONFIG_REL,
  DEFAULT_DRIVER_CAP,
  defaultDriverConfig,
  loadDriverConfig,
  driverCap,
} from "../scripts/driver-config.ts";

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "driver-config-"));
}

function writeDriversYml(dir, yml) {
  fs.mkdirSync(path.join(dir, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, DRIVERS_CONFIG_REL), yml, "utf8");
}

test("defaultDriverConfig — cap/interval/reconcile 缺省（单一回退字面量的派生面）", () => {
  const d = defaultDriverConfig();
  assert.equal(d.promotion.cap, DEFAULT_DRIVER_CAP);
  assert.equal(d.worker.cap, DEFAULT_DRIVER_CAP);
  assert.equal(d.promotion.intervalMs, 30_000);
  assert.equal(d.worker.intervalMs, 30_000);
  assert.equal(d.promotion.reconcileIntervalSecs, 0, "promotion 无协调地板（定时驱动）");
  assert.equal(d.worker.reconcileIntervalSecs, 300, "worker 协调地板 300s（SPEC §5.5 兜底轮询）");
});

test("loadDriverConfig — 读 drivers.yml 覆盖缺省；缺失/坏 YAML ⇒ 缺省（fail-open 到保守回退）", () => {
  // 有 drivers.yml：覆盖 cap / interval / reconcile。
  const a = tmpdir();
  writeDriversYml(
    a,
    [
      "version: 1",
      "kinds:",
      "  promotion:",
      "    cap: 7",
      "    interval_ms: 1000",
      "  worker:",
      "    cap: 9",
      "    interval_ms: 2000",
      "    reconcile_interval_secs: 60",
      "",
    ].join("\n"),
  );
  const cfgA = loadDriverConfig(a);
  assert.equal(cfgA.promotion.cap, 7);
  assert.equal(cfgA.promotion.intervalMs, 1000);
  assert.equal(cfgA.worker.cap, 9);
  assert.equal(cfgA.worker.reconcileIntervalSecs, 60);

  // 缺失 drivers.yml：缺省。
  const b = tmpdir();
  const cfgB = loadDriverConfig(b);
  assert.equal(cfgB.promotion.cap, DEFAULT_DRIVER_CAP);
  assert.equal(cfgB.worker.cap, DEFAULT_DRIVER_CAP);

  // 坏 YAML：缺省（⛔ 不抛，常驻循环不得因 config 拼写炸掉）。
  const c = tmpdir();
  writeDriversYml(c, "kinds: [unclosed");
  const cfgC = loadDriverConfig(c);
  assert.equal(cfgC.worker.cap, DEFAULT_DRIVER_CAP);
});

test("driverCap — 显式 > drivers.yml > 缺省（单一并发解析，AC1）", () => {
  const a = tmpdir();
  writeDriversYml(a, "version: 1\nkinds:\n  worker:\n    cap: 8\n");
  assert.equal(driverCap(a, "worker"), 8, "drivers.yml cap wins over default");
  assert.equal(driverCap(a, "worker", 3), 3, "explicit --concurrency wins over config");
  assert.equal(driverCap(a, "worker", 0), 8, "non-positive explicit ignored ⇒ config");

  const b = tmpdir();
  assert.equal(driverCap(b, "worker"), DEFAULT_DRIVER_CAP, "no config ⇒ default");
  assert.equal(driverCap(b, "promotion", 4), 4);
});
