// serve-i18n.ts — the ONE label dictionary for the quay web face's shared chrome (AC-289 / GOAL-024).
//
// ============================ CONTRACT (single source of truth) ============================
// `serve-lang.ts` answers "which language is this request?"; this file answers "what is this label
// in that language?". They are separate modules on purpose: a page that needs only the `<html lang>`
// attribute must not have to import 15 label pairs, and a test of the DECISION TABLE must not
// depend on the dictionary's CONTENTS.
//
// ROW 1 — ONE dictionary, peer columns. `NAV_LABELS` is the only place a nav label is written. The
//   `en` column is byte-equal to the 15 labels the nav rendered before this module existed — that
//   is the AC-289 baseline the goal criterion reads off the LIVE page — and it is ⛔ NOT derived
//   from the zh column by any fallback. The two columns are peers, not a source and its translation.
//
// ROW 2 — the roster is CLOSED and a missing word is an ERROR. `NAV_KEYS` is the 15-view union and
//   `NAV_LABELS` is typed `Record<NavKey, …>`, so a view added without a word in BOTH columns is a
//   type error. At runtime an unknown key THROWS — it never falls back to English (硬规则 3b: a
//   reader that cannot find the word it was asked for must say so, never return the word it did
//   find; a silently-English nav item is indistinguishable from an untranslated one, which is the
//   exact defect AC-289 exists to remove).
//
// ROW 3 — `PAGE_LABELS` is the PAGE-CHROME dictionary, keyed by the page's OWN English token (the
//   same token `pageTitle` receives). It is deliberately SMALLER than NAV_LABELS: only the pages
//   whose OWN chrome has actually been wired are here — /dashboard (AC-289), /tasks (AC-290),
//   /live (AC-291), /board (AC-292), /system (AC-293), /manager (AC-294), /needs-human (AC-295),
//   /journal (AC-296), /git-history (AC-297), /tests (AC-298), /sessions (AC-299), /adr (AC-300),
//   /goal (AC-301), /doc (AC-302) and /architecture (AC-303). With /architecture wired, ALL FIFTEEN
//   `SITE_NAV_ROUTES` pages have their own page-chrome in this table — the roster is now COMPLETE for
//   the GOAL-024 page set (⛔ but the table stays open by type: it is `Record<string, …>`, keyed by
//   exact token, so a future page still adds its own rows rather than editing a shared one).
//   `en` is the identity for EVERY token (so the en baseline is byte-identical by construction);
//   an unmapped token under `zh` renders its English token unchanged — a VISIBLE degradation (the
//   page reads English), never a blank or undefined title.
//
// WHY THE zh COLUMN IS ASSERTED TO NOT CONTAIN "Dashboard": the goal criterion reads the live nav
//   region and fails on the literal English label. A zh value that still carried the English word
//   (e.g. "Dashboard 面板") would satisfy "the value is non-empty" while defeating the assertion the
//   value exists to satisfy — so the test asserts the absent literal directly rather than trusting
//   a column that merely looks translated.
// ==========================================================================================

import { DEFAULT_LANG, type Lang } from "./serve-lang.ts";

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

// ── ROW 5: the /dashboard BODY copy (gap-webui-dashboard-body-copy-en-zh) ────────────────────
//
// ROW 1 labels the nav, ROW 3 the page names, ROW 4 the switcher. This row labels what a page's
// BODY says once you are on it: card headings, state words, link texts, empty states, SVG aria
// labels, and the dashboard identity card. It exists because GOAL-024's AC-289~303 landed the
// CHROME (nav + <title> + <h1> + switcher) and left every page's body copy hard-coded Chinese —
// so `?lang=en` rendered a page whose frame was English and whose content was not.
//
// WHY IT IS ONE TABLE AND NOT PER-CARD TABLES. The unit of this dictionary is a RENDERED STRING,
// not a component. Two cards that render byte-identical copy (「未接入」, 「运行中」, 「读失败」)
// therefore SHARE one row rather than each carrying a private copy — the drift this prevents is
// concrete: `在跑但未接遥测` already lives twice in the tree (here, and as the former
// LIVE_STATE_RUNNING_UNWIRED_LABEL in serve-render.ts, whose only consumer was /live). ⚠️ That
// /live constant was NOT folded into this row: /live's body copy was a later page's task, and a
// value this table owns cannot also be another page's constant without making that page's
// eventual migration a cross-table edit. The duplication was REAL and recorded here rather than
// silently tripled.
// ✅ RESOLVED by gap-webui-live-body-copy-en-zh (2026-09-18): /live has since migrated, the
// serve-render.ts exports are DELETED, and the two words now live in ROW 19's
// `liveStateRunningUnwired` / `liveStateNotRunning` — still a SEPARATE row from this one, for
// exactly the cross-table reason above (⛔ ROW 11 ③'s rule; see ROW 19's phase-words note for the
// one sharing decision that IS contract-mandated, and why it is not a licence to share here).
//
// ROW 6 — TEMPLATES AND THE FILL RULE. Copy that interpolates data carries `{name}` placeholders
// in BOTH columns (`在飞 {inFlight} / 上限 {cap}`), and the caller fills them via `fillLabel` —
// ⛔ never by concatenating a translated fragment with a raw number at the call site (「在飞 」+n+
// 「 / 上限 」+m is a sentence only Chinese word order can assemble; the en column would then be
// unfixable without editing every call site). `fillLabel` THROWS on a placeholder the caller did
// not supply: a label that silently rendered `{cap}` would be a page displaying its own template
// syntax, and — the reason it is a throw and not a fallback — the SAME class of defect as a
// silently-English label (硬规则 3b), so it must be impossible to ship by accident.
//
// ROW 7 — THE zh COLUMN IS THE PRE-EXISTING LITERAL, BYTE FOR BYTE. This row was extracted FROM
// running code, not written alongside it: the en column is the NEW text and the zh column is what
// the page already rendered, so `lang=zh` output cannot move (the AC-3 arm of this task's
// criterion diffs the whole zh response). A zh value that "reads better" is a REGRESSION here.
//
// ROW 8 — THE ROSTER IS CLOSED, LIKE ROW 2. `DASHBOARD_KEYS` is the union and `DASHBOARD_LABELS`
// is typed `Record<DashboardKey, …>`, so a key with only one column is a compile error; an
// unknown key at runtime THROWS.
export const DASHBOARD_KEYS = [
  // page header
  "subtitle", "metaDescription", "timelineWindow", "workProgress", "changeLog",
  // liveCard
  "loopPulse", "inFlightCap", "viewLive", "readFailed", "liveStateRunning",
  "liveStateRunningUnwired", "liveStateNotRunning", "moreWithArrow", "moreBadge",
  // phase words (liveCard mini list + gantt hover)
  "phaseLanded", "phaseAwaitingLand", "phaseImplementing", "awaitingLandWithDuration",
  // SVG aria labels
  "timelineAriaPastHours", "liveSwimlaneAria", "liveGanttAria", "sysSparklineAria", "sparkThreshold",
  // testsCard
  "tests", "viewTests", "notWired", "running", "suiteRunningElapsed",
  "gateNotPassedNamed", "gateNotPassedUnnamed", "noVerificationRounds", "roundGateNotRun",
  // sysCard / mgrCard
  "sysResources", "viewSystem", "driverStatusNotWired", "viewManager",
  "driverNotRunning", "driverLastRecord",
  // taskCard
  "taskLedger", "viewTaskList", "miniListHeader",
  // goalCard
  "stageGoals", "viewGoals", "acAchieved", "noActiveGoal",
  // fanInCard
  "noFanInRecords", "recentFanIns",
  // commits / git-history cards
  "noCommits", "recentCommits", "gitReadFailedWithReason", "viewJournal",
  "gitHistoryTimelineBody", "viewGitHistory",
  // identity card (renderIdentityCard — the dashboard's own exclusive card)
  "identityTitle", "labelColon", "identityProjectRoot", "identityHost", "identityListen",
  "identityPluginVersion", "identityDelivered", "identityWorkspaceDisk", "identityUnavailable",
  "identityMatch", "identityMismatch", "identityNotEvaluated", "identityBranchModel",
] as const;

export type DashboardKey = (typeof DASHBOARD_KEYS)[number];

/** The /dashboard body-copy dictionary — see ROW 5~8 for the rules every row obeys. */
export const DASHBOARD_LABELS: Record<DashboardKey, { en: string; zh: string }> = {
  // ── page header ──────────────────────────────────────────────────────────────────────────────
  subtitle: {
    en: "An overview of the loop pulse, the task ledger, system resources and the three-layer scheduling state — each card links to its full page.",
    zh: "循环脉搏、任务台账、系统资源与三层调度状态的总览 — 每张卡片指向对应完整页面。",
  },
  metaDescription: {
    en: "Quay dashboard — loop pulse, task ledger, system resources and three-layer status overview",
    zh: "Quay dashboard — 循环脉搏、任务台账、系统资源与三层状态总览",
  },
  timelineWindow: {
    en: "Timeline window (the past {hours}h, ending at each series' own latest run / fan-in end): ",
    zh: "时间轴窗口（以各自最近一次运行/fan-in 结束时刻为终点的过去 {hours}h）：",
  },
  workProgress: { en: "Work progress", zh: "工作进展" },
  changeLog: { en: "Change log", zh: "变更记录" },

  // ── liveCard ────────────────────────────────────────────────────────────────────────────────
  loopPulse: { en: "Loop pulse", zh: "循环脉搏" },
  inFlightCap: { en: "In flight {inFlight} / cap {cap}", zh: "在飞 {inFlight} / 上限 {cap}" },
  viewLive: { en: "View Live →", zh: "查看 Live →" },
  // ⚠️ ALSO the commits card's own unreadable-read word (gitReadFailureSummary) — one row, two
  // call sites, because the rendered string is identical. A second row here would let the two
  // cards' copy drift apart under a later re-wording.
  readFailed: { en: "Read failed", zh: "读失败" },
  // ⚠️ `running` is the live_state TOKEN, and it reads the same in both languages — it is a row
  // rather than a raw literal so the roster stays closed (ROW 8), NOT because it has a translation.
  // Its zh value is byte-equal to its en value; the dictionary test admits exactly that case.
  liveStateRunning: { en: "running", zh: "running" },
  // ⚠️ The same two zh words are ALSO ROW 19's `liveStateRunningUnwired` / `liveStateNotRunning`,
  // which /live's banner renders — and they are STILL duplicated rather than shared (see ROW 5's
  // note, now marked resolved, and ROW 19's phase-words note for the one sharing decision that IS
  // contract-mandated). ⛔ Not an invitation to merge the duplicate (ROW 11 ③).
  liveStateRunningUnwired: { en: "Running, telemetry not wired", zh: "在跑但未接遥测" },
  liveStateNotRunning: { en: "Not running", zh: "未在运行" },
  moreWithArrow: { en: "+{n} more →", zh: "+{n} 更多 →" },
  moreBadge: { en: "+{n} more", zh: "+{n} 更多" },

  // ── execution-phase words ───────────────────────────────────────────────────────────────────
  phaseLanded: { en: "Landed", zh: "已落地" },
  phaseAwaitingLand: { en: "Awaiting land", zh: "待落地" },
  phaseImplementing: { en: "Implementing", zh: "实现中" },
  // The mini list's awaiting-land tag carries its dwell time; the bare phase word above does not.
  // Two rows because they are two different RENDERED strings — ⛔ not a template with an optional
  // placeholder (an empty fill would leave a trailing space the zh baseline does not have).
  awaitingLandWithDuration: { en: "Awaiting land {duration}", zh: "待落地 {duration}" },

  // ── SVG aria labels ─────────────────────────────────────────────────────────────────────────
  timelineAriaPastHours: { en: "Timeline: the past {hours} hours", zh: "过去 {hours} 小时时间轴" },
  liveSwimlaneAria: { en: "In-flight task swimlane timeline", zh: "在飞任务泳道时间轴" },
  liveGanttAria: { en: "Loop-pulse gantt chart ({lanes} fixed lanes)", zh: "循环脉搏甘特图（固定 {lanes} 泳道）" },
  sysSparklineAria: { en: "System load history (while this page stays open)", zh: "系统负载历史（页面停留期间）" },
  // Rendered by sparklineSvg, whose SOURCE is serialized into the client script via
  // Function#toString — so the label is passed IN as a parameter (the browser has no dictionary).
  sparkThreshold: { en: "threshold {value}", zh: "阈 {value}" },

  // ── testsCard ───────────────────────────────────────────────────────────────────────────────
  tests: { en: "Tests", zh: "测试" },
  viewTests: { en: "View Tests →", zh: "查看 Tests →" },
  // The card's status line when there is neither a running suite nor a completed round — the same
  // honest empty state the sysCard's `未接入` arm uses, hence one shared row.
  notWired: { en: "Not wired", zh: "未接入" },
  // ⚠️ SHARED with the mgrCard's per-driver alive word: `运行中` is the same rendered string in
  // both cards (a running suite / a live driver process), so it is one row.
  running: { en: "Running", zh: "运行中" },
  suiteRunningElapsed: { en: "Running for {elapsed}", zh: "已运行 {elapsed}" },
  // The gate-blocked round is rendered with and without a gate name — two rendered strings, two
  // rows (the zh arm's full-width parens around the name are inside the FIRST row, ⛔ not
  // concatenated at the call site — see ROW 6).
  gateNotPassedNamed: { en: "gate not passed ({gate}); tests not run", zh: "gate 未过（{gate}），未执行测试" },
  gateNotPassedUnnamed: { en: "gate not passed; tests not run", zh: "gate 未过，未执行测试" },
  noVerificationRounds: { en: "No verification rounds", zh: "无验证轮记录" },
  roundGateNotRun: { en: "gate:{gate}; tests not run", zh: "gate:{gate} 未执行测试" },

  // ── sysCard / mgrCard ───────────────────────────────────────────────────────────────────────
  sysResources: { en: "System resources", zh: "系统资源" },
  viewSystem: { en: "View system status →", zh: "查看系统状态 →" },
  driverStatusNotWired: { en: "Driver status not wired", zh: "Driver 状态未接入" },
  viewManager: { en: "View three-layer status →", zh: "查看三层状态 →" },
  driverNotRunning: { en: "Not running", zh: "未运行" },
  driverLastRecord: { en: "Last record {time}", zh: "末条记录 {time}" },

  // ── taskCard ────────────────────────────────────────────────────────────────────────────────
  taskLedger: { en: "Task ledger", zh: "任务台账速览" },
  viewTaskList: { en: "View task list →", zh: "查看任务列表 →" },
  miniListHeader: { en: "{status} (latest {n})", zh: "{status}（最近 {n} 条）" },

  // ── goalCard ────────────────────────────────────────────────────────────────────────────────
  stageGoals: { en: "Stage goals", zh: "阶段目标" },
  viewGoals: { en: "View Goals →", zh: "查看 Goals →" },
  acAchieved: { en: "AC achieved {achieved}/{total}", zh: "AC 达成 {achieved}/{total}" },
  noActiveGoal: { en: "No active GOAL", zh: "暂无 active GOAL" },

  // ── fanInCard ───────────────────────────────────────────────────────────────────────────────
  noFanInRecords: { en: "No fan-in records", zh: "暂无 fan-in 记录" },
  recentFanIns: {
    en: "Last {n} mechanical fan-ins (landed/red · lock-held interval)",
    zh: "最近 {n} 次机械 fan-in（landed/red · 锁持有区间）",
  },

  // ── commits / git-history cards ─────────────────────────────────────────────────────────────
  noCommits: { en: "No commits", zh: "无提交" },
  recentCommits: { en: "Recent commits", zh: "最近提交" },
  gitReadFailedWithReason: { en: "Read failed — {reason}", zh: "读失败 — {reason}" },
  viewJournal: { en: "View Journal →", zh: "查看 Journal →" },
  gitHistoryTimelineBody: {
    en: "Vertical commit timeline (develop trunk + task branches, rendered client-side by a third-party library).",
    zh: "提交纵向时间轴（develop 主干 + task 分支，第三方库客户端渲染）。",
  },
  viewGitHistory: { en: "View Git History →", zh: "查看 Git History →" },

  // ── identity card ───────────────────────────────────────────────────────────────────────────
  // Rendered ONLY by renderIdentityCard, which only /dashboard calls (see serve-render.ts).
  identityTitle: { en: "Project identity", zh: "项目身份" },
  // The full-width colon the zh table separates every `<strong>label</strong>` from its value with.
  // A row rather than a literal because English needs `:` — and one row, not four, so the four
  // labelled rows of the card cannot end up with two different separators.
  labelColon: { en: ": ", zh: "：" },
  identityProjectRoot: { en: "Project root", zh: "项目根路径" },
  identityHost: { en: "Host", zh: "主机" },
  identityListen: { en: "Listening", zh: "监听" },
  identityPluginVersion: { en: "plugin version", zh: "plugin 版本" },
  identityDelivered: { en: "Delivered", zh: "交付物" },
  // The `· ` separator is INSIDE the value, so the zh bytes are exactly the pre-extraction literal.
  identityWorkspaceDisk: { en: "· Workspace on disk", zh: "· 工作区落盘" },
  // The two `null` readings of the plugin-version pair (delivered / on-disk). One row, two call
  // sites (fmt and branchVal) — the same rendered string.
  identityUnavailable: { en: "Not wired / no data", zh: "未接入/无数据" },
  identityMatch: { en: "Match", zh: "一致" },
  identityMismatch: {
    en: "Mismatch — this workspace's on-disk plugin is out of date",
    zh: "不一致 — 该工作区落盘的 plugin 已过期",
  },
  // The third verdict state (there are only two readings ⇒ nothing to compare). ⛔ NOT folded into
  // identityUnavailable: "no data at all" and "one side missing" are different facts, and the
  // observable that distinguishes them (data-plugin-version-state) is what AC3 reads.
  identityNotEvaluated: { en: "Not evaluated (one side missing)", zh: "未评估（缺一侧读数）" },
  identityBranchModel: { en: "Branch model", zh: "分支模型" },
};

/** The whole /dashboard roster resolved for one language — take it ONCE per render (the
 *  `navLabelsFor` idiom), rather than re-reading `DASHBOARD_LABELS` at each of ~50 call sites. */
export function dashboardLabelsFor(lang: Lang = DEFAULT_LANG): Record<DashboardKey, string> {
  const out = {} as Record<DashboardKey, string>;
  for (const key of DASHBOARD_KEYS) out[key] = DASHBOARD_LABELS[key][lang];
  return out;
}

/** Fill `{name}` placeholders in an ALREADY-RESOLVED label (ROW 6).
 *
 *  Unknown key ⇒ THROW (ROW 8), same reason as `navLabel`: a silently-English body label is
 *  indistinguishable from a card that was never wired to the dictionary.
 *
 *  Missing parameter ⇒ THROW. This is the half of the rule that is easy to leave out: a caller that
 *  forgets `{cap}` gets a page rendering its own template syntax, and every automated check that
 *  only asks "does the page contain the value it should" stays green while it happens. The
 *  throw makes the omission immediately visible in the first render that hits it. */
export function dashboardLabel(
  key: DashboardKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(DASHBOARD_LABELS, key) ? DASHBOARD_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown dashboard key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

/** Substitute `{name}` in `template` from `params`; THROW on a placeholder left unfilled (ROW 6).
 *  Exported (rather than inlined into `dashboardLabel`) because a renderer that took the whole
 *  roster via `dashboardLabelsFor` still needs to fill the interpolated rows it took. */
export function fillLabel(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_whole, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(
        `serve-i18n: label ${JSON.stringify(template)} needs {${name}} and the caller supplied it not — ` +
        `supplied: ${JSON.stringify(Object.keys(params))}`,
      );
    }
    return String(params[name]);
  });
}

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

// ── ROW 10: the /journal BODY copy (gap-webui-journal-body-copy-en-zh) ──────────────────────────
//
// ROW 5 is /dashboard's body copy. This row is /journal's, and it obeys ROW 2/ROW 6/ROW 7/ROW 8
// unchanged: the roster is closed, the zh column is the pre-existing literal BYTE FOR BYTE, and
// interpolated copy carries `{name}` in both columns.
//
// HOW THE ROSTER WAS FOUND — by MEASUREMENT, not by reading the source. The red-baseline probe
// renders /journal TWICE from two real servers: one rooted at the real workspace (real
// escalations.md with its real mtime, real 2 MB tick-log.md, real commit log) and one rooted at a
// workspace with an EMPTY orchestration/ and a one-commit ASCII log. A CJK line present in BOTH
// renders is interface copy BY CONSTRUCTION — it cannot have come from data, because the second
// render had none. That differential is what produced this roster, and it is re-runnable.
//
// ⚠️ WHY THE ROSTER INCLUDES THE EMPTY/ERROR STATES (`noData`, `readFailed`, `noContent`) EVEN
// THOUGH THE HEALTHY PAGE NEVER RENDERS THEM: the differential found them in the no-data render,
// and they are this page's copy every bit as much as the section headings are. A roster built only
// from the healthy render would leave the page half-English in exactly the state an operator
// reaches for it — when a source has gone missing.
//
// ⚠️ `staleBanner` IS THE ONE INTERPOLATED ROW, and it is the only reason this task also touches
// observation.ts. The banner was not copy this page's renderer ever saw: `observation.staleBanner`
// built the finished Chinese MARKDOWN STRING and prepended it to `escalations.markdown`, so by the
// time any renderer ran, the words were already baked into the data (see ROW 6's rule — a sentence
// assembled before the language is known cannot be un-assembled at the call site). The reader now
// reports the stale FACT (`{date, days}`) and the renderer says it in the request's language.
export const JOURNAL_KEYS = [
  // page header
  "titleSuffix",
  // the three section headings (the file name each carries is DATA and stays verbatim)
  "sectionEscalations", "sectionTickLog", "sectionCommits",
  // renderSectionBlock's three states
  "noContent", "noData", "readFailed",
  // the stale-source banner (interpolated — ROW 6)
  "staleBanner",
] as const;

export type JournalKey = (typeof JOURNAL_KEYS)[number];

/** The /journal body-copy dictionary — see ROW 10 and ROW 2/6/7/8. */
export const JOURNAL_LABELS: Record<JournalKey, { en: string; zh: string }> = {
  // The `<h1>`'s suffix, rendered as `${pageNameFor("Journal", lang)} — <this>`.
  titleSuffix: { en: "recent loop record", zh: "循环最近记录" },
  // The section headings. ⛔ The parenthesised file name is the reader's own source path — DATA —
  // and is carried verbatim in both columns rather than reassembled at the call site, so the en
  // column cannot silently drop it (it is the operator's only pointer to which file this is).
  sectionEscalations: { en: "Escalations (escalations.md)", zh: "升级项 (escalations.md)" },
  sectionTickLog: { en: "Tick log (tick-log.md)", zh: "Tick 记录 (tick-log.md)" },
  sectionCommits: { en: "Recent commits (git log)", zh: "最近提交 (git log)" },
  // renderSectionBlock's "source exists and is readable, but has no recent content" state — a
  // third state, distinct from both noData (source absent) and readFailed (source unreadable).
  noContent: { en: "No recent content.", zh: "暂无内容。" },
  noData: { en: "No data", zh: "无数据" },
  readFailed: { en: "Read failed", zh: "读失败" },
  // ⚠️ `{days}` is rendered with a `d` unit rather than a pluralised "day"/"days": the dictionary
  // has one column per language and no number/plural dimension, so a pluralisation rule would have
  // to live at the call site — the exact shape ROW 6 forbids. `~{days}d ago` is correct English for
  // every n, including n=1, without one.
  staleBanner: {
    en: "⚠️ Stale record — last updated {date} (~{days}d ago); the escalation channel has been superseded by tick-log and is kept for reference only",
    zh: "⚠️ 陈旧记录 — 最后更新于 {date}（约 {days} 天前）；升级机制已由 tick-log 取代，此处仅供参考",
  },
};

/** The whole /journal roster resolved for one language — the `navLabelsFor`/`dashboardLabelsFor`
 *  idiom (take it ONCE per render rather than re-reading `JOURNAL_LABELS` at each call site). */
export function journalLabelsFor(lang: Lang = DEFAULT_LANG): Record<JournalKey, string> {
  const out = {} as Record<JournalKey, string>;
  for (const key of JOURNAL_KEYS) out[key] = JOURNAL_LABELS[key][lang];
  return out;
}

// ── ROW 11: the /board BODY copy (gap-webui-board-body-copy-en-zh) ──────────────────────────────
//
// ROW 5 did this for /dashboard and ROW 10 for /journal; this is the series' THIRD page and it obeys
// ROW 5~8 unchanged (one table, one ROW per RENDERED string, `{name}` templates filled by
// `fillLabel`, the zh column byte-equal to the pre-extraction literal, a CLOSED `Record<…>` roster).
// The three rules that had to be DECIDED for THIS page rather than inherited are recorded here:
//
// ① THE STATE WORD IS ONE ROW, NOT ONE PER RENDER SITE. `doneUnlanded` / `landedNotClosed` /
//    `awaitingLandTag` / `inFlightTimeout` / `orphan` each render once PER ROW of the table, i.e.
//    hundreds of times on a full page. The unit is still one rendered string — ⛔ never a row per
//    occurrence (the table body is a `.map`; a per-site row would be 200 identical entries).
//
// ② EVERY COUNT-BEARING LINE IS A TEMPLATE, INCLUDING THE THREE THAT READ LIKE CONCATENATION.
//    `· {implementing} 实现中 · {awaiting} 待落地`, `· 扫描 {n} 任务`, and
//    `默认视图：… —— {shown} 行（全部 {total} 行）。` are all sentences whose WORD ORDER differs
//    between the columns, so the number cannot be concatenated at the call site (ROW 6). Same for
//    the two `显示全部 {n} 行` / `已显示全部 {n} 行` link texts and the empty-state body.
//    ⚠️ The zh column is byte-equal to the literal it replaced, so `lang=zh` output does not move
//    (this task's AC3) — a zh value that merely "reads better" is a REGRESSION here (ROW 7).
//
// ③ THE TABLE DOES NOT REUSE `DASHBOARD_LABELS`' OR `JOURNAL_LABELS`' ROWS, and the duplication is
//    DELIBERATE. `读失败` (`readFailed`), `无数据`/`读取超时` and the "not wired / no data" family
//    render byte-identically on three pages now, and ROW 5's own note argues for SHARING such a
//    string. It is NOT shared here, for the reason ROW 5 gives for the /live constant: a value owned
//    by another page's table makes that page's next re-wording a CROSS-TABLE edit, so a change made
//    for /board would silently move /dashboard's and /journal's copy (and vice versa). The
//    duplication is real, recorded, and the cheaper of the two failure modes. ⛔ It is NOT an
//    invitation to "merge the duplicate" later.
//
// ⚠️ NOT IN THIS ROW, and why (each is a judgement, not an omission):
//   - The reader DIAGNOSTIC strings appended after 「读失败」/「读取超时」/「无数据」 (e.g.
//     `未找到遥测记录（.workflow-events/ 不存在）`, `landing 判断源执行超过 8000ms 未完成（fail-open）`)
//     come from `observation.ts`'s readers, which are NOT in this task's Touches and are shared with
//     /dashboard. They are rendered verbatim through `escapeHtml`, i.e. the same class as a task
//     title (data), and the /dashboard and /journal body-copy tasks classified them the same way.
//   - `Filter` / `Page size:` / `« Previous` / `Page {n} of {m}` / the two filter-input placeholders
//     are ALREADY English in both columns (they predate this series); they are not defects, and
//     moving them would change zh output, which AC3 forbids.
//   - The `id` column header and the `—` empty-cell glyph are not language-bearing.
export const BOARD_KEYS = [
  // page chrome
  "metaDescription", "h1Subtitle",
  // the three source-summary notes
  "intentSource", "execSource", "landingSource",
  "scanTasks", "inFlightBreakdown", "noData", "readTimeout", "readFailed",
  // table headers
  "colIntent", "colExec", "colLanding",
  // per-cell state words (① — one row, hundreds of render sites)
  "inFlightMinutes", "awaitingLandTag", "inFlightTimeout", "orphan",
  "doneUnlanded", "landedNotClosed",
  // the default view's note block (four distinct states, four distinct wordings)
  "showAllRows", "onlyTransient", "defaultViewNote",
  "emptyTitle", "emptyBody", "emptyHint",
  "defaultFilterNotApplied", "defaultFilterNotAppliedBody",
  "allRowsShown",
  // the incomplete-source names that fill `defaultFilterNotAppliedBody`'s `{why}`
  "srcExecEmpty", "srcExecFailed", "srcLandingTimeout", "srcLandingUnavailable", "srcLandingFailed",
] as const;

export type BoardKey = (typeof BOARD_KEYS)[number];

/** The /board body-copy dictionary — see ROW 11 (and ROW 5~8, which it obeys unchanged). */
export const BOARD_LABELS: Record<BoardKey, { en: string; zh: string }> = {
  // ── page chrome ─────────────────────────────────────────────────────────────────────────────
  // ⚠️ The `<title>` itself is NOT here: its token is PAGE_LABELS' job (ROW 3), and it was re-keyed
  // to English by this same task (see the `Board — three-source join` row's note). Only the meta
  // description and the `<h1>`'s subtitle are body copy.
  metaDescription: {
    en: "Quay board — the three-source join of intent, execution and landing",
    zh: "Quay board — 三源 join 看板",
  },
  h1Subtitle: { en: "intent / execution / landing", zh: "意图 / 执行 / 落地" },

  // ── the three source-summary notes ──────────────────────────────────────────────────────────
  // `intentSource` is ONE rendered string (label + source description) because the two halves are
  // never separated by a tag at that call site — unlike exec/landing, whose source is inside a
  // `<code>` that follows the label.
  intentSource: { en: "Intent: task store (Provider ABI)", zh: "意图: 任务库 (Provider ABI)" },
  execSource: { en: "Execution:", zh: "执行:" },
  landingSource: { en: "Landing:", zh: "落地:" },
  scanTasks: { en: "scanned {n} tasks", zh: "扫描 {n} 任务" },
  // ⚠️ TWO counts. The in-flight view splits into implementing (start, no impl-complete) and
  // awaiting-land (impl-complete, no end) — two independent signals with two different consumers
  // (dispatch reads the first, the land gate the second), so the two numbers are NOT interchangeable.
  inFlightBreakdown: {
    en: "{implementing} implementing · {awaiting} awaiting land",
    zh: "{implementing} 实现中 · {awaiting} 待落地",
  },
  noData: { en: "No data", zh: "无数据" },
  readTimeout: { en: "Read timed out", zh: "读取超时" },
  readFailed: { en: "Read failed", zh: "读失败" },

  // ── table headers ───────────────────────────────────────────────────────────────────────────
  colIntent: { en: "Intent", zh: "意图" },
  colExec: { en: "Execution", zh: "执行" },
  colLanding: { en: "Landing", zh: "落地" },

  // ── per-cell state words (ROW 11 ①) ─────────────────────────────────────────────────────────
  inFlightMinutes: { en: "In flight {minutes} min", zh: "在飞 {minutes} 分钟" },
  // The exec cell's own awaiting-land tag. ⛔ NOT shared with `inFlightBreakdown` above: one is a
  // standalone `<strong>` tag inside a table cell, the other is a sentence fragment in the summary
  // line — different rendered contexts, so a later re-wording of one must not move the other.
  awaitingLandTag: { en: "Awaiting land", zh: "待落地" },
  inFlightTimeout: { en: "In-flight timeout", zh: "在飞超时" },
  orphan: { en: "Orphan", zh: "孤儿" },
  doneUnlanded: { en: "done but not landed", zh: "done 但未落地" },
  landedNotClosed: { en: "landed but not closed", zh: "已落地但未收尾" },

  // ── the default view's note block ───────────────────────────────────────────────────────────
  // FOUR distinct states share this block, and each gets its OWN wording — 「判定过且为空」,
  // 「判定过且非空」, 「无法判定」(the filter could not be applied) and 「显式要求全部」 must never
  // read alike (硬规则 3b: a judge that cannot read its input must not return a value shaped like
  // one that read it). The two link texts below are reused by the first two states.
  showAllRows: {
    en: "Show all {n} rows (including historical tasks)",
    zh: "显示全部 {n} 行（含历史任务）",
  },
  onlyTransient: {
    en: "Show only the currently in-flight / awaiting-land rows",
    zh: "只看当前在飞 / 待落地",
  },
  defaultViewNote: {
    en: "Default view: showing only rows where the Execution or Landing column is non-empty — {shown} of {total} rows.",
    zh: "默认视图：只显示「执行」或「落地」列非空的行 —— {shown} 行（全部 {total} 行）。",
  },
  emptyTitle: {
    en: "No in-flight / awaiting-land tasks right now",
    zh: "当前没有在飞 / 待落地的任务",
  },
  emptyBody: {
    en: "The default view shows only rows where the Execution or Landing column is non-empty — none of the {total} rows is in flight / awaiting land / landing-abnormal, so the historical tasks are not expanded.",
    zh: "默认视图只显示「执行」或「落地」列非空的行 —— 全部 {total} 行里没有一行处于在飞 / 待落地 / 落地异常，故不铺开历史任务。",
  },
  // ⚠️ The en value starts with a SPACE and the zh value with 「，」: the row is rendered directly
  // after the 「show all」 link, and the zh byte sequence is the pre-extraction one (a full-width
  // comma with no space). An en value trimmed "for tidiness" would run the link into the sentence.
  emptyHint: {
    en: " — or use the status / label filters above to view a specific subset.",
    zh: "，或用上方的 status / label 筛选查看指定子集。",
  },
  defaultFilterNotApplied: { en: "Default filter not applied", zh: "默认过滤未生效" },
  // `{why}` is filled with the already-escaped ` · `-joined source list; `{total}` with the joined
  // row count. The sentence is one row because its clause order differs by language.
  defaultFilterNotAppliedBody: {
    en: "{why} could not be read (no data / read failed / read timed out), so which tasks are currently in flight or awaiting land CANNOT be determined — the page therefore shows all {total} rows rather than rendering \"cannot be determined\" as \"none\".",
    zh: "{why} 读不到（无数据 / 读失败 / 读取超时），无法判定哪些任务当前在飞或待落地 —— 因此下面显示全部 {total} 行，而不是把「无法判定」渲染成「没有」。",
  },
  allRowsShown: {
    en: "Showing all {n} rows (including historical tasks).",
    zh: "已显示全部 {n} 行（含历史任务）。",
  },

  // ── the incomplete-source names (fill `{why}` above) ────────────────────────────────────────
  // One row per SOURCE-and-STATE pair: these are two different sources (execution / landing) each
  // with its own failure modes, and collapsing them would report which one failed as a generic
  // 「a source failed」 — the fact the banner exists to state.
  srcExecEmpty: { en: "the execution source (.workflow-events/) has no data", zh: "执行源（.workflow-events/）无数据" },
  srcExecFailed: { en: "the execution source (.workflow-events/) read failed", zh: "执行源（.workflow-events/）读失败" },
  srcLandingTimeout: {
    en: "the landing source (task-status-drift-check.ts) read timed out",
    zh: "落地源（task-status-drift-check.ts）读取超时",
  },
  srcLandingUnavailable: {
    en: "the landing source (task-status-drift-check.ts) is unavailable",
    zh: "落地源（task-status-drift-check.ts）不可用",
  },
  srcLandingFailed: {
    en: "the landing source (task-status-drift-check.ts) read failed",
    zh: "落地源（task-status-drift-check.ts）读失败",
  },
};

/** The whole /board roster resolved for one language — take it ONCE per render (ROW 5's `navLabelsFor`
 *  idiom), rather than re-reading `BOARD_LABELS` at each of ~30 call sites. */
export function boardLabelsFor(lang: Lang = DEFAULT_LANG): Record<BoardKey, string> {
  const out = {} as Record<BoardKey, string>;
  for (const key of BOARD_KEYS) out[key] = BOARD_LABELS[key][lang];
  return out;
}

/** One /board label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`).
 *  Exported so a caller that needs only ONE interpolated row does not have to take the roster. */
export function boardLabel(
  key: BoardKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(BOARD_LABELS, key) ? BOARD_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown board key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

// ── ROW 12: the /architecture BODY copy (gap-webui-architecture-body-copy-en-zh) ────────────────
//
// ROW 5 did this for /dashboard, ROW 10 for /journal and ROW 11 for /board; this is the series'
// FOURTH page and it obeys ROW 5~8 unchanged (one row per RENDERED string, `{name}` templates filled
// by `fillLabel`, the zh column byte-equal to the pre-extraction literal, a CLOSED `Record<…>`
// roster, an unknown key THROWS). The four rules that had to be DECIDED for THIS page:
//
// ① THE THREE SOURCE-NOTE FRAGMENTS ARE THREE ROWS, NOT ONE. The `<p class="meta">` line is a single
//    sentence INTERLEAVED with two `<code>` elements — `数据源：` `<code>packages/*</code>`
//    `（git log 提交事实）· ` `<code>git worktree list</code>` `（在飞开发）`. A tag boundary splits a
//    rendered line into three visible text nodes, so the `<h2>`/`<th>`-style "one rendered string per
//    row" rule counts them as three: one row carrying a single literal sentence across a `<code>`
//    would have to embed the markup, which is exactly what the dictionary must not do (ROW 6).
//    ⚠️ The en column's 2nd and 3rd fragments therefore START WITH A SPACE — the zh literal follows
//    `</code>` with no space (a full-width paren closes the gap), while English needs one. Same
//    recorded judgement as ROW 11's `emptyHint` (which starts with a space in en and 「，」 in zh).
//
// ② THE WINDOW DAYS IS A PLACEHOLDER IN *BOTH* COUNT-BEARING ROWS, AND ITS VALUE COMES FROM THE
//    READER. The page said `近 7 天` twice with the `7` hard-written, while the reader's window is a
//    PARAMETER (`readArchitecture(root, { windowDays = ARCH_RECENT_WINDOW_DAYS })`). A literal `7` in
//    the copy is therefore a second, silently-driftable source for one number, and this series'
//    rule forbids it: the rows carry `{days}` and `serve-architecture.ts` fills them from the
//    EXPORTED constant the reader defaults to — so changing the window changes the copy by
//    construction. ⛔ Not `7`, not a per-language "days" plural rule: the `days` unit makes
//    `past {days} days` correct English for every n including 1, the reason ROW 10's `staleBanner`
//    uses `~{days}d ago` (there is no number/plural dimension in a two-column table).
//
// ③ THE FOUR LEGEND WORDS ARE FOUR ROWS, ONE PER RENDERED STRING — and they are ⛔ NOT shared with
//    the /board table's `awaitingLandTag`-style rows even where a word coincides: the legend's four
//    words name the SVG node's HIGHLIGHT STATE (dev / recent / stale / plain), a vocabulary this
//    page owns. A shared row would make /board's next re-wording move this page's legend (ROW 11 ③).
//    ⚠️ They are also ⛔ NOT the same strings as the highlight KIND names in `serve-architecture.ts`
//    (`dev`/`recent`/`plain`/`stale`): the enum is a code identifier that never renders, the label
//    is the rendered word. One row each, keyed by the rendered word's ROLE (`stateDev` = the word
//    shown for the `dev` highlight), so a re-ordering of the legend cannot silently swap two words.
//
// ④ THE `<title>`'s SUBTITLE IS *NOT* A ROW HERE — it is PAGE_LABELS' business (ROW 3), and this task
//    RE-KEYED that token to English (see the note on the `Architecture — system component map` row).
//    The `<h1>`'s subtitle, by contrast, IS body copy (`titleSuffix`): the two sites concatenate
//    `pageNameFor(<page name>)` with a subtitle, and only the page name goes through PAGE_LABELS.
//
// ⚠️ NOT IN THIS ROW, and why (each a judgement, not an omission):
//   - The `<head>`'s `<meta name="description" content="Quay architecture — system component map">`
//     is ALREADY English, passes through no dictionary, and is this page's NAMED out-of-scope residue
//     (AC-303's test asserts it verbatim under BOTH languages). Translating it would change `lang=zh`
//     output, which AC3 forbids — and would remove a residue another file pins.
//   - `obsNote(status, reason)` (serve-render.ts) — the `未接入/无数据` / `读失败` prefix shown when
//     the reader returns a non-ok status — is SHARED CHROME consumed by six other pages (tests /
//     system / sessions), i.e. the ROW 9 class, not this page's copy. It is not in this task's
//     Touches, and the healthy page never renders it. Its `reason` half is the reader's own
//     diagnostic (observation.ts), which the /dashboard, /journal and /board tasks all classified as
//     DATA. ⛔ Recorded here so the next body-copy task sees it as a named, still-open item rather
//     than a fresh discovery — the empty-state arms of the black-box test assert it is still there.
//   - The component NAMES and PATHS in the table (`quay`, `quay-native`, `packages/quay`, …) are DATA
//     read from the workspace, rendered verbatim through `escapeHtml` in both languages. ⛔ Never
//     translated — a translated path would point at a directory that does not exist.
export const ARCHITECTURE_KEYS = [
  // page header — the `<h1>`'s subtitle (④: the `<title>`'s is a PAGE_LABELS token, not a row here)
  "titleSuffix",
  // the source note (① — three rows across two `<code>` boundaries)
  "sourceLabel", "sourceGitLog", "sourceWorktrees",
  // the SVG legend (③ — one row per rendered word, named by the highlight state it labels)
  "stateDev", "stateRecent", "stateStale", "stateStable",
  // the component table (② — both count-bearing rows carry `{days}`)
  "tableHeading", "colComponent", "colPath", "colRecentCommits", "colLastCommit",
] as const;

export type ArchitectureKey = (typeof ARCHITECTURE_KEYS)[number];

/** The /architecture body-copy dictionary — see ROW 12 (and ROW 5~8, which it obeys unchanged). */
export const ARCHITECTURE_LABELS: Record<ArchitectureKey, { en: string; zh: string }> = {
  // ── page header ─────────────────────────────────────────────────────────────────────────────
  // The `<h1>` renders `${pageNameFor("Architecture", lang)} — ${L.titleSuffix}`; the zh value is the
  // pre-extraction literal `系统组件图`, byte for byte, so the zh `<h1>` (`架构 — 系统组件图`) does not
  // move (AC3). ⛔ The en value is deliberately the SAME phrase the re-keyed `<title>` token and the
  // meta description carry — a coincidence of vocabulary, not a shared source.
  titleSuffix: { en: "system component map", zh: "系统组件图" },

  // ── the source note (①) ─────────────────────────────────────────────────────────────────────
  // `数据源：` is its own row because a `<code>` immediately follows it. ⚠️ The en value keeps the
  // full-width-looking role of the colon as an ASCII `:` — the zh `：` is a full-width glyph, and the
  // en column is independent prose (ROW 1's peer-columns rule), ⛔ not a transliteration. ⚠️ The en
  // value therefore ENDS WITH A SPACE (like fragments 2 and 3): a full-width `：` separates the two
  // halves optically on its own, an ASCII `:` does not — without it the page renders
  // `Source:packages/*`, which is what the AC8 screenshot showed before this was corrected. The zh
  // column is byte-identical to the pre-extraction literal either way.
  sourceLabel: { en: "Source: ", zh: "数据源：" },
  // Fragments 2 and 3 START WITH A SPACE in en (see ①) and end with the pre-existing zh bytes. The
  // `· ` inside fragment 2 is part of the LITERAL, not a concatenation done at the call site.
  sourceGitLog: { en: " (git log commit facts) · ", zh: "（git log 提交事实）· " },
  sourceWorktrees: { en: " (in-flight development)", zh: "（在飞开发）" },

  // ── the SVG legend (③) ──────────────────────────────────────────────────────────────────────
  // Keyed by the HIGHLIGHT STATE each word labels (dev / recent / stale / plain), so the legend's
  // order and the highlight enum cannot be silently mismatched:
  //   dev   = a task worktree exists (something is being built right now)
  //   recent= the package has commits inside the window
  //   stale = the flagged/known-issue package (currently quay-github, a design note)
  //   plain = neither — the stable baseline
  stateDev: { en: "In development", zh: "正在开发" },
  stateRecent: { en: "Recently changed", zh: "最近变更" },
  stateStale: { en: "Flagged issue", zh: "已标记问题" },
  stateStable: { en: "Stable", zh: "稳定" },

  // ── the component table (②) ─────────────────────────────────────────────────────────────────
  tableHeading: {
    en: "Recently changed components (git-verifiable, past {days} days)",
    zh: "组件最近变更（git 可证，近 {days} 天）",
  },
  colComponent: { en: "Component", zh: "组件" },
  colPath: { en: "Path", zh: "路径" },
  colRecentCommits: { en: "Commits in the past {days} days", zh: "近 {days} 天提交" },
  // ⚠️ The en column's `Last commit` is also the wording the EMPTY CELL glyph `—` sits under; that
  // glyph is not language-bearing and stays a literal at the call site (ROW 11's `id`-column note).
  colLastCommit: { en: "Last commit", zh: "末次提交" },
};

/** The whole /architecture roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `ARCHITECTURE_LABELS` at each call site. */
export function architectureLabelsFor(lang: Lang = DEFAULT_LANG): Record<ArchitectureKey, string> {
  const out = {} as Record<ArchitectureKey, string>;
  for (const key of ARCHITECTURE_KEYS) out[key] = ARCHITECTURE_LABELS[key][lang];
  return out;
}

/** One /architecture label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`);
 *  a sub-`Record<…>` roster makes the unknown-key arm unreachable from typed code, which is why the
 *  black-box test reads the roster directly and the throw is asserted through it. */
export function architectureLabel(
  key: ArchitectureKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(ARCHITECTURE_LABELS, key) ? ARCHITECTURE_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown architecture key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

// ── ROW 13: the /doc + /tasks + /task/<id> RESIDUAL EDGE-STATE copy ──────────────────────────────
// (gap-webui-doc-tasks-residual-copy-en-zh)
//
// ROW 5 did this for /dashboard, ROW 10 for /journal, ROW 11 for /board and ROW 12 for
// /architecture; this is the series' FIFTH table and it obeys ROW 6/ROW 7/ROW 8 unchanged (one row
// per RENDERED string, `{name}` templates filled by `fillLabel`, the zh column byte-equal to the
// pre-extraction literal, a CLOSED roster, an unknown key THROWS).
//
// WHY THIS TABLE IS THE SERIES' ODD ONE: the four page tables each cleared a page that was FULL of
// Chinese body copy. By the time this task ran, /doc, /tasks and /task/<id> had no Chinese at all on
// the URL anyone would grab — the residue was five strings that render ONLY in edge states (a store
// read failure, a task file with no id, a file whose frontmatter will not parse, the Runs block with
// no records, and its in-flight row). The consequence is methodological, not cosmetic: the series'
// standing baseline — "count the CJK lines under `lang=en`" — is ZERO before this change and zero
// after, so it cannot witness this table at all. The red baseline for ROW 13 is a FIXTURE that makes
// each of the five states actually render (see the test file's `before()`), which is the only shape
// in which this copy is reachable (硬规则 4: a reading that cannot take the other value is not one).
//
// WHY ONE TABLE FOR TWO PAGES (the task's own ruling, recorded here because a later reader will
// wonder): `serve-task.ts` owns BOTH /tasks and /task/<id>, and the /doc half is a single string.
// Two tables would put both under the same `serve-i18n.ts` Touches lock anyway while inventing a
// second roster shape for one row's benefit. The unit stays the RENDERED STRING (ROW 5), so the
// table's name is where the copy LIVES, not a boundary claim about pages.
//
// ① A PARAMETER MAY BE PRE-ESCAPED MARKUP, AND THAT IS THE COMPLIANT DIRECTION. Three of these rows
//    wrap live data in an element the CALLER owns: `⚠ <code>{file}</code> — 解析失败: …`, the
//    `<code>`-wrapped carrier path inside the Runs empty state, and the missing-id row's cell (a
//    link when the task has an id, escaped text when it does not). ROW 6 forbids the DICTIONARY
//    carrying markup; it does not forbid the caller assembling it. So the caller passes the
//    already-`escapeHtml`'d, already-wrapped fragment in as the parameter and emits the filled
//    string RAW — the same idiom as ROW 5's `gitReadFailedWithReason` (serve-dashboard.ts, which
//    calls `fillLabel(L.gitReadFailedWithReason, { reason: escapeHtml(cap) })`). The alternative —
//    embedding `<code>`/`<a>` in the label — is what ROW 12 ① split three separate rows to AVOID.
//
// ② THE zh COLUMN IS THE PRE-EXISTING LITERAL, BYTE FOR BYTE — brackets included. English needs
//    ASCII `(` `)` and a half-width `:`; Chinese had full-width `（` `）` and a half-width `:` (the
//    error banner's colon really is ASCII today, which is why `docReadFailed` ends in `:` in BOTH
//    columns rather than being "corrected" here). ⛔ The brackets are INSIDE the label in both
//    columns, never concatenated at the call site: a call site assembling `（` + path + `）` would be
//    a language-bearing fragment outside the dictionary, which is the exact shape ROW 6 removes.
//
// ⚠️ NOT IN THIS ROW, and why (each a judgement, not an omission):
//   - The Runs table's `<th>` headings (`started`/`state`/`exit`/`wall`/`worker pid`/`run id`/
//     `transcript`/`fan-in`) and `renderFanInCell`'s `landed`/`red`/`step`/`lock`/`suite`/`sha`
//     tokens are ALREADY English in both languages and pass through no dictionary. Translating them
//     would change `lang=zh` output, which AC3 forbids. They are /task/<id>'s named residue.
//   - The detail page's CHROME (`<html lang="en">`, `renderSiteNav("tasks")` with no `lang`,
//     `renderMobileChrome` likewise) is deliberately NOT wired here: AC-290 registered it as
//     out-of-scope residue ("the DETAIL page … is not one of the 15 nav routes"), and this task's
//     criterion is the five edge-state strings, not the detail page's frame. Under `?lang=zh` the
//     Runs block switches while the surrounding chrome stays English — that is the registered
//     residue, visible and named, not a silent half-migration.
//   - `m.error` and the `<code>`-wrapped carrier PATH are DATA (a YAML parser's diagnostic, a file
//     path). They ride in as parameters and are `escapeHtml`'d verbatim in both languages.
export const DOC_TASK_KEYS = [
  // /doc — the store read-failure banner (serve-doc.ts, the `<strong>` of the `.error-banner`)
  "docReadFailed",
  // /tasks — the two `.malformed-row` placeholders
  "taskMissingId", "taskParseFailed",
  // /task/<id> — the Runs block's two states
  "runsNoRecords", "runInFlight",
] as const;

export type DocTaskKey = (typeof DOC_TASK_KEYS)[number];

/** The /doc + /tasks + /task/<id> residual edge-state dictionary — see ROW 13 (and ROW 5~8, which it
 *  obeys unchanged). */
export const DOC_TASK_LABELS: Record<DocTaskKey, { en: string; zh: string }> = {
  // The `<strong>` of /doc's read-failure banner. ⚠️ `:` is ASCII in the zh column because it is
  // ASCII in the pre-extraction literal (`<strong>读失败:</strong>`) — see ROW 13 ②.
  docReadFailed: { en: "Read failed:", zh: "读失败:" },

  // The `.malformed-row` for a task whose frontmatter carries no `id:` (the provider falls back to
  // the file name and flags the task). `{id}` is the caller's cell — a `/task/<id>` link when an id
  // exists, escaped display text when it does not (ROW 13 ①).
  taskMissingId: { en: "⚠ {id} — missing id field", zh: "⚠ {id} — 缺少 id 字段" },
  // The `.malformed-row` for a file whose frontmatter will not parse at all. `{file}` is the
  // `<code>`-wrapped file name; `{error}` is the parser's diagnostic (DATA, escaped, untranslated).
  taskParseFailed: { en: "⚠ {file} — parse failed: {error}", zh: "⚠ {file} — 解析失败: {error}" },

  // The Runs block when there is neither a record nor a live worker. `{carrier}` is the
  // `<code>`-wrapped path — DATA. ⚠️ The brackets are INSIDE the row in both columns (ROW 13 ②).
  runsNoRecords: {
    en: "No worker runs recorded ({carrier})",
    zh: "无 worker 运行记录（{carrier}）",
  },
  // The Runs row for a worker that is live right now (no END record yet). ⛔ NOT folded into ROW 5's
  // `running` ("Running"/"运行中"): a different zh word, a different table and a different page — the
  // series' rule that a shared row makes one page's next re-wording move another page's copy.
  runInFlight: { en: "In progress", zh: "进行中" },
};

/** The whole ROW 13 roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `DOC_TASK_LABELS` at each call site. */
export function docTaskLabelsFor(lang: Lang = DEFAULT_LANG): Record<DocTaskKey, string> {
  const out = {} as Record<DocTaskKey, string>;
  for (const key of DOC_TASK_KEYS) out[key] = DOC_TASK_LABELS[key][lang];
  return out;
}

/** One ROW 13 label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`). */
export function docTaskLabel(
  key: DocTaskKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(DOC_TASK_LABELS, key) ? DOC_TASK_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown doc-task key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

// ── ROW 14: the /system BODY copy (gap-webui-system-body-copy-en-zh) ─────────────────────────────
//
// ROW 5 did this for /dashboard, ROW 10 for /journal, ROW 11 for /board, ROW 12 for /architecture
// and ROW 13 for /doc + /tasks + /task/<id>; this is the series' SIXTH table and it obeys ROW 6/ROW
// 7/ROW 8 unchanged (one row per RENDERED string, `{name}` templates filled by `fillLabel`, the zh
// column byte-equal to the pre-extraction literal, a CLOSED roster, an unknown key THROWS).
//
// THE PAGE'S SHAPE: /system is the series' SMALLEST page after /board — six rows. That is the whole
// reason it needs its own comment rather than none: AC-293 already wired this page's CHROME (the
// `<html lang>` attribute, the shared nav bar, the `<title>` and the `<h1>`'s page NAME), so the
// residue here is exactly the part of the page that was left over — the `<title>`/`<h1>` SUBTITLE
// (`— 系统状态`, which AC-293 could not see: it wired `pageNameFor("System")`, and the subtitle was
// concatenated outside it), the two `<p class="meta">` notes, the resource banner's verdict text,
// and the meter bar's unknown-limit marker.
//
// ① A PARAMETER MAY BE PRE-ESCAPED MARKUP (ROW 13 ①'s rule, reused). Two rows here wrap live data
//    in an element the CALLER owns: `dataSourceNote`'s two `<code>` elements and `thresholdNote`'s
//    `<code>nproc</code>`. ROW 6 forbids the DICTIONARY carrying markup; it does not forbid the
//    caller assembling it, so the caller passes the already-wrapped fragment in as the parameter
//    and emits the filled string RAW. ⛔ The alternative — moving the `<code>` elements out to the
//    call site — would put the ` · ` separator and the ( ) brackets outside the dictionary, i.e.
//    language-bearing fragments at a call site, which is the exact shape ROW 6/ROW 13 ② remove.
//
// ② THE BANNER'S LEADING SEPARATOR IS INSIDE THE ROW. `bannerGo`/`bannerWait` are the text AFTER
//    the `<strong>⇒ GO</strong>` verdict token, and the colon that joins them is language-bearing
//    (zh full-width `：`, en ASCII `: `) — so it lives in the row, exactly as ROW 13 ② keeps the
//    brackets in the row. The verdict TOKEN itself (`GO`/`WAIT`) stays in the markup: it is the
//    machine's own word (the `verdict` field of `resource-gate.sh --json`), not copy, and it reads
//    the same in both languages.
//
// ③ THE PAGE NAME AND THE SUBTITLE ARE PARALLEL, NOT MERGED (this task's ruling). `pageTitle`
//    receives the bare `System` token and its suffix is appended OUTSIDE it, so the NAME resolves
//    through ROW 3's `PAGE_LABELS` and the SUBTITLE through this table: each table owns one piece
//    and neither is a copy of the other. ⛔ Passing a PRE-LOCALIZED composite token
//    (`${pageNameFor("System", lang)} — …`) would make ROW 3's lookup MISS under zh and silently
//    return the token it was handed — the composite would render correctly by falling through the
//    dictionary rather than by being found in it (硬规则 3b: a lookup that misses must not be
//    indistinguishable from one that hit). The legacy composite row
//    `PAGE_LABELS["System — 系统状态"]` is therefore RETIRED here: its zh value lives on as
//    `pageSubtitle` + ROW 3's `System`, and leaving the row would be a second, unread copy.
//
// ④ ⚠️ NOT IN THIS ROW, and why (each a judgement, not an omission):
//    - `/manager` shares `serve-system.ts` but is a DIFFERENT page with its own task
//      (gap-webui-manager-body-copy-en-zh). Its body copy is deliberately untouched here.
//    - The meter TABLES' row labels (`cpu_stall (avg10)`, `mem_avail`, `total_budget`, `verdict`,
//      the `nproc×2≈32` captions) are the mechanism scripts' JSON field names and units — data,
//      already ASCII, and translating them would change `lang=zh` output, which AC3 forbids.
//    - `pageTitle`'s no-identity fallback (`未接入项目身份 — …` in serve-render.ts) renders only
//      when identity resolution fails; it is shared chrome owned by the same series' residue list
//      (registered by gap-webui-dashboard-body-copy-en-zh), ⛔ not this page's to move.
//    - `readSystem`'s diagnostics (`obsNote`'s reason strings, e.g. 「system 机制脚本缺失」) are
//      DATA: a reader's own description of what it could not read, rendered verbatim in both
//      languages — the same class as a task title.
export const SYSTEM_KEYS = [
  // the <title>/<h1> subtitle (appended after the ROW 3 page name)
  "pageSubtitle",
  // the two <p class="meta"> notes
  "dataSourceNote", "thresholdNote",
  // the resource banner's two verdict texts
  "bannerGo", "bannerWait",
  // the meter bar's unevaluable-denominator marker
  "unknownLimit",
] as const;

export type SystemKey = (typeof SYSTEM_KEYS)[number];

/** The /system body-copy dictionary — see ROW 14 (and ROW 5~8, which it obeys unchanged). */
export const SYSTEM_LABELS: Record<SystemKey, { en: string; zh: string }> = {
  // The `<h1>`/`<title>` subtitle. ⚠️ ROW 3 keeps the NAME (`System` / `系统`); this row is only the
  // tail after the em dash, which is why the two can be re-worded independently (ROW 14 ③).
  pageSubtitle: { en: "system status", zh: "系统状态" },

  // The `<p class="meta">` under the `<h1>`. `{gate}`/`{budget}` are the caller's `<code>`-wrapped
  // command names (ROW 14 ①) — DATA, escaped and untranslated.
  dataSourceNote: {
    en: "Data source: {gate} · {budget} (stable machine-readable JSON output)",
    zh: "数据源：{gate} · {budget}（稳定机读 JSON 输出）",
  },
  // The `<p class="meta">` under the process-budget table. `{nproc}` is the `<code>nproc</code>`
  // element (ROW 14 ①).
  thresholdNote: {
    en: "Thresholds are computed from {nproc} at render time — this page never hard-codes the numbers of the machine it happens to run on.",
    zh: "阈值按 {nproc} 动态计算显示，不写死当前机器上的数字。",
  },

  // The resource banner's two tails — ⚠️ the joining colon is INSIDE the row (ROW 14 ②).
  bannerGo: { en: ": resources sufficient, safe to run", zh: "：资源充足，可以跑" },
  bannerWait: { en: ": resources constrained, waiting", zh: "：资源受限，等待" },

  // The meter bar's marker for a value with no evaluable denominator. ⛔ NOT folded into ROW 5's
  // `identityNotEvaluated` (「未评估（缺一侧读数）」): a different word, a different table, a
  // different page — the series' rule that a shared row makes one page's next re-wording move
  // another page's copy.
  unknownLimit: { en: "(unknown limit)", zh: "（未知上限）" },
};

/** The whole ROW 14 roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `SYSTEM_LABELS` at each call site. */
export function systemLabelsFor(lang: Lang = DEFAULT_LANG): Record<SystemKey, string> {
  const out = {} as Record<SystemKey, string>;
  for (const key of SYSTEM_KEYS) out[key] = SYSTEM_LABELS[key][lang];
  return out;
}

/** One ROW 14 label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`). */
export function systemLabel(
  key: SystemKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(SYSTEM_LABELS, key) ? SYSTEM_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown system key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

// ── ROW 15: the /sessions + /session/<id> BODY copy (gap-webui-sessions-body-copy-en-zh) ─────────
//
// ROW 5 did this for /dashboard, ROW 10 /journal, ROW 11 /board, ROW 12 /architecture, ROW 13
// /doc+/tasks+/task/<id> and ROW 14 /system; this is the series' SEVENTH table and it obeys ROW
// 5~8 (one row per RENDERED string, `{name}` templates filled by `fillLabel`, the zh column
// byte-equal to the pre-extraction literal, a CLOSED roster, an unknown key THROWS) unchanged.
//
// TWO PAGES, ONE FILE, ONE TABLE. `serve-sessions.ts` renders BOTH the `/sessions` list and the
// `/session/<sessionId>` detail view, and the task's census ("非注释中文行 24 条") is a FILE
// measurement — so the roster below covers both pages rather than the list alone. Splitting them
// into two tables would put two pages' copy in one file's dict anyway; keeping one table is what
// makes the census checkable line by line.
//
// ① THE TITLE AND THE `<h1>` CARRY DIFFERENT SUBTITLES HERE — hence TWO rows, not ROW 14's one.
//    `/system`'s `<title>` and `<h1>` share `系统状态`. `/sessions`'s do NOT: the `<title>` says
//    `会话观测` while the `<h1>` says the louder `会话观测（运行中 + 已结束）`. ⛔ Collapsing them
//    into one row would silently shorten the `<h1>` — the two are re-wordable independently, and a
//    single row would make one page's future re-wording move the other site.
//
// ② THE COMPOSITE `PAGE_LABELS` ROWS ARE RETIRED (ROW 14 ③'s ruling, applied here). The page used
//    to pass `"Sessions — 会话观测"` / `"Sessions — 会话观测（运行中 + 已结束）"` to `pageTitle` /
//    `pageNameFor`. That structure CANNOT be localized: `pageNameFor` returns its argument
//    UNCHANGED for `en` (ROW 3: "en is the identity"), so the en column of those rows was never
//    read and the composite rendered its own Chinese under both languages. The page now passes the
//    bare `Sessions` token (ROW 3's new row) and appends the subtitle from THIS table — two
//    parallel lookups, each of which is actually read in both languages. The retired rows' zh
//    values live on as `pageSubtitle` + `h1Subtitle` + ROW 3's `Sessions`; leaving them would be a
//    second, unread copy (the series' single-source rule).
//
// ③ PARAMETERS ARE PRE-ESCAPED MARKUP WHERE THE CALLER OWNS AN ELEMENT (ROW 14 ①, reused). The
//    data-source notes wrap command names / a transcript path in `<code>`, `refusedStateRecord`
//    carries the shared schema's own verdict text, and `lifecycleNote` wraps three commands. The
//    dictionary never carries markup; the caller assembles the fragment and emits the filled
//    string RAW. The words BETWEEN those fragments stay in the row, so no language-bearing
//    punctuation or connector lives at a call site.
//
// ④ THE CLIENT-SIDE SCRIPT'S STRING IS A ROW TOO (the series' ⑦). The detail page's scroll loader
//    rewrites the sentinel node with `更早的 transcript 超出读取窗口 — <a…>下载完整 transcript</a>`
//    when it runs past the read window. That string is built in the BROWSER, so a server-side
//    render can only localize it by INLINING the words as JS string literals — which is what
//    `handleSession` does via `JSON.stringify`. ⛔ Two rows rather than one because the `<a href>`
//    carries the RUNTIME sessionId and must be concatenated in the browser; `earlierBeyondWindow`
//    therefore ends at the em dash (trailing space included — it is inside the row, exactly as
//    ROW 14 ② keeps the joining colon inside its rows).
//
// ⑤ THE POST HANDLERS ARE IN THE ROSTER, because their JSON `reason` is what the browser SHOWS
//    after a native form submit (the three lifecycle forms POST without JS; the response body IS
//    the next page). They are the one class of copy a single GET probe can never see (ROW 13's
//    lesson), which is why the task asserts them separately. The handlers receive the per-request
//    `lang` the dispatcher already resolved — ⛔ they must not re-parse `?lang=`/the cookie (a
//    second parse is a second decision table reading a different request's inputs).
//
// ⑥ NOT IN THIS ROW, and why (each a judgement, not an omission):
//    - `obsNote`'s state words (`未接入/无数据`, `读失败`, …) are SHARED chrome: one function in
//      `serve-render.ts` renders them on EVERY page, so they belong to the series' residue list
//      (registered by gap-webui-dashboard-body-copy-en-zh) and not to this page.
//    - `pageTitle`'s no-identity fallback (`未接入项目身份 — …`) is the same class, and ROW 14 ④
//      already assigned it to that residue list.
//    - `renderSendForm` (`serve-send.ts`) renders a Chinese delivery form INSIDE the detail page.
//      It is a DIFFERENT module with its own POST surface and is not in this task's Touches.
//    - `SESSION_LAYERS`' headings live in `observation.ts` (a shared session primitive, not in
//      Touches). The `Other / 未分类` heading is nevertheless THIS page's `<h2>`, so it is
//      localized at the RENDER SITE through `layerOther` — observation.ts is untouched and the
//      roster stays closed. `Manager`/`Outer`/`Inner` are ASCII and unchanged.
//    - Session names, transcript text, the machine's `session.lifecycle=`/`session.activity=`
//      field names and the shared schema's refusal DETAIL are DATA: a reader's own content and
//      the machine's own words, rendered verbatim in both languages.
//    - The detail page's `<html lang>` attribute and its nav/mobile-chrome are CHROME (the
//      AC-290~303 family), untouched here: this table is BODY copy. Switching them would move the
//      `lang=zh` baseline this task's third criterion diffs.
export const SESSIONS_KEYS = [
  // list page: <title> + <h1> subtitles (① — two rows, they are not the same string)
  "pageSubtitle", "h1Subtitle",
  // list page: <head> meta description
  "metaDescription",
  // list page: <p class="meta"> data-source note, the per-layer empty state, the GONE fold's summary
  "dataSourceNote", "noLiveSessions", "goneSummary",
  // the four per-layer <h2> headings (⑥ — the rows live here, the layer table stays in observation.ts)
  "layerManager", "layerOuter", "layerInner", "layerOther",
  // the session card's two states: refused record / deferred transcript read
  "refusedStateRecord", "transcriptDeferredHint",
  // the session-state line's age annotation
  "sessionAgeSuffix",
  // the lifecycle section: heading, note, three submit buttons, five placeholders
  "lifecycleHeading", "lifecycleNote", "driverSubmit",
  "newSessionSubmit", "resumeSubmit",
  "newProfilePlaceholder", "resumeProfilePlaceholder",
  "newPermissionModePlaceholder", "resumePermissionModePlaceholder", "sessionIdPlaceholder",
  // detail page: meta description, back link, data-source note
  "detailMetaDescription", "detailBackLink", "detailDataSourceNote",
  // detail page: transcript heading (+ its "showing the most recent N" suffix), the loading marker
  "transcriptHeading", "transcriptHeadingRecentSuffix", "loadingEarlier",
  // detail page: the scroll loader's two browser-side strings (④)
  "earlierBeyondWindow", "downloadFullTranscript",
  // POST feedback (⑤): the three lifecycle endpoints' 400 reasons
  "newSessionInvalid", "resumeSessionInvalid", "earlierInvalidSessionId",
] as const;

export type SessionsKey = (typeof SESSIONS_KEYS)[number];

/** The /sessions + /session/<id> body-copy dictionary — see ROW 15 (and ROW 5~8, which it obeys). */
export const SESSIONS_LABELS: Record<SessionsKey, { en: string; zh: string }> = {
  // ① the <title>'s subtitle (after ROW 3's page NAME + the em dash)
  pageSubtitle: { en: "session observation", zh: "会话观测" },
  // ① the <h1>'s subtitle — a DIFFERENT string from the row above, deliberately
  h1Subtitle: { en: "session observation (running + finished)", zh: "会话观测（运行中 + 已结束）" },

  metaDescription: {
    en: "Quay sessions — running + finished sessions",
    zh: "Quay sessions — 运行中 + 已结束会话",
  },

  // ③ `{agents}` / `{flag}` are the caller's `<code>`-wrapped command names — DATA, untranslated.
  dataSourceNote: {
    en: "Data source: {agents} (running · interactive + {flag}) + transcript directory scan (finished) + session transcript tail",
    zh: "数据源：{agents}（运行中 · 交互式 + {flag}）+ transcript 目录扫描（已结束）+ 会话 transcript 尾部",
  },
  noLiveSessions: { en: "No running sessions", zh: "无运行中会话" },
  // `{n}` is the GONE count — a number, interpolated raw.
  goneSummary: { en: "Finished sessions (GONE · {n})", zh: "已结束会话（GONE · {n}）" },
  // ⑥ the four layer `<h2>`s. ⚠️ The first three are identical in both columns ON PURPOSE: they
  // ARE the same word in both languages, and a dictionary is not improved by hiding that. The
  // FOURTH is why the roster exists — `Other` is the layer KEY (data-ish, ASCII) while its heading
  // carries a word.
  layerManager: { en: "Manager", zh: "Manager" },
  layerOuter: { en: "Outer", zh: "Outer" },
  layerInner: { en: "Inner", zh: "Inner" },
  layerOther: { en: "Other / uncategorised", zh: "Other / 未分类" },

  // ③ `{detail}` is the shared session-schema's own refusal text, PRE-ESCAPED by the caller.
  refusedStateRecord: {
    en: "State record unusable (rejected by the shared schema): {detail}",
    zh: "状态记录不可用（共享 schema 拒收）：{detail}",
  },
  transcriptDeferredHint: {
    en: "transcript is read on demand on the detail page — click to view",
    zh: "transcript 在详情页按需读取 — 点击查看",
  },

  // The session-state line's age annotation. ⚠️ Full-width parens in zh, ASCII in en — the ONLY
  // difference, which is why it is a row and not a call-site literal: the parens are typography
  // belonging to the language, not to the number they wrap.
  sessionAgeSuffix: { en: " (age {n}s)", zh: "（age {n}s）" },

  lifecycleHeading: { en: "Session lifecycle (headless)", zh: "会话生命周期（headless）" },
  // ③ `{driver}` / `{new}` / `{resume}` are `<code>`-wrapped commands (DATA); the ⛔ and the
  // sentence around them are copy.
  lifecycleNote: {
    en: "The driver reuses {driver}; new = {new}; restart = {resume}. ⛔ Interactive manager/outer/inner are not exposed here. Submissions return JSON.",
    zh: "driver 复用 {driver}；新建 = {new}；重启 = {resume}。⛔ 交互式 manager/outer/inner 不在此暴露。提交结果为 JSON。",
  },
  driverSubmit: { en: "Driver action", zh: "driver 操作" },
  newSessionSubmit: { en: "New session", zh: "新建会话" },
  resumeSubmit: { en: "Restart session (--resume)", zh: "重启会话（--resume）" },

  // Form placeholders. ⚠️ FOUR rows for what looks like two fields: the new-session form and the
  // resume form render DIFFERENT strings for the same input (`profile（role 名，必填）` vs
  // `profile（role 名）`; `权限模式（必填，无默认）` vs `权限模式（必填）`). ⛔ Collapsing either
  // pair into one row would have silently re-worded the resume form — ROW 5's `readFailed`
  // "one row, two call sites" licence applies ONLY when the rendered bytes are identical, and here
  // they are not (verified against `git show HEAD:packages/quay/src/serve-sessions.ts`, not by
  // eye: the two differ by the trailing `，无默认` / `，必填` clause).
  newProfilePlaceholder: { en: "profile (role name, required)", zh: "profile（role 名，必填）" },
  resumeProfilePlaceholder: { en: "profile (role name)", zh: "profile（role 名）" },
  newPermissionModePlaceholder: { en: "permission mode (required, no default)", zh: "权限模式（必填，无默认）" },
  resumePermissionModePlaceholder: { en: "permission mode (required)", zh: "权限模式（必填）" },
  sessionIdPlaceholder: { en: "session-id (UUID)", zh: "session-id（UUID）" },

  detailMetaDescription: { en: "Quay session — single session view", zh: "Quay session — 单一会话视图" },
  // The `Sessions` on the end is the destination page's NAME (ROW 1/ROW 3's word), not a row here.
  detailBackLink: { en: "← Back to Sessions", zh: "← 返回 Sessions" },
  // ③ `{path}` is the caller's `<code>`-wrapped transcript path (escaped entities included).
  detailDataSourceNote: {
    en: "Data source: {path} (transcript tail, not real-time)",
    zh: "数据源：{path}（transcript 尾部，非实时）",
  },

  // ③ `{n}` = turn count; `{suffix}` is this table's own `transcriptHeadingRecentSuffix` (empty
  // when every turn fits). ⛔ Keeping the closing bracket INSIDE the row is deliberate: the
  // parenthetical is part of the sentence, not a call-site decoration.
  transcriptHeading: {
    en: "Transcript ({n} messages · old→new{suffix})",
    zh: "Transcript（{n} 条消息 · 旧→新{suffix}）",
  },
  transcriptHeadingRecentSuffix: { en: ", showing the most recent {k}", zh: "，默认显示最近 {k} 条" },
  loadingEarlier: { en: "Loading earlier messages…", zh: "加载更早消息…" },

  // ④ the two browser-side strings. ⚠️ `earlierBeyondWindow`'s TRAILING SPACE is part of the row:
  // the browser concatenates the `<a>` immediately after it.
  earlierBeyondWindow: { en: "the earlier transcript is beyond the read window — ", zh: "更早的 transcript 超出读取窗口 — " },
  downloadFullTranscript: { en: "download the full transcript", zh: "下载完整 transcript" },

  // ⑤ the POST feedback (see ROW 15 ⑤)
  newSessionInvalid: {
    en: "profile and permissionMode are both required (⛔ permission mode has no default)",
    zh: "profile 与 permissionMode 均必填（⛔ 权限模式无默认值）",
  },
  resumeSessionInvalid: {
    en: "sessionId must be a valid UUID, and profile and permissionMode are both required",
    zh: "sessionId 须为合法 UUID，且 profile 与 permissionMode 均必填",
  },
  earlierInvalidSessionId: { en: "invalid sessionId (must be a UUID)", zh: "sessionId 非法（须为 UUID）" },
};

/** The whole ROW 15 roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `SESSIONS_LABELS` at each call site. */
export function sessionsLabelsFor(lang: Lang = DEFAULT_LANG): Record<SessionsKey, string> {
  const out = {} as Record<SessionsKey, string>;
  for (const key of SESSIONS_KEYS) out[key] = SESSIONS_LABELS[key][lang];
  return out;
}

/** One ROW 15 label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`). */
export function sessionLabel(
  key: SessionsKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(SESSIONS_LABELS, key) ? SESSIONS_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown sessions key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

/** The LAYER → ROW map behind `sessionLayerHeading`. All FOUR of `SESSION_LAYERS`' headings are
 *  RENDERED strings (the page emits each as an `<h2>`), so all four get a row — three of them with
 *  identical columns because `Manager`/`Outer`/`Inner` really are the same word in both languages.
 *  ⛔ Not collapsing those three into "return the layer name" is deliberate: the roster stays
 *  CLOSED (ROW 8), so a later re-wording of, say, the Inner heading is a one-line change HERE
 *  instead of a code change at a render site. */
const SESSION_LAYER_ROWS: Record<string, SessionsKey> = {
  Manager: "layerManager",
  Outer: "layerOuter",
  Inner: "layerInner",
  Other: "layerOther",
};

/** The `<h2>` for one session layer on the /sessions page. `heading` is the shared layer table's
 *  own value, returned unchanged for a layer this dictionary does not know — an unmapped layer
 *  renders its caller's string rather than a blank (硬规则 6: 缺值 = 未查, never a fabricated
 *  label). */
export function sessionLayerHeading(
  layer: string,
  heading: string,
  lang: Lang = DEFAULT_LANG,
): string {
  const key = Object.prototype.hasOwnProperty.call(SESSION_LAYER_ROWS, layer) ? SESSION_LAYER_ROWS[layer] : undefined;
  return key === undefined ? heading : SESSIONS_LABELS[key][lang];
}

// ── ROW 16: the /manager BODY copy (gap-webui-manager-body-copy-en-zh) ───────────────────────────
//
// ROW 5 did this for /dashboard, ROW 10 /journal, ROW 11 /board, ROW 12 /architecture, ROW 13
// /doc+/tasks+/task/<id>, ROW 14 /system and ROW 15 /sessions; this is the series' EIGHTH table and
// it obeys ROW 5~8 unchanged (one row per RENDERED string, `{name}` templates filled by
// `fillLabel`, the zh column byte-equal to the pre-extraction literal, a CLOSED roster, an unknown
// key THROWS).
//
// ⚠️ ROW 14 ④ recorded that /manager "shares serve-system.ts but is a DIFFERENT page with its own
// task". This row IS that task. The two tables are PEERS, not renames of one another, and the file
// they share is why the census behind this task was taken per RENDER FUNCTION rather than per file:
// `serve-system.ts`'s 17 non-comment CJK lines are 6 for /system (ROW 14) + 11 for /manager (here),
// and a file count alone cannot tell which row a given line belongs to.
//
// THE PAGE'S SHAPE: /manager answers "what are the three layers doing?" — four `<h2>` sections
// (Loop/会话, Monitor 注册表, 主要观测指标, plus the `<h1>`'s own subtitle), each with a
// `<p class="meta">` naming where its reading comes from, two table headers, and the release line.
// Its body copy is EXACTLY 11 rendered strings — the 11 non-comment CJK lines of `renderManagerPage`
// — one row each. That 1:1 correspondence is deliberate: it makes the roster checkable against the
// SOURCE, rather than against a feeling that the page "looks translated".
//
// ① THE `<h1>` SUBTITLE IS A ROW, THE PAGE NAME IS NOT (ROW 14 ③'s ruling, applied here). The page
//    passes the bare `Manager / Outer / Inner` token to `pageNameFor` (ROW 3) and appends its tail
//    from THIS table: two parallel lookups, each actually read in both languages. ⛔ Passing a
//    pre-localized composite to ROW 3 would make the lookup MISS under zh and render correctly by
//    falling through the dictionary — 硬规则 3b's silent shape, where a miss and a hit look alike.
//    ⚠️ The row is named `h1Subtitle` and not ROW 14's `pageSubtitle` because HERE it renders in the
//    `<h1>` ONLY: this page's `<title>` is the bare page token, with no subtitle at all — the exact
//    inverse of ROW 15, where the `<title>` and the `<h1>` each carry one.
//
// ② THE `<meta name="description">` IS IN THE ROSTER even though the census that produced these keys
//    cannot see it: it lives in an ATTRIBUTE, so a probe that strips tags and counts text lines — the
//    series' AC1 red-baseline probe — never reads it. It is still copy a reader meets (search
//    results, the tab's own tooltip), and ROW 14 and ROW 15 each carry the same row. Leaving it out
//    would mean the page's localization was measured by an instrument blind to it (硬规则 4b).
//
// ③ PARAMETERS ARE PRE-ESCAPED MARKUP WHERE THE CALLER OWNS AN ELEMENT (ROW 14 ①, reused).
//    `registryNote` and `poolSourceNote` each wrap a file path in `<code>`; the dictionary never
//    carries markup, so the caller assembles the fragment and emits the filled string RAW. The words
//    BETWEEN those fragments stay in the row, so no language-bearing punctuation or connector lives
//    at a call site. `releaseLine` shows why that matters: the ` · ` separator AND the word order of
//    「develop 领先 {n} 提交」 are both inside the row — a call site concatenating 「领先 」+n+「 提交」
//    would be a sentence only Chinese word order can assemble, with the en column unfixable without
//    editing the call site.
//
// ④ TWO ROWS ARE LATENT, and are rows here BECAUSE they are: a healthy single-response probe cannot
//    see either (ROW 13's lesson — the same reason ROW 14's `unknownLimit` exists).
//      - `colSession` renders only when the liveness reader returns ≥1 session row (it is retired
//        today, so nothing on the live page reaches it);
//      - `recentPromotions` renders only when the pool reader's `lastPromoted` is non-empty.
//    Both were found by reading the RENDER FUNCTION, not the rendered page. A roster built only from
//    what a probe happens to show would omit them and stay green forever after (硬规则 3b).
//
// ⑤ NOT IN THIS ROW, and why (each a judgement, not an omission):
//    - `obsNote`'s state words (`未接入/无数据`, `已接入/暂无记录`, `读失败`) are SHARED chrome: one
//      function in serve-render.ts renders them on EVERY page, and ROW 15 ⑥ assigned them to the
//      series' shared residue list. This page echoes three of them (`loopDriver`, `liveness`, `pool`),
//      which is exactly why this task's own census — a count of CJK lines in the RESPONSE — listed
//      them: a per-response count cannot distinguish a page's own copy from the shared chrome the page
//      renders. ⛔ Localizing them from here would move seven other pages' `lang=en` output and red
//      `serve-architecture-body-i18n.test.mjs`, whose empty-state arm asserts this residue is STILL
//      Chinese — a guard written precisely so that a later "translate everything" pass cannot do it by
//      accident. This task's dedup note asked whether to add a page-local row for the word; the answer
//      recorded here is NO, and for ROW 9's reason: a second copy of a shared word is the drift a
//      shared table exists to prevent. The word's home is a shared-chrome row of its own.
//    - The reader DIAGNOSTIC after that prefix (`— …/loop-driver-check.sh 缺失（…）`,
//      `— .quay/promotion-round.jsonl 尚无 round 记录（…）`) is DATA: a reader's own description of
//      what it could not read, rendered verbatim in both languages — the same class as a task title.
//    - The observer TABLE's rows (`name`/`status`/`root`/`note`) are DATA read out of
//      `orchestration/observer-registry.conf`; this repo's own registry carries Chinese notes
//      (`本仓库（项目类）`, `兄弟项目`), and translating them would be translating the user's registry.
//    - The two JSON field-name `<h2>`s (`resource-gate.sh` / `process-budget.sh`) and the meter
//      labels are /system's (ROW 14 ④) and are untouched from this side too.
export const MANAGER_KEYS = [
  // <head> meta description (②) + the <h1>'s subtitle tail (①)
  "metaDescription", "h1Subtitle",
  // the page's intro note under the <h1>, and the three section headings
  "probeNote", "headingLoop", "headingObservers", "headingPool",
  // the two <p class="meta"> provenance notes (③ — one `{file}` parameter each)
  "registryNote", "poolSourceNote",
  // the release line (③ — `{version}` + `{n}`)
  "releaseLine",
  // latent rows (④): the liveness table's first column header, the pool card's promotion list
  "colSession", "recentPromotions",
] as const;

export type ManagerKey = (typeof MANAGER_KEYS)[number];

/** The /manager body-copy dictionary — see ROW 16 (and ROW 5~8, which it obeys unchanged). */
export const MANAGER_LABELS: Record<ManagerKey, { en: string; zh: string }> = {
  metaDescription: {
    en: "Quay manager — Manager / Outer / Inner three-layer status",
    zh: "Quay manager — Manager/Outer/Inner 三层状态",
  },

  // ① the `<h1>`'s tail, after ROW 3's page NAME. ⚠️ ROW 3 keys on the bare `Manager / Outer /
  // Inner` token; this row is only the part after the em dash (which the render site keeps, as ROW
  // 14 does), so the two can be re-worded independently.
  h1Subtitle: { en: "three-layer status", zh: "三层状态" },

  probeNote: {
    en: "Three-layer adaptive probing: multi-signal weighted verdicts; a missing signal is honestly marked as not detected rather than silently assumed.",
    zh: "三层自适应探测：多信号加权判定，缺失信号诚实标注「未检测到」，不静默假设。",
  },

  // The three `<h2>`s. `Loop` / `Monitor` stay ASCII — they are the mechanism's own names for the
  // things being observed, and the row is the WHOLE heading so the `/` separator sits inside it.
  headingLoop: { en: "Loop / sessions", zh: "Loop / 会话" },
  headingObservers: { en: "Monitor registry", zh: "Monitor 注册表" },
  headingPool: { en: "Primary observability metrics", zh: "主要观测指标" },

  // ③ `{file}` is the caller's `<code>`-wrapped path — DATA, escaped and untranslated.
  registryNote: {
    en: "Reads the single registration table {file}.",
    zh: "读 {file} 单一登记表。",
  },
  poolSourceNote: {
    en: "pool/floor/deficit/cap are read from {file} (promotion-driver round records; cap defaults to 5, floor = cap × 4)",
    zh: "pool/floor/deficit/cap 读 {file}（promotion-driver round 记录，cap 默认 5，floor = cap × 4）",
  },

  // ③ `{version}` is the build-time QUAY_VERSION, `{n}` the commit count — both DATA. ⛔ The
  // separator and the word order are INSIDE the row, never at the call site.
  releaseLine: {
    en: "release={version} · develop is {n} commits ahead",
    zh: "release={version} · develop 领先 {n} 提交",
  },

  // ④ latent rows — see the roster comment. `colSession` is one word because the other three
  // columns of that table (`alive` / `pid` / `halted`) are the reader's own field names, not copy.
  colSession: { en: "Session", zh: "会话" },
  recentPromotions: {
    en: "Most recent promotions (promotion-driver):",
    zh: "最近一轮晋升（promotion-driver）：",
  },
};

/** The whole ROW 16 roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `MANAGER_LABELS` at each call site. */
export function managerLabelsFor(lang: Lang = DEFAULT_LANG): Record<ManagerKey, string> {
  const out = {} as Record<ManagerKey, string>;
  for (const key of MANAGER_KEYS) out[key] = MANAGER_LABELS[key][lang];
  return out;
}

/** One ROW 16 label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`). */
export function managerLabel(
  key: ManagerKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(MANAGER_LABELS, key) ? MANAGER_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown manager key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

// ── ROW 17: the /git-history BODY copy (gap-webui-git-history-body-copy-en-zh) ──────────────────
//
// ROW 5 opened the body-copy series for /dashboard; this row is its SECOND page and obeys ROW 5~8
// unchanged (one row per RENDERED STRING; the zh column is the pre-existing literal byte for byte;
// `{name}` interpolation in BOTH columns, filled by `fillLabel`; the roster is closed and an unknown
// key THROWS). ⛔ It is a SEPARATE table rather than rows appended to DASHBOARD_LABELS for ROW 5's
// own reason: /dashboard's table cannot also be /git-history's without making a later re-wording of
// this page a cross-table edit on a table another page owns.
//
// ⚠️ THE TWO-KEY DUPLICATION IS REAL AND IS RECORDED, NOT HIDDEN. `readFailed` / `noData` below are
// byte-identical to DASHBOARD_LABELS's `readFailed` and the `未接入/无数据` half of
// `identityUnavailable` — the same rendered words on two pages. They are NOT folded into one shared
// row because they are not the same STRING in the two tables' full sense (the dashboard's is its
// commits card's, this one is a status note) and, more decisively, because the two pages' columns
// will be re-worded on different schedules. Same judgement, same note, as ROW 5's /live paragraph.
//
// ⚠️ WHAT THIS ROW DOES *NOT* OWN — measured, not assumed (AC1's red baseline of `/git-history` under
// `Cookie: lang=en` lists every visible Chinese line, and the 27 non-comment Chinese lines of
// serve-git.ts were classified one by one):
//   • the `<title>` token `"Git history — 任务分组"` (the KEY serve-git.ts passes to `pageTitle`) is
//     ALREADY dictionary-routed — through ROW 3's PAGE_LABELS, whose contract is "`en` is the
//     IDENTITY for every token". Its en rendering is that row's decision, not a hard-coded literal
//     this task may re-word (⛔ changing it would break ROW 3's identity contract, and the AC-297
//     test pins it).
//   • `history.reason` — the empty/error diagnostic — is produced by observation.ts and merely
//     ECHOED here. It is the same provenance class the /dashboard body-copy test excludes
//     (`readTests(root).reason`): a reader's own diagnostic, not copy this page authored. Its zh
//     values live in observation.ts, outside this task's Touches.
//   ⛔ The FALLBACK for that field (`history.reason ?? "git 仓库无提交记录"`) IS authored in
//     serve-git.ts and therefore IS this row's (`emptyRepoReason`).
//
// ⚠️ ROW 17b — THE CLIENT SCRIPT IS A DIFFERENT KIND OF CONSUMER. Four of this page's strings are
// rendered in the BROWSER (the two auto-load hints and the two coverage-span units): the graph is
// drawn client-side, so the server can concatenate no HTML for them and the browser has no
// dictionary to look them up in. Per ROW 6's rule they are resolved SERVER-side and injected into
// the inlined script as string constants (`gitHistoryClientLabelsFor`), never concatenated at the
// call site and never translated on the client. A caller that injects NOTHING gets a NEUTRAL
// placeholder (an ellipsis for the two hints, the bare number for the two units) — it does NOT get
// the server's own default language, because a script that quietly chose a language on the caller's
// behalf is invisible while a placeholder is visible in both (硬规则 3b). The same shape as
// serve-dashboard.ts's `sparklineSvg(history, loadThreshold, thresholdLabel)`.
export const GIT_HISTORY_KEYS = [
  // page header / view toggle (shared by BOTH view branches)
  "h1SubtitleGit", "h1SubtitleTask", "viewTogglePrefix", "viewGit", "viewTask", "viewToggleSuffix",
  // git view: the axis explainer (three fragments around the interpolated coverage span)
  "axisLead", "axisRowPerCommit", "axisAutoLoad",
  // git view: legend, sentinel, the sticky "more below" hint and the two graph aria labels
  "legendParentEdge", "loadingOlder", "moreCommits", "graphAriaScrollable", "graphAria",
  // coverage span units — read by BOTH the server render (formatCoverageSpan) and the client script
  "coverageHours", "coverageDays",
  // status note (both views)
  "readFailed", "noData",
  // task view
  "guideLead", "guideBody", "guideTail", "taskGroupHeading", "groupSummaryMeta",
  "unattributedLabel", "unattributedCount",
  // the JSON pagination endpoint's own fallback diagnostic
  "emptyRepoReason",
  // client-script constants (injected; see ROW 17b)
  "clientClickLoadOlder", "clientFirstCommitReached",
] as const;

export type GitHistoryKey = (typeof GIT_HISTORY_KEYS)[number];

/** The /git-history body-copy dictionary — see ROW 17. Every `zh` value below is the literal that
 *  was in serve-git.ts before this row existed, byte for byte (ROW 7's rule): `lang=zh` output
 *  cannot move. The `en` column is the NEW text. */
export const GIT_HISTORY_LABELS: Record<GitHistoryKey, { en: string; zh: string }> = {
  // ── page header / view toggle ───────────────────────────────────────────────────────────────
  // The two `<h1>` subtitle suffixes. The `<h1>` itself is `${pageNameFor("Git History", lang)}`
  // plus one of these, so the row carries ONLY the suffix — the page name is ROW 3's, not this
  // table's (a sentence here that re-stated "Git History" would be a second copy of it).
  h1SubtitleGit: { en: "vertical commit timeline", zh: "提交纵向时间轴" },
  h1SubtitleTask: { en: "task grouping timeline", zh: "任务分组时间轴" },
  // ⚠️ The toggle is ONE sentence split around the two links, so the en column's prefix/suffix
  // carry the SPACES the assembled sentence needs (`View: ` / ` (default: …)`). The zh column's do
  // not (`视图切换：` / `（默认 …）`) — the two languages punctuate the seam differently and a
  // shared template with a `{git}/{task}` hole would have to pick one convention for both.
  viewTogglePrefix: { en: "View: ", zh: "视图切换：" },
  viewGit: { en: "git topology", zh: "git 拓扑" },
  viewTask: { en: "Task grouping", zh: "任务分组" },
  viewToggleSuffix: {
    en: " (default: git topology; task grouping is a project-specific heuristic)",
    zh: "（默认 git 拓扑；任务分组是项目特定启发式）",
  },

  // ── git view: the axis explainer ────────────────────────────────────────────────────────────
  axisLead: { en: "Vertical axis = git emission order (newest first).", zh: "纵轴 = git 发射顺序（新的在上）。" },
  // ⚠️ THIS ROW ENDS IN A SPACE, deliberately: the sentence continues with the coverage `<span>`,
  // and the trailing space is inside the literal so no call site has to remember to add one (ROW 6:
  // never concatenate a translated fragment with raw content at the call site).
  axisRowPerCommit: {
    en: " One row per commit; a branch label renders inline only on the commit its ref points at (git decorate semantics). Diamond = merge commit. Current window: the latest {nCommits} commits and {mergeCount} merges (across all local branches); the loaded window covers ",
    zh: " 每行一个提交；分支标签只在 ref 指向的那个提交上内联显示（git decorate 语义）。菱形 = 合并提交。当前窗口：最近 {nCommits} 条提交、{mergeCount} 个合并（跨所有本地分支）；已加载窗口覆盖 ",
  },
  axisAutoLoad: {
    en: ". Scrolling the graph container to its bottom auto-loads older commits (after a lot are loaded it becomes click-to-load).",
    zh: "。在图表容器内滚动到底部自动加载更早的提交（加载较多后改为点击加载）。",
  },

  // ── git view: legend / sentinel / hint / aria ───────────────────────────────────────────────
  legendParentEdge: { en: "parent edge (rounded-orthogonal)", zh: "父提交连线（圆角正交）" },
  loadingOlder: { en: "Loading older commits…", zh: "加载更早提交…" },
  moreCommits: { en: "↓ More commits", zh: "↓ 更多提交" },
  graphAriaScrollable: { en: "Git vertical timeline (scrollable)", zh: "Git 纵向时间轴（可滚动）" },
  graphAria: { en: "Git vertical timeline", zh: "Git 纵向时间轴" },

  // ── the coverage span (seconds → "N 小时" / "N 天") ──────────────────────────────────────────
  // ⚠️ Rendered by serve-git.ts's `formatCoverageSpan` AND by the client loader's mirror of it.
  // Both read THIS row, so the server and the browser cannot drift into two unit spellings (the
  // pre-existing comment on `formatCoverageSpan` promised a verbatim mirror; this makes it one).
  coverageHours: { en: "{value}h", zh: "{value} 小时" },
  coverageDays: { en: "{value}d", zh: "{value} 天" },

  // ── status note (both views) ────────────────────────────────────────────────────────────────
  readFailed: { en: "Read failed", zh: "读失败" },
  noData: { en: "No data", zh: "无数据" },

  // ── the task view (`?view=task`) ────────────────────────────────────────────────────────────
  guideLead: {
    en: "Task grouping = aggregating by the task id in a commit subject (a project-specific heuristic, not git semantics).",
    zh: "任务分组 = 按 commit subject 里的 task id 聚合（项目特定启发式，非 git 语义）。",
  },
  // The guide is split around the `<strong>{count}</strong>` element, so the count's unit lives in
  // the TAIL row: zh counts commits with a trailing measure word (`条`) that en does not have, and a
  // template with a `{n}` hole would have to choose one language's word order for both.
  guideBody: {
    en: " One group = one task's full trajectory from filing through promotion and implementation to fan-in; commits attributable to no task id fall into the \"unattributed\" group (",
    zh: " 一组 = 一个任务从立案、晋升、实现到 fan-in 的完整轨迹；无法归属任何 task id 的提交计入「未归属」组（",
  },
  guideTail: {
    en: " commits). Current window: the latest {nCommits} commits and {mergeCount} merges. The default view is still git topology; switching back loses no information.",
    zh: " 条）。当前窗口：最近 {nCommits} 条提交、{mergeCount} 个合并。默认视图仍是 git 拓扑，切换回来不会丢任何信息。",
  },
  taskGroupHeading: { en: "Task grouping (aggregated by task id)", zh: "任务分组（按 task id 聚合）" },
  groupSummaryMeta: { en: " · {n} commits · ", zh: " · {n} 条提交 · " },
  unattributedLabel: { en: "Unattributed (no task id)", zh: "未归属（无 task id）" },
  unattributedCount: { en: " · {n}", zh: " · {n} 条" },

  // ── the JSON pagination endpoint ────────────────────────────────────────────────────────────
  // serve-git.ts's own fallback for `history.reason` — the ONE diagnostic string on this page this
  // task authors (observation.ts's own reasons are echoed, see the ROW 17 note). It rides the
  // request's language because the endpoint is read by the client loader of a page in one language.
  emptyRepoReason: { en: "git repository has no commits", zh: "git 仓库无提交记录" },

  // ── client-script constants (ROW 17b) ───────────────────────────────────────────────────────
  clientClickLoadOlder: { en: "Click to load older commits", zh: "点击加载更早提交" },
  clientFirstCommitReached: { en: "Reached the repository's oldest commit", zh: "已加载到仓库最早提交" },
};

/** The whole /git-history roster resolved for one language — take it ONCE per render (the
 *  `dashboardLabelsFor` idiom), rather than re-reading `GIT_HISTORY_LABELS` per call site. */
export function gitHistoryLabelsFor(lang: Lang = DEFAULT_LANG): Record<GitHistoryKey, string> {
  const out = {} as Record<GitHistoryKey, string>;
  for (const key of GIT_HISTORY_KEYS) out[key] = GIT_HISTORY_LABELS[key][lang];
  return out;
}

/** One /git-history label, interpolated. Unknown key ⇒ THROW; missing parameter ⇒ THROW (both via
 *  ROW 8's / ROW 6's rule — see `dashboardLabel`, whose body this mirrors exactly). */
export function gitHistoryLabel(
  key: GitHistoryKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(GIT_HISTORY_LABELS, key) ? GIT_HISTORY_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown git-history key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

/** The four strings the inlined client script needs (ROW 17b). Resolved SERVER-side: the browser has
 *  no dictionary, so the words must arrive as constants in the script the server writes. */
export interface GitHistoryClientLabels {
  /** The sentinel's text once the auto-load fuse trips (it becomes a click target). */
  clickLoadOlder: string;
  /** The sentinel's text once the oldest commit has been loaded. */
  firstCommitReached: string;
  /** The coverage-span templates (`{value}`-bearing), the client's mirror of the server's. */
  spanHours: string;
  spanDays: string;
}

export function gitHistoryClientLabelsFor(lang: Lang = DEFAULT_LANG): GitHistoryClientLabels {
  const t = gitHistoryLabelsFor(lang);
  return {
    clickLoadOlder: t.clientClickLoadOlder,
    firstCommitReached: t.clientFirstCommitReached,
    spanHours: t.coverageHours,
    spanDays: t.coverageDays,
  };
}

// ── ROW 18: the /needs-human BODY copy (gap-webui-needs-human-body-copy-en-zh) ────────────────────
//
// ROW 5 opened the body-copy series for /dashboard; ROW 17 did /git-history; this is the next page
// and it obeys ROW 2 / ROW 6 / ROW 7 / ROW 8 unchanged: the roster is CLOSED, the zh column is the
// pre-existing literal BYTE FOR BYTE, interpolated copy carries `{name}` in both columns, and both
// an unknown key and an unfilled `{name}` THROW.
//
// ⚠️ `{code}` IS THIS ROW'S ONE NEW SHAPE, and it is deliberate. The page's intro sentence and its
// two section headings each EMBED a `<code>` ELEMENT mid-sentence
// (`一条 <code>needs-human</code> 产生后…`), so a naive extraction splits one sentence into three
// fragments whose English word order cannot be reassembled at the call site (ROW 6's own argument).
// Carrying the sentence as ONE template with a `{code}` hole keeps the `<code>` ELEMENT at the
// render site (the dictionary stays copy-only — ⛔ no other table's value contains markup) while
// letting each column place the hole wherever its own word order needs it.
// ⛔ The `{code}` VALUE IS MARKUP, so it is passed ESCAPED-NOWHERE on purpose: its source is a
// literal in this repo, never request data. Anything derived from a task body goes through
// `escapeHtml` as before.
//
// ⚠️ WHY THE EMPTY STATES ARE ROWS EVEN THOUGH THE HEALTHY PAGE NEVER RENDERS THEM: they are this
// page's copy every bit as much as the headings are, and a roster built only from the populated
// render would leave the page half-English in exactly the state an operator reaches for it. This
// task's red baseline measured BOTH states for that reason (a single fetch cannot see the other).
export const NEEDS_HUMAN_KEYS = [
  // page header (the `<h1>`'s suffix, rendered as `${pageNameFor("Needs Human", lang)} — <this>`;
  // ⛔ the page NAME token is ROW 3's business, not this row's)
  "titleSuffix", "metaDescription", "intro",
  // the two section headings — each carries a `{code}` hole (see the note above)
  "sectionActive", "sectionLedger",
  // the reason column: its header, and the word for "the task carries no recorded reason"
  "colReason", "reasonNotRecorded",
  // the two empty states (see the note above)
  "emptyActive", "emptyLedger",
] as const;

export type NeedsHumanKey = (typeof NEEDS_HUMAN_KEYS)[number];

/** The /needs-human body-copy dictionary — see ROW 18 and ROW 2/ROW 6/ROW 7/ROW 8. */
export const NEEDS_HUMAN_LABELS: Record<NeedsHumanKey, { en: string; zh: string }> = {
  titleSuffix: { en: "Awaiting human decision", zh: "待人类决定" },
  metaDescription: {
    en: "Quay needs-human — the explicit human-interface owner",
    zh: "Quay needs-human — 显式人机承接界面",
  },
  // One sentence, one row, one `{code}` hole — ⛔ NOT three rows concatenated at the call site.
  intro: {
    en: "The explicit owner of the human interface: once a {code} is raised, it is visible on this page without reading any transcript. Above is the \"currently awaiting\" list; below is the \"escalation ledger\" (including historical samples whose status has since moved on).",
    zh: "人机接口的显式承接者：一条 {code} 产生后，无需读任何 transcript，在此页即可看到。上面是「当前待办」，下面是「升级台账」（含状态已流转的历史样本）。",
  },
  // The `<code>` payloads are the two store/ledger discriminators (`status: needs-human` /
  // `action: needs-human`) — ASCII tokens, identical in both languages, carried by the call site's
  // `{code}` param rather than duplicated into both columns.
  sectionActive: { en: "Currently awaiting ({code})", zh: "当前待办（{code}）" },
  sectionLedger: { en: "Escalation ledger ({code})", zh: "升级台账（{code}）" },
  colReason: { en: "Blocking reason", zh: "阻碍原因" },
  // ⚠️ ONE row, TWO call sites: the cell's text AND its `title` attribute render the identical
  // string, so a second row here would let the two drift apart (ROW 5's readFailed note).
  reasonNotRecorded: { en: "Not recorded", zh: "未记录" },
  emptyActive: {
    en: "No needs-human tasks currently (see the escalation ledger below).",
    zh: "当前无 needs-human 任务（升级台账见下）。",
  },
  // The ledger's source file is DATA (the reader's own path) and rides the `{code}` hole verbatim,
  // so the en column cannot silently drop the operator's only pointer to which file this is.
  emptyLedger: {
    en: "No needs-human escalations recorded ({code}).",
    zh: "无 needs-human 升级记录（{code}）。",
  },
};

/** The whole /needs-human roster resolved for one language — take it ONCE per render (the
 *  `dashboardLabelsFor` idiom), rather than re-reading `NEEDS_HUMAN_LABELS` per call site. */
export function needsHumanLabelsFor(lang: Lang = DEFAULT_LANG): Record<NeedsHumanKey, string> {
  const out = {} as Record<NeedsHumanKey, string>;
  for (const key of NEEDS_HUMAN_KEYS) out[key] = NEEDS_HUMAN_LABELS[key][lang];
  return out;
}

/** One /needs-human label, interpolated. Unknown key ⇒ THROW; missing parameter ⇒ THROW (both via
 *  ROW 8's / ROW 6's rule — see `dashboardLabel`, whose body this mirrors exactly). */
export function needsHumanLabel(
  key: NeedsHumanKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(NEEDS_HUMAN_LABELS, key) ? NEEDS_HUMAN_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown needs-human key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

// ── ROW 19: the /live BODY copy (gap-webui-live-body-copy-en-zh) ─────────────────────────────────
//
// ROW 5 opened the body-copy series for /dashboard; ROW 18 did /needs-human; this is the next page and
// it obeys ROW 2 / ROW 6 / ROW 7 / ROW 8 unchanged: the roster is CLOSED, the zh column is the
// pre-existing literal BYTE FOR BYTE, interpolated copy carries `{name}` in both columns, and both an
// unknown key and an unfilled `{name}` THROW.
//
// HOW THE ROSTER WAS FOUND — by MEASUREMENT, not by reading the source. The red baseline rendered
// /live from a REAL server in FOUR states (the task named two; the other two exist because two more
// rows render only in them): idle (telemetry present, 0 in flight), in flight (3 runs, with a real
// Touches/depends_on blocking relation AND a task with neither), the running-unwired banner, and the
// read-failure degradation. ⚠️ ONE FETCH CANNOT SEE THE OTHERS: `noBlockingRelation` and
// `blockingHeading` are mutually exclusive, `noInFlight` renders only at 0 in flight, the two banner
// rows only when telemetry is EMPTY, and `readFailed` only when the store is unreadable.
//
// ⚠️ THE SOURCE-LINE COUNT THE TASK QUOTED (24) IS NOT THE CURRENT ONE (17), and the difference is a
// MEASURED hand-off, not drift: `gap-webui-journal-body-copy-en-zh` landed between this task's filing
// and its execution and removed /journal's own seven Chinese lines from this shared file. Both readings
// are re-runnable on the two commits (`24` on eaa9799a0~1, `17` on eaa9799a0), by the same predicate.
// ⇒ The `/journal`-exclusive bucket of this task's three-way classification is now EMPTY.
//
// ⚠️ THE PHASE WORDS ARE **NOT** IN THIS TABLE — they resolve through ROW 5's `dashboardLabel`
// (`phaseImplementing` / `phaseAwaitingLand` / `phaseLanded`), because this page renders the SAME
// `InFlightPhase` enum in the same role the dashboard's liveCard does. The recorded trade-off (see the
// task body's 决定记录): ROW 11 ③ forbids cross-page sharing as a general rule — a value owned by
// another page's table makes that page's next re-wording a cross-table edit — but here the two pages
// are rendering ONE machine enum, so two independent translations of 「实现中」 are exactly the drift
// this series exists to remove ("改一处漏一处"), and the task's contract names that duplication and
// forbids a second copy. ⇒ Sharing here is CONTRACT-MANDATED, ⛔ not a licence to share elsewhere:
// the three state words below are byte-identical to ROW 5's rows and are still duplicated on purpose.
//
// ⚠️ `{task}` / `{ids}` / `{flags}` / `{value}` holes ARE MARKUP OR DATA, exactly as ROW 18's `{code}`
// is: the two blocking sentences carry `<a href="/task/…">` links mid-sentence and the next-step lines
// carry a `<code>` element, so the sentence is ONE template and the element stays at the render site
// (the dictionary stays copy-only). The hole VALUES are never request-derived prose — ids go through
// `escapeHtml` at the call site before they are interpolated, and the `{flags}` payload is a repo
// literal.
export const LIVE_KEYS = [
  // page header — the `<h1>`'s suffix (⛔ the page NAME token is ROW 3's business, and the `<title>`'s
  // token likewise: `Live — loop activity` is PAGE_LABELS'. Only the trailing suffix is body copy.)
  "titleSuffix",
  // the running summary line (② — each row carries its OWN leading ` · `, see the note below)
  "inFlightCap", "cpuPressure",
  // the two telemetry-empty banners: their state word, and their next-step line
  "liveStateRunningUnwired", "liveStateNotRunning", "nextStepUnwired", "nextStepNotRunning",
  // the read-failure degradation (a bare label — the reader's reason is DATA, see the note below)
  "readFailed",
  // the in-flight table: the five Chinese headers (the other six are already English) + the two
  // cell words that are not language-neutral
  "colStatus", "colPhase", "colAwaitingDuration", "colBlocks", "colBlockedBy",
  "elapsedMinutes", "cellNone",
  // the cross-task blocking section
  "blockingHeading", "blockingLine", "blockedByLine", "noBlockingRelation",
  // the empty state
  "noInFlight",
] as const;

export type LiveKey = (typeof LIVE_KEYS)[number];

/** The /live body-copy dictionary — see ROW 19 and ROW 2/ROW 6/ROW 7/ROW 8. */
export const LIVE_LABELS: Record<LiveKey, { en: string; zh: string }> = {
  titleSuffix: { en: "what the loop is doing right now", zh: "循环此刻在做什么" },

  // ── the running summary line ──────────────────────────────────────────────────────────────────
  // ⚠️ ② EACH ROW CARRIES ITS OWN LEADING ` · `, and it is INSIDE the value on purpose. The line is
  // `<code>live_state=running</code> · 在飞: N / 上限: M · CPU 压力 …`: the separator belongs to the
  // rendered run-on line, and keeping it in the row means the zh bytes are exactly the pre-extraction
  // ones no matter how the call site is later re-indented (the same reading as ROW 5's
  // `identityWorkspaceDisk` and ROW 12 ①'s space-leading fragments — ⛔ neither value is "trimmed for
  // tidiness", which would run the code element into the sentence).
  inFlightCap: { en: " · In flight: {inFlight} / cap: {cap}", zh: " · 在飞: {inFlight} / 上限: {cap}" },
  // ⚠️ TWO rows and not one optional-placeholder template: an empty fill would leave a trailing
  // separator the zh baseline does not have (ROW 5's `awaitingLandWithDuration` note). The row is
  // rendered ONLY when `/proc/pressure/cpu` was readable — absent ⇒ the segment is absent entirely.
  cpuPressure: { en: " · CPU pressure (some avg10): {value}", zh: " · CPU 压力 (some avg10): {value}" },

  // ── the two telemetry-empty banners ───────────────────────────────────────────────────────────
  // ⚠️ These two words used to be `LIVE_STATE_RUNNING_UNWIRED_LABEL` / `LIVE_STATE_NOT_RUNNING_LABEL`
  // in serve-render.ts — a module every page imports, holding a constant exactly ONE page rendered.
  // They are here now and those exports are DELETED (hard rule 5b: fixing one instance means sweeping
  // for its siblings — the sweep found 3 files naming them: the definition, this file's own comments,
  // and the one consumer). They are BYTE-IDENTICAL to ROW 5's `liveStateRunningUnwired` /
  // `liveStateNotRunning`, and ⛔ deliberately NOT shared with them — see the phase-words note above.
  liveStateRunningUnwired: { en: "Running, telemetry not wired", zh: "在跑但未接遥测" },
  liveStateNotRunning: { en: "Not running", zh: "未在运行" },
  // The `{flags}` hole carries `<code>--task-start</code>/<code>--task-end</code>` — a repo literal,
  // inserted as markup (ROW 19's header note). ⚠️ The zh 「。」 sits AFTER the hole, i.e. outside the
  // `<code>` element, exactly as the pre-extraction literal had it: moving it inside would render a
  // full-width stop inside the code span, a byte change invisible to every "does it contain the
  // payload" probe.
  nextStepUnwired: {
    en: "Next: check that the target project's loop calls {flags}.",
    zh: "下一步：检查目标项目的循环是否调用 {flags}。",
  },
  nextStepNotRunning: { en: "Next: check whether the session / cron is running.", zh: "下一步：检查会话/cron 是否启动。" },

  // ── the read-failure degradation ──────────────────────────────────────────────────────────────
  // ⚠️ The LABEL is copy; the reader's `reason` that follows it is DATA (observation.ts's own
  // diagnostic, rendered through `escapeHtml` in both languages — the classification /dashboard,
  // /journal, /board and /architecture all made for the same string). ⛔ Not translated, and it is
  // this page's NAMED out-of-scope residue: under `en` the line still carries Chinese, and the
  // black-box test pins that fact rather than letting it read as an oversight.
  readFailed: { en: "Read failed", zh: "读失败" },

  // ── the in-flight table ───────────────────────────────────────────────────────────────────────
  colStatus: { en: "status", zh: "状态" },
  colPhase: { en: "phase", zh: "阶段" },
  colAwaitingDuration: { en: "awaiting-land duration", zh: "待落地时长" },
  // ⚠️ `colBlocks` / `colBlockedBy` are the two headers that were HALF translated already
  // (`阻塞 (blocks)`), so their zh column keeps the pre-existing ASCII parenthetical BYTE FOR BYTE
  // (ROW 7) — the en column is the bare field name the parenthetical was glossing.
  colBlocks: { en: "blocks", zh: "阻塞 (blocks)" },
  colBlockedBy: { en: "blockedBy", zh: "被阻塞 (blockedBy)" },
  elapsedMinutes: { en: "{minutes} min", zh: "{minutes} 分钟" },
  // The table cell's word for "this task has no relation on this side". A row rather than a literal
  // so the roster stays closed (ROW 8), ⛔ NOT because it has a translation.
  cellNone: { en: "none", zh: "无" },

  // ── the cross-task blocking section ───────────────────────────────────────────────────────────
  blockingHeading: { en: "Cross-task blocking", zh: "跨任务阻塞关系" },
  // ⚠️ The sentence's two holes are HTML LINKS, so the two columns place them where their own word
  // order needs them — the reason ROW 18's `{code}` shape exists. `{task}` is the linked task id and
  // `{ids}` the comma-joined list of (already `escapeHtml`ed) ids.
  // ⚠️ The `[` … `]` AROUND the id list are INSIDE the template, not at the call site: they are part
  // of the rendered sentence, and leaving them out is a SILENT zh byte change — the AC3 differential
  // caught exactly that on the first run (`正在阻塞 [X, Y]` had become `正在阻塞 X, Y`), which no
  // "does the page contain the ids" probe can see.
  blockingLine: { en: "Task {task} is blocking [{ids}]", zh: "任务 {task} 正在阻塞 [{ids}]" },
  blockedByLine: { en: "Task {task} is blocked by [{ids}]", zh: "任务 {task} 被 [{ids}] 阻塞" },
  noBlockingRelation: { en: "No cross-task blocking relation.", zh: "无跨任务阻塞关系。" },

  // ── the empty state ───────────────────────────────────────────────────────────────────────────
  noInFlight: { en: "No in-flight tasks right now.", zh: "当前无在飞任务。" },
};

/** The whole /live roster resolved for one language — take it ONCE per render (the
 *  `dashboardLabelsFor` idiom), rather than re-reading `LIVE_LABELS` per call site. */
export function liveLabelsFor(lang: Lang = DEFAULT_LANG): Record<LiveKey, string> {
  const out = {} as Record<LiveKey, string>;
  for (const key of LIVE_KEYS) out[key] = LIVE_LABELS[key][lang];
  return out;
}

/** One /live label, interpolated. Unknown key ⇒ THROW; missing parameter ⇒ THROW (both via ROW 8's /
 *  ROW 6's rule — see `dashboardLabel`, whose body this mirrors exactly). */
export function liveLabel(
  key: LiveKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(LIVE_LABELS, key) ? LIVE_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown live key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

// ROW 20 — /tests. ROW 5 opened the body-copy series for /dashboard; ROW 19 did /live; this row does
// the next page and obeys ROW 2 / ROW 6 / ROW 7 / ROW 8 unchanged: the roster is CLOSED, the zh
// column is the pre-existing literal BYTE FOR BYTE, interpolated copy carries `{name}` in BOTH
// columns, and both an unknown key and an unfilled `{name}` THROW.
//
// HOW THE ROSTER WAS FOUND — by MEASUREMENT, not by reading the source. A real server rendered
// `/tests` from a fixture workspace in TWO states (records present / empty) under both languages,
// and a reproducible predicate split the CJK-bearing text lines into 「界面文案」 and 「数据」. The
// source-side count the task quoted (37 non-comment CJK lines in serve-tests.ts) is the UPPER bound;
// the lower bound is this table's rows, because several source lines are one sentence split by
// markup (`数据源：` + `<code>…</code>` + `（每轮一段…）` is ONE row with a `{code}` hole, not three).
//
// ⚠️ TWO PAGES LIVE IN THIS FILE, and both are in this row. `serve-tests.ts` owns `/tests` (the round
// list) AND `/tests/file` (the single-file cross-round drill-down, a distinct ROUTE whose links come
// off the perFile table). The sessions precedent (`serve-sessions.ts`, ROW 15) localized every page
// in its file the same way, which is why that file now has zero non-comment CJK lines.
//
// ⚠️ THE `{code}` HOLES ARE MARKUP, exactly as ROW 18's and ROW 19's are: the data-source notes
// render `<code>.quay/verification-round.jsonl</code>` mid-sentence, so the sentence is ONE template
// and the element stays at the render site (the dictionary stays copy-only). Keeping the notes as
// single rows is not tidiness — `数据源：` + `<code>…</code>` + `（每轮一段…）` assembled at the call
// site would be three translated fragments concatenated, and ROW 6 forbids exactly that.
//
// ⚠️ NAMED OUT-OF-SCOPE RESIDUE — `obsNote(status, reason)` (serve-render.ts) renders this page's
// empty-state label (`未接入/无数据` / `已接入/暂无记录` / `读失败`) and it stays Chinese under `en`.
// It is SHARED CHROME: 6 call sites across 4 page files (serve-architecture, serve-sessions ×3,
// serve-tests ×2, serve-system ×6) — localizing it here would move four other pages' output and
// their lang=zh baselines, i.e. it belongs to a chrome-level row like ROW 9, not to this page's.
// The `reason` that follows the label is DATA (observation.ts's own diagnostic, rendered through
// `escapeHtml` in both languages — the same classification ROW 5, ROW 11, ROW 15 and ROW 19 made).
//
// ⚠️ THE RUNTIME DIAGNOSTIC STRINGS ARE **NOT** IN THIS TABLE EITHER — the failing-test names and raw
// error output in the failure-details list (`not ok 7 - <name>`, `AssertionError: …`) are the ledger's
// DATA, rendered verbatim through `escapeHtml`. Translating them would be editing a test run's record
// to read nicely, which is the one thing this page must never do.
export const TESTS_KEYS = [
  // page header — the `<h1>`/`<title>` SUBTITLE. ⛔ The page NAME token (`Tests`) is ROW 3's business;
  // only the trailing suffix is body copy (the same split ROW 14 ③ made for /system).
  "pageSubtitle",
  // the /tests header's data-source note
  "dataSourceRounds",
  // the rounds timeline section (renderTimelineBarSvg is ROW 5's shared chart — see AC5)
  "roundsTimelineHeading", "dataSourceRoundsTimeline", "timelineWindow",
  // the load curve (renderLoadCurveSvg — shared by /tests AND /tests/file)
  "loadCurveHeading", "dataSourceSuiteLoad", "loadCurveCaption",
  // the per-file timeline (gantt) — heading, data-source note, fallback banner, SVG caption, bar
  // tooltip, legend word
  "perFileTimelineHeading", "dataSourcePerFile", "timelineFallbackNote", "ganttCaption",
  "ganttBarTitle", "ganttLegend",
  // ⚠️ THE BUCKET WORDS ARE NOT LANGUAGE-NEUTRAL: the canonical token is `P`/`S`/`M`/`UNRESOLVED`,
  // but the LEGEND and the bar tooltips render 「P 产品」/「S 套件」/「M 机件」/「未解析」/「多桶」.
  "bucketProduct", "bucketSuite", "bucketMechanism", "bucketUnresolved", "bucketMulti",
  // the history table — heading, the newest-row marker, the failure-details disclosure summary
  "historyHeading", "latestMarker", "failureDetailsSummary",
  // the perFile duration table's disclosure summary
  "perFileSummary",
  // the two round-focus notes (?round=N resolved / not found)
  "focusNote", "roundNotFoundNote",
  // ── /tests/file — the single-file cross-round drill-down ────────────────────────────────────────
  "fileBackLink", "notFoundLabel", "fileNotFoundSuffix",
  "fileTrendHeading", "fileTrendCaption", "fileTrendDataSource", "fileTrendSingleRound",
  "fileFragmentHeading", "fileFragmentDataSource", "fileFragmentNoSamples", "fileHistoryHeading",
  // ⚠️ A ROUND LABEL APPEARS INSIDE THREE DIFFERENT HEADINGS (`（round #1923 · 14:00Z）`,
  // `（跨 3 轮）` uses its own row). This one is the shared PARENTHETICAL around a `roundLabel()`
  // value, so its punctuation is the row's business rather than the call site's — the /live task's
  // `[`…`]` lesson (ROW 19): the brackets are part of the rendered sentence and leaving them out is
  // a silent zh byte change.
  "roundSuffix",
] as const;

export type TestsKey = (typeof TESTS_KEYS)[number];

/** The /tests (+ /tests/file) body-copy dictionary — see ROW 20 and ROW 2/ROW 6/ROW 7/ROW 8. */
export const TESTS_LABELS: Record<TestsKey, { en: string; zh: string }> = {
  pageSubtitle: { en: "verification rounds", zh: "验证轮记录" },

  // ── the /tests header data-source note ────────────────────────────────────────────────────────
  dataSourceRounds: {
    en: "Data source: {code} (one row appended per completed suite run, red and green alike)",
    zh: "数据源：{code}（每轮 suite 完成时追加，红绿皆入账）",
  },

  // ── the rounds timeline section ───────────────────────────────────────────────────────────────
  roundsTimelineHeading: { en: "Recent test-record timeline segments", zh: "最近测试记录分段时间轴" },
  dataSourceRoundsTimeline: {
    en: "Data source: {code} (one segment per round, red=red · green=green, anchored at the latest round's end)",
    zh: "数据源：{code}（每轮一段，红=red · 绿=green，锚定最近一轮结束时刻）",
  },
  // ⚠️ THE TRAILING `: ` IS INSIDE THE en VALUE AND ABSENT FROM THE zh ONE, on purpose: the row is
  // followed directly by the window links (`1h · 3h · 6h · 12h`), the zh baseline has no space before
  // them, and an English reader needs one after the colon. The two columns are independent — that is
  // the whole point of peer columns (the same reading as ROW 5's `identityWorkspaceDisk`).
  timelineWindow: {
    en: "Timeline window (the past {hours}h): ",
    zh: "时间轴窗口（过去 {hours}h）：",
  },

  // ── the load curve ────────────────────────────────────────────────────────────────────────────
  loadCurveHeading: { en: "Load curve", zh: "负载曲线" },
  dataSourceSuiteLoad: {
    en: "Data source: {code} (sampled while the suite runs; stops when it ends)",
    zh: "数据源：{code}（suite 运行期采样，结束即停）",
  },
  loadCurveCaption: {
    en: "loadavg (1m) · sampled while the suite runs",
    zh: "loadavg (1m) · suite 运行期采样",
  },

  // ── the per-file timeline (gantt) ─────────────────────────────────────────────────────────────
  perFileTimelineHeading: { en: "Test timeline", zh: "测试时间线" },
  // ⚠️ BOTH HOLES ARE ALWAYS PRESENT WHEN THIS RENDERS — `timelineFallback` is only true when the
  // latest round AND the shown round are both known (serve-tests.ts), so `fillLabel` can never be
  // handed an empty `{shown}` and the zh bytes keep the ` ` that precedes the fallback round.
  timelineFallbackNote: {
    en: "⚠️ The latest round carries no perFile data ({latest}); falling back to {shown} below.",
    zh: "⚠️ 最新一轮无 perFile 数据（{latest}），以下回退显示 {shown}。",
  },
  dataSourcePerFile: {
    en: "Data source: {code} perFile start/end times (reporter end time + duration back-computed start)",
    zh: "数据源：{code} perFile 起止时刻（reporter 结束时刻 + duration 反推起始）",
  },
  // ⚠️ `{shown}` IS THE PAGE'S ROW RANGE (`3–7`), kept as ONE hole rather than two numbers: the
  // en dash between them is part of the rendered range, not a separator the call site owns.
  ganttCaption: {
    en: "Test timeline (per-file start/end · page {page}/{totalPages} · this page {shown} of {totalRows} files · ascending by start time · coloured by bucket)",
    zh: "测试时间线（每文件起止时刻 · 第 {page}/{totalPages} 页 · 本页 {shown} / 共 {totalRows} 个文件 · 按开始时刻升序 · 按 bucket 着色）",
  },
  // The bar's `<title>`: file · duration · bucket word · end time. Only the LAST label is copy — the
  // rest is the ledger's own data and is `escapeHtml`ed at the fill site.
  ganttBarTitle: {
    en: "{file} · {ms} ms · {bucket} · ends {time}",
    zh: "{file} · {ms} ms · {bucket} · 结束 {time}",
  },
  ganttLegend: { en: "Legend:", zh: "图例：" },
  bucketProduct: { en: "P product", zh: "P 产品" },
  bucketSuite: { en: "S suite", zh: "S 套件" },
  bucketMechanism: { en: "M mechanism", zh: "M 机件" },
  bucketUnresolved: { en: "unresolved", zh: "未解析" },
  bucketMulti: { en: "multi-bucket", zh: "多桶" },

  // ── the history table ─────────────────────────────────────────────────────────────────────────
  historyHeading: { en: "Run history (new → old)", zh: "历史运行（新→旧）" },
  latestMarker: { en: "← latest", zh: "← 最新" },
  failureDetailsSummary: {
    en: "Failure details for #{round} (click to expand)",
    zh: "#{round} 失败用例明细（点击展开）",
  },

  // ── the perFile duration table ────────────────────────────────────────────────────────────────
  perFileSummary: {
    en: "perFile duration detail (descending · failures in red)",
    zh: "perFile 耗时明细（耗时降序 · 失败标红）",
  },

  // ── the two round-focus notes ─────────────────────────────────────────────────────────────────
  focusNote: {
    en: "Showing details for {round} (the timeline, load curve and perFile all come from that round).",
    zh: "正在查看 {round} 的详情（时间线 / 负载曲线 / perFile 均来自该轮）。",
  },
  roundNotFoundNote: {
    en: "Round #{round} not found — no such round in the verification-round ledger; showing the latest round below.",
    zh: "未找到 round #{round} — 验证轮记录中无该轮次，以下显示最新一轮。",
  },

  // ── /tests/file — the single-file cross-round drill-down ──────────────────────────────────────
  // ⚠️ `文件` is the page NAME and lives in PAGE_LABELS (`Test file`); this is only the back link.
  fileBackLink: { en: "← Back to Tests", zh: "← 返回 Tests" },
  // The not-found note is TWO rows, ⛔ not one `{label}`-holed template: the label is rendered inside
  // a `<strong>` element, and a hole carrying the element would still need the label's WORD from
  // somewhere — putting it at the call site would move copy out of the dictionary. The ` — `
  // separator stays in the suffix so neither column depends on the call site's spacing.
  notFoundLabel: { en: "Not found", zh: "未找到" },
  fileNotFoundSuffix: {
    en: " — this path does not appear in any round's perFile records.",
    zh: " — 该路径未出现在任何验证轮的 perFile 记录中。",
  },
  fileTrendHeading: { en: "durationMs trend (across {n} rounds)", zh: "durationMs 趋势（跨 {n} 轮）" },
  fileTrendCaption: {
    en: "durationMs trend (one bar per round · failures in red · ascending by round)",
    zh: "durationMs 趋势（每轮一根柱 · 失败标红 · 按轮次升序）",
  },
  fileTrendDataSource: {
    en: "Data source: {code} perFile (the same file aggregated across rounds)",
    zh: "数据源：{code} perFile（同一文件跨多轮聚合）",
  },
  // ⚠️ THE en COLUMN AVOIDS 「」 (ROW 8's rule is that the zh column carries the pre-existing bytes;
  // the en column is NEW text, and the dictionary test rejects CJK in it). The quotation marks are
  // therefore ASCII here and full-width in zh — the same choice ROW 19 made for its `[`…`]`.
  fileTrendSingleRound: {
    en: "⚠️ This file appears in only 1 round — no cross-round trend (AC2's \"a single round ⇒ false\" guard).",
    zh: "⚠️ 该文件仅出现在 1 轮 — 无跨多轮趋势（AC2 的「只有单轮 ⇒ 假」守卫）。",
  },
  fileFragmentHeading: { en: "Load curve fragment for the run", zh: "运行期间负载曲线片段" },
  fileFragmentDataSource: {
    en: "Data source: {code} (clipped to this file's start/end window)",
    zh: "数据源：{code}（裁剪到该文件起止窗口）",
  },
  fileFragmentNoSamples: {
    en: "No samples inside this file's start/end window — the load curve is a data-source dependency (shown once the sampler-bypass fix lands).",
    zh: "该文件起止窗口内无采样点 — 负载曲线是数据源依赖项（sampler-bypass 修复后显示）。",
  },
  fileHistoryHeading: { en: "pass/fail history ({n} rounds · old → new)", zh: "pass/fail 历史（{n} 轮 · 旧→新）" },
  roundSuffix: { en: " ({round})", zh: "（{round}）" },
};

/** The whole /tests roster resolved for one language — take it ONCE per render (the
 *  `dashboardLabelsFor` idiom), rather than re-reading `TESTS_LABELS` per call site. */
export function testsLabelsFor(lang: Lang = DEFAULT_LANG): Record<TestsKey, string> {
  const out = {} as Record<TestsKey, string>;
  for (const key of TESTS_KEYS) out[key] = TESTS_LABELS[key][lang];
  return out;
}

/** One /tests label, interpolated. Unknown key ⇒ THROW; missing parameter ⇒ THROW (both via ROW 8's /
 *  ROW 6's rule — see `dashboardLabel`, whose body this mirrors exactly). */
export function testsLabel(
  key: TestsKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(TESTS_LABELS, key) ? TESTS_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown tests key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

// ── ROW 21: the /goal BODY copy (gap-webui-goal-body-copy-en-zh) ────────────────────────────────
//
// ROW 20 is /tests' body copy; this row is /goal's. It obeys ROW 2/ROW 6/ROW 7/ROW 8 unchanged: the
// roster is closed, the zh column is the pre-existing literal BYTE FOR BYTE, and interpolated copy
// carries `{name}` in BOTH columns.
//
// ⚠️ TWO ROUTES LIVE IN THIS ONE SOURCE FILE (`serve-goal.ts`): the /goal LIST and the /goal/<id>
// DETAIL page. Both are in this row — the detail page's copy used to be reachable only by opening a
// record, and a list-only dictionary would have left it Chinese (the ROW 20 note about /tests and
// /tests/file is the same statement one page earlier).
//
// HOW THE ROSTER WAS FOUND — by MEASUREMENT, not by reading the source (the ROW 10/ROW 20 method,
// re-runnable: `.quay/goal-i18n-ac1-probe.mjs`, whose readings are in `.quay/goal-i18n-ac1-baseline.txt`).
// The probe renders each route TWICE from two real servers: one fixture whose RECORD DATA is pure
// ASCII, one whose record titles are Chinese. A CJK line present in BOTH renders cannot have come
// from data — the ASCII fixture had none — so it is interface copy BY CONSTRUCTION. This row is the
// lower bound of that measurement; the source-side 22-line count is the upper bound, because several
// source lines are ONE rendered sentence split by markup (` — 本页是…` + `<code>goals/</code>` +
// ` 即正本。` is one row with a `{code}` hole, not three).
//
// ⚠️ WHY THE ROW COUNT (23) EXCEEDS THE NUMBER OF CHINESE *LINES* IN THE PROBE: the probe counts
// VISIBLE LINES, and several rows render on the SAME line as another (the two `<th>` labels of the
// goals table are one line; `挂靠任务: ` and its count are one line). The roster counts RENDERED
// STRINGS, which is the unit ROW 5 ① fixed: two call sites rendering the same string share a row,
// and one call site rendering two strings gets two.
//
// ⚠️ WHAT IS **NOT** IN THIS TABLE, and why (each is a classification decision, not an omission):
//   ① THE RECORDS THEMSELVES — goal titles, AC titles, `criterion` shell commands, `origin` prose,
//      task titles, and the status distribution words inside `{dist}` (`ready 1 · done 2`, whose
//      members are the ABI's own status tokens). These are DATA: they are what the store says, they
//      differ per record, and translating them would be editing the store's record to read nicely.
//      The probe's two-fixture differential is what proves they are data rather than assuming it.
//   ② `id` / `status` / `title` / `last progress` / `first evidence` / `recent verdict` — already
//      English in BOTH columns before this task (they were never Chinese), so they are not rows.
//   ③ THE STATUS FILTER AND SORT VALUES (`All`, `draft`, `active`, `achieved`, `superseded`,
//      `retired`) — these are the ABI's machine tokens rendered as filter LINK TEXT. They are the
//      same closed vocabulary the records carry in `status:`, so a translated filter link would
//      stop matching the values it filters on.
//   ④ `GOAL` / `AC` / `Criteria` in the draft banner — tab/kind tokens, and the banner's `Criteria`
//      label is already registered as named residue by AC-301 (wiring it needs a third PAGE_LABELS
//      entry). ⛔ Translating them here would move the zh bytes, which this task may not do.
//   ⑤ THE `Criteria` TAB LABEL itself (the sibling of the `Goals` token) and the tab-name arg of
//      `draftOtherLink`: both are AC-301's named residue, carried forward unchanged.
export const GOAL_KEYS = [
  // the `<h1>`/`<title>` SUBTITLE — ⛔ the page NAME token (`Goals`/`goals`) is ROW 3's business;
  // only the trailing suffix after ` — ` is body copy (the same split ROW 14 ③ made for /system).
  // TWO rows, one per tab: the tab split (gap-webui-goal-list-tab-split-goal-ac) gave each tab its
  // own subtitle, and the criteria one is language-neutral ASCII in BOTH columns.
  "pageSubtitleGoal", "pageSubtitleCriteria",
  // the two table headers that were Chinese on the list pages (the other five were always English)
  "colAcRollup", "colAttachedTasks",
  // the three DISTINCT states of the goal↔task rollup cell (硬规则 3b: a failed read must not look
  // like "read, and nothing attached") — plus the counted form, whose parens are full-width in zh
  "attachNotLinked", "attachReadFailed", "attachCount",
  // the ledger-derived time cell's "no timestamp" marker — DISTINCT from `—` (the evidence cell)
  "notRecorded",
  // the list page's read-failure banner (`<strong>`) — reached only when `client.goalList()` throws,
  // so it is INVISIBLE to a probe that never constructs the state (硬规则 4: a criterion whose state
  // cannot be built is not a measurement). ⚠️ Found by a POSITIONAL sweep of the source after the
  // two-fixture differential had already been run — the differential can only see states that render.
  "listReadFailed",
  // the draft banner: this tab's own count, the explanation with its `<code>` hole, the link, and
  // the cross-tab hint (another tab's count + the link into it)
  "draftOwnBanner", "draftExplain", "viewDrafts", "draftOtherBanner", "draftOtherLink",
  // the empty state: the two `<strong>` variants, then the source-of-truth sentence and the
  // corrected-pointer note (each with its own `{code}` hole — ⛔ not concatenated at the call site)
  "emptyFiltered", "emptyDir", "emptyExplain", "emptyPointerNote",
  // the detail page: the three meta-prefixes, the criteria section heading, its empty note, and the
  // `挂靠任务: ` prefix (a DIFFERENT rendered string from the `<th>` above — same words, own colon)
  "detailRecentProgress", "detailFirstEvidence", "detailRecentVerdict", "detailAttachedTasks",
  "detailCriteriaHeading", "detailNoCriteria",
] as const;

export type GoalKey = (typeof GOAL_KEYS)[number];

/** The /goal (+ /goal/<id>) body-copy dictionary — see ROW 21 and ROW 2/ROW 6/ROW 7/ROW 8. */
export const GOAL_LABELS: Record<GoalKey, { en: string; zh: string }> = {
  pageSubtitleGoal: { en: "stage goals", zh: "阶段目标" },
  // ⚠️ BYTE-EQUAL IN BOTH COLUMNS, and `zhArmOk` accepts that ONLY because it is byte-equal: the
  // pre-existing zh literal at this call site WAS this ASCII string (`AC / criterion`), and the
  // criterion's own vocabulary is English in this repo. A prose zh value that had been accidentally
  // authored in English would not pass the test's arm.
  pageSubtitleCriteria: { en: "AC / criterion", zh: "AC / criterion" },

  colAcRollup: { en: "AC achieved", zh: "AC 达成" },
  colAttachedTasks: { en: "attached tasks", zh: "挂靠任务" },

  // ⚠️ THREE STATES, THREE ROWS — never one row with an optional fragment. The count form keeps its
  // parens INSIDE the row (full-width in zh, ASCII in en): the brackets are part of the rendered
  // sentence, and leaving them at the call site is the /live `[`…`]` lesson (ROW 19) — a silent zh
  // byte change waiting to happen.
  attachNotLinked: { en: "not attached", zh: "未挂靠" },
  attachReadFailed: { en: "read failed ({reason})", zh: "未读到（{reason}）" },
  attachCount: { en: "{n} ({dist})", zh: "{n}（{dist}）" },

  notRecorded: { en: "not recorded", zh: "未记录" },

  // ⚠️ The `:` is ASCII in the zh column because it is ASCII in the pre-extraction literal
  // (`<strong>读失败:</strong>`) — see ROW 13 ②, which made the same reading for /doc's banner. The
  // row is written AGAIN here rather than reusing ROW 13's `docReadFailed` even though the two
  // rendered strings are byte-equal: each table owns the copy that LIVES in its own source file, and
  // a cross-table reuse would make one page's wording change silently move the other's (the ROW 8
  // duplication note).
  listReadFailed: { en: "Read failed:", zh: "读失败:" },

  // ⚠️ `{kind}` is the tab's own token (`GOAL` / `AC`) and is passed RAW — see ④ above.
  draftOwnBanner: { en: "{n} {kind} awaiting a decision", zh: "{n} 条 {kind} 待裁定" },
  // The `<code>…</code>` element rides in the `{cmd}` HOLE (the dictionary stays copy-only — the
  // ROW 20 `{code}` precedent), so this sentence is ONE row rather than three concatenated fragments.
  //
  // ⚠️⚠️ BOTH COLUMNS CARRY THE EXTRACTED LITERAL'S EMBEDDED LINE BREAKS AND INDENTATION, and that is
  // ROW 7's rule taken literally ("zh 列逐字等于提取前的字面量"), not an accident of formatting. The
  // pre-extraction source was a template literal whose ONE sentence was wrapped across three source
  // lines for width — and an HTML reader collapses that run of whitespace to a SINGLE SPACE, so the
  // spaces after `：` and after `），` were part of the text the page actually rendered. Re-flowing
  // the sentence onto one source line here would silently drop them, i.e. change the zh bytes and
  // the zh reading, which this task's AC3 forbids. ⇒ The row keeps the bytes; the layout of the
  // SOURCE FILE is free to change without moving the page. ⛔ Do not "tidy" these values.
  draftExplain: {
    en: " — draft records do not take effect by themselves:\n            activation is a human action ({cmd}),\n            and until it is activated the record stays a proposal.",
    zh: " — draft 记录不会自己生效：\n            激活是人的动作（{cmd}），\n            不激活就一直是提案。",
  },
  viewDrafts: { en: "View the drafts awaiting a decision", zh: "查看待裁定" },
  // ⚠️ `{tab}` is a tab NAME (`Criteria` / `Goals`), passed raw for the same reason as ④.
  draftOtherBanner: { en: "{n} more {kind} awaiting a decision", zh: "另有 {n} 条 {kind} 待裁定" },
  draftOtherLink: { en: "Go to the {tab} tab", zh: "去 {tab} tab 查看" },

  emptyFiltered: { en: "No records under the current filter", zh: "当前筛选下无记录" },
  emptyDir: { en: "the goals/ directory is empty", zh: "goals/ 目录为空" },
  emptyExplain: {
    en: " — this page is the goal-store's machine-readable view; {code} is the source of truth.",
    zh: " — 本页是 goal-store 的机读视图，{code} 即正本。",
  },
  emptyPointerNote: {
    en: "(This used to point at {code}, which was downgraded to an archive by G3 and is no longer the source of truth — the pointer has been fixed.)",
    zh: "（此处原先指向 {code}，该文件已随 G3 降级为归档，不再是正本——指针已修正。）",
  },

  // The trailing `: ` is INSIDE each row (absent before the value in neither column — the two
  // columns are peers, and the zh baseline has a space after its colon too).
  detailRecentProgress: { en: "last progress: ", zh: "最近进展: " },
  detailFirstEvidence: { en: "first evidence: ", zh: "首次证据: " },
  detailRecentVerdict: { en: "recent verdict: ", zh: "最近 verdict: " },
  detailAttachedTasks: { en: "attached tasks: ", zh: "挂靠任务: " },
  detailCriteriaHeading: { en: "criteria of this goal ({n})", zh: "本 goal 的 criterion ({n})" },
  detailNoCriteria: { en: "(no criteria yet)", zh: "（暂无 criterion）" },
};

/** The whole /goal roster resolved for one language — take it ONCE per render (the
 *  `dashboardLabelsFor` idiom), rather than re-reading `GOAL_LABELS` at each call site. */
export function goalLabelsFor(lang: Lang = DEFAULT_LANG): Record<GoalKey, string> {
  const out = {} as Record<GoalKey, string>;
  for (const key of GOAL_KEYS) out[key] = GOAL_LABELS[key][lang];
  return out;
}

/** One /goal label, interpolated. Unknown key ⇒ THROW; missing parameter ⇒ THROW (both via ROW 8's /
 *  ROW 6's rule — see `dashboardLabel`, whose body this mirrors exactly). */
export function goalLabel(
  key: GoalKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(GOAL_LABELS, key) ? GOAL_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown goal key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}
