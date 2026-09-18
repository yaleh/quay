// @test-group product
// gap-webui-dashboard-body-copy-en-zh — /dashboard 的【正文文案】本地化（正文本地化系列第 1 页，定 pattern）。
//
// 病灶：AC-289~303 把【外壳】（nav/`<title>`/`<h1>`/切换控件）接到了 serve-i18n.ts 的字典，但页面
// **正文**仍是源码里的中文字面量 —— `?lang=en` 下渲染出一个「框是英文、内容是中文」的页面。实测
// （红基线，真实 workspace，curl 去标签后按行数）：`lang=en` 下含 CJK 的文本行 60 条，其中界面文案
// 51 条（正文 46 + 共享外壳 5），其余为用户数据 / 切换控件的 endonym。
//
// 本文件验证（AC4/AC5 的机械判据 + AC2/AC3 的黑盒两态）：
//   • 字典完备且被类型强制：`DASHBOARD_LABELS` 是 `Record<DashboardKey,{en,zh}>`，每键两列非空、
//     en 列无 CJK、zh 列含 CJK 或与 en 逐字相同（见下面 `zhArmOk` 的注释：后者不是放宽，是更强的谓词）。
//   • 取词函数的两条 throw 路径（未知键 / 缺参数）—— 这是硬规则 3b 的那半边：读不懂输入时不得返回
//     与「合格」同形的值。缺参数若静默留 `{cap}`，页面会把自己的模板语法渲染出来，而没有一条
//     「页面上有没有该有的值」的检查会变红。
//   • 黑盒两态：真实 startServer（port 0，⛔ 不探询常驻实例）+ `Cookie: lang=en|zh`，断言 en 下
//     界面 CJK = 0（只余切换控件的 endonym）且 zh 下中文仍在。
//   • **零计数的对照**（硬规则 2）：同一个谓词对 zh 响应干跑一次必须命中——否则「en 下 0 条」可能
//     只是谓词坏了。
//   • AC5：快照路径与旧路径各触发一次（`QUAY_DASHBOARD_SNAPSHOT_DISABLED` 是两者的开关）。
//   • 自动刷新端点 `/dashboard/cards` 也随请求语言——它在页面加载 30 秒后整卡替换 DOM，
//     若那里退回 DEFAULT_LANG，中文页面会在几秒后被英文卡片覆盖，而**页面自身的 HTML 是正确的**，
//     任何只抓一次响应的探针都看不见。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { startServer } from "../src/serve.ts";
import {
  DASHBOARD_LABELS,
  DASHBOARD_KEYS,
  CHROME_LABELS,
  dashboardLabelsFor,
  dashboardLabel,
  fillLabel,
  chromeLabel,
} from "../src/serve-i18n.ts";
import {
  peekDashboardSnapshot,
  DASHBOARD_SNAPSHOT_DISABLED_ENV,
} from "../src/serve-dashboard.ts";
import { readTests } from "../src/observation.ts";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
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

/** The page's VISIBLE text: styles/scripts dropped (they carry no rendered copy and the inline
 *  script embeds source comments), tags stripped, entities decoded. This is the unit the red
 *  baseline was measured in, so the test and the measurement speak the same language. */
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

/** The language switcher's ENDONYM (`中文` / `EN`), which is DELIBERATELY the same in both columns
 *  (serve-i18n.ts ROW 4: a reader who cannot read the current UI language must still be able to
 *  find their own). It is therefore the one Chinese word an English page is SUPPOSED to carry.
 *  Removed before the "no CJK under en" assertion — and the removal is asserted to have hit, so a
 *  regex that silently stopped matching cannot turn that assertion into a tautology.
 *
 *  ⚠️ Both arms of the switcher must be matched: the CURRENT language renders as a `<span>`, the
 *  other as an `<a href="?lang=…">`. An earlier version of this helper matched `<span>` only and
 *  therefore removed the `EN` item while leaving both `中文` items in place — the `hits.length === 2`
 *  assertion below still passed (two spans: desktop + mobile), and only the residual-CJK comparison
 *  exposed it. That is the failure mode this file's count assertion exists to catch, one level in. */
const LANG_SWITCHER_ITEM_RE = /<(?:a|span) class="lang-switcher-item"[^>]*>[\s\S]*?<\/(?:a|span)>/g;
function stripLangSwitcher(body) {
  const hits = (body.match(LANG_SWITCHER_ITEM_RE) ?? []);
  return { stripped: hits.reduce((acc, h) => acc.split(h).join(""), body), hits };
}

/** Chinese lines this PAGE authored — i.e. excluding (a) the switcher's endonym and (b) any line a
 *  NON-dashboard module produced and this page merely echoes.
 *
 *  (b) is the classification AC1/AC2 demand of every residual line, made mechanical: the tests card
 *  renders `observation.readTests()`'s `reason` VERBATIM, and that string is a reader DIAGNOSTIC
 *  about the store ("no verification ledger and no writer wired") — the same class of thing as a
 *  task title, produced by a module this task does not own (it renders on /tests too). It is
 *  therefore read here from the same reader the page read, and lines it accounts for are excluded.
 *  ⛔ This is NOT a blanket exemption: any label this page renders itself is absent from that string
 *  and still fails. The count of what was excluded is asserted alongside, so the exclusion cannot
 *  silently grow to swallow the whole page. */
function pageAuthoredCjk(body, readerText) {
  const reason = String(readerText ?? "").trim();
  const accounted = (line) => line === "中文" || (reason.length > 0 && reason.includes(line));
  return cjkLines(stripLangSwitcher(body).stripped).filter((l) => !accounted(l));
}

// ── the fixture: a real workspace with a REAL task store, ASCII-titled so the only possible CJK in
//    the response is interface copy (a Chinese task title would make the assertion unfalsifiable —
//    data and copy would be indistinguishable, which is exactly the confusion AC1's classification
//    had to resolve by hand). ─────────────────────────────────────────────────────────────────────

let server, port, root, originalCwd, tasksDir;

before(async () => {
  tasksDir = makeTmpDir("dash-i18n-tasks-");
  root = makeTmpDir("dash-i18n-ws-");
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    `providers:\n  native:\n    enabled: true\n    path: "${nativeProviderDir.replaceAll("\\", "\\\\")}"\n    mcp_entry: ["node", "${nativeBin.replaceAll("\\", "\\\\")}", "mcp"]\n    env:\n      QUAY_NATIVE_TASKS_DIR: "${tasksDir.replaceAll("\\", "\\\\")}"\n`,
  );
  fs.writeFileSync(
    path.join(tasksDir, "DASH-A.md"),
    `---\nid: DASH-A\ntitle: alpha task\nstatus: ready\n---\n## Proposal\nascii body\n`,
  );
  fs.writeFileSync(
    path.join(tasksDir, "DASH-B.md"),
    `---\nid: DASH-B\ntitle: beta task\nstatus: todo\n---\n## Proposal\nascii body\n`,
  );
  originalCwd = process.cwd();
  process.chdir(root);
  server = await startServer({ port: 0, host: "127.0.0.1" });
  port = server.address().port;
});

after(async () => {
  server?.dashboardSnapshot?.stop();
  await new Promise((r) => server.close(r));
  if (server?.client) await server.client.close();
  process.chdir(originalCwd);
  if (server) server.client = null;
});

// ── AC4: the dictionary is CLOSED, COMPLETE, and cannot be half-filled ────────────────────────────

test("AC4: DASHBOARD_KEYS and DASHBOARD_LABELS are the same closed set (a key cannot be added to one side only)", () => {
  const roster = [...DASHBOARD_KEYS];
  assert.equal(new Set(roster).size, roster.length, "DASHBOARD_KEYS has no duplicate");
  assert.deepEqual(roster.slice().sort(), Object.keys(DASHBOARD_LABELS).slice().sort(),
    "every declared key has a row and every row has a declared key");
  assert.ok(roster.length >= 50, `the roster is the measured one, not a token stub (got ${roster.length})`);
});

test("AC4: every row has both columns non-empty, the en column carries NO CJK, and the zh column is translated or language-neutral", () => {
  // `zhArmOk` is NOT the plan's "zh 含 CJK 或纯符号" verbatim — it is the STRONGER predicate that
  // the roster actually needs: a zh value with no CJK is allowed ONLY when it is byte-equal to its
  // en value (a genuinely language-neutral token such as the live_state word `running`). An
  // accidentally-English zh prose value therefore still fails, and a plain-English placeholder
  // cannot hide behind "it contains no symbols".
  const zhArmOk = (en, zh) => zh === en || CJK.test(zh);
  const problems = [];
  for (const key of DASHBOARD_KEYS) {
    const { en, zh } = DASHBOARD_LABELS[key];
    if (en.trim() === "") problems.push(`${key}: en is empty`);
    if (zh.trim() === "") problems.push(`${key}: zh is empty`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK (${JSON.stringify(en)})`);
    if (!zhArmOk(en, zh)) problems.push(`${key}: zh is neither translated nor byte-equal to en (${JSON.stringify(zh)})`);
  }
  assert.deepEqual(problems, [], "dictionary rows must satisfy every column rule");
});

test("AC4: the shared-chrome rows (ROW 9) obey the same rules", () => {
  const problems = [];
  for (const [key, { en, zh }] of Object.entries(CHROME_LABELS)) {
    if (en.trim() === "" || zh.trim() === "") problems.push(`${key}: an empty column`);
    if (CJK.test(en)) problems.push(`${key}: en carries CJK`);
    if (!CJK.test(zh)) problems.push(`${key}: zh carries no CJK (a chrome word with no Chinese behind it is suspect)`);
  }
  assert.deepEqual(problems, []);
});

test("AC4: dashboardLabelsFor returns exactly the roster, resolved per language", () => {
  for (const lang of ["en", "zh"]) {
    const t = dashboardLabelsFor(lang);
    assert.deepEqual(Object.keys(t).slice().sort(), [...DASHBOARD_KEYS].slice().sort(), `${lang}: roster is complete`);
    for (const key of DASHBOARD_KEYS) assert.equal(t[key], DASHBOARD_LABELS[key][lang], `${lang}: ${key} resolves to its own column`);
  }
  assert.notDeepEqual(dashboardLabelsFor("en"), dashboardLabelsFor("zh"), "the two languages are not the same table (a both-columns-zh regression)");
});

test("AC4: an unknown key THROWS rather than falling back to English (serve-i18n ROW 8 / 硬规则 3b)", () => {
  assert.throws(() => dashboardLabel("noSuchKey"), /unknown dashboard key/);
  assert.throws(() => chromeLabel("noSuchChromeKey"), /unknown chrome key/);
  // Negative control for the other direction: a REAL key must NOT throw.
  assert.equal(typeof dashboardLabel("loopPulse", "en"), "string");
});

test("AC4: fillLabel throws on a placeholder the caller did not supply — never renders `{cap}` into the page", () => {
  assert.equal(fillLabel("In flight {inFlight} / cap {cap}", { inFlight: 3, cap: 5 }), "In flight 3 / cap 5");
  assert.throws(() => fillLabel("In flight {inFlight} / cap {cap}", { inFlight: 3 }), /\{cap\}/,
    "a missing parameter must be an error, not a page rendering its own template syntax");
  assert.throws(() => dashboardLabel("inFlightCap", "zh", { inFlight: 3 }), /cap/);
  // A template with no placeholders is fine with an empty map — the throw is keyed on the TEMPLATE,
  // not on "the caller passed nothing".
  assert.equal(fillLabel("Loop pulse", {}), "Loop pulse");
});

test("AC4: every interpolated row's placeholders are supplied by at least one real render (no row is dead weight)", () => {
  // The rows that carry `{…}`, and the render path that fills them. If a template gains a second
  // placeholder and its call site is not updated, `fillLabel` throws at RENDER time — this test only
  // pins that the set is non-trivial and that the template syntax is the one `fillLabel` parses.
  const templated = DASHBOARD_KEYS.filter((k) => /\{\w+\}/.test(DASHBOARD_LABELS[k].en));
  assert.ok(templated.length >= 10, `the interpolated rows exist (got ${templated.length})`);
  for (const key of templated) {
    assert.ok(/\{\w+\}/.test(DASHBOARD_LABELS[key].zh), `${key}: both columns carry the placeholder, not just en`);
  }
});

// ── AC2/AC3 black box: the two languages on a real server ────────────────────────────────────────

test("AC2: `Cookie: lang=en` renders /dashboard with ZERO interface CJK — and the same predicate DOES hit on zh (the zero-count control)", async () => {
  const en = await get(port, "/dashboard", { Cookie: "lang=en" });
  assert.equal(en.status, 200);
  const { stripped, hits } = stripLangSwitcher(en.body);
  // The switcher renders FOUR items on every page: desktop + mobile chrome, each carrying the
  // current language (`<span>`) and the other one (`<a href="?lang=…">`). Asserting the count is
  // what makes the removal a fact rather than a hope — a regex that matched only the `<span>` arm
  // passed an earlier version of this check while leaving both 中文 items in the page.
  assert.equal(hits.length, 4, "the four language-switcher items (desktop+mobile × current+other) were located");
  assert.equal(hits.filter((h) => h.includes("中文")).length, 2, "the two 中文 endonyms (desktop + mobile) are among them");
  assert.equal(hits.filter((h) => h.includes(">EN<")).length, 2, "so are the two current-language items");

  const residual = cjkLines(stripped);
  assert.ok(!residual.some((l) => l.includes("中文")),
    "the endonym is GONE after stripping — if it survived, the removal was a no-op and the assertion below is vacuous");
  assert.deepEqual(pageAuthoredCjk(en.body, readTests(root).reason), [],
    "the en page carries interface copy in Chinese; the only Chinese an English page is supposed to carry is the switcher's own 中文 endonym");
  // The exclusion above is not allowed to be a black hole: name exactly what it accounted for.
  assert.ok(residual.length <= 2, `the residual set stays small and enumerated (got ${residual.length}: ${JSON.stringify(residual)})`);

  // ── the control, and it is the half that makes the zero above mean something (硬规则 2) ─────────
  // A predicate that never matches anything would report the same "0" for a broken page and a fixed
  // one. Run the SAME predicate against the zh render: it must find Chinese.
  const zh = await get(port, "/dashboard", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200);
  assert.ok(cjkLines(stripLangSwitcher(zh.body).stripped).length > 20,
    "precondition/control: the same CJK-line predicate finds the Chinese on the zh page");
});

test("AC3: `Cookie: lang=zh` still renders the pre-existing Chinese body copy (the extracted literals did not move)", async () => {
  const zh = await get(port, "/dashboard", { Cookie: "lang=zh" });
  const body = zh.body;
  for (const zhWord of [
    "循环脉搏",        // liveCard title
    "查看 Live →",     // liveCard footer link
    "系统资源",        // sysCard title
    "查看系统状态 →",  // sysCard footer link
    "项目身份",        // identity card title
    "未接入/无数据",   // identity card's null reading
    "任务台账速览",    // taskCard title
    "查看任务列表 →",  // taskCard footer link
    "阶段目标",        // goalCard title
    "查看 Goals →",    // goalCard footer link
    "最近提交",        // commits card title
    "查看 Journal →",  // commits card footer link
    "变更记录",        // section heading
    "工作进展",        // section heading
    "跳到主要内容",    // shared skip link (ROW 9)
    "核心",            // shared mobile-menu group heading (ROW 9)
    "中文",            // the switcher's endonym (ROW 4 — deliberately unchanged)
  ]) {
    assert.ok(body.includes(zhWord), `zh render keeps the pre-existing literal ${JSON.stringify(zhWord)}`);
  }
  // …and the SAME words are ABSENT under en, so each zh assertion above has a counterpart that can
  // fail (a "present" assertion with no "absent" arm passes on a page that renders both languages).
  const en = await get(port, "/dashboard", { Cookie: "lang=en" });
  for (const zhWord of ["循环脉搏", "查看 Live →", "系统资源", "项目身份", "任务台账速览", "阶段目标", "变更记录", "跳到主要内容", "核心"]) {
    assert.ok(!en.body.includes(zhWord), `en render must not carry ${JSON.stringify(zhWord)}`);
  }
  for (const enWord of ["Loop pulse", "View Live →", "System resources", "Project identity", "Task ledger", "Stage goals", "Change log", "Skip to main content", "Core"]) {
    assert.ok(en.body.includes(enWord), `en render carries ${JSON.stringify(enWord)}`);
  }
});

// ── AC5: BOTH render paths (snapshot hit / snapshot miss) ─────────────────────────────────────────

test("AC5: the LEGACY path (snapshot absent — QUAY_DASHBOARD_SNAPSHOT_DISABLED=1) renders en with no interface CJK", async () => {
  const prev = process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV];
  process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV] = "1";
  try {
    assert.equal(peekDashboardSnapshot(root), null, "precondition: the switch really made the snapshot lookup miss");
    const en = await get(port, "/dashboard", { Cookie: "lang=en" });
    assert.equal(en.status, 200);
    const { hits } = stripLangSwitcher(en.body);
    assert.equal(hits.length, 4, "the four switcher items were located (see the AC2 test for why the count is asserted)");
    assert.deepEqual(pageAuthoredCjk(en.body, readTests(root).reason), [], "the legacy render path is localized too");
  } finally {
    if (prev === undefined) delete process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV];
    else process.env[DASHBOARD_SNAPSHOT_DISABLED_ENV] = prev;
  }
});

test("AC5: the SNAPSHOT path (production default) renders en with no interface CJK", async () => {
  // The startup build must have landed — a timeout here would make the assertion below test the
  // LEGACY path a second time while claiming to test the snapshot path.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && peekDashboardSnapshot(root) == null) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(peekDashboardSnapshot(root) != null, "precondition: a snapshot exists (otherwise this duplicates the legacy test)");
  const en = await get(port, "/dashboard", { Cookie: "lang=en" });
  assert.equal(en.status, 200);
  const { hits } = stripLangSwitcher(en.body);
  assert.equal(hits.length, 4, "the four switcher items were located (see the AC2 test for why the count is asserted)");
  assert.deepEqual(pageAuthoredCjk(en.body, readTests(root).reason), [], "the snapshot render path is localized too");
});

// ── the auto-refresh endpoint: the language must survive the 30 s card swap ───────────────────────

test("the /dashboard/cards payload carries the REQUEST's language, not the default", async () => {
  const zh = await get(port, "/dashboard/cards", { Cookie: "lang=zh" });
  assert.equal(zh.status, 200);
  const zhPayload = JSON.parse(zh.body);
  assert.ok(zhPayload.liveCard.includes("循环脉搏"), "the zh poll re-renders the zh card title");
  assert.ok(zhPayload.taskCard.includes("任务台账速览"), "the zh poll re-renders the zh task card");

  const en = await get(port, "/dashboard/cards", { Cookie: "lang=en" });
  const enPayload = JSON.parse(en.body);
  assert.ok(enPayload.liveCard.includes("Loop pulse"), "the en poll re-renders the en card title");
  assert.ok(!enPayload.liveCard.includes("循环脉搏"), "the en poll does not put the zh title back into an en page");
  // The whole payload, minus the endonym-bearing chrome, is CJK-free: this is the surface that
  // REPLACES the rendered cards, so a leak here is invisible to a single-response probe.
  const joined = Object.entries(enPayload).filter(([k]) => k !== "sysRaw").map(([, v]) => JSON.stringify(v)).join("\n");
  // Same provenance classification as the page assertions: the cards payload embeds the tests
  // card's reader-produced diagnostic verbatim, which is not copy this page authored.
  assert.deepEqual(pageAuthoredCjk(joined, readTests(root).reason), [], "the en cards payload carries no page-authored CJK");
});
