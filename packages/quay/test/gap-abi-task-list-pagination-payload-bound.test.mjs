// @test-group product
// gap-abi-task-list-times-out-at-2000-tasks-head-of-line-blocks-mcp — the ABI
// `task_list` head-of-line block.
//
// THE DEFECT THIS FILE PINS: `task_list` resolved the WHOLE filtered set and shipped
// every matching task WITH ITS BODY, no matter how few the caller asked for — the
// `pageSize` argument only ever sliced a payload that had already been fully
// transferred. On the live store (2135 tasks / 14.4 MB of bodies) the ABI round trip
// measured 34-52 s, and because the response was raw payload the framing cost was
// super-linear in store size; Core's MCP server is single-threaded, so an unrelated
// `task_get` (2 ms of real work) queued behind it and the caller saw `-32001 Request
// timed out`. That made the ABI-only `quay:quay-task` subagent — CLAUDE.md's
// designated task-CRUD entry point, whose tool allowlist has no CLI fallback —
// structurally unusable at this store's size.
//
// WHAT IS PINNED HERE (AC1 / AC2 / AC5 of the task):
//   1. WALL-CLOCK: on a synthetic store of N >= 2000 tasks with realistic (~4 KB)
//      bodies, a WARM `task_list({page:1, pageSize:1})` returns inside PAGE1_BUDGET_MS.
//      The warm-up call matters: a cold call is dominated by the Provider subprocess
//      spawn (~0.7 s), which would measure Node's startup rather than the query.
//   2. PAYLOAD: the same response's serialized size stays far below the store's total
//      body bytes — i.e. page size bounds the payload. This assertion is deterministic
//      (no timing), so it discriminates the fix under ANY machine load, and it is the
//      half of the pair that fails on the pre-fix code even when the machine is fast.
//   3. PAGING SHAPE: `paged: true`, `total` = the filtered count (not the page length),
//      `totalPages`, and `pageSize` returning exactly that many tasks.
//   4. CORRECTNESS OF THE PUSH-DOWN: the Provider-side filtered+paginated result must
//      equal what the store's own client-side filtering would have produced. The fix
//      moved status/label/prefix/search filtering from Core into the Provider; if their
//      predicates ever drift, the ABI would silently answer a different question.
//   5. BACK-COMPAT: with no page arguments at all the response is the whole filtered
//      set (`paged` absent/false) — the pre-existing contract, unchanged.
//
// WHY A SYNTHETIC STORE AND NOT THE LIVE ONE: the live store is 2000+ files of ~7 KB
// that change under the test (the loop is writing to it), so timing it would be a test
// of the machine and of whatever else is running. The synthetic store fixes N and the
// body size, which is what makes the timing assertion reproducible; the live-store
// reading is taken separately as the task's own AC evidence.
//
// Run: scripts/test.sh packages/quay/test/gap-abi-task-list-pagination-payload-bound.test.mjs

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// AC5: the store under test is N >= 2000. THE POINT OF THE SIZE is that the pre-fix
// code transfers one body per task regardless of `pageSize`; a store small enough to
// fit in a few hundred KB would let the defect pass unnoticed.
const SYNTHETIC_TASK_COUNT = 2000;
// ~4 KB of body per task => ~8 MB of bodies in the store, against which a
// `pageSize:1` response of a few KB is unmistakable.
const BODY_BYTES = 4096;

// The wall-clock bound for a WARM pageSize=1 read. It sits between the two regimes
// with a wide margin on both sides rather than being a tuned number: measured warm
// ~1 s pre-fix (the whole 8 MB store) vs ~0.03 s post-fix (one body), on the same
// host, and it is the same 5 s the task's AC1 states for the live store.
const PAGE1_BUDGET_MS = 5000;
// A `pageSize:1` response carries one task. 64 KB is ~4 orders of magnitude below the
// store's ~8 MB of bodies, so this cannot pass by accident, and it does not depend on
// machine speed at all.
const PAGE1_MAX_RESPONSE_BYTES = 64 * 1024;

const cleanups = [];
after(() => {
  for (const fn of cleanups.reverse()) {
    try {
      fn();
    } catch {
      // best-effort teardown
    }
  }
});

/** Write `n` tasks with realistic bodies straight to disk (no lock/commit machinery —
 *  this is a read-path fixture, and `store.write()`'s commit hook is not under test). */
function seedSyntheticStore(tasksDir, n, bodyBytes) {
  fs.mkdirSync(tasksDir, { recursive: true });
  const filler = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(
    Math.ceil(bodyBytes / 56)
  );
  for (let i = 0; i < n; i++) {
    const id = `SYN-${String(i).padStart(5, "0")}`;
    // Statuses alternate so a status filter has something to select on; every 10th
    // task carries a shared label so AND-join label filtering is exercised too.
    const status = i % 3 === 0 ? "ready" : "todo";
    const labels = i % 10 === 0 ? "  - synthetic-group\n" : "";
    const body =
      `\n## Proposal\n\n${filler}\n\n## Plan\n\n${filler}\n\n` +
      `## Acceptance Criteria\n\n- [ ] done\n\n## Definition of Done\n\n${filler}\n`;
    fs.writeFileSync(
      path.join(tasksDir, `${id}.md`),
      `---\nid: ${id}\ntitle: Synthetic task ${i}\nstatus: ${status}\nlabels:\n${labels}---\n${body}`,
      "utf8"
    );
  }
}

async function connectProviderMcp(tasksDir) {
  const isTs = QUAY_NATIVE_CLI.endsWith(".ts");
  const transport = new StdioClientTransport({
    command: "node",
    args: [...(isTs ? ["--experimental-strip-types"] : []), QUAY_NATIVE_CLI, "mcp"],
    cwd: path.join(__dirname, "..", "..", "quay-native"),
    env: { ...process.env, QUAY_NATIVE_TASKS_DIR: tasksDir },
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "abi-list-payload-test", version: "0.0.1" });
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

// Seeding 2000 files is the expensive part of this file, so the DEFAULT-size store is
// built once and shared by every test that needs it (it is read-only in all of them).
let sharedFullStore = null;
function makeSyntheticWorkspace(n = SYNTHETIC_TASK_COUNT) {
  if (n === SYNTHETIC_TASK_COUNT && sharedFullStore) return sharedFullStore;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quay-abi-list-payload-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const tasksDir = path.join(root, "tasks");
  seedSyntheticStore(tasksDir, n, BODY_BYTES);
  const ws = { root, tasksDir };
  if (n === SYNTHETIC_TASK_COUNT) sharedFullStore = ws;
  return ws;
}

test("ABI task_list: pageSize bounds the payload, not just the slice (N=2000 store)", async () => {
  const { tasksDir } = makeSyntheticWorkspace();
  const client = await connectProviderMcp(tasksDir);

  // Warm-up: the measured call must time the QUERY, not the Provider subprocess's
  // startup (~0.7 s) — measured separately, the cold cost is identical for a 1-task
  // and a 2000-task store and would therefore hide exactly the defect this pins.
  await client.callTool({ name: "task_list", arguments: { page: 1, pageSize: 1 } });

  const t0 = Date.now();
  const r = await client.callTool({ name: "task_list", arguments: { page: 1, pageSize: 1 } });
  const elapsed = Date.now() - t0;
  const sc = r.structuredContent;
  const responseBytes = JSON.stringify(r).length;

  assert.equal(r.isError ?? false, false, `task_list must succeed (got isError: ${JSON.stringify(r.content)})`);
  assert.equal(sc.tasks.length, 1, `pageSize:1 returns exactly 1 task (got ${sc.tasks.length})`);
  assert.equal(
    sc.total,
    SYNTHETIC_TASK_COUNT,
    `total is the FILTERED count, not the page length (got ${sc.total})`
  );
  assert.equal(sc.paged, true, "the Provider reports the response as a page of the filtered set");

  // (1) wall clock — AC5's assertion. Warm, so this is the query's own cost.
  assert.ok(
    elapsed < PAGE1_BUDGET_MS,
    `AC1/AC5: warm task_list({pageSize:1}) on a ${SYNTHETIC_TASK_COUNT}-task store must return in < ${PAGE1_BUDGET_MS} ms ` +
      `(got ${elapsed} ms; the pre-fix code transferred all ${SYNTHETIC_TASK_COUNT} bodies and took ~1 s warm / ~18 s cold here)`
  );

  // (2) payload — the deterministic half. On the pre-fix code this response was the
  // whole store (~8 MB), so this assertion fails there independently of any timing.
  assert.ok(
    responseBytes < PAGE1_MAX_RESPONSE_BYTES,
    `AC2: a pageSize:1 response must not carry the store (got ${responseBytes} bytes, ` +
      `budget ${PAGE1_MAX_RESPONSE_BYTES}; the store holds ~${SYNTHETIC_TASK_COUNT * BODY_BYTES} bytes of bodies)`
  );

  // (3) page/200 must also be bounded by the page, and must differ from pageSize:1 —
  // the cost has to track the number of tasks RETURNED.
  const t1 = Date.now();
  const big = await client.callTool({ name: "task_list", arguments: { page: 1, pageSize: 200 } });
  const bigElapsed = Date.now() - t1;
  const bigBytes = JSON.stringify(big).length;
  assert.equal(big.structuredContent.tasks.length, 200, `pageSize:200 returns 200 tasks (got ${big.structuredContent.tasks.length})`);
  assert.equal(big.structuredContent.total, SYNTHETIC_TASK_COUNT, "pageSize does not change the filtered total");
  assert.ok(
    bigBytes > responseBytes,
    `AC2: the response cost must grow with pageSize (pageSize:200 = ${bigBytes} bytes vs pageSize:1 = ${responseBytes} bytes)`
  );
  assert.ok(
    bigBytes < SYNTHETIC_TASK_COUNT * BODY_BYTES / 2,
    `AC2: even the maximum page (200 tasks) stays far below the store's total body bytes ` +
      `(got ${bigBytes}, store ~${SYNTHETIC_TASK_COUNT * BODY_BYTES})`
  );
  assert.ok(
    bigElapsed < PAGE1_BUDGET_MS * 4,
    `a 200-task page is still bounded (got ${bigElapsed} ms)`
  );
});

test("ABI task_list: pushed-down filters/paging agree with the store's own filtering", async () => {
  const { tasksDir } = makeSyntheticWorkspace();
  const client = await connectProviderMcp(tasksDir);
  const store = createStore(tasksDir);

  // Correctness of moving the filter into the Provider: for each filter the ABI
  // accepts, every page of the Provider's answer must be exactly the corresponding
  // window of what the store's own list() would have returned. A predicate drift
  // (status coercion, id fallback, label defaulting, prefix case) shows up here as a
  // mismatch rather than as a silently different answer in production.
  const cases = [
    { name: "status", args: { status: "ready" }, local: { status: "ready" } },
    { name: "prefix", args: { prefix: "SYN-0001" }, local: { prefix: "SYN-0001" } },
    {
      name: "label (array, AND-join)",
      args: { label: ["synthetic-group"] },
      local: { label: ["synthetic-group"] },
    },
  ];

  for (const c of cases) {
    const expected = store.list(c.local).map((t) => t.id);
    assert.ok(expected.length > 0, `fixture sanity: the ${c.name} filter selects something`);

    const collected = [];
    const pageSize = 100;
    for (let page = 1; page <= Math.ceil(expected.length / pageSize); page++) {
      const r = await client.callTool({
        name: "task_list",
        arguments: { ...c.args, page, pageSize },
      });
      const sc = r.structuredContent;
      assert.equal(
        sc.total,
        expected.length,
        `${c.name}: total must equal the store's own filtered count (got ${sc.total}, expected ${expected.length})`
      );
      collected.push(...sc.tasks.map((t) => t.id));
    }
    assert.deepEqual(
      collected,
      expected,
      `${c.name}: the Provider's pushed-down filter+page must reproduce the store's own filtered order exactly`
    );
  }

  // Deeper pages of a real filter must be the right SLICE — the pre-fix code paged
  // client-side, so a push-down that paged BEFORE filtering would show up here.
  const readyIds = store.list({ status: "ready" }).map((t) => t.id);
  const page3 = await client.callTool({
    name: "task_list",
    arguments: { status: "ready", page: 3, pageSize: 100 },
  });
  assert.deepEqual(
    page3.structuredContent.tasks.map((t) => t.id),
    readyIds.slice(200, 300),
    "page 3 of a status-filtered query is the 3rd 100-task window of the filtered set"
  );
  assert.equal(
    page3.structuredContent.totalPages,
    Math.ceil(readyIds.length / 100),
    "totalPages is derived from the filtered count, not the page length"
  );
});

test("ABI task_list: omitting page arguments keeps the whole-set contract (back-compat)", async () => {
  // A SMALL store, because this path is SUPPOSED to return every matching body — the
  // point here is the shape, and a 20-task store proves it without re-introducing the
  // very transfer this task fixed.
  const { tasksDir } = makeSyntheticWorkspace(20);
  const client = await connectProviderMcp(tasksDir);
  const store = createStore(tasksDir);

  const r = await client.callTool({ name: "task_list", arguments: {} });
  const sc = r.structuredContent;
  assert.equal(sc.tasks.length, 20, `an unpaged task_list returns every task (got ${sc.tasks.length})`);
  assert.equal(sc.total, 20, "an unpaged task_list reports total = all matching tasks");
  assert.ok(
    sc.paged !== true,
    "an unpaged task_list must not claim to be a page — a caller must be able to tell 'whole set' from 'window' (硬规则 3b)"
  );
  // Bodies really are present on this path (it is the pre-existing contract, and the
  // reason a paged call exists at all).
  assert.ok(
    typeof sc.tasks[0].body === "string" && sc.tasks[0].body.length > 0,
    "the unpaged/default response still carries bodies"
  );
  assert.deepEqual(
    sc.tasks.map((t) => t.id).sort(),
    store.list().map((t) => t.id).sort(),
    "unpaged task_list returns the store's own list() id set"
  );
});
