// @test-group product
// gap-webui-system-body-copy-en-zh — /system 的【正文文案】本地化（正文本地化系列第 6 页）。
//
// 病灶与 /dashboard（系列第 1 页，定 pattern）同形：AC-293 把本页的【外壳】接进了 serve-i18n.ts 的
// 字典（`<html lang>`、共享 nav、`<title>` 与 `<h1>` 的**页名**），但**正文**仍是源码里的中文字面量 ——
// `lang=en` 下渲染出一个「框是英文、内容是中文」的页面。红基线（自起 startServer + `Cookie: lang=en`，
// 去 `<style>/<script>`/标签后按行数）：含 CJK 的文本行 **9** 条 = 界面文案 **7** 条（`<title>` 后缀、
// `<h1>` 后缀、`数据源：`、`（稳定机读 JSON 输出）`、`：资源充足，可以跑`、`阈值按`、
// `动态计算显示，不写死当前机器上的数字。`）+ 切换控件 endonym `中文` ×2（ROW 4 的既定设计）。
//
// 本文件验证（AC4 的机械判据 + AC2/AC3 的黑盒两态 + AC5 的渲染入口枚举）：
//   • 字典完备且被类型强制：`SYSTEM_LABELS` 是 `Record<SystemKey,{en,zh}>`，每键两列非空、en 列无 CJK、
//     zh 列含 CJK 或与 en 逐字相同（同 dashboard 测试：后者不是放宽，是更强的谓词）。
//   • 取词函数的两条 throw 路径（未知键 / 缺参数）—— 硬规则 3b 的那半边。
//   • 黑盒两态：真实 startServer（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`。
//   • **零计数的对照**（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中。
//   • AC5：本页的渲染入口**逐个**列出并验证 —— HTTP 侧只有 `/system` 一个路由（没有 /dashboard/cards
//     那样的局部刷新端点，`/system/cards` 实测 404，本文件把它钉住）；服务端侧还有一处**探测抓不到的
//     状态**：`renderBar` 的 `（未知上限）` marker 只在「有值但分母不可评估」时出现，机器通常不处于
//     该状态 —— 单次 HTTP 抓取看不见它，所以它必须由直接调用证明（同 ROW 13 的 fixture 理由）。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { SYSTEM_LABELS, SYSTEM_KEYS, systemLabelsFor, systemLabel, fillLabel, pageNameFor } from "../src/serve-i18n.ts";
import { renderBar } from "../src/serve-system.ts";
import { readSystem } from "../src/observation.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes this task is defined against: Han, CJK punctuation (、。「」) and the full-width
 *  forms (：（），、). ONE regex for the dictionary assertion AND the black-box one, so the two cannot
 *  drift into two different definitions of "Chinese". Built from CODE POINTS rather than written as
 *  a literal range: the file that defines "Chinese copy" is the last place that should itself
 *  contain Chinese (same helper as the dashboard body-i18n test — deliberately duplicated rather
 *  than shared, because a shared helper would have to live in one page's test file). */
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

/** Chinese lines this PAGE authored — excluding (a) the switcher's endonym and (b) any line a non-page
 *  module produced and the page merely echoes: `readSystem`'s diagnostics (「system 机制脚本缺失」 and
 *  the mechanism scripts' own failure reasons) are DATA, read here from the SAME reader the page read.
 *  ⛔ Not a blanket exemption: any label this page renders itself is absent from those strings and
 *  still fails, and the count of what was excluded is asserted alongside so the exclusion cannot
 *  silently grow to swallow the page. */
function pageAuthoredCjk(body, readerTexts) {
  const reasons = readerTexts.map((t) => String(t ?? "").trim()).filter((t) => t.length > 0);
  const accounted = (line) => line === "中文" || reasons.some((r) => r.includes(line));
  return cjkLines(stripLangSwitcher(body).stripped).filter((l) => !accounted(l));
}

// ── the fixture: a real workspace with a REAL task store, ASCII-titled, so the only possible CJK in
//    the response is interface copy. ───────────────────────────────────────────────────────────────

let server, port, root, originalCwd, tasksDir;

before(async () => {
  tasksDir = makeTmpDir("sys-i18n-tasks-");
  root = makeTmpDir("sys-i18n-ws-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  fs.writeFileSync(
    path.join(tasksDir, "SYS-A.md"),
    `---\nid: SYS-A\ntitle: alpha task\nstatus: ready\n---\n## Proposal\nascii body\n`,
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
  if (server) server.client = null;
});

/** The reader diagnostics the page echoes verbatim (see `pageAuthoredCjk`). Read from the SAME
 *  reader `handleSystem` read, so the exclusion list is derived, not hand-written. */
async function readerTexts() {
  const sys = await readSystem(root);
  return [sys.reason, sys.resourceGate.reason, sys.processBudget.reason].filter((r) => r != null);
}

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ────────────────────────────

test("AC4: SYSTEM_KEYS and SYSTEM_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...SYSTEM_KEYS];
  assert.equal(new Set(roster).size, roster.length, "SYSTEM_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(SYSTEM_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  assert.ok(roster.length >= 6, `the roster is the measured one, not a token stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of SYSTEM_KEYS) {
    const { en, zh } = SYSTEM_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: every interpolated row's placeholders are supplied in BOTH columns", () => {
  const templated = SYSTEM_KEYS.filter((k) => /\{\w+\}/.test(SYSTEM_LABELS[k].en));
  assert.ok(templated.length >= 2, `the interpolated rows exist (got ${templated.length})`);
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(SYSTEM_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
  }
});

test("AC4: systemLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = systemLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...SYSTEM_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of SYSTEM_KEYS) assert.equal(t[key], SYSTEM_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  assert.notDeepEqual(systemLabelsFor("en"), systemLabelsFor("zh"), "the two languages are not the same table (a both-columns-zh regression)");
  // The `<title>`/`<h1>` SUBTITLE is the row this whole task turns on: under en it must NOT be the
  // Chinese one (that was the defect), and ROW 3's page NAME must stay a separate lookup (ROW 14 ③).
  assert.equal(systemLabel("pageSubtitle", "en"), "system status", "the en subtitle is English");
  assert.equal(systemLabel("pageSubtitle", "zh"), "系统状态", "the zh subtitle is the pre-extraction literal");
  assert.equal(pageNameFor("System", "en"), "System", "the page NAME token stays ROW 3's identity under en");
  assert.equal(pageNameFor("System", "zh"), "系统", "the page NAME token stays ROW 3's under zh");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => systemLabel("noSuchKey"), /unknown system key/);
  assert.equal(typeof systemLabel("pageSubtitle", "en"), "string"); // negative control: a REAL key
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{gate}` into the page", () => {
  assert.equal(fillLabel("{a} · {b}", { a: "x", b: "y" }), "x · y");
  assert.throws(() => systemLabel("dataSourceNote", "en", { gate: "<code>x</code>" }), /\{budget\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  assert.throws(() => systemLabel("thresholdNote", "zh", {}), /\{nproc\}/);
  assert.equal(fillLabel("no placeholders", {}), "no placeholders");
});

// ── AC2/AC3 black box: the two languages on a real server ────────────────────────────────────────

test("AC2: `Cookie: lang=en` renders /system with ZERO interface CJK — and the same predicate DOES hit on zh (the zero-count control)", async () => {
  const en = await get(port, "/system", { Cookie: "lang=en" });
  assert.equal(en.status, 200);
  const { stripped, hits } = stripLangSwitcher(en.body);
  assert.equal(hits.length, 4, "the four language-switcher items (desktop+mobile × current+other) were located");
  assert.equal(hits.filter((h) => h.includes("中文")).length, 2, "the two 中文 endonyms (desktop + mobile) are among them");

  const residual = cjkLines(stripped);
  assert.ok(!residual.some((l) => l.includes("中文")),
    "the endonym is GONE after stripping — if it survived, the removal was a no-op and the assertion below is vacuous");
  assert.deepEqual(pageAuthoredCjk(en.body, await readerTexts()), [],
    "the en page carries interface copy in Chinese; the only Chinese an English page is supposed to carry is the switcher's own 中文 endonym");

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  const zh = await get(port, "/system", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200);
  assert.ok(cjkLines(stripLangSwitcher(zh.body).stripped).length > 20,
    "precondition/control: the same CJK-line predicate finds the Chinese on the zh page");
});

test("AC2: the en page carries the NEW English copy at every one of the seven sites (the fixed arm)", async () => {
  const en = await get(port, "/system", { Cookie: "lang=en" });
  // The `<title>`/`<h1>`: name (ROW 3) + subtitle (ROW 14), appended OUTSIDE pageTitle.
  assert.ok(en.body.includes("<title>") && /<title>[^<]* — System — system status<\/title>/.test(en.body.replace(/\n/g, " ")),
    "the en <title> ends with the English name + subtitle");
  assert.ok(en.body.replace(/\n/g, " ").includes("<h1>System — system status</h1>"), "the en <h1> is fully English");
  // The two meta notes — the filled templates, i.e. the rows really drove the render (`fillLabel`
  // would have thrown otherwise, but this asserts the FILLED form reached the response).
  assert.ok(en.body.includes("Data source: <code>resource-gate.sh --json</code> · <code>process-budget.sh --json</code> (stable machine-readable JSON output)"),
    "the data-source note renders its en row with both <code> parameters filled");
  assert.ok(en.body.includes("Thresholds are computed from <code>nproc</code> at render time"),
    "the threshold note renders its en row with the <code>nproc</code> parameter filled");
  // The banner: exactly ONE of the two rows is live (whichever the machine's verdict is), and its en
  // tail must be present while the zh tail must not (the mechanical counterpart).
  const bannerRows = ["bannerGo", "bannerWait"].map((k) => SYSTEM_LABELS[k]);
  const liveRow = bannerRows.find((r) => en.body.includes(r.en));
  assert.ok(liveRow, `the en banner renders one of its two rows (en body banner tail=${JSON.stringify(/>⇒ (?:GO|WAIT)<\/strong>(.)/.exec(en.body.replace(/\n/g, " "))?.[1])})`);
  for (const r of bannerRows) assert.ok(!en.body.includes(r.zh), `the en banner must not carry the zh tail ${JSON.stringify(r.zh)}`);
});

test("AC3: `Cookie: lang=zh` still renders the pre-existing Chinese body copy (the extracted literals did not move)", async () => {
  const zh = await get(port, "/system", { Cookie: "lang=zh" });
  const en = await get(port, "/system", { Cookie: "lang=en" });
  for (const zhWord of [
    "系统 — 系统状态",              // <h1> / <title> tail: ROW 3's name + ROW 14's subtitle
    "数据源：",                      // the data-source note's leading copy
    "（稳定机读 JSON 输出）",         // …its trailing copy (full-width brackets inside the row)
    "阈值按",                        // the threshold note's leading copy
    "动态计算显示，不写死当前机器上的数字。", // …its trailing copy
    "中文",                          // the switcher's endonym (ROW 4 — deliberately unchanged)
  ]) {
    assert.ok(zh.body.includes(zhWord), `zh render keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
  }
  // …and the SAME words are ABSENT under en, so each zh assertion above has a counterpart that can
  // fail (a "present" assertion with no "absent" arm passes on a page that renders both languages).
  for (const zhWord of ["系统 — 系统状态", "数据源：", "（稳定机读 JSON 输出）", "阈值按", "动态计算显示，不写死当前机器上的数字。"]) {
    assert.ok(!en.body.includes(zhWord), `en render must not carry ${JSON.stringify(zhWord)}`);
  }
  // The banner is machine-state dependent (GO vs WAIT), so it is asserted as a PAIR of rows: the zh
  // tail of the live row is present under zh and absent under en.
  const bannerRows = ["bannerGo", "bannerWait"].map((k) => SYSTEM_LABELS[k]);
  const live = bannerRows.find((r) => zh.body.includes(r.zh));
  assert.ok(live, "the zh banner renders one of its two rows");
  assert.ok(!zh.body.includes(live.en), `the zh banner must not carry the en tail ${JSON.stringify(live.en)}`);
});

// ── AC5: EVERY render entry point, enumerated (not "the one we remembered") ──────────────────────

test("AC5: /system is served by exactly ONE route and has NO partial-refresh endpoint (`/system/cards` is not one)", async () => {
  // /dashboard has `/dashboard/cards` (a 30 s whole-card DOM replacement whose payload must carry the
  // REQUEST's language — a regression there is invisible to a single-response probe). /system has no
  // such endpoint; that is a property to ASSERT, not to assume: a future refresh endpoint added
  // without `lang` is exactly the defect shape the series' ROW 5 ⑥ exists for.
  const probe = await get(port, "/system/cards", { Cookie: "lang=zh" });
  assert.equal(probe.status, 404, "/system/cards is not a route (no partial-refresh endpoint exists for this page)");
  // …and the ONE route it does have answers under BOTH languages (the mechanism itself).
  for (const [lang, tag] of [["en", '<html lang="en">'], ["zh", '<html lang="zh"']]) {
    const res = await get(port, "/system", { Cookie: `lang=${lang}` });
    assert.equal(res.status, 200, `GET /system (${lang}) returns 200`);
    assert.ok(res.body.includes(tag), `GET /system (${lang}) renders ${tag}`);
  }
});

test("AC5: renderBar's unknown-limit marker follows `lang` — the page's ONE state a single HTTP grab cannot reach", () => {
  // `（未知上限）` renders only when a value exists but its denominator is unevaluable; the real
  // machine is not in that state (and a test cannot make it be), so this is the reachable proof for
  // that row. ⛔ Both directions asserted: en must NOT carry the Chinese marker (the defect), zh MUST
  // (the byte-equal literal).
  const en = renderBar("loadavg (1m)", 5, null, "nproc×factor", "en");
  const zh = renderBar("loadavg (1m)", 5, null, "nproc×factor", "zh");
  assert.ok(en.includes("(unknown limit)"), `the en marker is English (got ${JSON.stringify(en)})`);
  assert.ok(!CJK.test(en), "the en bar carries no CJK at all");
  assert.ok(zh.includes("（未知上限）"), "the zh marker is the pre-extraction literal");
  assert.ok(!zh.includes("(unknown limit)"), "the zh bar must not carry the en marker");
  // The default (no `lang` argument) is the en baseline — a direct caller that predates `lang`
  // renders what it always rendered, and this page's en baseline cannot move as a side effect.
  assert.equal(renderBar("loadavg (1m)", 5, null, "nproc×factor"), en, "renderBar's default language is the en baseline");
  // A bar whose denominator IS evaluable carries no marker in either language (the negative control:
  // the assertion above is about the marker, not about the function always emitting one).
  for (const lang of ["en", "zh"]) {
    const ok = renderBar("loadavg (1m)", 5, 32, "32", lang);
    assert.ok(!CJK.test(ok), `${lang}: an evaluable bar carries no CJK`);
  }
});
