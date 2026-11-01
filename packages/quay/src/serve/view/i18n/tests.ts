// tests.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /tests BODY copy (ROW 20).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";
import { fillLabel } from "./fill.ts";

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
