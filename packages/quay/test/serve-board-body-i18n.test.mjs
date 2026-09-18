// @test-group product
// gap-webui-board-body-copy-en-zh — /board 的【正文文案】本地化（正文本地化系列第 2 页；第 1 页
// gap-webui-dashboard-body-copy-en-zh 定了 pattern，本页照抄其决定记录 ①~⑨）。
//
// 病灶：AC-289~303 把【外壳】（nav / `<title>` / `<h1>` / 切换控件）接到了 serve-i18n.ts 的字典，
// 但页面**正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个「框是英文、内容是中文」的页面。
// 实测（红基线，真实 workspace，响应体去标签后按行数）：`lang=en` 下含 CJK 的文本行 13 条
// （另 2 条是切换控件的 endonym），逐条清单见任务体 AC1 证据。
//
// 本文件验证：
//   • AC4 —— 字典完备且被类型强制：`BOARD_LABELS` 是 `Record<BoardKey,{en,zh}>`，每键两列非空、
//     en 列无 CJK、zh 列含 CJK 或与 en 逐字相同（见 `zhArmOk` 的注释：后者不是放宽，是更强的谓词）。
//   • AC4 —— 取词函数的两条 throw 路径（未知键 / 缺参数）。这是硬规则 3b 的那半边：读不懂输入时
//     不得返回与「合格」同形的值。缺参数若静默留 `{n}`，页面会把自己的模板语法渲染出来，而没有一条
//     「页面上有没有该有的值」的检查会变红。
//   • AC2 —— 黑盒：真实 `startServer({port:0})`（⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`，
//     断言 en 下**界面** CJK = 0，**默认视图与 ?all=1 展开视图各一次**。
//   • AC2 的零计数对照（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中 —— 否则「en 下 0 条」
//     可能只是谓词坏了。
//   • AC3 —— zh 输出零变化：逐条断言改前的中文字面量仍在，且 en 下同一批词**缺席**（一个只有
//     「在场」没有「缺席」臂的断言，在同时渲染两种语言的页面上也会通过）。
//   • AC5 —— 所有渲染路径都带语言：快照路径（生产默认）与旧路径（`QUAY_BOARD_SNAPSHOT_DISABLED=1`）
//     各触发一次，`?lang=zh` 下逐个断言仍 zh、en 下逐个断言无界面 CJK。
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
  BOARD_LABELS,
  BOARD_KEYS,
  boardLabelsFor,
  boardLabel,
  fillLabel,
} from "../src/serve-i18n.ts";
import { peekBoardSnapshot, BOARD_SNAPSHOT_DISABLED_ENV } from "../src/serve-board.ts";
import { readBoardExecution, readBoardLanding, clearLandingCache } from "../src/observation.ts";
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

/** Chinese lines this PAGE authored — i.e. excluding (a) the switcher's endonym and (b) any line a
 *  NON-board module produced and this page merely echoes.
 *
 *  (b) is the classification AC1/AC2 demand of every residual line, made mechanical: the source-
 *  summary notes append their reader's `reason` VERBATIM, and those strings are DIAGNOSTICS about the
 *  store produced by `observation.ts` — a module this task does not own (and whose readers /dashboard
 *  and /tests share). They are read here from the SAME readers the page read, and lines they account
 *  for are excluded. ⛔ This is NOT a blanket exemption: any label this page renders itself is absent
 *  from those strings and still fails. The count of what was excluded is asserted alongside (and
 *  asserted to be non-zero), so the exclusion cannot silently grow to swallow the whole page.
 *
 *  The `— ` arm is the separator the note template puts between the state word and the reason. */
function pageAuthoredCjk(body, readerReasons) {
  const reasons = readerReasons.map((r) => String(r ?? "").trim()).filter((r) => r.length > 0);
  const isChromeOrReaderText = (line) =>
    line === "中文" || reasons.some((r) => line === r || line === `— ${r}` || line.endsWith(r));
  const all = cjkLines(stripLangSwitcher(body).stripped);
  return {
    residual: all.filter((l) => !isChromeOrReaderText(l)),
    excluded: all.filter(isChromeOrReaderText),
  };
}

// ── the fixture: a real workspace with a REAL task store, ASCII-titled so the only possible CJK in
//    the response is interface copy (a Chinese task title would make the assertion unfalsifiable —
//    data and copy would be indistinguishable, which is exactly the confusion AC1's classification
//    had to resolve by hand). git-inited (not merely mkdtemp'd) because the landing reader shells out
//    to the drift checker, which resolves the repo root from cwd. ──────────────────────────────────

let server, port, root, originalCwd, tasksDir;

before(async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "board-i18n-"));
  root = path.join(parent, "main");
  tasksDir = path.join(root, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  fs.writeFileSync(
    path.join(tasksDir, "BRD-A.md"),
    `---\nid: BRD-A\ntitle: alpha task\nstatus: ready\n---\n## Proposal\nascii body\n`,
  );
  fs.writeFileSync(
    path.join(tasksDir, "BRD-B.md"),
    `---\nid: BRD-B\ntitle: beta task\nstatus: todo\n---\n## Proposal\nascii body\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, "README.md"), "board i18n fixture workspace\n");
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.email=test@test", "-c", "user.name=test", "commit", "-q", "-m", "board i18n fixture"], { cwd: root });

  originalCwd = process.cwd();
  process.chdir(root);
  clearLandingCache();
  server = await startServer({ port: 0, host: "127.0.0.1" });
  port = server.address().port;
});

after(async () => {
  server?.boardSnapshot?.stop();
  await new Promise((r) => server.close(r));
  if (server?.client) await server.client.close();
  process.chdir(originalCwd);
  if (root) fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

/** The reader diagnostics this page echoes verbatim, read from the same readers the page read, so
 *  the provenance classification above is MECHANICAL rather than a hand-maintained allowlist. */
async function readerReasons() {
  const exec = await readBoardExecution(root);
  const landing = await readBoardLanding(root);
  return [exec.reason, landing.reason];
}

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ────────────────────────────

test("AC4: BOARD_KEYS and BOARD_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...BOARD_KEYS];
  assert.equal(new Set(roster).size, roster.length, "BOARD_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(BOARD_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  assert.ok(roster.length >= 30, `the roster is the measured one, not a token stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is the STRONGER predicate (the pattern task's decision record ⑨): a zh value with no
  // CJK is allowed ONLY when it is byte-equal to its en value (a genuinely language-neutral token
  // such as the `id` column header). An accidentally-English zh prose value still fails, so a
  // plain-English placeholder cannot hide behind "it contains no CJK".
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of BOARD_KEYS) {
    const { en, zh } = BOARD_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: boardLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = boardLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...BOARD_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of BOARD_KEYS) assert.equal(t[key], BOARD_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  // ⚠️ Not every key differs — the language-neutral rows (e.g. `colIntent`? no: that one translates;
  // the genuinely neutral ones are rows whose value is the same word in both, per `zhArmOk`) are
  // byte-equal by design. So the arm below asserts the TABLES are not identical, which is the
  // regression it can actually catch: a change that mapped every key to its en value would make the
  // two tables equal while the per-key loop above stayed green.
  const en = boardLabelsFor("en"), zh = boardLabelsFor("zh");
  assert.notDeepEqual(en, zh, "the two languages are not the same table (a both-columns-en regression)");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => boardLabel("noSuchKey"), /unknown board key/);
  assert.throws(() => boardLabel("noSuchKey", "zh"), /unknown board key/);
  // Negative control for the other direction: a REAL key must NOT throw.
  assert.equal(typeof boardLabel("colIntent", "en"), "string");
  assert.equal(boardLabel("colIntent", "zh"), "意图");
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{n}` into the page", () => {
  assert.equal(fillLabel("scanned {n} tasks", { n: 7 }), "scanned 7 tasks");
  assert.throws(() => fillLabel("scanned {n} tasks", {}), /\{n\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  // …and the same throw through the page's own accessor, with a parameter the two-count row needs.
  assert.throws(() => boardLabel("inFlightBreakdown", "en", { implementing: 1 }), /awaiting/);
  assert.equal(boardLabel("inFlightBreakdown", "zh", { implementing: 1, awaiting: 2 }), "1 实现中 · 2 待落地");
  // A template with no placeholders is fine with an empty map — the throw is keyed on the TEMPLATE,
  // not on "the caller passed nothing".
  assert.equal(fillLabel("No data", {}), "No data");
});

test("AC4: every interpolated row carries its placeholder in BOTH columns (a translation cannot drop it)", () => {
  const templated = BOARD_KEYS.filter((k) => /\{\w+\}/.test(BOARD_LABELS[k].en));
  assert.ok(templated.length >= 8, `the interpolated rows exist (got ${templated.length})`);
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(BOARD_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
  }
});

// ── AC2/AC3 black box: the two languages on a real server ────────────────────────────────────────

test("AC2: `Cookie: lang=en` renders the DEFAULT view with ZERO interface CJK — and the same predicate DOES hit on zh (the zero-count control)", async () => {
  const reasons = await readerReasons();
  const en = await get(port, "/board", { Cookie: "lang=en" });
  assert.equal(en.status, 200);
  const { stripped, hits } = stripLangSwitcher(en.body);
  // The switcher renders FOUR items on every page: desktop + mobile chrome, each carrying the
  // current language (`<span>`) and the other one (`<a href="?lang=…">`). Asserting the count makes
  // the removal a fact rather than a hope — a regex that matched only one arm would leave 中文 items
  // in place and the comparison below would be comparing against a page that still carried them.
  assert.equal(hits.length, 4, "the four language-switcher items (desktop+mobile × current+other) were located");
  assert.equal(hits.filter((h) => h.includes("中文")).length, 2, "the two 中文 endonyms (desktop + mobile) are among them");
  assert.ok(!cjkLines(stripped).some((l) => l === "中文"),
    "the endonym is GONE after stripping — if it survived, the removal was a no-op and the assertion below is vacuous");

  const { residual, excluded } = pageAuthoredCjk(en.body, reasons);
  assert.ok(excluded.length >= 1,
    `the provenance exclusion actually matched something (else it is a black hole): ${JSON.stringify(excluded)}`);
  assert.deepEqual(residual, [],
    "the en page carries interface copy in Chinese; the only Chinese an English page is supposed to carry is the switcher's own 中文 endonym and the readers' own diagnostic strings");

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  // A predicate that never matches anything would report the same "0" for a broken page and a fixed
  // one. Run the SAME predicate against the zh render: it must find Chinese.
  const zh = await get(port, "/board", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200);
  assert.ok(cjkLines(stripLangSwitcher(zh.body).stripped).length > 20,
    "precondition/control: the same CJK-line predicate finds the Chinese on the zh page");
});

test("AC2: the EXPANDED view (?all=1) is localized too — the second view the criterion names", async () => {
  const reasons = await readerReasons();
  const en = await get(port, "/board?all=1", { Cookie: "lang=en" });
  assert.equal(en.status, 200, "AC2: ?all=1 returns 200");
  const { residual } = pageAuthoredCjk(en.body, reasons);
  assert.deepEqual(residual, [], "the expanded view carries no interface copy in Chinese");
  // An extra arm that only exists on this view, so the two views cannot pass on the same evidence.
  assert.ok(en.body.includes("Showing all"), "the expanded view renders its OWN note in English");
  assert.ok(!en.body.includes("已显示全部"), "…and not the zh wording");

  const zh = await get(port, "/board?all=1", { Cookie: "lang=zh" });
  assert.ok(zh.body.includes("已显示全部"), "control: the zh expanded view keeps its pre-existing wording");
});

// ── AC3: the zh output did not move ──────────────────────────────────────────────────────────────

test("AC3: `Cookie: lang=zh` still renders the pre-existing Chinese body copy, and en carries none of it", async () => {
  const zh = await get(port, "/board", { Cookie: "lang=zh" });
  const body = zh.body;
  for (const zhWord of [
    "意图 / 执行 / 落地",     // <h1> subtitle (the page name is asserted below)
    "意图: 任务库 (Provider ABI)", // intent source note
    "执行:",                  // exec source label
    "无数据",                 // exec source state
    "落地:",                  // landing source label
    "扫描",                   // the landing scan-count template
    "意图", "执行", "落地",    // table headers
    "默认过滤未生效",          // off-source-incomplete title
    "跳到主要内容",            // shared skip link (ROW 9)
    "核心",                   // shared mobile-menu group heading (ROW 9)
    "中文",                   // the switcher's endonym (ROW 4 — deliberately unchanged)
  ]) {
    assert.ok(body.includes(zhWord), `zh render keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
  }
  // The page's own <title> token: zh is the pre-existing bytes, byte for byte.
  assert.ok(body.includes("— 看板 — 三源 join 看板</title>"),
    "AC3: the zh <title> is byte-identical to the pre-change token");
  assert.ok(body.includes("<h1>看板 — 意图 / 执行 / 落地</h1>"), "AC3: the zh <h1> is byte-identical");

  // ── the ABSENT arm, so each "present" assertion above has a counterpart that can fail ─────────
  const en = await get(port, "/board", { Cookie: "lang=en" });
  for (const zhWord of ["意图: 任务库", "无数据", "默认过滤未生效", "扫描", "跳到主要内容", "核心"]) {
    assert.ok(!en.body.includes(zhWord), `en render must not carry ${JSON.stringify(zhWord)}`);
  }
  for (const enWord of ["Intent: task store (Provider ABI)", "No data", "Default filter not applied", "scanned", "Skip to main content", "Core", "intent / execution / landing"]) {
    assert.ok(en.body.includes(enWord), `en render carries ${JSON.stringify(enWord)}`);
  }
  // The <title> pair, the same two arms AC-292's live criterion reads off this page: en carries the
  // English token, zh does not, and the two differ (a dictionary that mapped both to the same string
  // would satisfy "translated" while leaving the criterion's third arm red).
  assert.ok(en.body.includes("— Board — three-source join</title>"), "en <title> carries this page's English token");
  assert.ok(!en.body.includes("三源 join 看板"), "en <title> carries no Chinese subtitle");
});

// ── AC5: BOTH render paths (snapshot hit / snapshot miss) carry the language ─────────────────────

test("AC5: the SNAPSHOT path (production default) renders both languages correctly", async () => {
  // The startup build must have landed — a timeout here would make the assertions below test the
  // LEGACY path a second time while claiming to test the snapshot path.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && peekBoardSnapshot(root) == null) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(peekBoardSnapshot(root) != null, "precondition: a snapshot exists (otherwise this duplicates the legacy test)");
  const reasons = await readerReasons();
  const en = await get(port, "/board", { Cookie: "lang=en" });
  assert.equal(en.status, 200);
  const { hits } = stripLangSwitcher(en.body);
  assert.equal(hits.length, 4, "the four switcher items were located (see the AC2 test for why the count is asserted)");
  assert.deepEqual(pageAuthoredCjk(en.body, reasons).residual, [], "the snapshot render path is localized too");
  const zh = await get(port, "/board", { Cookie: "lang=zh" });
  assert.ok(zh.body.includes("默认过滤未生效") || zh.body.includes("默认视图") || zh.body.includes("已显示全部"),
    "AC5: the snapshot path is still zh under ?lang=zh/zh cookie (the language did not fall back to the default)");
});

test("AC5: the LEGACY path (snapshot absent — QUAY_BOARD_SNAPSHOT_DISABLED=1) carries the language too", async () => {
  const prev = process.env[BOARD_SNAPSHOT_DISABLED_ENV];
  process.env[BOARD_SNAPSHOT_DISABLED_ENV] = "1";
  try {
    assert.equal(peekBoardSnapshot(root), null, "precondition: the switch really made the snapshot lookup miss");
    const reasons = await readerReasons();
    const en = await get(port, "/board", { Cookie: "lang=en" });
    assert.equal(en.status, 200, "the legacy in-request build still answers 200");
    const { hits } = stripLangSwitcher(en.body);
    assert.equal(hits.length, 4, "the four switcher items were located (see the AC2 test for why the count is asserted)");
    assert.deepEqual(pageAuthoredCjk(en.body, reasons).residual, [], "the legacy render path is localized too");

    const zh = await get(port, "/board", { Cookie: "lang=zh" });
    assert.equal(zh.status, 200);
    assert.ok(zh.body.includes("默认过滤未生效") || zh.body.includes("默认视图") || zh.body.includes("已显示全部"),
      "AC5: the legacy path still renders zh under the zh cookie (the in-request build reads cfg.lang too)");
    assert.ok(!zh.body.includes("Default filter not applied"), "AC5: the legacy path did not fall back to en copy");
  } finally {
    if (prev === undefined) delete process.env[BOARD_SNAPSHOT_DISABLED_ENV];
    else process.env[BOARD_SNAPSHOT_DISABLED_ENV] = prev;
  }
});
