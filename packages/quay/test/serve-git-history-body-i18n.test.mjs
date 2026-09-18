// @test-group product
// gap-webui-git-history-body-copy-en-zh — /git-history 的【正文文案】本地化（正文本地化系列第 2 页，
// 照 /dashboard 已定 pattern）。
//
// 病灶：AC-297 把【外壳】（`<html lang>` / nav / `<title>` / `<h1>` 的页名）接到了 serve-i18n.ts 的
// 字典，但页面**正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个「框是英文、内容是中文」的
// 页面。红基线实测（真实 workspace，含多于一页提交；去 <style>/<script>/标签后按行）：
//   lang=en 首屏含 CJK 文本行 12 条；续载片段 0 条（续载是纯数据 JSON）。
//   serve-git.ts 非注释中文行 27 条 —— 26 条是正文，第 27 条见下面 AC2 的 residual 断言。
//
// 本文件验证：
//   • 字典完备且被类型强制（AC4）：`GIT_HISTORY_LABELS` 是 `Record<GitHistoryKey,{en,zh}>`，每键两列
//     非空、en 列无 CJK、zh 列含 CJK 或与 en 逐字相同（后者不是放宽，是更强的谓词）。
//   • 取词函数的两条 throw 路径（未知键 / 缺参数）—— 硬规则 3b：读不懂输入时不得返回与「合格」同形
//     的值。缺参数若静默留 `{value}`，页面会把自己的模板语法渲染出来。
//   • 黑盒两态：真实 startServer（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`，断言 en 下
//     首屏界面 CJK = 0（只余切换控件的 endonym）且 zh 下中文仍在。
//   • **零计数的对照**（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中 —— 否则「en 下 0 条」可能
//     只是谓词坏了。谓词对 zh 干跑命中，正是 AC1 要求的「先对 zh 干跑」。
//   • AC5：**内联客户端脚本**里的两条加载提示与覆盖时长单位随请求语言 —— 它们在浏览器里渲染，
//     服务端拼不出它们的 HTML，字典在浏览器里也不存在（ROW 17b），故必须作为常量注入。任何只读
//     首屏 HTML 的探针都看不见这类缺口。
//   • AC5 续载：`/git-history.json` 的数据面不带任何随语言变化的文案（两语言逐字相同 —— 这是
//     「片段里没有文案」的正面证据），而它**自己写**的那一条兜底串由 `gitHistoryJson` 按语言取。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { gitHistoryJson, GIT_GRAPH_AUTO_LOAD_ROW_LIMIT } from "../src/serve-git.ts";
import {
  GIT_HISTORY_LABELS,
  GIT_HISTORY_KEYS,
  gitHistoryLabelsFor,
  gitHistoryLabel,
  gitHistoryClientLabelsFor,
  fillLabel,
} from "../src/serve-i18n.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes this whole task is defined against: Han, CJK punctuation (、。「」) and the
 *  full-width forms (：（），、). ONE regex, shared by the dictionary assertion and the black-box one,
 *  so the two cannot drift into two definitions of "Chinese".
 *
 *  Built from CODE POINTS rather than written as a literal range: the file that defines "Chinese
 *  copy" is the last place that should itself contain Chinese, and a literal range here would make
 *  every future CJK sweep of this tree flag this file. */
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

/** The page's VISIBLE text: styles/scripts dropped (an inline script embeds source COMMENTS, which are
 *  served but never rendered), tags stripped, entities decoded. This is the unit the red baseline was
 *  measured in, so the test and the measurement speak the same language. */
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

/** The language switcher's ENDONYM (`中文` / `EN`), DELIBERATELY the same in both columns
 *  (serve-i18n.ts ROW 4: a reader who cannot read the current UI language must still find their own).
 *  It is the one Chinese word an English page is SUPPOSED to carry. Removed before the "no CJK under
 *  en" assertion — and the removal is ASSERTED to have hit, so a regex that silently stopped matching
 *  cannot turn that assertion into a tautology. Both arms are matched: the CURRENT language renders as
 *  a `<span>`, the other as an `<a href="?lang=…">`. */
const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;
function stripLangSwitcher(body) {
  const hits = (body.match(LANG_SWITCHER_ITEM_RE) ?? []);
  return { stripped: hits.reduce((acc, h) => acc.split(h).join(""), body), hits };
}

/** The inlined client script(s) of the page, verbatim — the bytes the BROWSER executes. */
function inlineScripts(body) {
  return (body.match(/<script>[\s\S]*?<\/script>/g) ?? []).join("\n");
}

// ── the fixture: a real workspace with a REAL git repo holding more than one page of commits, so the
//    graph (and therefore the sentinel + the client script + the pagination endpoint) all exist. ────

let server, port, root, tasksDir, originalCwd;

const COMMIT_COUNT = 24;

before(async () => {
  tasksDir = makeTmpDir("gh-i18n-tasks-");
  root = makeTmpDir("gh-i18n-ws-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  // ASCII-titled storage, so the only possible CJK in a response is INTERFACE copy (a Chinese task
  // title would make "is this line copy or data" undecidable, which is the classification AC1 had to
  // resolve by hand). The commit SUBJECTS carry a task id so the task view has a real group.
  fs.writeFileSync(
    path.join(tasksDir, "GH-I18N-A.md"),
    `---\nid: GH-I18N-A\ntitle: alpha task\nstatus: ready\n---\n## Proposal\nascii body\n`,
  );
  // A REAL repo: the page reads it through `git log`, so a stub would not exercise the same path.
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  for (let i = 0; i < COMMIT_COUNT; i++) git("commit", "-q", "--allow-empty", "-m", `feat: GH-I18N-A commit ${i}`);
  git("branch", "develop");
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

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ────────────────────────────

test("AC4: GIT_HISTORY_KEYS and GIT_HISTORY_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...GIT_HISTORY_KEYS];
  assert.equal(new Set(roster).size, roster.length, "GIT_HISTORY_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(GIT_HISTORY_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  // The roster is the MEASURED one: the red baseline classified 26 of serve-git.ts's 27 non-comment
  // Chinese lines into this table (the 27th is the AC-297 `<title>` token — see the AC2 residual
  // assertion). A token stub would pass the two assertions above while proving nothing.
  assert.ok(roster.length >= 26, `the roster is the measured one, not a token stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is the STRONGER predicate: a zh value with no CJK is allowed ONLY when it is byte-equal
  // to its en value (a genuinely language-neutral token). An accidentally-English zh prose value
  // therefore still fails, and a plain-English placeholder cannot hide behind "it contains no symbols".
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of GIT_HISTORY_KEYS) {
    const { en, zh } = GIT_HISTORY_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: the zh column is NOT a copy of the en column (a both-columns-en regression)", () => {
  const identical = GIT_HISTORY_KEYS.filter((k) => GIT_HISTORY_LABELS[k].zh === GIT_HISTORY_LABELS[k].en);
  // A language-neutral token may legitimately be byte-equal in both columns — but a table where MOST
  // rows are would be a table that "translates" nothing. The bound is asserted, not assumed.
  assert.ok(identical.length <= 2, `at most a couple of rows are language-neutral (got ${identical.length}: ${JSON.stringify(identical)})`);
  assert.notDeepEqual(gitHistoryLabelsFor("en"), gitHistoryLabelsFor("zh"), "the two languages are not the same table");
});

test("AC4: gitHistoryLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = gitHistoryLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...GIT_HISTORY_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of GIT_HISTORY_KEYS) assert.equal(t[key], GIT_HISTORY_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => gitHistoryLabel("noSuchKey"), /unknown git-history key/);
  // Negative control for the other direction: a REAL key must NOT throw.
  assert.equal(typeof gitHistoryLabel("viewGit", "en"), "string");
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{value}` into the page", () => {
  assert.equal(fillLabel("{value} 小时", { value: 3 }), "3 小时");
  assert.throws(() => fillLabel("{value} 小时", {}), /\{value\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  assert.throws(() => gitHistoryLabel("coverageHours", "zh"), /\{value\}/);
  // A template with no placeholders is fine with an empty map — the throw is keyed on the TEMPLATE,
  // not on "the caller passed nothing".
  assert.equal(fillLabel("git topology", {}), "git topology");
});

test("AC4: every interpolated row's placeholder is present in BOTH columns (no row is dead weight)", () => {
  const templated = GIT_HISTORY_KEYS.filter((k) => /\{\w+\}/.test(GIT_HISTORY_LABELS[k].en));
  assert.ok(templated.length >= 5, `the interpolated rows exist (got ${templated.length})`);
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(GIT_HISTORY_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
  }
});

// ── AC2/AC3 black box: the two languages on a real server ─────────────────────────────────────────

test("AC2: `Cookie: lang=en` renders /git-history with ZERO interface CJK — and the same predicate DOES hit on zh (the zero-count control)", async () => {
  const en = await get(port, "/git-history", { Cookie: "lang=en" });
  assert.equal(en.status, 200);
  const { stripped, hits } = stripLangSwitcher(en.body);
  // The switcher renders FOUR items on every page: desktop + mobile chrome, each carrying the current
  // language (`<span>`) and the other one (`<a href="?lang=…">`). Asserting the count is what makes
  // the removal a fact rather than a hope.
  assert.equal(hits.length, 4, "the four language-switcher items (desktop+mobile × current+other) were located");
  assert.equal(hits.filter((h) => h.includes("中文")).length, 2, "the two 中文 endonyms (desktop + mobile) are among them");
  const residual = cjkLines(stripped);
  assert.ok(!residual.some((l) => l.includes("中文")),
    "the endonym is GONE after stripping — if it survived, the removal was a no-op and the assertion below is vacuous");
  assert.deepEqual(residual, [],
    "the en first screen carries interface copy in Chinese; the only Chinese an English page is supposed to carry is the switcher's own 中文 endonym");

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  // A predicate that never matches anything would report the same "0" for a broken page and a fixed
  // one. Run the SAME predicate against the zh render: it must find Chinese (and specifically the
  // literals this task extracted).
  const zh = await get(port, "/git-history", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200);
  const zhLines = cjkLines(stripLangSwitcher(zh.body).stripped);
  assert.ok(zhLines.length > 10, `precondition/control: the same CJK-line predicate finds the Chinese on the zh page (got ${zhLines.length})`);
  for (const zhWord of ["视图切换：", "git 拓扑", "任务分组", "纵轴 = git 发射顺序（新的在上）。", "父提交连线（圆角正交）", "加载更早提交…", "↓ 更多提交"]) {
    assert.ok(zh.body.includes(zhWord), `control: the zh first screen carries the pre-existing literal ${JSON.stringify(zhWord)}`);
  }
});

test("AC2: the en page's residual CJK is EXACTLY the one documented chrome token (enumerated, not hidden)", async () => {
  // The `?view=task` branch is the one place an en page still carries CJK. It is NOT body copy: it is
  // serve-i18n.ts ROW 3's PAGE_LABELS **key** `"Git history — 任务分组"` (AC-297 chrome), whose `en`
  // column is the IDENTITY by that row's contract — re-wording it would break the contract the AC-297
  // test pins, and it is deliberately out of this task's 正文 scope. Enumerated here so the residual
  // is a MEASURED, bounded fact (硬规则 3) rather than a silent exception: a NEW Chinese line on the
  // task view fails this assertion rather than hiding behind the exempted one.
  const enTask = await get(port, "/git-history?view=task", { Cookie: "lang=en" });
  assert.equal(enTask.status, 200);
  const residual = cjkLines(stripLangSwitcher(enTask.body).stripped);
  assert.deepEqual(residual, [`${path.basename(root)} — Git history — 任务分组`],
    "the en task view's only CJK line is the AC-297 PAGE_LABELS token, verbatim");
  // The control that keeps the exclusion from being a black hole: the SAME predicate on the SAME view
  // under zh finds the whole localized body, so this file cannot pass by the predicate going blind.
  const zhTask = await get(port, "/git-history?view=task", { Cookie: "lang=zh" });
  assert.ok(cjkLines(stripLangSwitcher(zhTask.body).stripped).length > 10, "control: the zh task view is still Chinese");
});

test("AC5 (continuation): /git-history.json carries NO language-dependent copy in its data, and its OWN fallback string follows the request", async () => {
  // Black box, both languages: the pagination endpoint returns pure commit DATA. Byte-identical
  // payloads are the positive evidence that nothing in the continuation fragment is copy — the
  // failure this arm exists for is "page 1 is right, page 2 turns English", which a single-response
  // probe cannot see.
  const en = await get(port, "/git-history.json?skip=5&limit=5", { Cookie: "lang=en" });
  const zh = await get(port, "/git-history.json?skip=5&limit=5", { Cookie: "lang=zh" });
  assert.equal(en.status, 200);
  assert.equal(zh.status, 200);
  assert.ok(JSON.parse(en.body).rows.length > 0, "precondition: the continuation actually returned rows");
  assert.equal(en.body, zh.body, "the continuation payload is language-independent (it is data, not copy)");
  assert.deepEqual(cjkLines(en.body), [], "…and it carries no CJK under en");

  // The ONE string the endpoint authors itself — `gitHistoryJson`'s fallback for a missing
  // observation reason — is read per language. Asserted as a PURE function because a real workspace
  // cannot reach it: `readGitHistory` sets a reason on every non-ok return, and an "ok" with zero
  // commits is not a shape it produces either, so the fallback is defensive. Tested here rather than
  // left unverified, so the localization cannot be silently lost.
  //
  // ⚠️ The reachable shape is `status: "ok"` with an EMPTY commit list: the early `status !== "ok"`
  // return echoes `history.reason` untouched (a non-ok reason is observation's, never this page's),
  // and only the layout-null branch below it applies the fallback.
  const okNoCommits = { status: "ok", reason: null, commits: [], head: null, heads: {}, mainlineHead: null };
  assert.equal(gitHistoryJson(okNoCommits, "git", "en").reason, "git repository has no commits");
  assert.equal(gitHistoryJson(okNoCommits, "git", "zh").reason, "git 仓库无提交记录");
  assert.equal(gitHistoryJson(okNoCommits, "task", "en").reason, "git repository has no commits");
  assert.equal(gitHistoryJson(okNoCommits, "task", "zh").reason, "git 仓库无提交记录");
  // Control: an observation-supplied reason is ECHOED, not replaced — it belongs to another module
  // (see the ROW 17 note) and must not be rewritten by this page. This is also the shape a real
  // non-git workspace produces, which is why the en page CAN carry observation's Chinese there.
  const withReason = { status: "empty", reason: "observation said so", commits: [], head: null, heads: {}, mainlineHead: null };
  assert.equal(gitHistoryJson(withReason, "git", "en").reason, "observation said so");
  assert.equal(gitHistoryJson(withReason, "git", "zh").reason, "observation said so");
});

test("AC5 (client script): the inlined script's two load hints and two span units follow the REQUEST's language", async () => {
  // These four strings are rendered by the BROWSER: the graph is drawn client-side, so the server
  // concatenates no HTML for them, and the browser has no dictionary to look them up in. They are
  // therefore injected constants (ROW 17b) — and the failure they guard against is invisible to a
  // first-response probe only in the sense that the constant is easy to forget: what it looks like
  // is an English page whose sentinel turns Chinese the moment the auto-load fuse trips.
  const enScript = inlineScripts((await get(port, "/git-history", { Cookie: "lang=en" })).body);
  const zhScript = inlineScripts((await get(port, "/git-history", { Cookie: "lang=zh" })).body);
  assert.ok(enScript.length > 0 && zhScript.length > 0, "precondition: the graph exists, so the client script was emitted");

  // ⚠️ The span units are TEMPLATES, so the needle is the whole `{value} 小时`, not the bare word —
  // the bare word is not a standalone string literal in the script.
  const zhClient = gitHistoryClientLabelsFor("zh");
  for (const zhWord of [zhClient.clickLoadOlder, zhClient.firstCommitReached, zhClient.spanHours, zhClient.spanDays]) {
    assert.ok(!enScript.includes(JSON.stringify(zhWord)), `the en page's client script does not carry the zh client literal ${JSON.stringify(zhWord)}`);
    assert.ok(zhScript.includes(JSON.stringify(zhWord)), `the zh page's client script carries ${JSON.stringify(zhWord)}`);
  }
  for (const enWord of ["Click to load older commits", "Reached the repository's oldest commit", "{value}h", "{value}d"]) {
    assert.ok(enScript.includes(JSON.stringify(enWord)), `the en page's client script carries ${JSON.stringify(enWord)}`);
    assert.ok(!zhScript.includes(JSON.stringify(enWord)), `the zh page's client script does not carry the en client literal ${JSON.stringify(enWord)}`);
  }
  // The two units are read by BOTH the server (formatCoverageSpan, into the first screen's HTML) and
  // this script (after appending a page) — assert the assembled pairs agree, in both languages, so a
  // page cannot show "3 小时" and then rewrite it to "3h" when the loader appends a page.
  for (const [lang, unit] of [["en", "h"], ["zh", "小时"]]) {
    const labels = gitHistoryClientLabelsFor(lang);
    assert.equal(labels.spanHours.replace("{value}", "3"), `3${lang === "zh" ? " " : ""}${unit}`);
  }
  // The control for the two loops above: `JSON.stringify` of a REAL word does appear in the script it
  // belongs to, so "absent" is a finding and not an artifact of a broken needle.
  assert.ok(enScript.includes(JSON.stringify(gitHistoryClientLabelsFor("en").clickLoadOlder)));

  // ── ROW 17b's other half: a caller that injects NOTHING gets NEUTRAL placeholders, never the
  // server's own default language (a script that quietly chose a language is invisible; a
  // placeholder is visible in both). ────────────────────────────────────────────────────────────
  const bare = (await import("../src/serve-git.ts")).gitGraphClientScript();
  // ⚠️ Scoped to the four INJECTED CONSTANTS, not to the whole script: the script's source comments
  // legitimately carry Chinese (this repo quotes its own 硬规则 in them), and a whole-script CJK sweep
  // would fail for a reason that has nothing to do with what is rendered.
  for (const name of ["LBL_CLICK_LOAD_OLDER", "LBL_FIRST_COMMIT_REACHED", "LBL_SPAN_HOURS", "LBL_SPAN_DAYS"]) {
    const m = new RegExp(`var ${name} = "[^"]*";`).exec(bare);
    assert.ok(m, `${name} is present in the emitted script`);
    assert.ok(!CJK.test(m[0]), `${name} carries no Chinese when no labels were injected (it picked no language): ${m[0]}`);
  }
  assert.ok(bare.includes(`var LBL_CLICK_LOAD_OLDER = ${JSON.stringify("…")};`), "the two hints degraded to an ellipsis");
  assert.ok(bare.includes(`var LBL_SPAN_HOURS = ${JSON.stringify("{value}")};`), "the two units degraded to the bare number");
  assert.ok(!bare.includes("点击加载更早提交") && !bare.includes("Click to load older commits"),
    "…and neither language's wording leaked into the label-less script");
});

// ── the auto-load fuse is still wired to the injected constants (not a stale literal) ─────────────

test("AC5: the fuse threshold and the injected constants are both present in the real client script", async () => {
  const src = (await import("../src/serve-git.ts")).gitGraphClientScript(gitHistoryClientLabelsFor("en"));
  assert.match(src, /var autoLoadBudget = \d+;/, "the auto-load budget is still interpolated as a number");
  assert.ok(src.includes(String(GIT_GRAPH_AUTO_LOAD_ROW_LIMIT)), "…and it is the exported constant the tests mock");
  assert.match(src, /sentinel\.textContent = LBL_CLICK_LOAD_OLDER;/, "the fuse writes the INJECTED constant, not a literal");
  assert.match(src, /sentinel\.textContent = LBL_FIRST_COMMIT_REACHED;/, "finishOlder writes the INJECTED constant too");
});

// ── AC3: the zh rendering is the PRE-EXTRACTION page, body copy included ──────────────────────────

test("AC3: `Cookie: lang=zh` still renders the pre-existing Chinese body copy (the extracted literals did not move)", async () => {
  const zh = (await get(port, "/git-history", { Cookie: "lang=zh" })).body;
  for (const zhWord of [
    "提交纵向时间轴",                    // <h1> subtitle (git view)
    "视图切换：",                        // view toggle prefix
    "git 拓扑", "任务分组",              // the two view links
    "（默认 git 拓扑；任务分组是项目特定启发式）", // view toggle suffix
    "纵轴 = git 发射顺序（新的在上）。",   // axis lead
    "菱形 = 合并提交。",                  // axis body
    "。在图表容器内滚动到底部自动加载更早的提交（加载较多后改为点击加载）。", // axis tail
    "父提交连线（圆角正交）",             // legend
    "加载更早提交…", "↓ 更多提交",        // sentinel + hint (server template)
    "Git 纵向时间轴（可滚动）",           // scroll container aria
    "小时",                              // coverage unit
    "Git 历史 — 提交纵向时间轴",          // the FULL rendered <h1> (page name from PAGE_LABELS + ROW 17 subtitle)
  ]) {
    assert.ok(zh.includes(zhWord), `zh render keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
  }
  const zhTask = (await get(port, "/git-history?view=task", { Cookie: "lang=zh" })).body;
  for (const zhWord of [
    "任务分组时间轴",                    // <h1> subtitle (task view)
    "任务分组 = 按 commit subject 里的 task id 聚合（项目特定启发式，非 git 语义）。",
    "任务分组（按 task id 聚合）",        // <h2>
    "未归属（无 task id）",
    "条提交",                            // group summary meta
  ]) {
    assert.ok(zhTask.includes(zhWord), `zh task view keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
  }
  // …and each of those is ABSENT under en, so every zh assertion above has a counterpart that can
  // fail (a "present" assertion with no "absent" arm passes on a page that renders both languages).
  const en = (await get(port, "/git-history", { Cookie: "lang=en" })).body;
  for (const zhWord of ["提交纵向时间轴", "视图切换：", "纵轴 = git 发射顺序（新的在上）。", "父提交连线（圆角正交）", "加载更早提交…", "↓ 更多提交", "Git 纵向时间轴"]) {
    assert.ok(!en.includes(zhWord), `en render must not carry ${JSON.stringify(zhWord)}`);
  }
  for (const enWord of ["vertical commit timeline", "View: ", "git topology", "Task grouping", "parent edge (rounded-orthogonal)", "Loading older commits…", "↓ More commits", "Git vertical timeline"]) {
    assert.ok(en.includes(enWord), `en render carries ${JSON.stringify(enWord)}`);
  }
});

// ── the neutral-placeholder contract, at the unit level ───────────────────────────────────────────

test("ROW 17b: gitHistoryClientLabelsFor is complete and language-switched", () => {
  for (const lang of ["en", "zh"]) {
    const l = gitHistoryClientLabelsFor(lang);
    for (const k of ["clickLoadOlder", "firstCommitReached", "spanHours", "spanDays"]) {
      assert.equal(typeof l[k], "string");
      assert.ok(l[k].length > 0, `${lang}.${k} is non-empty`);
    }
    assert.ok(l.spanHours.includes("{value}") && l.spanDays.includes("{value}"), `${lang}: the span units are templates`);
  }
  assert.notEqual(gitHistoryClientLabelsFor("en").clickLoadOlder, gitHistoryClientLabelsFor("zh").clickLoadOlder);
  assert.ok(!CJK.test(gitHistoryClientLabelsFor("en").firstCommitReached), "the en hint carries no CJK");
});

// ── the fixture's own sanity: the repo really is a repo and really paginates ─────────────────────

test("fixture sanity: the workspace is a real git repo with a graph, and the continuation is a real second page", async () => {
  const page = (await get(port, "/git-history", { Cookie: "lang=en" })).body;
  assert.ok(page.includes('id="git-graph-data"'), "the fixture produced a real graph payload");
  assert.ok(page.includes('id="git-graph-sentinel"'), "…and the sentinel the loader hangs off");
  const json = JSON.parse((await get(port, "/git-history.json?skip=10&limit=3")).body);
  assert.equal(json.status, "ok");
  assert.equal(json.rows.length, 3, "the continuation honoured skip/limit — it is a real second page");
});
