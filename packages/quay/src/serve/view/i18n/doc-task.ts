// doc-task.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /doc + /tasks + /task/<id> RESIDUAL EDGE-STATE copy (ROW 13).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";
import { fillLabel } from "./fill.ts";

// ── ROW 13: the /doc + /tasks + /task/<id> RESIDUAL EDGE-STATE copy ──────────────────────────────
// (gap-webui-doc-tasks-residual-copy-en-zh)
//
// ROW 5 did this for /dashboard, ROW 10 for /journal, ROW 11 for /board and ROW 12 for
// /architecture; this is the series' FIFTH table and it obeys ROW 6/ROW 7/ROW 8 unchanged (one row
// per RENDERED string, `{name}` templates filled by `fillLabel`, the zh column byte-equal to the
// pre-extraction literal, a CLOSED roster, an unknown key THROWS).
//
// WHY THIS TABLE IS THE SERIES' ODD ONE: the four page tables each cleared a page that was FULL of
// Chinese body copy. By the time this task ran, /doc, /tasks and /task/<id> had no Chinese at all on
// the URL anyone would grab — the residue was five strings that render ONLY in edge states (a store
// read failure, a task file with no id, a file whose frontmatter will not parse, the Runs block with
// no records, and its in-flight row). The consequence is methodological, not cosmetic: the series'
// standing baseline — "count the CJK lines under `lang=en`" — is ZERO before this change and zero
// after, so it cannot witness this table at all. The red baseline for ROW 13 is a FIXTURE that makes
// each of the five states actually render (see the test file's `before()`), which is the only shape
// in which this copy is reachable (硬规则 4: a reading that cannot take the other value is not one).
//
// WHY ONE TABLE FOR TWO PAGES (the task's own ruling, recorded here because a later reader will
// wonder): `serve-task.ts` owns BOTH /tasks and /task/<id>, and the /doc half is a single string.
// Two tables would put both under the same `serve-i18n.ts` Touches lock anyway while inventing a
// second roster shape for one row's benefit. The unit stays the RENDERED STRING (ROW 5), so the
// table's name is where the copy LIVES, not a boundary claim about pages.
//
// ① A PARAMETER MAY BE PRE-ESCAPED MARKUP, AND THAT IS THE COMPLIANT DIRECTION. Three of these rows
//    wrap live data in an element the CALLER owns: `⚠ <code>{file}</code> — 解析失败: …`, the
//    `<code>`-wrapped carrier path inside the Runs empty state, and the missing-id row's cell (a
//    link when the task has an id, escaped text when it does not). ROW 6 forbids the DICTIONARY
//    carrying markup; it does not forbid the caller assembling it. So the caller passes the
//    already-`escapeHtml`'d, already-wrapped fragment in as the parameter and emits the filled
//    string RAW — the same idiom as ROW 5's `gitReadFailedWithReason` (serve-dashboard.ts, which
//    calls `fillLabel(L.gitReadFailedWithReason, { reason: escapeHtml(cap) })`). The alternative —
//    embedding `<code>`/`<a>` in the label — is what ROW 12 ① split three separate rows to AVOID.
//
// ② THE zh COLUMN IS THE PRE-EXISTING LITERAL, BYTE FOR BYTE — brackets included. English needs
//    ASCII `(` `)` and a half-width `:`; Chinese had full-width `（` `）` and a half-width `:` (the
//    error banner's colon really is ASCII today, which is why `docReadFailed` ends in `:` in BOTH
//    columns rather than being "corrected" here). ⛔ The brackets are INSIDE the label in both
//    columns, never concatenated at the call site: a call site assembling `（` + path + `）` would be
//    a language-bearing fragment outside the dictionary, which is the exact shape ROW 6 removes.
//
// ⚠️ NOT IN THIS ROW, and why (each a judgement, not an omission):
//   - The Runs table's `<th>` headings (`started`/`state`/`exit`/`wall`/`worker pid`/`run id`/
//     `transcript`/`fan-in`) and `renderFanInCell`'s `landed`/`red`/`step`/`lock`/`suite`/`sha`
//     tokens are ALREADY English in both languages and pass through no dictionary. Translating them
//     would change `lang=zh` output, which AC3 forbids. They are /task/<id>'s named residue.
//   - The detail page's CHROME (`<html lang="en">`, `renderSiteNav("tasks")` with no `lang`,
//     `renderMobileChrome` likewise) is deliberately NOT wired here: AC-290 registered it as
//     out-of-scope residue ("the DETAIL page … is not one of the 15 nav routes"), and this task's
//     criterion is the five edge-state strings, not the detail page's frame. Under `?lang=zh` the
//     Runs block switches while the surrounding chrome stays English — that is the registered
//     residue, visible and named, not a silent half-migration.
//   - `m.error` and the `<code>`-wrapped carrier PATH are DATA (a YAML parser's diagnostic, a file
//     path). They ride in as parameters and are `escapeHtml`'d verbatim in both languages.
export const DOC_TASK_KEYS = [
  // /doc — the store read-failure banner (serve-doc.ts, the `<strong>` of the `.error-banner`)
  "docReadFailed",
  // /tasks — the two `.malformed-row` placeholders
  "taskMissingId", "taskParseFailed",
  // /task/<id> — the Runs block's three states
  "runsNoRecords", "runsUnreadable", "runInFlight",
] as const;

export type DocTaskKey = (typeof DOC_TASK_KEYS)[number];

/** The /doc + /tasks + /task/<id> residual edge-state dictionary — see ROW 13 (and ROW 5~8, which it
 *  obeys unchanged). */
export const DOC_TASK_LABELS: Record<DocTaskKey, { en: string; zh: string }> = {
  // The `<strong>` of /doc's read-failure banner. ⚠️ `:` is ASCII in the zh column because it is
  // ASCII in the pre-extraction literal (`<strong>读失败:</strong>`) — see ROW 13 ②.
  docReadFailed: { en: "Read failed:", zh: "读失败:" },

  // The `.malformed-row` for a task whose frontmatter carries no `id:` (the provider falls back to
  // the file name and flags the task). `{id}` is the caller's cell — a `/task/<id>` link when an id
  // exists, escaped display text when it does not (ROW 13 ①).
  taskMissingId: { en: "⚠ {id} — missing id field", zh: "⚠ {id} — 缺少 id 字段" },
  // The `.malformed-row` for a file whose frontmatter will not parse at all. `{file}` is the
  // `<code>`-wrapped file name; `{error}` is the parser's diagnostic (DATA, escaped, untranslated).
  taskParseFailed: { en: "⚠ {file} — parse failed: {error}", zh: "⚠ {file} — 解析失败: {error}" },

  // The Runs block when there is neither a record nor a live worker. `{carrier}` is the
  // `<code>`-wrapped path — DATA. ⚠️ The brackets are INSIDE the row in both columns (ROW 13 ②).
  runsNoRecords: {
    en: "No worker runs recorded ({carrier})",
    zh: "无 worker 运行记录（{carrier}）",
  },
  // gap-needs-human-raw-fan-in-reason-observation-surface: the Runs block when the carrier EXISTS
  // but could not be read. ⛔ A SEPARATE row from `runsNoRecords` on purpose — 「读不出」 and
  // 「无记录」 are different facts, and one shared row would make a broken log indistinguishable
  // from a task that never ran (硬规则 3b). Same `{carrier}` hole (DATA, the reader's own path); the
  // reader's diagnostic sentence follows it at the call site (also DATA, also escaped).
  runsUnreadable: {
    en: "Worker runs could not be read ({carrier})",
    zh: "worker 运行记录读不出（{carrier}）",
  },
  // The Runs row for a worker that is live right now (no END record yet). ⛔ NOT folded into ROW 5's
  // `running` ("Running"/"运行中"): a different zh word, a different table and a different page — the
  // series' rule that a shared row makes one page's next re-wording move another page's copy.
  runInFlight: { en: "In progress", zh: "进行中" },
};

/** The whole ROW 13 roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `DOC_TASK_LABELS` at each call site. */
export function docTaskLabelsFor(lang: Lang = DEFAULT_LANG): Record<DocTaskKey, string> {
  const out = {} as Record<DocTaskKey, string>;
  for (const key of DOC_TASK_KEYS) out[key] = DOC_TASK_LABELS[key][lang];
  return out;
}

/** One ROW 13 label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`). */
export function docTaskLabel(
  key: DocTaskKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(DOC_TASK_LABELS, key) ? DOC_TASK_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown doc-task key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}
