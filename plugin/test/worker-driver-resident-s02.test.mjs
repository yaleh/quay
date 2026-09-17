// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 2/8 (5 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, REPO_ROOT, WAIT_BASE_MS, after, applyHalt, assert, counterNodeE, defaultControlState, defaultReadyPoolArgv, defaultSelectorArgv, fs, makeGitRoot, makeRoot, path, readOutcomeLines, readRoundLines, resolveKernelScriptsDir, rmSafe, spawn, spawnResident, waitFor, writeControlState, writeTaskFile, writeTouchedTask } from "./helpers/worker-driver-resident-harness.mjs";

test("AC129 pure — defaultSelectorArgv / defaultReadyPoolArgv are launch / node argv", () => {
  const sel = defaultSelectorArgv(["gap-a", "gap-b"], REPO_ROOT);
  assert.equal(sel[0], "claude-fjdac", "AC140-1/L3: default selector resolves via policy to the profile launcher (not bare claude)");
  assert.equal(sel[sel.indexOf("-n") + 1], "quay-selector");
  assert.match(sel[sel.length - 1], /gap-a, gap-b/, "candidate ids are inlined into the selector prompt");
  const rpc = defaultReadyPoolArgv("/r", ["gap-a"], 3);
  assert.equal(rpc[0], "node");
  assert.deepEqual(rpc.slice(1, 5), ["--experimental-strip-types", path.join(resolveKernelScriptsDir(), "ready-pool-check.ts"), "--root", "/r"]);
  assert.ok(rpc.includes("--in-flight"), "in-flight ids are passed to ready-pool-check");
  assert.ok(rpc.includes("gap-a"));
});


test("AC2 — no --task ⇒ selection loop runs and selector_reason lands the selector's real reason (not 'explicit --task selection')", async (t) => {
  const root = makeGitRoot("ac2");
  writeTaskFile(root, "gap-a", "done");
  const rpcFile = path.join(root, "rpc.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-a','gap-b']:[],pool:n===0?2:0})"),
    "--selector-cmd", "node -e console.log('gap-a\\x20blocks-the-suite')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  // 一次完整派发（ready-pool/selector/worker 各 spawn 一个 node 子进程 + worker 落地含 git landing
  // 读）：上限走 waitFor 的宿主推导网（WAIT_BASE_MS × 当前抢占因子），⛔ 不再写死 ms
  // （gap-suite-wallclock-budgets-literals-depend-on-host-capacity）。
  await waitFor(() => readOutcomeLines(root).length >= 1);
  const picked = drv.events().find((e) => e.event === "selector-picked");
  assert.ok(picked, "the selection loop emitted a selector-picked event (AC2 chain is wired)");
  assert.equal(picked.task, "gap-a");
  assert.equal(picked.selector_reason, "blocks-the-suite");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "one worker dispatched; pool drains on the next loop");
  assert.equal(records[0].task, "gap-a");
  assert.equal(records[0].selector_reason, "blocks-the-suite", "AC2: selector_reason is the selector's own reason");
  assert.notEqual(records[0].selector_reason, "explicit --task selection", "AC2: no longer the constant explicit reason");
});


test("AC1 — resident loop does not exit after one worker; keeps dispatching while pool non-empty (in-memory in-flight subtraction)", async (t) => {
  const root = makeGitRoot("ac1");
  // gap-launch-script-worker-cap-broken AC3: the resident loop now reads each task's ## Touches to
  // filter Touches-overlapping candidates — so these fake ids need DISJOINT, COMMITTED Touches task
  // files (the loop's main-checkout observation must see a clean tree; a Touches-less file ⇒ conservative
  // serialize ⇒ gap-b dropped and the two-selection assertion fails).
  writeTouchedTask(root, "gap-a", "plugin/scripts/a.ts");
  writeTouchedTask(root, "gap-b", "plugin/scripts/b.ts");
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  // ready-pool returns BOTH candidates on calls 0 and 1 (it does NOT know gap-a went in-flight);
  // the DRIVER's in-memory subtraction is what makes the second fill pick gap-b. Call 2 ⇒ empty.
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n<=1?['gap-a','gap-b']:[],pool:n<=1?2:0})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first-pick':n===1?'gap-b\\x20second-pick':'gap-a\\x20again'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "2",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  // 两次完整派发+落地循环：上限走 waitFor 的宿主推导网（⛔ 不再写死 10000/15000 ——
  // gap-suite-wallclock-budgets-literals-depend-on-host-capacity）。
  await waitFor(() => readOutcomeLines(root).length >= 2);
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC1: two sequential selections — the resident loop kept going after the first");
  assert.deepEqual(picks.map((p) => p.task), ["gap-a", "gap-b"], "in-memory subtraction: second fill skipped the in-flight gap-a");
  assert.deepEqual(picks.map((p) => p.selector_reason), ["first-pick", "second-pick"]);
  assert.deepEqual(picks.map((p) => p.in_flight_count), [1, 2], "in-flight reached the concurrency cap (direct child count)");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 2, "two outcome records (one per worker, no exit-after-one)");
  assert.deepEqual(records.map((r) => r.final_state), ["completed", "completed"]);
});


test("AC3 — resource-gate WAIT ⇒ resident loop stops starting workers (zero spawned; WAIT is transient, not a latch)", async (t) => {
  const root = makeRoot("ac3-rg");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-a'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-a\\x20pick')",
    "--resource-gate-cmd", "node -e process.exit(1)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  await waitFor(() => readRoundLines(root).length >= 1);
  assert.equal(drv.events().some((e) => e.event === "worker-spawned"), false, "AC3: no worker spawned while resource-gate reports WAIT");
  assert.equal(readOutcomeLines(root).length, 0, "zero outcome records — nothing was dispatched");
  const stop = readRoundLines(root).find((r) => r.action === "stop");
  assert.ok(stop, "the stop round is recorded (not silent)");
  assert.match(stop.stop_reason, /resource-gate-wait/);
  assert.equal(drv.child.exitCode, null, "WAIT is transient — the driver does NOT exit (no permanent latch)");
});


test("AC3 — MCP halt mid-run stops NEW dispatch only; the in-flight worker completes (never killed)", async (t) => {
  const root = makeGitRoot("ac3-halt");
  t.after(() => rmSafe(root));
  writeTaskFile(root, "gap-slow", "done");
  writeTaskFile(root, "gap-fast", "done");
  writeControlState(root, defaultControlState());
  const rpcFile = path.join(root, "rpc.cnt");
  const pidFile = path.join(root, "w.pid");
  const driver = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root,
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n===0?['gap-slow','gap-fast']:n===1?['gap-fast']:[],pool:2})"),
    "--selector-cmd", "node -e console.log('gap-slow\\x20slow-worker')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "sleep 2",
    "--concurrency", "1",
    "--pid-file", pidFile,
    "--json",
  ], { stdio: ["ignore", "pipe", "ignore"] });

  let buf = "";
  driver.stdout.on("data", (d) => { buf += d; });
  // 等 worker 把 pid 落盘：上限走 waitFor 的宿主推导网。⛔ 旧写法是 `for (i < 1000)` + 每次 sleep 20ms
  // = 固定 20s 墙钟——同一类「只在空闲 16 核上成立」的预算，满载时静默变成真限制（硬规则 5b：
  // 缺陷成簇，兄弟实例就在同一文件里；gap-suite-wallclock-budgets-literals-depend-on-host-capacity）。
  const workerPid = await waitFor(() => {
    if (!fs.existsSync(pidFile)) return null;
    const n = Number(fs.readFileSync(pidFile, "utf8").trim().split("\n")[0]);
    return Number.isFinite(n) && n > 0 ? n : null; // 文件已建但内容还没写完 ⇒ 仍算「还没落盘」，继续轮询
  });
  assert.ok(workerPid, "the in-flight worker spawned and wrote its pid");

  // flip halt while gap-slow (sleep 2) is in-flight
  writeControlState(root, applyHalt(defaultControlState(), "outer", true));

  const exitCode = await new Promise((resolve) => { driver.on("close", (c) => resolve(c)); });
  assert.equal(exitCode, 0, "a halted resident stop is a clean exit, not a failure");

  const records = readOutcomeLines(root);
  assert.equal(records.length, 1, "AC3: exactly ONE worker (the in-flight); gap-fast was available but NOT dispatched after halt");
  assert.equal(records[0].task, "gap-slow");
  assert.equal(records[0].final_state, "completed", "AC3: the in-flight worker was NOT killed — it completed");
  const events = buf.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(events.filter((e) => e.event === "worker-spawned").length, 1, "only the one in-flight worker was ever spawned");
});

// ── AC138-3（round 等价物：无条件心跳）──────────────────────────────────────────────────────────────
// worker-outcome 只在任务真完成时写；池空时 outcome 停更会被 supervisor status 的 last_record_ts
// 误读为「死亡」。round 每轮循环无条件写一条（含池空/判停轮）作 liveness 直接量。⛔ 取假：池空轮
// 不写 round 心跳（round.jsonl 停更）⇒ 假。
