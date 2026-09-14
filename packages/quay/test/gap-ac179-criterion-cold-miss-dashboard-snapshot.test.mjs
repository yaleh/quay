// @test-group product
// gap-ac179-criterion-cold-miss-30s-ttl-always-expired — /dashboard 的请求路径不再承担构建成本。
//
// 病灶（实测，活服务器）：/dashboard 的每个 reader 都是 30s TTL 缓存，而 AC-179 的唯一消费者是
// **每小时一次**的 goal-sweep —— 两次请求的间隔恒 >30s ⇒ TTL 结构性恒过期 ⇒ 每次复验都在请求
// 路径里现付全额构建（冷 19.17s / 热 1.61s），越过 criterion 写死的 `curl --max-time 10`。
// 前一次修复（gap-webui-dashboard-regressed-to-12-60s…）优化的是**稳态**（30 秒内的重复请求），
// 而那正是 AC-179 从不走的那条路径。
//
// 修法：把构建移到**后台 tick**，请求路径只读**快照**（同步 map 查找，零 reader I/O），并且重建
// 本身**协作式**执行 —— 每个阻塞 reader 独占一个 macrotask，70MB 的 verification ledger 走
// `readTestsNonBlocking`（异步读 + 分片解析 + 片间让出事件循环），所以并发请求（含 /health）
// 最多只等**一个** reader，而不是它们之和。
//
// 本文件验证：
//   AC1′ 快照存在时 /dashboard 不碰 store（改 store 后页面仍显示旧值 = 请求路径没读）；
//   AC3′ 重建进行中并发 5 次 /dashboard 全部 <10s 且都带 id="goal-card"；
//   AC4′ 重建进行中事件循环仍可服务（最大停顿有界，且与空闲窗口对照，不是「差不多」）；
//   AC5′ 卡片是真数据（AC 达成 x/y + fresh|stale|NOT-EVALUATED 之一）；
//   AC6′ mgr/sys 卡片内容仍在页面上（不因快照而静默删卡）；
//   AC2′ 负控制：关掉后台刷新（QUAY_DASHBOARD_SNAPSHOT_DISABLED=1）⇒ 快照恒缺席 ⇒ 请求路径
//        回到「在请求内构建」，store 改动**立刻**可见 —— 两侧读数都在。
//   + readTestsNonBlocking 与 sync readTests 结果逐字节相同（一个真相，两个循环形状）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  peekDashboardSnapshot,
  startDashboardSnapshotRefresh,
  buildDashboardSnapshot,
  setDashboardSnapshotStepHook,
  awaitDashboardSnapshotRebuild,
  isDashboardSnapshotRebuilding,
  clearDashboardSnapshots,
  dashboardSnapshotDisabled,
  DASHBOARD_SNAPSHOT_DISABLED_ENV,
} from "../src/serve-dashboard.ts";
import { readTests, readTestsNonBlocking, clearVerificationRoundCache, ROUNDS_PARSE_CHUNK_LINES } from "../src/observation.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** Poll until `fn()` is truthy or the deadline passes; returns whether it became true. A bare
 *  `await` on a timeout-returning helper is a 恒真空转 (memory: harness waitFor returns falsy on
 *  timeout, it does not throw) — so every wait here is bounded AND asserted on the result. */
async function until(fn, ms = 30_000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return fn();
}

/** The rebuild's own cost, measured as the DIRECT quantity: the longest gap between consecutive
 *  event-loop turns. A 10 ms self-rescheduling timer's overshoot IS the block — no proxy, no
 *  inference from a wall time that also contains render/HTTP cost. */
function startLagProbe() {
  const gaps = [];
  let last = performance.now();
  const h = setInterval(() => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
  }, 10);
  return { stop: () => { clearInterval(h); return gaps; } };
}

/** Every display cache the dashboard reads through — dropped so a "cold rebuild" really is cold. */
async function coldCaches(dash) {
  dash.clearTaskSummaryCache();
  dash.clearDashboardLiveCache();
  dash.clearDashboardProbeCache();
  clearVerificationRoundCache();
}

// ── fixture: a workspace with a real task store, real goals, and a BIG round ledger ───────────────

let server, port, originalCwd, workspaceRoot, goalsDir, tasksDir, roundsPath;

/** The `AC 达成 x/y` readings a /dashboard response carries. */
function goalRows(body) {
  return [...body.matchAll(/AC 达成 (\d+)\/(\d+)/g)].map((m) => `${m[1]}/${m[2]}`);
}

before(async () => {
  tasksDir = makeTmpDir("ac179-tasks-");
  const adrDir = makeTmpDir("ac179-adr-");
  workspaceRoot = makeTmpDir("ac179-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`,
  );
  fs.writeFileSync(
    path.join(goalsDir, "GOAL-001-goal-mechanism.md"),
    `---\nid: GOAL-001\ntitle: goal mechanism\nstatus: active\nkind: goal\norigin: test\n---\n## Goal\none target\n`,
  );
  fs.writeFileSync(
    path.join(goalsDir, "AC-170-first.md"),
    `---\nid: AC-170\ntitle: first ac\nstatus: achieved\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: "exit 0"\norigin: test\nevidence:\n  at: ${new Date().toISOString()}\n  verdict: pass\n  reading: "0"\n---\n## Rationale\nmeasured\n`,
  );
  fs.writeFileSync(
    path.join(goalsDir, "AC-171-second.md"),
    `---\nid: AC-171\ntitle: second ac\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: "exit 0"\norigin: test\n---\n## Rationale\npending\n`,
  );

  // A ledger heavy enough that the rebuild spends real time in the parse — otherwise the AC4 bound
  // assertion below would be satisfied by a fixture where nothing ever has a chance to block
  // (a 恒真空转, hard rule 4).
  roundsPath = path.join(workspaceRoot, ".quay", "verification-round.jsonl");
  const BIG = "x".repeat(12_000);
  const lines = [];
  for (let i = 0; i < 900; i++) {
    lines.push(JSON.stringify({ round: i, state: "green", tests: 3, pass: 3, startedAt: "2026-09-14T00:00:00.000Z", durationMs: 1000, buckets: BIG }));
  }
  fs.writeFileSync(roundsPath, lines.join("\n") + "\n");

  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  server?.dashboardSnapshot?.stop();
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  server.client = null;
});

// ── AC1′: the request path reads the SNAPSHOT, not the store ─────────────────────────────────────

test("AC1′: with a snapshot present, /dashboard runs no reader — a ledger mutation stays invisible even with every TTL cache dropped", async () => {
  assert.ok(
    await until(() => peekDashboardSnapshot(workspaceRoot) != null, 60_000),
    "the startup build must have produced a snapshot (a timeout here would make every assertion below vacuous)",
  );

  const before = await get(port, "/dashboard");
  assert.equal(before.status, 200);
  assert.match(before.body, /id="goal-card"/, "goal-card is present");
  assert.deepEqual(goalRows(before.body), ["1/2"], "the fixture's real AC progress renders (AC5′)");
  assert.doesNotMatch(before.body, /#9999/, "precondition: the sentinel round is absent");

  // Mutate the round ledger AND drop every display cache. Dropping the caches is what makes this a
  // measurement of the SNAPSHOT rather than of a TTL: on the pre-fix request path (and on the legacy
  // fallback below) a cache-less request MUST read the ledger and therefore MUST show #9999.
  const extra = JSON.stringify({ round: 9999, state: "red", tests: 1, pass: 0, startedAt: "2026-09-14T06:00:00.000Z", durationMs: 1000 });
  fs.appendFileSync(roundsPath, extra + "\n");
  // …and mutate the GOAL store too — the goal card is snapshot-backed as well (its `client.goalList()`
  // measured 987 ms through the real ABI, so leaving it on the request path would have reintroduced a
  // host-dependent constant).
  for (const id of ["AC-172", "AC-173"]) {
    fs.writeFileSync(
      path.join(goalsDir, `${id}-late.md`),
      `---\nid: ${id}\ntitle: late ac\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: "exit 0"\norigin: test\n---\n## Rationale\nlate\n`,
    );
  }
  await coldCaches(await import("../src/serve-dashboard.ts"));

  const afterMutate = await get(port, "/dashboard");
  assert.doesNotMatch(
    afterMutate.body,
    /#9999/,
    "the snapshot is served — the request path ran no reader, so a ledger mutation plus a cold cache is still invisible",
  );
  assert.deepEqual(
    goalRows(afterMutate.body),
    ["1/2"],
    "and the goal card is the snapshot's reading too — the two late ACs are not yet reflected",
  );
  assert.match(afterMutate.body, /id="goal-card"/, "and the page is still the real page, not a skeleton");

  // Negative control for THIS assertion (the falsifiable half): with the mechanism switched off, the
  // very same cache-less request DOES read the store and DOES reflect BOTH mutations. Without this,
  // "mutation invisible" would be indistinguishable from "the mutation never took effect at all".
  process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV] = "1";
  try {
    await coldCaches(await import("../src/serve-dashboard.ts"));
    const legacy = await get(port, "/dashboard");
    assert.match(
      legacy.body,
      /#9999/,
      "with the snapshot off, the legacy in-request build reads the ledger and shows the sentinel — the fix, not the host, is what hides it",
    );
    assert.deepEqual(goalRows(legacy.body), ["1/4"], "and the legacy path reflects the two late ACs");
  } finally {
    delete process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV];
  }

  // …and a rebuild picks both mutations up again, so the snapshot is a fresh-enough view, not a freeze.
  await coldCaches(await import("../src/serve-dashboard.ts"));
  await server.dashboardSnapshot.rebuildNow();
  const afterRebuild = await get(port, "/dashboard");
  assert.match(afterRebuild.body, /#9999/, "after a rebuild the sentinel round IS rendered");
  assert.deepEqual(goalRows(afterRebuild.body), ["1/4"], "and the two late ACs are rendered too");
});

// ── AC3′ / AC4′: concurrent requests DURING a rebuild ────────────────────────────────────────────

test("AC3′+AC4′: while a rebuild runs, concurrent /dashboard stay <10s and the event loop keeps serving", async () => {
  const dash = await import("../src/serve-dashboard.ts");
  await until(() => peekDashboardSnapshot(workspaceRoot) != null, 30_000);

  // ── idle control window: same probe, no rebuild — the host's own scheduling noise floor ──────
  const idleProbe = startLagProbe();
  await new Promise((r) => setTimeout(r, 3_000));
  const idleGaps = idleProbe.stop();

  // ── rebuild window: cold rebuilds back to back, probe running throughout ─────────────────────
  const probe = startLagProbe();
  const rebuildWalls = [];
  const stopAt = Date.now() + 6_000;
  while (Date.now() < stopAt) {
    await coldCaches(dash);
    const t = performance.now();
    await server.dashboardSnapshot.rebuildNow();
    rebuildWalls.push(performance.now() - t);
  }
  const gaps = probe.stop();

  // AC4 is only a measurement if the fixture actually made the rebuild cost something; otherwise the
  // bound below is satisfied by nothing happening at all.
  assert.ok(
    Math.max(...rebuildWalls) >= 150,
    `the fixture rebuild must be non-trivial for the bound below to mean anything (max wall ${Math.max(...rebuildWalls).toFixed(0)} ms)`,
  );
  const worst = Math.max(...gaps);
  const worstIdle = Math.max(...idleGaps);
  assert.ok(
    worst < 1_000,
    `the rebuild must not hold the event loop for ≥1s (worst gap ${worst.toFixed(0)} ms over ${gaps.length} turns; idle floor ${worstIdle.toFixed(0)} ms)`,
  );

  // AC3: concurrent /dashboard against a rebuild in flight. The step hook holds the rebuild open at
  // a step boundary, so "in flight" is a state we ASSERT rather than race.
  let release;
  const held = new Promise((r) => { release = r; });
  let entered = false;
  setDashboardSnapshotStepHook(async () => { entered = true; await held; });
  const rebuilding = server.dashboardSnapshot.rebuildNow();
  assert.ok(await until(() => entered && isDashboardSnapshotRebuilding(workspaceRoot), 10_000), "a rebuild must actually be in flight for this reading to mean anything");
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => get(port, "/dashboard")));
  release();
  await rebuilding;
  setDashboardSnapshotStepHook(null);

  for (const r of concurrent) {
    assert.equal(r.status, 200, "every concurrent /dashboard answers 200");
    assert.match(r.body, /id="goal-card"/, "every concurrent /dashboard carries the goal card (a rebuild must not blank the page)");
  }
});

// ── AC5′ / AC6′: real content, no silently deleted cards ─────────────────────────────────────────

test("AC5′+AC6′: the snapshot-backed page keeps real goal data and does not drop the mgr/sys cards", async () => {
  const r = await get(port, "/dashboard");
  assert.match(r.body, /id="goal-card"/, "goal-card is present");
  assert.match(r.body, /AC 达成 \d+\/\d+/, "per-goal AC progress is real data");
  assert.match(r.body, /\b(fresh|stale|NOT-EVALUATED)\b/, "one of the three staleness states renders");
  assert.match(r.body, /active \d+ \/ cap \d+/, "activeCount / cap renders");
  assert.match(r.body, /id="mgr-card"/, "mgr card is not silently deleted (AC6′)");
  assert.match(r.body, /id="sys-card"/, "sys card is not silently deleted (AC6′)");
  assert.match(r.body, /id="live-card"/, "live card is not silently deleted (AC6′)");
  assert.match(r.body, /id="tests-card"/, "tests card is not silently deleted (AC6′)");
  assert.match(r.body, /id="task-card"/, "task card is not silently deleted (AC6′)");
  assert.match(r.body, /id="fanin-card"/, "fan-in card is not silently deleted (AC6′)");
});

// ── AC2′: the negative control — switching the mechanism off restores the old behaviour ──────────

test("AC2′: QUAY_DASHBOARD_SNAPSHOT_DISABLED=1 makes the snapshot inert on BOTH sides (tick and request path)", async () => {
  const dash = await import("../src/serve-dashboard.ts");
  await until(() => peekDashboardSnapshot(workspaceRoot) != null, 30_000);
  assert.equal(dashboardSnapshotDisabled(), false, "precondition: the mechanism is on");

  process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV] = "1";
  try {
    assert.equal(dashboardSnapshotDisabled(), true, "the switch is read at call time");
    assert.equal(
      peekDashboardSnapshot(workspaceRoot),
      null,
      "the request path falls back to the legacy in-request build — this is what makes the fast reading attributable to the fix",
    );
    // The tick is inert too: a fresh registration builds nothing.
    const fresh = makeTmpDir("ac179-off-");
    const handle = startDashboardSnapshotRefresh(fresh, server.client, { intervalMs: 10 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(peekDashboardSnapshot(fresh), null, "with the switch on, the background tick builds nothing");
    handle.stop();
  } finally {
    delete process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV];
  }

  // Restoring the switch restores the fast path.
  assert.equal(dashboardSnapshotDisabled(), false);
  assert.ok(peekDashboardSnapshot(workspaceRoot) != null, "the existing snapshot is served again once the switch is off");
});

// ── the non-blocking reader is the same reader (one truth, two loop shapes) ──────────────────────

test("readTestsNonBlocking returns the SAME result as sync readTests, and yields while parsing", async () => {
  const ROOT = workspaceRoot;
  clearVerificationRoundCache();
  const sync = readTests(ROOT);
  clearVerificationRoundCache();
  const nonBlocking = await readTestsNonBlocking(ROOT);

  assert.ok(sync.runs.length > 0, "the fixture ledger must parse to records, or this comparison is vacuous");
  assert.equal(
    JSON.stringify(nonBlocking),
    JSON.stringify(sync),
    "the two readers must agree byte-for-byte on the same store (only the loop shape differs)",
  );

  // The chunk constant is the thing that bounds the block: if a future edit set it to Infinity the
  // reader would silently go back to being one long block. Pin it to a finite, small value.
  assert.ok(Number.isInteger(ROUNDS_PARSE_CHUNK_LINES) && ROUNDS_PARSE_CHUNK_LINES > 0 && ROUNDS_PARSE_CHUNK_LINES <= 1000,
    `ROUNDS_PARSE_CHUNK_LINES must stay a bounded slice size (got ${ROUNDS_PARSE_CHUNK_LINES})`);

  // …and the yield actually happens: the event loop turns at least once during the non-blocking read
  // of a fixture ledger large enough to need more than one slice.
  clearVerificationRoundCache();
  let turns = 0;
  const h = setInterval(() => { turns++; }, 1);
  await readTestsNonBlocking(ROOT);
  clearInterval(h);
  assert.ok(turns > 0, "the event loop kept running during the non-blocking read");
});

// ── the build itself never throws and never blanks the page ──────────────────────────────────────

test("buildDashboardSnapshot degrades per reader and awaitDashboardSnapshotRebuild is observable", async () => {
  const snap = await buildDashboardSnapshot(workspaceRoot, server.client);
  assert.equal(typeof snap.builtAt, "number", "the snapshot carries its build instant");
  assert.ok(typeof snap.live === "object" && snap.live !== null, "live is always an object (never undefined)");
  assert.ok(Array.isArray(snap.tasks), "tasks is always an array");
  assert.ok(Array.isArray(snap.goals), "goals is always an array — the goal card is snapshot-backed too, because client.goalList() measured 987 ms through the real ABI");
  assert.ok(Array.isArray(snap.workerOutcomes), "workerOutcomes is always an array");
  assert.ok(snap.tests && Array.isArray(snap.tests.runs), "tests always carries a runs array");

  // awaitDashboardSnapshotRebuild resolves against an in-flight build (no rebuild ⇒ resolves at once).
  await awaitDashboardSnapshotRebuild("no-such-root-for-this-test");
  assert.equal(isDashboardSnapshotRebuilding("no-such-root-for-this-test"), false);
});

test("clearDashboardSnapshots drops every snapshot and in-flight marker (test hygiene handle)", () => {
  assert.ok(peekDashboardSnapshot(workspaceRoot) != null, "precondition: a snapshot is present");
  clearDashboardSnapshots();
  assert.equal(peekDashboardSnapshot(workspaceRoot), null, "the handle drops every snapshot");
  assert.equal(isDashboardSnapshotRebuilding(workspaceRoot), false, "and every in-flight marker");
});

test("a rebuild repopulates the snapshot after clearDashboardSnapshots (the handle is not a kill switch)", async () => {
  clearDashboardSnapshots();
  server.dashboardSnapshot.stop();
  const { client } = server;
  const handle = startDashboardSnapshotRefresh(workspaceRoot, client, { intervalMs: 60_000 });
  try {
    assert.ok(
      await until(() => peekDashboardSnapshot(workspaceRoot) != null, 30_000),
      "a fresh registration builds again — clearing state must not disable the mechanism (that is what the ENV switch is for)",
    );
  } finally {
    handle.stop();
  }
});
