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
  "Board — 三源 join 看板": { en: "Board — 三源 join 看板", zh: "看板 — 三源 join 看板" },
  Board: { en: "Board", zh: "看板" },
  // AC-293 (/system page): this page's own TWO tokens, same shape as AC-291's and AC-292's pairs.
  // `System — 系统状态` is the FULL token `serve-system.ts` passes to `pageTitle` — em dash and the
  // (already-Chinese) subtitle included, because AC-293's third arm compares this page's `<title>`
  // against its en baseline and a token that is not byte-equal to the call site misses the lookup
  // (that miss IS the `title-unchanged` arm, i.e. the exact defect AC-293 exists to remove).
  // `System` is the token the `<h1>` carries; it is spelled like the nav KEY `system`, but like
  // AC-290's `Tasks` and AC-292's `Board` it is a separate lookup on purpose — the nav label
  // resolves through `NAV_LABELS` (shared chrome, ROW 1) while this resolves through `pageNameFor`
  // (this page's chrome, ROW 3).
  // Neither zh value may carry the ASCII literal "System": AC-293's second arm fails the page on
  // that literal inside the nav region, and "系统 — 系统状态" satisfies "non-empty" without it.
  "System — 系统状态": { en: "System — 系统状态", zh: "系统 — 系统状态" },
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
  // AC-299 (/sessions page): this page needs THREE tokens, not the usual two — its `<h1>` carries a
  // LOUDER token than its `<title>`, so unlike /tests (AC-298) a single entry cannot serve both.
  //   `"Sessions — 会话观测"` — the FULL token `serve-sessions.ts` passes to `pageTitle`, em dash and
  //     the (already-Chinese) subtitle included, byte-equal to the call site. `pageNameFor` is an
  //     EXACT-token lookup, so registering only the bare nav word `Sessions` would leave this page's
  //     `<title>` English while the shared nav bar switched — i.e. exactly the `title-unchanged` arm
  //     this task exists to remove.
  //   `"Sessions — 会话观测（运行中 + 已结束）"` — the token the page's `<h1>` carries, with the
  //     full-width parens and the parenthetical included. It is NOT the title token above: the two
  //     differ by the trailing `（运行中 + 已结束）`, so the title entry does not serve it and vice
  //     versa. This is the one deviation from the AC-291~298 two-token shape.
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
  // against. 「会话」/「会话观测」 satisfy "non-empty" without either literal.
  "Sessions — 会话观测": { en: "Sessions — 会话观测", zh: "会话 — 会话观测" },
  "Sessions — 会话观测（运行中 + 已结束）": { en: "Sessions — 会话观测（运行中 + 已结束）", zh: "会话 — 会话观测（运行中 + 已结束）" },
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
  "Architecture — 系统组件图": { en: "Architecture — 系统组件图", zh: "架构 — 系统组件图" },
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

// ── ROW 10: the /git-history BODY copy (gap-webui-git-history-body-copy-en-zh) ──────────────────
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
// ⚠️ ROW 10b — THE CLIENT SCRIPT IS A DIFFERENT KIND OF CONSUMER. Four of this page's strings are
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
  // client-script constants (injected; see ROW 10b)
  "clientClickLoadOlder", "clientFirstCommitReached",
] as const;

export type GitHistoryKey = (typeof GIT_HISTORY_KEYS)[number];

/** The /git-history body-copy dictionary — see ROW 10. Every `zh` value below is the literal that
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
  // task authors (observation.ts's own reasons are echoed, see the ROW 10 note). It rides the
  // request's language because the endpoint is read by the client loader of a page in one language.
  emptyRepoReason: { en: "git repository has no commits", zh: "git 仓库无提交记录" },

  // ── client-script constants (ROW 10b) ───────────────────────────────────────────────────────
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

/** The four strings the inlined client script needs (ROW 10b). Resolved SERVER-side: the browser has
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
