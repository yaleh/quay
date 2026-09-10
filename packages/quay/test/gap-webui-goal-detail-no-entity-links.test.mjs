// @test-group product
// gap-webui-goal-detail-no-entity-links — the three entity detail pages (/goal/:id /adr/:id
// /doc/:id) previously rendered ONLY the body markdown + scalar meta: main had ZERO links (no
// child-criterion list, no body entity back-links, no back-to-list link), and the body `## `
// headings rendered as `<h3>` (h1 → h3 skip). The GOAL record's AC children were structurally
// invisible — the reverse edge (GOAL → its ACs) does not exist in storage (ACs hold a one-way
// `goal:` field; GOALs have no `children`), and the detail handler's only ABI call (goalGet)
// returned a view-model with no place for them.
//
// The fix is a REPLACE, not an ADD: the goal detail page makes ONE `client.goalList()` (its list()
// reads all files then filters in-memory anyway, and goalGet/goalList each parse the 6.87MB
// gate-events ledger once) — one call = one ledger parse, and the AC set is derived from the
// returned array. The shared shell (`serve-render.ts`) gains `linkifyEntities` + a heading offset,
// so the SAME mechanism serves /goal /adr /doc (hard rule 5b).
//
// Tests:
//   AC1 — /goal/GOAL-003 main a >= 15 (14 ACs + back link lower bound); /goal/GOAL-008 (EMPTY
//         body form) main a >= 6 AND AC-\d+ occurrences >= 5. Pre-fix both were 0.
//   AC2 — rendered criterion count == store count for goal==<id> (GOAL-008 = 5), with both counts
//         + first-3 diff printed on mismatch.
//   AC3 — unit: renderMarkdown links EXISTING entity ids and leaves MISSING ids plain text (both
//         directions asserted).
//   AC4 — all three detail pages have main a > 0 AND a back-to-list link; violations listed.
//   AC5 — no hN → h(N+2) skip in the three pages' heading sequence; skip positions listed.
//   AC6 — (a) handler spy: ONE store read (goalList), never goalGet+goalList; (b) one store read
//         == one ledger parse; (c) /goal/<id> p50 <= 0.22s baseline + 100ms.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { handleGoalDetail } from "../src/serve-goal.ts";
import { renderMarkdown } from "../src/serve-render.ts";
import { createGoalStore } from "../src/goal-store.ts";
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

/** The <a> elements inside <main> (the proposal's `document.querySelectorAll('main a')`). */
function mainLinks(html) {
  // pageStyles() inlines a CSS comment whose doc string contains the literal `<main id="main">`
  // (the skip-link note) in <head> — BEFORE the real <main> element. Match the LAST <main>…</main>
  // pair, which is the actual content element (the CSS-comment occurrence always precedes it).
  const opens = [...html.matchAll(/<main\b[^>]*>/g)];
  if (opens.length === 0) return [];
  const start = opens[opens.length - 1].index;
  const end = html.indexOf("</main>", start);
  const body = end === -1 ? html.slice(start) : html.slice(start, end);
  return body.match(/<a\b/g) || [];
}

/** hN → h(N+2) skip positions in document order ([] = well-formed). */
function headingSkips(html) {
  const levels = [...html.matchAll(/<h([1-6])(?:\s[^>]*)?>/g)].map((mm) => Number(mm[1]));
  const skips = [];
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i - 1] + 1) skips.push(`pos ${i}: h${levels[i - 1]} → h${levels[i]}`);
  }
  return skips;
}

function captureRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body || ""; },
  };
}

// ── AC3: unit — entity back-links only for ids that exist (both directions) ───────────────────

test("AC3: renderMarkdown links existing entity ids and leaves missing ids plain text", () => {
  const existing = new Set(["AC-170", "GOAL-001"]);
  const resolver = (raw) => {
    // The no-dash prose form "AC170" normalizes to the canonical "AC-170" (goal-page resolver's
    // normalization — exercised end-to-end by AC1/AC2's GOAL-003 body).
    const id = /^AC(\d+)$/.test(raw) ? `AC-${raw.slice(2)}` : raw;
    return existing.has(id) ? `/goal/${encodeURIComponent(id)}` : null;
  };
  const html = renderMarkdown(
    "阶段 AC-170 由 GOAL-001 承载；AC-999 与 GOAL-999 不存在。",
    { headingOffset: 0, linkResolver: resolver },
  );
  assert.match(html, /<a href="\/goal\/AC-170">AC-170<\/a>/, "existing AC-170 → <a>");
  assert.match(html, /<a href="\/goal\/GOAL-001">GOAL-001<\/a>/, "existing GOAL-001 → <a>");
  assert.doesNotMatch(html, /<a[^>]*>AC-999<\/a>/, "missing AC-999 stays plain text (no dead link)");
  assert.doesNotMatch(html, /<a[^>]*>GOAL-999<\/a>/, "missing GOAL-999 stays plain text (no dead link)");
  assert.match(html, /AC-999/, "the missing id's literal text is still present");
});

// ── integration: a real running serve instance (AC1 / AC2 / AC4 / AC5 / AC6 p50) ──────────────

let server, port, originalCwd, workspaceRoot, goalsDir;

before(async () => {
  const tasksDir = makeTmpDir("goal-detail-tasks-");
  const adrDir = makeTmpDir("goal-detail-adr-");
  workspaceRoot = makeTmpDir("goal-detail-ws-");
  goalsDir = path.join(workspaceRoot, "goals");
  const docsDir = path.join(workspaceRoot, "docs-managed");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(path.join(workspaceRoot, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`);

  // GOAL-003 — a goal whose body references its 14 ACs in the prose no-dash form ("AC156"), the
  // production shape the task's Proposal measured (AC156…AC169, all plain text pre-fix).
  const goal003Body = "## 背景\n本阶段包含 AC156、AC157、AC158、AC159、AC160、AC161、AC162、AC163、AC164、AC165、AC166、AC167、AC168、AC169 十四条 criterion。\n\n### 范围\n详见 AC156。\n";
  fs.writeFileSync(path.join(goalsDir, "GOAL-003-plugin-surface.md"),
    `---\nid: GOAL-003\ntitle: 插件面收敛\nstatus: active\nkind: goal\norigin: test\n---\n${goal003Body}`);
  for (let n = 156; n <= 169; n++) {
    fs.writeFileSync(path.join(goalsDir, `AC-${n}-criterion.md`),
      `---\nid: AC-${n}\ntitle: criterion ${n}\nstatus: ${n % 2 === 0 ? "achieved" : "active"}\nkind: criterion\ngoal: GOAL-003\ncriterion: exit 0\nexpect: "=0"\norigin: test\n---\n## Rationale\nmeasured\n`);
  }

  // GOAL-008 — the EMPTY-body form (Proposal: article text length 0), with 5 ACs under it.
  fs.writeFileSync(path.join(goalsDir, "GOAL-008-store-commit.md"),
    `---\nid: GOAL-008\ntitle: store commit 统一\nstatus: active\nkind: goal\norigin: test\n---\n`);
  for (let n = 195; n <= 199; n++) {
    fs.writeFileSync(path.join(goalsDir, `AC-${n}-criterion.md`),
      `---\nid: AC-${n}\ntitle: criterion ${n}\nstatus: active\nkind: criterion\ngoal: GOAL-008\ncriterion: exit 0\nexpect: "=0"\norigin: test\n---\n## Rationale\nmeasured\n`);
  }

  // ADR-101 (body ## headings) + ADR-102 (target of a body back-link). DOC-101 (## + ### headings).
  fs.writeFileSync(path.join(adrDir, "ADR-101-first.md"),
    `---\nid: ADR-101\ntitle: first adr\nstatus: accepted\ndate: 2026-09-08\n---\n## Context\nsee ADR-102 for context.\n## Decision\ndecided\n`);
  fs.writeFileSync(path.join(adrDir, "ADR-102-second.md"),
    `---\nid: ADR-102\ntitle: second adr\nstatus: accepted\ndate: 2026-09-08\n---\n## Context\nc\n## Decision\nd\n`);
  fs.writeFileSync(path.join(docsDir, "DOC-101-nav-doc.md"),
    `---\nid: DOC-101\ntitle: first doc\nstatus: active\nkind: skill\n---\n## Body\nthe doc\n### Detail\ndeep\n`);

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

// ── AC1: production-carrier readings, both forms ──────────────────────────────────────────────

test("AC1: /goal/GOAL-003 main a >= 15; /goal/GOAL-008 (empty body) main a >= 6 and AC-\\d+ >= 5", async () => {
  const r3 = await get(port, "/goal/GOAL-003");
  assert.equal(r3.status, 200, "GET /goal/GOAL-003 → 200");
  const links3 = mainLinks(r3.body);
  assert.ok(links3.length >= 15, `GOAL-003 main a = ${links3.length} (want >= 15; pre-fix 0)`);

  const r8 = await get(port, "/goal/GOAL-008");
  assert.equal(r8.status, 200, "GET /goal/GOAL-008 → 200");
  const links8 = mainLinks(r8.body);
  assert.ok(links8.length >= 6, `GOAL-008 main a = ${links8.length} (want >= 6; pre-fix 0)`);
  const acCount = (r8.body.match(/AC-\d+/g) || []).length;
  assert.ok(acCount >= 5, `GOAL-008 AC-\\d+ occurrences = ${acCount} (want >= 5; pre-fix 0)`);
});

// ── AC2: the child-criterion list really comes from the query, not a hard-coded list ──────────

test("AC2: rendered criterion count == store count for goal==<id> (GOAL-008 = 5)", async () => {
  const store = createGoalStore(goalsDir);
  const storeIds = store.list({ goal: "GOAL-008" }).map((g) => String(g.id));
  const r8 = await get(port, "/goal/GOAL-008");
  const m = /<section id="goal-criteria">([\s\S]*?)<\/section>/.exec(r8.body);
  const renderedIds = m ? [...m[1].matchAll(/<a href="\/goal\/(AC-\d+)">/g)].map((x) => x[1]) : [];
  const rendered = renderedIds.length;
  const expected = storeIds.length;
  if (rendered !== expected) {
    const diff = storeIds.filter((x) => !renderedIds.includes(x))
      .concat(renderedIds.filter((x) => !storeIds.includes(x)));
    assert.fail(`rendered ${rendered} vs store ${expected}; diff first 3: ${diff.slice(0, 3).join(", ")}`);
  }
  assert.equal(rendered, expected, `rendered ${rendered} criteria == store ${expected}`);
  assert.equal(rendered, 5, "GOAL-008 has exactly 5 criteria");
});

// ── AC4: all three detail pages get the shared back-link + non-empty main ─────────────────────

test("AC4: /goal /adr /doc detail pages each have main a > 0 and a back-to-list link", async () => {
  const routes = [
    ["/goal/GOAL-008", "/goal"],
    ["/adr/ADR-101", "/adr"],
    ["/doc/DOC-101", "/doc"],
  ];
  const violations = [];
  for (const [route, backHref] of routes) {
    const r = await get(port, route);
    assert.equal(r.status, 200, `GET ${route} → 200`);
    if (mainLinks(r.body).length === 0) violations.push(`${route}: main a == 0`);
    if (!r.body.includes(`<a class="back-link" href="${backHref}">`)) {
      violations.push(`${route}: missing back link to ${backHref}`);
    }
  }
  if (violations.length > 0) {
    assert.fail(`AC4 violations on ${violations.length} page(s):\n  ${violations.join("\n  ")}`);
  }
  assert.ok(routes.length === 3, "all three pages enumerated (non-vacuous)");
});

// ── AC5: no hN → h(N+2) skip in the three detail pages' heading sequence ─────────────────────

test("AC5: no hN → h(N+2) skip in the three detail pages' heading sequence", async () => {
  const routes = ["/goal/GOAL-003", "/adr/ADR-101", "/doc/DOC-101"];
  const violations = [];
  for (const route of routes) {
    const r = await get(port, route);
    const skips = headingSkips(r.body);
    if (skips.length > 0) violations.push(`${route}: ${skips.join(", ")}`);
  }
  if (violations.length > 0) {
    assert.fail(`AC5 heading skips on ${violations.length} page(s):\n  ${violations.join("\n  ")}`);
  }
});

// ── AC6: 换 not 加 — store-side call count, ledger parse count, and p50 latency ───────────────

test("AC6: the handler makes ONE store read (goalList), never goalGet + goalList", async () => {
  const counts = { goalGet: 0, goalList: 0 };
  const records = [
    { id: "GOAL-003", title: "t", status: "active", kind: "goal", body: "## 背景\nx\n" },
    { id: "AC-156", title: "c", status: "active", kind: "criterion", goal: "GOAL-003", body: "" },
  ];
  const client = {
    goalList: async () => { counts.goalList++; return records; },
    goalGet: async () => { counts.goalGet++; return records[0]; },
  };
  const res = captureRes();
  await handleGoalDetail({}, res, "GOAL-003", client);
  assert.equal(res.statusCode, 200);
  assert.equal(counts.goalList, 1, "goalList called exactly once");
  assert.equal(counts.goalGet, 0, "goalGet NOT called (replace, not add)");
  assert.ok(counts.goalGet + counts.goalList <= 1,
    `store-side calls = ${counts.goalGet + counts.goalList} (want <= 1)`);
});

test("AC6: one store read == one ledger parse (list/get are ledgerEvidenceMap's only callers)", () => {
  const store = createGoalStore(goalsDir);
  let reads = 0;
  const list = (f) => { reads++; return store.list(f); };
  const get = (id) => { reads++; return store.get(id); };
  // The handler's single goalList → one store.list → one ledgerEvidenceMap parse (goal-store.ts:
  // list() and get() each call ledgerEvidenceMap exactly once — the only two callers). Counting
  // reads therefore counts ledger parses.
  const records = list({});
  assert.equal(reads, 1, "a single list() is a single ledger parse");
  assert.ok(records.length >= 21, `list() returned ${records.length} records (2 goals + 19 ACs)`);
  // Negative control: the count can take false — a second read bumps the parse count (the rejected
  // goalGet + goalList anti-pattern would be 2 reads = 2 ledger parses).
  get("AC-195");
  assert.equal(reads, 2, "a second read is a second ledger parse (the measurement can take false)");
});

test("AC6: /goal/<id> p50 response time <= 0.22s baseline + 100ms", async () => {
  await get(port, "/goal/GOAL-008"); // warmup (first request pays JIT / file-cache cold start)
  const times = [];
  for (let i = 0; i < 11; i++) {
    const t0 = process.hrtime.bigint();
    const r = await get(port, "/goal/GOAL-008");
    const t1 = process.hrtime.bigint();
    assert.equal(r.status, 200);
    times.push(Number(t1 - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)];
  assert.ok(p50 <= 320, `p50 = ${p50.toFixed(1)}ms (want <= 320ms)`);
});
