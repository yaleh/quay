// @test-group product
// gap-webui-manager-body-copy-en-zh — /manager 的【正文文案】本地化（正文本地化系列第 8 页）。
//
// 病灶（与 /dashboard 同形）：AC-288~294 把【外壳】（nav / `<title>` / `<h1>` 的页名 / 切换控件）接到了
// serve-i18n.ts 的字典，但页面 **正文** 仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个「框是英文、
// 内容是中文」的页面。真机实测：`lang=en` 下 /manager 含 CJK 的文本行 20 条（剔掉切换控件 endonym
// 「中文」×2 后 18 条），全部来自 `renderManagerPage` 的 11 条渲染串与它渲染的共享数据。
//
// 本文件验证（对应任务 AC4~AC7 的机械判据 + AC2/AC3 的黑盒两态）：
//   • 字典完备且被类型强制：`MANAGER_LABELS` 是 `Record<ManagerKey,{en,zh}>`，每键两列非空、en 列无
//     CJK、zh 列含 CJK 或与 en 逐字相同（`zhArmOk` 的注释说明后者不是放宽而是更强的谓词）。
//   • 取词函数的 throw 路径（未知键 / 缺参数）—— 硬规则 3b 的那半边：读不懂输入时不得返回与「合格」
//     同形的值。缺参数若静默留 `{file}`，页面会把自己的模板语法渲染出来，而没有一条「页面上有没有
//     该有的值」的检查会变红。
//   • 黑盒两态：真实 startServer（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`，断言 en 下
//     **本页**文案 CJK = 0，且同一谓词对 zh 干跑必须命中（零计数的对照，硬规则 2）。
//   • 残余的每一类都被 NAMED 且被计数（endonym / 共享外壳 / reader 数据），不是一句「豁免」——
//     排除集合若静默长大到吞掉整页，这里的断言会先红（/sessions 的 ROW 15 ⑥ 同款手法）。
//   • **两条潜伏行**（`colSession` / `recentPromotions`，ROW 16 ④）：健康单次探针看不见它们。
//     `recentPromotions` 在本文件里是**可见**的——fixture 写入 `.quay/promotion-round.jsonl`，于是它
//     经过一次真实 HTTP 渲染被断言（不是靠读字典自证）。`colSession` 的渲染点在当前树里**结构上
//     不可达**（liveness reader 已于 2026-09-03 退役、恒返回 `{sessions: []}`），这里明确具名这件事
//     而不是假装覆盖了它（硬规则 3b：一个到不了的「已覆盖」与「没接上」同形）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  MANAGER_LABELS,
  MANAGER_KEYS,
  managerLabelsFor,
  managerLabel,
  fillLabel,
} from "../src/serve-i18n.ts";
import { escapeHtml } from "../src/serve-render.ts";
import { readManager } from "../src/observation.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes the whole task is defined against: Han, CJK punctuation (、。「」) and the
 *  full-width forms (：（），、). ONE regex, shared by the dictionary assertion and the black-box one,
 *  so the two cannot drift into two different definitions of "Chinese".
 *
 *  Built from CODE POINTS rather than written as a literal range: the file that defines "Chinese
 *  copy" is the last place that should itself contain Chinese (same idiom as the /dashboard test). */
const cp = (n) => String.fromCharCode(n);
const CJK = new RegExp(`[${cp(0x4e00)}-${cp(0x9fff)}${cp(0x3000)}-${cp(0x303f)}${cp(0xff00)}-${cp(0xffef)}]`);

/** The switcher's ENDONYM, deliberately identical in both columns (serve-i18n.ts ROW 4): a reader
 *  who cannot read the current UI language must still be able to find their own. It is therefore the
 *  one Chinese word an English page is SUPPOSED to carry. */
const ENDONYM = cp(0x4e2d) + cp(0x6587); // 中文

/** SHARED chrome this page ECHOES but does not own — `obsNote`'s state words (serve-render.ts), the
 *  same function every page renders, assigned by serve-i18n.ts ROW 16 ⑤ to the series' shared
 *  residue list. ⛔ Not a blanket exemption: the list is NAMED and its hits are asserted to have
 *  actually fired, so it cannot silently grow to swallow this page's own copy. */
const SHARED_CHROME_WORDS = [
  "未接入/无数据",              // 未接入/无数据
  "已接入/暂无记录",        // 已接入/暂无记录
  cp(0x8bfb) + "失败",                          // 读失败
];

function get(port, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    }).on("error", reject);
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

/** The language switcher's items — the CURRENT language renders as a `<span>`, the other as an
 *  `<a href="?lang=…">`; both must be matched (an earlier version of this helper in the /dashboard
 *  test matched `<span>` only and silently left both endonyms in place). */
const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;
function stripLangSwitcher(body) {
  const hits = body.match(LANG_SWITCHER_ITEM_RE) ?? [];
  return { stripped: hits.reduce((acc, h) => acc.split(h).join(""), body), hits };
}

/** Chinese lines this PAGE authored — i.e. excluding (a) the switcher's endonym and (b) any line
 *  carrying a string the READER produced and this page merely echoes.
 *
 *  (b) is AC2's "剩余含中文的行逐条归类" made mechanical. The reader's own text covers two classes:
 *  the diagnostics after the `obsNote` prefix (`— …/loop-driver-check.sh 缺失（…）`) and the
 *  `observer-registry.conf` rows' `note` column — both rendered VERBATIM by this page, both the same
 *  class of thing as a task title. They are read here FROM THE SAME READER the page read
 *  (`readManager`), escapeHtml'd the same way, and lines they account for are excluded.
 *
 *  ⛔ ONLY CJK-bearing reader strings are eligible as exclusions. A short ASCII value would be a
 *  black hole — `line.includes(".")` is true of nearly every line — so the filter is "the reader
 *  string itself contains CJK", which is exactly the set that can account for a CJK line. */
function pageAuthoredCjk(body, mgr) {
  const readerTexts = [
    mgr.loopDriver.reason, mgr.liveness.reason, mgr.observers.reason, mgr.pool.reason,
    ...mgr.observers.rows.flatMap((r) => [r.name, r.note, r.root, r.status]),
  ]
    .map((t) => escapeHtml(String(t ?? "")).trim())
    .filter((t) => t.length > 0 && CJK.test(t));

  const { stripped, hits } = stripLangSwitcher(body);
  const excluded = [];
  const residual = cjkLines(stripped).filter((line) => {
    if (line === ENDONYM) { excluded.push(line); return false; }
    if (SHARED_CHROME_WORDS.some((w) => line.includes(w))) { excluded.push(line); return false; }
    if (readerTexts.some((t) => line.includes(t))) { excluded.push(line); return false; }
    return true;
  });
  return { residual, excluded, hits };
}

// ── the fixture: a real workspace. ASCII-only where it matters, EXCEPT the two deliberate Chinese
//    carriers that must survive in both languages — the observer registry's `note` column (read
//    from the real `orchestration/observer-registry.conf`) and the reader's own diagnostics. ─────

let server, port, root, originalCwd, tasksDir;

before(async () => {
  tasksDir = makeTmpDir("mgr-i18n-tasks-");
  root = makeTmpDir("mgr-i18n-ws-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  // A promotion round with a `pool` reading AND a promoted id: this is what makes ROW 16's LATENT
  // `recentPromotions` row render at all, so the black-box assertion below covers a string a healthy
  // single-response probe can never see. `promoted_ids` is ASCII (an id, not copy).
  fs.writeFileSync(
    path.join(root, ".quay", "promotion-round.jsonl"),
    JSON.stringify({ ts: "2026-09-18T00:00:00Z", round: 3, action: "promote", pool: 3, promoted_ids: ["MGR-I18N-A"], error: null }) + "\n",
  );
  originalCwd = process.cwd();
  process.chdir(root);
  server = await startServer({ port: 0, host: "127.0.0.1" });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server?.client) await server.client.close();
  process.chdir(originalCwd);
});

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ───────────────────────────

test("AC4: MANAGER_KEYS and MANAGER_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...MANAGER_KEYS];
  assert.equal(new Set(roster).size, roster.length, "MANAGER_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(MANAGER_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  // The roster is the MEASURED one: `renderManagerPage` has exactly 11 non-comment CJK lines and the
  // roster is one row per RENDERED string (ROW 16's 1:1 claim). A stub roster would satisfy the two
  // assertions above; this one cannot.
  assert.equal(roster.length, 11, `the roster matches the render function's 11 CJK lines (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is the STRONGER predicate the roster actually needs: a zh value with no CJK is allowed
  // ONLY when it is byte-equal to its en value (a genuinely language-neutral token). An
  // accidentally-English zh prose value therefore still fails.
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of MANAGER_KEYS) {
    const { en, zh } = MANAGER_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: managerLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = managerLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...MANAGER_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of MANAGER_KEYS) assert.equal(t[key], MANAGER_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  assert.notDeepEqual(managerLabelsFor("en"), managerLabelsFor("zh"),
    "the two languages are not the same table (a both-columns-zh regression)");
});

test("AC4: an unknown key THROWS rather than falling back to English (ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => managerLabel("noSuchKey"), /unknown manager key/);
  // Negative control for the other direction: a REAL key must NOT throw.
  assert.equal(typeof managerLabel("headingLoop", "en"), "string");
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{file}` into the page", () => {
  assert.equal(fillLabel("release={version} · develop is {n} commits ahead", { version: "1.2.3", n: 0 }),
    "release=1.2.3 · develop is 0 commits ahead");
  assert.throws(() => managerLabel("poolSourceNote", "zh", { wrong: "x" }), /\{file\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  assert.throws(() => managerLabel("registryNote", "en", {}), /file/);
  // A template with no placeholders is fine with an empty map — the throw is keyed on the TEMPLATE.
  assert.equal(fillLabel("Loop / sessions", {}), "Loop / sessions");
});

test("AC4: every interpolated row carries its placeholders in BOTH columns (the en column is not a bare literal)", () => {
  const templated = MANAGER_KEYS.filter((k) => /\{\w+\}/.test(MANAGER_LABELS[k].en));
  assert.deepEqual(templated.slice().sort(), ["poolSourceNote", "registryNote", "releaseLine"],
    "the three interpolated rows are the measured set (a new one must be added here deliberately)");
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(MANAGER_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
  }
});

// ── ROW 16 ④: the two LATENT rows ────────────────────────────────────────────────────────────────

test("ROW 16 ④: `recentPromotions` renders through a REAL request — the latent row is covered, not assumed", async () => {
  // This row renders only when the pool reader's `lastPromoted` is non-empty (the fixture above
  // writes one). Without this arm the row would be in the dictionary and never exercised by any
  // test — the "implemented but never ran in production" shape (硬规则 4 推论三).
  const en = await get(port, "/manager", { Cookie: "lang=en" });
  const zh = await get(port, "/manager", { Cookie: "lang=zh" });
  assert.ok(en.body.includes("Most recent promotions (promotion-driver):"),
    "the en page renders the promotions line in English — i.e. the fixture's round record actually reached the renderer");
  assert.ok(zh.body.includes(MANAGER_LABELS.recentPromotions.zh), "the zh page renders it in Chinese");
  assert.ok(en.body.includes('href="/task/MGR-I18N-A"'), "…and the promoted id it labels is still there (the row is a label, not a replacement)");
});

test("ROW 16 ④: `colSession` is NAMED as unreachable rather than falsely covered", async () => {
  // The liveness reader is retired (`readManager` returns `{ status: "empty", sessions: [] }`), so the
  // table this header belongs to never renders — no request can reach it. That is recorded HERE so a
  // later reader does not have to rediscover it, and so this test does not claim a coverage it has.
  const mgr = await readManager(root);
  assert.deepEqual(mgr.liveness.sessions, [], "precondition: the liveness reader yields no rows, so its table cannot render");
  const en = await get(port, "/manager", { Cookie: "lang=en" });
  // Asserted on the `<th>` ELEMENT, not on the bare word: "Session" also occurs in the shared nav
  // label `Sessions`, so a substring test on the word alone would be vacuously false (硬规则 2 —
  // 按位置判定, not by keyword).
  assert.ok(!en.body.includes(`<th>${MANAGER_LABELS.colSession.en}</th>`),
    "…therefore the header is genuinely unreachable over HTTP (if this reds, the reader came back and this row needs a black-box arm)");
  // The row itself still obeys the roster rules — asserted here rather than left to the dictionary
  // test, so the reason it is only asserted at the dictionary level sits next to the assertion.
  assert.notEqual(MANAGER_LABELS.colSession.en, MANAGER_LABELS.colSession.zh, "the row IS translated");
  assert.ok(CJK.test(MANAGER_LABELS.colSession.zh), "…into Chinese");
});

// ── AC2/AC3 black box: the two languages on a real server ────────────────────────────────────────

test("AC2: `Cookie: lang=en` renders /manager with ZERO page-authored CJK — and the same predicate DOES hit on zh", async () => {
  const en = await get(port, "/manager", { Cookie: "lang=en" });
  assert.equal(en.status, 200, "GET /manager (en) returns 200");
  const mgr = await readManager(root);

  const { excluded, hits } = pageAuthoredCjk(en.body, mgr);
  // The switcher renders FOUR items on every page: desktop + mobile chrome, each carrying the current
  // language (`<span>`) and the other one (`<a href="?lang=…">`). Asserting the count makes the
  // endonym removal a fact rather than a hope.
  assert.equal(hits.length, 4, "the four language-switcher items (desktop+mobile × current+other) were located");
  assert.equal(hits.filter((h) => h.includes(ENDONYM)).length, 2, "the two endonyms (desktop + mobile) are among them");

  const { residual } = pageAuthoredCjk(en.body, mgr);
  console.log(`  [mgr-i18n] en residual=${JSON.stringify(residual)}`);
  console.log(`  [mgr-i18n] en excluded(${excluded.length})=${JSON.stringify(excluded)}`);
  assert.deepEqual(residual, [],
    "the en page renders interface copy in Chinese — every remaining CJK line must be the endonym, the NAMED shared chrome, or a reader string");

  // The exclusions are not a black hole: each class must actually have fired, and the set must stay
  // small and enumerable. (A blanket exemption would report the same empty residual for a broken page.)
  assert.equal(hits.filter((h) => h.includes(ENDONYM)).length, 2,
    "the endonym class is present in the page (the two switcher items stripped above)");
  assert.ok(excluded.some((l) => SHARED_CHROME_WORDS.some((w) => l.includes(w))),
    "the named shared-chrome class fired (obsNote's state words are on this page in this fixture)");
  assert.ok(excluded.some((l) => mgr.loopDriver.reason && l.includes(mgr.loopDriver.reason)),
    "the reader-diagnostic class fired (the loop-driver probe's own missing-script note)");
  assert.ok(excluded.length <= 12, `the excluded set stays small and enumerated (got ${excluded.length})`);

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  const zh = await get(port, "/manager", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200, "GET /manager (zh) returns 200");
  assert.ok(cjkLines(stripLangSwitcher(zh.body).stripped).length > 10,
    "precondition/control: the SAME CJK-line predicate finds the Chinese on the zh page");
});

test("AC2: the en page carries the new English copy, and the zh page keeps the extracted literals byte for byte", async () => {
  const en = await get(port, "/manager", { Cookie: "lang=en" });
  const zh = await get(port, "/manager", { Cookie: "lang=zh" });

  // Each zh literal is the PRE-EXTRACTION source string (ROW 7). A "reads better" zh value is a
  // regression here, which is why these are pinned verbatim rather than via the dictionary.
  for (const zhWord of [
    "三层状态",                       // h1 subtitle
    "三层自适应探测",     // probeNote
    "Loop / 会话",                            // headingLoop
    "Monitor 注册表",                     // headingObservers
    "主要观测指标",           // headingPool
    "单一登记表。",           // registryNote
    "cap 默认 5，floor = cap × 4",   // poolSourceNote
    "develop 领先",                           // releaseLine
    "Manager/Outer/Inner 三层状态",   // meta description
  ]) {
    assert.ok(zh.body.includes(zhWord), `the zh render keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
  }

  // The en counterparts — and each zh word above has an ABSENT arm here, so neither side can pass on
  // a page that renders both languages.
  for (const enWord of [
    "three-layer status",
    "Three-layer adaptive probing",
    "Loop / sessions",
    "Monitor registry",
    "Primary observability metrics",
    "single registration table",
    "cap defaults to 5, floor = cap × 4",
    "develop is",
    "Manager / Outer / Inner three-layer status",
  ]) {
    assert.ok(en.body.includes(enWord), `the en render carries ${JSON.stringify(enWord)}`);
  }
  for (const zhWord of ["三层状态", "三层自适应探测",
    "Loop / 会话", "Monitor 注册表", "主要观测指标"]) {
    assert.ok(!en.body.includes(zhWord), `the en render must not carry ${JSON.stringify(zhWord)}`);
  }

  // The `<h1>` is page NAME (ROW 3) + SUBTITLE (ROW 16) — two parallel lookups, asserted as the
  // composite the page actually renders (ROW 16 ①: a pre-localized composite passed to ROW 3 would
  // "work" by falling through the dictionary, which is the silent shape this arm rules out).
  assert.match(en.body, /<h1>Manager \/ Outer \/ Inner — three-layer status<\/h1>/);
  assert.match(zh.body, /<h1>管理器 \/ 外层 \/ 内层 — 三层状态<\/h1>/);

  // The `<meta name="description">` is copy too — and it is the one row NO visible-text probe can
  // reach (it lives in an attribute), which is why it is asserted directly (ROW 16 ②).
  assert.ok(en.body.includes('content="Quay manager — Manager / Outer / Inner three-layer status"'));
  assert.ok(zh.body.includes('content="Quay manager — Manager/Outer/Inner 三层状态"'));
});

test("AC5: /manager has exactly ONE rendering entry — no refresh endpoint can render it in the wrong language", async () => {
  // The /dashboard lesson (ROW 5 ⑥): a page that has a partial-refresh endpoint must carry the
  // language THROUGH it, and a single-response probe cannot see the drift. /manager has none today —
  // recorded as an assertion rather than a comment so that adding one is a deliberate act.
  const refreshish = ["/manager/cards", "/manager.json", "/manager/refresh"];
  for (const p of refreshish) {
    const r = await get(port, p, { Cookie: "lang=zh" });
    assert.notEqual(r.status, 200, `${p} does not exist — if this reds, a refresh endpoint was added and must take the request language`);
  }
  // …and the one real entry renders zh under `?lang=zh` (the query-parameter arm, not just the cookie).
  const q = await get(port, "/manager?lang=zh");
  assert.equal(q.status, 200);
  assert.ok(q.body.includes("主要观测指标"), "the query-parameter path renders Chinese too");
});
