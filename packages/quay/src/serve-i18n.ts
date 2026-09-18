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
  // AC-298 (/tests page): this page's own TWO tokens, same shape as AC-291's / AC-292's / AC-293's /
  // AC-296's pairs. `Tests — 验证轮记录` is the FULL token `serve-tests.ts` passes to `pageTitle` AND
  // to the `<h1>` — em dash and the (already-Chinese) subtitle included, byte-equal to BOTH call
  // sites, because AC-298's third arm compares this page's `<title>` against its en baseline and a
  // token that is not byte-equal MISSES the lookup (that miss IS the `title-unchanged` arm, i.e. the
  // exact defect AC-298 exists to remove — registering the bare `Tests` here would leave the title
  // English). This page is one of the few whose `<h1>` carries the FULL title token rather than a
  // short one, so a single entry serves both.
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
  // 「测试 — 验证轮记录」 satisfies "non-empty" without either literal.
  "Tests — 验证轮记录": { en: "Tests — 验证轮记录", zh: "测试 — 验证轮记录" },
  tests: { en: "tests", zh: "测试" },
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
// concrete: `在跑但未接遥测` already lives twice in the tree (here, and as
// LIVE_STATE_RUNNING_UNWIRED_LABEL in serve-render.ts, whose only consumer is /live). ⚠️ That
// /live constant is NOT folded into this row: /live's body copy is a later page's task, and a
// value this table owns cannot also be another page's constant without making that page's
// eventual migration a cross-table edit. The duplication is REAL and recorded here rather than
// silently tripled.
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
  // ⚠️ The same two zh words are also LIVE_STATE_RUNNING_UNWIRED_LABEL / LIVE_STATE_NOT_RUNNING_LABEL
  // in serve-render.ts, whose only consumer is /live (see ROW 5's note). Not folded: that is
  // /live's task to migrate.
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
