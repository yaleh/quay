// @test-group product
// gap-webui-tests-page-timeline-gantt-truncated — /tests 「测试时间线」甘特图硬编码 TIMELINE_MAX_BARS=50
// 「最慢 50」截断：>50 文件的轮次只画最慢 50 个，其余不可见。本任务把甘特图接上与 perFile 表同构的
// 服务端分页（独立 ?ganttPage/?ganttPageSize 命名空间，默认 pageSize 维持 50 的量级保住字节预算），
// 但分页依据改为按 startedAtMs 升序切片（保留时间线的时间语义），翻到最后一页能看到本轮全部文件的
// 起止时刻。标题从「仅显示最慢 N/M」改为「第 X/Y 页 · 本页 A–B / 共 N 个文件」。
//
// 本文件用「真实 startServer() + HTTP」测服务端机制。AC1 的「改动前 <rect> 数 < 总数」是取假对照的
// 前半：改动前的代码只画最慢 50 根（60 文件 → 50 根 < 60），且没有分页去够其余 10 根——该行为由本任务
// 的 Proposal 实测记录，本测试断言改动后的可机械复现条件（page1=50<60、翻遍全部分页后 =60）。
//
// Run (scoped): node --test packages/quay/test/gap-webui-tests-page-timeline-gantt-truncated.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { clearVerificationRoundCache } from "../src/observation.ts";
import { buildTestsHref } from "../src/serve-tests.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** Same shape as serve-board.test.mjs's makeWorkspace — a bare tasks dir is not a legal workspace. */
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
 * Seed ONE round whose perFile carries `count` timed entries (all with startedAtMs/endedAtMs). Files are
 * written in start-time DESC order so the renderer's ASC sort is actually exercised (not satisfied by
 * construction). startedAtMs gaps (1500ms) exceed every duration (100..1000ms), so the latest-STARTING
 * file is also the latest-ENDING — AC3's "last page's last bar endedAtMs == global max" then holds on the
 * chronological tail, which is exactly what the pagination slices.
 * Returns { count, asc, maxEndFile } where `asc` is the entries sorted by startedAtMs ASC (the expected
 * render order) and `maxEndFile` is the file with the globally-largest endedAtMs.
 */
function seedTimelineRound(ws, count) {
  const t0 = 1724374800000;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const startedAtMs = t0 + i * 1500;
    const durationMs = 100 + ((i * 37) % 900);
    entries.push({
      file: `packages/quay/test/gantt-file-${String(i).padStart(3, "0")}.test.mjs`,
      durationMs,
      passed: i % 4 !== 0,
      startedAtMs,
      endedAtMs: startedAtMs + durationMs,
    });
  }
  const asc = [...entries].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const maxEnd = entries.reduce((m, e) => (e.endedAtMs > m.endedAtMs ? e : m));
  const rec = {
    round: 1,
    startedAt: new Date(t0).toISOString(),
    durationMs: count * 1500,
    state: "green",
    pass: count - Math.floor(count / 4), fail: Math.floor(count / 4), cancelled: 0, tests: count,
    commit: "0123456789abcdef0123456789abcdef01234567",
    scope: null, runner: null, gate: null, failures: null,
    perFile: [...entries].reverse(),
  };
  fs.writeFileSync(path.join(ws, ".quay", "verification-round.jsonl"), JSON.stringify(rec) + "\n");
  return { count, asc, maxEndFile: maxEnd.file, maxEndedAtMs: maxEnd.endedAtMs };
}

/** Extract the gantt <svg>…</svg> fragment (unique aria-label anchor) from the /tests HTML body. */
function extractGanttSvg(body) {
  const anchor = 'aria-label="Per-file test timeline (gantt)"';
  const a = body.indexOf(anchor);
  if (a < 0) return null;
  const start = body.lastIndexOf("<svg", a);
  const end = body.indexOf("</svg>", a);
  if (start < 0 || end < 0) return null;
  return body.slice(start, end + "</svg>".length);
}

/**
 * Count the gantt's BAR <rect>s. Legend swatches are ALSO `<rect>` (same gantt-bucket-* class) but carry
 * no `<title>` child, so a bar is exactly a `<rect …><title>` — one per plotted file, 1:1 with the timed
 * entries. (The AC's "`<rect` 元素个数" is this count: the number of plotted file bars.)
 */
function countBarRects(svg) {
  return (svg.match(/<rect class="gantt-bucket-[^"]*"[^>]*><title>/g) || []).length;
}

/** The ordered file paths of the gantt's bars (each bar's label link), in render order. */
function ganttFiles(svg) {
  return [...svg.matchAll(/href="\/tests\/file\?path=([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
}

/** The gantt's own `Next »` href (the only link whose href carries ganttPage=<n>), or null on the last page. */
function ganttNextHref(body) {
  return (body.match(/<a href="([^"]*ganttPage=\d+[^"]*)">Next &raquo;<\/a>/) ?? [])[1] ?? null;
}

test("buildTestsHref: gantt namespace is independent and drops defaults", () => {
  assert.equal(
    buildTestsHref({ round: null, page: 1, pageSize: 20, perFilePage: 1, perFilePageSize: 20, ganttPage: 2, ganttPageSize: 50 }),
    "/tests?ganttPage=2",
  );
  assert.equal(
    buildTestsHref({ round: null, page: 1, pageSize: 20, perFilePage: 1, perFilePageSize: 20, ganttPage: 1, ganttPageSize: 100 }),
    "/tests?ganttPageSize=100",
  );
});

test("AC1: gantt pagination makes every timed file reachable — page 1 is partial, sum across pages == total", async () => {
  const { ws } = makeWorkspace("gantt-ac1-");
  const cwd0 = process.cwd();
  let server;
  try {
    const { count } = seedTimelineRound(ws, 60);
    clearVerificationRoundCache();
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    // Fetch every gantt page directly (?ganttPage=N). The Next » link itself is covered by AC2 — here we
    // just sum the bars across the whole page range (the "翻遍全部分页页面" half of the AC).
    const totalPages = Math.ceil(count / 50);
    const pageBars = [];
    for (let p = 1; p <= totalPages; p++) {
      const url = p === 1 ? "/tests" : `/tests?ganttPage=${p}`;
      const r = await get(port, url);
      assert.equal(r.status, 200, `AC1: GET ${url} returns 200`);
      const svg = extractGanttSvg(r.body);
      assert.ok(svg, `AC1: ${url} renders the gantt`);
      pageBars.push(countBarRects(svg));
    }
    assert.equal(totalPages, 2, "AC1: 60 timed files / 50 per page == 2 pages");
    assert.deepEqual(pageBars, [50, 10], "AC1: page sizes are [50, 10]");
    assert.equal(pageBars.reduce((a, b) => a + b, 0), count, "AC1: sum of bars across all pages == timed files");
    // The falsifiability control: the OLD code plotted only the slowest 50 — 50 < 60 with NO way to reach
    // the other 10. Page 1 is still a partial window (50 < 60), but the rest is now reachable.
    assert.ok(pageBars[0] < count, `AC1: page 1 is a partial window (${pageBars[0]} < ${count})`);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC2: gantt has its own Page size + Next » nav (ganttPage/ganttPageSize), and Next » flips the first bar", async () => {
  const { ws } = makeWorkspace("gantt-ac2-");
  const cwd0 = process.cwd();
  let server;
  try {
    seedTimelineRound(ws, 60);
    clearVerificationRoundCache();
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const p1 = await get(port, "/tests");
    assert.equal(p1.status, 200, "AC2: GET /tests returns 200");
    // Independent namespace: the gantt's Page size links key off ganttPageSize (not pageSize / perFilePageSize).
    assert.ok(p1.body.includes('href="/tests?ganttPageSize=100"'), "AC2: gantt Page size option link (100) in its own namespace");
    assert.ok(p1.body.includes('href="/tests?ganttPageSize=20"'), "AC2: gantt Page size option link (20) present");
    const next = ganttNextHref(p1.body);
    assert.ok(next, "AC2: gantt Next » link present");
    assert.ok(next.includes("ganttPage=2"), `AC2: Next » points at ganttPage=2 (got ${next})`);
    assert.ok(!next.includes("perFilePage=") && !next.includes("pageSize="), `AC2: Next » does not touch the other namespaces (got ${next})`);

    const f1 = ganttFiles(extractGanttSvg(p1.body))[0] ?? null;
    const p2 = await get(port, next);
    const f2 = ganttFiles(extractGanttSvg(p2.body))[0] ?? null;
    assert.ok(f1 && f2, "AC2: both pages have a first bar");
    assert.notEqual(f1, f2, `AC2: Next » actually flips the page — first bar ${f1} → ${f2}`);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC3: bars are start-time ASC per page, and the last page's last bar is the globally latest-ending file", async () => {
  const { ws } = makeWorkspace("gantt-ac3-");
  const cwd0 = process.cwd();
  let server;
  try {
    const { asc, maxEndFile } = seedTimelineRound(ws, 60);
    clearVerificationRoundCache();
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const p1 = await get(port, "/tests");
    const files1 = ganttFiles(extractGanttSvg(p1.body));
    assert.deepEqual(files1, asc.slice(0, 50).map((e) => e.file), "AC3: page 1 bars are start-time ASC (matches sorted seed)");

    const p2 = await get(port, "/tests?ganttPage=2");
    const files2 = ganttFiles(extractGanttSvg(p2.body));
    assert.deepEqual(files2, asc.slice(50).map((e) => e.file), "AC3: page 2 bars are start-time ASC");
    // The chronological tail (not a duration-filtered subset): the last bar on the last page is the file
    // with the globally-largest endedAtMs.
    assert.equal(files2[files2.length - 1], maxEndFile, "AC3: last page's last bar is the globally latest-ending file");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC4: default /tests gantt SVG fragment is < 30,000 bytes", async () => {
  const { ws } = makeWorkspace("gantt-ac4-");
  const cwd0 = process.cwd();
  let server;
  try {
    seedTimelineRound(ws, 60);
    clearVerificationRoundCache();
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const r = await get(port, "/tests");
    assert.equal(r.status, 200, "AC4: GET /tests returns 200");
    const svg = extractGanttSvg(r.body);
    assert.ok(svg, "AC4: gantt SVG present");
    const bytes = Buffer.byteLength(svg, "utf8");
    assert.ok(bytes < 30_000, `AC4: gantt SVG < 30,000 bytes (got ${bytes})`);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("AC5: gantt title names the page range, never '仅显示最慢'", async () => {
  const { ws } = makeWorkspace("gantt-ac5-");
  const cwd0 = process.cwd();
  let server;
  try {
    seedTimelineRound(ws, 60);
    clearVerificationRoundCache();
    const port = await freePort();
    process.chdir(ws);
    server = await startServer({ port });

    const p1 = await get(port, "/tests");
    const svg1 = extractGanttSvg(p1.body);
    assert.ok(svg1, "AC5: page 1 renders the gantt");
    assert.ok(!svg1.includes("仅显示最慢"), "AC5: no '仅显示最慢' wording");
    assert.ok(svg1.includes("第 1/2 页"), "AC5: page 1 of 2");
    assert.ok(svg1.includes("共 60 个文件"), "AC5: total 60 files named");

    const p2 = await get(port, "/tests?ganttPage=2");
    const svg2 = extractGanttSvg(p2.body);
    assert.ok(svg2.includes("第 2/2 页"), "AC5: page 2 of 2");
    assert.ok(svg2.includes("本页 51–60"), "AC5: page 2 names its row range 51–60");
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
