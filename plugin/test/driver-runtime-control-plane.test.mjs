// @test-group lowconc
// driver-runtime-control-plane.test.mjs — GOAL-017/AC-252
// (tasks/gap-ac252-control-plane-hoist-to-layer0): 控制面上收进 Layer 0 —— 六个 kind 全部从共享骨架获得
// 入站控制面（SPEC-unified-quay-server §7 阶段 A1）。
//
// 背景（立案当轮实测）：serveControlPlane 的实现早在 driver-shared.ts 一份（AC150-3），但**调用点**只有
// worker-driver.ts 一处 ⇒ 另外五个 kind 结构上拿不到入站控制面。AC-252 的 criterion 只测**位置**（Layer 0
// 有调用点 ∧ worker 不再自带），⛔ 不测「六个 kind 各自可达」——把一个调用塞进 driver-runtime.ts 的私有
// 分支就能让判据 exit 0 而意图未达成。本文件补的正是判据覆盖不到的那一层：
//
//   AC2 (六个 kind 各自可达 + 结构控制): `serveKindControlPlane` 是 driver-runtime.ts 的导出；六个 kind
//     各起一次 `port:0` ⇒ 六个非零且互不相同的端口。**结构断言** = 宿主完全由 `DRIVER_KINDS` 派生：
//     加一个假 kind 条目（仅测试内内存构造）即自动获得控制面、且写它自己的控制态文件，**未改任何 kind
//     文件**；再把该条目的 controlFile 改名 ⇒ 落点跟着改（证明是读 registry 而不是另一张硬编码表）。
//   AC3 (逐 kind 负控制): 对某 kind 发 halt ⇒ ① 只有它自己的控制态文件变（`halted:true` ∧ `halted_by`
//     为发出的身份）；② 其余五个控制态文件 sha256 前后逐字相同；③ 复原（`halted:false`）后逐字节回原状。
//     这是 `rel` 传错（回落 serveControlPlane 的缺省 = worker 的）唯一的机械检出。
//   AC4 (判停真被消费): 在**独立一次性 driver**（临时 root 上的真实 worker-driver 常驻进程，⛔ 不是生产
//     driver）上：halt 前其 round 记录持续推进；经控制面 halt 后，其下一轮 `stop_reason` 为 `mcp-halt`
//     （Layer 0 makeStopCondition 的既有判词）且进程退出。

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  DRIVER_KINDS,
  KNOWN_KINDS,
  kernelSelfPath,
  serveKindControlPlane,
  statePaths,
} from "../scripts/driver-runtime.ts";
import { defaultControlState, writeControlState, readControlState } from "../scripts/driver-shared.ts";
import {
  makeRoot,
  readRoundLines,
  rmSafe,
  spawnResident,
  stopAllResidentDrivers,
  waitFor,
} from "./helpers/worker-driver-harness.mjs";

// ── 工具 ───────────────────────────────────────────────────────────────────────────────────────────

/** 该 kind 的控制态文件（相对 root 的路径）——判据与被测机件共用同一派生规则（DRIVER_KINDS）。 */
function kindRel(kind) {
  const spec = DRIVER_KINDS[kind];
  assert.ok(spec, `DRIVER_KINDS has an entry for ${kind}`);
  return path.posix.join(".quay", spec.controlFile);
}

/** 文件 sha256；不存在 ⇒ null（「没有该文件」与「文件为空」可区分）。 */
function sha256(file) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

/** 经 MCP 控制面调一个工具（每调用一个新会话，与 worker-driver.test.mjs 的 AC3(HTTP) 同手法）。 */
async function callTool(url, name, args, headers) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : undefined,
  );
  const client = new Client({ name: "ac252-control-plane-test", version: "0.0.1" });
  await client.connect(transport);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}

// ── AC2 · 六个 kind 各自可达（端口互不相同）──────────────────────────────────────────────────────

test("AC2 — serveKindControlPlane is a Layer 0 (driver-runtime.ts) export; the six kinds each get a distinct non-zero port", async (t) => {
  const root = makeRoot("ac252-ports");
  const handles = [];
  t.after(async () => {
    for (const h of handles) await h.close();
    rmSafe(root);
  });

  assert.equal(KNOWN_KINDS.length, 6, "六个 kind（promotion/worker/outer/quality/meta/goal）");
  assert.equal(typeof serveKindControlPlane, "function", "Layer 0 导出（AC-252 的调用点宿主）");

  const ports = {};
  const urls = {};
  for (const kind of KNOWN_KINDS) {
    const h = await serveKindControlPlane(kind, root, { port: 0 });
    handles.push(h);
    ports[kind] = h.port;
    urls[kind] = h.url;
    assert.ok(Number.isInteger(h.port) && h.port > 0, `${kind}: port:0 ⇒ 内核分配的非零端口（读回 ${h.port}）`);
    assert.match(h.url, new RegExp(`:${h.port}$`), `${kind}: url 与 port 一致`);
  }

  // 取假形态：写死固定端口必然六 kind 互撞 ⇒ 这一条是「端口不撞」的机械检出。
  assert.equal(
    new Set(Object.values(ports)).size,
    6,
    `六个互不相同的端口（实测 ${JSON.stringify(ports)}）`,
  );

  // 逐 kind 的 URL/端口读数（AC2/AC6 回读面）。
  console.log(`AC2 ports: ${JSON.stringify(ports, null, 2)}`);
  console.log(`AC2 urls: ${JSON.stringify(urls, null, 2)}`);
});

// ── AC2 · 结构断言：宿主由 DRIVER_KINDS 派生（新 kind 不改任何 kind 文件即获得控制面）─────────────

test("AC2 (structural) — the host is DRIVER_KINDS-driven: an in-memory registry row is sufficient, no kind file involved", async (t) => {
  const root = makeRoot("ac252-struct");
  const handles = [];
  const FAKE = "ac252-fake-kind";
  t.after(async () => {
    for (const h of handles) await h.close();
    delete DRIVER_KINDS[FAKE];
    rmSafe(root);
  });

  // 仅【内存构造】一条 registry 条目 —— ⛔ 不新建任何 driver .ts / 不改任何 kind 文件。
  DRIVER_KINDS[FAKE] = {
    driver: "ac252-fake-driver.ts",
    prefix: "ac252-fake",
    verbs: ["start"],
    capFlag: "",
    hasInterval: false,
    hasReconcile: false,
    pidSelf: true,
    runPrefix: "fk-prod",
    carriers: ["ac252-fake-round.jsonl"],
    controlFile: "ac252-fake-control.json",
  };

  const h = await serveKindControlPlane(FAKE, root, { port: 0 });
  handles.push(h);
  assert.ok(h.port > 0, "加一行 registry 即获得控制面（⛔ 不需要改任何 kind 文件）");

  const halted = await callTool(h.url, "halt", { halted: true, caller: "manager" });
  assert.equal(halted.isError, undefined, "假 kind 的控制面可被调用");
  assert.equal(
    readControlState(root, {}, kindRel(FAKE)).state.halted,
    true,
    "落点是【假 kind 自己的】控制态文件",
  );
  // 取假：若 rel 回落到 serveControlPlane 的缺省（= worker 的），这条会抓出来。
  assert.equal(
    fs.existsSync(path.join(root, ".quay", "worker-control.json")),
    false,
    "⛔ 未回落 worker 的控制态文件（缺省 rel 的恒假形态）",
  );

  // 再证「读的是同一张 registry，而不是另一张硬编码表」：改 registry 一行的 controlFile ⇒ 落点跟着改。
  DRIVER_KINDS[FAKE].controlFile = "ac252-fake-control-moved.json";
  const h2 = await serveKindControlPlane(FAKE, root, { port: 0 });
  handles.push(h2);
  await callTool(h2.url, "halt", { halted: true, caller: "manager" });
  assert.equal(
    sha256(path.join(root, ".quay", "ac252-fake-control-moved.json")) !== null,
    true,
    "registry 行改名 ⇒ 控制面落点跟着改（派生自 DRIVER_KINDS，⛔ 非第二张表）",
  );
});

// ── AC2 · 读不懂入参不得与「合格」同形 ────────────────────────────────────────────────────────────

test("AC2 — unknown kind fails closed (⛔ no silent fallback to the worker default rel)", async () => {
  await assert.rejects(
    () => serveKindControlPlane("ac252-no-such-kind", "/tmp/ac252-nonexistent", { port: 0 }),
    /unknown driver kind/,
    "未知 kind ⇒ 抛（硬规则 3b：读不懂输入不得返回与合格同形的值）",
  );
});

// ── AC3 · 逐 kind 负控制（halt 只停该 kind）──────────────────────────────────────────────────────

test("AC3 — halting one kind touches ONLY its own control-state file (the other five stay byte-identical)", async (t) => {
  const root = makeRoot("ac252-negctl");
  const handles = {};
  t.after(async () => {
    for (const kind of KNOWN_KINDS) await handles[kind]?.close();
    rmSafe(root);
  });

  // 预置六个 kind 的缺省控制态文件 ⇒ sha256 对照对称（halt → 复原 应逐字节回到原状）。
  for (const kind of KNOWN_KINDS) writeControlState(root, defaultControlState(), kindRel(kind));
  const before = Object.fromEntries(
    KNOWN_KINDS.map((kind) => [kind, sha256(path.join(root, kindRel(kind)))]),
  );
  for (const kind of KNOWN_KINDS) assert.ok(before[kind], `${kind}: 预置的控制态文件可读`);

  for (const kind of KNOWN_KINDS) handles[kind] = await serveKindControlPlane(kind, root, { port: 0 });

  const readings = {};
  for (const kind of KNOWN_KINDS) {
    // ① halt（经该 kind 自己的控制面，带身份）
    const res = await callTool(handles[kind].url, "halt", { halted: true, caller: "manager" });
    assert.equal(res.isError, undefined, `${kind}: 带身份 caller=manager ⇒ 放行`);
    const st = readControlState(root, {}, kindRel(kind)).state;
    assert.equal(st.halted, true, `${kind}: halted:true`);
    assert.equal(st.halted_by, "manager", `${kind}: halted_by 为发出的身份`);

    // ② 其余五个 kind 的控制态文件 sha256 前后逐字相同
    const after = Object.fromEntries(
      KNOWN_KINDS.map((k) => [k, sha256(path.join(root, kindRel(k)))]),
    );
    for (const other of KNOWN_KINDS) {
      if (other === kind) continue;
      assert.equal(
        after[other],
        before[other],
        `${kind} 的 halt ⛔ 不得触碰 ${other} 的控制态文件（rel 传错的唯一机械检出）`,
      );
    }
    assert.notEqual(after[kind], before[kind], `${kind}: 它自己的控制态文件确实变了`);

    // ③ 复原后复归原状（逐字节）
    const back = await callTool(handles[kind].url, "halt", { halted: false, caller: "manager" });
    assert.equal(back.isError, undefined, `${kind}: 复原调用放行`);
    assert.equal(readControlState(root, {}, kindRel(kind)).state.halted, false, `${kind}: 复原 halted:false`);
    assert.equal(
      sha256(path.join(root, kindRel(kind))),
      before[kind],
      `${kind}: 复原后逐字节回到原状`,
    );

    readings[kind] = {
      url: handles[kind].url,
      port: handles[kind].port,
      control_file: kindRel(kind),
      halted_sha256: after[kind],
      restored_sha256: before[kind],
    };
  }

  console.log(`AC3 readings: ${JSON.stringify(readings, null, 2)}`);
});

// ── AC4 · 判停真被消费（独立一次性 driver，⛔ 不停生产进程）──────────────────────────────────────
// 判据来源（AC4 逐字）：「在独立一次性 driver（测试缝 / 临时 root 起的该 kind 进程，⛔ 不是生产 driver）
// 上，halt 前该 kind 的 round 记录持续推进、halt 后其下一轮 stop_reason 为 mcp-halt（Layer 0
// makeStopCondition 的既有判词）」。
//
// ⚠️ 残留（显式登记，⛔ 不静默跳过，硬规则 3b）：本 AC 只在 **worker** kind 上端到端取到读数。另外五个
// kind 的**判停消费侧**同样经 isHalted(root, env, <KIND>_CONTROL_STATE_REL) 读同一族控制态文件（它们的
// 常驻循环会在测试缝里真跑 goal/quality/meta 的 LLM 与 criterion、promotion 会真 apply 到任务库，⛔ 不可
// 在单测里安全起）⇒ 它们的证据由 AC3 的控制态读数替代（同一份控制态文件、同一个 isHalted）。见任务体
// 结果段的残留登记。

// ── AC2/AC4 · 生产路径：六个 kind 的 **supervisor** 各自起自己的控制面 ────────────────────────────
// 上一条是【宿主函数】层面的六 kind 可达（AC2 判据的逐字形态）。这一条走**生产路径**：六个 kind
// 各自的 supervisor（`driver-runtime.ts __supervise`，`startKind` 为每个 kind 起的那一个）分别起一次，
// 断言 ① 逐 kind 的运行时回读面（`.quay/<prefix>-control-plane.json`）出现且端口非零、互不相同；
// ② rel 派生自 DRIVER_KINDS（⛔ 非 worker 的缺省）；③ 服务进程 pid = supervisor 自己的 pid（PROOF：控制面
// 宿主在 Layer 0 进程里，⛔ 不是 driver 私产）；④ 经每个 supervisor 的控制面 halt，只落它自己的控制态文件。
//
// ⚠️ **唯一的测试缝**：`QUAY_PLUGIN_ROOT` 指向一个假 plugin root，里面六个 driver 都是 no-op —— 控制面
// **不依赖 driver**（它由 supervisor 起、写控制态文件），所以这个缝不改变被测性质；它只是避免在单测里真跑
// goal/quality/meta 的例程与 LLM（那些 kind 的常驻循环在临时 root 里跑起来没有测试价值，只有副作用）。
test("AC2/AC4 (production path) — every kind's supervisor hosts its OWN control plane (distinct ports, registry-derived rel, pid = supervisor)", async (t) => {
  const root = makeRoot("ac252-sup6");
  const fakePlugin = path.join(root, "fakeplugin");
  fs.mkdirSync(path.join(fakePlugin, "scripts"), { recursive: true });
  for (const kind of KNOWN_KINDS) {
    // no-op driver（忽略 argv）：控制面与 driver 无关，缝只在这里。
    fs.writeFileSync(path.join(fakePlugin, "scripts", DRIVER_KINDS[kind].driver), "process.exit(0);\n", "utf8");
  }

  const spawned = [];
  t.after(async () => {
    for (const s of spawned) {
      try { process.kill(-s.pid, "SIGKILL"); } catch { /* gone */ }
      try { s.kill("SIGKILL"); } catch { /* gone */ }
    }
    await stopAllResidentDrivers();
    rmSafe(root);
  });

  for (const kind of KNOWN_KINDS) {
    const sup = spawn(
      process.execPath,
      [
        "--no-warnings", "--experimental-strip-types", kernelSelfPath(), "__supervise",
        "--kind", kind, "--root", root, "--restart-delay", "600", "--run-id", `ac252-sup-${kind}`,
      ],
      { stdio: ["ignore", "ignore", "ignore"], detached: true, env: { ...process.env, QUAY_PLUGIN_ROOT: fakePlugin } },
    );
    spawned.push(sup);
  }

  const readCp = (kind) => {
    const f = statePaths(root, kind).controlPlaneFile;
    if (!fs.existsSync(f)) return null;
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
  };
  const ready = await waitFor(() => KNOWN_KINDS.every((k) => (readCp(k)?.port ?? 0) > 0), 30000);
  assert.ok(ready, `六个 kind 的 supervisor 都起了控制面（实测：${JSON.stringify(KNOWN_KINDS.map((k) => [k, readCp(k)?.port ?? null]))}）`);

  const started = {};
  for (let i = 0; i < KNOWN_KINDS.length; i++) {
    const kind = KNOWN_KINDS[i];
    const cp = readCp(kind);
    assert.equal(cp.kind, kind, `${kind}: 回读面的 kind 自述`);
    assert.equal(cp.rel, kindRel(kind), `${kind}: rel 派生自 DRIVER_KINDS（⛔ 非 worker 的缺省）`);
    assert.equal(cp.pid, spawned[i].pid, `${kind}: 控制面宿主 = supervisor 进程本身（Layer 0，⛔ 非 driver 私产）`);
    started[kind] = cp;
  }
  const ports = Object.fromEntries(KNOWN_KINDS.map((k) => [k, started[k].port]));
  assert.equal(new Set(Object.values(ports)).size, 6, `六个 supervisor 控制面端口互不相同：${JSON.stringify(ports)}`);
  console.log(`AC2 (supervisor path) ports: ${JSON.stringify(ports, null, 2)}`);

  // 逐 kind 经【supervisor 的控制面】halt/复原：只有它自己的控制态文件变（与 AC3 同一形态，但走生产宿主）。
  for (const kind of KNOWN_KINDS) {
    const others = KNOWN_KINDS.filter((k) => k !== kind);
    const before = Object.fromEntries(others.map((k) => [k, sha256(path.join(root, kindRel(k)))]));
    const res = await callTool(started[kind].url, "halt", { halted: true, caller: "manager" });
    assert.equal(res.isError, undefined, `${kind}: supervisor 控制面接受带身份的 halt`);
    const st = readControlState(root, {}, kindRel(kind)).state;
    assert.equal(st.halted, true, `${kind}: halted:true`);
    assert.equal(st.halted_by, "manager", `${kind}: halted_by 为发出的身份`);
    for (const other of others) {
      assert.equal(sha256(path.join(root, kindRel(other))), before[other], `${kind} 的 halt ⛔ 不得触碰 ${other} 的控制态文件`);
    }
    await callTool(started[kind].url, "halt", { halted: false, caller: "manager" });
    assert.equal(readControlState(root, {}, kindRel(kind)).state.halted, false, `${kind}: 复原`);
  }
});

test("AC4 — a one-shot resident worker driver consumes the halt: next round records stop_reason=mcp-halt", async (t) => {
  const root = makeRoot("ac252-consume");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:[],pool:0}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  // after 钩里先停 driver（幂等、有 2s 上限）再删 root；stopAllResidentDrivers 是 after 钩抛错跳过后续
  // 钩子时的兜底（helpers 头注释）。
  t.after(async () => {
    await drv.stop();
    await stopAllResidentDrivers();
    rmSafe(root);
  });

  // ① halt 前：round 记录持续推进（≥2 轮）——证明这条读数来自一个【真在跑】的常驻循环，
  //    ⛔ 不是一个已经在停的进程（硬规则 4b：判「在干活」要看直接量）。
  const advanced = await waitFor(() => {
    const rs = readRoundLines(root);
    return rs.length >= 2 && rs.some((r) => !r.stop_reason || /pool-empty/.test(String(r.stop_reason)));
  });
  assert.ok(advanced, "halt 前该 kind 的 round 记录持续推进（≥2 轮）");
  const beforeRounds = readRoundLines(root);
  const lastBefore = beforeRounds[beforeRounds.length - 1];
  console.log(`AC4 before-halt rounds: ${JSON.stringify(beforeRounds.map((r) => ({ round: r.round, action: r.action, stop_reason: r.stop_reason })), null, 2)}`);

  // ② 经该 kind 的 Layer 0 控制面发 halt（带身份）——这是六个 kind 共用的同一个宿主函数。
  const handle = await serveKindControlPlane("worker", root, { port: 0 });
  t.after(() => handle.close());
  const res = await callTool(handle.url, "halt", { halted: true, caller: "manager" });
  assert.equal(res.isError, undefined, "halt 经控制面被接受");

  // ③ halt 后：其下一轮 stop_reason 为 mcp-halt（Layer 0 makeStopCondition 的既有判词）
  const haltedRound = await waitFor(() => {
    const rs = readRoundLines(root);
    return rs.find((r) => typeof r.stop_reason === "string" && r.stop_reason.includes("mcp-halt"));
  });
  assert.ok(haltedRound, `halt 后下一轮 stop_reason 报 mcp-halt（实测轮次：${JSON.stringify(readRoundLines(root).map((r) => r.stop_reason))}）`);
  assert.ok(
    haltedRound.round > lastBefore.round,
    `mcp-halt 出现在 halt 之后的新一轮（before round=${lastBefore.round}，after round=${haltedRound.round}）`,
  );
  console.log(`AC4 after-halt round: ${JSON.stringify({ round: haltedRound.round, action: haltedRound.action, stop_reason: haltedRound.stop_reason }, null, 2)}`);

  // ④ 终态 latch ⇒ 常驻循环退出（过程真被消费，⛔ 不是只写了个文件）
  const exited = await waitFor(() => drv.child.exitCode !== null || drv.child.signalCode !== null);
  assert.ok(exited, "mcp-halt 是终态 ⇒ 常驻驱动退出（判停真被消费）");
});
