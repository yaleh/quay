// chrome.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// Shared CHROME words: nav (ROW 1/2), page names (ROW 3), language switcher (ROW 4), shared chrome words (ROW 9).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";

/** The 15 nav views, in the order the site nav renders them. Closed by construction: every consumer
 *  indexes `NAV_LABELS` by this union, so a 16th view cannot reach the nav without a word for it in
 *  every column (ROW 2). */
export const NAV_KEYS = [
  "dashboard", "tasks",
  "live", "board", "system", "manager", "needs-human",
  "journal", "git", "tests", "sessions",
  "adr", "goal", "doc", "architecture",
] as const;

export type NavKey = (typeof NAV_KEYS)[number];

/** The nav label dictionary — see ROW 1/ROW 2. The `en` column is the pre-AC-289 live baseline and
 *  must not be re-worded by a later change; the `zh` column must stay non-empty and must not carry
 *  the ASCII literal "Dashboard" (see the WHY note). */
export const NAV_LABELS: Record<NavKey, { en: string; zh: string }> = {
  dashboard: { en: "Dashboard", zh: "仪表盘" },
  tasks: { en: "Tasks", zh: "任务" },
  live: { en: "Live", zh: "实时" },
  board: { en: "Board", zh: "看板" },
  system: { en: "System", zh: "系统" },
  manager: { en: "Manager", zh: "管理器" },
  "needs-human": { en: "Needs Human", zh: "待人工" },
  journal: { en: "Journal", zh: "日志" },
  git: { en: "Git History", zh: "Git 历史" },
  tests: { en: "Tests", zh: "测试" },
  sessions: { en: "Sessions", zh: "会话" },
  adr: { en: "ADRs", zh: "架构决策" },
  goal: { en: "Goals", zh: "目标" },
  doc: { en: "Docs", zh: "文档" },
  architecture: { en: "Architecture", zh: "架构" },
};

/** Is `value` one of the 15 nav keys? Uses `hasOwnProperty` (not `in`) so inherited object members
 *  (`"constructor"`, `"toString"`) are NOT accepted as keys — `NAV_LABELS["constructor"]` would
 *  otherwise return a function and be rendered into the nav as markup. */
export function isNavKey(value: unknown): value is NavKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NAV_LABELS, value);
}

/** The label for ONE nav view in `lang`. Unknown key ⇒ THROW (ROW 2) — an entry that silently
 *  rendered English would be indistinguishable from a view that was never wired to the dictionary. */
export function navLabel(key: NavKey, lang: Lang = DEFAULT_LANG): string {
  const entry: { en: string; zh: string } | undefined = isNavKey(key) ? NAV_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown nav key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return entry[lang];
}

/** The whole nav roster as a key→label map for one language. This is what the render functions take
 *  once per page instead of re-reading `NAV_LABELS` per item. */
export function navLabelsFor(lang: Lang = DEFAULT_LANG): Record<NavKey, string> {
  const out = {} as Record<NavKey, string>;
  for (const key of NAV_KEYS) out[key] = NAV_LABELS[key][lang];
  return out;
}

/** Page-chrome names, keyed by the English token `pageTitle` receives — see ROW 3.
 *
 *  `Live — loop activity` is the FULL token /live passes to `pageTitle` (the em dash included —
 *  it must be byte-equal to the call site or the lookup misses and the page renders its English
 *  title under zh, which is exactly the `title-unchanged` arm of AC-291's criterion).
 *  `Live` is the same page's OWN name token, used for its `<h1>`.
 *
 *  ⛔ The zh column of neither entry may carry the ASCII literal "Live": AC-291's criterion fails
 *  the page on that literal inside the nav region, and the page's own `<title>` difference is the
 *  second half of the same criterion — a value that merely LOOKS translated would satisfy
 *  "non-empty" while leaving the assertion red (see the WHY note above). */
const PAGE_LABELS: Record<string, { en: string; zh: string }> = {
  Dashboard: { en: "Dashboard", zh: "仪表盘" },
  // AC-290 (/tasks list page): this page's own TWO tokens. `Tasks` is the token `pageTitle`
  // receives; it is spelled like the nav KEY `tasks`, but it is a separate lookup on purpose — the
  // nav label resolves through `NAV_LABELS` (shared chrome, ROW 1) while this resolves through
  // `pageNameFor` (this page's chrome, ROW 3), and ROW 3's whole point is that the two are peers.
  // `"task list"` is the token the <h1> and the mobile header carry. `en` is the identity for both,
  // so the en baseline — the bytes the goal criterion reads off the live page — cannot move.
  Tasks: { en: "Tasks", zh: "任务" },
  "task list": { en: "task list", zh: "任务列表" },
  // AC-291 (/live page): this page's own TWO tokens — the full `pageTitle` token (em dash included,
  // it must be byte-equal to the call site) and the token its `<h1>` carries. See the block comment
  // above for why neither zh value may carry the ASCII literal "Live".
  "Live — loop activity": { en: "Live — loop activity", zh: "实时 — 循环活动" },
  Live: { en: "Live", zh: "实时" },
  // AC-292 (/board page): this page's own TWO tokens, same shape as AC-291's pair. `Board — 三源
  // join 看板` is the FULL token `serve-board.ts` passes to `pageTitle` — em dash and the
  // (already-Chinese) subtitle included, because AC-292's third arm compares this page's `<title>`
  // against its en baseline and a token that is not byte-equal to the call site misses the lookup
  // (that miss IS the `title-unchanged` arm). `Board` is the token the `<h1>` carries; it is spelled
  // like the nav KEY `board`, but like AC-290's `Tasks` it is a separate lookup on purpose — the nav
  // label resolves through `NAV_LABELS` (shared chrome, ROW 1) while this resolves through
  // `pageNameFor` (this page's chrome, ROW 3).
  // Neither zh value may carry the ASCII literal "Board": AC-292's second arm fails the page on that
  // literal inside the nav region, and "看板 — 三源 join 看板" satisfies "non-empty" without it.
  //
  // ⚠️ RE-KEYED by gap-webui-board-body-copy-en-zh (2026-09-18). The token used to read
  // `Board — 三源 join 看板` — i.e. this page's own `<title>` rendered a CHINESE subtitle verbatim
  // under the DEFAULT (en) locale, which is precisely the "frame is English, content is not" defect
  // the body-copy series exists to remove. AC-292 could not see it: ROW 3's `en` column is the
  // identity for every token, so no dictionary edit can move an en baseline, and AC-292's third arm
  // only asserts zh ≠ en. Fixing it therefore REQUIRES changing the token ITSELF to English (that is
  // the AC-291/AC-293/AC-296/AC-298 shape — a `pageTitle` token is the full English string, subtitle
  // included). The zh column is unchanged BYTE FOR BYTE, which is what keeps `lang=zh` output
  // identical (this task's AC3) and AC-292's live criterion green on both of its title arms
  // (`!includes("Board")` and `t_zh ≠ t_en`).
  "Board — three-source join": { en: "Board — three-source join", zh: "看板 — 三源 join 看板" },
  Board: { en: "Board", zh: "看板" },
  // AC-293 (/system page): this page's own token, same shape as AC-291's and AC-292's.
  // ⚠️ ROW 14 (gap-webui-system-body-copy-en-zh, 2026-09-18) RETIRED this page's former second row,
  // `"System — 系统状态"` — the pre-joined composite the page used to hand to `pageTitle`. The page
  // now passes the bare `System` token and appends ROW 14's `pageSubtitle` OUTSIDE it, so the name
  // and the subtitle are owned by two tables rather than by one string. ROW 14 ③ has the reasoning
  // (a pre-localized composite makes THIS table's zh lookup MISS — the title would render correctly
  // by falling through the dictionary instead of by being found in it). ⛔ The zh value `系统 — 系统状态`
  // did NOT disappear: it is now `pageNameFor("System", "zh")` + ` — ` + `SYSTEM_LABELS.pageSubtitle.zh`,
  // and the zh response is byte-identical before and after the split.
  // `System` is the token the `<h1>`'s page NAME carries; it is spelled like the nav KEY `system`, but
  // like AC-290's `Tasks` and AC-292's `Board` it is a separate lookup on purpose — the nav label
  // resolves through `NAV_LABELS` (shared chrome, ROW 1) while this resolves through `pageNameFor`
  // (this page's chrome, ROW 3).
  // The zh value may not carry the ASCII literal "System": AC-293's second arm fails the page on
  // that literal inside the nav region, and "系统" satisfies "non-empty" without it.
  System: { en: "System", zh: "系统" },
  // AC-294 (/manager page): this page's own token — and, uniquely among the pages wired so far,
  // ONE entry serves BOTH call sites. /manager's `<title>` is `pageTitle("Manager / Outer / Inner")`
  // and its `<h1>` is that same page name plus the ` — 三层状态` subtitle, so unlike AC-291's /
  // AC-292's / AC-293's two-entry pairs there is no separate short token to register. The key is the
  // FULL string `pageTitle` receives — spaces and slashes included; registering the bare `Manager`
  // would miss the lookup and leave the title English, which IS the `title-unchanged` arm of
  // AC-294's criterion.
  // Neither zh value may carry the ASCII literal "Manager": AC-294's second arm fails the page on
  // that literal inside the nav region — where this page's CURRENT item label comes from
  // NAV_LABELS's `manager` row (「管理器」, ROW 1) — and "管理器 / 外层 / 内层" satisfies "non-empty"
  // without it. Note the nav label and this page name are separate lookups on purpose: the nav
  // resolves through `navLabel` (shared chrome, ROW 1) while this resolves through `pageNameFor`
  // (this page's chrome, ROW 3), which is ROW 3's whole point.
  "Manager / Outer / Inner": { en: "Manager / Outer / Inner", zh: "管理器 / 外层 / 内层" },
  // AC-296 (/journal page): this page's own TWO tokens, same shape as AC-291's / AC-292's /
  // AC-293's pairs. `Journal — recent loop record` is the FULL token `serve-live.ts` passes to
  // `pageTitle` — the em dash and the whole phrase included, byte-equal to that call site, because
  // AC-296's third arm compares this page's `<title>` against its en baseline and a token that is
  // not byte-equal MISSES the lookup (that miss IS the `title-unchanged` arm, i.e. the exact defect
  // AC-296 exists to remove — registering the bare `Journal` here would leave the title English).
  // `Journal` is the token the `<h1>` carries; it is spelled like the nav KEY `journal`, but like
  // AC-290's `Tasks` it is a separate lookup on purpose — the nav label resolves through
  // `NAV_LABELS` (shared chrome, ROW 1) while this resolves through `pageNameFor` (this page's
  // chrome, ROW 3).
  // Neither zh value may carry the ASCII literal "Journal": AC-296's second arm fails the page on
  // that literal inside the nav region — where this page's CURRENT item label comes from
  // NAV_LABELS's `journal` row (「日志」, ROW 1) — and "日志 — 循环最近记录" satisfies "non-empty"
  // without it.
  "Journal — recent loop record": { en: "Journal — recent loop record", zh: "日志 — 循环最近记录" },
  Journal: { en: "Journal", zh: "日志" },
  // AC-295 (/needs-human page): this page's own token — and, like AC-294's /manager row and unlike
  // AC-291's / AC-292's / AC-293's / AC-296's two-entry pairs, ONE entry serves BOTH call sites.
  // /needs-human's `<title>` is `pageTitle("Needs Human")` and its `<h1>` is `pageNameFor("Needs
  // Human")` followed by the ` — 待人类决定` subtitle, so there is no separate short token to
  // register. The key is the FULL string `pageTitle` receives — the internal SPACE included;
  // registering the bare `Needs`, or the nav key `needs-human`, would MISS the lookup and leave the
  // title English, which IS the `title-unchanged` arm of AC-295's criterion (that miss is the exact
  // defect AC-295 exists to remove).
  // Neither zh value may carry the ASCII literal "Needs Human": AC-295's second arm fails the page on
  // that literal inside the nav region — where this page's CURRENT item label comes from NAV_LABELS's
  // `needs-human` row (「待人工」, ROW 1) — and "待人工" satisfies "non-empty" without it. Note the nav
  // label and this page name stay separate lookups: the nav resolves through `navLabel` (shared
  // chrome, ROW 1) while this resolves through `pageNameFor` (this page's chrome, ROW 3). Both land
  // on the same zh word here, but that is a coincidence of vocabulary, ⛔ not a shared source — a
  // later re-wording of one must not be assumed to move the other.
  "Needs Human": { en: "Needs Human", zh: "待人工" },
  // AC-297 (/git-history page): this page's own tokens — FOUR of them, because `renderGitHistoryPage`
  // has TWO view branches (`"git"`, the default, and `?view=task`) and each branch carries its OWN
  // `<title>` token. The two title keys therefore differ only in their subtitle, and a branch whose
  // token is not registered renders its English title under zh — which IS the `title-unchanged` arm
  // of AC-297's criterion (that miss is the exact defect AC-297 exists to remove). ⚠️ The criterion
  // requests the bare `/git-history`, i.e. the DEFAULT branch: registering only the task view's token
  // would leave it red.
  //   `"Git history — vertical commit timeline"` — the default (git) view's FULL `pageTitle` token,
  //     em dash and whole phrase included, byte-equal to the `serve-git.ts` call site.
  //   `"Git history — 任务分组"` — the task view's FULL `pageTitle` token, same byte-equality rule
  //     (its subtitle was already Chinese in the en baseline; only `Git history` moves).
  //   `"Git History"` — the token BOTH branches' `<h1>` carries. It has a CAPITAL H: the `<h1>` is
  //     spelled like the nav label while the two `<title>` tokens above are lowercase, and these are
  //     separate lookups on purpose — registering the capitalised key does NOT serve the lowercase
  //     title tokens, and vice versa.
  //   `"git history"` — the lowercase token the MOBILE header carries, i.e. the AC-290 `"task list"`
  //     shape (a page's own chrome token that is not a `pageTitle` token). It renders into
  //     `<span class="mobile-header-page">`, which sits BEFORE the first `<nav>` and is therefore
  //     neither inside the criterion's nav region nor a nav label.
  // Neither zh value may carry the ASCII literal "Git History" or "Git history": AC-297's criterion
  // fails the page on the capitalised literal inside the nav region — where this page's CURRENT item
  // label comes from NAV_LABELS's `git` row (「Git 历史」, ROW 1) — and the lowercase literal is what
  // the en baseline's two title tokens carry, i.e. what the criterion's `title-unchanged` arm
  // compares the zh title against. 「Git 历史」 satisfies "non-empty" without either.
  "Git history — vertical commit timeline": { en: "Git history — vertical commit timeline", zh: "Git 历史 — 提交纵向时间轴" },
  "Git history — 任务分组": { en: "Git history — 任务分组", zh: "Git 历史 — 任务分组" },
  "Git History": { en: "Git History", zh: "Git 历史" },
  "git history": { en: "git history", zh: "Git 历史" },
  // AC-298 (/tests page) registered this page's own tokens. ⚠️ gap-webui-tests-body-copy-en-zh
  // RE-KEYED them: the COMPOSITE row `"Tests — 验证轮记录"` is RETIRED, and the page now passes the
  // BARE `Tests` token (below) with the subtitle appended from ROW 20 (`pageSubtitle`).
  //
  // WHY THE COMPOSITE ROW COULD NOT BE KEPT — and why this is not a style preference: `pageNameFor`
  // returns its argument UNCHANGED for `en` (ROW 3's contract, "en is the identity for every token,
  // so the en baseline cannot drift"). A composite token therefore renders its OWN (Chinese) bytes
  // under `lang=en`, and its `en` column is dead code that no lookup ever reads — i.e. the row was
  // structurally incapable of moving the en `<title>`/`<h1>` off Chinese, which is precisely the
  // defect the body-copy series exists to remove. The first fix attempt (AC-298) read "register the
  // bare `Tests` would leave the title English" as a REASON TO KEEP the composite; measured against
  // `/tests?lang=en` the composite IS the English-rendering defect. Same re-key, same reasoning, as
  // ROW 14 ③ (/system) and ROW 15 (/sessions) before it.
  // `tests` is the lowercase token the MOBILE header carries, i.e. the AC-290 `"task list"` /
  // AC-297 `"git history"` shape (a page's own chrome token that is not a `pageTitle` token). It
  // renders into `<span class="mobile-header-page">`, which sits BEFORE the first `<nav>` and is
  // therefore neither inside the criterion's nav region nor a nav label. It is spelled like the nav
  // KEY `tests`, but it is a separate lookup on purpose — the nav label resolves through
  // `NAV_LABELS` (shared chrome, ROW 1) while this resolves through `pageNameFor` (this page's
  // chrome, ROW 3), and ROW 3's whole point is that the two are peers.
  // Neither zh value may carry the ASCII literal "Tests": AC-298's second arm fails the page on that
  // literal inside the nav region — where this page's CURRENT item label comes from NAV_LABELS's
  // `tests` row (「测试」, ROW 1) — and the lowercase literal is what the en baseline's `<title>` and
  // `<h1>` carry, i.e. what the criterion's `title-unchanged` arm compares the zh title against.
  // 「测试」 satisfies "non-empty" without either literal.
  // ⚠️ `Tests` (capitalised) is the token `pageTitle` AND the `<h1>` receive; `tests` (lowercase) is
  // the mobile-header token. Both resolve to 「测试」 in zh — that is ROW 3's peer-ness, not a
  // duplicate: a later re-wording of the page NAME must not silently move the mobile header label.
  Tests: { en: "Tests", zh: "测试" },
  tests: { en: "tests", zh: "测试" },
  // ⚠️ `/tests/file` IS A DISTINCT ROUTE IN THE SAME FILE, and its `<h1>` carried the Chinese page
  // name `测试文件` with NO token to resolve through. ROW 20 explains why this file's two pages are
  // one task's business (the sessions precedent). ⛔ Its nav / `<html lang>` / `<title>` are NOT
  // wired by this row: those are CHROME (the AC-290~303 family) and switching them would move the
  // lang=zh baseline this task diffs — the same boundary ROW 15 ⑥ drew for `/session/<id>`.
  "Test file": { en: "Test file", zh: "测试文件" },
  // AC-299 (/sessions page) registered this page's own tokens. ⚠️ gap-webui-sessions-body-copy-en-zh
  // RE-KEYED them: the two COMPOSITE rows `"Sessions — 会话观测"` / `"Sessions — 会话观测（运行中 +
  // 已结束）"` are RETIRED, and the page now passes the BARE `Sessions` token (below) with the
  // subtitle appended from ROW 15 (`pageSubtitle` / `h1Subtitle`).
  //
  // WHY THE COMPOSITE ROWS COULD NOT BE KEPT — and why this is not a style preference: `pageNameFor`
  // returns its argument UNCHANGED for `en` (ROW 3's contract, "en is the identity for every token,
  // so the en baseline cannot drift"). A composite token therefore renders its OWN (Chinese) bytes
  // under `lang=en`, and its `en` column is dead code that no lookup ever reads — i.e. the row was
  // structurally incapable of localizing the page it named. Splitting the token is the only shape in
  // which BOTH languages are read from a table. The retired rows' zh values survive byte-for-byte as
  // ROW 15's subtitles (`会话观测` / `会话观测（运行中 + 已结束）`), so `lang=zh` does not move.
  //   `Sessions` — the token `serve-sessions.ts` now passes to `pageTitle` and `pageNameFor`: the
  //     page's NAME alone, with NO subtitle (the subtitles are ROW 15's, appended outside). It is a
  //     peer of the other pages' name entries (`System`, `Board`, `Journal`, …).
  //   `sessions` — the lowercase token the MOBILE header carries, i.e. the AC-290 `"task list"` /
  //     AC-297 `"git history"` / AC-298 `tests` shape (a page's own chrome token that is not a
  //     `pageTitle` token). It renders into `<span class="mobile-header-page">`, which sits BEFORE
  //     the first `<nav>` and is therefore neither inside the criterion's nav region nor a nav label.
  //     It is spelled identically to the nav KEY `sessions`, but it is a separate lookup on purpose:
  //     the nav label resolves through `NAV_LABELS` (shared chrome, ROW 1) while this resolves through
  //     `pageNameFor` (this page's chrome, ROW 3), and ROW 3's whole point is that the two are peers.
  // Neither zh value may carry the ASCII literal "Sessions" or "sessions": AC-299's second arm fails
  // the page on that literal inside the nav region — where this page's CURRENT item label comes from
  // NAV_LABELS's `sessions` row (「会话」, ROW 1) — and the same literal is what the en baseline's
  // `<title>` and `<h1>` carry, i.e. what the criterion's `title-unchanged` arm compares the zh title
  // against. 「会话」 satisfies "non-empty" without either literal.
  Sessions: { en: "Sessions", zh: "会话" },
  sessions: { en: "sessions", zh: "会话" },
  // AC-300 (/adr page): this page's own TWO tokens — and they differ ONLY IN CASE, which is why
  // they are two independent lookups rather than one.
  //   `ADRs` — the token `serve-adr.ts` passes to `pageTitle`, which is ALSO the token its `<h1>`
  //     carries (the two call sites happen to be byte-equal here, so unlike AC-291's / AC-292's /
  //     AC-293's / AC-296's / AC-298's / AC-299's two- or three-entry pairs, ONE entry serves both).
  //     ⚠️ The `<h1>` is a DYNAMIC string — `<h1>${pageNameFor("ADRs", lang)} (${adrs.length})</h1>`.
  //     Only this constant part goes through the dictionary; the record count is interpolated raw.
  //     Registering a finished string such as `"ADRs (36)"` would both go stale as ADRs are added and
  //     be a lookup miss (i.e. an English `<h1>` under zh) — the exact defect AC-300 removes.
  //   `adrs` — the LOWERCASE token the MOBILE header carries, i.e. the AC-290 `"task list"` /
  //     AC-297 `"git history"` / AC-298 `tests` / AC-299 `sessions` shape (a page's own chrome token
  //     that is not a `pageTitle` token). It renders into `<span class="mobile-header-page">`, which
  //     sits BEFORE the first `<nav>` and is therefore neither inside the criterion's nav region nor
  //     a nav label — AC-300's AC1b asserts it anyway, deliberately stricter than AC-291's landed
  //     form, so that "this page's own chrome" switches as a whole.
  // ⚠️ CASE IS PART OF THE KEY. `pageNameFor` is an EXACT-token lookup, so `ADRs` does NOT serve
  //     `adrs` and vice versa: dropping either entry leaves exactly one of the two sites English,
  //     and which one is a question only the call sites answer. ⛔ Do not "merge the duplicate".
  // Neither zh value may carry the ASCII literal "ADRs"/"adrs" in ANY case: AC-300's criterion fails
  //     the page on that literal inside the nav region — where this page's CURRENT item label comes
  //     from NAV_LABELS's `adr` row (「架构决策」, ROW 1) — and the same literal is what the en
  //     baseline's `<title>` and `<h1>` carry, i.e. what the criterion's `title-unchanged` arm
  //     compares the zh title against. 「架构决策」 satisfies "non-empty" without it. The two entries
  //     landing on the same zh word is a coincidence of vocabulary, ⛔ not a shared source — a later
  //     re-wording of one must not be assumed to move the other (same note as AC-295's row).
  ADRs: { en: "ADRs", zh: "架构决策" },
  adrs: { en: "adrs", zh: "架构决策" },
  // AC-301 (/goal page): this page's own TWO tokens, and — like AC-300's `ADRs`/`adrs` pair, the
  // family's other case-split — they differ ONLY IN CASE, so they are two INDEPENDENT lookups.
  //   `Goals` — the token `serve-goal.ts` passes to `pageTitle` AND uses as the `<h1>`'s constant
  //     prefix AND renders as the tab-nav label. Three call sites, ONE entry, because all three are
  //     byte-equal here (the AC-294/AC-295/AC-298/AC-300 one-entry shape).
  //     ⚠️ The `<h1>` is a DYNAMIC string — `<token> — <subtitle> (<n>)`. Only this constant prefix
  //     goes through the dictionary; the tab subtitle and the row count are interpolated raw.
  //     Registering a finished string such as `"Goals — 阶段目标 (24)"` would both go stale as goals
  //     are added and be a lookup miss (i.e. an English `<h1>` under zh) — the exact defect AC-301
  //     removes.
  //   `goals` — the LOWERCASE token the MOBILE header carries, i.e. the AC-290 `"task list"` /
  //     AC-297 `"git history"` / AC-298 `tests` / AC-299 `sessions` / AC-300 `adrs` shape (a page's
  //     own chrome token that is not a `pageTitle` token). It renders into
  //     `<span class="mobile-header-page">`, which sits BEFORE the first `<nav>` and is therefore
  //     neither inside the criterion's nav region nor a nav label — AC-301's AC1b asserts it anyway,
  //     deliberately stricter than AC-291's landed form, so that "this page's own chrome" switches
  //     as a whole.
  // ⚠️ CASE IS PART OF THE KEY. `pageNameFor` is an EXACT-token lookup, so `Goals` does NOT serve
  //     `goals` and vice versa: dropping either entry leaves exactly one of the two sites English,
  //     and which one is a question only the call sites answer. ⛔ Do not "merge the duplicate".
  // Neither zh value may carry the ASCII literal "Goals"/"goals" in ANY case: AC-301's criterion
  //     fails the page on that literal inside the nav region — where this page's CURRENT item label
  //     comes from NAV_LABELS's `goal` row (「目标」, ROW 1) — and the same literal is what the en
  //     baseline's `<title>` and `<h1>` carry, i.e. what the criterion's `title-unchanged` arm
  //     compares the zh title against. 「目标」 satisfies "non-empty" without it. The two entries
  //     landing on the same zh word (and on the same word as the nav row) is a coincidence of
  //     vocabulary, ⛔ not a shared source — a later re-wording of one must not be assumed to move
  //     the others (same note as AC-295's and AC-300's rows).
  Goals: { en: "Goals", zh: "目标" },
  goals: { en: "goals", zh: "目标" },
  // AC-302 (/doc list page): this page's own THREE tokens — ⚠️ three, not the family's usual two
  // (AC-300/AC-301's `ADRs`/`adrs` and `Goals`/`goals` pairs), because /doc's `<title>` token and its
  // `<h1>` constant prefix are DIFFERENT strings. ⛔ Do not copy the two-token shape.
  //   `Docs` — the token `serve-doc.ts` passes to `pageTitle`. ⚠️ It is NOT the `<h1>`'s prefix
  //     (that is `Managed documents`, below) and NOT the nav's current item (that resolves through
  //     NAV_LABELS's `doc` row, 「文档」, ROW 1 — shared chrome, already in place before this task).
  //     Registering only the other two would leave exactly this site English, which IS the
  //     `title-unchanged` arm of AC-302's criterion.
  //   `docs` — the LOWERCASE token the MOBILE header carries, i.e. AC-290's `"task list"` / AC-297's
  //     `"git history"` / AC-298's `tests` / AC-299's `sessions` / AC-300's `adrs` / AC-301's `goals`
  //     shape. It renders into `<span class="mobile-header-page">`, which sits BEFORE the first
  //     `<nav>` and is therefore neither inside the criterion's nav region nor a nav label; AC-302's
  //     AC1b asserts it anyway, so that "this page's own chrome" switches as a whole.
  //   `Managed documents` — the `<h1>`'s CONSTANT prefix. ⚠️ The `<h1>` is a DYNAMIC string —
  //     `<prefix> (<n>)`. Only this prefix goes through the dictionary; the row count is interpolated
  //     raw at the call site. Registering a finished string such as `"Managed documents (1)"` would
  //     both go stale as documents are added and be a lookup miss (i.e. an English `<h1>` under zh) —
  //     the exact defect AC-302 removes.
  // ⚠️ CASE IS PART OF THE KEY. `pageNameFor` is an EXACT-token lookup, so `Docs` does NOT serve
  //     `docs` and vice versa: collapsing them would leave one of the two sites English — and, worse,
  //     would move the en baseline of the mobile header from `docs` to `Docs` (AC-302's AC2 reddens
  //     on exactly that). ⛔ Do not "merge the duplicate".
  // Neither zh value may carry the ASCII literal "Docs"/"docs" in ANY case: AC-302's criterion fails
  //     the page on that literal inside the nav region — where this page's CURRENT item label comes
  //     from NAV_LABELS's `doc` row (「文档」, ROW 1) — and the same literal is what the en baseline's
  //     `<title>` carries, i.e. what the criterion's `title-unchanged` arm compares the zh title
  //     against. 「文档」/「托管文档」 satisfy "non-empty" without it. The `Docs` entry landing on the
  //     same zh word as the nav row (and as its own lowercase peer) is a coincidence of vocabulary,
  //     ⛔ not a shared source — a later re-wording of one must not be assumed to move the others
  //     (same note as AC-295's / AC-300's / AC-301's rows).
  Docs: { en: "Docs", zh: "文档" },
  docs: { en: "docs", zh: "文档" },
  "Managed documents": { en: "Managed documents", zh: "托管文档" },
  // AC-303 (/architecture page): this page's own THREE tokens — the AC-302 count, for the same
  //   reason (⛔ do not copy the family's usual two): the `<title>` token, the `<h1>`'s name token and
  //   the mobile header's label are three DIFFERENT strings.
  //   `Architecture — 系统组件图` — the FULL token `serve-architecture.ts` passes to `pageTitle`, em
  //     dash and the (already-Chinese) subtitle included, byte-equal to that call site. `pageNameFor`
  //     is an EXACT-token lookup, so registering only the bare `Architecture` would leave this page's
  //     `<title>` English while the shared nav bar switched — i.e. exactly the `title-unchanged` arm
  //     of AC-303's criterion, the defect this task exists to remove. ⚠️ This key is NOT reused by the
  //     `<h1>`: the two strings differ by the trailing subtitle, so the title entry does not serve it
  //     and vice versa. (Same shape as AC-292's `Board — 三源 join 看板` / `Board`, AC-293's
  //     `System — 系统状态` / `System` and AC-298's `Tests — 验证轮记录`.)
  //   `Architecture` — the token the page's `<h1>` carries, i.e. the page NAME with the subtitle
  //     appended raw at the call site. It is spelled like the nav KEY `architecture`, but it is a
  //     separate lookup on purpose — the nav label resolves through `NAV_LABELS` (shared chrome,
  //     ROW 1, 「架构」, already in place before this task) while this resolves through `pageNameFor`
  //     (this page's chrome, ROW 3), and ROW 3's whole point is that the two are peers.
  //   `architecture` — the LOWERCASE token the MOBILE header carries, i.e. the AC-290 `"task list"` /
  //     AC-297 `"git history"` / AC-298 `tests` / AC-299 `sessions` / AC-300 `adrs` / AC-301 `goals` /
  //     AC-302 `docs` shape (a page's own chrome token that is not a `pageTitle` token). It renders
  //     into `<span class="mobile-header-page">`, which sits BEFORE the first `<nav>` and is therefore
  //     neither inside the criterion's nav region nor a nav label; AC-303's AC1b asserts it anyway, so
  //     that "this page's own chrome" switches as a whole. ⚠️ This is the deliberately STRICTER
  //     reading: AC-291 (`/live`) and AC-292 (`/board`) left their mobile page label English, while
  //     AC-302 (`/doc`) wired it — this task follows AC-302, because GOAL-024's scope is "this page's
  //     own UI shell copy really changes under zh". Recorded as a judgement, not a derivation.
  // ⚠️ CASE IS PART OF THE KEY. `pageNameFor` is an EXACT-token lookup, so `Architecture` does NOT
  //     serve `architecture` and vice versa: collapsing them would leave one of the two sites English
  //     — and, worse, would move the en baseline of the mobile header from `architecture` to
  //     `Architecture`. ⛔ Do not "merge the duplicate".
  // Neither zh value may carry the ASCII literal `Architecture`/`architecture` in ANY case: AC-303's
  //     criterion fails the page on that literal inside the nav region — where this page's CURRENT
  //     item label comes from NAV_LABELS's `architecture` row (「架构」, ROW 1) — and the same literal
  //     is what the en baseline's `<title>` and `<h1>` carry, i.e. what the criterion's
  //     `title-unchanged` arm compares the zh title against. 「架构」 satisfies "non-empty" without it.
  //     The two entries landing on the same zh word (and on the same word as the nav row) is a
  //     coincidence of vocabulary, ⛔ not a shared source — a later re-wording of one must not be
  //     assumed to move the others (same note as AC-295's / AC-300's / AC-301's / AC-302's rows).
  //
  // ⚠️ RE-KEYED by gap-webui-architecture-body-copy-en-zh (2026-09-18). The token used to read
  // `Architecture — 系统组件图` — i.e. this page's own `<title>` rendered a CHINESE subtitle verbatim
  // under the DEFAULT (en) locale, which is precisely the "frame is English, content is not" defect
  // the body-copy series exists to remove. AC-303 could not see it: ROW 3's `en` column is the
  // identity for every token, so no dictionary edit can move an en baseline, and AC-303's fourth arm
  // only asserts zh ≠ en. Fixing it therefore REQUIRES changing the token ITSELF to English (the
  // AC-291/AC-292/AC-293/AC-296/AC-298 shape — a `pageTitle` token is the full English string,
  // subtitle included). The zh column is unchanged BYTE FOR BYTE, which is what keeps `lang=zh`
  // output identical (this task's AC3) and AC-303's live criterion green on both of its title arms
  // (`!includes("Architecture")` and `t_zh ≠ t_en`). ⚠️ The `en` value here happens to equal the
  // string the AC-303 test's `META_DESCRIPTION` residue carries, but they are INDEPENDENT: that meta
  // node passes through no dictionary and is untouched (see the AC-303 test's named-residue arms).
  "Architecture — system component map": { en: "Architecture — system component map", zh: "架构 — 系统组件图" },
  Architecture: { en: "Architecture", zh: "架构" },
  architecture: { en: "architecture", zh: "架构" },
};

/** The page's OWN name in `lang` (ROW 3). `en` is the identity for every token, so the en baseline
 *  cannot drift as pages are added to this table; an unmapped token under `zh` keeps its English
 *  token rather than rendering blank. */
export function pageNameFor(pageName: string, lang: Lang = DEFAULT_LANG): string {
  if (lang === "en") return pageName;
  const entry = Object.prototype.hasOwnProperty.call(PAGE_LABELS, pageName) ? PAGE_LABELS[pageName] : undefined;
  return entry ? entry.zh : pageName;
}

// ── ROW 4: the language SWITCHER's own words (gap-webui-lang-switcher-control) ───────────────
// ROW 1~3 label the CHROME (which view is this? what is this page called?). This row labels the
// CONTROL that lets a reader change ROW 1~3's input — the entry point into the AC-288 mechanism.
// It is a separate table for the same reason each row is: the switcher's vocabulary is a peer of
// the nav's, not a reuse of it (a later re-wording of 「仪表盘」 must not silently move the button
// that takes you there).

/** The name of a language written IN that language — an ENDONYM. ⛔ Deliberately NOT an
 *  `{ en, zh }` peer-column pair like every other table here: an endonym is the one label whose
 *  value is the SAME in both columns by construction, and the reason is the reader's, not a
 *  short-circuit. A reader who cannot read the current UI language must still be able to FIND
 *  their own — under an English page the Chinese entry has to read 「中文」, not "Chinese", or the
 *  affordance is only usable by someone who does not need it. Modelling it as `Record<Lang, …>`
 *  (keyed by TARGET) rather than `{ en, zh }` (keyed by reader) is the type carrying that: there
 *  is no reader dimension for this word, so there is nothing for a reader column to disagree on.
 *  ⛔ Neither value may be re-worded into an English exonym for the same reason. */
export const LANG_NAMES: Record<Lang, string> = { en: "EN", zh: "中文" };

/** The switcher's own accessible GROUP name, in the READER's language — what this control is.
 *  Keyed by the language the page is currently rendered in (the reader's), which is why this one
 *  IS a per-language map: unlike `LANG_NAMES` it names the CONTROL, and "what is this control"
 *  is a question asked by the reader in their own language. */
export const LANG_SWITCHER_GROUP: Record<Lang, string> = { en: "Language", zh: "语言" };

/** The per-ITEM accessible names, keyed `[reader][target]` — two dimensions, because an item's
 *  name is a sentence ABOUT one language WRITTEN IN another, and collapsing either axis produces
 *  a wrong sentence: keyed by target alone, 「切换到英文」 would be read aloud to a reader who is
 *  on the English page (where the right sentence is "Switch to Chinese" about the zh item), and
 *  keyed by reader alone, both items would carry the same name.
 *  The type is `Record<Lang, Record<Lang, string>>` (both axes COMPLETE) for ROW 2's reason: a
 *  reader/target pair with no sentence is a type error, not a silent English fallback — an item
 *  whose name fell back would be indistinguishable from one that was never wired, which is the
 *  exact class of defect the switcher exists to remove (硬规则 3b). */
export const LANG_SWITCH_ARIA: Record<Lang, Record<Lang, string>> = {
  en: { en: "Current language: English", zh: "Switch to Chinese" },
  zh: { en: "切换到英文", zh: "当前语言：中文" },
};

// ── ROW 9: SHARED CHROME words the /dashboard body-copy work exposed ─────────────────────────────
//
// These are neither nav view labels (ROW 1), nor page names (ROW 3), nor switcher words (ROW 4):
// they are two pieces of chrome that render on EVERY page — the skip link, and the mobile menu's
// four group headings. They were found by MEASUREMENT, not by reading the source: the AC-1
// red-baseline probe of `/dashboard?lang=en` listed them among the page's remaining Chinese, i.e.
// the "the shell is already English" premise was true of the nav items and false of these five.
//
// ⚠️ WHY THEY LIVE IN A ROW OF THEIR OWN RATHER THAN IN DASHBOARD_LABELS: they are not the
// dashboard's copy, they are every page's — and putting them under a dashboard-shaped name would
// make the second consumer's migration a cross-table edit (same argument as ROW 5's /live note).
// ⛔ The endonym `中文` in the language switcher is deliberately NOT here: it must read 中文 on the
// English page too (see ROW 4's LANG_NAMES doc) — an English exonym would make the switcher usable
// only by readers who do not need it.
export const CHROME_LABELS: Record<string, { en: string; zh: string }> = {
  skipToMain: { en: "Skip to main content", zh: "跳到主要内容" },
  navGroupCore: { en: "Core", zh: "核心" },
  navGroupObserve: { en: "Observation", zh: "观测" },
  navGroupRecords: { en: "Records", zh: "记录" },
  navGroupKnowledge: { en: "Knowledge", zh: "知识" },
  // ⑥ `renderBackLink`'s label (gap-webui-goal-body-copy-en-zh). It was added HERE — rather than to
  // the GOAL table below — because it is one helper with THREE callers, not any one page's copy:
  // `renderBackLink` is the shared "back to the list" affordance the three entity detail pages
  // (/goal, /adr, /doc) each render as the first element of `<main>`
  // (gap-webui-goal-detail-no-entity-links AC4: "One shared helper, one href each, so the affordance
  // stays consistent and is never re-invented per page").
  //
  // ⚠️ THE PREVIOUS TASK (gap-webui-dashboard-body-copy-en-zh ⑤) REGISTERED THIS AS RESIDUE for
  // "其他页面" and that was correct THERE: /dashboard renders no back link at all, so it was another
  // page's copy. It is NOT correct here — /goal/<id> renders it — and leaving it Chinese would put
  // the one visible Chinese word on an otherwise-English detail page (and fail this task's AC2/AC8).
  //
  // ⚠️ WHY ALL THREE CALLERS PASS THEIR OWN LANGUAGE rather than leaving two of them on the default:
  // the default is `en`, so an un-migrated caller's `?lang=zh` page would render an ENGLISH back link
  // — the silently-defaulted-language trap ROW 5 ⑧ / 硬规则 3b name. The two sibling detail pages
  // therefore pass their own `cfg.lang` in the same change; their OTHER detail chrome (the hard-coded
  // html-lang attribute, their lang-less `renderMobileChrome`/`renderSiteNav`) is ⛔ NOT touched here
  // and stays their own tasks' residue.
  backLink: { en: "← Back to list", zh: "← 返回列表" },
};

/** One shared-chrome word (ROW 9). Unknown key ⇒ THROW, same rule and same reason as ROW 8. */
export function chromeLabel(key: string, lang: Lang = DEFAULT_LANG): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(CHROME_LABELS, key) ? CHROME_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown chrome key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return entry[lang];
}
