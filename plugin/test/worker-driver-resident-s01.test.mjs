// @test-group lowconc
// worker-driver-resident.test.mjs — resident driver loop (selector/heartbeat/liveness/wrapper) + continue/fan-in-merge mechanics. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-resident.test.mjs by gap-suite-split-15-over-30s-test-files — shard 1/8 (6 tests). Shared fixtures: ./helpers/worker-driver-resident-harness.mjs (single source).

import { test } from "node:test";
import { FAMILY_SRC, WAIT_BASE_MS, after, assert, counterNodeE, fs, makeGitRoot, parseSelectorOutput, path, resourceGateCheck, rmSafe, runSelectorWorker, shuffle, spawn, spawnResident, waitFor, writeTouchedTask } from "./helpers/worker-driver-resident-harness.mjs";

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
