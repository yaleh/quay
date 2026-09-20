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

// SPLIT from driver-runtime.test.mjs by gap-suite-split-15-over-30s-test-files — shard 3/10 (5 tests). Shared fixtures: ./helpers/driver-runtime-harness.mjs (single source).

import { test } from "node:test";
import { aliveness, anchorHosts, assert, deadPid, fs, makeRoot, os, path, pidAlive, promotion, readAnchorState, readPidFile, run, spawn, worker, writeAnchorHostedRoot, writePidFile } from "./helpers/driver-runtime-harness.mjs";

test("AC2 — pidAlive / readPidFile / aliveness (death direct-quantity, ⛔ not carrier-stall)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dr-alive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(pidAlive(deadPid()), false, "dead pid ⇒ not alive");
  assert.equal(pidAlive(process.pid), true, "self pid ⇒ alive");
  // ── pidalive-eperm-opposite 的回归钉（routine `semantic-dedup-scan`，runId
  //    `semantic-dedup-scan-1789889905875`）：driver 侧的探针必须把 EPERM 读成 ALIVE。
  //    修前本文件 import 到的正是那份**唯一**把 EPERM 读成 DEAD 的副本（另外三份读成 ALIVE），
  //    于是 driver-runtime 里两处「保护外来活进程」的函数（`rmCarrierUnlessForeignLive` /
  //    `stopLegacyPair`）恰好被自己的探针反制。**在这里钉住，⛔ 不靠下一次扫描再发现。**
  assert.equal(pidAlive(String(process.pid)), true, "pid 载体读出来是**文本** ⇒ 也要真去探，⛔ 不读成 DEAD");
  // 非 root 主机上 `kill(1, 0)` 抛 EPERM（exists-but-not-ours）⇒ 这一支才是判别支。
  let epermReachable = false;
  try { process.kill(1, 0); } catch (err) { epermReachable = err?.code === "EPERM"; }
  assert.equal(pidAlive(1), true, "EPERM / 成功都意味着「pid 1 存在」⇒ ALIVE，⛔ 不是 DEAD");
  if (!epermReachable) {
    // 硬规则 3b：宿主给不出 EPERM 时，上面那条断言只走成功支、**没有判别力** —— 明说，⛔ 不静默当通过。
    t.diagnostic("pidAlive EPERM 支未被本宿主触发（kill(1,0) 未抛 EPERM，多半是以 root 跑）——上一条断言本次未起到判别作用");
  }
  assert.equal(readPidFile(path.join(root, ".quay", "missing.pid")), "", "missing ⇒ empty");
  writePidFile(path.join(root, ".quay", "promotion-driver-supervisor.pid"), Number(deadPid()));
  const a = aliveness(root, "promotion");
  assert.equal(a.supervisorAlive, false);
  assert.deepEqual(a.deaths, ["supervisor_dead"], "stale supervisor pid ⇒ supervisor_dead");
});



test("gap-driver-status-misreports — anchor-hosted kind with NO per-kind pid carrier ⇒ host=anchor & alive=1（⛔ 不报假死）", (t) => {
  const root = writeAnchorHostedRoot("nofile", ["worker", "outer", "promotion"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // ⚠️ 夹具的关键：**故意不写** `.quay/<kind>-driver.pid`（旧判据正是读它 ⇒ 旧代码在这里必然报假死）。
  assert.equal(fs.existsSync(path.join(root, ".quay", "worker-driver.pid")), false, "夹具：逐 kind pid 载体确实不存在");

  for (const kind of ["worker", "outer", "promotion"]) {
    assert.equal(readAnchorState(root)?.kinds.includes(kind), true, `${kind}: 回读面点名了它`);
    assert.equal(anchorHosts(root, kind).hosted, true, `${kind}: anchorHosts ⇒ hosted`);
    const a = aliveness(root, kind);
    assert.equal(a.host, "anchor", `${kind}: host=anchor`);
    assert.equal(a.anchorPid, process.pid, `${kind}: anchor_pid`);
    assert.equal(a.driverPid, process.pid, `${kind}: 承载进程 = anchor（⛔ 不是「pid 载体里碰巧写了谁」）`);
    assert.equal(a.driverAlive, true, `${kind}: driver_alive=1`);
    assert.equal(a.running, true, `${kind}: running=1`);
    assert.equal(a.supervisorAlive, false, `${kind}: 阶段 C 无 supervisor`);
    assert.deepEqual(a.deaths, [], `${kind}: ⛔ 不得报任何死因`);
  }
});


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
