// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/5 (9 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, REPO_ROOT, FAMILY_SRC, WAIT_BASE_MS, after, assert, counterNodeE, defaultReadyPoolArgv, defaultSelectorArgv, fs, makeGitRoot, parseSelectorOutput, path, readOutcomeLines, resolveKernelScriptsDir, resourceGateCheck, rmSafe, runSelectorWorker, shuffle, spawn, spawnResident, waitFor, writeTaskFile, writeTouchedTask } from "./helpers/worker-driver-resident-harness.mjs";

test("结构面（能取假）— after 钩子里的删除一律走 rmSafe（裸 fs.rmSync 抛错会跳过后续 drv.stop()）", () => {
  const HOOK = "t." + "after(";
  const RAW_RM = "fs." + "rmSync(";
  const src = FAMILY_SRC;
  const hooks = src.split(HOOK).slice(1);
  const offenders = [];
  hooks.forEach((h, i) => {
    const end = h.includes("\n  });") ? h.indexOf("\n  });") + 7 : h.indexOf("\n") + 1;
    const win = h.slice(0, end > 0 ? end : h.length);
    if (win.includes(RAW_RM)) offenders.push(`hook#${i + 1}`);
  });
  assert.ok(hooks.length >= 10, `解析到 ${hooks.length} 个 after 钩子 —— 少于 10 说明判据没看到它们（空转，⛔ 不是"都合格"）`);
  assert.deepEqual(offenders, [], `after 钩子仍用裸 fs.rmSync（改用 rmSafe）：${offenders.join(", ")}`);
});

// ── 阶段 4（AC129）常驻驱动 + 自主选任务：选择环 / selector worker / 判停 ─────────────────────────
// (counterNodeE shared helper lives in ./helpers/worker-driver-harness.mjs — used by this file AND
//  worker-driver-fan-in.test.mjs, so it cannot stay local to either.)


test("AC129 pure — parseSelectorOutput: valid pick, invalid-pick fallback, empty fallback", () => {
  const candidates = ["gap-a", "gap-b"];
  const ok = parseSelectorOutput("gap-a because it blocks the suite\n", candidates, 0);
  assert.equal(ok.task, "gap-a");
  assert.equal(ok.reason, "because it blocks the suite");

  // invalid pick (task not in candidates) ⇒ fail-closed fallback to the first candidate.
  const bad = parseSelectorOutput("gap-zzz not-a-candidate", candidates, 0);
  assert.equal(bad.task, "gap-a");
  assert.match(bad.reason, /fallback to first shuffled candidate/);

  // empty output + non-zero exit ⇒ fallback too.
  const empty = parseSelectorOutput("", candidates, 1);
  assert.equal(empty.task, "gap-a");
  assert.match(empty.reason, /exit 1/);

  // no candidates ⇒ null.
  assert.equal(parseSelectorOutput("gap-a x", [], 0), null);
});


test("AC142 AC1 — selector spawn captures stderr; fallback reason carries it (spawn 失败不再零诊断)", async () => {
  const candidates = ["gap-a", "gap-b"];
  // parseSelectorOutput: stderr 可选传入，兜底 reason 带 stderr 截断。
  const bad = parseSelectorOutput("", candidates, 1, "AUTH-ERROR: no credentials");
  assert.equal(bad.task, "gap-a");
  assert.match(bad.reason, /stderr="AUTH-ERROR/);

  // runSelectorWorker: 真实 spawn 写 stderr + exit 非零 ⇒ 兜底 reason 带 stderr（⛔ 不再 ignore）。
  // 异步版（gap-worker-driver-async-selector-readypool AC1）：runSelectorWorker 已改 async。
  const r = await runSelectorWorker(
    candidates,
    ["node", "-e", "process.stderr.write('AUTH-ERROR: no credentials');process.exit(1)"],
    "/r",
  );
  assert.equal(r.task, "gap-a");
  assert.match(r.reason, /stderr="AUTH-ERROR/, `selector_reason carries stderr: ${r.reason}`);
});


test("AC129 pure — shuffle returns a permutation of its input", () => {
  const src = ["gap-a", "gap-b", "gap-c", "gap-d"];
  const got = shuffle(src);
  assert.equal(got.length, src.length);
  assert.deepEqual([...got].sort(), [...src].sort(), "shuffle preserves the multiset");
  assert.deepEqual(src, ["gap-a", "gap-b", "gap-c", "gap-d"], "shuffle does not mutate its input");
});


test("AC3 (gap-launch-script-worker-cap-broken) — resident loop never dispatches the Touches-overlapping pair concurrently", async (t) => {
  const root = makeGitRoot("ac3-integr");
  writeTouchedTask(root, "gap-a", "plugin/scripts/foo.ts");
  writeTouchedTask(root, "gap-b", "plugin/scripts/foo.ts"); // overlaps gap-a
  writeTouchedTask(root, "gap-c", "plugin/scripts/bar.ts"); // disjoint
  const rpcFile = path.join(root, "rpc.cnt");
  const selFile = path.join(root, "sel.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", counterNodeE(rpcFile, "JSON.stringify({ready:n<=1?['gap-a','gap-b','gap-c']:[],pool:n<=1?3:0})"),
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first':n===1?'gap-b\\x20wants-b':'gap-a\\x20unused'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(0)",
    "--concurrency", "3",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));
  // 等待上限不再是裸字面量（⛔ 10000/15000/30000 那种「本机是空闲 16 核」的数字）：waitFor 的缺省
  // 网 = WAIT_BASE_MS × 本机当下的抢占因子（/proc/loadavg ÷ nproc，每次调用读一次）。实测本用例
  // 空载 1.5s，满载 suite 下曾 >5s 而超时（gap-worker-driver-resident-loop-intermittent-hang）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").length >= 2);
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  // gap-a picked first (touches foo.ts); while it is in-flight, gap-b (also foo.ts) must be filtered
  // out of the selector's candidate set — the selector asked for gap-b on its 2nd call but was only
  // offered the disjoint gap-c, so it fell back to gap-c. gap-b is never dispatched concurrently.
  assert.ok(!picks.some((p) => p.task === "gap-b"), "AC3: the overlapping gap-b is never dispatched (would collide with in-flight gap-a)");
  assert.deepEqual(picks.map((p) => p.task), ["gap-a", "gap-c"], "only the disjoint pair is dispatched");
  assert.match(picks[1].selector_reason, /fallback/, `the selector asked for gap-b but was only offered the disjoint gap-c: ${picks[1].selector_reason}`);
});


test("AC129 pure — resourceGateCheck: exit 0 ⇒ GO; exit 1 ⇒ WAIT (fail-closed)", () => {
  assert.equal(resourceGateCheck("/r", ["node", "-e", "process.exit(0)"]).go, true);
  const wait = resourceGateCheck("/r", ["node", "-e", "process.exit(1)"]);
  assert.equal(wait.go, false, "non-zero exit ⇒ WAIT");
  assert.match(wait.reason, /WAIT/);
  const missing = resourceGateCheck("/r", ["definitely-no-such-binary-xyz"]);
  assert.equal(missing.go, false, "spawn failure ⇒ fail-closed WAIT");
});


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
