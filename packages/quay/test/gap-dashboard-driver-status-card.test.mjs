// @test-group product
// gap-dashboard-driver-status-card — Dashboard「MANAGER / OUTER / INNER」卡读的是已退役探针
// (loop-driver-check/liveness 恒空)，改读真实 promotion/worker driver 存活状态。
//
// 本测试钉死：
//   AC1 — readDriverStatus(root) 的 supervisorAlive/driverAlive/running/supervisorPid/driverPid/
//         records/lastTs 与 driver-runtime.ts 的 aliveness()+carrierStats() 逐字段一致（同一时刻
//         对照——这两者的组合正是 `quay driver status --kind <kind> --json` 的输出内容），并再用
//         kernel 子进程 `driver-runtime.ts status --json` 做一次字面端到端对照。
//   AC2 — renderMgrCard：两个 kind 均 running:true ⇒ 输出含 promotion 与 worker 两个 kind 的 alive
//         文案（「运行中」）；running:false（pid 文件缺失）⇒ 输出「未运行」，且不含 undefined/NaN/空。
//   AC3 — serve-dashboard.ts 的 renderMgrCard 函数体内不再引用 loopDriver/liveness（命中 0）。
//
// Run (scoped): node --experimental-strip-types --test packages/quay/test/gap-dashboard-driver-status-card.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { readDriverStatus, clearDriverStatusCache } from "../src/observation.ts";
import { renderMgrCard } from "../src/serve-dashboard.ts";
import { aliveness, carrierStats } from "../../../plugin/scripts/driver-runtime.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");
const KERNEL = path.resolve(__dirname, "..", "..", "..", "plugin", "scripts", "driver-runtime.ts");

// pid 文件前缀 + carrier 相对路径（同 driver-runtime.ts DRIVER_KINDS 的 promotion/worker 两条）。
const KIND_SPEC = {
  promotion: { prefix: "promotion-driver", carriers: ["promotion-outcome.jsonl", "promotion-round.jsonl"] },
  worker: { prefix: "worker-driver", carriers: ["worker-outcome.jsonl", "worker-round.jsonl"] },
};

/** 写一个 kind 的 pid 文件（alive=true 用本进程 pid ⇒ 活；false 则不写 ⇒ pid 缺失）+ 载体 jsonl。 */
function writeDriverFixture(root, kind, { alive, ts }) {
  const spec = KIND_SPEC[kind];
  const q = path.join(root, ".quay");
  fs.mkdirSync(q, { recursive: true });
  if (alive) {
    fs.writeFileSync(path.join(q, `${spec.prefix}-supervisor.pid`), `${process.pid}\n`);
    fs.writeFileSync(path.join(q, `${spec.prefix}.pid`), `${process.pid}\n`);
  }
  for (const c of spec.carriers) {
    fs.writeFileSync(path.join(q, c), `${JSON.stringify({ ts, round: 1, run_id: "test-fixture" })}\n`);
  }
}

// ── AC1 ───────────────────────────────────────────────────────────────────────────────────────────

test("AC1: readDriverStatus matches aliveness()+carrierStats() field-by-field (alive)", () => {
  const root = makeTmpDir("quay-dash-drv-ac1-alive-");
  const ts = new Date().toISOString();
  for (const kind of ["promotion", "worker"]) writeDriverFixture(root, kind, { alive: true, ts });

  clearDriverStatusCache();
  const got = readDriverStatus(root);
  for (const kind of ["promotion", "worker"]) {
    const a = aliveness(root, kind);
    const s = carrierStats(root, kind);
    const g = got[kind];
    assert.equal(g.supervisorAlive, a.supervisorAlive, `${kind} supervisorAlive`);
    assert.equal(g.driverAlive, a.driverAlive, `${kind} driverAlive`);
    assert.equal(g.running, a.running, `${kind} running`);
    assert.equal(g.supervisorPid, a.supervisorPid, `${kind} supervisorPid`);
    assert.equal(g.driverPid, a.driverPid, `${kind} driverPid`);
    assert.equal(g.records, s.records, `${kind} records`);
    assert.equal(g.lastTs, s.lastTs, `${kind} lastTs`);
    assert.equal(g.running, true, `${kind} should be running with an alive pid`);
  }
});

test("AC1: readDriverStatus matches aliveness()+carrierStats() field-by-field (pid 缺失 → dead)", () => {
  const root = makeTmpDir("quay-dash-drv-ac1-dead-");
  const ts = new Date().toISOString();
  for (const kind of ["promotion", "worker"]) writeDriverFixture(root, kind, { alive: false, ts });

  clearDriverStatusCache();
  const got = readDriverStatus(root);
  for (const kind of ["promotion", "worker"]) {
    const a = aliveness(root, kind);
    const s = carrierStats(root, kind);
    const g = got[kind];
    assert.equal(g.supervisorAlive, a.supervisorAlive, `${kind} supervisorAlive`);
    assert.equal(g.driverAlive, a.driverAlive, `${kind} driverAlive`);
    assert.equal(g.running, a.running, `${kind} running`);
    assert.equal(g.supervisorPid, a.supervisorPid, `${kind} supervisorPid`);
    assert.equal(g.driverPid, a.driverPid, `${kind} driverPid`);
    assert.equal(g.records, s.records, `${kind} records`);
    assert.equal(g.lastTs, s.lastTs, `${kind} lastTs`);
    assert.equal(g.running, false, `${kind} should be dead with a missing pid file`);
  }
});

test("AC1: readDriverStatus matches `driver-runtime.ts status --json` (kernel 子进程端到端)", () => {
  const root = makeTmpDir("quay-dash-drv-ac1-cli-");
  const ts = new Date().toISOString();
  for (const kind of ["promotion", "worker"]) writeDriverFixture(root, kind, { alive: true, ts });

  clearDriverStatusCache();
  const got = readDriverStatus(root);
  for (const kind of ["promotion", "worker"]) {
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", KERNEL, "status", "--kind", kind, "--json", "--root", root],
      { encoding: "utf8" },
    );
    const j = JSON.parse(out);
    const g = got[kind];
    assert.equal(g.supervisorAlive, j.supervisor_alive === 1, `${kind} supervisorAlive vs status --json`);
    assert.equal(g.driverAlive, j.driver_alive === 1, `${kind} driverAlive vs status --json`);
    assert.equal(g.running, j.running === 1, `${kind} running vs status --json`);
    assert.equal(g.supervisorPid, j.supervisor_pid, `${kind} supervisorPid vs status --json`);
    assert.equal(g.driverPid, j.driver_pid, `${kind} driverPid vs status --json`);
    assert.equal(g.records, j.carrier_records, `${kind} records vs status --json`);
    assert.equal(g.lastTs, j.last_record_ts, `${kind} lastTs vs status --json`);
  }
});

// ── AC2 ───────────────────────────────────────────────────────────────────────────────────────────

/** 一个 kind 的 DriverKindReading fixture。 */
function reading(kind, { running }) {
  return {
    kind,
    supervisorPid: running ? 1234 : null,
    driverPid: running ? 1235 : null,
    supervisorAlive: running,
    driverAlive: running,
    running,
    records: running ? 42 : 0,
    lastTs: running ? new Date(Date.now() - 2 * 3600_000).toISOString() : null,
  };
}

test("AC2: running:true ⇒ 输出含 promotion 与 worker 两个 kind 各自的 alive 文案", () => {
  const mgr = {
    drivers: {
      promotion: reading("promotion", { running: true }),
      worker: reading("worker", { running: true }),
    },
  };
  const html = renderMgrCard(mgr);
  assert.match(html, /promotion/, "must render the promotion kind");
  assert.match(html, /worker/, "must render the worker kind");
  assert.match(html, /运行中/, "must render the alive text (运行中)");
});

test("AC2: running:false（pid 缺失）⇒ 输出「未运行」，不含 undefined/NaN/空", () => {
  const mgr = {
    drivers: {
      promotion: reading("promotion", { running: false }),
      worker: reading("worker", { running: false }),
    },
  };
  const html = renderMgrCard(mgr);
  assert.match(html, /未运行/, "must render 「未运行」 for a dead kind");
  assert.doesNotMatch(html, /undefined|NaN/, "must not leak undefined/NaN");
});

test("AC2: drivers 读数缺失（error fallback）⇒ 输出「未运行」而非 undefined/NaN", () => {
  const html = renderMgrCard({});
  assert.match(html, /未运行/, "an absent drivers reading must render 「未运行」");
  assert.doesNotMatch(html, /undefined|NaN/, "must not leak undefined/NaN");
});

// ── AC3 ───────────────────────────────────────────────────────────────────────────────────────────

/** Extract `export function renderMgrCard(...) { ... }` (balanced parens + braces) from source. */
function fnBody(src, fnName) {
  const re = new RegExp(`function\\s+${fnName}\\s*\\(`);
  const m = re.exec(src);
  assert.ok(m, `${fnName} found in ${src.length}-char source`);
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    if (src[i] === "(") parenDepth++;
    else if (src[i] === ")") parenDepth--;
    i++;
  }
  while (i < src.length && src[i] !== "{") i++;
  assert.ok(src[i] === "{", `${fnName} has a body`);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error(`${fnName} body not terminated`);
}

test("AC3: renderMgrCard 函数体内不再引用 loopDriver/liveness", () => {
  const src = fs.readFileSync(SERVE_DASHBOARD_SRC, "utf8");
  const body = fnBody(src, "renderMgrCard");
  const hits = (body.match(/\b(loopDriver|liveness)\b/g) ?? []).length;
  assert.equal(hits, 0, "renderMgrCard body must not reference loopDriver/liveness");
});
