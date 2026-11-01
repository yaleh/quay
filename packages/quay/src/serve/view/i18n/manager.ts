// manager.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /manager BODY copy (ROW 16).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "../serve-lang.ts";
import { fillLabel } from "./fill.ts";

// ── ROW 16: the /manager BODY copy (gap-webui-manager-body-copy-en-zh) ───────────────────────────
//
// ROW 5 did this for /dashboard, ROW 10 /journal, ROW 11 /board, ROW 12 /architecture, ROW 13
// /doc+/tasks+/task/<id>, ROW 14 /system and ROW 15 /sessions; this is the series' EIGHTH table and
// it obeys ROW 5~8 unchanged (one row per RENDERED string, `{name}` templates filled by
// `fillLabel`, the zh column byte-equal to the pre-extraction literal, a CLOSED roster, an unknown
// key THROWS).
//
// ⚠️ ROW 14 ④ recorded that /manager "shares serve-system.ts but is a DIFFERENT page with its own
// task". This row IS that task. The two tables are PEERS, not renames of one another, and the file
// they share is why the census behind this task was taken per RENDER FUNCTION rather than per file:
// `serve-system.ts`'s 17 non-comment CJK lines are 6 for /system (ROW 14) + 11 for /manager (here),
// and a file count alone cannot tell which row a given line belongs to.
//
// THE PAGE'S SHAPE: /manager answers "what are the three layers doing?" — four `<h2>` sections
// (Loop/会话, Monitor 注册表, 主要观测指标, plus the `<h1>`'s own subtitle), each with a
// `<p class="meta">` naming where its reading comes from, two table headers, and the release line.
// Its body copy is EXACTLY 11 rendered strings — the 11 non-comment CJK lines of `renderManagerPage`
// — one row each. That 1:1 correspondence is deliberate: it makes the roster checkable against the
// SOURCE, rather than against a feeling that the page "looks translated".
//
// ① THE `<h1>` SUBTITLE IS A ROW, THE PAGE NAME IS NOT (ROW 14 ③'s ruling, applied here). The page
//    passes the bare `Manager / Outer / Inner` token to `pageNameFor` (ROW 3) and appends its tail
//    from THIS table: two parallel lookups, each actually read in both languages. ⛔ Passing a
//    pre-localized composite to ROW 3 would make the lookup MISS under zh and render correctly by
//    falling through the dictionary — 硬规则 3b's silent shape, where a miss and a hit look alike.
//    ⚠️ The row is named `h1Subtitle` and not ROW 14's `pageSubtitle` because HERE it renders in the
//    `<h1>` ONLY: this page's `<title>` is the bare page token, with no subtitle at all — the exact
//    inverse of ROW 15, where the `<title>` and the `<h1>` each carry one.
//
// ② THE `<meta name="description">` IS IN THE ROSTER even though the census that produced these keys
//    cannot see it: it lives in an ATTRIBUTE, so a probe that strips tags and counts text lines — the
//    series' AC1 red-baseline probe — never reads it. It is still copy a reader meets (search
//    results, the tab's own tooltip), and ROW 14 and ROW 15 each carry the same row. Leaving it out
//    would mean the page's localization was measured by an instrument blind to it (硬规则 4b).
//
// ③ PARAMETERS ARE PRE-ESCAPED MARKUP WHERE THE CALLER OWNS AN ELEMENT (ROW 14 ①, reused).
//    `registryNote` and `poolSourceNote` each wrap a file path in `<code>`; the dictionary never
//    carries markup, so the caller assembles the fragment and emits the filled string RAW. The words
//    BETWEEN those fragments stay in the row, so no language-bearing punctuation or connector lives
//    at a call site. `releaseLine` shows why that matters: the ` · ` separator AND the word order of
//    「develop 领先 {n} 提交」 are both inside the row — a call site concatenating 「领先 」+n+「 提交」
//    would be a sentence only Chinese word order can assemble, with the en column unfixable without
//    editing the call site.
//
// ④ TWO ROWS ARE LATENT, and are rows here BECAUSE they are: a healthy single-response probe cannot
//    see either (ROW 13's lesson — the same reason ROW 14's `unknownLimit` exists).
//      - `colSession` renders only when the liveness reader returns ≥1 session row (it is retired
//        today, so nothing on the live page reaches it);
//      - `recentPromotions` renders only when the pool reader's `lastPromoted` is non-empty.
//    Both were found by reading the RENDER FUNCTION, not the rendered page. A roster built only from
//    what a probe happens to show would omit them and stay green forever after (硬规则 3b).
//
// ⑤ NOT IN THIS ROW, and why (each a judgement, not an omission):
//    - `obsNote`'s state words (`未接入/无数据`, `已接入/暂无记录`, `读失败`) are SHARED chrome: one
//      function in serve-render.ts renders them on EVERY page, and ROW 15 ⑥ assigned them to the
//      series' shared residue list. This page echoes three of them (`loopDriver`, `liveness`, `pool`),
//      which is exactly why this task's own census — a count of CJK lines in the RESPONSE — listed
//      them: a per-response count cannot distinguish a page's own copy from the shared chrome the page
//      renders. ⛔ Localizing them from here would move seven other pages' `lang=en` output and red
//      `serve-architecture-body-i18n.test.mjs`, whose empty-state arm asserts this residue is STILL
//      Chinese — a guard written precisely so that a later "translate everything" pass cannot do it by
//      accident. This task's dedup note asked whether to add a page-local row for the word; the answer
//      recorded here is NO, and for ROW 9's reason: a second copy of a shared word is the drift a
//      shared table exists to prevent. The word's home is a shared-chrome row of its own.
//    - The reader DIAGNOSTIC after that prefix (`— …/loop-driver-check.sh 缺失（…）`,
//      `— .quay/promotion-round.jsonl 尚无 round 记录（…）`) is DATA: a reader's own description of
//      what it could not read, rendered verbatim in both languages — the same class as a task title.
//    - The observer TABLE's rows (`name`/`status`/`root`/`note`) are DATA read out of
//      `orchestration/observer-registry.conf`; this repo's own registry carries Chinese notes
//      (`本仓库（项目类）`, `兄弟项目`), and translating them would be translating the user's registry.
//    - The two JSON field-name `<h2>`s and the meter labels are /system's (ROW 14 ④) and are
//      untouched from this side too. ⚠️ Those two `<h2>`s are named NOWHERE in this module: their
//      text is DERIVED from the single accessor (observation.ts's REL constants →
//      `scriptBasename`), so neither basename is a dictionary literal here — a second literal would
//      be exactly the copy this table exists to prevent
//      (gap-serve-labels-hardcode-mechanism-script-basenames).
export const MANAGER_KEYS = [
  // <head> meta description (②) + the <h1>'s subtitle tail (①)
  "metaDescription", "h1Subtitle",
  // the page's intro note under the <h1>, and the three section headings
  "probeNote", "headingLoop", "headingObservers", "headingPool",
  // the two <p class="meta"> provenance notes (③ — one `{file}` parameter each)
  "registryNote", "poolSourceNote",
  // the release line (③ — `{version}` + `{n}`)
  "releaseLine",
  // latent rows (④): the liveness table's first column header, the pool card's promotion list
  "colSession", "recentPromotions",
] as const;

export type ManagerKey = (typeof MANAGER_KEYS)[number];

/** The /manager body-copy dictionary — see ROW 16 (and ROW 5~8, which it obeys unchanged). */
export const MANAGER_LABELS: Record<ManagerKey, { en: string; zh: string }> = {
  metaDescription: {
    en: "Quay manager — Manager / Outer / Inner three-layer status",
    zh: "Quay manager — Manager/Outer/Inner 三层状态",
  },

  // ① the `<h1>`'s tail, after ROW 3's page NAME. ⚠️ ROW 3 keys on the bare `Manager / Outer /
  // Inner` token; this row is only the part after the em dash (which the render site keeps, as ROW
  // 14 does), so the two can be re-worded independently.
  h1Subtitle: { en: "three-layer status", zh: "三层状态" },

  probeNote: {
    en: "Three-layer adaptive probing: multi-signal weighted verdicts; a missing signal is honestly marked as not detected rather than silently assumed.",
    zh: "三层自适应探测：多信号加权判定，缺失信号诚实标注「未检测到」，不静默假设。",
  },

  // The three `<h2>`s. `Loop` / `Monitor` stay ASCII — they are the mechanism's own names for the
  // things being observed, and the row is the WHOLE heading so the `/` separator sits inside it.
  headingLoop: { en: "Loop / sessions", zh: "Loop / 会话" },
  headingObservers: { en: "Monitor registry", zh: "Monitor 注册表" },
  headingPool: { en: "Primary observability metrics", zh: "主要观测指标" },

  // ③ `{file}` is the caller's `<code>`-wrapped path — DATA, escaped and untranslated.
  registryNote: {
    en: "Reads the single registration table {file}.",
    zh: "读 {file} 单一登记表。",
  },
  poolSourceNote: {
    en: "pool/floor/deficit/cap are read from {file} (promotion-driver round records; cap defaults to 5, floor = cap × 4)",
    zh: "pool/floor/deficit/cap 读 {file}（promotion-driver round 记录，cap 默认 5，floor = cap × 4）",
  },

  // ③ `{version}` is the build-time QUAY_VERSION, `{n}` the commit count — both DATA. ⛔ The
  // separator and the word order are INSIDE the row, never at the call site.
  releaseLine: {
    en: "release={version} · develop is {n} commits ahead",
    zh: "release={version} · develop 领先 {n} 提交",
  },

  // ④ latent rows — see the roster comment. `colSession` is one word because the other three
  // columns of that table (`alive` / `pid` / `halted`) are the reader's own field names, not copy.
  colSession: { en: "Session", zh: "会话" },
  recentPromotions: {
    en: "Most recent promotions (promotion-driver):",
    zh: "最近一轮晋升（promotion-driver）：",
  },
};

/** The whole ROW 16 roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `MANAGER_LABELS` at each call site. */
export function managerLabelsFor(lang: Lang = DEFAULT_LANG): Record<ManagerKey, string> {
  const out = {} as Record<ManagerKey, string>;
  for (const key of MANAGER_KEYS) out[key] = MANAGER_LABELS[key][lang];
  return out;
}

/** One ROW 16 label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`). */
export function managerLabel(
  key: ManagerKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(MANAGER_LABELS, key) ? MANAGER_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown manager key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}
