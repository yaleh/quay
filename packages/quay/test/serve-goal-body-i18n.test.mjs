// @test-group product
// gap-webui-goal-body-copy-en-zh — /goal（列表 + /goal/<id> 详情）的【正文文案】本地化
// （正文本地化系列，照 gap-webui-dashboard-body-copy-en-zh 定下的 pattern，ROW 21）。
//
// 病灶：AC-301 把 /goal **列表**的【外壳】（`<html lang>`、nav 当前项、`<title>`、`<h1>` 的页名段、
// 移动菜单标签）接到了字典，但页面**正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个
// 「框是英文、内容是中文」的页面。本任务把列表与详情两条渲染路径的正文全走 ROW 21 的 `GOAL_LABELS`。
//
// 本文件把任务体的 AC1 里那条**分类**（界面文案 vs 数据）做成机械判据，而不是留在散文里：
//   • 两 fixture 差分：fixture C 的**记录数据全为 ASCII** ⇒ en 下残留的 CJK 行**按构造**只可能是
//     界面文案（数据里没有中文可漏）；fixture D 的记录标题是中文 ⇒ 数据行在 C 里消失、在 D 里回来。
//     C 是下界、D 是上界，本文件两个方向都断言。
//   • 字典完备且被类型强制：`GOAL_LABELS` 是 `Record<GoalKey,{en,zh}>`；每键两列非空、en 列无 CJK、
//     zh 列【含 CJK 或与 en 逐字相同】（后者不是放宽：一个纯 ASCII 的 zh 值只允许在它与 en
//     **逐字相等**时存在，因此「误写成英文的 zh 文案」仍然会红）。
//   • 取词函数的两条 throw 路径（未知键 / 缺参数）—— 硬规则 3b 的那半边。
//   • 黑盒：真实 `startServer`（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`，列表与详情各一。
//   • **零计数的对照**（硬规则 2）：同一个 CJK 谓词对 zh 响应干跑必须命中大数——否则「en 下 0 条」
//     可能只是谓词坏了。
//   • 数据判据：一条**中文记录标题**在两种语言下逐字出现（它是 store 的记录，⛔ 不翻译）。
//   • 共享 `renderBackLink` 的三个调用点各自声明语言：本页 en 下是英文回链、zh 下是原有中文回链；
//     另两个详情页（/adr、/doc）**也**必须各自声明，否则它们的 `?lang=zh` 会渲染英文回链
//     （硬规则 3b：静默默认与「接好了」同形）。
//
// Run (scoped): node --test packages/quay/test/serve-goal-body-i18n.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { GOAL_LABELS, GOAL_KEYS, goalLabelsFor, goalLabel, fillLabel, CHROME_LABELS, chromeLabel } from "../src/serve-i18n.ts";
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
const ENDONYM = cp(0x4e2d) + cp(0x6587); // 中文 — the switcher endonym, identical in both columns (ROW 4)

function get(port, urlPath, cookie) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers: cookie ? { Cookie: cookie } : {} }, (res) => {
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

/** Every visible line carrying a CJK character, WITH the language-switcher endonym removed. The
 *  endonym is the one Chinese word an English page is SUPPOSED to carry (ROW 4), and the count of
 *  removals is asserted by the caller — a regex that silently stopped matching would otherwise turn
 *  "no Chinese left" into a tautology. */
function cjkLines(body) {
  const without = body.replace(LANG_SWITCHER_ITEM_RE, "");
  assert.notEqual(without, body, "the language switcher was located — otherwise the endonym was never subtracted");
  return visibleText(without)
    .split("\n").map((s) => s.trim())
    .filter((s) => s.length > 0 && CJK.test(s))
    .map((s) => s.split(ENDONYM).join("").trim())
    .filter((s) => s.length > 0 && CJK.test(s));
}
const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────
//
// TWO workspaces, and the difference between them is the whole point (AC1's 界面文案/数据 split):
//   • wsAscii — every record's DATA is ASCII, so any CJK left under `en` is page copy by construction.
//   • wsCjk   — the same records with Chinese TITLES, so the lines that come back are the data.
// ONE FETCH CANNOT SEE BOTH, and neither can a single fixture: with Chinese data a leaked copy line
// is indistinguishable from a title, and with ASCII data a broken data path is indistinguishable
// from a clean page. The pair is what makes each arm's zero/non-zero mean something.

const ASCII = { g: "three-layer collapse", ac: "experience flow", tk: "task name" };
const CJK_T = { g: cp(0x4e09) + cp(0x5c42) + cp(0x5854) + cp(0x7f29), ac: cp(0x4f53) + cp(0x9a8c) + cp(0x6d41), tk: cp(0x4efb) + cp(0x52a1) + cp(0x540d) };

function makeWorkspace(prefix, T) {
  const ws = makeTmpDir(`${prefix}ws-`);
  const tasksDir = makeTmpDir(`${prefix}tasks-`);
  // Inside the workspace (not a tmp dir) so the back-link arm can drop an ADR fixture into the very
  // directory the provider is configured to read.
  const adrDir = path.join(ws, "adr");
  const goalsDir = path.join(ws, "goals");
  fs.mkdirSync(goalsDir, { recursive: true });
  fs.mkdirSync(adrDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_ADR_DIR: "${adrDir.replaceAll("\\", "\\\\")}"\n      QUAY_NATIVE_GOAL_DIR: "${goalsDir.replaceAll("\\", "\\\\")}"\n`,
  );
  fs.writeFileSync(path.join(goalsDir, "GOAL-001-g.md"),
    `---\nid: GOAL-001\ntitle: ${T.g}\nstatus: active\nkind: goal\norigin: fixture\n---\n## Goal\none target\n`);
  // A draft AC + a draft GOAL so BOTH draft-banner arms render (the banner is conditional, and a
  // fixture without drafts would leave every banner row unasserted — 硬规则 4 推论三).
  fs.writeFileSync(path.join(goalsDir, "AC-028-a.md"),
    `---\nid: AC-028\ntitle: ${T.ac}\nstatus: active\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 0\nexpect: "=0"\norigin: fixture\n---\n## Rationale\nx\n`);
  fs.writeFileSync(path.join(goalsDir, "AC-900-draft.md"),
    `---\nid: AC-900\ntitle: ${T.ac} 2\nstatus: draft\nkind: criterion\ngoal: GOAL-001\ncriterion: exit 1\nexpect: "=0"\norigin: fixture\n---\n## Rationale\ny\n`);
  fs.writeFileSync(path.join(goalsDir, "GOAL-950-draft.md"),
    `---\nid: GOAL-950\ntitle: ${T.g} 2\nstatus: draft\nkind: goal\norigin: fixture\n---\n## Goal\nz\n`);
  // A task hung on AC-028 so the 挂靠任务 cell renders the COUNT state (not 未挂靠) — the third
  // state, 未读到, needs a failing taskList and gets its own arm below.
  fs.writeFileSync(path.join(tasksDir, "T-1.md"),
    `---\nid: T-1\ntitle: ${T.tk}\nstatus: ready\nrole: primitive\ngoal_ac: AC-028\n---\n## Proposal\nx\n`);
  // One ledger event so the evidence cell renders a real verdict (otherwise the 最近 verdict line is
  // omitted entirely and its row would go unexercised on the detail page).
  fs.writeFileSync(path.join(ws, ".quay", "gate-events.jsonl"),
    JSON.stringify({ id: "e1", item_id: "AC-028", pipeline_id: "AC-028", gate: "goal", verdict: "pass", actor: "x", timestamp: "2026-09-06T12:00:00Z", payload: {} }) + "\n");
  return ws;
}

let wsAscii, wsCjk, port, portCjk, server, serverCjk, originalCwd;

/** Render against an arbitrary workspace with a SECOND real server on it. ⛔ port 0 (never
 *  probe-then-bind — the TOCTOU recorded in packages/quay/test/serve-board.test.mjs). */
async function renderIn(ws, urlPath, cookie) {
  const cwd0 = process.cwd();
  process.chdir(ws);
  const s = await startServer({ port: 0, host: "127.0.0.1" });
  try {
    return await get(s.address().port, urlPath, cookie);
  } finally {
    await new Promise((r) => s.close(r));
    if (s.client) await s.client.close();
    process.chdir(cwd0);
  }
}

before(async () => {
  originalCwd = process.cwd();
  wsAscii = makeWorkspace("goal-i18n-ascii-", ASCII);
  wsCjk = makeWorkspace("goal-i18n-cjk-", CJK_T);
  process.chdir(wsAscii);
  server = await startServer({ port: 0, host: "127.0.0.1" });
  port = server.address().port;
  process.chdir(wsCjk);
  serverCjk = await startServer({ port: 0, host: "127.0.0.1" });
  portCjk = serverCjk.address().port;
  process.chdir(originalCwd);
});

after(async () => {
  for (const s of [server, serverCjk]) {
    await new Promise((r) => s.close(r));
    if (s.client) await s.client.close();
  }
  process.chdir(originalCwd);
});

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ───────────────────────────

test("AC4: GOAL_KEYS and GOAL_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...GOAL_KEYS];
  assert.equal(new Set(roster).size, roster.length, "GOAL_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(GOAL_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  // The roster is the MEASURED one: the two-fixture differential produced 23 rendered strings (the
  // list page's copy, the detail page's, the empty state's and the failure banner's). A token stub
  // would satisfy every arm above while leaving the page Chinese.
  assert.ok(roster.length >= 23, `the roster is the measured one, not a token stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is NOT "zh 含 CJK 或纯符号" verbatim — it is the STRONGER predicate the roster actually
  // needs: a zh value with no CJK is allowed ONLY when it is byte-equal to its en value (a genuinely
  // language-neutral token such as `AC / criterion`, which IS the pre-existing zh literal here). An
  // accidentally-English zh prose value therefore still fails.
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of GOAL_KEYS) {
    const { en, zh } = GOAL_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: goalLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const L = goalLabelsFor(lang);
    assert.deepEqual(Object.keys(L).slice().sort(), [...GOAL_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of GOAL_KEYS) assert.equal(L[key], GOAL_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  // ⛔ Not `notDeepEqual`: two rows are language-neutral BY DESIGN (`pageSubtitleCriteria`,
  // `AC / criterion`), so the tables are NOT disjoint. Asserting the weaker (and true) property —
  // that at least one row differs — is what makes this arm a regression guard for "the whole table
  // was authored in one language" without making the by-design neutral rows a false red.
  assert.ok(GOAL_KEYS.some((k) => goalLabelsFor("en")[k] !== goalLabelsFor("zh")[k]),
    "the two languages are not the same table (a both-columns-zh or both-columns-en regression)");
  assert.equal(GOAL_KEYS.filter((k) => goalLabelsFor("en")[k] === goalLabelsFor("zh")[k]).length, 1,
    "exactly ONE row is language-neutral (pageSubtitleCriteria) — a second one is a translation that was never done");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => goalLabel("noSuchKey"), /unknown goal key/);
  assert.equal(typeof goalLabel("pageSubtitleGoal", "en"), "string");
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{n}` into the page", () => {
  assert.equal(fillLabel("{n} {kind} awaiting a decision", { n: 3, kind: "GOAL" }), "3 GOAL awaiting a decision");
  assert.throws(() => fillLabel("{n} {kind} awaiting a decision", { n: 3 }), /\{kind\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  assert.throws(() => goalLabel("draftOwnBanner", "en", { n: 1 }), /kind/);
  assert.throws(() => goalLabel("attachCount", "zh", {}), /n/);
  assert.equal(fillLabel("not attached", {}), "not attached", "a template with no placeholders is fine with an empty map");
});

test("AC4: every interpolated row carries the placeholder in BOTH columns (a template is not translatable one-sided)", () => {
  const templated = GOAL_KEYS.filter((k) => /\{\w+\}/.test(GOAL_LABELS[k].en));
  assert.ok(templated.length >= 6, `the interpolated rows exist (got ${templated.length})`);
  const names = (s) => (s.match(/\{(\w+)\}/g) ?? []).slice().sort();
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(GOAL_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
    // …and the placeholder NAMES match: a zh column that renamed `{n}` to `{条}` would make `fillLabel`
    // throw at render time for every zh reader (the template parses `\w+`, so a non-ASCII name
    // silently stops being a placeholder and renders literally).
    assert.deepEqual(names(GOAL_LABELS[key].zh), names(GOAL_LABELS[key].en), `${key}: both columns use the same placeholder names`);
  }
});

test("AC5: the shared back link is a CHROME row with both columns, and it is wired (not a literal)", () => {
  // `renderBackLink` is shared by the three entity detail pages (/goal, /adr, /doc) — so its label
  // belongs to ROW 9's CHROME table, not to /goal's. Asserted here because /goal's AC2 zero depends
  // on it: an unwired back link is the one Chinese string left on an otherwise-English detail page.
  assert.equal(chromeLabel("backLink", "en"), CHROME_LABELS.backLink.en);
  assert.equal(chromeLabel("backLink", "zh"), CHROME_LABELS.backLink.zh);
  assert.equal(CHROME_LABELS.backLink.zh, cp(0x2190) + " " + cp(0x8fd4) + cp(0x56de) + cp(0x5217) + cp(0x8868),
    "the zh column is the pre-existing literal, byte for byte");
  assert.ok(!CJK.test(CHROME_LABELS.backLink.en), "the en column carries no CJK");
  // The arrow is NOT CJK (U+2190 is in General Punctuation, outside every class `CJK` covers), which
  // is why the en column may legitimately keep it — asserted rather than assumed, because the en
  // "no CJK" rule above would otherwise be untestable on the only row that starts with a symbol.
  assert.ok(!CJK.test(cp(0x2190)), "the arrow itself is not in any CJK class this file tests");
});

// ── AC2/AC3 black box: the two languages on a real server ────────────────────────────────────────

test("AC2: the ASCII-data fixture renders /goal with ZERO page-authored CJK, and the same predicate DOES hit on zh (the zero-count control)", async () => {
  const en = await get(port, "/goal", "lang=en");
  assert.equal(en.status, 200, "GET /goal (en) returns 200");
  // The fixture's data is ASCII, so this is the STRONG form: nothing is excluded but the switcher
  // endonym, and every remaining Chinese line would be a defect.
  assert.deepEqual(cjkLines(en.body), [],
    "the en /goal list carries interface copy in Chinese (the fixture has no Chinese data to blame)");

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  const zh = await get(port, "/goal", "lang=zh");
  assert.ok(cjkLines(zh.body).length > 10, "precondition/control: the same CJK-line predicate finds the Chinese on the zh page");
});

test("AC2: the ASCII-data fixture renders /goal/<id> (both a GOAL and an AC) with zero page-authored CJK", async () => {
  for (const [id, why] of [["GOAL-001", "the goal branch (criteria block, time info, verdict)"], ["AC-028", "the criterion branch (no criteria block)"], ["GOAL-950", "a DRAFT goal"]]) {
    const en = await get(port, `/goal/${id}`, "lang=en");
    assert.equal(en.status, 200, `GET /goal/${id} (en) returns 200`);
    assert.deepEqual(cjkLines(en.body), [], `the en /goal/${id} detail page (${why}) carries interface copy in Chinese`);
    const zh = await get(port, `/goal/${id}`, "lang=zh");
    assert.ok(cjkLines(zh.body).length > 3, `control: the same predicate finds the Chinese on the zh /goal/${id} page`);
  }
  // The 404 branch is a plain-text body and carries no copy at all — pinned so a future "localize the
  // 404" change has to come here deliberately rather than by accident.
  const nf = await get(port, "/goal/AC-999", "lang=en");
  assert.equal(nf.status, 404, "an unknown id is still a 404");
});

test("AC2: the EMPTY and FILTERED-EMPTY states are localized too (they render copy the populated branch never emits)", async () => {
  // `?status=retired` filters every fixture row away → the `emptyFiltered` branch. The bare `goals/`
  // directory is never empty in this fixture (the page would need a workspace with no records), so
  // that variant is asserted through its dictionary row + the reason it is unreachable, below.
  const en = await get(port, "/goal?status=retired", "lang=en");
  assert.equal(en.status, 200);
  assert.deepEqual(cjkLines(en.body), [], "the en filtered-empty state carries no Chinese");
  const text = visibleText(en.body);
  assert.ok(text.includes("No records under the current filter"), "the en empty state names the FILTER (not the directory)");
  assert.ok(text.includes("goals/"), "…and still points at goals/ as the source of truth");

  const zh = await get(port, "/goal?status=retired", "lang=zh");
  assert.ok(visibleText(zh.body).includes(cp(0x5f53) + cp(0x524d) + cp(0x7b5b) + cp(0x9009) + cp(0x4e0b) + cp(0x65e0) + cp(0x8bb0) + cp(0x5f55)),
    "the zh empty state keeps its pre-existing literal");
  assert.ok(cjkLines(zh.body).length > 3, "control: the predicate hits the zh empty state");
});

test("AC2: the LIST read-failure banner is localized (both languages), on a client whose goalList throws", async () => {
  // ⚠️ This state is UNREACHABLE from a fixture: a missing goal DIRECTORY reads as empty (the provider
  // returns [] rather than throwing — verified), so a directory-based probe never renders the banner
  // and its row would go unexercised (硬规则 4: a criterion whose state cannot be built is not a
  // measurement). It is built here the only way it can be: a client that throws.
  const { handleGoalList } = await import("../src/serve-goal.ts");
  const capture = () => ({ statusCode: 0, headers: {}, body: "", writeHead(c, h) { this.statusCode = c; this.headers = h; }, end(b) { this.body = b || ""; } });
  const client = { goalList: async () => { throw new Error("boom-read"); }, taskList: async () => ({ tasks: [], malformed: [] }) };
  const en = capture();
  await handleGoalList({}, en, new URL("http://localhost/goal"), client, { workspaceRoot: wsAscii, lang: "en" });
  assert.equal(en.statusCode, 200, "fail-open: a read failure is still a 200 page");
  assert.match(en.body, /Read failed:/, "the en banner carries the translated label");
  assert.match(en.body, /boom-read/, "…and the reader's own diagnostic (DATA) rides along verbatim");
  assert.doesNotMatch(en.body, new RegExp(cp(0x8bfb) + cp(0x5931) + cp(0x8d25)), "the en banner carries no Chinese");
  const zh = capture();
  await handleGoalList({}, zh, new URL("http://localhost/goal"), client, { workspaceRoot: wsAscii, lang: "zh" });
  assert.match(zh.body, new RegExp(cp(0x8bfb) + cp(0x5931) + cp(0x8d25) + ":"), "the zh banner keeps the pre-existing literal, colon included");
});

test("AC3: the CJK-data fixture proves the DATA is untouched — a Chinese record title renders VERBATIM in both languages", async () => {
  // The mechanical form of the task's 界面文案/数据 split. A record's own title is the store's data:
  // translating it would be editing the record to read nicely, which is the one thing this page must
  // never do — and it is the failure a "make the page English" task is most likely to cause by
  // accident (a blanket find/replace over the render path).
  for (const [urlPath, needle] of [["/goal", CJK_T.g], ["/goal?kind=criterion", CJK_T.ac], ["/goal/GOAL-001", CJK_T.g], ["/goal/AC-028", CJK_T.ac]]) {
    for (const lang of ["en", "zh"]) {
      const r = await get(portCjk, urlPath, `lang=${lang}`);
      assert.equal(r.status, 200, `${urlPath} (${lang}) returns 200`);
      assert.ok(r.body.includes(needle), `${urlPath} (${lang}) renders the record's own title verbatim`);
    }
  }
  // …and the en page's ONLY Chinese is exactly that data: the copy census is still zero. This is the
  // arm that separates "the copy was translated" from "the page happens to have no Chinese because
  // the fixture was ASCII" — the two are indistinguishable on `wsAscii` alone.
  const rows = cjkLines((await get(portCjk, "/goal", "lang=en")).body);
  assert.deepEqual(rows.slice().sort(), [CJK_T.g, `${CJK_T.g} 2`].sort(),
    "the en list page's only Chinese is the two GOAL titles (data) — ⛔ no copy line survived");
});

test("AC5: the back link follows the page language on ALL THREE detail pages (a shared helper with three callers)", async () => {
  // `renderBackLink` defaults its language to `DEFAULT_LANG`, so a caller that does not pass its own
  // renders an ENGLISH back link on a `?lang=zh` page — silently, and no arm that only reads one page
  // can tell that from a wired one (硬规则 3b). The three detail pages are asserted together for
  // exactly that reason: wiring only /goal would leave the other two half-migrated, which is the
  // shape 硬规则 5b exists to catch.
  const ZH_BACK = cp(0x2190) + " " + cp(0x8fd4) + cp(0x56de) + cp(0x5217) + cp(0x8868);
  // The adr store's directory comes from the provider env (set by `makeWorkspace`); the doc store is
  // read straight off `<workspaceRoot>/docs-managed` by `handleDocDetail`.
  const adrDir = path.join(wsAscii, "adr");
  const docDir = path.join(wsAscii, "docs-managed");
  fs.mkdirSync(adrDir, { recursive: true });
  fs.mkdirSync(docDir, { recursive: true });
  fs.writeFileSync(path.join(adrDir, "ADR-900-fixture.md"), "---\nid: ADR-900\ntitle: fixture adr\nstatus: accepted\n---\n## Body\nx\n");
  fs.writeFileSync(path.join(docDir, "DOC-900-fixture.md"), "---\nid: DOC-900\ntitle: fixture doc\nstatus: active\nkind: skill\n---\n## Body\nx\n");
  try {
    const cases = [["/goal/GOAL-001", "the goal detail"], ["/adr/ADR-900", "the adr detail"], ["/doc/DOC-900", "the doc detail"]];
    for (const [urlPath, why] of cases) {
      const en = await renderIn(wsAscii, urlPath, "lang=en");
      const zh = await renderIn(wsAscii, urlPath, "lang=zh");
      assert.equal(en.status, 200, `${urlPath} (en) returns 200`);
      assert.equal(zh.status, 200, `${urlPath} (zh) returns 200`);
      assert.ok(en.body.includes("← Back to list"), `${why} (${urlPath}) renders the ENGLISH back link under en`);
      assert.ok(zh.body.includes(ZH_BACK), `${why} (${urlPath}) keeps the pre-existing back link under zh`);
      assert.ok(!zh.body.includes("← Back to list"), `${why} (${urlPath}) must not show the English back link under zh`);
    }
  } finally {
    fs.rmSync(adrDir, { recursive: true, force: true });
    fs.rmSync(docDir, { recursive: true, force: true });
  }
});

test("AC5: the tab indicator switches too — asserted from the RENDERED body, never from a source grep", async () => {
  // The task body's ③: `/goal`'s `Tab:` indicator is an inner-page literal whose call site a source
  // grep does not reveal (the token travels through `pageNameFor`), so this arm reads the response.
  const strongOf = (body) => /<p class="meta">Tab: <strong>([^<]*)<\/strong>/.exec(body.replace(/\n/g, " "))?.[1];
  const en = strongOf((await get(port, "/goal", "lang=en")).body);
  const zh = strongOf((await get(port, "/goal", "lang=zh")).body);
  assert.equal(en, "Goals", "the en tab indicator carries the page's own token");
  assert.equal(zh, cp(0x76ee) + cp(0x6807), "the zh tab indicator carries the translated token");
  assert.notEqual(en, zh, "the indicator is not the same string in both languages");
  // ⛔ THE SIBLING `Criteria` LABEL IS DELIBERATELY STILL ENGLISH under zh (AC-301's named residue,
  // carried forward unchanged — wiring it needs a third PAGE_LABELS entry outside both tasks' scope).
  // Asserted as PRESENT so it can never be silently claimed as wired: a later task that localizes it
  // must come here and change this arm deliberately. ⚠️ It is an `<a>` on the default URL (the Goals
  // tab is ACTIVE, so `Criteria` is the inactive LINK; the `<strong>` arm belongs to `?kind=criterion`)
  // — both forms are asserted, because pinning only one would pass on a page that had lost the other.
  const zhBody = (await get(port, "/goal", "lang=zh")).body;
  assert.ok(zhBody.includes(">Criteria</a>"), "residue: the inactive `Criteria` tab link is still English under zh");
  const zhCritBody = (await get(port, "/goal?kind=criterion", "lang=zh")).body;
  assert.ok(zhCritBody.includes("<strong>Criteria</strong>"), "residue: the ACTIVE `Criteria` tab label is still English under zh");
  // …and the wired sibling really did switch on that same page, so the residue above is a statement
  // about ONE label and not about the tab bar being untouched.
  assert.ok(zhCritBody.includes(`>${cp(0x76ee)}${cp(0x6807)}</a>`), "the `Goals` tab link on the Criteria page IS translated");
});

test("AC5: the two '<h1> subtitle' variants switch, and the row count stays interpolated raw", async () => {
  // The `<h1>` is `<page name> — <subtitle> (<n>)`. Only the constant parts go through dictionaries;
  // the count is interpolated. Asserted by SHAPE so the arm cannot go stale as the fixture grows.
  const h1 = (body) => /<h1>([^<]*)<\/h1>/.exec(body)?.[1];
  const goal = h1((await get(port, "/goal", "lang=en")).body);
  assert.match(goal, /^Goals — stage goals \(\d+\)$/, `the en Goals-tab <h1> (got ${JSON.stringify(goal)})`);
  const crit = h1((await get(port, "/goal?kind=criterion", "lang=en")).body);
  assert.match(crit, /^Goals — AC \/ criterion \(\d+\)$/, `the en Criteria-tab <h1> (got ${JSON.stringify(crit)})`);
  const zhGoal = h1((await get(port, "/goal", "lang=zh")).body);
  assert.ok(zhGoal.startsWith(`${cp(0x76ee)}${cp(0x6807)} — ${cp(0x9636)}${cp(0x6bb5)}${cp(0x76ee)}${cp(0x6807)} (`),
    `the zh Goals-tab <h1> keeps its pre-existing prefix and suffix (got ${JSON.stringify(zhGoal)})`);
  // The count is REAL: a status filter drops records, so the same `<h1>` shape has to move with it.
  // ⚠️ Comparing the two TAB counts would NOT show this — the fixture happens to hold two GOALs and
  // two criteria, so the two tabs render the same number and a frozen literal would pass. The
  // filtered fetch is what makes the interpolation falsifiable.
  const draftOnly = h1((await get(port, "/goal?status=draft", "lang=en")).body);
  assert.match(draftOnly, /^Goals — stage goals \(\d+\)$/, `the filtered <h1> keeps the shape (got ${JSON.stringify(draftOnly)})`);
  assert.notEqual(/\((\d+)\)/.exec(draftOnly)[1], /\((\d+)\)/.exec(goal)[1],
    "the <h1> count is interpolated from the tab's own row count, not a literal");
  assert.ok(Number(/\((\d+)\)/.exec(draftOnly)[1]) < Number(/\((\d+)\)/.exec(goal)[1]),
    "…and the filter really removed rows (so the difference above is the interpolation, not noise)");
});

test("AC2: a header-free negative control — the ONLY page-authored Chinese class left under en is the switcher endonym", async () => {
  // The endonym is subtracted by `cjkLines`, which asserts it LOCATED the switcher. This arm states
  // the other half: the switcher really does carry it on an en page (so the subtraction above is a
  // real removal and not a no-op on a page that never had one).
  const en = await get(port, "/goal", "lang=en");
  assert.ok(en.body.includes(ENDONYM), "the en page carries the switcher endonym (the one Chinese word it must keep)");
  assert.ok(!visibleText(en.body.replace(LANG_SWITCHER_ITEM_RE, "")).includes(ENDONYM),
    "…and it is entirely inside the switcher items — i.e. the subtraction above removes all of it");
});

test("AC2/residue: the NO-IDENTITY <title> is Chinese in BOTH languages — measured, named, and out of this task's scope", async () => {
  // ⚠️ The AC2 census above is measured on a workspace whose project identity RESOLVES, where the
  // `<title>` is `<project> — Goals`. There is a SECOND state — a `pageTitle` caller with no identity
  // at all — where the title falls back to `pageTitle`'s own Chinese label, and the census would go
  // non-zero. Leaving that unnamed would make "en = 0" a statement about ONE state rather than about
  // the page (硬规则 4: a criterion whose other state was never built is not a measurement).
  //
  // ⛔ IT IS NOT THIS TASK'S COPY: `pageTitle` is shared chrome with 22 call sites, its label lives in
  // `serve-render.ts` (not in a page), and the dashboard task registered the same string as residue
  // before this one did ("需 identity 未解析才出现，实测页面不含"). This arm therefore does the
  // stronger thing the earlier tasks did NOT: it CONSTRUCTS the state and pins the residue as
  // PRESENT in both languages, so a later task that localizes it must come here deliberately, and no
  // future reader can mistake the census above for a claim about every reachable state.
  const { handleGoalList } = await import("../src/serve-goal.ts");
  const capture = () => ({ statusCode: 0, headers: {}, body: "", writeHead(c, h) { this.statusCode = c; this.headers = h; }, end(b) { this.body = b || ""; } });
  const client = { goalList: async () => [{ id: "GOAL-001", title: "t", status: "active", kind: "goal", body: "" }], taskList: async () => ({ tasks: [], malformed: [] }) };
  const titleOf = (body) => /<title>([^<]*)<\/title>/.exec(body.replace(/\n/g, " "))?.[1];
  const RESIDUE = `${cp(0x672a)}${cp(0x63a5)}${cp(0x5165)}${cp(0x9879)}${cp(0x76ee)}${cp(0x8eab)}${cp(0x4efd)} — `;
  for (const lang of ["en", "zh"]) {
    const res = capture();
    // `identity` deliberately absent — the state a direct-render caller (or a future handler that
    // forgot to thread `cfg`) produces.
    await handleGoalList({}, res, new URL("http://localhost/goal"), client, { workspaceRoot: wsAscii, lang });
    const title = titleOf(res.body);
    assert.ok(title.startsWith(RESIDUE), `${lang}: the no-identity <title> carries pageTitle's shared-chrome label (got ${JSON.stringify(title)})`);
    // …and the PAGE'S OWN half of that same title DID follow the language, so the residue above is a
    // statement about `pageTitle`'s prefix and not about the title being frozen.
    assert.ok(title.endsWith(lang === "en" ? "Goals" : cp(0x76ee) + cp(0x6807)), `${lang}: the page token half of the title follows the language`);
  }
  // Control: WITH an identity the same title is fully English under en — so the residue is reachable
  // only through the no-identity branch, not through the normal one (otherwise the census above would
  // have caught it).
  const withId = capture();
  await handleGoalList({}, withId, new URL("http://localhost/goal"), client, { workspaceRoot: wsAscii, identity: { projectName: "proj", projectRoot: "/tmp/proj" }, lang: "en" });
  assert.equal(titleOf(withId.body), "proj — Goals", "with an identity the en title is fully English");
});
