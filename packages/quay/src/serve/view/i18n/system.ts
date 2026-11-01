// system.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /system BODY copy (ROW 14).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";
import { fillLabel } from "./fill.ts";

// ── ROW 14: the /system BODY copy (gap-webui-system-body-copy-en-zh) ─────────────────────────────
//
// ROW 5 did this for /dashboard, ROW 10 for /journal, ROW 11 for /board, ROW 12 for /architecture
// and ROW 13 for /doc + /tasks + /task/<id>; this is the series' SIXTH table and it obeys ROW 6/ROW
// 7/ROW 8 unchanged (one row per RENDERED string, `{name}` templates filled by `fillLabel`, the zh
// column byte-equal to the pre-extraction literal, a CLOSED roster, an unknown key THROWS).
//
// THE PAGE'S SHAPE: /system is the series' SMALLEST page after /board — six rows. That is the whole
// reason it needs its own comment rather than none: AC-293 already wired this page's CHROME (the
// `<html lang>` attribute, the shared nav bar, the `<title>` and the `<h1>`'s page NAME), so the
// residue here is exactly the part of the page that was left over — the `<title>`/`<h1>` SUBTITLE
// (`— 系统状态`, which AC-293 could not see: it wired `pageNameFor("System")`, and the subtitle was
// concatenated outside it), the two `<p class="meta">` notes, the resource banner's verdict text,
// and the meter bar's unknown-limit marker.
//
// ① A PARAMETER MAY BE PRE-ESCAPED MARKUP (ROW 13 ①'s rule, reused). Two rows here wrap live data
//    in an element the CALLER owns: `dataSourceNote`'s two `<code>` elements and `thresholdNote`'s
//    `<code>nproc</code>`. ROW 6 forbids the DICTIONARY carrying markup; it does not forbid the
//    caller assembling it, so the caller passes the already-wrapped fragment in as the parameter
//    and emits the filled string RAW. ⛔ The alternative — moving the `<code>` elements out to the
//    call site — would put the ` · ` separator and the ( ) brackets outside the dictionary, i.e.
//    language-bearing fragments at a call site, which is the exact shape ROW 6/ROW 13 ② remove.
//
// ② THE BANNER'S LEADING SEPARATOR IS INSIDE THE ROW. `bannerGo`/`bannerWait` are the text AFTER
//    the `<strong>⇒ GO</strong>` verdict token, and the colon that joins them is language-bearing
//    (zh full-width `：`, en ASCII `: `) — so it lives in the row, exactly as ROW 13 ② keeps the
//    brackets in the row. The verdict TOKEN itself (`GO`/`WAIT`) stays in the markup: it is the
//    machine's own word (the `verdict` field of the resource gate's `--json` — the script's name
//    itself is DERIVED on the page from the single accessor in observation.ts, never re-spelled
//    here), not copy, and it reads the same in both languages.
//
// ③ THE PAGE NAME AND THE SUBTITLE ARE PARALLEL, NOT MERGED (this task's ruling). `pageTitle`
//    receives the bare `System` token and its suffix is appended OUTSIDE it, so the NAME resolves
//    through ROW 3's `PAGE_LABELS` and the SUBTITLE through this table: each table owns one piece
//    and neither is a copy of the other. ⛔ Passing a PRE-LOCALIZED composite token
//    (`${pageNameFor("System", lang)} — …`) would make ROW 3's lookup MISS under zh and silently
//    return the token it was handed — the composite would render correctly by falling through the
//    dictionary rather than by being found in it (硬规则 3b: a lookup that misses must not be
//    indistinguishable from one that hit). The legacy composite row
//    `PAGE_LABELS["System — 系统状态"]` is therefore RETIRED here: its zh value lives on as
//    `pageSubtitle` + ROW 3's `System`, and leaving the row would be a second, unread copy.
//
// ④ ⚠️ NOT IN THIS ROW, and why (each a judgement, not an omission):
//    - `/manager` shares `serve-system.ts` but is a DIFFERENT page with its own task
//      (gap-webui-manager-body-copy-en-zh). Its body copy is deliberately untouched here.
//    - The meter TABLES' row labels (`cpu_stall (avg10)`, `mem_avail`, `total_budget`, `verdict`,
//      the `nproc×2≈32` captions) are the mechanism scripts' JSON field names and units — data,
//      already ASCII, and translating them would change `lang=zh` output, which AC3 forbids.
//    - `pageTitle`'s no-identity fallback (`未接入项目身份 — …` in serve-render.ts) renders only
//      when identity resolution fails; it is shared chrome owned by the same series' residue list
//      (registered by gap-webui-dashboard-body-copy-en-zh), ⛔ not this page's to move.
//    - `readSystem`'s diagnostics (`obsNote`'s reason strings, e.g. 「system 机制脚本缺失」) are
//      DATA: a reader's own description of what it could not read, rendered verbatim in both
//      languages — the same class as a task title.
export const SYSTEM_KEYS = [
  // the <title>/<h1> subtitle (appended after the ROW 3 page name)
  "pageSubtitle",
  // the two <p class="meta"> notes
  "dataSourceNote", "thresholdNote",
  // the resource banner's two verdict texts
  "bannerGo", "bannerWait",
  // the meter bar's unevaluable-denominator marker
  "unknownLimit",
] as const;

export type SystemKey = (typeof SYSTEM_KEYS)[number];

/** The /system body-copy dictionary — see ROW 14 (and ROW 5~8, which it obeys unchanged). */
export const SYSTEM_LABELS: Record<SystemKey, { en: string; zh: string }> = {
  // The `<h1>`/`<title>` subtitle. ⚠️ ROW 3 keeps the NAME (`System` / `系统`); this row is only the
  // tail after the em dash, which is why the two can be re-worded independently (ROW 14 ③).
  pageSubtitle: { en: "system status", zh: "系统状态" },

  // The `<p class="meta">` under the `<h1>`. `{gate}`/`{budget}` are the caller's `<code>`-wrapped
  // command names (ROW 14 ①) — DATA, escaped and untranslated.
  dataSourceNote: {
    en: "Data source: {gate} · {budget} (stable machine-readable JSON output)",
    zh: "数据源：{gate} · {budget}（稳定机读 JSON 输出）",
  },
  // The `<p class="meta">` under the process-budget table. `{nproc}` is the `<code>nproc</code>`
  // element (ROW 14 ①).
  thresholdNote: {
    en: "Thresholds are computed from {nproc} at render time — this page never hard-codes the numbers of the machine it happens to run on.",
    zh: "阈值按 {nproc} 动态计算显示，不写死当前机器上的数字。",
  },

  // The resource banner's two tails — ⚠️ the joining colon is INSIDE the row (ROW 14 ②).
  bannerGo: { en: ": resources sufficient, safe to run", zh: "：资源充足，可以跑" },
  bannerWait: { en: ": resources constrained, waiting", zh: "：资源受限，等待" },

  // The meter bar's marker for a value with no evaluable denominator. ⛔ NOT folded into ROW 5's
  // `identityNotEvaluated` (「未评估（缺一侧读数）」): a different word, a different table, a
  // different page — the series' rule that a shared row makes one page's next re-wording move
  // another page's copy.
  unknownLimit: { en: "(unknown limit)", zh: "（未知上限）" },
};

/** The whole ROW 14 roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `SYSTEM_LABELS` at each call site. */
export function systemLabelsFor(lang: Lang = DEFAULT_LANG): Record<SystemKey, string> {
  const out = {} as Record<SystemKey, string>;
  for (const key of SYSTEM_KEYS) out[key] = SYSTEM_LABELS[key][lang];
  return out;
}

/** One ROW 14 label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`). */
export function systemLabel(
  key: SystemKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(SYSTEM_LABELS, key) ? SYSTEM_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown system key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}
