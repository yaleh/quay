// @test-group product
// gap-webui-needs-human-body-copy-en-zh — /needs-human 的【正文文案】本地化（正文本地化系列的续页，
// 照 gap-webui-dashboard-body-copy-en-zh 已定的 pattern，不重新设计）。
//
// 病灶：AC-295 把 /needs-human 的【外壳】（`<html lang>`、nav、`<title>`/`<h1>` 的 PAGE token）接到了
// serve-i18n.ts 的字典，但网页**正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个「框是英文、
// 内容是中文」的页面。红基线（真实 startServer + `Cookie: lang=en`，去 `<style>/<script>`/标签后按行）：
//   · 有任务态 9 行、空态 11 行、有任务但无阻碍原因态 9 行（三态都要量——空态与「未记录」只在各自
//     状态下渲染，一次抓取看不到另一态）。
//
// 本文件验证（AC4/AC5 的机械判据 + AC2/AC3 的黑盒三态）：
//   • 字典完备且被类型强制：`NEEDS_HUMAN_LABELS` 是 `Record<NeedsHumanKey,{en,zh}>`，键集闭合、
//     每键两列非空、en 列无 CJK、zh 列含 CJK 或与 en 逐字相同（见 `zhArmOk` 的注释——后者不是放宽，
//     是更强的谓词）。
//   • 取词函数的两条 throw 路径（未知键 / 缺参数）—— 硬规则 3b 的那半边：读不懂输入时不得返回与
//     「合格」同形的值。缺参数若静默留 `{code}`，页面会把自己的模板语法渲染出来，而没有一条
//     「页面上有没有该有的值」的检查会变红。
//   • 黑盒三态：真实 startServer（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`。
//   • **零计数的对照**（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中——否则「en 下 0 条」可能
//     只是谓词坏了。
//   • **数据不翻译的正控制**：带中文标题/中文阻碍原因的任务在 en 下必须**原样**渲染它的中文，
//     否则「en 下 CJK = 0」可以被一个「页面根本不渲染数据」的页面满足（硬规则 4）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { startServer } from "../src/serve.ts";
import {
  NEEDS_HUMAN_KEYS,
  NEEDS_HUMAN_LABELS,
  needsHumanLabelsFor,
  needsHumanLabel,
  fillLabel,
} from "../src/serve-i18n.ts";
import { renderNeedsHumanPage } from "../src/serve-needs-human.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { createStore } from "../../quay-native/src/store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes this task is defined against: Han, CJK punctuation (、。「」) and the full-width
 *  forms (：（），). One regex, shared by the dictionary assertion and the black-box one, so the two
 *  cannot drift into two different definitions of "Chinese".
 *
 *  Built from CODE POINTS rather than written as a literal range: this file is itself swept by the
 *  repo's CJK greps, and a literal range here would make every future sweep flag this file. */
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

/** The page's VISIBLE text: styles/scripts dropped, tags stripped, entities decoded. The SAME unit
 *  the red baseline was measured in, so the test and the measurement speak one language. */
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

/** The language switcher's ENDONYM, which is DELIBERATELY the same word in both columns (serve-i18n
 *  ROW 4: a reader who cannot read the current UI language must still be able to find their own).
 *  It is therefore the ONE CJK word an English page is SUPPOSED to carry.
 *
 *  Both switcher arms must be matched: the CURRENT language renders as a `<span>`, the other as an
 *  `<a href="?lang=…">`. The hit count is returned and asserted by the caller, so a regex that
 *  silently stopped matching cannot turn "no residual CJK" into a tautology. */
const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;
function stripLangSwitcher(body) {
  const hits = body.match(LANG_SWITCHER_ITEM_RE) ?? [];
  return { stripped: hits.reduce((acc, h) => acc.split(h).join(""), body), hitCount: hits.length };
}

/** The switcher's CJK endonym word(s), read OFF the rendered page rather than hard-coded here: the
 *  point of the exclusion is "whatever the switcher renders", and pinning the literal would make
 *  this helper the second place that has to be edited when ROW 4 changes. ⛔ The lookup is asserted
 *  non-empty by the caller — an empty result would make the filter below a no-op.
 *
 *  ⚠️ ALL items are scanned, not the first: the switcher renders TWO items and the one marked
 *  `aria-current` is the CURRENT language, which under en is the ASCII `EN`. Taking the first match
 *  (the obvious implementation) therefore returns no CJK under en — the exact shape of a filter that
 *  silently removes nothing while looking like it works. */
function switcherCjkWords(body) {
  return (body.match(LANG_SWITCHER_ITEM_RE) ?? [])
    .flatMap((item) => visibleText(item).split("\n"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && CJK.test(s));
}

// ── the fixtures ─────────────────────────────────────────────────────────────────────────────────
// ⚠️ EVERY fixture's DATA is ASCII ON PURPOSE (titles, ids, ledger detail, reason text): with no
// Chinese in the data, the ONLY possible CJK on the en page is interface copy, which is what makes
// the "en CJK = 0" assertion mean something. The one fixture that carries Chinese data exists to
// prove the converse (test below) and is never used for the zero assertion.

/** The `## Needs-Human` body the promotion-driver.markNeedsHuman writes. ⚠️ The `阻碍原因：` PREFIX
 *  is the reader's parse key, so it stays Chinese in the fixture body — and the body is never
 *  rendered, so it contributes no visible CJK. */
const nhBody = (reason) =>
  `## Proposal\nA sufficiently long proposal section for the needs-human fixture.\n` +
  `## Plan\nA sufficiently long plan section for the needs-human fixture.\n` +
  `## Acceptance Criteria\n- [ ] a sufficiently long acceptance criterion line\n` +
  `## Definition of Done\n- [x] a sufficiently long definition-of-done line\n` +
  `## Needs-Human\n\n**exec 2026-08-23T09:09:46.037Z — promotion-driver**\n\n- 阻碍原因：${reason}\n`;

/** A `## Needs-Human` body with NO 阻碍原因 line — a task set to needs-human by a different path
 *  (manual `task edit --status needs-human`). This is the ONLY state that renders the
 *  `未记录` / `Not recorded` word, in TWO places (the cell's text and its `title` attribute). */
const nhBodyNoReason = nhBody("").replace(/^- 阻碍原因：\n/m, "");

const LEDGER_TS = "2026-08-23T04:14:47.064Z";

/** Build a real workspace (config + git), seed it via `seed`, run `fn(port)` against a REAL server
 *  rooted there, then tear every bit of it down. */
async function withPage(fixture, fn) {
  const root = makeTmpDir("nh-i18n-ws-");
  const tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "nh body-i18n fixture\n");
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "fixture"], { cwd: root });
  fixture(tasksDir, root);

  const cwd0 = process.cwd();
  let server;
  try {
    process.chdir(root);
    server = await startServer({ port: 0 });
    await fn(server.address().port);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
  }
}

function seed(tasksDir, id, fields) {
  return createStore(tasksDir).write(id, { labels: [], ...fields });
}

function writeLedger(root, rows) {
  fs.writeFileSync(path.join(root, ".quay", "promotion-outcome.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

const ledgerRow = (taskId) => ({
  task_id: taskId, gate: { eligible: false, missing: [] }, action: "needs-human",
  result: { ok: true, detail: "retry-cap-exhausted" }, ts: LEDGER_TS,
});

/** Assert the en page carries NO interface CJK, and that the SAME predicate DOES fire on the zh
 *  render (the zero-count control from 硬规则 2: a count of 0 carries information only if the
 *  predicate is known to fire on a known-true sample). Returns the residual lines for the caller's
 *  own classification. */
function assertEnCleanAndControlFires(port, requestPath, en, zh) {
  const enHits = stripLangSwitcher(en.body);
  assert.ok(enHits.hitCount >= 2, `the switcher is present on the page (got ${enHits.hitCount} items) — a missing switcher would make the endonym filter vacuous`);
  const endonyms = switcherCjkWords(en.body);
  assert.ok(endonyms.length > 0, "the switcher's endonym word is readable — an empty one would make the filter below a no-op");

  const residual = cjkLines(enHits.stripped).filter((l) => !endonyms.includes(l));
  assert.deepEqual(residual, [], `en ${requestPath}: no interface CJK may remain on the page`);

  // the control: the identical predicate must find Chinese on the zh render of the SAME state.
  const zhCjk = cjkLines(zh.body);
  assert.ok(zhCjk.length > 0,
    `CONTROL FAILED for ${requestPath}: the predicate found 0 CJK lines on the zh render too — ` +
    `it is broken, and the en zero above therefore carries no information`);
  return { residual, zhCjk, enCjk: cjkLines(en.body) };
}

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ────────────────────────────

test("AC4: NEEDS_HUMAN_KEYS and NEEDS_HUMAN_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...NEEDS_HUMAN_KEYS];
  assert.equal(new Set(roster).size, roster.length, "NEEDS_HUMAN_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(NEEDS_HUMAN_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  // The roster is the MEASURED one, not a token stub: the red baseline found nine distinct interface
  // strings across the three states (three of which carry a `{code}` hole).
  assert.ok(roster.length >= 9, `the roster is the measured one, not a stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is NOT "the zh column contains CJK or symbols" — it is the STRONGER predicate the
  // roster actually needs: a zh value with no CJK is allowed ONLY when it is byte-equal to its en
  // value (a genuinely language-neutral token). An accidentally-English zh prose value therefore
  // still fails, and a plain-English placeholder cannot hide behind "it contains no symbols".
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of NEEDS_HUMAN_KEYS) {
    const { en, zh } = NEEDS_HUMAN_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: every `{code}`-templated row carries the hole in BOTH columns (an en-only hole renders the payload into the zh sentence unseen)", () => {
  // ⚠️ This row is what ROW 18's `{code}` shape exists for: the page's intro sentence and both
  // section headings embed a `<code>` ELEMENT mid-sentence, and the hole's POSITION differs between
  // the columns (`一条 {code} 产生后` vs `once a {code} is raised`). A hole present in en and absent
  // from zh is not a typo — it silently renders the payload as a trailing fragment in the Chinese
  // sentence, which no "the page has no English left" check can see.
  const templated = NEEDS_HUMAN_KEYS.filter((k) => /\{\w+\}/.test(NEEDS_HUMAN_LABELS[k].en));
  assert.ok(templated.length >= 4, `the templated rows exist (got ${templated.length})`);
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(NEEDS_HUMAN_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
    assert.match(NEEDS_HUMAN_LABELS[key].en, /\{code\}/, `${key}: the hole is named \`code\` (the call site supplies that name)`);
    assert.match(NEEDS_HUMAN_LABELS[key].zh, /\{code\}/, `${key}: the zh hole is named \`code\` too`);
  }
  // The non-templated rows must NOT carry a hole — `needsHumanLabel` would then throw at render time
  // on a row whose call site has nothing to pass.
  for (const key of NEEDS_HUMAN_KEYS.filter((k) => !templated.includes(k))) {
    assert.ok(!/\{\w+\}/.test(NEEDS_HUMAN_LABELS[key].en) && !/\{\w+\}/.test(NEEDS_HUMAN_LABELS[key].zh),
      `${key}: a row with no interpolation must carry no placeholder`);
  }
});

test("AC4: needsHumanLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = needsHumanLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...NEEDS_HUMAN_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of NEEDS_HUMAN_KEYS) assert.equal(t[key], NEEDS_HUMAN_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  assert.notDeepEqual(needsHumanLabelsFor("en"), needsHumanLabelsFor("zh"),
    "the two languages are not the same table (a both-columns-zh regression)");
  // The default argument is the en column — `renderNeedsHumanPage`'s own default depends on it.
  assert.deepEqual(needsHumanLabelsFor(), needsHumanLabelsFor("en"), "the default language resolves to en");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 18 / 硬规则 3b)", () => {
  assert.throws(() => needsHumanLabel("noSuchKey"), /unknown needs-human key/);
  // Negative control for the other direction: a REAL key must NOT throw.
  assert.equal(typeof needsHumanLabel("titleSuffix", "en"), "string");
  assert.equal(needsHumanLabel("titleSuffix", "zh"), "待人类决定", "a real key resolves its zh column");
});

test("AC4: a missing `{code}` parameter THROWS — the page never renders its own template syntax", () => {
  assert.throws(() => needsHumanLabel("intro", "en"), /\{code\}/,
    "a caller that forgets `{code}` must get an error, not a page showing `{code}`");
  assert.throws(() => needsHumanLabel("sectionActive", "zh", { wrong: "x" }), /\{code\}/,
    "supplying the WRONG parameter name is the same omission");
  assert.equal(needsHumanLabel("sectionActive", "en", { code: "<code>status: needs-human</code>" }),
    "Currently awaiting (<code>status: needs-human</code>)", "the supplied payload is inserted verbatim");
  // A template with no placeholders is fine with an empty map — the throw is keyed on the TEMPLATE,
  // not on "the caller passed nothing".
  assert.equal(fillLabel("Awaiting human decision", {}), "Awaiting human decision");
});

// ── AC2/AC3 black box: the two languages on a real server, in ALL THREE renderable states ─────────

test("AC2: `lang=en` on the POPULATED page has ZERO interface CJK, and the same predicate DOES hit on zh (the zero-count control)", async () => {
  await withPage((tasksDir, root) => {
    seed(tasksDir, "NH-ACTIVE", { title: "ascii active task", status: "needs-human", body: nhBody("ascii blocking reason") });
    writeLedger(root, [ledgerRow("NH-ACTIVE")]);
  }, async (port) => {
    const en = await get(port, "/needs-human");
    const zh = await get(port, "/needs-human", { Cookie: "lang=zh" });
    assert.equal(en.status, 200, "GET /needs-human (en) returns 200");
    assert.equal(zh.status, 200, "GET /needs-human (zh) returns 200");

    assertEnCleanAndControlFires(port, "/needs-human", en, zh);

    // The page still RENDERS (the localization did not delete the data path).
    assert.ok(en.body.includes("NH-ACTIVE"), "the active task id still renders under en");
    assert.ok(en.body.includes("ascii blocking reason"), "the 阻碍原因 data still renders under en");
    assert.ok(en.body.includes("retry-cap-exhausted"), "the ledger detail still renders under en");
  });
});

test("AC2: `lang=en` on the EMPTY page has ZERO interface CJK (the empty-state copy is localized too), zh control fires", async () => {
  await withPage(() => {}, async (port) => {
    const en = await get(port, "/needs-human");
    const zh = await get(port, "/needs-human", { Cookie: "lang=zh" });
    assert.equal(en.status, 200, "an empty workspace still returns 200");

    // ⚠️ This state is the reason the red baseline measured three states and not one: the two empty
    // notes render ONLY here, so a probe that fetched the populated page would have left 4 of the
    // roster's rows untested against a real response.
    const { zhCjk } = assertEnCleanAndControlFires(port, "/needs-human (empty)", en, zh);
    assert.ok(zhCjk.some((l) => l.includes("当前无")), "the zh empty-active note is present (the state really is empty)");
    assert.ok(zhCjk.some((l) => l.includes("无 needs-human 升级记录")), "the zh empty-ledger note is present");
    // ⚠️ The ledger path is asserted on the RAW body, not on `cjkLines`: it is ASCII inside a
    // `<code>` element, so tag-stripping isolates it onto a line of its own that the CJK predicate
    // by construction cannot see. Asserting it there would have been an assertion about the probe
    // rather than about the page.
    assert.ok(zh.body.includes("<code>.quay/promotion-outcome.jsonl</code>"),
      "the empty-ledger note carries the ledger path in its `{code}` hole under zh too");
  });
});

test("AC2: `lang=en` on the NO-REASON page has ZERO interface CJK — the `未记录` row renders only in this state", async () => {
  await withPage((tasksDir, root) => {
    seed(tasksDir, "NH-NO-REASON", { title: "ascii unreasoned task", status: "needs-human", body: nhBodyNoReason });
    writeLedger(root, [ledgerRow("NH-NO-REASON")]);
  }, async (port) => {
    const en = await get(port, "/needs-human");
    const zh = await get(port, "/needs-human", { Cookie: "lang=zh" });
    const { zhCjk } = assertEnCleanAndControlFires(port, "/needs-human (no-reason)", en, zh);

    // The state really is the no-reason one, and the zh side still says 未记录 (the zh column of the
    // word this task moved behind the dictionary).
    assert.ok(zhCjk.some((l) => l === "未记录"), `the zh absent-value word renders in this state (got ${JSON.stringify(zhCjk)})`);
    assert.ok(!en.body.includes("未记录"), "the zh absent-value word is absent under en");
    // ... and it is present in the ATTRIBUTE too, which no visible-text probe can see.
    assert.ok(!/title="[^"]*未记录/.test(en.body), "the `title` attribute of the reason cell is English under en");
  });
});

test("AC2 positive control: DATA is NOT translated — Chinese task text renders verbatim under en", async () => {
  // ⛔ Without this, "en has no interface CJK" could be satisfied by a page that simply stopped
  // rendering its rows. The Chinese here is a TASK TITLE and a REASON — data, whose language is the
  // author's, not the request's — so it must survive into the English page unchanged.
  const zhTitle = "一个中文标题不是界面文案";
  const zhReason = "一个中文阻碍原因不是界面文案";
  await withPage((tasksDir, root) => {
    seed(tasksDir, "NH-ZH-DATA", { title: zhTitle, status: "needs-human", body: nhBody(zhReason) });
    writeLedger(root, [{ ...ledgerRow("NH-ZH-DATA"), result: { ok: true, detail: zhReason } }]);
  }, async (port) => {
    const en = await get(port, "/needs-human");
    assert.ok(en.body.includes(zhTitle), "the Chinese TASK TITLE renders verbatim under en (data is not copy)");
    assert.ok(en.body.includes(zhReason), "the Chinese REASON renders verbatim under en");
    // and the classification the AC2 arm demands: every remaining CJK line IS one of those data items.
    const endonyms = switcherCjkWords(en.body);
    const residual = cjkLines(stripLangSwitcher(en.body).stripped).filter((l) => !endonyms.includes(l));
    const unclassified = residual.filter((l) => !zhTitle.includes(l) && !zhReason.includes(l));
    assert.deepEqual(unclassified, [], "every residual en CJK line is classified user data");
    assert.ok(residual.length > 0, "the residual classification is not vacuous (this fixture HAS data CJK)");
  });
});

test("AC3: `lang=zh` still renders every pre-existing Chinese interface literal (the extracted columns did not move)", async () => {
  // ⚠️ Not only en: the zh column is the PRE-EXISTING literal byte for byte (serve-i18n ROW 18 / ROW
  // 7), and this is the arm that catches a "reads better" re-wording. The literals are pinned HERE,
  // not read back from the dictionary (a page rendering the dictionary's own value would satisfy an
  // assertion that read the dictionary back — 硬规则 4).
  const PRE_EXISTING = [
    "待人类决定",
    "显式人机承接界面",
    "人机接口的显式承接者",
    "当前待办",
    "升级台账",
    "阻碍原因",
    "当前无 needs-human 任务",
    "无 needs-human 升级记录",
  ];
  await withPage(() => {}, async (port) => {
    const zh = await get(port, "/needs-human", { Cookie: "lang=zh" });
    assert.equal(zh.status, 200);
    const missing = PRE_EXISTING.filter((lit) => !zh.body.includes(lit));
    assert.deepEqual(missing, [], "every pre-existing zh interface literal still renders under zh");
    // The `<code>` payloads still ride their holes under zh.
    assert.ok(zh.body.includes("<code>status: needs-human</code>"), "the active heading's `{code}` payload is filled under zh");
    assert.ok(zh.body.includes("<code>action: needs-human</code>"), "the ledger heading's `{code}` payload is filled under zh");
    assert.ok(!zh.body.includes("{code}"), "no unfilled placeholder is rendered under zh");
  });
});

// ── AC5: every render path carries the request's language ─────────────────────────────────────────

test("AC5: the page has exactly TWO render entries (the route and the render function), and both take the language", async () => {
  // Enumerated by reading the source, and each one exercised here rather than asserted about:
  //   ① serve-handlers.ts's `/needs-human` route → handleNeedsHuman(req,res,client,manifest,cfg)
  //      → cfg.lang (the HTTP arm, covered by every black-box test above).
  //   ② renderNeedsHumanPage(active, ledger, manifest, identity, lang) — the ONE render function,
  //      whose `lang` parameter defaults to DEFAULT_LANG (en).
  // There is NO partial-refresh / JSON sub-endpoint on this page (unlike /dashboard/cards, which
  // re-renders cards 30 s after load and must therefore carry the language or the zh page silently
  // turns English seconds later). That absence is pinned rather than assumed, below.
  const active = [{ id: "NH-A", title: "ascii", labels: [], reason: null }];
  const ledger = [{ taskId: "NH-B", detail: null, ts: LEDGER_TS }];
  // ⚠️ A RESOLVED identity is passed on purpose. With `identity = null`, `pageTitle` takes its own
  // 「未接入项目身份 — <page>」 fallback — a string owned by serve-render.ts (it belongs to no single
  // page; the dashboard task recorded it as another task's copy), and one the HTTP path never
  // reaches because `startServer` always resolves an identity. Passing null here would have put a
  // non-this-page Chinese string into the residual and made the assertion fail for the wrong reason.
  const identity = { projectName: "nh-i18n-fixture", projectRoot: "/tmp/nh-i18n-fixture" };
  const en = renderNeedsHumanPage(active, ledger, { name: "quay" }, identity, "en");
  const zh = renderNeedsHumanPage(active, ledger, { name: "quay" }, identity, "zh");
  // ⚠️ The en arm is NOT "contains no CJK at all": the render function emits the whole page,
  // switcher included, and the switcher's endonym is Chinese by design. The predicate is therefore
  // the same strip-then-filter one the black-box tests use, not a bare CJK.test on the whole body.
  const endonyms = switcherCjkWords(en);
  const enResidual = cjkLines(stripLangSwitcher(en).stripped).filter((l) => !endonyms.includes(l));
  assert.deepEqual(enResidual, [], "the render function's en arm carries no interface CJK");
  assert.ok(en.includes("Awaiting human decision") && en.includes("Currently awaiting") && en.includes("Escalation ledger"),
    "the render function's en arm renders the English body copy");
  assert.ok(zh.includes("待人类决定") && zh.includes("当前待办") && zh.includes("升级台账"),
    "the render function's zh arm renders the pre-existing Chinese body copy");
  assert.equal(renderNeedsHumanPage(active, ledger, { name: "quay" }, identity), en,
    "omitting `lang` renders the DEFAULT language (en), not a third behaviour");

  await withPage(() => {}, async (port) => {
    // The absence of a second endpoint: `/needs-human/<anything>` is not a render path for this
    // page. If one is ever added, it must carry the language (see the /dashboard/cards precedent) —
    // this assertion is what makes that addition visible instead of silent.
    const sub = await get(port, "/needs-human/cards");
    assert.equal(sub.status, 404, "there is no /needs-human sub-endpoint (a new one must take `lang`)");
    assert.ok(!sub.body.includes("待人类决定") && !sub.body.includes("Awaiting human decision"),
      "the 404 body does not render this page");
  });
});
