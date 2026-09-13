// driver-config.test.mjs — 声明式 driver 配置单一真相源（AC155）的单测。
// (tasks/gap-ac155-config-merge-control-state-split-event-polling)
//
// 验证 AC1 取假消点：并发 cap 只有一份解析（driverCap → loadDriverConfig → drivers.yml），
// 三份旧真相源（CAP_DEFAULT / resolveConcurrency env / FIXED_EFFECTIVE_CAP）全部派生自它。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DRIVERS_CONFIG_REL,
  DEFAULT_DRIVER_CAP,
  defaultDriverConfig,
  loadDriverConfig,
  driverCap,
} from "../scripts/driver-config.ts";

const _createdDirs = [];
function tmpdir() {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), "driver-config-"));
  _createdDirs.push(created);
  return created;
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
  // AC144：quality 例程型 kind（B15/B17）——无协调地板、interval 缺省同 outer（30s）。
  assert.equal(d.quality.cap, DEFAULT_DRIVER_CAP, "quality cap 仅为字段齐整（例程型无并发概念）");
  assert.equal(d.quality.intervalMs, 30_000, "quality interval 缺省 30s（同 outer 例程型）");
  assert.equal(d.quality.reconcileIntervalSecs, 0, "quality 无协调地板（例程型）");
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

test("loadDriverConfig — quality 段（AC144）读 drivers.yml 覆盖缺省；driverCap 接受 quality kind", () => {
  const a = tmpdir();
  writeDriversYml(a, "version: 1\nkinds:\n  quality:\n    interval_ms: 45000\n");
  const cfg = loadDriverConfig(a);
  assert.equal(cfg.quality.intervalMs, 45000, "drivers.yml quality.interval_ms 覆盖缺省 30s");
  assert.equal(cfg.quality.cap, DEFAULT_DRIVER_CAP, "quality cap 未写 ⇒ 缺省");

  // 缺省（无 drivers.yml）：quality interval 回退 30s。
  const b = tmpdir();
  assert.equal(loadDriverConfig(b).quality.intervalMs, 30_000, "无 drivers.yml ⇒ quality interval 缺省 30s");
  assert.equal(driverCap(a, "quality"), DEFAULT_DRIVER_CAP, "driverCap 接受 quality kind（单一并发解析）");
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

// ── gap-drivers-yml-interval-not-honored-for-routine-kinds ─────────────────────────────────────────
// AC2: every routine kind's driver must CONSUME its declared `interval_ms` — a config field with no
// reader is indistinguishable from a config field that does nothing, and a reader that never runs is
// indistinguishable from a reader that isn't there. Both halves were real on 2026-09-13:
//   • `meta-driver.ts` hardcoded `let intervalMs = 30_000` — `drivers.yml meta.interval_ms` had zero
//     consumers (goal/quality already read theirs);
//   • the shipped `dist/{goal,quality-gate,meta}-driver.js` bundles ran `pool-quality-judge`'s main
//     and exited in <1s, so nothing reached the resident loop that reads the config at all. That half
//     is pinned in packages/quay/test/build-plugin-dist.test.mjs ("each driver bundle runs its OWN
//     main") because it is a BUNDLING property, not a config one.
// This test is behavioural and fail-able: the temp root declares `interval_ms: 1`, so a driver that
// really reads it finishes `--max-rounds 3` in ~1s. A hardcoded 30_000 fallback needs >=60s, which
// the 25s budget rejects (it is killed ⇒ non-zero/absent status ⇒ RED).
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Stubs so the quality driver's due routines never reach an LLM (the seam, not the interval, is what
// the test is not about): the resource gate refuses and every judge command is `true`.
const QUALITY_STUBS = [
  "--resource-gate-cmd", "false",
  "--judge-cmd", "true", "--arch-judge-cmd", "true", "--judgment-cmd", "true",
  "--identity-cmd", "true", "--lineage-cmd", "true", "--deletion-cmd", "true",
  "--packaging-check-cmd", "true", "--packaging-gap-worker-cmd", "true", "--plan-cmd", "true",
];

test("AC2 — the three routine kinds CONSUME drivers.yml <kind>.interval_ms (declared 1ms ⇒ 3 rounds in ~1s)", () => {
  const cases = [
    { kind: "goal", file: "goal-driver.ts", carrier: ".quay/goal-round.jsonl", extra: [] },
    { kind: "quality", file: "quality-gate-driver.ts", carrier: ".quay/quality-round.jsonl", extra: QUALITY_STUBS },
    { kind: "meta", file: "meta-driver.ts", carrier: ".quay/meta-driver-round.jsonl", extra: ["--no-llm"] },
  ];
  for (const c of cases) {
    const dir = tmpdir();
    writeDriversYml(dir, `version: 1\nkinds:\n  ${c.kind}:\n    interval_ms: 1\n`);
    const started = Date.now();
    const r = spawnSync(process.execPath, [
      "--experimental-strip-types", path.join(PLUGIN_ROOT, "scripts", c.file),
      "--root", dir, "--max-rounds", "3", ...c.extra,
    ], { encoding: "utf8", timeout: 25_000 });
    const elapsedMs = Date.now() - started;
    assert.equal(r.status, 0,
      `${c.file} must exit 0 (declared interval_ms=1 must not be replaced by a 30s literal); stderr tail: ${(r.stderr ?? "").slice(-300)}`);
    const carrier = path.join(dir, c.carrier);
    const rounds = fs.existsSync(carrier)
      ? fs.readFileSync(carrier, "utf8").split("\n").filter((l) => l.trim()).length
      : 0;
    assert.equal(rounds, 3, `${c.file} must write 3 round records to ${c.carrier}`);
    assert.ok(elapsedMs < 20_000,
      `${c.file} must pace at the DECLARED interval — took ${elapsedMs}ms for 3 rounds at interval_ms=1`);
  }
});

after(() => {
  for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true });
});
