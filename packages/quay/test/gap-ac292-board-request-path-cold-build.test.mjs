// @test-group product
// gap-ac292-criterion-cold-miss-30s-ttl-always-expired — /board 的请求路径不再承担构建成本。
//
// 病灶（实测，活服务器）：AC-292 的判据是对**运行中的** quay serve 做 `curl --max-time 10`，而它每轮
// 复验一次、两次运行间隔恒 >30s ⇒ 页面上每个 reader 的 TTL 结构性恒过期 ⇒ 每次复验都在请求路径里
// 现付全额构建。实测（本仓 2274 条任务，未改动代码）：冷路径 **9.17 / 9.62 / 9.78s**，正跨在 10s
// 判据预算两侧 ⇒ 同一份正确实现按轮随机红绿（台账尾部的 `CAUSE=en-fetch-failed`）。
//
// 成本逐项（本 worktree 实测，均随任务数增长）：readBoardLanding 6.46s（spawn 一个全量扫描子进程）
// + readTaskStatusMapAtRef 1.41s（`git ls-tree` + `cat-file --batch` 扫每个任务文件）+ client.taskList()
// 一个 provider 往返 + readBoardExecution 0.04s。
//
// 修法（照搬已经为 /dashboard 解过同一病灶的 AC-179，⛔ 不另造机制）：构建移到**后台 tick**，请求路径
// 只读**快照**（同步 map 查找，零 reader I/O）。⛔ 不是把 8s timeout 调大、也⛔ 不是把 TTL 调长 ——
// 前两次修的都是**绝对值**，而成本随仓库规模增长（见任务体 Proposal 的表）。
//
// 本文件验证：
//   AC3′ 请求路径 0 次落地子进程 spawn + 0 次 develop-ref 全量扫描 —— **直接计数**，不是墙钟代理
//        （硬规则 4b：负载让扫描更慢，不会让它更频繁，所以频率才是隔离被测性质的那个读数）；
//   AC1′ 快照在位时 /board 服务的是快照：改 store 后页面仍显示旧值，rebuild 后才更新（两侧读数都在）；
//   AC2′ 重建进行中并发 5 次 /board 全部远低于判据预算，且都带 nav 区块（重建不得把页面打空）；
//   AC4′ 负控制：QUAY_BOARD_SNAPSHOT_DISABLED=1 ⇒ 快照在**两侧**都惰性（tick 与请求路径）；
//   AC5′ /board 既有渲染语义逐条不变（zh chrome 三段 + ?status=/?label=/?page=）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  peekBoardSnapshot,
  startBoardSnapshotRefresh,
  setBoardSnapshotStepHook,
  isBoardSnapshotRebuilding,
  clearBoardSnapshots,
  boardSnapshotDisabled,
  BOARD_SNAPSHOT_DISABLED_ENV,
  BOARD_SNAPSHOT_REFRESH_MS,
} from "../src/serve-board.ts";
import {
  clearLandingCache,
  getLandingColdRunCount,
  clearTaskStatusRefCache,
  getTaskStatusRefBuildCount,
} from "../src/observation.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** Poll until `fn()` is truthy or the deadline passes; returns whether it became true. A bare
 *  `await` on a timeout-returning helper is a 恒真空转 (memory: harness waitFor returns falsy on
 *  timeout, it does not throw) — so every wait here is bounded AND asserted on the result. */
async function until(fn, ms = 60_000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return fn();
}

/** The `<nav>…</nav>` region, extracted exactly as AC-292's own `criterion` does (`tr '\n' ' '` then
 *  a greedy `<nav.*</nav>`), so the assertion below is the criterion's assertion. */
function navRegion(body) {
  const m = body.replace(/\n/g, " ").match(/<nav.*<\/nav>/);
  return m ? m[0] : "";
}

/** The first `<title>…</title>` text, exactly as AC-292's `title_of` extracts it. */
function titleOf(body) {
  const m = body.replace(/\n/g, " ").match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : "";
}

/** Drop every TTL cache the LEGACY path reads, so a cache hit cannot be what hides the work: with
 *  these cleared, the only thing that can keep the counters flat is the snapshot itself. */
function coldCaches() {
  clearLandingCache();
  clearTaskStatusRefCache();
}

const TASK_BODY = (symbol, touches) =>
  `## Proposal\nA sufficiently long proposal section for the AC-292 board fixture ${symbol}.\n` +
  `## Plan\nA sufficiently long plan section for the AC-292 board fixture task.\n` +
  `## Acceptance Criteria\n- [ ] \`${symbol}\` implemented and verified\n` +
  `## Definition of Done\n- [x] acceptance gate passes\n` +
  `## Touches\n- ${touches}\n`;

/** A /board fixture workspace: git-inited (the drift checker's `findRepoRoot` needs a repo) with
 *  tasks at `<ws>/tasks` so the checker's default tasksDir matches the provider's. Nested under a
 *  `makeTmpDir` parent so the shared `/tmp/quay-worktrees` island is never touched, and cleaned up
 *  automatically at the end of this file by the helper's own `after()`. */
function makeBoardWorkspace(prefix) {
  const parent = makeTmpDir(`${prefix}ws-`);
  const ws = path.join(parent, "main");
  fs.mkdirSync(path.join(ws, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${path.join(ws, "tasks").replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${path.join(ws, "tasks").replaceAll("\\", "\\\\")}"\n`,
  );
  return { ws, tasksDir: path.join(ws, "tasks") };
}

let server, port, originalCwd, workspaceRoot, tasksDir;

before(async () => {
  const fixture = makeBoardWorkspace("ac292-");
  workspaceRoot = fixture.ws;
  tasksDir = fixture.tasksDir;
  const store = createStore(tasksDir);
  store.write("BRD-1", { title: "first board task", status: "todo", labels: ["gap"], body: TASK_BODY("brdFirst", "packages/quay/src/serve-board.ts") });
  store.write("BRD-2", { title: "second board task", status: "done", labels: ["gap", "webui"], body: TASK_BODY("brdSecond", "packages/quay/src/serve-board.ts") });
  store.write("BRD-3", { title: "third board task", status: "ready", labels: ["webui"], body: TASK_BODY("brdThird", "packages/quay/src/serve-board.ts") });

  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  fs.writeFileSync(path.join(workspaceRoot, "README.md"), "ac292 board fixture\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "ac292 fixture"], { cwd: workspaceRoot });
  // The develop ref the 意图 column overrides statuses from (gap-web-task-status-reads-stale-main-checkout).
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "branch", "develop"], { cwd: workspaceRoot });

  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  server?.boardSnapshot?.stop();
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  server.client = null;
  clearBoardSnapshots();
});

// ── AC3′: the direct measurement — zero subprocesses, zero full scans on the request path ────────

test("AC3′: with a snapshot present the request path spawns ZERO landing subprocesses and ZERO develop-ref full scans", async () => {
  assert.ok(
    await until(() => peekBoardSnapshot(workspaceRoot) != null, 60_000),
    "the startup build must have produced a snapshot (a timeout here would make every assertion below vacuous)",
  );

  coldCaches();
  const spawn0 = getLandingColdRunCount();
  const build0 = getTaskStatusRefBuildCount();

  const responses = [];
  for (let i = 0; i < 5; i++) responses.push(await get(port, "/board"));
  for (const r of responses) assert.equal(r.status, 200, "every /board answers 200");

  assert.equal(
    getLandingColdRunCount(),
    spawn0,
    "the request path must spawn ZERO landing subprocesses — `task-status-drift-check.ts` is a FULL scan (measured 6.46 s at 2274 tasks) and it belongs to the background tick",
  );
  assert.equal(
    getTaskStatusRefBuildCount(),
    build0,
    "…and ZERO develop-ref full scans (`git ls-tree` + `cat-file --batch` over every task file — the other cost that grows with the store)",
  );

  // Negative control — the falsifiable half, and the reason the two assertions above are a
  // MEASUREMENT rather than a constant: with the mechanism off, the very same cache-less request
  // pays exactly one of each. Without this, "0 spawns" would be indistinguishable from a counter
  // that never increments at all (硬规则 4: a quantity that cannot be false is not a measurement).
  process.env[BOARD_SNAPSHOT_DISABLED_ENV] = "1";
  try {
    coldCaches();
    const legacy = await get(port, "/board");
    assert.equal(legacy.status, 200, "the legacy path still answers 200 — it is a fallback, not a break");
    assert.equal(
      getLandingColdRunCount(),
      spawn0 + 1,
      "with the snapshot off, the legacy in-request build DOES spawn the checker exactly once — the fix, not the host, is what removes it",
    );
    assert.equal(
      getTaskStatusRefBuildCount(),
      build0 + 1,
      "…and DOES run the develop-ref scan exactly once",
    );
  } finally {
    delete process.env[BOARD_SNAPSHOT_DISABLED_ENV];
  }
});

// ── AC1′: the request path reads the SNAPSHOT, not the store ─────────────────────────────────────

test("AC1′: with a snapshot present /board serves the snapshot — a store mutation stays invisible until a rebuild", async () => {
  assert.ok(await until(() => peekBoardSnapshot(workspaceRoot) != null, 60_000), "precondition: a snapshot exists");

  const before = await get(port, "/board?all=1");
  assert.doesNotMatch(before.body, /BRD-LATE/, "precondition: the late task is not in the store yet");

  // Mutate the store AND drop the TTL caches. Dropping the caches is what makes this a measurement
  // of the SNAPSHOT rather than of a TTL: on the pre-fix request path (and on the legacy fallback
  // below) a cache-less request MUST read the store and therefore MUST show BRD-LATE.
  createStore(tasksDir).write("BRD-LATE", { title: "late added", status: "todo", labels: ["gap"], body: TASK_BODY("brdLate", "packages/quay/src/serve-board.ts") });
  coldCaches();

  const afterMutate = await get(port, "/board?all=1");
  assert.doesNotMatch(
    afterMutate.body,
    /BRD-LATE/,
    "the snapshot is served — the request path ran no reader, so a store mutation plus cold caches is still invisible",
  );
  assert.match(afterMutate.body, /BRD-1/, "and the page is still the real page, not a skeleton");

  // The negative control for THIS assertion: with the mechanism off, the very same cache-less
  // request DOES read the store and DOES reflect the mutation. Without it, "mutation invisible"
  // would be indistinguishable from "the mutation never took effect at all".
  process.env[BOARD_SNAPSHOT_DISABLED_ENV] = "1";
  try {
    coldCaches();
    const legacy = await get(port, "/board?all=1");
    assert.match(
      legacy.body,
      /BRD-LATE/,
      "with the snapshot off, the legacy in-request build reads the store and shows the late task — the fix, not the host, is what hides it",
    );
  } finally {
    delete process.env[BOARD_SNAPSHOT_DISABLED_ENV];
  }

  // …and a rebuild picks the mutation up again, so the snapshot is a fresh-enough view, not a freeze.
  await server.boardSnapshot.rebuildNow();
  const afterRebuild = await get(port, "/board?all=1");
  assert.match(afterRebuild.body, /BRD-LATE/, "after a rebuild the late task IS rendered");
});

// ── AC2′: concurrent requests DURING a rebuild ───────────────────────────────────────────────────

test("AC2′: while a rebuild is in flight, concurrent /board requests stay far inside the criterion budget and each carries the nav region", async () => {
  assert.ok(await until(() => peekBoardSnapshot(workspaceRoot) != null, 30_000), "precondition: a snapshot exists");

  // The step hook holds the rebuild open at a step boundary, so "in flight" is a state we ASSERT
  // rather than race — a fixture rebuild that finished in microseconds would make the reading below
  // vacuous.
  let release;
  const held = new Promise((r) => { release = r; });
  let entered = false;
  setBoardSnapshotStepHook(async () => { entered = true; await held; });
  const rebuilding = server.boardSnapshot.rebuildNow();
  assert.ok(
    await until(() => entered && isBoardSnapshotRebuilding(workspaceRoot), 10_000),
    "a rebuild must actually be in flight for this reading to mean anything",
  );

  const t0 = performance.now();
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => get(port, "/board")));
  const worstMs = performance.now() - t0;
  release();
  await rebuilding;
  setBoardSnapshotStepHook(null);

  for (const r of concurrent) {
    assert.equal(r.status, 200, "every concurrent /board answers 200");
    assert.ok(
      navRegion(r.body).length > 0,
      "every concurrent /board carries the nav region (a rebuild must not blank the page)",
    );
  }
  // The criterion writes the budget as `curl --max-time 10`; on the pre-fix server five sequential
  // cold requests cost ~9.2–9.8 s EACH (measured). Here they are concurrent and the whole batch,
  // HTTP included, must fit inside ONE request's budget.
  assert.ok(
    worstMs < 10_000,
    `all 5 concurrent /board requests must finish inside the criterion's own budget (worst wall ${worstMs.toFixed(0)} ms)`,
  );
});

// ── AC4′: the negative control — switching the mechanism off restores the old behaviour ──────────

test("AC4′: QUAY_BOARD_SNAPSHOT_DISABLED=1 makes the snapshot inert on BOTH sides (tick and request path)", async () => {
  assert.ok(await until(() => peekBoardSnapshot(workspaceRoot) != null, 30_000), "precondition: a snapshot exists");
  assert.equal(boardSnapshotDisabled(), false, "precondition: the mechanism is on");

  process.env[BOARD_SNAPSHOT_DISABLED_ENV] = "1";
  try {
    assert.equal(boardSnapshotDisabled(), true, "the switch is read at call time");
    assert.equal(
      peekBoardSnapshot(workspaceRoot),
      null,
      "the request path falls back to the legacy in-request build — this is what makes every fast reading above attributable to the fix",
    );
    // The tick is inert too: a fresh registration builds nothing.
    const fresh = makeTmpDir("ac292-off-");
    const handle = startBoardSnapshotRefresh(fresh, server.client, { intervalMs: 10 });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(peekBoardSnapshot(fresh), null, "with the switch on, the background tick builds nothing");
    handle.stop();
  } finally {
    delete process.env[BOARD_SNAPSHOT_DISABLED_ENV];
  }

  assert.equal(boardSnapshotDisabled(), false);
  assert.ok(peekBoardSnapshot(workspaceRoot) != null, "the existing snapshot is served again once the switch is off");
});

// ── AC5′: the existing /board rendering semantics are untouched ──────────────────────────────────

test("AC5′: the snapshot-backed /board keeps the zh chrome arms and the §filter/paging semantics", async () => {
  const en = await get(port, "/board?all=1");
  const zh = await get(port, "/board?all=1", { Cookie: "lang=zh" });

  // The three arms AC-292's criterion actually asserts (this task must not perturb them).
  assert.match(zh.body, /<html lang="zh"/, "zh: <html lang=\"zh\"");
  assert.ok(navRegion(en.body).includes("Board"), "en baseline: the nav region carries the literal nav label Board");
  assert.ok(!navRegion(zh.body).includes("Board"), "zh: that literal is gone FROM THE NAV REGION (the criterion's own scope)");
  assert.notEqual(titleOf(zh.body), titleOf(en.body), "zh: this page's OWN <title> differs from its default-locale title");

  // Filtering: ?status= is exact match.
  const todoOnly = await get(port, "/board?status=todo&all=1");
  assert.match(todoOnly.body, /BRD-1/, "?status=todo keeps the todo task");
  assert.doesNotMatch(todoOnly.body, /BRD-2/, "?status=todo drops the done task");

  // Filtering: ?label= is AND-logic over repeated labels.
  const gapWebui = await get(port, "/board?label=gap&label=webui&all=1");
  assert.match(gapWebui.body, /BRD-2/, "?label=gap&label=webui keeps the task carrying both");
  assert.doesNotMatch(gapWebui.body, /BRD-1/, "…and drops the one carrying only gap");

  // Pagination: ?pageSize=1&page=2 is the second of N single-row pages.
  const p1 = await get(port, "/board?all=1&pageSize=1&page=1");
  const p2 = await get(port, "/board?all=1&pageSize=1&page=2");
  assert.match(p1.body, /Page 1 of (\d+)/, "page 1 renders its page nav");
  const total = Number(p1.body.match(/Page 1 of (\d+)/)[1]);
  assert.ok(total >= 4, `the fixture must span several pages for this arm to mean anything (got ${total})`);
  assert.doesNotMatch(p2.body, /BRD-1/, "page 2 of pageSize=1 is not page 1's row");

  // The default (transient) view is still the transient filter, not a silent full-store dump — its
  // own explanation block is rendered on the UNFILTERED request (`?all=1` above is the explicit
  // escape hatch, which carries its own separate note instead).
  const def = await get(port, "/board");
  assert.match(def.body, /board_default_view=/, "the transient default view still renders its own explanation block");
});

// ── the refresh period stays inside the freshness contract the page already had ──────────────────

test("the refresh period is bounded by the 30s freshness window every other /board card already had", () => {
  assert.ok(
    BOARD_SNAPSHOT_REFRESH_MS > 0 && BOARD_SNAPSHOT_REFRESH_MS <= 30_000,
    `the tick (${BOARD_SNAPSHOT_REFRESH_MS}ms) must never make the page staler than the 30s TTL it replaced`,
  );
});
