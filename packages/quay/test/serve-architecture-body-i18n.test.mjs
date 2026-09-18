// @test-group product
// gap-webui-architecture-body-copy-en-zh — /architecture 的【正文文案】本地化（正文本地化系列第 4 页；
// 第 1 页 gap-webui-dashboard-body-copy-en-zh 定了 pattern，第 2 页 /board、第 3 页 /journal 照抄其
// 决定记录 ①~⑨）。
//
// 病灶：AC-289~303 把【外壳】（nav / `<title>` / `<h1>` / 切换控件）接到了 serve-i18n.ts 的字典，
// 但页面**正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个「框是英文、内容是中文」的页面。
// 实测（红基线，真实 workspace 上常驻 serve 的 HTTP 响应体，去标签后按行数）：`lang=en` 下含 CJK 的
// 文本行 **14 条**（另 2 条是切换控件的 endonym），逐条清单见任务体 AC1 证据。
//
// 本文件验证：
//   • AC4 —— 字典完备且被类型强制：`ARCHITECTURE_LABELS` 是 `Record<ArchitectureKey,{en,zh}>`，每键两列
//     非空、en 列无 CJK、zh 列含 CJK 或与 en 逐字相同（见 `zhArmOk` 的注释：后者不是放宽，是更强的谓词）。
//   • AC4 —— 取词函数的两条 throw 路径（未知键 / 缺参数）。这是硬规则 3b 的那半边：读不懂输入时
//     不得返回与「合格」同形的值。缺参数若静默留 `{days}`，页面会把自己的模板语法渲染出来，而没有一条
//     「页面上有没有该有的值」的检查会变红。
//   • AC2 —— 黑盒：真实 `startServer({port:0})`（⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`，
//     断言 en 下**界面** CJK = 0。
//   • AC2 的零计数对照（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中 —— 否则「en 下 0 条」
//     可能只是谓词坏了。
//   • AC3 —— zh 输出零变化：逐条断言改前的中文字面量仍在（含 `<title>`/`<h1>`/`<h2>`/`<th>` 整串），
//     且 en 下同一批词**缺席**（一个只有「在场」没有「缺席」臂的断言，在同时渲染两种语言的页面上也会通过）。
//   • AC5 —— 所有渲染路径都带语言：本页只有一条渲染路径（`serve-handlers.ts` `/architecture` →
//     `handleArchitecture` → `renderArchitecturePage`，无快照、无刷新端点、无客户端脚本），因此这条
//     AC 的判据是「枚举出的路径数 == 1 ∧ 该路径在两种语言下都被测到」——见 AC5 那条 test 的注释。
//   • AC6 的部分 —— 因果对照的可执行形态：把 `{days}` 钳成缺失参数即抛，见 AC4 的 throw 臂；本文件
//     另有一条**只对 zh 命中**的干跑臂（AC2 的零计数对照），它是「谓词没坏」的直接证据。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  ARCHITECTURE_LABELS,
  ARCHITECTURE_KEYS,
  architectureLabelsFor,
  architectureLabel,
  fillLabel,
  pageNameFor,
} from "../src/serve-i18n.ts";
import { ARCH_RECENT_WINDOW_DAYS } from "../src/observation.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes the whole task is defined against: Han, CJK punctuation (、。「」) and the
 *  full-width forms (：（），、). One regex, used by the dictionary assertion AND the black-box one,
 *  so the two cannot drift into two different definitions of "Chinese".
 *
 *  Built from CODE POINTS rather than written as a literal range: the file that defines "Chinese
 *  copy" is the last place that should itself contain Chinese, and a literal range here would make
 *  every future CJK sweep of this tree flag this file. (Same construction as the pattern task.) */
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

/** The page's VISIBLE text: styles/scripts dropped, tags stripped, entities decoded. This is the unit
 *  the red baseline was measured in, so the test and the measurement speak the same language. */
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

/** The language switcher's ENDONYM (`中文` / `EN`), DELIBERATELY identical in both columns
 *  (serve-i18n.ts ROW 4: a reader who cannot read the current UI language must still be able to find
 *  their own). It is the one Chinese word an English page is SUPPOSED to carry. Removed before the
 *  "no CJK under en" assertion — and the removal IS asserted to have hit (the count is checked), so a
 *  regex that silently stopped matching cannot turn that assertion into a tautology. */
const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;
function stripLangSwitcher(body) {
  const hits = (body.match(LANG_SWITCHER_ITEM_RE) ?? []);
  return { stripped: hits.reduce((acc, h) => acc.split(h).join(""), body), hits };
}

/** The SHARED-CHROME empty-state note this page echoes when the reader returns a non-ok status.
 *
 *  ⚠️ NAMED OUT-OF-SCOPE RESIDUE, not an oversight (serve-i18n.ts ROW 12's note). `obsNote`
 *  (serve-render.ts) renders `未接入/无数据` / `读失败` as SHARED CHROME consumed by six other pages
 *  (tests / system / sessions), and its `reason` half is the READER's own diagnostic
 *  (observation.ts) — the class /dashboard, /journal and /board all classified as DATA. Neither is in
 *  this task's Touches; the HEALTHY page never renders either. The empty-state arm below asserts the
 *  note is still there VERBATIM, so this residue cannot be mistaken for a defect this task left
 *  behind — and so a later sweep cannot rewrite it without reddening this file (the AC-303 meta-
 *  description pattern).
 *
 *  ⚠️ The split is asserted (non-zero), never assumed: a filter that silently stopped matching would
 *  make the "0 interface CJK" arm BELOW pass by removing real copy from the comparison. */
const SHARED_CHROME_CJK_RE = /^(未接入\/无数据|已接入\/暂无记录|读失败)$/;
function pageAuthoredCjk(body) {
  const all = cjkLines(stripLangSwitcher(body).stripped);
  const isSharedChromeOrReaderText = (line) => SHARED_CHROME_CJK_RE.test(line) || line.startsWith("— ");
  return {
    residual: all.filter((l) => !isSharedChromeOrReaderText(l)),
    excluded: all.filter(isSharedChromeOrReaderText),
  };
}

// ── the fixture: a real workspace with a git-inited `packages/` tree (so the component table renders
//    — status "ok", the state the red baseline was measured in) whose package names are ASCII. A
//    Chinese package name would make the assertion unfalsifiable: data and copy would be
//    indistinguishable, which is exactly the confusion AC1's classification had to resolve by hand.
//    git-inited (not merely mkdtemp'd) because `readArchitecture` shells out to `git -C <root> log`
//    and resolves the repo root from cwd. ────────────────────────────────────────────────────────

// ⚠️ `parent` is a MODULE-LEVEL binding on purpose: `tmp-leak-pairing-check` requires the mkdtemp
// result to be named in its cleanup (`fs.rmSync(<that variable>)` in an after() hook), so cleaning
// `path.dirname(root)` — the same directory, one alias away — would read as an UNPAIRED mkdtemp and
// red the static gate. The alias is not the thing the detector pairs on.
let server, port, root, parent, originalCwd, tasksDir;

before(async () => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "arch-i18n-"));
  root = path.join(parent, "main");
  tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  // Two ASCII-named components → the table renders (status "ok"). The names are deliberately chosen
  // so NEITHER carries a CJK character: the data side must contribute ZERO hits of the predicate, and
  // that is what makes the "0 interface CJK" arm a statement about COPY rather than about a page that
  // happens to have no data at all.
  for (const name of ["quay", "quay-native"]) {
    const dir = path.join(root, "packages", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0" }));
  }
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "architecture i18n fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "arch i18n fixture"], { cwd: root });

  originalCwd = process.cwd();
  process.chdir(root);
  server = await startServer({ port: 0, host: "127.0.0.1" });
  port = server.address().port;
});

after(async () => {
  await new Promise((r) => server.close(r));
  if (server?.client) await server.client.close();
  process.chdir(originalCwd);
  if (parent) fs.rmSync(parent, { recursive: true, force: true });
});

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ────────────────────────────

test("AC4: ARCHITECTURE_KEYS and ARCHITECTURE_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...ARCHITECTURE_KEYS];
  assert.equal(new Set(roster).size, roster.length, "ARCHITECTURE_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(ARCHITECTURE_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  // 13 = 1 <h1> subtitle + 3 source-note fragments + 4 legend words + 1 table heading + 4 column
  // headers. Pinned so a stub roster (one token key) cannot pass the arms below.
  assert.equal(roster.length, 13, `the roster is the MEASURED one, not a token stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is the STRONGER predicate (the pattern task's decision record ⑨): a zh value with no
  // CJK is allowed ONLY when it is byte-equal to its en value (a genuinely language-neutral token).
  // An accidentally-English zh prose value still fails, so a plain-English placeholder cannot hide
  // behind "it contains no CJK".
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of ARCHITECTURE_KEYS) {
    const { en, zh } = ARCHITECTURE_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: architectureLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = architectureLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...ARCHITECTURE_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of ARCHITECTURE_KEYS) assert.equal(t[key], ARCHITECTURE_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  // The two tables must not be identical: a change that mapped every key to its en value would leave
  // the per-key loop above green while removing the translation.
  const en = architectureLabelsFor("en"), zh = architectureLabelsFor("zh");
  assert.notDeepEqual(en, zh, "the two languages are not the same table (a both-columns-en regression)");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => architectureLabel("noSuchKey"), /unknown architecture key/);
  assert.throws(() => architectureLabel("noSuchKey", "zh"), /unknown architecture key/);
  // Negative control for the other direction: a REAL key must NOT throw.
  assert.equal(typeof architectureLabel("colComponent", "en"), "string");
  assert.equal(architectureLabel("colComponent", "zh"), "组件");
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{days}` into the page", () => {
  assert.equal(fillLabel("past {days} days", { days: 7 }), "past 7 days");
  assert.throws(() => fillLabel("past {days} days", {}), /\{days\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  // …and the same throw through the page's own accessor, for BOTH count-bearing rows.
  assert.throws(() => architectureLabel("tableHeading", "en", {}), /\{days\}/);
  assert.throws(() => architectureLabel("colRecentCommits", "zh", {}), /\{days\}/);
  assert.equal(architectureLabel("tableHeading", "zh", { days: 7 }), "组件最近变更（git 可证，近 7 天）");
  assert.equal(architectureLabel("colRecentCommits", "zh", { days: 7 }), "近 7 天提交");
  // A template with no placeholders is fine with an empty map — the throw is keyed on the TEMPLATE,
  // not on "the caller passed nothing".
  assert.equal(fillLabel("Stable", {}), "Stable");
});

test("AC4: every interpolated row carries its placeholder in BOTH columns (a translation cannot drop it)", () => {
  const templated = ARCHITECTURE_KEYS.filter((k) => /\{\w+\}/.test(ARCHITECTURE_LABELS[k].en));
  assert.deepEqual(templated.slice().sort(), ["colRecentCommits", "tableHeading"],
    "exactly the two count-bearing rows are templates — a third would be an unreviewed interpolation");
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(ARCHITECTURE_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
  }
  // ⛔ The window days must NOT be hard-written into either column: the reader's window is a
  // PARAMETER, so a literal `7` in the copy would be a second, silently-driftable source for one
  // number. Asserted on the RAW template (the pre-fill bytes), which is where a hard-written `7`
  // would appear.
  for (const key of templated) {
    for (const lang of ["en", "zh"]) {
      assert.ok(!/7/.test(ARCHITECTURE_LABELS[key][lang]),
        `${key}.${lang} must carry {days}, not a hard-written window length: ${JSON.stringify(ARCHITECTURE_LABELS[key][lang])}`);
    }
  }
});

test("AC4: the two count-bearing rows render the window the READER used, not a literal copied into the copy", () => {
  // `handleArchitecture` calls `readArchitecture(root)` with no `windowDays`, i.e. the reader's own
  // default export. The page imports THAT constant, so changing the reader's window changes the copy
  // by construction. This arm pins the value the two sides share, so a future literal `7` in the copy
  // (or a second, private default in the renderer) reddens here instead of drifting silently.
  assert.equal(ARCH_RECENT_WINDOW_DAYS, 7, "the reader's default window is 7 days");
  assert.ok(architectureLabel("tableHeading", "zh", { days: ARCH_RECENT_WINDOW_DAYS }).includes("近 7 天"));
  assert.ok(architectureLabel("colRecentCommits", "zh", { days: ARCH_RECENT_WINDOW_DAYS }).includes("近 7 天"));
});

// ── AC2/AC3 black box: the two languages on a real server ────────────────────────────────────────

test("AC2: `Cookie: lang=en` renders ZERO interface CJK — and the same predicate DOES hit on zh (the zero-count control)", async () => {
  const en = await get(port, "/architecture", { Cookie: "lang=en" });
  assert.equal(en.status, 200, "GET /architecture (en) returns 200");
  const { stripped, hits } = stripLangSwitcher(en.body);
  // The switcher renders FOUR items on every page: desktop + mobile chrome, each carrying the
  // current language (`<span>`) and the other one (`<a href="?lang=…">`). Asserting the count makes
  // the removal a fact rather than a hope — a regex that matched only one arm would leave 中文 items
  // in place and the comparison below would be comparing against a page that still carried them.
  assert.equal(hits.length, 4, "the four language-switcher items (desktop+mobile × current+other) were located");
  assert.equal(hits.filter((h) => h.includes("中文")).length, 2, "the two 中文 endonyms (desktop + mobile) are among them");
  assert.ok(!cjkLines(stripped).some((l) => l === "中文"),
    "the endonym is GONE after stripping — if it survived, the removal was a no-op and the assertion below is vacuous");

  // The healthy fixture renders the component table (status "ok"), i.e. exactly the state the red
  // baseline was measured in — so the residue filter must match NOTHING here. Asserted, because a
  // filter that started matching real copy would hollow out the comparison below.
  const { residual, excluded } = pageAuthoredCjk(en.body);
  assert.deepEqual(excluded, [],
    `the healthy page renders no shared-chrome empty-state note, so nothing may be excluded: ${JSON.stringify(excluded)}`);
  assert.deepEqual(residual, [],
    "the en page carries interface copy in Chinese; the only Chinese an English page is supposed to carry is the switcher's own 中文 endonym");

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  // A predicate that never matches anything would report the same "0" for a broken page and a fixed
  // one. Run the SAME predicate against the zh render: it must find Chinese.
  //
  // ⚠️ The count is asserted as `≥ 20`, NOT `== 14`: 14 was the **en** reading, where the shared nav
  // renders its ENGLISH labels — so 14 counts this page's OWN copy. The zh render additionally carries
  // the whole zh nav (15 items, desktop + mobile), which is chrome this task did not touch. Pinning 14
  // here would have asserted the wrong baseline; the ROSTER arm below is what pins the 14 exactly.
  const zh = await get(port, "/architecture", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200, "GET /architecture (zh) returns 200");
  const zhLines = cjkLines(stripLangSwitcher(zh.body).stripped);
  assert.ok(zhLines.length >= 20,
    `precondition/control: the same CJK-line predicate finds the Chinese on the zh page (got ${zhLines.length}): ${JSON.stringify(zhLines)}`);

  // …and the count is not merely "big": every one of the 14 interface lines the AC1 red baseline
  // ENUMERATED is present in the zh render, byte for byte. The `<title>` line is compared by its
  // SUFFIX because its prefix is the workspace's project label — i.e. the fixture's temp dir name, not
  // this page's copy (AC-303's `projectLabel` contract, not this task's surface).
  const zhLineSet = new Set(zhLines);
  for (const measured of [
    "架构 — 系统组件图",           // <h1> subtitle — the <title>'s own tail is the same phrase
    "数据源：", "（git log 提交事实）·", "（在飞开发）",
    "正在开发", "最近变更", "已标记问题", "稳定",
    "组件最近变更（git 可证，近 7 天）",
    "组件", "路径", "近 7 天提交", "末次提交",
  ]) {
    assert.ok(zhLineSet.has(measured),
      `the zh render carries the measured AC1 baseline line ${JSON.stringify(measured)} — the same 14-line ` +
      `predicate that read 0 on en; missing means the page stopped rendering it, not that it was translated`);
  }
});

test("AC2: the empty-state render (no packages/) carries no ARCHITECTURE-body CJK — the residue is named, not accidental", async () => {
  // The second state this page can be in. The fixture has no way to remove `packages/` from a running
  // server, so this arm reads the SAME renderer through a second workspace — the `?lang=en` reading of
  // a workspace whose `packages/` is absent. What it proves: the shared-chrome note is the ONLY
  // Chinese left, and it is excluded by an explicit, asserted filter rather than by the fixture having
  // no data at all.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "arch-i18n-bare-"));
  const cwd0 = process.cwd();
  let bareServer;
  try {
    fs.mkdirSync(path.join(bare, ".quay"), { recursive: true });
    fs.mkdirSync(path.join(bare, "tasks"), { recursive: true });
    fs.writeFileSync(
      path.join(bare, ".quay", "config.yml"),
      `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${path.join(bare, "tasks").replaceAll("\\", "\\\\")}"\n`,
    );
    process.chdir(bare);
    bareServer = await startServer({ port: 0, host: "127.0.0.1" });
    const barePort = bareServer.address().port;
    const r = await get(barePort, "/architecture", { Cookie: "lang=en" });
    assert.equal(r.status, 200, "the empty-state page still answers 200");
    const { residual, excluded } = pageAuthoredCjk(r.body);
    assert.deepEqual(residual, [],
      `the empty-state page carries no ARCHITECTURE body copy in Chinese — the only Chinese is the named shared-chrome note: ${JSON.stringify(residual)}`);
    // …and the exclusion really fired, so the arm above is not "the filter ate the whole page".
    assert.ok(excluded.length >= 1, `the named shared-chrome residue was actually found and excluded: ${JSON.stringify(excluded)}`);
    assert.ok(r.body.includes("未接入/无数据"),
      "RESIDUE (serve-i18n ROW 12): the shared-chrome empty-state note is STILL Chinese — deliberately out of scope for this page's task (serve-render.ts obsNote, six other pages share it)");
    // The body copy DID switch even here: the source note and the <h1> subtitle are English while the
    // reader's note is not — i.e. the arm is measuring copy, not the absence of a page.
    assert.ok(r.body.includes("Source:"), "the source note switched to English even in the empty state");
    assert.ok(!r.body.includes("数据源："), "…and its Chinese counterpart is absent");
  } finally {
    process.chdir(cwd0);
    if (bareServer) { await new Promise((res2) => bareServer.close(res2)); if (bareServer.client) await bareServer.client.close(); }
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

// ── AC3: the zh output did not move ──────────────────────────────────────────────────────────────

test("AC3: `Cookie: lang=zh` still renders the pre-existing Chinese body copy, and en carries none of it", async () => {
  const zh = await get(port, "/architecture", { Cookie: "lang=zh" });
  const body = zh.body;
  for (const zhWord of [
    "系统组件图",        // the <h1> subtitle (ROW 12 titleSuffix)
    "数据源：",          // source-note label
    "（git log 提交事实）· ", // source-note fragment 2 — the trailing space is part of the literal
    "（在飞开发）",       // source-note fragment 3
    "正在开发",           // legend: dev
    "最近变更",           // legend: recent
    "已标记问题",         // legend: stale
    "稳定",              // legend: stable
    "组件最近变更（git 可证，近 7 天）", // <h2> — the pre-extraction literal, window included
    "组件", "路径", "近 7 天提交", "末次提交", // the four column headers
    "跳到主要内容",       // shared skip link (ROW 9)
    "核心",              // shared mobile-menu group heading (ROW 9)
    "中文",              // the switcher's endonym (ROW 4 — deliberately unchanged)
  ]) {
    assert.ok(body.includes(zhWord), `zh render keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
  }
  // The whole-tag strings, byte for byte: these are what a "re-worded for readability" zh column
  // would break, and they are the reason the dictionary's zh arm is a REGRESSION if it moves (ROW 7).
  assert.ok(body.includes("<title>quay — 架构 — 系统组件图</title>") || /<title>[^<]*— 架构 — 系统组件图<\/title>/.test(body),
    "AC3: the zh <title> still ends with the pre-change token `架构 — 系统组件图`");
  assert.ok(body.includes("<h1>架构 — 系统组件图</h1>"), "AC3: the zh <h1> is byte-identical");
  assert.ok(body.includes("<h2>组件最近变更（git 可证，近 7 天）</h2>"), "AC3: the zh <h2> is byte-identical");
  assert.ok(body.includes("<th>组件</th><th>路径</th><th>近 7 天提交</th><th>末次提交</th>"),
    "AC3: the zh header row is byte-identical");
  assert.ok(body.includes("数据源：<code>packages/*</code>（git log 提交事实）· <code>git worktree list</code>（在飞开发）"),
    "AC3: the zh source note is byte-identical, including both <code> boundaries");

  // ── the ABSENT arm, so each "present" assertion above has a counterpart that can fail ─────────
  const en = await get(port, "/architecture", { Cookie: "lang=en" });
  for (const zhWord of ["系统组件图", "数据源：", "正在开发", "最近变更", "已标记问题", "组件最近变更", "末次提交", "跳到主要内容", "核心"]) {
    assert.ok(!en.body.includes(zhWord), `en render must not carry ${JSON.stringify(zhWord)}`);
  }
  for (const enWord of [
    // ⚠️ `"Source: "` — WITH the trailing space. The full-width zh `：` separates the label from the
    // `<code>` that follows on its own; the ASCII colon does not, so the en value carries the space
    // deliberately (ROW 12 ①) and this literal is pinned so a future "tidy the trailing space" edit
    // shows up here instead of silently rendering `Source:packages/*`.
    "Source: ", "(git log commit facts) · ", "(in-flight development)",
    "In development", "Recently changed", "Flagged issue", "Stable",
    "Recently changed components (git-verifiable, past 7 days)",
    "Component", "Path", "Commits in the past 7 days", "Last commit",
    "Skip to main content", "Core", "system component map",
  ]) {
    assert.ok(en.body.includes(enWord), `en render carries ${JSON.stringify(enWord)}`);
  }
  // The <title> pair: en carries the RE-KEYED English token, zh does not, and the two differ (a
  // dictionary that mapped both to the same string would satisfy "translated" while leaving the
  // criterion's third arm red).
  assert.ok(/<title>[^<]*— Architecture — system component map<\/title>/.test(en.body),
    "en <title> carries this page's re-keyed English token");
  assert.ok(!en.body.includes("系统组件图"), "en <title>/<h1> carry no Chinese subtitle");
  // ⚠️ The re-keying is load-bearing on the <title> specifically: it is the ONE site the en baseline
  // could not be moved by editing a dictionary column (ROW 3's `en` column is the identity), which is
  // why this task had to change the TOKEN. Asserted as a difference, not as two literals.
  assert.notEqual(pageNameFor("Architecture — system component map", "en"), pageNameFor("Architecture — system component map", "zh"),
    "the re-keyed <title> token really switches between the two languages");
  assert.equal(pageNameFor("Architecture — system component map", "zh"), "架构 — 系统组件图",
    "…and its zh value is the pre-existing literal, byte for byte (AC3)");
  // A negative control on the OLD token: it is no longer a key, so it falls back to itself under zh —
  // the visible-degradation contract, and the shape that makes the re-key a real move rather than a
  // second entry that happens to be unused.
  assert.equal(pageNameFor("Architecture — 系统组件图", "zh"), "Architecture — 系统组件图",
    "the OLD token is no longer registered — the page would render it verbatim under zh if a call site still passed it");
});

// ── AC5: EVERY render path carries the language ───────────────────────────────────────────────────

test("AC5: /architecture has exactly ONE render path, and it is language-aware", async () => {
  // AC5 asks for an ENUMERATION of the render entries / refresh endpoints, each asserted under
  // `?lang=zh`. This page's enumeration is the load-bearing part, because the answer is ONE:
  //   `serve-handlers.ts` dispatches `/architecture` → `handleArchitecture` → `renderArchitecturePage`
  // and the page emits NO `<script>` (no client-side refresh, no polling card) and has NO snapshot /
  // cache seam (unlike /board's `peekBoardSnapshot` or /live's SSE). So there is no second path to
  // wire, and the arm below asserts that fact by measurement rather than by "I read the file": the
  // ONLY entry point is exercised under both languages, and the source is asserted to have exactly one
  // `renderArchitecturePage(` DEFINITION and one call site.
  // ⚠️ COMMENTS ARE STRIPPED BEFORE COUNTING (硬规则 2: 按位置判定，不按关键词). This file's header
  // comment names `renderArchitecturePage` in prose, so a naive match scores 3 and the arm would be
  // measuring the documentation rather than the code — the exact false-positive shape the hard rule
  // names. Stripping first makes the count a statement about call sites.
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "serve-architecture.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const calls = [...code.matchAll(/renderArchitecturePage\(/g)].length;
  assert.equal(calls, 2, `one definition + one call site (got ${calls}) — a third would be an unwired path`);
  // Sanity control for the stripper itself: the prose occurrence IS there in the raw file, so a
  // stripper that silently matched nothing would have been caught by the count above rather than
  // quietly agreeing with it.
  assert.ok([...src.matchAll(/renderArchitecturePage\(/g)].length > calls,
    "control: the raw source mentions the call in a comment, i.e. the strip above removed something real");
  assert.ok(!/<script[\s>]/.test(code), "this page emits no client script: there is no client-side refresh string to parameterize (ROW 12 ⑦ is vacuous here)");
  assert.ok(!/readFileSync|readFile\b|\.jsonl/.test(code),
    "this page has no snapshot/cache seam of its own — the single in-request build is the whole path");

  // The one path, exercised under BOTH languages, asserted through the SAME predicate the criterion
  // uses: en has zero interface CJK, zh still renders the pre-change copy. This is what makes the
  // enumeration above a statement about the page rather than about a comment.
  const en = await get(port, "/architecture?lang=en");
  const zh = await get(port, "/architecture?lang=zh");
  assert.equal(en.status, 200, "the single path answers 200 under en");
  assert.equal(zh.status, 200, "the single path answers 200 under zh");
  assert.deepEqual(pageAuthoredCjk(en.body).residual, [], "AC5: the single render path is localized under en");
  assert.ok(zh.body.includes("系统组件图") && zh.body.includes("数据源："),
    "AC5: the single render path still renders the pre-existing zh copy under `?lang=zh` — it did not fall back to the default");
  for (const enWord of ["Source:", "Stable", "Recently changed components", "Last commit"]) {
    assert.ok(!zh.body.includes(enWord), `AC5: the zh render did not fall back to the en wording ${JSON.stringify(enWord)}`);
  }
  // ⚠️ `system component map` is deliberately NOT in the list above: it is this page's NAMED
  // out-of-scope residue — the `<head>` meta description is already English, passes through no
  // dictionary, and is pinned verbatim under BOTH languages by AC-303's test. Asserted here so the
  // omission reads as a recorded decision (`grep -c` of the residue is 1, not 0), and so a later
  // sweep that translates it reddens here rather than silently moving the zh baseline AC3 protects.
  assert.equal((zh.body.match(/system component map/g) ?? []).length, 1,
    "AC5: the ONLY 'system component map' in the zh render is the named meta-description residue (1 hit)");
  // The `?lang=` parameter reaches the path independently of the cookie — i.e. the wiring is in
  // `cfg.lang` (the dispatcher's resolution), not in a cookie read inside the renderer.
  const byCookie = await get(port, "/architecture", { Cookie: "lang=zh" });
  assert.ok(byCookie.body.includes("系统组件图"), "the Cookie channel reaches the same single path");
});
