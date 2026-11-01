// board.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /board BODY copy (ROW 11).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "../serve-lang.ts";
import { fillLabel } from "./fill.ts";

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
  //
  // gap-task-status-drift-check-serve-labels-no-rel-accessor: the three `srcLanding*` rows name the
  // landing source through `{source}`, filled by the caller with observation.ts's
  // TASK_STATUS_DRIFT_CHECK_NAME. They must NOT spell the basename here — this module is import-free
  // by design (see the header), so a literal here would be a SECOND naming point that no change to
  // the checker's rel could reach (the defect this task exists to end; gap-serve-labels-hardcode-
  // mechanism-script-basenames was its sibling on /system). The `srcExec*` rows need no placeholder:
  // `.workflow-events/` is a directory this page names directly, not a mechanism script rel.
  srcExecEmpty: { en: "the execution source (.workflow-events/) has no data", zh: "执行源（.workflow-events/）无数据" },
  srcExecFailed: { en: "the execution source (.workflow-events/) read failed", zh: "执行源（.workflow-events/）读失败" },
  srcLandingTimeout: {
    en: "the landing source ({source}) read timed out",
    zh: "落地源（{source}）读取超时",
  },
  srcLandingUnavailable: {
    en: "the landing source ({source}) is unavailable",
    zh: "落地源（{source}）不可用",
  },
  srcLandingFailed: {
    en: "the landing source ({source}) read failed",
    zh: "落地源（{source}）读失败",
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
