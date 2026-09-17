// @test-group serial
// driver-runtime.test.mjs — AC151 (tasks/gap-ac151-two-level-driver-layer-landing): the two-level
// layering (Layer 0 driver-runtime + Layer 1a task-processing / Layer 1b routine) + the supervisor
// ported from promotion-driver-launch.sh (bash) into TS.
//
//   AC1 (两级分层落地): Layer 0 (driver-runtime) owns supervisor/loop/stopCondition/heartbeat/
//     controlPlane/notify/profile/ResultVocab; Layer 1a owns source/filters/select/act/verify/outcome;
//     Layer 1b owns routines/schedule/collect/report. promotion/worker inherit 0+1a (identity,
//     ⛔ 非平行副本). Falsifiable: ① manager-kind (1b) 被骨架强制实现空的候选池/选择/verify 三段 ⇒ 假
//     （1b 的 RoutineSpec 不引用 1a 的 source/select/verify）；② 1b 重实现 Layer 0 循环/心跳/判停 ⇒ 假
//     （1b 的 schedule 复用 routine-scheduler isDue 同一函数身份，report 经 Layer 0 notify）。
//   AC2 (supervisor 港进 TS): 8 张 registry 表 → DRIVER_KINDS 单一数据表；run_supervisor → 可单测的
//     runSupervisor；status/liveness/start/stop/drain 变成可直接 import 的纯函数/IO 函数。Falsifiable:
//     supervisor 逻辑仍在 bash .sh 里 ⇒ 假。
//
// Run: scripts/test.sh plugin/test/driver-runtime.test.mjs

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/4 (11 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { aliveness, anchorHosts, assert, deadPid, fs, killIfAlive, makeGitWorktree, makeRoot, makeWorkerRoot, os, path, pollJsonFile, promotion, readAnchorState, readPid, run, spawn, worker, writeAnchorHostedRoot, writePidFile } from "./helpers/driver-runtime-harness.mjs";

test("gap-driver-status-misreports — 逐 kind pid 载体【陈旧/指向死 pid】而 anchor 托管它 ⇒ 仍报 alive=1", (t) => {
  const root = writeAnchorHostedRoot("stale", ["outer"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // AC5 点名的另一半夹具形态：文件在，但内容是**一个死 pid**（旧判据下 `driverPid === anchorPid` 为假
  // ⇒ 同样报假死）。
  writePidFile(path.join(root, ".quay", "outer-driver.pid"), Number(deadPid()));
  const a = aliveness(root, "outer");
  assert.equal(a.host, "anchor");
  assert.equal(a.running, true, "承载进程是活着的 anchor ⇒ 在跑");
  assert.deepEqual(a.deaths, [], "⛔ 不因那张陈旧文件报 driver_dead");
});


test("gap-driver-status-misreports — 负控制：未被 anchor 点名的 kind / 无活 anchor / 回读面读不到", (t) => {
  // ① 活 anchor 托管 [worker,outer]，但**没有**点名 goal ⇒ goal 走旧形态（⛔ 「down」必须仍可报出）。
  const rootA = writeAnchorHostedRoot("neg-unnamed", ["worker", "outer"]);
  t.after(() => fs.rmSync(rootA, { recursive: true, force: true }));
  const g = aliveness(rootA, "goal");
  assert.equal(g.host, "supervisor", "未被点名 ⇒ host=supervisor（legacy 形态）");
  assert.equal(g.running, false, "未被点名 ⇒ 不报在跑");
  assert.equal(anchorHosts(rootA, "goal").hosted, false);

  // ② anchor.pid 指向一个**死进程**：回读面照样点名了，⛔ 但不得据此报「在跑」（自报不足以制造托管）。
  const rootB = writeAnchorHostedRoot("neg-deadanchor", ["worker"], { anchorPid: Number(deadPid()) });
  t.after(() => fs.rmSync(rootB, { recursive: true, force: true }));
  const w = aliveness(rootB, "worker");
  assert.equal(w.host, "supervisor", "anchor 死 ⇒ 回落 legacy 形态，⛔ 不报 anchor");
  assert.equal(w.anchorPid, null);
  assert.equal(w.running, false, "anchor 死 ⇒ 不报在跑");

  // ③ 回读面缺失（旧 anchor / 换代窗口）⇒ 兼容回退到逐 kind pid 载体那条旧判据（⛔ 读不懂 ⇒ 不报死亡）。
  const rootC = writeAnchorHostedRoot("neg-nostate", ["promotion"], { state: false });
  t.after(() => fs.rmSync(rootC, { recursive: true, force: true }));
  assert.equal(readAnchorState(rootC), null, "回读面缺失 ⇒ null（三态，⛔ 不是 kinds:[]）");
  writePidFile(path.join(rootC, ".quay", "promotion-driver.pid"), process.pid);
  assert.equal(anchorHosts(rootC, "promotion").hosted, true, "回退判据：载体写着活 anchor 的 pid");
  // ④ 回读面**换代**（其 pid 与 anchor.pid 对不上）⇒ 不采信它的 kinds（那是上一代 anchor 的名单）。
  fs.writeFileSync(
    path.join(rootC, ".quay", "anchor.json"),
    JSON.stringify({ pid: 999999, kinds: ["worker"], host: "anchor" }) + "\n",
    "utf8",
  );
  assert.equal(anchorHosts(rootC, "worker").hosted, false, "换代的回读面不采信");
});


test("gap-driver-status-misreports — AC2 交叉核对：`status --json` 同时给出 host/alive 与独立的载体新鲜度直接量", (t) => {
  const root = makeRoot("anchorhosted");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const q = path.join(root, ".quay");
  fs.mkdirSync(q, { recursive: true });
  fs.writeFileSync(path.join(q, "anchor.pid"), `${process.pid}\n`, "utf8");
  fs.writeFileSync(
    path.join(q, "anchor.json"),
    JSON.stringify({ pid: process.pid, kinds: ["promotion"], host: "anchor" }) + "\n",
    "utf8",
  );
  // 载体新鲜度 = **独立于 anchor 自报**的直接量（AC2 要求以它交叉核对 host/alive，⛔ 不是只信内部状态）。
  fs.writeFileSync(
    path.join(q, "promotion-round.jsonl"),
    JSON.stringify({ ts: new Date().toISOString(), runId: "dr-anchorhosted" }) + "\n",
    "utf8",
  );
  // ⛔ 夹具不写 .quay/promotion-driver.pid —— 逐 kind 载体缺失正是本缺陷的触发形态。
  const r = run(["status", "--root", root, "--kind", "promotion", "--json"]);
  assert.equal(r.status, 0, `status exit 0: ${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(r.stdout.split("\n").find((l) => l.trim().startsWith("{")));
  assert.equal(j.host, "anchor", "JSON 契约：host=anchor");
  assert.equal(j.anchor_pid, process.pid);
  assert.equal(j.alive, 1, "JSON 契约：alive=1");
  assert.equal(j.running, 1, "JSON 契约：running=1");
  // ⚠️ server.ts 用 `driver_alive !== 1` 判「这个 kind 的循环没在转」⇒ 这个字段必须同修，否则只是把假死
  // 从一个字段搬到另一个（packages/quay/src/cli/server.ts 的 driverServiceReport）。
  assert.equal(j.driver_alive, 1, "JSON 契约：driver_alive=1（server status 的消费点）");
  assert.ok(Math.abs(Date.now() - Date.parse(j.last_record_ts)) < 60_000, "载体新鲜度直接量可读（交叉核对面）");
});

// ── 集成（spawn kernel CLI，与旧 promotion-driver-launch.sh 同形的端到端）────────────────────────


test("AC1 (稳定承载) — start from a worktree ⇒ supervisor/driver carried from MAIN checkout, ⛔ worktree", (t) => {
  const { main, wt } = makeGitWorktree();
  t.after(() => {
    run(["stop", "--root", main], { timeout: 15000 });
    fs.rmSync(main, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  });

  const start = run(["start", "--root", wt, "--restart-delay", "1", "--run-id", "dr-ac1"], { pluginRoot: path.join(main, "plugin") });
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  assert.match(start.stderr, /relocating/, `relocation announced on stderr: ${start.stderr}`);

  // supervisor pid file landed in the MAIN checkout's .quay, ⛔ not the worktree's.
  assert.ok(fs.existsSync(path.join(main, ".quay", "promotion-driver-supervisor.pid")),
    "supervisor pid file lives in the MAIN checkout");
  assert.ok(!fs.existsSync(path.join(wt, ".quay", "promotion-driver-supervisor.pid")),
    "no supervisor pid file in the worktree");

  // supervisor cmdline = the kernel path (⛔ contains NO worktree path).
  const spid = fs.readFileSync(path.join(main, ".quay", "promotion-driver-supervisor.pid"), "utf8").trim();
  const cmdline = fs.readFileSync(`/proc/${spid}/cmdline`, "utf8").replace(/\0/g, " ");
  assert.ok(cmdline.includes("driver-runtime.ts"), `supervisor cmdline = TS kernel:\n${cmdline}`);
  assert.ok(cmdline.includes("__supervise"), `supervisor mode in cmdline:\n${cmdline}`);
  assert.ok(!cmdline.includes(wt), `cmdline carries NO worktree path (falsifiable):\n${cmdline}`);
});


test("AC2 (死亡告警) — stale supervisor pid ⇒ liveness DEATH + exit 1 + durable log", (t) => {
  const root = makeRoot("ac2");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, ".quay", "promotion-driver-supervisor.pid"), String(deadPid()), "utf8");

  const r = run(["liveness", "--root", root, "--json"]);
  assert.equal(r.status, 1, `dead supervisor ⇒ exit 1, got ${r.status}`);
  const json = JSON.parse(r.stdout.trim());
  assert.equal(json.running, 0);
  assert.match(json.deaths, /supervisor_dead/, `deaths names supervisor_dead: ${json.deaths}`);
  assert.equal(json.supervisor_alive, 0);

  const log = fs.readFileSync(path.join(root, ".quay", "promotion-driver-liveness.log"), "utf8");
  assert.match(log, /DEATH deaths=supervisor_dead/, `durable DEATH line written:\n${log}`);
});


test("AC2 positive — live supervisor+driver ⇒ liveness exit 0 + deaths=none", (t) => {
  const root = makeRoot("ac2-pos");
  t.after(() => {
    run(["stop", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-ac2pos"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  assert.ok(readPid(root, "promotion-driver-supervisor.pid"), "supervisor pid written");
  assert.ok(readPid(root, "promotion-driver.pid"), "driver pid written");

  const r = run(["liveness", "--root", root, "--json"]);
  assert.equal(r.status, 0, `healthy ⇒ exit 0, got ${r.status}: ${r.stdout}`);
  const json = JSON.parse(r.stdout.trim());
  assert.equal(json.running, 1);
  assert.equal(json.deaths, "none");
});


test("AC3 (supervisor 死) — kill -9 supervisor ⇒ supervisor_dead + orphan driver not 'running'", async (t) => {
  const root = makeRoot("ac3");
  const spid = () => readPid(root, "promotion-driver-supervisor.pid");
  const dpid = () => readPid(root, "promotion-driver.pid");
  t.after(() => {
    killIfAlive(dpid());
    killIfAlive(spid());
    fs.rmSync(root, { recursive: true, force: true });
  });

  const start = run(["start", "--root", root, "--restart-delay", "1", "--run-id", "dr-ac3"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(start.status, 0, `start failed: ${start.stdout}\n${start.stderr}`);
  const supervisorPid = spid();
  assert.ok(supervisorPid, "supervisor pid recorded");

  const before = JSON.parse(run(["liveness", "--root", root, "--json"]).stdout.trim());
  assert.equal(before.running, 1, "running=1 before the kill");

  process.kill(Number(supervisorPid), "SIGKILL");

  let deaths = "";
  let running = -1;
  for (let i = 0; i < 50; i++) {
    const json = JSON.parse(run(["liveness", "--root", root, "--json"]).stdout.trim());
    deaths = json.deaths;
    running = json.running;
    if (/supervisor_dead/.test(deaths) && running === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert.match(deaths, /supervisor_dead/, `(a) supervisor_dead reported: ${deaths}`);
  assert.equal(running, 0, "(b) running=0 after supervisor death — orphan driver not 'in service'");
  assert.match(deaths, /driver_orphaned/, `orphan driver explicitly named: ${deaths}`);
});


test("AC138-3 — status --kind worker reads ALL carriers; last_record_ts = max", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-ac138-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "worker-driver.ts"), "", "utf8");
  fs.writeFileSync(path.join(root, ".quay", "worker-outcome.jsonl"), '{"ts":"2026-08-23T10:00:00Z","task":"a","final_state":"completed"}\n', "utf8");
  fs.writeFileSync(path.join(root, ".quay", "worker-round.jsonl"), '{"ts":"2026-08-23T10:00:00Z","round":1}\n{"ts":"2026-08-23T11:30:00Z","round":2}\n', "utf8");

  const st = JSON.parse(run(["status", "--kind", "worker", "--root", root, "--json"]).stdout.trim());
  assert.equal(st.carrier_records, 3, `both carriers summed: ${JSON.stringify(st)}`);
  assert.equal(st.last_record_ts, "2026-08-23T11:30:00Z", `max across BOTH carriers: ${JSON.stringify(st)}`);
  assert.match(st.carrier_path, /worker-outcome\.jsonl$/, "primary carrier is outcome");
});


test("AC1 (worker cap) — start --kind worker --cap 2 ⇒ driver argv carries --concurrency 2", async (t) => {
  const root = makeWorkerRoot("cap2");
  t.after(() => {
    run(["stop", "--kind", "worker", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const r = run(["restart", "--kind", "worker", "--cap", "2", "--root", root, "--restart-delay", "1", "--run-id", "dr-wac1"], { pluginRoot: path.join(root, "plugin") });
  assert.equal(r.status, 0, `restart failed: ${r.stdout}\n${r.stderr}`);
  assert.ok(!/unknown argument: --concurrency/.test(r.stderr), `supervisor self-restart must accept --cap: ${r.stderr}`);
  const dump = await pollJsonFile(path.join(root, ".quay", "worker-argv-dump.json"));
  assert.ok(dump, "worker driver dumped its argv");
  assert.ok(dump.argv.includes("--concurrency") && dump.argv.includes("2"), `driver argv carries --concurrency 2: ${JSON.stringify(dump.argv)}`);
});


test("AC2 (worker 并发缺省) — start --kind worker with NO --cap ⇒ supervisor 不注入 env、不传 --concurrency（driver 自读 drivers.yml）", async (t) => {
  const root = makeWorkerRoot("capdef");
  t.after(() => {
    run(["stop", "--kind", "worker", "--root", root], { timeout: 15000 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  // AC155：supervisor 不再注入 QUAY_MAX_TASK_SUBAGENTS="5"（旧第三份并发真相源）——缺省并发由 driver
  // 自己经 driver-config 读 drivers.yml（resolveConcurrency → driverCap 单一真相源）。剥掉环境里已有的
  // QUAY_MAX_TASK_SUBAGENTS 使本测对「supervisor 是否注入」敏感（旧行为注入 "5" ⇒ 本测 FAIL，⛔ 防假绿）。
  const env = { ...process.env };
  delete env.QUAY_MAX_TASK_SUBAGENTS;
  const r = run(["start", "--kind", "worker", "--root", root, "--restart-delay", "1", "--run-id", "dr-wac2"], { env, pluginRoot: path.join(root, "plugin") });
  assert.equal(r.status, 0, `start failed: ${r.stdout}\n${r.stderr}`);
  const dump = await pollJsonFile(path.join(root, ".quay", "worker-argv-dump.json"));
  assert.ok(dump, "worker driver dumped its argv/env");
  assert.equal(dump.capEnv, null, `supervisor must NOT inject QUAY_MAX_TASK_SUBAGENTS (driver resolves cap from drivers.yml itself): ${JSON.stringify(dump)}`);
  assert.ok(!dump.argv.includes("--concurrency"), `default resolved by driver from drivers.yml, not an explicit flag: ${JSON.stringify(dump.argv)}`);
});

// ── negative control（gap-driver-test-fixture-json-read-before-write-complete-race AC3）────────────
// 故意制造 "文件存在但内容未写完" 的中间态：旧的 existsSync-then-JSON.parse 读法会报错，新的
// pollJsonFile 会把它当 "还没写完" 继续轮询，最终读到完整内容。


test("negative control — pollJsonFile waits through a torn (exists-but-partial) JSON file instead of a fatal parse error", async (t) => {
  const root = makeWorkerRoot("nc-torn");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = path.join(root, ".quay", "worker-argv-dump.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });

  // (a) 旧逻辑（existsSync → JSON.parse）在中间态报错——先证负控制非空（旧读法确实会撞竞态）。
  fs.writeFileSync(p, '{"argv":["--concurrency"', "utf8");
  assert.throws(() => JSON.parse(fs.readFileSync(p, "utf8")), "old existsSync-then-JSON.parse read throws on a torn file");

  // (b) 新逻辑在中间态继续轮询，等写入方补完内容后读到完整 JSON。
  const complete = { argv: ["--concurrency", "2"], capEnv: null };
  const finish = new Promise((resolve) => setTimeout(() => {
    fs.writeFileSync(p, JSON.stringify(complete), "utf8");
    resolve();
  }, 60));
  const dump = await pollJsonFile(p, 2000, 10);
  await finish;
  assert.deepEqual(dump, complete, "poller waited through the torn state and read the completed file");
});

// ── source-refresh（AC-184 陈旧写者收尾）：supervisor 在源码推进到 driver 启动时刻之后重拉 driver ──
// 判据（AC）：`node --experimental-strip-types --test plugin/test/driver-runtime.test.mjs` 里，下面的
// 集成测试证明 supervisor 在 driver-filters.ts 推进到运行中 driver 之后 respawn 该 driver——常驻 driver
// 因此自刷新，AC-184 不再每提交一次就陈旧写者复发。判据取假（DoD）：删掉 runSupervisor 里的 sourceCheck
// 对照 ⇒ 源码推进后 pid 永不变 ⇒ 集成测试红。
