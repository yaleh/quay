// @test-group product
// gap-webui-journal-body-copy-en-zh — /journal 的【正文文案】本地化（正文系列，/dashboard 已定 pattern）。
//
// 病灶与 /dashboard 同源：AC-296 把 /journal 的【外壳】（nav / `<title>` / `<h1>` 的页名 / 切换控件）
// 接到了 serve-i18n.ts 的字典，但页面**正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个
// 「框是英文、内容是中文」的页面。
//
// ⚠️ 本页真正的难点不是翻译，是**分离**：/journal 渲染的是 escalations.md 与 tick-log.md 的**原文**
// （用户/manager 自己写的处置记录、根因分析、提交号），那些是**数据**，不翻译。红基线（真实
// workspace、真实 startServer、`Cookie: lang=en`）实测含 CJK 文本行 241 条，而其中**界面文案只有 6 条**
// —— 剩下 235 条是数据。⛔ 所以「把 241 清到 0」是一个会**破坏数据**的目标。
//
// 分离用的谓词是**结构性对照**，不是目测（硬规则 2「按位置判定，不按关键词」）：同一份代码起**两台**
// 真服务器 —— 一台根在真实 workspace（真 escalations.md + 真 2MB tick-log.md + 真提交日志），
// 一台根在 orchestration/ 为空、提交信息为 ASCII 的 workspace。**两边都出现的 CJK 行只可能是模板
// 渲染的**（第二台根本没有数据可渲染）。本文件把这个差分搬进测试形态：fixture 的数据是**受控的**，
// 于是 en 页里剩下的每一条 CJK 行都必须能被逐条归因。
//
// 本文件验证：
//   • 字典完备且被类型强制（`Record<JournalKey,{en,zh}>`，键集闭合，两列非空，en 无 CJK）
//   • 取词函数的 throw 路径（缺参数）—— 硬规则 3b：读不懂输入时不得返回与「合格」同形的值
//   • 黑盒两态：en 下界面 CJK = 0（只余切换控件 endonym）；zh 下中文仍在且**逐字不变**
//   • **数据未被误翻译**：数据段的原文在 en 页里逐字出现（这是本页最贵的那个失败模式）
//   • 陈旧提示（唯一带插值的行）两态：en 英文、zh 与改前字面量逐字一致
//   • **零计数的对照**（硬规则 2）：同一谓词对 zh 响应干跑必须命中，否则「en 下 0 条」可能只是谓词坏了
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import { JOURNAL_KEYS, JOURNAL_LABELS, journalLabelsFor, fillLabel } from "../src/serve-i18n.ts";
import { readJournal } from "../src/observation.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes this task is defined against: Han + CJK punctuation + full-width forms. One
 *  regex, used by the dictionary assertion AND the black-box one, so the two cannot drift into two
 *  different definitions of "Chinese". Built from CODE POINTS rather than a literal range: a file
 *  that draws a "is this Chinese?" line should not itself contain a Chinese literal range, and a
 *  literal one here would make every future CJK sweep of this tree flag this file. */
const cp = (n) => String.fromCharCode(n);
const CJK = new RegExp(`[${cp(0x4e00)}-${cp(0x9fff)}${cp(0x3000)}-${cp(0x303f)}${cp(0xff00)}-${cp(0xffef)}]`);

/** The language switcher's endonym, assembled from code points for the same reason as `CJK`: it is
 *  the ONE CJK string that must survive on the English page (ROW 4's design — a reader who cannot
 *  read the current UI language must still be able to find their own), so the assertion has to name
 *  it, and naming it as a literal would put Chinese in the file that defines "no Chinese here". */
const ENDONYM = cp(0x4e2d) + cp(0x6587);

/** Visible text lines of an HTTP response body: `<style>`/`<script>` blocks dropped, remaining tags
 *  stripped, entities decoded, split on newline, trimmed, empties dropped. */
function textLines(body) {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const cjkLines = (body) => textLines(body).filter((l) => CJK.test(l));

function get(port, urlPath, cookie) {
  return new Promise((resolve, reject) => {
    const headers = cookie ? { Cookie: cookie } : {};
    http.get({ host: "127.0.0.1", port, path: urlPath, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}

// ── the fixture ──────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ THE DATA CARRIES DELIBERATE CHINESE. That is the whole point of this page's task: the page
// renders escalations.md / tick-log.md VERBATIM, so a fixture whose data is ASCII-only would make
// "the data was not translated" unfalsifiable (there would be nothing to translate). The Chinese
// here is DATA, and the en-page assertion below requires it to survive byte-for-byte.
const ESC_DATA_CHINESE = "另有中文数据段落，这一段是数据，不得翻译。";
const TICK_DATA_CHINESE = "tick 数据条目，同样不得翻译。";
/** How the tick bullet's prose reaches the page as a text line: `renderMarkdown` turns the inline
 *  `<code>` spans into their own elements, so tag-stripping leaves the prose behind the dash it
 *  followed in the source bullet (`- \`09:44Z\` \`correct\` — <prose>`). The date the reader stamps
 *  onto the bullet lands on a separate line and carries no CJK. */
const TICK_DATA_LINE = `— ${TICK_DATA_CHINESE}`;

let server, port, root, originalCwd, tasksDir, escalationsPath;

before(async () => {
  tasksDir = makeTmpDir("journal-i18n-tasks-");
  root = makeTmpDir("journal-i18n-ws-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  fs.writeFileSync(path.join(tasksDir, "JRN-A.md"),
    `---\nid: JRN-A\ntitle: journal fixture task\nstatus: ready\n---\n## Proposal\nascii body\n`);

  const orch = path.join(root, "orchestration");
  fs.mkdirSync(orch, { recursive: true });
  escalationsPath = path.join(orch, "escalations.md");
  fs.writeFileSync(escalationsPath,
    `# escalations\n\n## 9. fixture escalation\n\n${ESC_DATA_CHINESE}\n`);
  // A STALE mtime, so the stale banner renders on every request (AC-306's interpolated row).
  const stale = new Date(Date.now() - 9 * 86_400_000);
  fs.utimesSync(escalationsPath, stale, stale);
  fs.writeFileSync(path.join(orch, "tick-log.md"),
    `# tick log\n\n- \`09:44Z\` \`correct\` — ${TICK_DATA_CHINESE}\n`);
  fs.writeFileSync(path.join(root, "README.md"), "journal i18n fixture\n");
  // ⚠️ git-init the fixture. Without a repo, `readRecentCommits` degrades to `empty` with a CHINESE
  // reader diagnostic (`工作区不是 git 仓库（无提交记录）`) which the page escapes verbatim into the
  // 「无数据」 state. That string is the READER's prose, not this page's copy (the same class the
  // /dashboard task's decision record ⑤ recorded as out of scope), and leaving it here would force
  // the en accounting to carry a "reader diagnostics" exemption — a hole that could silently widen
  // to swallow the page. With a real repo the section renders real commits and the hole is zero-width.
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: root });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "fixture commit"], { cwd: root });

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

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ───────────────────────────

test("AC4: JOURNAL_KEYS and JOURNAL_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...JOURNAL_KEYS];
  assert.equal(new Set(roster).size, roster.length, "JOURNAL_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(JOURNAL_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  // The roster is the MEASURED one, not a token stub: the red baseline's no-data differential
  // produced 7 rows (1 header suffix + 3 section headings + 3 empty/error states) plus the
  // interpolated stale banner.
  assert.equal(roster.length, 8, `the roster is the measured one (got ${roster.length})`);
  assert.deepEqual(journalLabelsFor("en") && Object.keys(journalLabelsFor("en")).sort(), roster.slice().sort(),
    "journalLabelsFor resolves the WHOLE closed roster (no key silently missing from the resolved map)");
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is NOT a loosening: a zh value with no CJK is allowed ONLY when it is byte-equal to
  // its en value (a genuinely language-neutral token). An accidentally-English zh prose value
  // therefore still fails — it would satisfy "non-empty" while leaving the zh page half-English.
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of JOURNAL_KEYS) {
    const { en, zh } = JOURNAL_LABELS[key];
    if (!en || !en.trim()) problems.push(`${key}: en is empty`);
    if (!zh || !zh.trim()) problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en column contains CJK — ${JSON.stringify(en)}`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh column is neither translated nor byte-equal to en — ${JSON.stringify(zh)}`);
  }
  assert.deepEqual(problems, [], "the dictionary is complete in both columns");
});

test("AC4 (throw path): fillLabel refuses to render a template whose placeholder the caller did not supply", () => {
  // 硬规则 3b's half: a reader that cannot interpret its input must not return a value shaped like
  // "fine". A silently-unfilled banner would render its own template syntax on the page, and NO
  // "does the page show the value it should" check would go red (the page would still look alive).
  const L = journalLabelsFor("en");
  assert.throws(() => fillLabel(L.staleBanner, {}), /needs \{date\}/,
    "an unfilled {date} throws instead of rendering the template literal");
  assert.throws(() => fillLabel(L.staleBanner, { date: "2026-08-27" }), /needs \{days\}/,
    "an unfilled {days} throws too — the check is per-placeholder, not per-template");
  // And the same label fills cleanly once BOTH are supplied.
  assert.ok(fillLabel(L.staleBanner, { date: "2026-08-27", days: 21 }).includes("2026-08-27"));
});

// ── AC2/AC3/AC7: the black-box two-state assertion ───────────────────────────────────────────────

test("AC2: on lang=en the /journal page renders ZERO interface copy in Chinese — every remaining CJK line is accounted for as data or the switcher's endonym", async () => {
  const res = await get(port, "/journal", "lang=en");
  assert.equal(res.status, 200);

  // The accounting is EXHAUSTIVE and ENUMERATED, not a sampled boolean and not a count: the full
  // sorted multiset of CJK lines on the en page must EQUAL the four lines we can name — the switcher
  // endonym (twice: desktop nav + mobile menu, ROW 4's by-design exception) and the two data lines.
  // ⛔ No "reader diagnostic" exemption is needed or granted: the fixture is a real git repo and both
  // sources are readable, so `readJournal(root).reason` is null on all three sections (asserted
  // below) — which is what keeps this list from having a hole in it.
  assert.deepEqual(cjkLines(res.body).slice().sort(),
    [ENDONYM, ENDONYM, ESC_DATA_CHINESE, TICK_DATA_LINE].sort(),
    "en /journal's CJK lines are exactly the endonym + the two data lines — zero interface copy");

  const j = readJournal(root);
  for (const [name, section] of Object.entries(j)) {
    assert.equal(section.reason ?? null, null,
      `the fixture's ${name} section renders no reader diagnostic (so no diagnostic line can be hiding in the accounting above)`);
  }

  // ⚠️ The English interface copy is asserted POSITIVELY too: "no Chinese" would also be satisfied
  // by a page that rendered nothing at all, or by a page whose headings had gone blank.
  for (const expected of ["recent loop record", "Escalations (escalations.md)", "Tick log (tick-log.md)",
                          "Recent commits (git log)"]) {
    assert.ok(res.body.includes(expected), `en /journal renders the English copy ${JSON.stringify(expected)}`);
  }
});

test("AC2 (data integrity): the data sections survive lang=en BYTE-FOR-BYTE — the page never translates the operator's own record", async () => {
  const res = await get(port, "/journal", "lang=en");
  assert.ok(res.body.includes(ESC_DATA_CHINESE),
    "the escalations.md data line appears verbatim on the en page");
  assert.ok(res.body.includes(TICK_DATA_CHINESE),
    "the tick-log.md data line appears verbatim on the en page");
  // And the reader's own fact is unchanged by the render language: the page did not "translate" the
  // data away, and the section is still `ok` (not degraded into an empty state by the rewrite).
  const j = readJournal(root);
  assert.equal(j.escalations.status, "ok");
  assert.equal(j.tickLog.status, "ok");
});

test("AC3: lang=zh still renders every pre-change literal BYTE-FOR-BYTE (the zh column is the old literal, not a new translation)", async () => {
  const res = await get(port, "/journal", "lang=zh");
  assert.equal(res.status, 200);
  const body = res.body;
  // These four literals are the PRE-CHANGE source strings, quoted here as literals rather than
  // derived from the dictionary (硬规则 4: a value compared against itself is not a measurement).
  // They are the reason the zh page could not move: the dictionary's zh column was extracted FROM
  // the running code, so a "reads better" re-wording here would be a regression.
  const zhLiterals = [
    "循环最近记录",                    // 循环最近记录 — the <h1> suffix
    "升级项 (escalations.md)",                     // 升级项 (escalations.md)
    "Tick 记录 (tick-log.md)",                         // Tick 记录 (tick-log.md)
    "最近提交 (git log)",                       // 最近提交 (git log)
  ];
  for (const lit of zhLiterals) {
    assert.ok(body.includes(lit), `zh /journal still renders ${JSON.stringify(lit)} verbatim`);
  }
  assert.ok(body.includes(ESC_DATA_CHINESE) && body.includes(TICK_DATA_CHINESE),
    "zh renders the data verbatim too");
  // Positive control for the en test's zero-count: the SAME predicate finds plenty here.
  assert.ok(cjkLines(body).length >= 4,
    `the CJK predicate fires on the zh page (${cjkLines(body).length} lines) — the en zero is a measurement, not a broken matcher`);
});

// ── AC-306's one interpolated row: the stale banner ──────────────────────────────────────────────

test("AC-306: the stale banner is ENGLISH on lang=en and the pre-change literal on lang=zh, with date and days interpolated in both", async () => {
  // The fixture's escalations.md mtime is 9 days old, so the banner renders on every request.
  const en = await get(port, "/journal", "lang=en");
  assert.ok(en.body.includes("Stale record"), "en renders the stale banner in English");
  assert.ok(/9d ago/.test(en.body), "en interpolates the day count");
  assert.ok(en.body.includes("2026-"), "en interpolates the last-write date");
  assert.ok(!/陈旧记录/.test(en.body),
    "the zh banner word does not appear on the English page");

  const zh = await get(port, "/journal", "lang=zh");
  assert.ok(zh.body.includes("陈旧记录"), "zh renders the banner's zh wording");
  assert.ok(zh.body.includes("约 9 天前"), "zh interpolates the day count verbatim");
  assert.ok(zh.body.includes("升级机制已由 tick-log 取代"),
    "zh renders the banner's tail clause verbatim");
});

test("AC-306: the reader reports the stale FACT, not a rendered sentence (which is why the banner is localizable at all)", () => {
  const j = readJournal(root);
  assert.ok(j.escalations.staleSource, "the stale fact is present on a 9-day-old escalations.md");
  assert.equal(j.escalations.staleSource.days, 9, "the fact carries the floored age in days");
  assert.match(j.escalations.staleSource.date, /^\d{4}-\d{2}-\d{2}$/, "the fact carries an ISO date");
  // ⛔ The markdown handed to the renderer must NOT carry the banner's words: that is exactly the
  // coupling this task removed (a sentence assembled before the request's language is known cannot
  // be un-assembled at the call site).
  assert.ok(!/陈旧/.test(j.escalations.markdown || ""),
    "the reader no longer bakes the banner's wording into the markdown");
  assert.ok(j.escalations.markdown.includes(ESC_DATA_CHINESE),
    "the reader hands over the data and only the data");
});
