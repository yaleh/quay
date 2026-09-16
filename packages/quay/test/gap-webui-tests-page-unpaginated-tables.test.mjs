// @test-group product
// gap-webui-tests-page-unpaginated-tables — /tests 的两张列表表（历史运行 + perFile 耗时明细）零分页：
// 生产实例实测 1267 行历史 + 571 行 perFile 铺满一页（114,161px 高、665,105 字节）。分页原语
// （DEFAULT_PAGE_SIZE / buildHref）早已在 serve-render.ts 且 /board、/tasks 已接线——这是硬规则 5b
// 的实例：gap-webui-board-no-pagination 建对了机制、只接了被报出来的那一个页面。本任务把 /tests
// 两张表接到同一套服务端切片（history → ?page/?pageSize；perFile → ?perFilePage/?perFilePageSize），
// 并把 perFile 时间线 SVG（288 文件 = 119,381 字节，AC5 的 <120,000 目标单靠表分页达不到）封顶到
// 最慢 TIMELINE_MAX_BARS 个文件。零客户端 JS——全是服务端渲染的 <a href>。
//
// 本文件用「真实 startServer() + HTTP」测服务端机制（AC2 翻页、AC3 切片、AC4 表格清单、AC5 字节数）。
// AC1（scrollHeight < 20,000）是 DOM 度量，无法在无浏览器的 node --test 里测（与 serve-browser-render
// 的同一纪律：浏览器验证是 run-once 实测，本文件测其根因可机械断言的条件）——实测记录在提交信息里。
//
// Run (scoped): node --test packages/quay/test/gap-webui-tests-page-unpaginated-tables.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { clearVerificationRoundCache } from "../src/observation.ts";
import { buildTestsHref } from "../src/serve-tests.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

// `freePort()` DELETED — probe-then-bind is a TOCTOU over the shared ephemeral-port space, and its
// loopback probe did not even match startServer's 0.0.0.0 bind. Measured EADDRINUSE + the fix (bind
// port 0, read server.address().port) are recorded in packages/quay/test/serve-board.test.mjs.

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/**
 * Build a workspace whose tasks live at `<ws>/tasks` and git-inits the ws so findRepoRoot resolves —
 * the same shape as serve-board.test.mjs's makeWorkspace (a bare tasks dir is not a legal workspace;
 * config is a provider map). Returns { ws, tasksDir }.
 */
function makeWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}ws-`));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "tests-page fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "tests fixture"], { cwd: ws });
  return { ws, tasksDir };
}

/**
 * Seed `.quay/verification-round.jsonl` with `count` rounds (oldest-first, so readTests's reverse puts
 * round `count` newest/first). The NEWEST round (the last line) carries `perFileCount` perFile entries
 * WITH timestamps, so the default /tests page renders both the paginated history table AND the perFile
 * table + timeline. Returns the total data rows seeded (rounds + perFile) so AC3/AC5 assertions have a
 * documented, non-vacuous input size.
 */
function seedRounds(ws, count, perFileCount) {
  const t0 = 1724374800000;
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const rec = {
      round: i,
      startedAt: new Date(t0 + i * 60_000).toISOString(),
      durationMs: 30_000 + (i % 7) * 1000,
      state: i % 5 === 0 ? "red" : "green",
      pass: 40, fail: i % 5 === 0 ? 3 : 0, cancelled: 0, tests: 43,
      commit: `${String(i).padStart(4, "0")}abcdef0123456789abcdef0123456789abcdef`,
      scope: null, runner: null, gate: null, failures: null,
    };
    if (i === count) {
      // The newest run carries perFile (with timestamps) so the perFile table + timeline render.
      rec.perFile = Array.from({ length: perFileCount }, (_, j) => ({
        file: `packages/quay/test/fixture-file-${String(j).padStart(3, "0")}.test.mjs`,
        durationMs: 50 + j * 7,
        passed: j % 4 !== 0,
        startedAtMs: t0 + j * 100,
        endedAtMs: t0 + j * 100 + 50 + j * 7,
      }));
    }
    lines.push(JSON.stringify(rec));
  }
  fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), lines.join("\n") + "\n");
  return count + perFileCount;
}

// gap-webui-tests-page-timeline-gantt-truncated — /tests now carries THREE paginated datasets (history,
// perFile table, gantt), each with its own "Next »". Target the HISTORY nav's Next specifically: its href
// carries the standalone `page=` param, whereas gantt/perFile use `ganttPage=`/`perFilePage=` (neither
// matches the `[?&]page=` boundary, and `pageSize=` doesn't either because `page` is followed by `Size`).
const firstNextHref = (body) => (body.match(/<a href="([^"]*[?&]page=\d+[^"]*)">Next &raquo;<\/a>/) ?? [])[1] ?? null;
const firstHistoryRound = (body) => (body.match(/href="\/tests\?round=(\d+)"/) ?? [])[1] ?? null;

test("buildTestsHref: preserves focus round + both tables' pagination, drops defaults", () => {
  assert.equal(buildTestsHref({ round: null, page: 1, pageSize: 20, perFilePage: 1, perFilePageSize: 20 }), "/tests");
  assert.equal(
    buildTestsHref({ round: 7, page: 2, pageSize: 50, perFilePage: 3, perFilePageSize: 100 }),
    "/tests?round=7&page=2&pageSize=50&perFilePage=3&perFilePageSize=100",
  );
  assert.equal(buildTestsHref({ round: null, page: 1, pageSize: 20, perFilePage: 2, perFilePageSize: 20 }), "/tests?perFilePage=2");
});

test("AC2: /tests history table is paginated — Page size links + Next » present, and Next » changes the first row", async () => {
  const { ws } = makeWorkspace("tests-ac2-");
  const cwd0 = process.cwd();
  let server;
  try {
    seedRounds(ws, 60, 60);
    clearVerificationRoundCache();
    process.chdir(ws);
    // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const p1 = await get(port, "/tests?pageSize=5");
    assert.equal(p1.status, 200, "AC2: GET /tests?pageSize=5 returns 200");
    assert.ok(p1.body.includes("Page size:"), "AC2: Page size selector present");
    assert.ok(p1.body.includes('href="/tests?pageSize=50"'), "AC2: a Page size option link (50) present");
    const nextHref = firstNextHref(p1.body);
    assert.ok(nextHref, "AC2: Next » link present");
    assert.ok(nextHref.includes("page=2"), `AC2: Next » points at page 2 (got ${nextHref})`);

    const r1 = firstHistoryRound(p1.body);
    assert.ok(r1, "AC2: page 1 has a first history round");
    const p2 = await get(port, nextHref);
    const r2 = firstHistoryRound(p2.body);
    assert.ok(r2, "AC2: page 2 has a first history round");
    assert.notEqual(r1, r2, `AC2: Next » actually flips the page — first round ${r1} → ${r2}`);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: server-side slicing — pageSize=20 leaves ≤ 20 history + ≤ 20 perFile rows (not all rows in the response)", async () => {
  const { ws } = makeWorkspace("tests-ac3-");
  const cwd0 = process.cwd();
  let server;
  try {
    const seeded = seedRounds(ws, 120, 120);
    clearVerificationRoundCache();
    process.chdir(ws);
    // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const r = await get(port, "/tests?pageSize=20");
    const trCount = (r.body.match(/<tr/g) || []).length;
    // 20 history data rows + 20 perFile data rows + 2 header rows = 42 (the two-table generalization of
    // the AC's "≤ 20 + 表头数"). Pre-fix the SAME request returned 1267+571+2 = 1840 <tr>.
    assert.ok(trCount <= 42, `AC3: ≤ 42 <tr> (20+20+2), got ${trCount}`);
    assert.ok(trCount >= 40, `AC3: both tables render rows (≥ 40 <tr>), got ${trCount}`);
    const historyRows = (r.body.match(/href="\/tests\?round=\d+"/g) || []).length;
    assert.equal(historyRows, 20, `AC3: history table shows exactly 20 rows with pageSize=20 (got ${historyRows})`);
    // The fixture genuinely carries more rows than the page renders — the slice is real, not a small input.
    assert.ok(seeded >= 240, `AC3: fixture is large enough to falsify a no-op (${seeded} data rows seeded)`);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5: default /tests response is < 120,000 bytes (pre-fix 665,105)", async () => {
  const { ws } = makeWorkspace("tests-ac5-");
  const cwd0 = process.cwd();
  let server;
  try {
    seedRounds(ws, 200, 200);
    clearVerificationRoundCache();
    process.chdir(ws);
    // ⛔ never probe-then-bind (see packages/quay/test/serve-board.test.mjs header)
    server = await startServer({ port: 0 });
    const port = server.address().port;

    const r = await get(port, "/tests");
    assert.equal(r.status, 200, "AC5: GET /tests returns 200");
    assert.ok(r.body.length < 120_000, `AC5: default response < 120,000 bytes, got ${r.body.length}`);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC4: enumerate every <table> in serve-*.ts and annotate it — no unannotated item (hard rule 5b)", () => {
  // The deliverable: the grep hit count + first-3 actual lines + a per-site annotation
  // (已接分页 / 无需分页[with upper-bound source] / 待接). Pinned here so the enumeration can't drift.
  const inventory = [
    ["packages/quay/src/serve-architecture.ts", 55, "无需分页（上界=packages/* 顶层组件数，近 7 天变更组件 ≤ 该固定集合）"],
    ["packages/quay/src/serve-board.ts", 168, "已接分页（gap-webui-board-no-pagination，?page/?pageSize）"],
    ["packages/quay/src/serve-doc.ts", 39, "无需分页（上界=docs-managed/ 人工维护文档数）"],
    ["packages/quay/src/serve-adr.ts", 26, "无需分页（上界=adr/ADR-*.md 文件数）"],
    ["packages/quay/src/serve-system.ts", 118, "无需分页（上界=活跃 Claude 会话数）"],
    ["packages/quay/src/serve-system.ts", 128, "无需分页（上界=已配置 observer 数）"],
    ["packages/quay/src/serve-task.ts", 482, "已接分页（QW-007 buildHref，?page/?pageSize）"],
    ["packages/quay/src/serve-task.ts", 579, "无需分页（上界=单个任务的 run 台账记录数）"],
    ["packages/quay/src/serve-goal.ts", 255, "无需分页（上界=goals/ 人工维护 goal 数，cap=3 active；Goals tab）"],
    ["packages/quay/src/serve-goal.ts", 287, "无需分页（上界=goals/ 下派生 criterion 总数；Criteria tab）"],
    ["packages/quay/src/serve-goal.ts", 467, "无需分页（上界=单个 goal 名下 criterion 数，gap-webui-goal-detail-no-entity-links 的详情页 criterion 区块）"],
    ["packages/quay/src/serve-tests.ts", 319, "已接分页（本任务，?perFilePage/?perFilePageSize）"],
    ["packages/quay/src/serve-tests.ts", 752, "已接分页（本任务，?page/?pageSize）"],
    ["packages/quay/src/serve-tests.ts", 917, "待接（/tests/file 单文件跨轮历史，一行/轮，无上界）"],
    ["packages/quay/src/serve-needs-human.ts", 82, "无需分页（上界=needs-human 任务池，稀有终态）"],
    ["packages/quay/src/serve-needs-human.ts", 88, "待接（升级台账 .quay/promotion-outcome.jsonl append-only，无上界）"],
    ["packages/quay/src/serve-live.ts", 84, "无需分页（上界=在飞任务数，受并发上限约束）"],
  ];

  // The AC's literal command — `grep -rn "<table" packages/quay/src/serve-*.ts` — needs a SHELL for the
  // `*.ts` glob (grep itself does not expand globs on its file arguments). execSync runs via /bin/sh.
  // Sort the lines: the shell's glob expansion order is filesystem-dependent (not guaranteed), so the
  // "first 3" is pinned on the SORTED order for determinism.
  const grepOut = execSync('grep -rn "<table" packages/quay/src/serve-*.ts', {
    cwd: REPO_ROOT, encoding: "utf8",
  }).trim().split("\n").sort();

  // Hit count matches the inventory — every <table> site is annotated, none unannotated.
  assert.equal(grepOut.length, inventory.length, `AC4: grep hits (${grepOut.length}) == annotated inventory (${inventory.length})`);

  // First 3 actual lines, pinned by FILE + "<table" CONTENT, over the same sorted order (the AC's
  // 「前 3 条实际内容」). ⛔ The absolute LINE NUMBER is deliberately NOT pinned: it is not an
  // invariant of anything this AC is about, and it drifts on any edit above the site — including
  // edits with nothing to do with tables (gap-web-ui-pages-carry-no-host-project-identity's identity
  // work moved serve-adr.ts's site from :26 to :28 on its own, and the check went red for it). That
  // is the very reason the file-multiset assertion below compares FILES and not lines — 硬规则 5b:
  // that fix was applied there and missed here, its sibling. Order is still pinned (the multiset
  // walks this same sorted list), and the content assertion keeps each pinned hit a real <table>
  // site rather than just a filename that happens to sort first.
  const firstThree = [[0, "serve-adr.ts"], [1, "serve-architecture.ts"], [2, "serve-board.ts"]];
  for (const [i, file] of firstThree) {
    assert.ok(new RegExp(`^packages/quay/src/${file}:\\d+:`).test(grepOut[i]),
      `AC4: hit #${i + 1} is ${file} (got ${grepOut[i]})`);
    assert.ok(grepOut[i].includes("<table"),
      `AC4: hit #${i + 1} really is a <table> site (got ${grepOut[i]})`);
  }

  // Every annotated SITE is present, and no <table>-bearing file is unannotated: compare the FILE
  // multiset (not the line numbers — a line number drifts on any unrelated edit to the file, which
  // must NOT fail this task's test; the count check above already pins the item count). The `line`
  // field in the inventory stays as a human-readable locator for the commit-message copy of the list.
  const grepFiles = grepOut.map((g) => g.slice(0, g.indexOf(":")));
  const invFiles = inventory.map(([file]) => file).sort();
  assert.deepEqual(grepFiles, invFiles, "AC4: every <table> file is annotated (file multiset matches), none unannotated");
});
