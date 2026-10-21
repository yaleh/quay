// @test-group product
// gap-goal-needs-human-missing-from-three-goal-surfaces — the Goals tab had NO entry point that
// reached a `needs-human` goal, and no rank for the status either:
//
//   ① `GOAL_STATUS_ORDER` listed 5 of the ABI's 6 goal statuses, so `needs-human` fell through
//      `goalStatusRank`'s `-1` branch and sank to the BOTTOM of the default order — the goals most
//      in need of a human sorted last (below `retired`).
//   ② the `statusNav` filter row was `["draft","active","achieved","superseded","retired"]`, so
//      `?status=needs-human` had records but no link anywhere on the page that reached it.
//
// Both are LATENT today (0 goals are in needs-human), which is exactly why they survived: the
// defect only becomes visible the first time a goal is escalated. The defect was carried as a
// `KNOWN_DRIFT` row in `plugin/scripts/enum-surface-parity-check.ts` ("归位待另行立案") — this task
// is the 立案, so the rows came OUT of the ledger (it is shrink-only) and the surfaces were fixed.
//
// These arms read the PRODUCTION render path (`startServer` + a real HTTP GET against a fixture
// workspace on disk), not a fixture-only seam: the row order asserted below is the order the real
// `/goal` handler emits, and the nav link is parsed out of the real page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve/serve.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** Every goal status the ABI declares (`packages/quay/src/abi.ts:GOAL_STATUSES`, 6 values) — the
 *  fixture below puts EXACTLY ONE goal in each, so "the order is right" is a statement about all
 *  six, not about the one status this task added. ⛔ Hard-coded here on purpose: reading it from
 *  the ABI would make the "one goal in every status" claim vacuous if the ABI grew a 7th value
 *  (the fixture would silently stop covering it). */
const ALL_GOAL_STATUSES = ["draft", "active", "achieved", "superseded", "retired", "needs-human"];

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** The Goals-tab data rows in the order the server emitted them: {id, status}. */
function goalRows(html) {
  const m = /<table[^>]*>([\s\S]*?)<\/table>/.exec(html);
  if (!m) return [];
  const trs = [...m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((x) => x[1]).filter((r) => !/<th/.test(r));
  return trs.map((r) => {
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    return {
      id: (/href="\/goal\/([^"]+)"/.exec(cells[0] || "") || [])[1] || "",
      status: (cells[1] || "").replace(/<[^>]*>/g, "").trim(),
    };
  });
}

/** The status-filter row's anchors, in rendered order (the `<p class="meta">Status: …</p>` line). */
function statusNavHrefs(html) {
  const m = /<p class="meta">Status: ([\s\S]*?)<\/p>/.exec(html);
  if (!m) return [];
  return [...m[1].matchAll(/href="([^"]*)"/g)].map((x) => x[1]);
}

let server, port, originalCwd, workspaceRoot, goalsDir;

before(async () => {
  const tasksDir = makeTmpDir("goal-needs-human-tasks-");
  const adrDir = makeTmpDir("goal-needs-human-adr-");
  workspaceRoot = makeTmpDir("goal-needs-human-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);

  const goal = (id, title, status) =>
    fs.writeFileSync(path.join(goalsDir, `${id}-goal.md`),
      `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nkind: goal\norigin: test\n---\n## 背景\nmeasured\n`);

  // ONE goal per ABI status. IDs ascend in the SAME order as the statuses would sort if the sort
  // were a no-op: GOAL-001 draft, GOAL-002 active, GOAL-003 achieved, GOAL-004 superseded,
  // GOAL-005 retired, GOAL-006 needs-human. ⇒ an id-locale fallback (the pre-gap-webui order) would
  // emit 001..006 and an all-equal rank would emit 001..006 too; the expected order below is
  // neither, so the assertion cannot be satisfied by "sorting silently did nothing" (硬规则 4:
  // a reading that a broken implementation also produces is not a measurement).
  goal("GOAL-001", "draft goal", "draft");
  goal("GOAL-002", "active goal", "active");
  goal("GOAL-003", "achieved goal", "achieved");
  goal("GOAL-004", "superseded goal", "superseded");
  goal("GOAL-005", "retired goal", "retired");
  goal("GOAL-006", "escalated goal", "needs-human");
  // …plus one goal whose status is not in the ABI at all. It is the NEGATIVE CONTROL for the two
  // arms below: an unknown status must still sink to the bottom. Without it, "needs-human is not
  // last" could be satisfied by a rank function that stopped fail-closing entirely.
  goal("GOAL-007", "unknown-status goal", "bogus-status");

  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0 });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
});

// ── AC3a: the needs-human row sorts DIRECTLY AFTER draft ─────────────────────────────────────

test("AC3a: default order places needs-human immediately after draft (not last, not unknown)", async () => {
  const r = await get(port, "/goal");
  assert.equal(r.status, 200);
  const rows = goalRows(r.body);
  const order = rows.map((x) => x.status);

  // The 5 ABI statuses that were ALREADY ranked keep their pre-existing order, with needs-human
  // inserted between draft and achieved — asserted as the full literal sequence, so "it moved
  // somewhere" cannot pass for "it moved to the right place".
  assert.deepEqual(order.slice(0, 6), ["active", "draft", "needs-human", "achieved", "superseded", "retired"],
    `Goals-tab default order (first 6 rows): got ${JSON.stringify(order)}`);
  const nhIdx = order.indexOf("needs-human");
  assert.equal(nhIdx, 2, "needs-human is the 3rd row (index 2)");
  assert.ok(nhIdx > order.indexOf("draft"), "needs-human sorts AFTER draft");
  assert.ok(nhIdx < order.indexOf("achieved"), "…and BEFORE achieved/superseded/retired");

  // The specific goal the status ordering is about: the escalated one is reachable near the TOP of
  // the list, not buried under the terminal states (pre-fix it was the 6th of 6 known statuses).
  assert.equal(rows[nhIdx].id, "GOAL-006", "the escalated goal occupies the needs-human slot");

  // Negative control (the arm that makes the one above a measurement): `bogus-status` is NOT in
  // `GOAL_STATUS_ORDER`, so `goalStatusRank`'s `-1` branch must still sink it past `retired`. If
  // this row ever ranks beside the known statuses, the ordering above stopped meaning anything.
  assert.equal(order[order.length - 1], "bogus-status",
    `unknown status must still sink to the bottom (fail-closed); full order: ${JSON.stringify(order)}`);
});

// ── AC3b: the tab nav carries a real entry point to ?status=needs-human ──────────────────────

test("AC3b: the status filter row links to status=needs-human", async () => {
  const r = await get(port, "/goal");
  assert.equal(r.status, 200);
  const hrefs = statusNavHrefs(r.body);
  assert.ok(hrefs.length > 0, "the Goals tab renders a status filter row");
  assert.ok(hrefs.some((h) => /[?&]status=needs-human(&|$)/.test(h)),
    `the filter row carries a needs-human link; got ${JSON.stringify(hrefs)}`);
  // …and the pre-existing five links are still there (the entry point was ADDED, not substituted).
  for (const s of ["draft", "active", "achieved", "superseded", "retired"]) {
    assert.ok(hrefs.some((h) => new RegExp(`[?&]status=${s}(&|$)`).test(h)),
      `the ${s} link survived (got ${JSON.stringify(hrefs)})`);
  }
});

// ── AC3c: the link is an ENTRY POINT — following it actually reaches the record ──────────────

test("AC3c: following the needs-human link returns exactly the escalated goal", async () => {
  const nav = statusNavHrefs((await get(port, "/goal")).body);
  const link = nav.find((h) => /[?&]status=needs-human(&|$)/.test(h));
  assert.ok(link, "a needs-human link exists to follow");
  const r = await get(port, link);
  assert.equal(r.status, 200);
  const rows = goalRows(r.body);
  assert.deepEqual(rows.map((x) => x.id), ["GOAL-006"],
    "the filtered page shows exactly the escalated goal (the link is not a dead href)");
  assert.deepEqual(rows.map((x) => x.status), ["needs-human"],
    "…and its status cell renders the status itself");
});

// ── AC3d: the two arms above are about needs-human SPECIFICALLY, across the whole ABI list ───

test("AC3d: every ABI goal status has a nav link, and each one filters to its own goal", async () => {
  const nav = statusNavHrefs((await get(port, "/goal")).body);
  const missing = ALL_GOAL_STATUSES.filter((s) => !nav.some((h) => new RegExp(`[?&]status=${s}(&|$)`).test(h)));
  assert.deepEqual(missing, [], `ABI goal statuses with no filter entry point: ${JSON.stringify(missing)}`);

  // Each link resolves to the goal the fixture filed under that status — one arm per status, so a
  // link that merely EXISTS but points at the wrong filter is caught here rather than by eye.
  const expectedId = { draft: "GOAL-001", active: "GOAL-002", achieved: "GOAL-003", superseded: "GOAL-004", retired: "GOAL-005", "needs-human": "GOAL-006" };
  const wrong = [];
  for (const s of ALL_GOAL_STATUSES) {
    const link = nav.find((h) => new RegExp(`[?&]status=${s}(&|$)`).test(h));
    const rows = goalRows((await get(port, link)).body);
    const ids = rows.map((x) => x.id);
    if (ids.length !== 1 || ids[0] !== expectedId[s]) wrong.push(`status=${s} → ${JSON.stringify(ids)} (want ["${expectedId[s]}"])`);
  }
  assert.deepEqual(wrong, [], `filter links that do not reach their own record:\n  ${wrong.join("\n  ")}`);
});
