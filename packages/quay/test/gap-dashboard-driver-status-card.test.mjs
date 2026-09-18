// @test-group product
// gap-dashboard-driver-status-card — Dashboard「MANAGER / OUTER / INNER」卡读的是已退役探针
// (loop-driver-check/liveness 恒空)，改读真实 driver 存活状态。本任务二次推进（RETREATED 后）：不再
// 硬编码 promotion/worker 两个字面量 kind，改为遍历 driver-runtime.ts 导出的 KNOWN_KINDS（六值），
// quality/meta/goal 三个真实在跑的 driver 也上卡（AC6/AC7）。
//
// 本测试钉死：
//   AC1 — readDriverStatus(root) 的 supervisorAlive/driverAlive/running/supervisorPid/driverPid/
//         records/lastTs 与 driver-runtime.ts 的 aliveness()+carrierStats() 逐字段一致（同一时刻
//         对照——这两者的组合正是 `quay driver status --kind <kind> --json` 的输出内容），并再用
//         kernel 子进程 `driver-runtime.ts status --json` 做一次字面端到端对照。
//   AC2 — renderMgrCard：kind 均 running:true ⇒ 输出含各 kind 的 alive 文案（「运行中」）；
//         running:false（pid 文件缺失）⇒ 输出「未运行」，且不含 undefined/NaN/空；读数整体缺失 ⇒
//         输出「未接入」而非 undefined/NaN。
//   AC3 — serve-dashboard.ts 的 renderMgrCard 函数体内不再引用 loopDriver/liveness（命中 0）。
//   AC4 — observation.ts 的 readDriverStatus/readDriverKind/loadDriverRuntime 函数体内
//         execFileSync/spawnSync/execSync 命中 0（in-process 调 driver-runtime.ts 导出函数，不 shell 出）。
//   AC6 — observation.ts/serve-dashboard.ts 无 `"promotion" | "worker"` 字面量联合（命中 0）；
//         observation.ts 引用 KNOWN_KINDS（命中 ≥1）。
//   AC7 — KNOWN_KINDS 六值全覆盖：5 个存活 kind 渲染「运行中」+ 非空末条记录相对时间；outer（无 pid
//         文件）渲染「未运行」而非被静默省略；负控制：删 pid 文件 ⇒ 该 kind 从「运行中」变「未运行」
//         但仍出现在卡片上（不是从卡片消失）。
//
// gap-dashboard-driver-status-card-ci-red 补（AC2 诊断臂，见文件末节）：本文件的 fixture 是自足的，
// 唯一的外部依赖是 observation.ts 的 kernel 载入。2026-09-16 CI 上它返回**长度 0**（而非某个 kind
// 缺失），5 条断言红，而唯一读数是一条 `0 !== 6` —— 于是被读成「非确定性的 kind 缺失」。真因是
// `plugin-root.ts` 的 walk-up 在 pack-time 暂存窗口里选中了 `packages/quay/plugin/`（见该文件注释），
// 而 `loadDriverRuntime` 把载入异常吞成 null ⇒ 与「产品安装下没有 kernel」共用一个取值（硬规则 3b）。
// 两条控制：resolver 侧在 plugin-root.test.mjs，载入失败可诊断侧在本文件末节。
//
// Run (scoped): node --experimental-strip-types --test packages/quay/test/gap-dashboard-driver-status-card.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { readDriverStatus, clearDriverStatusCache } from "../src/observation.ts";
import { renderMgrCard } from "../src/serve-dashboard.ts";
import { aliveness, carrierStats, KNOWN_KINDS, DRIVER_KINDS } from "../../../plugin/scripts/driver-runtime.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";

// gap-webui-dashboard-body-copy-en-zh: the dashboard's body copy is now language-dependent and
// the module default is `en` (DEFAULT_LANG). Every render below is therefore made EXPLICITLY
// `zh` — the assertions in this file were written against the zh baseline and keep their exact
// original meaning as that baseline's regression guard.


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVE_DASHBOARD_SRC = path.join(__dirname, "..", "src", "serve-dashboard.ts");
const OBSERVATION_SRC = path.join(__dirname, "..", "src", "observation.ts");
const KERNEL = path.resolve(__dirname, "..", "..", "..", "plugin", "scripts", "driver-runtime.ts");

/** 写一个 kind 的 pid 文件（alive=true 用本进程 pid ⇒ 活；false 则不写 ⇒ pid 缺失）+ 载体 jsonl。 */
function writeDriverFixture(root, kind, { alive, ts }) {
  const spec = DRIVER_KINDS[kind];
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

/** 写全部 KNOWN_KINDS 的 fixture；`alive` 可为 boolean 或按 kind 覆写的 map。 */
function writeAllFixtures(root, alive, ts) {
  for (const kind of KNOWN_KINDS) {
    const v = typeof alive === "boolean" ? alive : (alive[kind] ?? false);
    writeDriverFixture(root, kind, { alive: v, ts });
  }
}

/** 从 readDriverStatus 数组取某 kind 的读数（缺失 ⇒ 抛错，AC7 负控制依赖「仍在卡片上」）。 */
function pick(drivers, kind) {
  const d = drivers.find((x) => x.kind === kind);
  assert.ok(d, `reading for ${kind} must be present`);
  return d;
}

// ── AC1 ───────────────────────────────────────────────────────────────────────────────────────────

test("AC1: readDriverStatus matches aliveness()+carrierStats() field-by-field (all kinds alive)", async () => {
  const root = makeTmpDir("quay-dash-drv-ac1-alive-");
  const ts = new Date().toISOString();
  writeAllFixtures(root, true, ts);

  clearDriverStatusCache();
  const got = await readDriverStatus(root);
  assert.equal(got.length, KNOWN_KINDS.length, "one reading per KNOWN_KINDS");
  for (const kind of KNOWN_KINDS) {
    const a = aliveness(root, kind);
    const s = carrierStats(root, kind);
    const g = pick(got, kind);
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

test("AC1: readDriverStatus matches aliveness()+carrierStats() field-by-field (pid 缺失 → dead)", async () => {
  const root = makeTmpDir("quay-dash-drv-ac1-dead-");
  const ts = new Date().toISOString();
  writeAllFixtures(root, false, ts);

  clearDriverStatusCache();
  const got = await readDriverStatus(root);
  for (const kind of KNOWN_KINDS) {
    const a = aliveness(root, kind);
    const s = carrierStats(root, kind);
    const g = pick(got, kind);
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

test("AC1: readDriverStatus matches `driver-runtime.ts status --json` (kernel 子进程端到端)", async () => {
  const root = makeTmpDir("quay-dash-drv-ac1-cli-");
  const ts = new Date().toISOString();
  writeAllFixtures(root, true, ts);

  clearDriverStatusCache();
  const got = await readDriverStatus(root);
  for (const kind of KNOWN_KINDS) {
    const out = execFileSync(
      process.execPath,
      ["--experimental-strip-types", KERNEL, "status", "--kind", kind, "--json", "--root", root],
      { encoding: "utf8" },
    );
    const j = JSON.parse(out);
    const g = pick(got, kind);
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

test("AC2: running:true ⇒ 输出含各 kind 各自的 alive 文案（运行中）", () => {
  const mgr = { drivers: KNOWN_KINDS.map((kind) => reading(kind, { running: true })) };
  const html = renderMgrCard(mgr, "zh");
  for (const kind of KNOWN_KINDS) assert.match(html, new RegExp(kind), `must render the ${kind} kind`);
  assert.match(html, /运行中/, "must render the alive text (运行中)");
});

test("AC2: running:false（pid 缺失）⇒ 输出「未运行」，不含 undefined/NaN/空", () => {
  const mgr = { drivers: KNOWN_KINDS.map((kind) => reading(kind, { running: false })) };
  const html = renderMgrCard(mgr, "zh");
  assert.match(html, /未运行/, "must render 「未运行」 for a dead kind");
  assert.doesNotMatch(html, /undefined|NaN/, "must not leak undefined/NaN");
});

test("AC2: drivers 读数整体缺失（error fallback）⇒ 输出「未接入」而非 undefined/NaN", () => {
  const html = renderMgrCard({}, "zh");
  assert.match(html, /未接入/, "an absent drivers reading must render the honest 未接入 phrase");
  assert.doesNotMatch(html, /undefined|NaN/, "must not leak undefined/NaN");
});

// ── AC3 ───────────────────────────────────────────────────────────────────────────────────────────

/** Extract `export function <fnName>(...) { ... }` (balanced parens + braces) from source. */
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

// ── AC4 ───────────────────────────────────────────────────────────────────────────────────────────

test("AC4: readDriverStatus/readDriverKind/loadDriverRuntime 函数体内零 subprocess（in-process）", () => {
  const src = fs.readFileSync(OBSERVATION_SRC, "utf8");
  for (const fn of ["readDriverStatus", "readDriverKind", "loadDriverRuntime"]) {
    const body = fnBody(src, fn);
    const hits = (body.match(/execFileSync|spawnSync|execSync/g) ?? []).length;
    assert.equal(hits, 0, `${fn} body must not shell out (execFileSync/spawnSync/execSync)`);
  }
});

// ── AC6 ───────────────────────────────────────────────────────────────────────────────────────────

test("AC6: 无 promotion/worker 字面量联合；observation.ts 遍历 KNOWN_KINDS", () => {
  for (const f of [SERVE_DASHBOARD_SRC, OBSERVATION_SRC]) {
    const src = fs.readFileSync(f, "utf8");
    const hits = (src.match(/"promotion"\s*\|\s*"worker"|"worker"\s*\|\s*"promotion"/g) ?? []).length;
    assert.equal(hits, 0, `${path.basename(f)} must not contain a promotion|worker literal union`);
  }
  const obs = fs.readFileSync(OBSERVATION_SRC, "utf8");
  const known = (obs.match(/\bKNOWN_KINDS\b/g) ?? []).length;
  assert.ok(known >= 1, "observation.ts must reference KNOWN_KINDS (traverse the exported kind list)");
});

// ── AC7 ───────────────────────────────────────────────────────────────────────────────────────────

test("AC7: 5 个存活 kind 渲染「运行中」+ 非空末条记录；outer（无 pid）渲染「未运行」而非被省略", async () => {
  const root = makeTmpDir("quay-dash-drv-ac7-");
  const ts = new Date(Date.now() - 5_000).toISOString(); // 5s ago → 相对时间非空（非 "—"）
  const live = { promotion: true, worker: true, outer: false, quality: true, meta: true, goal: true };
  writeAllFixtures(root, live, ts);

  clearDriverStatusCache();
  const got = await readDriverStatus(root);
  const html = renderMgrCard({ drivers: got }, "zh");

  // 5 个存活 kind：运行中 + 非空末条记录相对时间。
  for (const kind of ["promotion", "worker", "quality", "meta", "goal"]) {
    assert.match(html, new RegExp(`<b>${kind}</b>: 运行中`), `${kind} must render 运行中`);
  }
  // 末条记录相对时间非空（≠ "—"）。
  assert.doesNotMatch(html, /末条记录 —/, "a live kind must render a non-empty relative time");
  // outer：渲染「未运行」而非被静默省略。
  assert.match(html, /<b>outer<\/b>: 未运行/, "outer must render 未运行 (not silently omitted)");
});

test("AC7 负控制: 删 pid 文件 ⇒ 该 kind 从「运行中」变「未运行」但仍出现在卡片上", async () => {
  const root = makeTmpDir("quay-dash-drv-ac7-neg-");
  const ts = new Date(Date.now() - 5_000).toISOString();
  writeAllFixtures(root, true, ts);

  clearDriverStatusCache();
  const before = renderMgrCard({ drivers: await readDriverStatus(root) }, "zh");
  assert.match(before, /<b>quality<\/b>: 运行中/, "quality must start 运行中");

  // 负控制：删除 quality 的 pid 文件 ⇒ 该 kind 应翻为「未运行」，而不是从卡片上消失。
  const q = path.join(root, ".quay");
  fs.rmSync(path.join(q, `${DRIVER_KINDS.quality.prefix}-supervisor.pid`), { force: true });
  fs.rmSync(path.join(q, `${DRIVER_KINDS.quality.prefix}.pid`), { force: true });

  clearDriverStatusCache();
  const after = renderMgrCard({ drivers: await readDriverStatus(root) }, "zh");
  assert.match(after, /<b>quality<\/b>: 未运行/, "quality must flip to 未运行 after pid removal");
  assert.doesNotMatch(after, /<b>quality<\/b>: 运行中/, "quality must NOT stay 运行中");
});

// ── AC2 (gap-dashboard-driver-status-card-ci-red): 载入失败必须与「无 kernel」可区分 ────────────────
// 硬规则 3b：两个不同的量不得共用同一个输出取值。pre-fix 时 `loadDriverRuntime` 把「解析不到 kernel」
// （产品安装，正常）与「解析到了但 import 抛了」（异常）都吞成 `null` ⇒ `readDriverStatus` 两种情形
// 都返回长度 0 ⇒ 卡片两种情形都渲染「未接入」。CI 事故的读数因此只有一条 `0 !== 6`，看不出是哪一种。
//
// 用**子进程**做控制：`driverRuntimePromise` 是进程内一次性的模块级缓存，同进程里注坏 root 不会重新
// 解析；fresh process 才测得准。QUAY_PLUGIN_ROOT 是 resolver 的显式优先分支（plugin-root.ts ①），
// 故这一对控制与节点环境无关（driver 派生的会话本来就把该键设成主检出的 plugin，两臂都显式传，
// ⛔ 不靠 delete 该键来制造「无」）。
test("AC2 控制对: kernel 载入失败（异常）vs 载入成功，读数与原因都不同形", () => {
  // 臂①的 root 形状 = 出事时那个 pack-time 暂存快照：一个 plugin 树，其父目录旁没有
  // packages/quay/src（⛔ 不是 source checkout），raw .ts 在、dist bundle 不在，且 import 必抛。
  const brokenBase = makeTmpDir("quay-dash-drv-loaderr-");
  const brokenPlugin = path.join(brokenBase, "plugin");
  fs.mkdirSync(path.join(brokenPlugin, "scripts"), { recursive: true });
  fs.writeFileSync(
    path.join(brokenPlugin, "scripts", "driver-runtime.ts"),
    'import "./no-such-sibling-in-the-staged-tree.ts";\n',
  );

  const probeDir = makeTmpDir("quay-dash-drv-probe-");
  const probe = path.join(probeDir, "probe.mjs");
  fs.writeFileSync(
    probe,
    [
      `import { readDriverStatus, getDriverRuntimeLoadError } from ${JSON.stringify(pathToFileURL(OBSERVATION_SRC).href)};`,
      "const d = await readDriverStatus(process.argv[2]);",
      "process.stdout.write(JSON.stringify({ readings: d.length, loadError: getDriverRuntimeLoadError() }));",
    ].join("\n"),
  );
  const probeRoot = makeTmpDir("quay-dash-drv-probe-root-");
  const runProbe = (pluginRoot) =>
    JSON.parse(
      execFileSync(process.execPath, ["--experimental-strip-types", probe, probeRoot], {
        encoding: "utf8",
        env: { ...process.env, QUAY_PLUGIN_ROOT: pluginRoot },
      }),
    );

  // 臂①（异常）：读数仍为空（形状不变 ⇒ ⛔ 不动 DriversReading 的类型与渲染），但**原因被记下**。
  const bad = runProbe(brokenPlugin);
  assert.equal(bad.readings, 0, "a kernel that throws to load yields no readings (honest empty)");
  assert.match(
    bad.loadError ?? "",
    /^kernel-load-failed:/,
    "⛔ 不是无声的 return null：载入异常必须留下可诊断的原因（硬规则 3b）——pre-fix 这里是 null，与臂②的「没有 kernel」同形",
  );

  // 臂②（正常，唯一差别 = 指向真 source checkout）：读数齐、原因必须为空 —— 否则臂①的断言只是在
  // 断言一个恒真量（硬规则 4：一个结构上不可能取假的读数不是测量）。
  const good = runProbe(path.resolve(__dirname, "..", "..", "..", "plugin"));
  assert.equal(good.readings, KNOWN_KINDS.length, "the real source-checkout kernel still yields every kind");
  assert.equal(good.loadError, null, "a successful load must NOT carry a load reason (⛔ 非恒值)");
});
