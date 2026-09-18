// @test-group product
// gap-webui-tests-body-copy-en-zh — /tests（含 /tests/file）的【正文文案】本地化（正文本地化系列，
// 照 gap-webui-dashboard-body-copy-en-zh 定下的 pattern）。
//
// 病灶：AC-298 把 /tests 的【外壳】（`<html lang>`、nav 当前项、`<title>`、`<h1>`、移动菜单标签）接到了
// serve-i18n.ts 的字典，但页面**正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个「框是英文、
// 内容是中文」的页面。实测红基线（真实 workspace + `Cookie: lang=en`，去标签后按行统计含 CJK 的行）：
//   • /tests 有记录态 26 条 → 改后 4 条
//   • /tests 空态      8 条 → 改后 4 条
//   • /tests/file      13 条 → 改后 2 条
// 改后剩下的 4/2 条全部是**刻意不译**的三类：切换控件的 endonym「中文」、`obsNote` 的共享外壳标签、
// 以及 reader 诊断串与台账里的失败用例名（数据）。本文件把这个分类**做成机械判据**，而不是留在任务体
// 的散文里。
//
// 本文件验证：
//   • 字典完备且被类型强制：`TESTS_LABELS` 是 `Record<TestsKey,{en,zh}>`，每键两列非空、en 列无 CJK、
//     zh 列含 CJK 或与 en 逐字相同（见 `zhArmOk`：后者不是放宽，是更强的谓词）。
//   • 取词函数的两条 throw 路径（未知键 / 缺参数）—— 硬规则 3b 的那半边：读不懂输入时不得返回与
//     「合格」同形的值。缺参数若静默留 `{code}`，页面会把自己的模板语法渲染出来，而没有一条
//     「页面上有没有该有的值」的检查会变红。
//   • 黑盒两态两页：真实 `startServer`（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`。
//   • **零计数的对照**（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中——否则「en 下 0 条」可能
//     只是谓词坏了。
//   • 数据判据：一条含中文的**失败用例名**在两种语言下逐字出现（它是台账的数据，⛔ 不翻译）。
//
// Run (scoped): node --test packages/quay/test/serve-tests-body-i18n.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { TESTS_LABELS, TESTS_KEYS, testsLabelsFor, testsLabel, fillLabel } from "../src/serve-i18n.ts";
import { readTests } from "../src/observation.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes this task is defined against: Han, CJK punctuation and the full-width forms.
 *  Built from CODE POINTS rather than written as a literal range — the file that defines "Chinese
 *  copy" is the last place that should itself contain Chinese (a literal range would make every
 *  future CJK sweep of this tree flag this file). */
const cp = (n) => String.fromCharCode(n);
const CJK = new RegExp(`[${cp(0x4e00)}-${cp(0x9fff)}${cp(0x3000)}-${cp(0x303f)}${cp(0xff00)}-${cp(0xffef)}]`);

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
  });
}

/** The page's VISIBLE text: styles/scripts dropped, tags stripped, entities decoded — the unit the
 *  red baseline was measured in, so the test and the measurement speak the same language. */
function visibleText(body) {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Every visible line carrying a CJK character. */
function cjkLines(body) {
  return visibleText(body).split("\n").map((s) => s.trim()).filter((s) => s.length > 0 && CJK.test(s));
}

/** The language switcher's ENDONYM, which is DELIBERATELY the same in both columns (serve-i18n.ts
 *  ROW 4: a reader who cannot read the current UI language must still be able to FIND their own). It
 *  is therefore the one Chinese word an English page is SUPPOSED to carry. The count is asserted by
 *  the callers — a regex that silently stopped matching would otherwise turn "no CJK left" into a
 *  tautology (the dashboard task's file records exactly that failure at this spot). */
const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;
function stripLangSwitcher(body) {
  const hits = body.match(LANG_SWITCHER_ITEM_RE) ?? [];
  return { stripped: hits.reduce((acc, h) => acc.split(h).join(""), body), hits };
}

/** The two out-of-scope Chinese labels `obsNote` (serve-render.ts) can put on THIS page. They are
 *  SHARED CHROME — 6 call sites across 4 page files (serve-architecture, serve-sessions ×3,
 *  serve-tests ×2, serve-system ×6) — so localizing them is a chrome-level change, not this page's;
 *  serve-i18n.ts ROW 20 names them as this task's residue. Pinned as literals so the exclusion below
 *  is enumerated rather than a pattern that could grow. */
const OBS_NOTE_LABELS = [
  `${cp(0x5df2)}${cp(0x63a5)}${cp(0x5165)}/${cp(0x6682)}${cp(0x65e0)}${cp(0x8bb0)}${cp(0x5f55)}`, // 已接入/暂无记录
  `${cp(0x672a)}${cp(0x63a5)}${cp(0x5165)}/${cp(0x65e0)}${cp(0x6570)}${cp(0x636e)}`,               // 未接入/无数据
];

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
//
// TWO workspaces: one WITH a verification-round ledger (the populated branch — the branch most of the
// page's copy renders in), one WITHOUT (the empty state, which renders a DIFFERENT set of copy:
// `obsNote`'s label and the source note, and no timeline/table/history at all). ⚠️ ONE FETCH CANNOT
// SEE THE OTHER (ROW 20's measurement note), which is why both are asserted.
//
// ⚠️ THE FIXTURE DATA IS ASCII ON PURPOSE. The strict arm below asserts the en page carries NO
// Chinese outside the enumerated residue; a Chinese task title or failure name would make that
// unfalsifiable by putting data and copy in the same bucket (the dashboard task's fixture note). The
// DATA classification gets its OWN arm, on its own fixture, further down.

let server, port, root, emptyRoot, originalCwd;

/** The ledger rows the /tests list page renders, in FILE order — ⚠️ `verification-round.jsonl` is an
 *  APPEND-ONLY ledger, so the LAST line is the NEWEST round and `readTests` reverses the file to get
 *  its newest-first list. Writing 1924 before 1923 would therefore make 1924 the OLDEST, the page
 *  would key its load curve off 1923 (which has no runId telemetry) and silently render the
 *  no-perFile fallback — a fixture that LOOKS right and quietly measures a different branch.
 *  `perFile` carries timestamps so the gantt renders, and `state` differs so the bar has both colours. */
function rounds() {
  const t0 = Date.parse("2026-09-18T15:20:00Z");
  return [
    {
      round: 1924, startedAt: "2026-09-18T15:20:00Z", durationMs: 480000, state: "green",
      pass: 1180, fail: 0, cancelled: 0, tests: 1180, reason: null, commit: "deadbeefcafe",
      scope: "repo", runner: "suite-runner", buckets: "P,S,M", runId: "run-1924", failures: [],
      // Three files, one per bucket, so the gantt legend renders ALL THREE bucket words (a legend
      // only names the buckets actually present — a one-bucket fixture would leave two of the three
      // ROW 20 bucket rows unexercised, and their zh columns unasserted).
      perFile: [
        { file: "packages/quay/test/aaa.test.mjs", durationMs: 1200, passed: true, startedAtMs: t0 + 10000, endedAtMs: t0 + 11200 },
        { file: "packages/quay/test/bbb.test.mjs", durationMs: 3400, passed: false, startedAtMs: t0 + 12000, endedAtMs: t0 + 15400 },
        { file: "packages/quay/test/ccc.test.mjs", durationMs: 800, passed: true, startedAtMs: t0 + 17000, endedAtMs: t0 + 17800 },
      ],
    },
    {
      round: 1923, startedAt: "2026-09-18T14:00:00Z", durationMs: 300000, state: "red",
      pass: 1100, fail: 1, cancelled: 0, tests: 1101, reason: null, commit: "cafebabe1234",
      scope: "repo", runner: "suite-runner", buckets: "P", runId: "run-1923",
      // ASCII failure names — see the fixture note above.
      failures: ["not ok 7 - aaa.test.mjs fails (hard-coded assertion)", "AssertionError: expected 3 got 4"],
      perFile: [],
    },
  ];
}

/** Write the ledger APPEND-ONLY (oldest line first — see `rounds()`). */
function seedLedger(ws) {
  fs.writeFileSync(
    path.join(ws, ".quay", "verification-round.jsonl"),
    rounds().slice().reverse().map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  const t0 = Date.parse("2026-09-18T15:20:00Z");
  fs.writeFileSync(
    path.join(ws, ".quay", "suite-load-run-1924.jsonl"),
    Array.from({ length: 40 }, (_, i) => JSON.stringify({ t: t0 + i * 8000, loadavg: 3 + (i % 7) * 0.3, cpu_stall: 2, mem_avail: 12000 - i * 40 })).join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(ws, ".quay", "suite-bucket-effective.jsonl"),
    [["packages/quay/test/aaa.test.mjs", "P"], ["packages/quay/test/bbb.test.mjs", "S"], ["packages/quay/test/ccc.test.mjs", "M"]]
      .map(([f, b]) => JSON.stringify({ file: f, buckets: [b] })).join("\n") + "\n",
  );
}

function makeWorkspace(prefix) {
  const tasksDir = makeTmpDir(`${prefix}tasks-`);
  const ws = makeTmpDir(`${prefix}ws-`);
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n` +
      // `loop.test_command` wires a round WRITER ⇒ the empty workspace renders the
      // `empty-writer-zero-records` branch (a timing fact) rather than `empty-no-writer`.
      `loop:\n  test_command: node --test\n`,
  );
  return { ws, tasksDir };
}

before(async () => {
  const main = makeWorkspace("tests-i18n-");
  seedLedger(main.ws);
  root = main.ws;
  emptyRoot = makeWorkspace("tests-i18n-empty-").ws;
  originalCwd = process.cwd();
  // /tests reads the workspace from `process.cwd()` (ServePageCfg carries `workspaceRoot` derived
  // from it), so the populated workspace is the served one; the empty state is rendered by a SECOND
  // server started with the other cwd, inside its own test.
  process.chdir(root);
  server = await startServer({ port: 0, host: "127.0.0.1" });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server?.client) await server.client.close();
  process.chdir(originalCwd);
});

/** Render /tests (or any path) against an arbitrary workspace by starting a SECOND real server on it.
 *  ⛔ port 0 (never probe-then-bind — the TOCTOU recorded in packages/quay/test/serve-board.test.mjs). */
async function renderIn(ws, urlPath, cookie) {
  const cwd0 = process.cwd();
  process.chdir(ws);
  const s = await startServer({ port: 0, host: "127.0.0.1" });
  try {
    return await get(s.address().port, urlPath, cookie ? { Cookie: cookie } : {});
  } finally {
    await new Promise((r) => s.close(r));
    if (s.client) await s.client.close();
    s.client = null;
    process.chdir(cwd0);
  }
}

// ── the dictionary is CLOSED, COMPLETE, and cannot be half-filled ─────────────────────────────────

test("AC4: TESTS_KEYS and TESTS_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...TESTS_KEYS];
  assert.equal(new Set(roster).size, roster.length, "TESTS_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(TESTS_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  assert.ok(roster.length >= 25, `the roster is the measured one, not a token stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is NOT "zh 含 CJK 或纯符号" verbatim — it is the STRONGER predicate the roster actually
  // needs: a zh value with no CJK is allowed ONLY when it is byte-equal to its en value (a genuinely
  // language-neutral token). An accidentally-English zh prose value therefore still fails.
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of TESTS_KEYS) {
    const { en, zh } = TESTS_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: testsLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = testsLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...TESTS_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of TESTS_KEYS) assert.equal(t[key], TESTS_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  assert.notDeepEqual(testsLabelsFor("en"), testsLabelsFor("zh"), "the two languages are not the same table (a both-columns-zh regression)");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => testsLabel("noSuchKey"), /unknown tests key/);
  // Negative control for the other direction: a REAL key must NOT throw.
  assert.equal(typeof testsLabel("pageSubtitle", "en"), "string");
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{code}` into the page", () => {
  assert.equal(fillLabel("Data source: {code}", { code: "<code>x</code>" }), "Data source: <code>x</code>");
  assert.throws(() => fillLabel("Data source: {code}", {}), /\{code\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  assert.throws(() => testsLabel("dataSourceRounds", "en", {}), /code/);
  // A template with no placeholders is fine with an empty map — the throw is keyed on the TEMPLATE.
  assert.equal(fillLabel("verification rounds", {}), "verification rounds");
});

test("AC4: every interpolated row carries its placeholder in BOTH columns (a template is not translatable one-sided)", () => {
  const templated = TESTS_KEYS.filter((k) => /\{\w+\}/.test(TESTS_LABELS[k].en));
  assert.ok(templated.length >= 10, `the interpolated rows exist (got ${templated.length})`);
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(TESTS_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
    // …and the placeholder NAMES are the same on both sides: a zh column that renamed `{shown}` to
    // `{显示}` would make `fillLabel` throw at render time for every zh reader (the template parses
    // `\w+`, so a non-ASCII name silently stops being a placeholder and renders literally).
    const names = (s) => (s.match(/\{(\w+)\}/g) ?? []).slice().sort();
    assert.deepEqual(names(TESTS_LABELS[key].zh), names(TESTS_LABELS[key].en), `${key}: both columns use the same placeholder names`);
  }
});

// ── AC2/AC3 black box: the two languages on a real server ────────────────────────────────────────

test("AC2: `Cookie: lang=en` renders the POPULATED /tests with zero page-authored CJK — and the same predicate DOES hit on zh (the zero-count control)", async () => {
  const en = await get(port, "/tests", { Cookie: "lang=en" });
  assert.equal(en.status, 200, "GET /tests (en) returns 200");
  const { stripped, hits } = stripLangSwitcher(en.body);
  // The switcher renders FOUR items on every page: desktop + mobile chrome, each carrying the
  // current language (`<span>`) and the other one (`<a href="?lang=…">`). Asserting the count is what
  // makes the removal a fact rather than a hope (the dashboard task measured a version of this regex
  // that matched only the `<span>` arm and passed while both 中文 items stayed in the page).
  assert.equal(hits.length, 4, "the four language-switcher items (desktop+mobile × current+other) were located");
  assert.equal(hits.filter((h) => h.includes(cp(0x4e2d) + cp(0x6587))).length, 2, "the two endonyms (desktop + mobile) are among them");
  assert.ok(!cjkLines(stripped).some((l) => l.includes(cp(0x4e2d) + cp(0x6587))),
    "the endonym is GONE after stripping — if it survived, the removal was a no-op and the assertion below is vacuous");
  // ⚠️ The fixture is ASCII, so this is the STRONG form: nothing is excluded here — every remaining
  // Chinese line is a defect. (The dashboard task needed an exclusion for a reader diagnostic; this
  // page's populated branch renders `readTests().reason` as `null` → `obsNote` returns "".)
  assert.deepEqual(cjkLines(stripped), [], "the en populated /tests carries interface copy in Chinese");

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  const zh = await get(port, "/tests", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200, "GET /tests (zh) returns 200");
  assert.ok(cjkLines(stripLangSwitcher(zh.body).stripped).length > 20,
    "precondition/control: the same CJK-line predicate finds the Chinese on the zh page");
});

test("AC3: `Cookie: lang=zh` still renders the pre-existing Chinese body copy (the extracted literals did not move), and the en page carries the English ones", async () => {
  const zh = await get(port, "/tests", { Cookie: "lang=zh" });
  const en = await get(port, "/tests", { Cookie: "lang=en" });
  const pairs = [
    ["验证轮记录", "verification rounds"],
    ["数据源：", "Data source:"],
    ["最近测试记录分段时间轴", "Recent test-record timeline segments"],
    ["负载曲线", "Load curve"],
    ["测试时间线", "Test timeline"],
    ["perFile 耗时明细（耗时降序 · 失败标红）", "perFile duration detail (descending · failures in red)"],
    ["历史运行（新→旧）", "Run history (new → old)"],
    ["← 最新", "← latest"],
    ["图例：", "Legend:"],
    ["P 产品", "P product"],
    ["S 套件", "S suite"],
    ["M 机件", "M mechanism"],
  ];
  // ⚠️ Asserted on the VISIBLE text, not the raw body: `pageStyles()`'s CSS carries comments that
  // NAME the bucket words (`… HUE = bucket (P 产品 / S 套件 …)`) — invisible to the reader, and a
  // raw-body negative arm would flag them as a leak. The predicate that matters is what the page
  // SHOWS, which is also the unit the red baseline and the zero-count arms are measured in.
  const zhText = visibleText(zh.body);
  const enText = visibleText(en.body);
  for (const [zhWord, enWord] of pairs) {
    assert.ok(zhText.includes(zhWord), `zh render keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
    assert.ok(enText.includes(enWord), `en render carries the new copy ${JSON.stringify(enWord)}`);
    assert.ok(!enText.includes(zhWord), `en render must not show ${JSON.stringify(zhWord)}`);
  }
});

test("AC2: the EMPTY state is localized too — the only Chinese left is the enumerated out-of-scope residue", async () => {
  // ⚠️ ONE FETCH CANNOT SEE THIS STATE — the empty workspace renders `obsNote`'s label and a source
  // note that the populated branch never emits, and none of the timeline/table/history copy.
  const en = await renderIn(emptyRoot, "/tests", "lang=en");
  assert.equal(en.status, 200, "GET /tests on the empty workspace returns 200");
  const { stripped, hits } = stripLangSwitcher(en.body);
  assert.equal(hits.length, 4, "the four switcher items were located (see the populated arm for why)");

  const residual = cjkLines(stripped);
  const reason = String(readTests(emptyRoot).reason ?? "").trim();
  // The classification, mechanical: a residual line is accounted for iff it is `obsNote`'s own label
  // (shared chrome, ROW 20's named residue) or a substring of the reader's diagnostic (DATA). The
  // reason line arrives with the ` — ` that `obsNote` renders BEFORE the reason attached to it, so
  // the separator is stripped before the containment check — comparing raw would match nothing and
  // the exclusion would look fine while the assertion below reported a leak that is not one.
  const accounted = (l) => OBS_NOTE_LABELS.includes(l) || (reason.length > 0 && reason.includes(l.replace(/^—\s*/, "")));
  assert.deepEqual(
    residual.filter((l) => !accounted(l)), [],
    "the en empty state carries no page-authored Chinese; the only residue is obsNote's shared-chrome label + the reader's diagnostic",
  );
  // The exclusion is not allowed to be a black hole: assert the residue is present AND small, so a
  // later change that starts leaking page copy cannot hide behind an ever-growing `accounted`.
  assert.equal(residual.length, 2, `the enumerated residue really is present and enumerated (got ${JSON.stringify(residual)})`);
  assert.ok(OBS_NOTE_LABELS.some((l) => residual.includes(l)), "and one of them IS obsNote's label — if not, this arm proves nothing about it");
  assert.ok(residual.some((l) => reason.length > 0 && reason.includes(l.replace(/^—\s*/, ""))),
    "and the other IS the reader's diagnostic string");

  // Control: the same predicate on zh hits hard.
  const zh = await renderIn(emptyRoot, "/tests", "lang=zh");
  assert.ok(cjkLines(stripLangSwitcher(zh.body).stripped).length > 20,
    "precondition/control: the same CJK-line predicate finds the Chinese on the zh empty page");
});

test("AC2: /tests/file is localized as well — the second page in the same source file", async () => {
  const filePath = "packages%2Fquay%2Ftest%2Faaa.test.mjs";
  const en = await get(port, `/tests/file?path=${filePath}`, { Cookie: "lang=en" });
  const zh = await get(port, `/tests/file?path=${filePath}`, { Cookie: "lang=zh" });
  assert.equal(en.status, 200, "GET /tests/file (en) returns 200");
  assert.equal(zh.status, 200, "GET /tests/file (zh) returns 200");
  const { stripped, hits } = stripLangSwitcher(en.body);
  assert.equal(hits.length, 4, "the four switcher items were located");
  assert.deepEqual(cjkLines(stripped), [], "the en /tests/file page carries no Chinese at all (after the endonym)");
  // The zh page keeps every one of its pre-existing literals — this page's copy was EXTRACTED from
  // the running render, so a zh byte change is a regression here (ROW 7), not a tidy-up.
  const zhText = visibleText(zh.body);
  const enText = visibleText(en.body);
  for (const zhWord of [
    "测试文件",                    // the page-name token (PAGE_LABELS, this page's own)
    "← 返回 Tests",                // the back link
    "仅出现在 1 轮",               // the single-round notice (this fixture's file is in ONE round)
    "数据源：",                    // the source notes
    "pass/fail 历史（1 轮 · 旧→新）",
    "运行期间负载曲线片段",        // the load-fragment heading
  ]) {
    assert.ok(zhText.includes(zhWord), `the zh /tests/file page keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
  }
  // …and each of those has an ABSENT arm under en, so the zh assertions above are not satisfied by a
  // page that renders both languages (a "present" assertion with no counterpart cannot fail).
  for (const zhWord of ["测试文件", "← 返回 Tests", "运行期间负载曲线片段", "pass/fail 历史", "仅出现在 1 轮"]) {
    assert.ok(!enText.includes(zhWord), `the en /tests/file page must not show ${JSON.stringify(zhWord)}`);
  }
  assert.ok(enText.includes("appears in only 1 round"), "the en page shows the English single-round notice");
  // The two page-name tokens are peers on ONE axis (who names this page) and must not be shared: the
  // /tests page's `<h1>` says 「测试 — 验证轮记录」, this page's says 「测试文件 — …」.
  assert.ok(en.body.includes("Test file"), "…and the en page renders that token's en column");
  assert.ok(en.body.includes("← Back to Tests"), "…and the en back link");
});

// ── the DATA classification, made mechanical ─────────────────────────────────────────────────────

test("the ledger's own data — including a Chinese failing-test name — renders VERBATIM in both languages (it is not copy)", async () => {
  // The task's AC1 splits the page's Chinese into 「界面文案」 and 「数据」. The mechanical form of that
  // split is this test: a failure name that happens to be Chinese must appear IDENTICALLY under both
  // languages, because it is a line of the run's own record. Translating it would be editing a test
  // run to read nicely — the one thing this page must never do, and the failure mode a "make the
  // page English" task is most likely to cause by accident.
  const ws = makeWorkspace("tests-i18n-data-").ws;
  const cjkFailure = `${cp(0x4e2d)}${cp(0x6587)}${cp(0x6d4b)}${cp(0x8bd5)}${cp(0x540d)} fails`; // 中文测试名 fails
  fs.writeFileSync(
    path.join(ws, ".quay", "verification-round.jsonl"),
    JSON.stringify({
      round: 7, startedAt: "2026-09-18T10:00:00Z", durationMs: 1000, state: "red",
      pass: 0, fail: 1, cancelled: 0, tests: 1, reason: null, commit: "aaaabbbbcccc",
      scope: "repo", runner: "suite-runner", failures: [cjkFailure], perFile: [],
    }) + "\n",
  );
  const en = await renderIn(ws, "/tests", "lang=en");
  const zh = await renderIn(ws, "/tests", "lang=zh");
  assert.ok(en.body.includes(cjkFailure), "the en page renders the Chinese failure name verbatim");
  assert.ok(zh.body.includes(cjkFailure), "the zh page renders it byte-identically — same bytes, both languages");
  // …and it is the ONLY Chinese on the en page besides the switcher endonym: the page did not grow a
  // translation of it, and no other copy leaked back in. (Zero-count control is the previous arm.)
  const { stripped } = stripLangSwitcher(en.body);
  assert.deepEqual(cjkLines(stripped), [cjkFailure],
    "the en page's only Chinese is the ledger's own data line");
});

// ── AC5: the shared chart gets THIS page's language ──────────────────────────────────────────────

test("AC5: the shared timeline bar (renderTimelineBarSvg) follows the page language — its aria-label is Chinese under zh and English under en", async () => {
  // `renderTimelineBarSvg` lives in serve-dashboard.ts and is SHARED with /dashboard; ROW 5 ⑧ made its
  // aria-label language-dependent and required /tests to pass its own `lang`. ⛔ Omitting it does not
  // fail loudly — the default is `en`, which renders an ENGLISH aria-label on a Chinese page (硬规则
  // 3b: a silently-defaulted language is indistinguishable from a wired one). This arm is the only
  // thing that can tell the two apart, so it reads the attribute off a real response in both langs.
  const zh = await get(port, "/tests", { Cookie: "lang=zh" });
  const en = await get(port, "/tests", { Cookie: "lang=en" });
  const zhAria = /aria-label="([^"]*)"/.exec(zh.body.replace(/\n/g, " "));
  assert.ok(zh.body.includes(`${cp(0x8fc7)}${cp(0x53bb)} 3 ${cp(0x5c0f)}${cp(0x65f6)}${cp(0x65f6)}${cp(0x95f4)}${cp(0x8f74)}`),
    "the zh page's shared timeline bar carries the Chinese aria-label (its own lang was threaded through)");
  assert.ok(en.body.includes("Timeline: the past 3 hours"),
    "the en page's shared timeline bar carries the English aria-label");
  assert.ok(zhAria, "the zh page has aria-labels at all (the regex found one)");
  assert.ok(!en.body.includes(cp(0x8fc7) + cp(0x53bb)), "the en page carries no Chinese timeline aria-label");
});
