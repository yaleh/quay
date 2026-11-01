// needs-human.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /needs-human BODY copy (ROW 18).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";
import { fillLabel } from "./fill.ts";

// ── ROW 18: the /needs-human BODY copy (gap-webui-needs-human-body-copy-en-zh) ────────────────────
//
// ROW 5 opened the body-copy series for /dashboard; ROW 17 did /git-history; this is the next page
// and it obeys ROW 2 / ROW 6 / ROW 7 / ROW 8 unchanged: the roster is CLOSED, the zh column is the
// pre-existing literal BYTE FOR BYTE, interpolated copy carries `{name}` in both columns, and both
// an unknown key and an unfilled `{name}` THROW.
//
// ⚠️ `{code}` IS THIS ROW'S ONE NEW SHAPE, and it is deliberate. The page's intro sentence and its
// two section headings each EMBED a `<code>` ELEMENT mid-sentence
// (`一条 <code>needs-human</code> 产生后…`), so a naive extraction splits one sentence into three
// fragments whose English word order cannot be reassembled at the call site (ROW 6's own argument).
// Carrying the sentence as ONE template with a `{code}` hole keeps the `<code>` ELEMENT at the
// render site (the dictionary stays copy-only — ⛔ no other table's value contains markup) while
// letting each column place the hole wherever its own word order needs it.
// ⛔ The `{code}` VALUE IS MARKUP, so it is passed ESCAPED-NOWHERE on purpose: its source is a
// literal in this repo, never request data. Anything derived from a task body goes through
// `escapeHtml` as before.
//
// ⚠️ WHY THE EMPTY STATES ARE ROWS EVEN THOUGH THE HEALTHY PAGE NEVER RENDERS THEM: they are this
// page's copy every bit as much as the headings are, and a roster built only from the populated
// render would leave the page half-English in exactly the state an operator reaches for it. This
// task's red baseline measured BOTH states for that reason (a single fetch cannot see the other).
export const NEEDS_HUMAN_KEYS = [
  // page header (the `<h1>`'s suffix, rendered as `${pageNameFor("Needs Human", lang)} — <this>`;
  // ⛔ the page NAME token is ROW 3's business, not this row's)
  "titleSuffix", "metaDescription", "intro",
  // the two section headings — each carries a `{code}` hole (see the note above)
  "sectionActive", "sectionLedger",
  // the reason column: its header, and the word for "the task carries no recorded reason"
  "colReason", "reasonNotRecorded",
  // the two empty states (see the note above)
  "emptyActive", "emptyLedger",
  // the latest-failure column (gap-needs-human-raw-fan-in-reason-observation-surface): its header,
  // the word for "no attempt is recorded for this task", and the word for the ONE state that must
  // not read as an empty cell — the attempt log exists but could not be read (硬规则 3b).
  "colLatestFailure", "latestFailureNotRecorded", "latestFailureUnreadable",
] as const;

export type NeedsHumanKey = (typeof NEEDS_HUMAN_KEYS)[number];

/** The /needs-human body-copy dictionary — see ROW 18 and ROW 2/ROW 6/ROW 7/ROW 8. */
export const NEEDS_HUMAN_LABELS: Record<NeedsHumanKey, { en: string; zh: string }> = {
  titleSuffix: { en: "Awaiting human decision", zh: "待人类决定" },
  metaDescription: {
    en: "Quay needs-human — the explicit human-interface owner",
    zh: "Quay needs-human — 显式人机承接界面",
  },
  // One sentence, one row, one `{code}` hole — ⛔ NOT three rows concatenated at the call site.
  intro: {
    en: "The explicit owner of the human interface: once a {code} is raised, it is visible on this page without reading any transcript. Above is the \"currently awaiting\" list; below is the \"escalation ledger\" (including historical samples whose status has since moved on).",
    zh: "人机接口的显式承接者：一条 {code} 产生后，无需读任何 transcript，在此页即可看到。上面是「当前待办」，下面是「升级台账」（含状态已流转的历史样本）。",
  },
  // The `<code>` payloads are the two store/ledger discriminators (`status: needs-human` /
  // `action: needs-human`) — ASCII tokens, identical in both languages, carried by the call site's
  // `{code}` param rather than duplicated into both columns.
  sectionActive: { en: "Currently awaiting ({code})", zh: "当前待办（{code}）" },
  sectionLedger: { en: "Escalation ledger ({code})", zh: "升级台账（{code}）" },
  colReason: { en: "Blocking reason", zh: "阻碍原因" },
  // ⚠️ ONE row, TWO call sites: the cell's text AND its `title` attribute render the identical
  // string, so a second row here would let the two drift apart (ROW 5's readFailed note).
  reasonNotRecorded: { en: "Not recorded", zh: "未记录" },
  emptyActive: {
    en: "No needs-human tasks currently (see the escalation ledger below).",
    zh: "当前无 needs-human 任务（升级台账见下）。",
  },
  // The ledger's source file is DATA (the reader's own path) and rides the `{code}` hole verbatim,
  // so the en column cannot silently drop the operator's only pointer to which file this is.
  emptyLedger: {
    en: "No needs-human escalations recorded ({code}).",
    zh: "无 needs-human 升级记录（{code}）。",
  },
  // ── the latest-failure column (gap-needs-human-raw-fan-in-reason-observation-surface) ──────────
  // ⚠️ The CELL's content is the driver's RAW failure text — DATA, rendered verbatim and escaped,
  // NOT a row here (this page's standing rule: 阻碍原因 / ledger detail / task titles are never
  // translated). These three rows are only the column header and its two WORDS FOR ABSENCE.
  // ⚠️ TWO rows for absence, not one: "no attempt is recorded for this task" and "the attempt log
  // could not be read" are different facts and must not share a string (硬规则 3b — a reader that
  // cannot read its input must not render the same bytes as a reader that found nothing).
  colLatestFailure: { en: "Latest failure (raw)", zh: "最近失败原文" },
  latestFailureNotRecorded: { en: "No attempt recorded", zh: "无尝试记录" },
  latestFailureUnreadable: { en: "Attempt log unreadable", zh: "尝试日志读不出" },
};

/** The whole /needs-human roster resolved for one language — take it ONCE per render (the
 *  `dashboardLabelsFor` idiom), rather than re-reading `NEEDS_HUMAN_LABELS` per call site. */
export function needsHumanLabelsFor(lang: Lang = DEFAULT_LANG): Record<NeedsHumanKey, string> {
  const out = {} as Record<NeedsHumanKey, string>;
  for (const key of NEEDS_HUMAN_KEYS) out[key] = NEEDS_HUMAN_LABELS[key][lang];
  return out;
}

/** One /needs-human label, interpolated. Unknown key ⇒ THROW; missing parameter ⇒ THROW (both via
 *  ROW 8's / ROW 6's rule — see `dashboardLabel`, whose body this mirrors exactly). */
export function needsHumanLabel(
  key: NeedsHumanKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(NEEDS_HUMAN_LABELS, key) ? NEEDS_HUMAN_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown needs-human key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}
