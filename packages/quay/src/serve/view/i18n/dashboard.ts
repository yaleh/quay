// dashboard.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /dashboard BODY copy (ROW 5).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";
import { fillLabel } from "./fill.ts";

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
