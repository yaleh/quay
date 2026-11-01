// serve-i18n.ts — barrel re-exporting the per-page i18n label data modules (see ./i18n/).
//
// ============================ CONTRACT (single source of truth) ============================
// `serve-lang.ts` answers "which language is this request?"; this barrel answers "what is this label
// in that language?" by re-exporting the data modules that carry the words. The single source of
// truth MOVED into `./i18n/*.ts` (gap-routine-architecture-analysis-god-package-serve-view): each
// page's dictionary is one data module, and this file is the ONE import surface importers keep using.
//
// ROW 1/2 nav + ROW 3 page names + ROW 4 switcher + ROW 9 shared chrome → ./i18n/chrome.ts
// ROW 5 /dashboard → ./i18n/dashboard.ts; ROW 6's fillLabel → ./i18n/fill.ts
// ROW 10 /journal → ./i18n/journal.ts; ROW 11 /board → ./i18n/board.ts
// ROW 12 /architecture → ./i18n/architecture.ts; ROW 13 /doc+/tasks+/task → ./i18n/doc-task.ts
// ROW 14 /system → ./i18n/system.ts; ROW 15 /sessions → ./i18n/sessions.ts
// ROW 16 /manager → ./i18n/manager.ts; ROW 17 /git-history → ./i18n/git-history.ts
// ROW 18 /needs-human → ./i18n/needs-human.ts; ROW 19 /live → ./i18n/live.ts
// ROW 20 /tests → ./i18n/tests.ts; ROW 21 /goal → ./i18n/goal.ts
//
// The dictionaries' own ROW comments (peer columns, closed rosters, byte-equal zh columns) are
// preserved VERBATIM inside each module — this barrel only names where each ROW now lives.
// ==========================================================================================

export { fillLabel } from "./i18n/fill.ts";
export {
  NAV_KEYS,
  NAV_LABELS,
  isNavKey,
  navLabel,
  navLabelsFor,
  pageNameFor,
  LANG_NAMES,
  LANG_SWITCHER_GROUP,
  LANG_SWITCH_ARIA,
  CHROME_LABELS,
  chromeLabel,
} from "./i18n/chrome.ts";
export type { NavKey } from "./i18n/chrome.ts";
export {
  DASHBOARD_KEYS,
  DASHBOARD_LABELS,
  dashboardLabelsFor,
  dashboardLabel,
} from "./i18n/dashboard.ts";
export type { DashboardKey } from "./i18n/dashboard.ts";
export { JOURNAL_KEYS, JOURNAL_LABELS, journalLabelsFor } from "./i18n/journal.ts";
export type { JournalKey } from "./i18n/journal.ts";
export {
  BOARD_KEYS,
  BOARD_LABELS,
  boardLabelsFor,
  boardLabel,
} from "./i18n/board.ts";
export type { BoardKey } from "./i18n/board.ts";
export {
  ARCHITECTURE_KEYS,
  ARCHITECTURE_LABELS,
  architectureLabelsFor,
  architectureLabel,
} from "./i18n/architecture.ts";
export type { ArchitectureKey } from "./i18n/architecture.ts";
export {
  DOC_TASK_KEYS,
  DOC_TASK_LABELS,
  docTaskLabelsFor,
  docTaskLabel,
} from "./i18n/doc-task.ts";
export type { DocTaskKey } from "./i18n/doc-task.ts";
export {
  SYSTEM_KEYS,
  SYSTEM_LABELS,
  systemLabelsFor,
  systemLabel,
} from "./i18n/system.ts";
export type { SystemKey } from "./i18n/system.ts";
export {
  SESSIONS_KEYS,
  SESSIONS_LABELS,
  sessionsLabelsFor,
  sessionLabel,
  sessionLayerHeading,
} from "./i18n/sessions.ts";
export type { SessionsKey } from "./i18n/sessions.ts";
export {
  MANAGER_KEYS,
  MANAGER_LABELS,
  managerLabelsFor,
  managerLabel,
} from "./i18n/manager.ts";
export type { ManagerKey } from "./i18n/manager.ts";
export {
  GIT_HISTORY_KEYS,
  GIT_HISTORY_LABELS,
  gitHistoryLabelsFor,
  gitHistoryLabel,
  gitHistoryClientLabelsFor,
} from "./i18n/git-history.ts";
export type { GitHistoryKey, GitHistoryClientLabels } from "./i18n/git-history.ts";
export {
  NEEDS_HUMAN_KEYS,
  NEEDS_HUMAN_LABELS,
  needsHumanLabelsFor,
  needsHumanLabel,
} from "./i18n/needs-human.ts";
export type { NeedsHumanKey } from "./i18n/needs-human.ts";
export {
  LIVE_KEYS,
  LIVE_LABELS,
  liveLabelsFor,
  liveLabel,
} from "./i18n/live.ts";
export type { LiveKey } from "./i18n/live.ts";
export {
  TESTS_KEYS,
  TESTS_LABELS,
  testsLabelsFor,
  testsLabel,
} from "./i18n/tests.ts";
export type { TestsKey } from "./i18n/tests.ts";
export {
  GOAL_KEYS,
  GOAL_LABELS,
  goalLabelsFor,
  goalLabel,
} from "./i18n/goal.ts";
export type { GoalKey } from "./i18n/goal.ts";
