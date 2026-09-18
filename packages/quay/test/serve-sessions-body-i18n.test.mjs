// @test-group product
// gap-webui-sessions-body-copy-en-zh — /sessions + /session/<id> 的【正文文案】本地化（正文本地化系列第 7 页）。
//
// 病灶与 /dashboard（系列第 1 页，定 pattern）同形：AC-299 把本页的【外壳】接进了 serve-i18n.ts
// （`<html lang>`、共享 nav、mobile chrome、`pageNameFor` 的三个 token），但**正文**仍是源码里的中文
// 字面量 —— `lang=en` 下渲染出一个「框是英文、内容是中文」的页面。更隐蔽的是 AC-299 那三个 token
// 本身：`pageNameFor` 对 `en` 是【恒等】的（ROW 3 的契约），所以带中文的**复合** token 在两种语言下
// 都渲染中文、它的 en 列根本不会被读到 —— 那是「一个看起来覆盖了的选项」（硬规则 3b）。本任务把它
// 拆成 ROW 3 的裸页名 + ROW 15 的两个副标题，并把本文件的两页正文全部走字典。
//
// 红基线（真实 `startServer`（port 0）+ 原始 HTTP，两个页、两条传输）：
//   `Cookie: lang=en` GET /sessions 含 CJK 的可见文本行 **8** 条（全部是界面文案，数据 0 条）；
//   POST /sessions/new、POST /sessions/resume、GET /session/<id>/earlier 各 **1** 条；
//   GET /session/<id> **5** 条（其中 3 条属 `serve-send.ts` 的投递表单，不在本任务 Touches 内）。
//   同一谓词对 zh 干跑命中（GET /sessions 21 条）—— 零计数的对照。
//
// 本文件验证（AC4 的机械判据 + AC2/AC3/AC5 的黑盒两态 + AC2 的零计数对照）：
//   • 字典完备且被类型强制：`SESSIONS_LABELS` 是 `Record<SessionsKey,{en,zh}>`，每键两列非空、en 列
//     无 CJK、zh 列含 CJK 或与 en 逐字相同。
//   • 取词函数的两条 throw 路径（未知键 / 缺参数）—— 硬规则 3b 的那半边。
//   • 黑盒两态：真实 startServer（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`。
//   • **零计数的对照**（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中。
//   • AC5：本页的**数据面入口逐个**列出并验证 —— GET `/sessions`、POST `/sessions/new`、
//     POST `/sessions/resume`、POST `/sessions/driver`、GET `/session/<id>/earlier`、GET
//     `/session/<id>`，每条都验 en 与 zh 两态，且 POST 走 **Cookie 与 `?lang=` 两条传输**（表单
//     原生提交只带 Cookie；`?lang=` 是同一 resolver 的另一条入口，两条都要红得起来）。
//   • 单次 GET 抓不到的那一处：`renderSessionPage` 的滚动加载脚本字符串（`earlierBeyondWindow`）
//     只在「有更早内容」时进响应，而路由夹具的 transcript 是短的 —— 由直接调用补证（同 ROW 15 ④）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { SESSIONS_KEYS, SESSIONS_LABELS, sessionsLabelsFor, sessionLabel, fillLabel, pageNameFor } from "../src/serve-i18n.ts";
import { renderSessionPage, renderSessionsPage } from "../src/serve-handlers.ts";
import { readSessions } from "../src/observation.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes this task is defined against: Han, CJK punctuation (、。「」) and the full-width
 *  forms (：（），、). ONE regex for the dictionary assertion AND the black-box one, so the two cannot
 *  drift into two different definitions of "Chinese". Built from CODE POINTS rather than written as
 *  a literal range: the file that defines "Chinese copy" is the last place that should itself
 *  contain Chinese. */
const cp = (n) => String.fromCharCode(n);
const CJK = new RegExp(`[${cp(0x4e00)}-${cp(0x9fff)}${cp(0x3000)}-${cp(0x303f)}${cp(0xff00)}-${cp(0xffef)}]`);

function req(port, method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    r.on("error", reject);
    if (body != null) r.write(body);
    r.end();
  });
}

/** The page's VISIBLE text: styles/scripts dropped, tags stripped, entities decoded. This is the
 *  unit the red baseline was measured in, so the test and the measurement speak the same language. */
function visibleText(body) {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function cjkLines(body) {
  return visibleText(body).split("\n").map((s) => s.trim()).filter((s) => s.length > 0 && CJK.test(s));
}

/** The language switcher's ENDONYM (`中文` / `EN`) is DELIBERATELY the same in both columns
 *  (serve-i18n.ts ROW 4) and is therefore the one Chinese word an English page is SUPPOSED to carry.
 *  Removed before the "no CJK under en" assertion, and the removal is asserted to have hit. */
const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;
function stripLangSwitcher(body) {
  const hits = (body.match(LANG_SWITCHER_ITEM_RE) ?? []);
  return { stripped: hits.reduce((acc, h) => acc.split(h).join(""), body), hits };
}

/** SHARED chrome this page ECHOES but does not own — `obsNote`'s state words (serve-render.ts), the
 *  same function every page renders, assigned by ROW 15 ⑥ to the series' shared residue list
 *  (gap-webui-dashboard-body-copy-en-zh). ⛔ Not a blanket exemption: the list is NAMED and its
 *  hits are counted in the assertion below, so it cannot silently grow to swallow this page's own
 *  copy. In this fixture `readSessions` normally reports `ok` (zero sessions) and NOTHING here
 *  renders — the exclusion exists so an environment where `claude agents --json` is unavailable
 *  fails the ZERO arm for a named, visible reason instead of a mystery. */
const SHARED_CHROME_WORDS = ["未接入/无数据", "已接入/暂无记录", "读失败"];

/** Chinese lines this PAGE authored — excluding (a) the switcher's endonym, (b) the named shared
 *  chrome above, and (c) any line a non-page module produced and the page merely echoes: the reader's
 *  own `reason` strings (DATA). Returns both halves so the assertion can show its work. */
function pageAuthoredCjk(body, readerTexts) {
  const { stripped, hits } = stripLangSwitcher(body);
  const reasons = readerTexts.map((t) => String(t ?? "").trim()).filter((t) => t.length > 0);
  const excluded = [];
  const residual = cjkLines(stripped).filter((line) => {
    if (line === "中文") { excluded.push(line); return false; }
    const shared = SHARED_CHROME_WORDS.find((w) => line.includes(w));
    if (shared !== undefined) { excluded.push(line); return false; }
    if (reasons.some((r) => line.includes(r))) { excluded.push(line); return false; }
    return true;
  });
  return { residual, excluded, switcherHits: hits.length };
}

// ── the fixture: a real workspace, no sessions (so the ONLY possible CJK in the response is the
//    page's own copy) ────────────────────────────────────────────────────────────────────────────

let server, port, root, originalCwd, tasksDir;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "sess-i18n-ws-"));
  tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  originalCwd = process.cwd();
  process.chdir(root);
  // port 0: let the kernel pick — probe-then-bind is a TOCTOU that races the kernel and leaks the
  // provider child process on a collision (recorded in packages/quay/test/serve-board.test.mjs).
  server = await startServer({ port: 0, host: "127.0.0.1" });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server?.client) await server.client.close();
  process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
});

/** The reader diagnostics the page echoes verbatim (see `pageAuthoredCjk`) — read from the SAME
 *  reader `handleSessions` read, so the exclusion list is derived, not hand-written. */
async function readerTexts() {
  const sessions = await readSessions(root);
  return [sessions.reason];
}

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ────────────────────────────

test("AC4: SESSIONS_KEYS and SESSIONS_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...SESSIONS_KEYS];
  assert.equal(new Set(roster).size, roster.length, "SESSIONS_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(SESSIONS_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  assert.ok(roster.length >= 25, `the roster is the measured one, not a token stub (got ${roster.length})`);
  // The two page-specific rows the whole task turns on: the <title> and the <h1> subtitles are
  // DIFFERENT strings here, which is why they are two rows and not one (ROW 15 ①).
  assert.notEqual(SESSIONS_LABELS.pageSubtitle.zh, SESSIONS_LABELS.h1Subtitle.zh,
    "the <title> and <h1> subtitles are distinct — a single row would silently shorten the <h1>");
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of SESSIONS_KEYS) {
    const { en, zh } = SESSIONS_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: every interpolated row's placeholders are supplied in BOTH columns", () => {
  const templated = SESSIONS_KEYS.filter((k) => /\{\w+\}/.test(SESSIONS_LABELS[k].en));
  assert.ok(templated.length >= 6, `the interpolated rows exist (got ${templated.length}: ${templated.join(", ")})`);
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(SESSIONS_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
    const ph = (t) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(ph(SESSIONS_LABELS[key].zh), ph(SESSIONS_LABELS[key].en),
      `${key}: the two columns interpolate the SAME parameters`);
  }
});

test("AC4: sessionsLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = sessionsLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...SESSIONS_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of SESSIONS_KEYS) assert.equal(t[key], SESSIONS_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  assert.notDeepEqual(sessionsLabelsFor("en"), sessionsLabelsFor("zh"), "the two languages are not the same table (a both-columns-zh regression)");
  // The `<title>`/`<h1>` subtitles are the rows this task turns on: under en they must NOT be the
  // Chinese ones (that was the defect), and ROW 3's page NAME must stay a separate lookup (ROW 15 ②).
  assert.equal(sessionLabel("pageSubtitle", "en"), "session observation", "the en <title> subtitle is English");
  assert.equal(sessionLabel("pageSubtitle", "zh"), "会话观测", "the zh <title> subtitle is the pre-extraction literal");
  assert.equal(sessionLabel("h1Subtitle", "en"), "session observation (running + finished)", "the en <h1> subtitle is English");
  assert.equal(sessionLabel("h1Subtitle", "zh"), "会话观测（运行中 + 已结束）", "the zh <h1> subtitle is the pre-extraction literal");
  assert.equal(pageNameFor("Sessions", "en"), "Sessions", "the page NAME token stays ROW 3's identity under en");
  assert.equal(pageNameFor("Sessions", "zh"), "会话", "the page NAME token stays ROW 3's under zh");
  // ⚠️ NEGATIVE CONTROL for the retirement: the two AC-299 COMPOSITES no longer resolve. If a future
  // change re-added a composite row, the en `<title>`/`<h1>` would go back to rendering Chinese while
  // the AC2 black-box arms above stayed green — this is the arm that pins the retirement itself.
  assert.equal(pageNameFor("Sessions — 会话观测", "zh"), "Sessions — 会话观测",
    "the retired AC-299 <title> composite is gone from PAGE_LABELS");
  assert.equal(pageNameFor("Sessions — 会话观测（运行中 + 已结束）", "zh"), "Sessions — 会话观测（运行中 + 已结束）",
    "the retired AC-299 <h1> composite is gone from PAGE_LABELS");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => sessionLabel("noSuchKey"), /unknown sessions key/);
  assert.equal(typeof sessionLabel("pageSubtitle", "en"), "string"); // negative control: a REAL key
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{n}` into the page", () => {
  assert.equal(fillLabel("{a} · {b}", { a: "x", b: "y" }), "x · y");
  assert.throws(() => sessionLabel("goneSummary", "en", {}), /\{n\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  assert.throws(() => sessionLabel("dataSourceNote", "zh", { agents: "<code>x</code>" }), /\{flag\}/);
  assert.equal(fillLabel("no placeholders", {}), "no placeholders");
  // ⛔ The TEMPLATE rows must not be reachable unfilled through the roster either: `sessionsLabelsFor`
  // hands out the raw templates, so every call site that takes a templated row MUST call `fillLabel`.
  // This pins that the templates really do still carry their placeholders (i.e. nobody "helpfully"
  // baked one language's value into the table).
  assert.ok(/\{n\}/.test(sessionsLabelsFor("en").goneSummary), "the roster hands out the template, not a filled string");
});

// ── AC2/AC3/AC5 black box: the two languages on a real server ─────────────────────────────────────

test("AC2: `Cookie: lang=en` renders /sessions with ZERO page-authored CJK — and the same predicate DOES hit on zh (the zero-count control)", async () => {
  const en = await req(port, "GET", "/sessions", { Cookie: "lang=en" });
  assert.equal(en.status, 200);
  const { residual, excluded, switcherHits } = pageAuthoredCjk(en.body, await readerTexts());
  assert.equal(switcherHits, 4, "the four language-switcher items (desktop+mobile × current+other) were located");
  assert.ok(excluded.length <= 2, `the exclusions are bounded (got ${excluded.length}: ${JSON.stringify(excluded)})`);
  assert.deepEqual(residual, [],
    "the en /sessions page still carries interface copy in Chinese; the only Chinese an English page is supposed to carry is the switcher's own 中文 endonym (and the named shared chrome, if `claude agents` was unavailable)");

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  const zh = await req(port, "GET", "/sessions", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200);
  assert.ok(cjkLines(stripLangSwitcher(zh.body).stripped).length >= 15,
    `precondition/control: the same CJK-line predicate finds the Chinese on the zh page (got ${cjkLines(stripLangSwitcher(zh.body).stripped).length})`);
});

test("AC2: the en /sessions page carries the NEW English copy at every site (the fixed arm)", async () => {
  const en = await req(port, "GET", "/sessions", { Cookie: "lang=en" });
  const flat = en.body.replace(/\n/g, " ");
  // ①② the `<title>`/`<h1>`: ROW 3's bare NAME + ROW 15's two DIFFERENT subtitles, appended OUTSIDE.
  assert.ok(/<title>[^<]* — Sessions — session observation<\/title>/.test(flat),
    `the en <title> ends with the English name + subtitle (got ${JSON.stringify(/<title>([^<]*)<\/title>/.exec(flat)?.[1])})`);
  assert.ok(flat.includes("<h1>Sessions — session observation (running + finished)</h1>"),
    `the en <h1> is fully English (got ${JSON.stringify(/<h1>([^<]*)<\/h1>/.exec(flat)?.[1])})`);
  assert.ok(!flat.includes("session observation (running + finished) — "), "the h1 subtitle is not swapped into the title");
  // ③ the data-source note — the filled template, i.e. the row really drove the render (the two
  //    `<code>` parameters are the CALLER's markup, ROW 15 ③).
  assert.ok(en.body.includes("Data source: <code>claude agents --json</code> (running · interactive + <code>-p</code>) + transcript directory scan (finished) + session transcript tail"),
    "the data-source note renders its en row with both <code> parameters filled");
  // ④⑤⑥ the lifecycle section: heading, note, three submit buttons.
  assert.ok(flat.includes("<h2>Session lifecycle (headless)</h2>"), "the lifecycle heading is English");
  assert.ok(flat.includes("The driver reuses <code>quay driver</code>; new = <code>-p --input-format stream-json</code>; restart = <code>--resume</code>."),
    "the lifecycle note renders its en row with all three <code> parameters filled");
  for (const [word, key] of [["Driver action", "driverSubmit"], ["New session", "newSessionSubmit"], ["Restart session (--resume)", "resumeSubmit"]]) {
    assert.ok(flat.includes(`>${word}</button>`), `the ${key} button renders its en row`);
  }
  // ⑦ the form placeholders — FOUR rows for what looks like two fields (ROW 15's placeholder note).
  for (const key of ["newProfilePlaceholder", "resumeProfilePlaceholder", "newPermissionModePlaceholder", "resumePermissionModePlaceholder", "sessionIdPlaceholder"]) {
    assert.ok(flat.includes(`placeholder="${SESSIONS_LABELS[key].en}"`), `${key} renders its en row`);
  }
});

test("AC3: `Cookie: lang=zh` still renders the pre-existing Chinese body copy (the extracted literals did not move)", async () => {
  const zh = await req(port, "GET", "/sessions", { Cookie: "lang=zh" });
  const en = await req(port, "GET", "/sessions", { Cookie: "lang=en" });
  const zhWords = [
    "会话 — 会话观测",                                  // <title>: ROW 3 name + ROW 15 pageSubtitle
    "会话 — 会话观测（运行中 + 已结束）",                 // <h1>: ROW 3 name + ROW 15 h1Subtitle
    "Quay sessions — 运行中 + 已结束会话",                // <meta name="description">
    "数据源：",                                          // the data-source note's leading copy
    "（运行中 · 交互式 + ",                              // …its middle copy
    "）+ transcript 目录扫描（已结束）+ 会话 transcript 尾部", // …its trailing copy
    "会话生命周期（headless）",
    "driver 复用 ", "；新建 = ", "；重启 = ", "。⛔ 交互式 manager/outer/inner 不在此暴露。提交结果为 JSON。",
    "driver 操作", "新建会话", "重启会话（--resume）",
    "profile（role 名，必填）", "profile（role 名）", "权限模式（必填，无默认）", "权限模式（必填）", "session-id（UUID）",
    "中文",                                              // the switcher's endonym (ROW 4 — deliberately unchanged)
  ];
  for (const w of zhWords) {
    assert.ok(zh.body.includes(w), `zh render keeps the pre-existing literal ${JSON.stringify(w)}`);
  }
  // …and the SAME words are ABSENT under en, so each zh assertion above has a counterpart that can
  // fail (a "present" assertion with no "absent" arm passes on a page that renders both languages).
  for (const w of zhWords.filter((w) => w !== "中文")) {
    assert.ok(!en.body.includes(w), `en render must not carry ${JSON.stringify(w)}`);
  }
  // ⚠️ The two permissionMode placeholders are DIFFERENT strings (`，无默认` vs `，必填`); the pair
  // above would pass if they had been collapsed into one row, so assert the difference directly.
  assert.notEqual(SESSIONS_LABELS.newPermissionModePlaceholder.zh, SESSIONS_LABELS.resumePermissionModePlaceholder.zh,
    "the two permissionMode form placeholders really are distinct rows");
});

test("AC5: EVERY data-surface entry of these two pages answers in the REQUEST's language — GET routes", async () => {
  // Enumerated, not "the one we remembered": the list page, the detail page, and the on-demand
  // earlier-turns endpoint the scroll loader calls.
  const uuid = "11111111-1111-4111-8111-111111111111";
  for (const [lang, tag] of [["en", '<html lang="en">'], ["zh", '<html lang="zh"']]) {
    const list = await req(port, "GET", "/sessions", { Cookie: `lang=${lang}` });
    assert.equal(list.status, 200, `GET /sessions (${lang}) returns 200`);
    assert.ok(list.body.includes(tag), `GET /sessions (${lang}) renders ${tag}`);
    // ⚠️ The DETAIL page is asserted on its BODY copy, not on `<html lang>`: that attribute is
    // hard-coded `en` there and is CHROME (ROW 15 ⑥) — switching it is a different task's surface,
    // and asserting it here would be asserting something this task deliberately did not do.
    const detail = await req(port, "GET", `/session/${uuid}`, { Cookie: `lang=${lang}` });
    assert.equal(detail.status, 200, `GET /session/<id> (${lang}) returns 200`);
    assert.ok(detail.body.includes(SESSIONS_LABELS.detailBackLink[lang]),
      `GET /session/<id> (${lang}) renders its own back-link row`);
    assert.ok(detail.body.includes(fillLabel(SESSIONS_LABELS.detailDataSourceNote[lang], { path: "<code>~/.claude/projects/&lt;slug&gt;/&lt;sessionId&gt;.jsonl</code>" })),
      `GET /session/<id> (${lang}) renders its own data-source row`);
  }
  // `/earlier` is JSON (no <html>) — its copy is the 400 `reason` for a non-UUID id.
  const earlierZh = await req(port, "GET", "/session/not-a-uuid/earlier?before=0", { Cookie: "lang=zh" });
  const earlierEn = await req(port, "GET", "/session/not-a-uuid/earlier?before=0", { Cookie: "lang=en" });
  assert.equal(earlierZh.status, 400);
  assert.equal(JSON.parse(earlierZh.body).reason, SESSIONS_LABELS.earlierInvalidSessionId.zh,
    "the /earlier 400 reason is the zh row under cookie lang=zh");
  assert.equal(JSON.parse(earlierEn.body).reason, SESSIONS_LABELS.earlierInvalidSessionId.en,
    "…and the en row under en");
});

test("AC5: every POST endpoint's feedback follows the request language — over BOTH transports (Cookie and ?lang=)", async () => {
  // The three lifecycle forms POST natively (zero client JS), so the JSON response body IS the next
  // page the reader sees. ⛔ This is the class a single GET probe can never reach (ROW 15 ⑤).
  const FORM = { "Content-Type": "application/x-www-form-urlencoded" };
  const endpoints = [
    ["/sessions/new", "newSessionInvalid"],
    ["/sessions/resume", "resumeSessionInvalid"],
  ];
  const readable = [];
  for (const [lang, cookie] of [["en", "lang=en"], ["zh", "lang=zh"]]) {
    for (const [p, key] of endpoints) {
      // Transport A: the Cookie — what the switcher writes and what a native form POST carries.
      const byCookie = await req(port, "POST", p, { ...FORM, Cookie: cookie }, "");
      // Transport B: `?lang=` — the same resolver's other entrance (a form posted from a URL that
      // carried the query). Both must be red-able, so both are asserted SEPARATELY (hard rule 3).
      const byQuery = await req(port, "POST", `${p}?lang=${lang}`, FORM, "");
      assert.equal(byCookie.status, 400, `POST ${p} (${lang}, cookie) is the validation 400`);
      assert.equal(byQuery.status, 400, `POST ${p} (${lang}, query) is the validation 400`);
      assert.equal(JSON.parse(byCookie.body).reason, SESSIONS_LABELS[key][lang], `POST ${p} cookie ${lang}: the row for THIS language`);
      assert.equal(JSON.parse(byQuery.body).reason, SESSIONS_LABELS[key][lang], `POST ${p} query ${lang}: the row for THIS language`);
      // The alphabet arm, both directions — "the feedback switched language" is only meaningful if
      // the CJK really is absent under en and really is present under zh.
      if (lang === "en") assert.ok(!CJK.test(JSON.parse(byCookie.body).reason), `POST ${p}: the en copy carries no CJK`);
      else assert.ok(CJK.test(JSON.parse(byCookie.body).reason) || JSON.parse(byCookie.body).reason === SESSIONS_LABELS[key].en,
        `POST ${p}: the zh copy is Chinese (or language-neutral)`);
      readable.push([`POST ${p} ${lang}`, JSON.parse(byCookie.body).reason]);
    }
  }
  // Print the readings (hard rule 3: enumerate, don't report a boolean "the feedback is localized").
  for (const [what, reason] of readable) console.log(`  [sess-i18n] ${what} ⇒ ${JSON.stringify(reason)}`);
  // `/sessions/driver`'s 400 is the machine's own English verb/kind listing — it was never Chinese
  // (`cli/driver.ts` carries no CJK), so there is no row for it and its bytes must be IDENTICAL in
  // both languages. Asserted so a later "let's localize that too" cannot silently move the zh baseline.
  const drvZh = await req(port, "POST", "/sessions/driver", { ...FORM, Cookie: "lang=zh" }, "verb=nope&kind=promotion");
  const drvEn = await req(port, "POST", "/sessions/driver", { ...FORM, Cookie: "lang=en" }, "verb=nope&kind=promotion");
  assert.equal(drvZh.status, 400);
  assert.equal(drvZh.body, drvEn.body, "/sessions/driver's invalid-action reason is machine text, identical in both languages");
  assert.ok(!CJK.test(drvZh.body), "…and it carries no CJK");
});

// ── the ONE state a single GET cannot reach ───────────────────────────────────────────────────────

test("AC5: the scroll loader's browser-side strings follow `lang` — the state the route fixture cannot reach", () => {
  // `earlierBeyondWindow` / `downloadFullTranscript` are written by the CLIENT when the reader scrolls
  // past the read window, so they only reach the response when the transcript actually has earlier
  // turns than the rendered slice. The route fixture's transcript is short, so this is the reachable
  // proof for those two rows (ROW 15 ④). ⛔ Both directions asserted.
  const turns = Array.from({ length: 80 }, (_, i) => ({
    time: "2026-09-18T00:00:00Z", role: "user", blocks: [{ kind: "text", text: `msg-${i}` }],
  }));
  const view = { status: "ok", reason: null, sessionId: "11111111-1111-4111-8111-111111111111", transcriptPath: "/x.jsonl", turns, truncated: true };
  const en = renderSessionPage(view, "en");
  const zh = renderSessionPage(view, "zh");
  for (const [lang, page, beyond, dl] of [["en", en, SESSIONS_LABELS.earlierBeyondWindow.en, SESSIONS_LABELS.downloadFullTranscript.en],
                                          ["zh", zh, SESSIONS_LABELS.earlierBeyondWindow.zh, SESSIONS_LABELS.downloadFullTranscript.zh]]) {
    // The two words are INLINED as JS string literals (JSON.stringify), so the assertion reads the
    // literal exactly as the browser would parse it.
    assert.ok(page.includes(`const BEYOND = ${JSON.stringify(beyond)};`), `${lang}: the beyond-window word reaches the browser as a JS literal`);
    assert.ok(page.includes(`const DOWNLOAD = ${JSON.stringify(dl)};`), `${lang}: the download word reaches the browser as a JS literal`);
    // …and the row is really the SOURCE of the rendered DOM write, not a dead literal beside it.
    assert.ok(page.includes("'<p class=\"meta\">' + BEYOND + '<a href=\"/session/'"), `${lang}: the sentinel rewrite consumes the injected word`);
  }
  // The en detail page's ONLY remaining Chinese is `renderSendForm` (serve-send.ts) — a DIFFERENT
  // module with its own POST surface, documented as out of scope by ROW 15 ⑥. Named, bounded, and
  // shown to be PRESENT (so the exclusion cannot be vacuous): every other CJK line is a failure.
  const SEND_FORM_OWNED = ["消息投递", "发送"];
  const isSendFormLine = (l) => SEND_FORM_OWNED.includes(l) || l.startsWith("向本会话注入一条跨会话消息");
  const endonyms = cjkLines(en).filter((l) => l === "中文");
  assert.equal(endonyms.length, 2, "the switcher's 中文 endonym renders twice (desktop + mobile) and is the OTHER legitimate Chinese here");
  const residual = cjkLines(en).filter((l) => !isSendFormLine(l) && l !== "中文");
  assert.deepEqual(residual, [], "the ONLY Chinese on the en detail page is serve-send.ts's delivery form (ROW 15 ⑥) plus the switcher's endonym");
  assert.ok(SEND_FORM_OWNED.every((w) => cjkLines(en).includes(w)),
    "…and the excluded words really are there — the exclusion is doing work, not acting as a blanket");
  // The zh detail page is the same page with the body copy flipped: its CJK set is the en set PLUS
  // this file's rows (proved by the ROW-15 literals appearing and the en ones disappearing).
  assert.ok(cjkLines(zh).length > cjkLines(en).length, "the zh detail page carries strictly more Chinese than the en one");
  // The transcript heading's recent-N clause is its OWN row, filled into the `{suffix}` slot.
  assert.ok(en.includes("<h2>Transcript (80 messages · old→new, showing the most recent 30)</h2>"),
    `the en transcript heading renders its sentence (got ${JSON.stringify(/<h2>([^<]*)<\/h2>/.exec(en)?.[1])})`);
  assert.ok(zh.includes("<h2>Transcript（80 条消息 · 旧→新，默认显示最近 30 条）</h2>"), "the zh heading is the pre-extraction literal");
  // Negative control for the suffix row: a short transcript omits the clause entirely, in both
  // languages — so the assertion above is about the sentence, not about a function that always emits it.
  const short = { ...view, turns: turns.slice(-5), truncated: false };
  assert.ok(renderSessionPage(short, "en").includes("<h2>Transcript (5 messages · old→new)</h2>"));
  assert.ok(renderSessionPage(short, "zh").includes("<h2>Transcript（5 条消息 · 旧→新）</h2>"));
  // The DEFAULT language is the en baseline: a direct caller that predates `lang` renders what it
  // always rendered (the same contract AC-299's `renderSessionsPage` has).
  assert.equal(renderSessionPage(view), renderSessionPage(view, "en"), "renderSessionPage's default language is the en baseline");
  assert.equal(renderSessionsPage({ status: "ok", reason: null, sessions: [] }, null), renderSessionsPage({ status: "ok", reason: null, sessions: [] }, null, "en"),
    "renderSessionsPage's default language is the en baseline");
});
