// goal.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /goal BODY copy (ROW 21).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "../serve-lang.ts";
import { fillLabel } from "./fill.ts";

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
  // gap-webui-goal-list-prune-low-signal-columns: the Goals tab's MERGED progress cell needs the word
  // that introduces its SECOND half (`since {rel}`). ⚠️ A NEW row rather than a literal at the call
  // site, even though it is one word: a hard-coded `since ` would be page copy that never switches
  // language on a `?lang=zh` page, and the ROW 21 rule is about the copy, not about its length.
  // The `{rel}` hole carries the RELATIVE string from `relativeTime()` (itself not localized today —
  // the same treatment the pre-existing `last progress` column already gives it).
  "sincePrefix",
  // the list page's read-failure banner (`<strong>`) — reached only when `client.goalList()` throws,
  // so it is INVISIBLE to a probe that never constructs the state (硬规则 4: a criterion whose state
  // cannot be built is not a measurement). ⚠️ Found by a POSITIONAL sweep of the source after the
  // two-fixture differential had already been run — the differential can only see states that render.
  "listReadFailed",
  // the draft banner: this tab's own count, the explanation with its `<code>` hole, the link, and
  // the cross-tab hint (another tab's count + the link into it)
  "draftOwnBanner", "draftExplain", "viewDrafts", "draftOtherBanner", "draftOtherLink",
  // …and the ONE-LINE form used when BOTH kinds are pending (gap-webui-goal-list-prune-low-signal-
  // columns, proposal e): the two counts on one line instead of two `<p>`s. A separate row rather
  // than a concatenation of the two above, because the rendered sentence is a different sentence —
  // ⛔ `draftOwnBanner` + `draftOtherBanner` glued at the call site would be a sentence assembled
  // outside the dictionary, i.e. one no translator can reorder.
  "draftBothBanner",
  // the empty state: the two `<strong>` variants, then the source-of-truth sentence and the
  // corrected-pointer note (each with its own `{code}` hole — ⛔ not concatenated at the call site)
  "emptyFiltered", "emptyDir", "emptyExplain", "emptyPointerNote",
  // gap-webui-goal-list-title-search-and-ac-rollup-sort: the `?q=` search affordance (placeholder +
  // button) and the no-match empty state (its `{q}` sentence + the link that clears the search).
  // ⚠️ FOUR rows, and the no-match one is separate from `emptyFiltered`/`emptyDir` on purpose: "the
  // store is empty" and "your search matched nothing" are different facts, and a page that showed
  // either sentence for the other state would send the reader to the wrong place (硬规则 3b).
  "searchPlaceholder", "searchButton", "searchNoMatch", "searchClear",
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
  // ⚠️ The zh word is the PRE-EXISTING dictionary's own vocabulary for this relation (「自」 is the
  // same character `firstAt`-style labels use elsewhere); it is not a back-translation of `since`.
  // ⛔ Both columns carry the `{rel}` hole — a one-sided template is not translatable (AC4's rule).
  sincePrefix: { en: "since {rel}", zh: "自 {rel}" },

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
  // ⚠️ `{kind}`/`{kind2}` are the tab's own tokens (`GOAL` / `AC`), passed RAW — see ④ above. The
  // OWN kind comes first (`{n} {kind}`), mirroring the two-`<p>` form it replaces, where the current
  // tab's line came first; ⛔ the order is part of the sentence, so a translator sees it here rather
  // than in a call-site concatenation.
  draftBothBanner: {
    en: "{n} {kind} · {m} {kind2} awaiting a decision",
    zh: "{n} 条 {kind} · {m} 条 {kind2} 待裁定",
  },

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

  // The `?q=` affordance. ⚠️ The placeholder names BOTH searched fields rather than saying
  // "search…": the Goals tab matches id + title and the Criteria tab adds the owning goal id, so a
  // reader who cannot see WHAT is searched has no way to predict a miss (the /tasks placeholder
  // "Search titles and descriptions…" is the same kind of statement about its own fields).
  searchPlaceholder: { en: "Search ids and titles…", zh: "搜索 id 与标题…" },
  searchButton: { en: "Search", zh: "搜索" },
  // ⚠️ The zh sentence is NOT a back-translation of the en one: it is written the way the page's
  // other zh copy states a count of records (「没有…的记录」, the `draftOwnBanner` 「{n} 条 …」 family),
  // and the quotes around `{q}` are the full-width pair the zh column uses elsewhere.
  // ⛔ `{q}` is the reader's OWN input and is HTML-escaped by the caller before it enters the hole —
  // the dictionary stays copy-only (the ROW 20 `{code}` precedent).
  searchNoMatch: { en: "No matches for “{q}”", zh: "没有匹配 “{q}” 的记录" },
  searchClear: { en: "clear the search", zh: "清除搜索" },

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
