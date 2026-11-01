// git-history.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /git-history BODY copy (ROW 17).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";
import { fillLabel } from "./fill.ts";

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
