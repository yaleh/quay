// @test-group product
// gap-webui-meter-limit-param-doubles-as-display-string — /system 的 bar() 把 limit 一参二用
// （既当百分比分母又当右侧显示文案），loadavg 传入 "nproc×2≈32" ⇒ Number() = NaN 静默退化为 1
// ⇒ 进度条恒满 100%——一个结构上不可能取假的读数（CLAUDE.md 硬规则 4，同时也是硬规则 3b：
// 读不懂输入时返回了与「合格」同形的值）。
//
// 修法：把 limit 拆成 numericLimit（分母，number | null）与 displayLimit（文案，string）；
// numericLimit 为 null/NaN/≤0 时不渲染填充条、显示「（未知上限）」标记，而不是默默按 1 算。
//
// 五个判据：
//   AC1 — 生产载体读数（运行中的实例 /system）：loadavg 行的填充宽度比 vs 页面显示的
//         val / threshold，相对误差 < 2%。改动前显示 74% 却渲染 100%，同脚本必报红。
//   AC2 — 单调性（硬规则 4）：val = 阈值的 25/50/100/200% ⇒ pct = 25/50/100/100（互不全等）。
//   AC3 — 「无法评估」不与「合格」同形（硬规则 3b）：numericLimit null/NaN ⇒ 无填充条 + 未知标记。
//   AC4 — 枚举而非抽查：遍历 /system 全部进度条调用点，断言每个分母 Number()-有限或显式 null。
//   AC5 — scripts/test.sh --for-task gap-webui-meter-limit-param-doubles-as-display-string 退出码 0。
//
// Run (scoped): node --test packages/quay/test/gap-webui-meter-limit-param-doubles-as-display-string.test.mjs
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { meterPct, renderBar, systemBars } from "../src/serve-system.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** Extract the fill-bar percentage (width:NN.N%) from a rendered bar, or null if there is no fill. */
function fillPct(out) {
  const m = out.match(/width:([0-9.]+)%/);
  return m ? Number(m[1]) : null;
}

// ── AC2: monotonicity (the reading must actually be able to be false — 硬规则 4) ───────────────────

test("AC2: renderBar pct is monotonic in val/threshold (25/50/100/200% → 25/50/100/100)", () => {
  const pcts = [25, 50, 100, 200].map((v) => fillPct(renderBar("x", v, 100, "100")));
  assert.deepEqual(pcts, [25, 50, 100, 100], `pct must be [25,50,100,100], got [${pcts}]`);
  assert.ok(new Set(pcts).size > 1, "the four values are NOT all identical (a constant reading is not a measurement)");
});

// ── AC3: 「无法评估」 gets its own value, never a fake 100% (硬规则 3b) ─────────────────────────────

test("AC3: numericLimit null/NaN renders NO fill bar + an explicit unknown marker", () => {
  for (const badLimit of [null, NaN]) {
    // ⚠️ `lang` is EXPLICIT since gap-webui-system-body-copy-en-zh: the marker is dictionary copy
    // now (serve-i18n.ts ROW 14's `unknownLimit`), so an argument-less call asserts the DEFAULT (en)
    // string and would leave the zh literal unchecked — the assertion below would then be testing
    // the wrong language while still looking green. Both languages are asserted.
    const zh = renderBar("loadavg (1m)", 5, badLimit, "nproc×2≈32", "zh");
    assert.equal(fillPct(zh), null, `numericLimit=${badLimit} must not render a fill bar`);
    assert.ok(!zh.includes("width:"), `numericLimit=${badLimit} output must not contain any width:`);
    assert.ok(zh.includes("（未知上限）"), `numericLimit=${badLimit} must show the unknown marker (zh)`);
    const en = renderBar("loadavg (1m)", 5, badLimit, "nproc×2≈32", "en");
    assert.ok(en.includes("(unknown limit)"), `numericLimit=${badLimit} must show the unknown marker (en)`);
    assert.ok(!/[一-龥]/.test(en), `numericLimit=${badLimit} en bar carries no CJK`);
  }
});

test("AC3: val null renders no fill bar (existing honest-empty state preserved)", () => {
  const out = renderBar("loadavg (1m)", null, 32, "32");
  assert.equal(fillPct(out), null, "val null must not render a fill bar");
  assert.ok(out.includes("—"), "val null shows an em-dash, not a fake bar");
});

// ── AC4: enumerate every call site, not spot-check ────────────────────────────────────────────────

/** A denominator is acceptable iff it is explicitly null (「无法评估」) or Number()-parses to a
 *  finite, positive value. A display caption like "nproc×2≈32" parses to NaN → violation. */
function denominatorOk(limit) {
  if (limit == null) return true;
  const n = Number(limit);
  return Number.isFinite(n) && n > 0;
}

test("AC4: every /system bar denominator is Number()-finite or explicitly null", () => {
  const bars = systemBars({
    cpuStallAvg10: 12.5, cpuStallAvg300: 30.0, loadAvg: 23.69, loadThreshold: 32, loadOverFactor: 2,
  });
  assert.ok(bars.length >= 3, "the full bar set is enumerated (not a spot-check)");
  const bad = bars.filter((b) => !denominatorOk(b.numericLimit));
  assert.equal(
    bad.length, 0,
    `违例调用点 ${bad.length} 条: ${bad.map((b) => `${b.label}→${JSON.stringify(b.numericLimit)}`).join(", ")}`,
  );
  // The loadavg bar's denominator is the numeric threshold, its caption is separate.
  const loadavg = bars.find((b) => b.label === "loadavg (1m)");
  assert.equal(loadavg.numericLimit, 32, "loadavg numericLimit is the numeric threshold (32)");
  assert.equal(loadavg.displayLimit, "nproc×2≈32", "loadavg displayLimit is the human caption");
});

test("AC4: an explicitly-null denominator (unmeasurable threshold) is allowed", () => {
  const bars = systemBars({
    cpuStallAvg10: null, cpuStallAvg300: null, loadAvg: 23.69, loadThreshold: null, loadOverFactor: 2,
  });
  const bad = bars.filter((b) => !denominatorOk(b.numericLimit));
  assert.equal(bad.length, 0, `explicit null is not a violation; got ${bad.map((b) => b.label)}`);
  assert.equal(bars.find((b) => b.label === "loadavg (1m)").numericLimit, null, "loadavg denominator is explicit null");
});

// ── AC1: production carrier reading — a REAL /system instance ──────────────────────────────────────

describe("AC1: running /system instance", () => {
  let server, port, originalCwd, workspaceRoot, tasksDir;

  before(async () => {
    tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "gap-meter-tasks-"));
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gap-meter-ws-"));
    fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`);
    execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
    fs.writeFileSync(path.join(workspaceRoot, "README.md"), "gap-meter fixture workspace\n");
    execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
    execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-qm", "fixture init"], { cwd: workspaceRoot });

    // Force resource-gate.sh to a deterministic loadavg=23.69 / nproc=16 → threshold=32 (≈74%),
    // mirroring the observed production values (23.69 / nproc×2≈32). Before the fix this row
    // rendered a 100% fill despite the displayed 74% — this exact script must catch that.
    process.env.RESOURCE_GATE_TEST_LOAD_OVERRIDE = "23.69";
    process.env.RESOURCE_GATE_TEST_NPROC = "16";
    process.env.RESOURCE_GATE_TEST_CPU_AVG10 = "0.5";
    process.env.RESOURCE_GATE_TEST_MEM_AVAIL_MB = "999999";
    process.env.RESOURCE_GATE_TEST_NODE_PROCS = "0";

    originalCwd = process.cwd();
    process.chdir(workspaceRoot);
    server = await startServer({ port: 0 });
    port = server.address().port;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    if (server.client) await server.client.close();
    process.chdir(originalCwd);
    delete process.env.RESOURCE_GATE_TEST_LOAD_OVERRIDE;
    delete process.env.RESOURCE_GATE_TEST_NPROC;
    delete process.env.RESOURCE_GATE_TEST_CPU_AVG10;
    delete process.env.RESOURCE_GATE_TEST_MEM_AVAIL_MB;
    delete process.env.RESOURCE_GATE_TEST_NODE_PROCS;
    fs.rmSync(tasksDir, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  function get(urlPath) {
    return new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      }).on("error", reject);
    });
  }

  test("AC1: loadavg fill ratio matches displayed val/threshold (<2% relative error)", async () => {
    const r = await get("/system");
    assert.equal(r.status, 200, "GET /system returns 200");
    const idx = r.body.indexOf("loadavg (1m)");
    assert.ok(idx >= 0, "loadavg row is present in the rendered /system page");
    const seg = r.body.slice(idx, idx + 600);
    const valM = seg.match(/loadavg \(1m\)<\/span><span>([0-9]+(?:\.[0-9]+)?)/);
    const thresholdM = seg.match(/≈([0-9]+)/);
    const fillM = seg.match(/width:([0-9.]+)%/);
    assert.ok(valM, `loadavg displayed value parseable from: ${seg.slice(0, 120)}…`);
    assert.ok(thresholdM, `loadavg displayed threshold parseable from: ${seg.slice(0, 120)}…`);
    assert.ok(fillM, `loadavg fill bar parseable from: ${seg.slice(0, 120)}…`);
    const val = Number(valM[1]);
    const threshold = Number(thresholdM[1]);
    const fill = Number(fillM[1]);
    const expected = (val / threshold) * 100;
    const relErr = Math.abs(fill - expected) / expected;
    assert.ok(
      relErr < 0.02,
      `loadavg fill ${fill}% vs displayed ${val}/${threshold}=${expected.toFixed(2)}% (relErr ${(relErr * 100).toFixed(2)}% ≥ 2%)`,
    );
  });
});
