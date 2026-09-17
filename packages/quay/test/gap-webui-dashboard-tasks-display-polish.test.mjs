// @test-group product
// gap-webui-dashboard-tasks-display-polish — three small display-layer fixes, one test file.
//
//   ① favicon:  /favicon.ico had NO route (grep favicon serve*.ts = 0 hits before this task) so every
//               page load fell through to the 404 tail and the browser console logged an error.
//   ② default sort: /tasks with no ?sort= rendered the Provider's raw order (≈ id order, oldest
//               historical tasks first). The param-less default is now the recent-first order —
//               the same one ?sort=updated asks for explicitly.
//   ③ work-progress row: the grid stretched the shorter column's flex stack to the row height, and
//               because the CONTAINER also painted --color-divider full-bleed, the leftover area
//               below the short column rendered as a large dark rectangle ("卡片没渲染完").
//
// Each test below carries its own negative control: the point of a display fix is that the OLD
// markup would FAIL the same predicate (hard rule 4c — a criterion that cannot take the other value
// proves nothing). The favicon test's control is the 404 on an unrouted path; the sort test's is
// `?sort=id`, which must NOT equal the default; the grid test's is the pre-change container tag,
// which must FAIL the "container paints no full-bleed divider" predicate.
//
// Run (scoped): node --experimental-strip-types --test packages/quay/test/gap-webui-dashboard-tasks-display-polish.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { renderWorkProgressRow } from "../src/serve-dashboard.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** Header-only task markdown (the list route renders frontmatter fields, not bodies). */
function taskFile(id, title, status = "todo") {
  return `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\nlabels: []\n---\n\n## Proposal\na\n## Plan\nb\n## Acceptance Criteria\n- [ ] c\n## Definition of Done\n- [ ] d\n`;
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

/** Ordered `href="/task/<id>"` targets as a browser would read them off the list page. The href
 *  carries a `?from=<list-url>` back-link query (the detail page's "back to the list" context), so
 *  the id stops at `?` — matching to the closing quote instead yields `SRT-C?from=/tasks`, which
 *  still compares equal across the two URLs but stops being an id. */
function listOrder(body) {
  return [...body.matchAll(/href="\/task\/([^"?]+)/g)].map((m) => decodeURIComponent(m[1]));
}

let server, port, originalCwd, workspaceRoot, tasksDir, accessLogPath;

before(async () => {
  tasksDir = fs.mkdtempSync(path.join(os.tmpdir(), "polish-tasks-"));
  workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polish-ws-"));
  accessLogPath = path.join(workspaceRoot, "polish-access.log");

  // Distinct mtimes, oldest first: SRT-A (oldest) → SRT-C (newest). quay-native's list() derives
  // updatedAt from the file mtime, so the spin-waits are what make the ordering assertion mean
  // something; without them three tasks written in the same millisecond would tie and the sort would
  // be untestable (a stable sort would hand back insertion order and pass vacuously).
  fs.writeFileSync(path.join(tasksDir, "SRT-A.md"), taskFile("SRT-A", "Sort A (oldest)"));
  const t0 = Date.now(); while (Date.now() - t0 < 60) { /* spin: force a distinct mtime */ }
  fs.writeFileSync(path.join(tasksDir, "SRT-B.md"), taskFile("SRT-B", "Sort B (middle)"));
  const t1 = Date.now(); while (Date.now() - t1 < 60) { /* spin */ }
  fs.writeFileSync(path.join(tasksDir, "SRT-C.md"), taskFile("SRT-C", "Sort C (most recent)"));

  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  originalCwd = process.cwd();
  process.chdir(workspaceRoot);
  server = await startServer({ port: 0, accessLogPath });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server.client) await server.client.close();
  process.chdir(originalCwd);
  fs.rmSync(tasksDir, { recursive: true, force: true });
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
});

// ── ① favicon ────────────────────────────────────────────────────────────────────────────────────

test("① /favicon.ico is routed (200 + image/svg+xml), and the unrouted path still 404s", async () => {
  const windowStart = new Date().toISOString();
  const r = await get(port, "/favicon.ico");

  assert.notEqual(r.status, 404, `GET /favicon.ico must not be 404 (got ${r.status})`);
  assert.equal(r.status, 200, `GET /favicon.ico returns 200 (got ${r.status})`);
  assert.match(String(r.headers["content-type"]), /^image\/svg\+xml/, "the icon carries an image MIME type");
  assert.match(r.body, /^<svg[\s>]/, "the icon body is SVG (starts with an <svg> element)");

  // the canonical name for the same asset is served from the same branch
  const svg = await get(port, "/favicon.svg");
  assert.equal(svg.status, 200, "GET /favicon.svg returns 200");
  assert.equal(svg.body, r.body, "both favicon paths serve the identical bytes (one asset, one source)");

  // NEGATIVE CONTROL — the favicon branch is a specific route, not a catch-all that suppresses 404s.
  // Without this half, "no more 404 on /favicon.ico" would be indistinguishable from "this server
  // stopped 404ing anything", which would be a worse defect than the one being fixed.
  const missing = await get(port, "/definitely-not-a-route-2026");
  assert.equal(missing.status, 404, `an unrouted path still 404s (got ${missing.status})`);

  // AC2's fresh-window sample. The access log records timestamp + method + path and NO status code
  // (see logAccess — it deliberately runs at request ENTRY so the line survives a handler error), so
  // the log can show the request arriving in this window but can never show its status. The status
  // half is the direct probe above, taken in the same window; the historical log could show neither.
  const lines = fs.readFileSync(accessLogPath, "utf8").split("\n").filter((l) => l.includes("GET /favicon.ico"));
  assert.ok(lines.length >= 1, "the fresh access log has a GET /favicon.ico line (request path exercised in THIS window)");
  for (const line of lines) {
    const ts = line.split(" ")[0];
    assert.ok(Date.parse(ts) >= Date.parse(windowStart), `access-log line is from this window, not history (${line})`);
  }
});

// ── ② /tasks default sort ────────────────────────────────────────────────────────────────────────

test("② /tasks with no ?sort= and /tasks?sort=updated render the SAME (recent-first) order", async () => {
  const noParam = await get(port, "/tasks");
  const explicit = await get(port, "/tasks?sort=updated");
  assert.equal(noParam.status, 200, "GET /tasks returns 200");
  assert.equal(explicit.status, 200, "GET /tasks?sort=updated returns 200");

  const a = listOrder(noParam.body);
  const b = listOrder(explicit.body);
  assert.ok(a.length >= 3, `the list page renders the seeded tasks (got ${a.length} task links)`);
  assert.deepEqual(a, b, `default order === ?sort=updated order (default=[${a}] explicit=[${b}])`);

  // Anchor the shared order to a KNOWN one: two identically-WRONG orders would satisfy deepEqual
  // above, so assert the content too — most-recently-modified first.
  assert.deepEqual(a, ["SRT-C", "SRT-B", "SRT-A"], `the shared default order is recent-first (got [${a}])`);

  // NEGATIVE CONTROL — the extraction really is order-sensitive: ?sort=id is the OPPOSITE order, so
  // the equality above is not an artifact of `listOrder` returning a constant.
  const byId = await get(port, "/tasks?sort=id");
  assert.deepEqual(listOrder(byId.body), ["SRT-A", "SRT-B", "SRT-C"], "?sort=id is still id-ascending (untouched)");

  // The nav's "Default" entry links to the param-less URL, so it must be the bold (active) one there,
  // and it must NOT be bold on the explicit URL — otherwise the label would lie about the URL.
  assert.match(noParam.body, /<strong>Default<\/strong>/, "the param-less URL marks Default as the active sort");
  assert.ok(!/<strong>Default<\/strong>/.test(explicit.body), "?sort=updated does not mark Default active");
  assert.match(explicit.body, /<strong>Updated ↓<\/strong>/, "?sort=updated marks Updated ↓ as the active sort");
});

// ── ③ work-progress row: no stretched short column, no full-bleed divider ────────────────────────

const tinyCard = (id) => `<div id="${id}" style="background:var(--color-surface)">x</div>`;
const tallCard = (id, n) => `<div id="${id}" style="background:var(--color-surface)">${"<div>row</div>".repeat(n)}</div>`;

/** The grid container's opening tag — the element whose inline style decides both the stretch
 *  behaviour and what colour is painted under the uncovered region. */
function containerOpenTag(rowHtml) {
  const end = rowHtml.indexOf(">");
  assert.ok(end > 0, "the row starts with an element whose opening tag we can read");
  return rowHtml.slice(0, end + 1);
}

/** True iff the CONTAINER paints the divider colour across its whole box. A grid row is as tall as
 *  its tallest item regardless of `align-items`, so a container-level divider fill is what turns the
 *  short column's leftover area into a dark rectangle. */
function containerPaintsFullBleedDivider(openTag) {
  return /background:\s*var\(--color-divider\)/.test(openTag);
}

/** The two grid items (the per-column flex stacks) — the elements that must carry the divider colour
 *  now that the container does not. */
function columnStacks(rowHtml) {
  return [...rowHtml.matchAll(/<div style="display:flex;flex-direction:column;gap:2px;background:var\(--color-divider\)">/g)];
}

for (const [label, [goal, task], [tests, fan]] of [
  ["left column markedly shorter", [tinyCard("goal-card"), tinyCard("task-card")], [tallCard("tests-card", 60), tallCard("fanin-card", 60)]],
  ["right column markedly shorter", [tallCard("goal-card", 60), tallCard("task-card", 60)], [tinyCard("tests-card"), tinyCard("fanin-card")]],
]) {
  test(`③ work-progress row (${label}) does not stretch the short column over a divider fill`, () => {
    const row = renderWorkProgressRow(goal, task, tests, fan);
    const openTag = containerOpenTag(row);

    // (a) the reported fix: the grid must not stretch items to the row height.
    assert.match(openTag, /align-items:start/, `the grid stops stretching the short column (${openTag})`);

    // (b) the half that makes (a) observable — the container must NOT paint the divider colour, or
    // the uncovered region would render exactly as before.
    assert.ok(
      !containerPaintsFullBleedDivider(openTag),
      `the container paints no full-bleed divider fill (${openTag})`,
    );
    assert.match(openTag, /background:transparent/, "the container is explicitly transparent");

    // …because the divider moved ONTO the two column stacks, which is what keeps the intra-column
    // 2px separators between stacked cards.
    assert.equal(columnStacks(row).length, 2, "both column stacks carry the divider colour");

    // Unchanged shape: the outer outline and the 2px gutter survive, so this is still the .dash-grid
    // row the ≤600px single-column media query collapses.
    assert.match(openTag, /gap:2px/, "the row keeps its 2px gap");
    assert.match(openTag, /border:1px solid var\(--color-divider\)/, "the row keeps its 1px divider border");
    assert.match(openTag, /class="dash-grid"/, "the row keeps the .dash-grid class (mobile collapse target)");
  });
}

test("③ negative control: the pre-fix container tag FAILS the no-full-bleed-divider predicate", () => {
  // The literal the helper used to emit (serve-dashboard.ts:1235 before this task). If this control
  // ever fails, the predicate above has stopped distinguishing old from new and the tests it backs
  // are vacuous.
  const oldStyle =
    `<div class="dash-grid" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2px;background:var(--color-divider);border:1px solid var(--color-divider);margin-bottom:1.5rem;">`;
  assert.equal(containerPaintsFullBleedDivider(oldStyle), true, "the pre-fix container is detected as full-bleed");
  assert.ok(!/align-items:start/.test(oldStyle), "the pre-fix container had no align-items:start");

  const newStyle = containerOpenTag(renderWorkProgressRow(tinyCard("goal-card"), tinyCard("task-card"), tallCard("tests-card", 60), tallCard("fanin-card", 60)));
  assert.equal(containerPaintsFullBleedDivider(newStyle), false, "the fixed container is not full-bleed");
  assert.notEqual(newStyle, oldStyle, "old and new container tags are distinguishable by value, not only by reading");
});
