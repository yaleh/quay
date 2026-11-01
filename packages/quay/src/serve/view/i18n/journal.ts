// journal.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /journal BODY copy (ROW 10).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";

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
