// @test-group product
// gap-webui-live-body-copy-en-zh — /live 的【正文文案】本地化（正文本地化系列的续页，照
// gap-webui-dashboard-body-copy-en-zh 已定的 pattern，不重新设计）。
//
// 病灶：AC-291 把 /live 的【外壳】（`<html lang>`、nav、`<title>`/`<h1>` 的 PAGE token）接到了
// serve-i18n.ts 的字典，但网页**正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个「框是英文、
// 内容是中文」的页面。红基线（真实 startServer + `Cookie: lang=en`，去 `<style>/<script>`/标签后按行）：
//   · 空闲态（遥测在、0 在飞）4 行：标题后缀、运行摘要、无阻塞关系、无在飞任务
//   · 有在飞态（3 个 run + 真 Touches/depends_on 阻塞关系）23 行：加上表头 5 条、阻塞两句、
//     每任务的状态/阶段/时长/「无」占位
//   · ⚠️ 两态各抓一次是必须的：`noInFlight` 只在 0 在飞时渲染，而阻塞两句/表头只在有在飞时渲染
//     —— 任何一次抓取都看不到另一态（本文件因此对两态各跑一遍，`blockingHeading` 与
//     `noBlockingRelation` 是互斥的两行）。
//
// 本文件验证（AC4/AC5 的机械判据 + AC2/AC3 的黑盒两态）：
//   • 字典完备且被类型强制：`LIVE_LABELS` 是 `Record<LiveKey,{en,zh}>`，键集闭合、每键两列非空、
//     en 列无 CJK、zh 列含 CJK 或与 en 逐字相同（见 `zhArmOk` 的注释 —— 后者不是放宽，是更强的谓词）。
//   • 取词函数的两条 throw 路径（未知键 / 缺参数）—— 硬规则 3b 的那半边：读不懂输入时不得返回与
//     「合格」同形的值。缺参数若静默留 `{flags}`，页面会把自己的模板语法渲染出来，而没有一条
//     「页面上有没有该有的值」的检查会变红。
//   • 黑盒两态：真实 startServer（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`。
//   • **零计数的对照**（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中 —— 否则「en 下 0 条」可能
//     只是谓词坏了。
//   • **数据不翻译的正控制**：带中文标题的在飞任务在 en 下必须**原样**渲染它的中文，否则「en 下
//     CJK = 0」可以被一个「页面根本不渲染数据」的页面满足（硬规则 4）；读者自己的诊断串
//     （`liveExplanation` / `reason`）同属此列，并且是**具名的越界残留**（serve-i18n ROW 19）——
//     本文件把它当成一条被钉住的事实，而不是当作没看见。
//   • **phaseLabel 单一来源**：`/live` 的三个阶段词与 /dashboard 的 liveCard 渲染的是同一个
//     `InFlightPhase` 枚举，所以它们**共用** ROW 5 的行（⛔ 不是各留一份翻译）；本文件既断言
//     「两页得到同一个词」，也断言 LIVE 字典里**没有**第二份阶段词行。
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { startServer } from "../src/serve.ts";
import {
  LIVE_KEYS,
  LIVE_LABELS,
  liveLabelsFor,
  liveLabel,
  dashboardLabel,
  fillLabel,
} from "../src/serve-i18n.ts";
import { phaseLabel, renderLivePage } from "../src/serve-live.ts";
import { QUAY_NATIVE_CLI } from "./helpers/cli-entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nativeBin = QUAY_NATIVE_CLI;
const nativeProviderDir = path.join(__dirname, "..", "..", "quay-native", "bin");

/** The CJK classes this task is defined against: Han, CJK punctuation (、。「」：（）) and the
 *  full-width forms. One regex, shared by the dictionary assertion and the black-box one, so the two
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
 *  the red baseline was measured in, so the test and the measurement speak one language.
 *  ⚠️ Tag-stripping is what splits the two blocking sentences into fragments ("Task" / "IMPL-1" /
 *  "is blocking ["), because the task ids are `<a>` links mid-sentence — the same split the zh
 *  baseline shows, so the two languages are counted through one predicate. */
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

const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;

/** Remove the language switcher's items, returning HOW MANY were removed. The count is returned (and
 *  asserted by the caller) so a regex that silently stopped matching cannot turn "no residual CJK"
 *  into a tautology — the switcher renders TWO items per menu, and both carry the endonym. */
function stripLangSwitcher(body) {
  const hits = body.match(LANG_SWITCHER_ITEM_RE) ?? [];
  return { stripped: hits.reduce((acc, h) => acc.split(h).join(""), body), hitCount: hits.length };
}

/** The switcher's endonym word(s), read OFF the rendered page rather than hard-coded: the point of
 *  the exclusion is "whatever the switcher renders". ⚠️ ALL items are scanned, not the first: under
 *  `en` the CURRENT item is the ASCII `EN`, so taking the first match returns no CJK and the filter
 *  below becomes a silent no-op. */
function switcherCjkWords(body) {
  return (body.match(LANG_SWITCHER_ITEM_RE) ?? [])
    .flatMap((item) => visibleText(item).split("\n"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && CJK.test(s));
}

/** Assert the en page carries NO interface CJK, and that the SAME predicate DOES fire on the zh
 *  render (the zero-count control from 硬规则 2). Returns the residual lines so a caller can classify
 *  a KNOWN residue instead of silently accepting one. */
function enResidual(en, zh, requestPath) {
  const { stripped, hitCount } = stripLangSwitcher(en.body);
  assert.ok(hitCount >= 2, `${requestPath}: the switcher is present (got ${hitCount} items) — a missing switcher would make the endonym filter vacuous`);
  const endonyms = switcherCjkWords(en.body);
  assert.ok(endonyms.length > 0, `${requestPath}: the switcher's endonym word is readable — an empty one would make the filter below a no-op`);

  const zhCjk = cjkLines(zh.body);
  assert.ok(zhCjk.length > 0,
    `CONTROL FAILED for ${requestPath}: the predicate found 0 CJK lines on the zh render too — ` +
    `it is broken, and the en zero therefore carries no information`);
  return cjkLines(stripped).filter((l) => !endonyms.includes(l));
}

/** Build a real workspace (config + git) that `fixture(tasksDir, root)` can seed, run `fn(port)`
 *  against a REAL server rooted there, then tear every bit of it down. */
async function withPage(fixture, fn) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lvb-i18n-ws-"));
  const tasksDir = path.join(ws, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.mkdirSync(path.join(ws, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    tasks_dir: "${tasksDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  execFileSync("git", ["init", "-q"], { cwd: ws });
  fs.writeFileSync(path.join(ws, "README.md"), "live body-i18n fixture\n");
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: ws });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "fixture"], { cwd: ws });
  fixture(tasksDir, ws);

  const cwd0 = process.cwd();
  let server;
  try {
    process.chdir(ws);
    server = await startServer({ port: 0 });
    await fn(server.address().port);
  } finally {
    process.chdir(cwd0);
    if (server) { server.close(); if (server.client) await server.client.close(); }
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

/** A two-segment telemetry record (start [+ impl-complete]). ⚠️ Every id/title in these fixtures is
 *  ASCII ON PURPOSE: with no Chinese in the DATA, the only possible CJK on the en page is interface
 *  copy, which is what makes the "en CJK = 0" assertion mean something. */
const ev = (runId, taskId, eventKind, ms) =>
  JSON.stringify({ schemaVersion: "1", runId, candidateId: taskId, taskId, stage: "Fast", attempt: 0, eventKind, timing: { queuedAtMs: null, startedAtMs: eventKind === "start" ? ms : null, endedAtMs: eventKind === "end" ? ms : null }, agentLabel: "fast-mode", commandIdentity: `fast-mode-telemetry:${eventKind}`, executionCwd: "/x", worktreePath: null, baseCommit: null, candidateCommit: null, outcome: null, waitReason: null, resourceClaim: null, observedWrites: [], isolationMode: null, dispatchMode: "serial", recordedAtMs: ms }) + "\n";

const taskFile = (id, status, extra, body) =>
  `---\nid: ${id}\nstatus: ${status}\ntitle: ${id}\nlabels: []\n${extra}---\n${body}\n`;
const BODY = (touch) =>
  `## Proposal\np\n## Plan\nplan body for the live body-i18n fixture task\n` +
  `## Acceptance Criteria\n- [ ] a sufficiently long criterion line\n## Definition of Done\n- [x] a sufficiently long done line\n` +
  `## Touches\n- ${touch}\n`;

/** STATE 1 — telemetry present, ZERO in flight (a completed run). This is the state whose four rows
 *  (`noInFlight` / `noBlockingRelation` / the summary / the title suffix) render ONLY here. */
function seedIdle(tasksDir, ws) {
  const dir = path.join(ws, ".workflow-events");
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "fm-IDLE-1.jsonl"),
    ev("fm-IDLE-1-a", "IDLE-1", "start", now - 600_000) + ev("fm-IDLE-1-a", "IDLE-1", "end", now - 60_000));
}

/** STATE 2 — three in-flight runs AND a real blocking relation, so every table/blocking row renders:
 *  IMPL-1 (implementing, blocks BLOCKED-1 by depends_on and OVERLAP-1 by Touches, blocked by DEP-1),
 *  AL-1 (awaiting-land, no relation ⇒ the 「无」/「none」 placeholder in BOTH cells), FREE-1. */
function seedInFlight(tasksDir, ws) {
  const dir = path.join(ws, ".workflow-events");
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  fs.writeFileSync(path.join(dir, "fm-IMPL-1.jsonl"), ev("fm-IMPL-1-a", "IMPL-1", "start", now - 20 * 60_000));
  fs.writeFileSync(path.join(dir, "fm-AL-1.jsonl"),
    ev("fm-AL-1-a", "AL-1", "start", now - 30 * 60_000) +
    ev("fm-AL-1-a", "AL-1", "impl-complete", now - 5 * 60_000));
  fs.writeFileSync(path.join(dir, "fm-FREE-1.jsonl"), ev("fm-FREE-1-a", "FREE-1", "start", now - 8 * 60_000));
  const touch = "packages/quay/src/lvb-shared.ts";
  fs.writeFileSync(path.join(tasksDir, "IMPL-1.md"), taskFile("IMPL-1", "ready", 'depends_on: ["DEP-1"]\n', BODY(touch)));
  fs.writeFileSync(path.join(tasksDir, "AL-1.md"), taskFile("AL-1", "ready", "depends_on: []\n", BODY("packages/quay/src/lvb-al.ts")));
  fs.writeFileSync(path.join(tasksDir, "FREE-1.md"), taskFile("FREE-1", "ready", "depends_on: []\n", BODY("packages/quay/src/lvb-free.ts")));
  // The ready/todo pool that creates the relation (observation.computeBlockingRelations).
  fs.writeFileSync(path.join(tasksDir, "BLOCKED-1.md"), taskFile("BLOCKED-1", "todo", 'depends_on: ["IMPL-1"]\n', BODY("packages/quay/src/lvb-blocked.ts")));
  fs.writeFileSync(path.join(tasksDir, "DEP-1.md"), taskFile("DEP-1", "todo", "depends_on: []\n", BODY("packages/quay/src/lvb-dep.ts")));
  fs.writeFileSync(path.join(tasksDir, "OVERLAP-1.md"), taskFile("OVERLAP-1", "todo", "depends_on: []\n", BODY(touch)));
}

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ────────────────────────────

test("AC4: LIVE_KEYS and LIVE_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...LIVE_KEYS];
  assert.equal(new Set(roster).size, roster.length, "LIVE_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(LIVE_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  // The roster is the MEASURED one, not a token stub: the four-state red baseline found these
  // interface strings, and 17 non-comment CJK source lines were classified into it (3 of them moved
  // to the shared phase rows, 14 landed here).
  assert.ok(roster.length >= 14, `the roster is the measured one, not a stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is NOT "the zh column contains CJK or symbols" — it is the STRONGER predicate the
  // roster actually needs: a zh value with no CJK is allowed ONLY when it is byte-equal to its en
  // value (a genuinely language-neutral token, e.g. 「—」). An accidentally-English zh prose value
  // therefore still fails, and a plain-English placeholder cannot hide behind "it contains no symbols".
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of LIVE_KEYS) {
    const { en, zh } = LIVE_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: every templated row carries its hole in BOTH columns (an en-only hole renders the payload into the zh sentence unseen)", () => {
  // ⚠️ This is what ROW 19's `{task}`/`{ids}`/`{flags}`/`{value}` shape exists for: the two blocking
  // sentences embed `<a>` ELEMENTS mid-sentence and the next-step line embeds a `<code>`, and the
  // hole's POSITION differs between the columns (`任务 {task} 正在阻塞 [{ids}]` vs
  // `Task {task} is blocking [{ids}]`). A hole present in one column and absent from the other is not
  // a typo — it silently renders the payload as a trailing fragment, which no "the page has no
  // English left" check can see.
  const templated = LIVE_KEYS.filter((k) => /\{\w+\}/.test(LIVE_LABELS[k].en));
  assert.ok(templated.length >= 4, `the templated rows exist (got ${templated.length}: ${templated.join(",")})`);
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(LIVE_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
  }
  // The non-templated rows must NOT carry a hole — `liveLabel` would then throw at render time on a
  // row whose call site has nothing to pass.
  for (const key of LIVE_KEYS.filter((k) => !templated.includes(k))) {
    assert.ok(!/\{\w+\}/.test(LIVE_LABELS[key].en) && !/\{\w+\}/.test(LIVE_LABELS[key].zh),
      `${key}: a row with no interpolation must carry no placeholder`);
  }
  // ⚠️ The two blocking sentences carry the ID LIST'S brackets INSIDE the template (`[{ids}]`). They
  // are not decoration: the AC3 before/after differential caught a silent zh byte change when the
  // first draft left them to the call site (`正在阻塞 [X, Y]` had become `正在阻塞 X, Y`), which no
  // "does the page contain the ids" probe can see. Pinned here so a later "tidy the template" edit
  // reds this test rather than moving the zh bytes.
  for (const key of ["blockingLine", "blockedByLine"]) {
    assert.ok(LIVE_LABELS[key].zh.includes("[{ids}]"), `${key}: the zh template keeps the id list's brackets around the hole`);
    assert.ok(LIVE_LABELS[key].en.includes("[{ids}]"), `${key}: the en template keeps them too`);
  }
});

test("AC4: liveLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = liveLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...LIVE_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of LIVE_KEYS) assert.equal(t[key], LIVE_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  assert.notDeepEqual(liveLabelsFor("en"), liveLabelsFor("zh"),
    "the two languages are not the same table (a both-columns-zh regression)");
  // The default argument is the en column — `renderLivePage`'s own default depends on it.
  assert.deepEqual(liveLabelsFor(), liveLabelsFor("en"), "the default language resolves to en");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 19 / 硬规则 3b)", () => {
  assert.throws(() => liveLabel("noSuchKey"), /unknown live key/);
  // Negative control for the other direction: a REAL key must NOT throw.
  assert.equal(typeof liveLabel("titleSuffix", "en"), "string");
  assert.equal(liveLabel("titleSuffix", "zh"), "循环此刻在做什么", "a real key resolves its zh column");
});

test("AC4: a missing parameter THROWS — the page never renders its own template syntax", () => {
  assert.throws(() => liveLabel("blockingLine", "en"), /\{task\}/,
    "a caller that forgets `{task}` must get an error, not a page showing `{task}`");
  assert.throws(() => liveLabel("inFlightCap", "zh", { wrong: "x" }), /\{inFlight\}/,
    "supplying the WRONG parameter name is the same omission");
  assert.equal(liveLabel("cellNone", "en"), "none", "a row with no hole is fine with no params");
  // A template with no placeholders is fine with an empty map — the throw is keyed on the TEMPLATE,
  // not on "the caller passed nothing".
  assert.equal(fillLabel("No cross-task blocking relation.", {}), "No cross-task blocking relation.");
});

test("AC5: the PHASE words come from the shared ROW 5 rows — /live keeps no second translation", () => {
  // The two pages render the SAME `InFlightPhase` enum in the same role, so a second copy of 「实现中」
  // would be exactly the "改一处漏一处" drift this series removes. Both directions are asserted:
  //   (a) the function RESOLVES to the dashboard's rows (positive), and
  //   (b) the LIVE dictionary carries NO phase row of its own (negative) — (b) is what makes (a) more
  //       than "the two happen to agree today".
  for (const lang of ["en", "zh"]) {
    assert.equal(phaseLabel("implementing", lang), dashboardLabel("phaseImplementing", lang),
      `${lang}: /live's implementing phase word IS the dashboard's row`);
    assert.equal(phaseLabel("awaiting-land", lang), dashboardLabel("phaseAwaitingLand", lang),
      `${lang}: /live's awaiting-land phase word IS the dashboard's row`);
    assert.equal(phaseLabel("landed", lang), dashboardLabel("phaseLanded", lang),
      `${lang}: /live's landed phase word IS the dashboard's row`);
  }
  // (b) no LIVE row holds a phase word — by KEY …
  // ⚠️ The key filter names the three ROW 5 rows directly. ⛔ NOT `/phase/i`: `colPhase` is the
  // TABLE'S HEADER (「阶段」/「phase」), a different rendered string from the enum word, and a
  // substring filter would red on it — a false positive that says nothing about duplication.
  assert.deepEqual(LIVE_KEYS.filter((k) => ["phaseImplementing", "phaseAwaitingLand", "phaseLanded"].includes(k)), [],
    "the LIVE roster carries no phase row (they are ROW 5's)");
  // … and by VALUE, which is the stronger check: a row keyed `somethingElse` whose value IS 实现中
  // would slip past the key filter above. ⚠️ EXACT (trimmed) equality, not `includes`: 「待落地时长」
  // legitimately CONTAINS the phase word 「待落地」 and is a different rendered string (a column
  // header), so a substring predicate here would be measuring the wrong thing.
  const phaseValues = ["实现中", "待落地", "已落地", "Implementing", "Awaiting land", "Landed"];
  for (const key of LIVE_KEYS) {
    for (const word of phaseValues) {
      assert.ok(LIVE_LABELS[key].zh.trim() !== word && LIVE_LABELS[key].en.trim() !== word,
        `${key}: a phase word leaked into the LIVE roster (${word}) — it must resolve through ROW 5`);
    }
  }
  // The language-neutral arm: `fan-in` and the unknown-phase placeholder are literals in BOTH
  // languages (a dictionary row for them would be a key no reader could ever see translated).
  assert.equal(phaseLabel("fan-in", "en"), "fan-in");
  assert.equal(phaseLabel("fan-in", "zh"), "fan-in");
  assert.equal(phaseLabel(null, "en"), "—");
  assert.equal(phaseLabel(undefined, "zh"), "—");
});

// ── AC2/AC3 black box: the two languages on a real server, in BOTH renderable states ────────────

test("AC2: `lang=en` on the IDLE page has ZERO interface CJK, and the same predicate DOES hit on zh (the zero-count control)", async () => {
  await withPage(seedIdle, async (port) => {
    const en = await get(port, "/live");
    const zh = await get(port, "/live", { Cookie: "lang=zh" });
    assert.equal(en.status, 200, "GET /live (en) returns 200");
    assert.equal(zh.status, 200, "GET /live (zh) returns 200");

    const residual = enResidual(en, zh, "/live (idle)");
    assert.deepEqual(residual, [], "en /live (idle): no interface CJK may remain");

    // The page still RENDERS (the localization did not delete the data path or the empty state).
    assert.ok(en.body.includes("live_state=running"), "the machine key still renders under en");
    assert.ok(en.body.includes("In flight: 0 / cap:"), "the idle summary renders its English count line");
    assert.ok(en.body.includes("No cross-task blocking relation."), "the empty blocking note is English");
    assert.ok(en.body.includes("No in-flight tasks right now."), "the empty in-flight note is English");
    assert.ok(en.body.includes("Live — what the loop is doing right now"), "the <h1> carries the English suffix");
    // The zh arm really is the other state (not a copy of en) — the control's other half.
    assert.ok(zh.body.includes("当前无在飞任务。"), "the zh empty-state note renders under zh");
    assert.ok(zh.body.includes("无跨任务阻塞关系。"), "the zh empty blocking note renders under zh");
  });
});

test("AC2: `lang=en` on the IN-FLIGHT page has ZERO interface CJK — the table, the blocking sentences and the 「无」 placeholder all switched", async () => {
  await withPage(seedInFlight, async (port) => {
    const en = await get(port, "/live");
    const zh = await get(port, "/live", { Cookie: "lang=zh" });
    assert.equal(en.status, 200, "GET /live (en) returns 200");
    assert.equal(zh.status, 200, "GET /live (zh) returns 200");

    const residual = enResidual(en, zh, "/live (in flight)");
    assert.deepEqual(residual, [], "en /live (in flight): no interface CJK may remain");

    // The rows this state alone renders, asserted POSITIVELY in English (a bare "no CJK" arm would
    // also be satisfied by a page that rendered no rows at all — 硬规则 4).
    assert.ok(en.body.includes("<th>status</th>") && en.body.includes("<th>phase</th>") && en.body.includes("<th>awaiting-land duration</th>"),
      "the five localized table headers are English");
    assert.ok(en.body.includes("<th>blocks</th>") && en.body.includes("<th>blockedBy</th>"),
      "the two half-translated headers lost their zh half");
    assert.ok(en.body.includes("Implementing") && en.body.includes("Awaiting land"),
      "both phase words render (through ROW 5's rows)");
    assert.ok(en.body.includes(" min<"), "the elapsed cell carries the English minute unit");
    assert.ok(en.body.includes("Cross-task blocking"), "the blocking section heading is English");
    assert.ok(en.body.includes('href="/task/IMPL-1"') && en.body.includes("is blocking [") && en.body.includes("is blocked by ["),
      "both blocking sentences render in English");
    // The 「无」 placeholder renders ONLY for a task with no relation on that side (AL-1) — asserted
    // in English so the placeholder's translation is covered too.
    const alRow = en.body.split("</tr>").find((r) => r.includes("AL-1"));
    assert.ok(alRow && alRow.includes("none"), "the no-relation placeholder renders as `none` under en");
    assert.ok(!alRow.includes("无"), "…and the zh placeholder is gone from that cell");
    // The zh arm still carries the pre-existing bytes (the AC3 regression guard, pinned as literals
    // rather than read back from the dictionary — 硬规则 4).
    for (const lit of ["状态", "阶段", "待落地时长", "阻塞 (blocks)", "被阻塞 (blockedBy)", "跨任务阻塞关系", "正在阻塞 [", "被 ["] ) {
      assert.ok(zh.body.includes(lit), `zh /live still renders ${JSON.stringify(lit)}`);
    }
    assert.ok(zh.body.includes("无"), "zh /live still renders the 「无」 placeholder");
  });
});

test("AC2/AC3: the reader's own diagnostics render VERBATIM in both languages (DATA is not translated) — the named residue", async () => {
  // ⛔ This is the arm that keeps the "en CJK = 0" claim honest. /live's two banner states carry a
  // sentence produced by observation.ts (`liveExplanation` — how a telemetry-empty state was decided)
  // and, on a read failure, the reader's `reason`. Those are the READER's diagnostics, not this page's
  // copy: they are rendered verbatim through `escapeHtml` in both languages, exactly as /dashboard,
  // /journal, /board and /architecture classified the same class of string. So in these two states the
  // en page carries exactly ONE residual line each — and it is PINNED here rather than ignored, so a
  // future change that widened the residue (e.g. a second untranslated sentence) would red this test.
  const bannerResidual = async (lang, expectZh) => {
    const en = await get(lang.port, "/live");
    const zh = await get(lang.port, "/live", { Cookie: "lang=zh" });
    const residual = enResidual(en, zh, `${lang.path} (en)`);
    assert.equal(residual.length, 1,
      `${lang.path}: exactly ONE residual line is expected under en (the reader's diagnostic), got ${JSON.stringify(residual)}`);
    assert.ok(residual[0].includes(expectZh),
      `${lang.path}: the residual line IS the reader's own diagnostic (${JSON.stringify(residual[0])})`);
    return { en, zh };
  };

  // (a) running-unwired: telemetry absent + an activity signal (a fresh tick log).
  await withPage((_tasksDir, ws) => {
    fs.mkdirSync(path.join(ws, "orchestration"), { recursive: true });
    fs.writeFileSync(path.join(ws, "orchestration", "tick-log.md"), "# tick\n| t | a |\n");
  }, async (port) => {
    const { en, zh } = await bannerResidual({ port, path: "/live (running-unwired)" }, "有活动信号");
    assert.ok(en.body.includes("Running, telemetry not wired"), "the unwired state word is English");
    assert.ok(en.body.includes("Next: check that the target project's loop calls"), "the next-step sentence is English");
    assert.ok(en.body.includes("<code>--task-start</code>/<code>--task-end</code>"),
      "the `{flags}` hole carries its markup payload (not the template syntax)");
    assert.ok(zh.body.includes("在跑但未接遥测"), "the zh state word still renders");
    assert.ok(zh.body.includes("下一步：检查目标项目的循环是否调用"), "the zh next-step sentence still renders");
  });

  // (b) read failure: the store is a plain FILE, so the reader's readdirSync throws.
  await withPage((_tasksDir, ws) => {
    fs.writeFileSync(path.join(ws, ".workflow-events"), "i am a file, not a directory\n");
  }, async (port) => {
    const { en, zh } = await bannerResidual({ port, path: "/live (read failure)" }, "读取遥测失败");
    assert.ok(en.body.includes("Read failed"), "the read-failure label is English");
    assert.ok(!en.body.includes("在跑但未接遥测") && !en.body.includes("未在运行"),
      "the read failure is distinguishable from both empty-state texts under en too");
    assert.ok(zh.body.includes("读失败"), "the zh read-failure label still renders");
  });

  // (c) positive control for the SAME rule on the DATA side: a Chinese TASK ID must survive verbatim
  // into the English page (the table's id cell and its `/task/<id>` link are data, whose language is
  // the task author's, not the request's). Without this, "en has no interface CJK" could be satisfied
  // by a page that simply stopped rendering its rows.
  // ⚠️ The id is Chinese and NOT the task's `title`: /live renders ids, not titles, so a Chinese title
  // would have proved nothing about this page (it never reaches the response).
  const zhTaskId = "中文任务-1";
  await withPage((tasksDir, ws) => {
    const dir = path.join(ws, ".workflow-events");
    fs.mkdirSync(dir, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(path.join(dir, "fm-zh-1.jsonl"), ev("fm-zh-1-a", zhTaskId, "start", now - 5 * 60_000));
    fs.writeFileSync(path.join(tasksDir, `${zhTaskId}.md`), taskFile(zhTaskId, "ready", "depends_on: []\n", BODY("packages/quay/src/lvb-zh.ts")));
  }, async (port) => {
    const en = await get(port, "/live");
    assert.ok(en.body.includes(zhTaskId),
      "the Chinese TASK ID renders verbatim under en (data is not copy)");
    assert.ok(en.body.includes(`href="/task/${encodeURIComponent(zhTaskId)}"`),
      "…and it still carries its link target (the id is not merely echoed)");
    // …and the classification the AC2 arm demands: every residual en CJK line IS that data item.
    const endonyms = switcherCjkWords(en.body);
    const residual = cjkLines(stripLangSwitcher(en.body).stripped).filter((l) => !endonyms.includes(l));
    const unclassified = residual.filter((l) => !l.includes(zhTaskId));
    assert.deepEqual(unclassified, [], "every residual en CJK line is classified user data");
    assert.ok(residual.length > 0, "the residual classification is not vacuous (this fixture HAS data CJK)");
  });
});

// ── AC5: every render path carries the request's language ─────────────────────────────────────────

test("AC5: the page has exactly TWO render entries (the route and the render function), both take the language, and there is NO refresh sub-endpoint", async () => {
  // Enumerated by reading the source, and each one exercised here rather than asserted about:
  //   ① serve-handlers.ts's `/live` route → handleLive(req,res,cfg) → cfg.lang (the HTTP arm, covered
  //      by every black-box test above).
  //   ② renderLivePage(live, identity, lang) — the ONE render function, whose `lang` parameter
  //      defaults to DEFAULT_LANG (en).
  // ⚠️ There is NO partial-refresh / JSON sub-endpoint on this page (unlike /dashboard/cards, which
  // re-renders cards 30 s after load and therefore MUST carry the language or the zh page silently
  // turns English seconds later — the failure a single-fetch probe cannot see). That absence is
  // PINNED rather than assumed, below: if one is ever added it must carry `lang`.
  const live = {
    status: "ok", reason: null, concurrencyCap: 4, cpuPressure: null, liveState: "running",
    liveExplanation: null, activity: null,
    inFlight: [{
      taskId: "LIVE-X", runId: "fm-x", pid: null, sessionId: null, startedAtMs: Date.now() - 60_000,
      implCompletedAtMs: null, status: "ready", phase: "implementing", suite: null, minutes: 1,
      liveness: "unknown", blocks: [], blockedBy: [],
    }],
  };
  // ⚠️ A RESOLVED identity is passed on purpose: with `identity = null`, `pageTitle` takes its own
  // 「未接入项目身份 — <page>」 fallback — a string owned by serve-render.ts (it belongs to no single
  // page; the dashboard task recorded it as another task's copy), and one the HTTP path never reaches
  // because `startServer` always resolves an identity. Passing null here would put a non-this-page
  // Chinese string into the residual and make the assertion fail for the WRONG reason.
  const identity = { projectName: "live-body-i18n-fixture", projectRoot: "/tmp/live-body-i18n-fixture" };
  const en = renderLivePage(live, identity, "en");
  const zh = renderLivePage(live, identity, "zh");
  // ⚠️ The en arm is NOT "contains no CJK at all": the render function emits the whole page, switcher
  // included, and the switcher's endonym is Chinese by design. The predicate is the same
  // strip-then-filter one the black-box tests use, not a bare CJK.test on the whole body.
  const endonyms = switcherCjkWords(en);
  const enResidualLines = cjkLines(stripLangSwitcher(en).stripped).filter((l) => !endonyms.includes(l));
  assert.deepEqual(enResidualLines, [], "the render function's en arm carries no interface CJK");
  // ⚠️ This fixture has NO blocking relation, so the section renders ROW 19's `noBlockingRelation`
  // fallback — ⛔ asserting the `blockingHeading` here would fail for a reason that has nothing to do
  // with language (the black-box in-flight test covers the heading, where a relation exists).
  assert.ok(en.includes("Implementing") && en.includes("No cross-task blocking relation.") && en.includes("none"),
    "the render function's en arm renders the English body copy");
  assert.ok(zh.includes("实现中") && zh.includes("无跨任务阻塞关系。") && zh.includes("无"),
    "the render function's zh arm renders the pre-existing Chinese body copy");
  assert.equal(renderLivePage(live, identity), en,
    "omitting `lang` renders the DEFAULT language (en), not a third behaviour");

  await withPage(seedIdle, async (port) => {
    // The absence of a second endpoint: `/live/<anything>` is not a render path for this page. If one
    // is ever added, it must carry the language — this assertion is what makes that addition visible
    // instead of silent.
    const sub = await get(port, "/live/cards");
    assert.equal(sub.status, 404, "there is no /live sub-endpoint (a new one must take `lang`)");
    assert.ok(!sub.body.includes("当前无在飞任务") && !sub.body.includes("No in-flight tasks right now"),
      "the 404 body does not render this page");
  });
});
