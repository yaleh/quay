// architecture.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /architecture BODY copy (ROW 12).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";
import { fillLabel } from "./fill.ts";

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
