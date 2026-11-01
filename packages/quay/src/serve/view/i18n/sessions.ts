// sessions.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /sessions + /session/<id> BODY copy (ROW 15).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "./lang.ts";
import { fillLabel } from "./fill.ts";

// ── ROW 15: the /sessions + /session/<id> BODY copy (gap-webui-sessions-body-copy-en-zh) ─────────
//
// ROW 5 did this for /dashboard, ROW 10 /journal, ROW 11 /board, ROW 12 /architecture, ROW 13
// /doc+/tasks+/task/<id> and ROW 14 /system; this is the series' SEVENTH table and it obeys ROW
// 5~8 (one row per RENDERED string, `{name}` templates filled by `fillLabel`, the zh column
// byte-equal to the pre-extraction literal, a CLOSED roster, an unknown key THROWS) unchanged.
//
// TWO PAGES, ONE FILE, ONE TABLE. `serve-sessions.ts` renders BOTH the `/sessions` list and the
// `/session/<sessionId>` detail view, and the task's census ("非注释中文行 24 条") is a FILE
// measurement — so the roster below covers both pages rather than the list alone. Splitting them
// into two tables would put two pages' copy in one file's dict anyway; keeping one table is what
// makes the census checkable line by line.
//
// ① THE TITLE AND THE `<h1>` CARRY DIFFERENT SUBTITLES HERE — hence TWO rows, not ROW 14's one.
//    `/system`'s `<title>` and `<h1>` share `系统状态`. `/sessions`'s do NOT: the `<title>` says
//    `会话观测` while the `<h1>` says the louder `会话观测（运行中 + 已结束）`. ⛔ Collapsing them
//    into one row would silently shorten the `<h1>` — the two are re-wordable independently, and a
//    single row would make one page's future re-wording move the other site.
//
// ② THE COMPOSITE `PAGE_LABELS` ROWS ARE RETIRED (ROW 14 ③'s ruling, applied here). The page used
//    to pass `"Sessions — 会话观测"` / `"Sessions — 会话观测（运行中 + 已结束）"` to `pageTitle` /
//    `pageNameFor`. That structure CANNOT be localized: `pageNameFor` returns its argument
//    UNCHANGED for `en` (ROW 3: "en is the identity"), so the en column of those rows was never
//    read and the composite rendered its own Chinese under both languages. The page now passes the
//    bare `Sessions` token (ROW 3's new row) and appends the subtitle from THIS table — two
//    parallel lookups, each of which is actually read in both languages. The retired rows' zh
//    values live on as `pageSubtitle` + `h1Subtitle` + ROW 3's `Sessions`; leaving them would be a
//    second, unread copy (the series' single-source rule).
//
// ③ PARAMETERS ARE PRE-ESCAPED MARKUP WHERE THE CALLER OWNS AN ELEMENT (ROW 14 ①, reused). The
//    data-source notes wrap command names / a transcript path in `<code>`, `refusedStateRecord`
//    carries the shared schema's own verdict text, and `lifecycleNote` wraps three commands. The
//    dictionary never carries markup; the caller assembles the fragment and emits the filled
//    string RAW. The words BETWEEN those fragments stay in the row, so no language-bearing
//    punctuation or connector lives at a call site.
//
// ④ THE CLIENT-SIDE SCRIPT'S STRING IS A ROW TOO (the series' ⑦). The detail page's scroll loader
//    rewrites the sentinel node with `更早的 transcript 超出读取窗口 — <a…>下载完整 transcript</a>`
//    when it runs past the read window. That string is built in the BROWSER, so a server-side
//    render can only localize it by INLINING the words as JS string literals — which is what
//    `handleSession` does via `JSON.stringify`. ⛔ Two rows rather than one because the `<a href>`
//    carries the RUNTIME sessionId and must be concatenated in the browser; `earlierBeyondWindow`
//    therefore ends at the em dash (trailing space included — it is inside the row, exactly as
//    ROW 14 ② keeps the joining colon inside its rows).
//
// ⑤ THE POST HANDLERS ARE IN THE ROSTER, because their JSON `reason` is what the browser SHOWS
//    after a native form submit (the three lifecycle forms POST without JS; the response body IS
//    the next page). They are the one class of copy a single GET probe can never see (ROW 13's
//    lesson), which is why the task asserts them separately. The handlers receive the per-request
//    `lang` the dispatcher already resolved — ⛔ they must not re-parse `?lang=`/the cookie (a
//    second parse is a second decision table reading a different request's inputs).
//
// ⑥ NOT IN THIS ROW, and why (each a judgement, not an omission):
//    - `obsNote`'s state words (`未接入/无数据`, `读失败`, …) are SHARED chrome: one function in
//      `serve-render.ts` renders them on EVERY page, so they belong to the series' residue list
//      (registered by gap-webui-dashboard-body-copy-en-zh) and not to this page.
//    - `pageTitle`'s no-identity fallback (`未接入项目身份 — …`) is the same class, and ROW 14 ④
//      already assigned it to that residue list.
//    - `renderSendForm` (`serve-send.ts`) renders a Chinese delivery form INSIDE the detail page.
//      It is a DIFFERENT module with its own POST surface and is not in this task's Touches.
//    - `SESSION_LAYERS`' headings live in `observation.ts` (a shared session primitive, not in
//      Touches). The `Other / 未分类` heading is nevertheless THIS page's `<h2>`, so it is
//      localized at the RENDER SITE through `layerOther` — observation.ts is untouched and the
//      roster stays closed. `Manager`/`Outer`/`Inner` are ASCII and unchanged.
//    - Session names, transcript text, the machine's `session.lifecycle=`/`session.activity=`
//      field names and the shared schema's refusal DETAIL are DATA: a reader's own content and
//      the machine's own words, rendered verbatim in both languages.
//    - The detail page's `<html lang>` attribute and its nav/mobile-chrome are CHROME (the
//      AC-290~303 family), untouched here: this table is BODY copy. Switching them would move the
//      `lang=zh` baseline this task's third criterion diffs.
export const SESSIONS_KEYS = [
  // list page: <title> + <h1> subtitles (① — two rows, they are not the same string)
  "pageSubtitle", "h1Subtitle",
  // list page: <head> meta description
  "metaDescription",
  // list page: <p class="meta"> data-source note, the per-layer empty state, the GONE fold's summary
  "dataSourceNote", "noLiveSessions", "goneSummary",
  // the four per-layer <h2> headings (⑥ — the rows live here, the layer table stays in observation.ts)
  "layerManager", "layerOuter", "layerInner", "layerOther",
  // the session card's two states: refused record / deferred transcript read
  "refusedStateRecord", "transcriptDeferredHint",
  // the session-state line's age annotation
  "sessionAgeSuffix",
  // the lifecycle section: heading, note, three submit buttons, five placeholders
  "lifecycleHeading", "lifecycleNote", "driverSubmit",
  "newSessionSubmit", "resumeSubmit",
  "newProfilePlaceholder", "resumeProfilePlaceholder",
  "newPermissionModePlaceholder", "resumePermissionModePlaceholder", "sessionIdPlaceholder",
  // detail page: meta description, back link, data-source note
  "detailMetaDescription", "detailBackLink", "detailDataSourceNote",
  // detail page: transcript heading (+ its "showing the most recent N" suffix), the loading marker
  "transcriptHeading", "transcriptHeadingRecentSuffix", "loadingEarlier",
  // detail page: the scroll loader's two browser-side strings (④)
  "earlierBeyondWindow", "downloadFullTranscript",
  // POST feedback (⑤): the three lifecycle endpoints' 400 reasons
  "newSessionInvalid", "resumeSessionInvalid", "earlierInvalidSessionId",
] as const;

export type SessionsKey = (typeof SESSIONS_KEYS)[number];

/** The /sessions + /session/<id> body-copy dictionary — see ROW 15 (and ROW 5~8, which it obeys). */
export const SESSIONS_LABELS: Record<SessionsKey, { en: string; zh: string }> = {
  // ① the <title>'s subtitle (after ROW 3's page NAME + the em dash)
  pageSubtitle: { en: "session observation", zh: "会话观测" },
  // ① the <h1>'s subtitle — a DIFFERENT string from the row above, deliberately
  h1Subtitle: { en: "session observation (running + finished)", zh: "会话观测（运行中 + 已结束）" },

  metaDescription: {
    en: "Quay sessions — running + finished sessions",
    zh: "Quay sessions — 运行中 + 已结束会话",
  },

  // ③ `{agents}` / `{flag}` are the caller's `<code>`-wrapped command names — DATA, untranslated.
  dataSourceNote: {
    en: "Data source: {agents} (running · interactive + {flag}) + transcript directory scan (finished) + session transcript tail",
    zh: "数据源：{agents}（运行中 · 交互式 + {flag}）+ transcript 目录扫描（已结束）+ 会话 transcript 尾部",
  },
  noLiveSessions: { en: "No running sessions", zh: "无运行中会话" },
  // `{n}` is the GONE count — a number, interpolated raw.
  goneSummary: { en: "Finished sessions (GONE · {n})", zh: "已结束会话（GONE · {n}）" },
  // ⑥ the four layer `<h2>`s. ⚠️ The first three are identical in both columns ON PURPOSE: they
  // ARE the same word in both languages, and a dictionary is not improved by hiding that. The
  // FOURTH is why the roster exists — `Other` is the layer KEY (data-ish, ASCII) while its heading
  // carries a word.
  layerManager: { en: "Manager", zh: "Manager" },
  layerOuter: { en: "Outer", zh: "Outer" },
  layerInner: { en: "Inner", zh: "Inner" },
  layerOther: { en: "Other / uncategorised", zh: "Other / 未分类" },

  // ③ `{detail}` is the shared session-schema's own refusal text, PRE-ESCAPED by the caller.
  refusedStateRecord: {
    en: "State record unusable (rejected by the shared schema): {detail}",
    zh: "状态记录不可用（共享 schema 拒收）：{detail}",
  },
  transcriptDeferredHint: {
    en: "transcript is read on demand on the detail page — click to view",
    zh: "transcript 在详情页按需读取 — 点击查看",
  },

  // The session-state line's age annotation. ⚠️ Full-width parens in zh, ASCII in en — the ONLY
  // difference, which is why it is a row and not a call-site literal: the parens are typography
  // belonging to the language, not to the number they wrap.
  sessionAgeSuffix: { en: " (age {n}s)", zh: "（age {n}s）" },

  lifecycleHeading: { en: "Session lifecycle (headless)", zh: "会话生命周期（headless）" },
  // ③ `{driver}` / `{new}` / `{resume}` are `<code>`-wrapped commands (DATA); the ⛔ and the
  // sentence around them are copy.
  lifecycleNote: {
    en: "The driver reuses {driver}; new = {new}; restart = {resume}. ⛔ Interactive manager/outer/inner are not exposed here. Submissions return JSON.",
    zh: "driver 复用 {driver}；新建 = {new}；重启 = {resume}。⛔ 交互式 manager/outer/inner 不在此暴露。提交结果为 JSON。",
  },
  driverSubmit: { en: "Driver action", zh: "driver 操作" },
  newSessionSubmit: { en: "New session", zh: "新建会话" },
  resumeSubmit: { en: "Restart session (--resume)", zh: "重启会话（--resume）" },

  // Form placeholders. ⚠️ FOUR rows for what looks like two fields: the new-session form and the
  // resume form render DIFFERENT strings for the same input (`profile（role 名，必填）` vs
  // `profile（role 名）`; `权限模式（必填，无默认）` vs `权限模式（必填）`). ⛔ Collapsing either
  // pair into one row would have silently re-worded the resume form — ROW 5's `readFailed`
  // "one row, two call sites" licence applies ONLY when the rendered bytes are identical, and here
  // they are not (verified against `git show HEAD` at that rev — paths then `packages/quay/src/` +
  // `serve-sessions.ts` — not by
  // eye: the two differ by the trailing `，无默认` / `，必填` clause).
  newProfilePlaceholder: { en: "profile (role name, required)", zh: "profile（role 名，必填）" },
  resumeProfilePlaceholder: { en: "profile (role name)", zh: "profile（role 名）" },
  newPermissionModePlaceholder: { en: "permission mode (required, no default)", zh: "权限模式（必填，无默认）" },
  resumePermissionModePlaceholder: { en: "permission mode (required)", zh: "权限模式（必填）" },
  sessionIdPlaceholder: { en: "session-id (UUID)", zh: "session-id（UUID）" },

  detailMetaDescription: { en: "Quay session — single session view", zh: "Quay session — 单一会话视图" },
  // The `Sessions` on the end is the destination page's NAME (ROW 1/ROW 3's word), not a row here.
  detailBackLink: { en: "← Back to Sessions", zh: "← 返回 Sessions" },
  // ③ `{path}` is the caller's `<code>`-wrapped transcript path (escaped entities included).
  detailDataSourceNote: {
    en: "Data source: {path} (transcript tail, not real-time)",
    zh: "数据源：{path}（transcript 尾部，非实时）",
  },

  // ③ `{n}` = turn count; `{suffix}` is this table's own `transcriptHeadingRecentSuffix` (empty
  // when every turn fits). ⛔ Keeping the closing bracket INSIDE the row is deliberate: the
  // parenthetical is part of the sentence, not a call-site decoration.
  transcriptHeading: {
    en: "Transcript ({n} messages · old→new{suffix})",
    zh: "Transcript（{n} 条消息 · 旧→新{suffix}）",
  },
  transcriptHeadingRecentSuffix: { en: ", showing the most recent {k}", zh: "，默认显示最近 {k} 条" },
  loadingEarlier: { en: "Loading earlier messages…", zh: "加载更早消息…" },

  // ④ the two browser-side strings. ⚠️ `earlierBeyondWindow`'s TRAILING SPACE is part of the row:
  // the browser concatenates the `<a>` immediately after it.
  earlierBeyondWindow: { en: "the earlier transcript is beyond the read window — ", zh: "更早的 transcript 超出读取窗口 — " },
  downloadFullTranscript: { en: "download the full transcript", zh: "下载完整 transcript" },

  // ⑤ the POST feedback (see ROW 15 ⑤)
  newSessionInvalid: {
    en: "profile and permissionMode are both required (⛔ permission mode has no default)",
    zh: "profile 与 permissionMode 均必填（⛔ 权限模式无默认值）",
  },
  resumeSessionInvalid: {
    en: "sessionId must be a valid UUID, and profile and permissionMode are both required",
    zh: "sessionId 须为合法 UUID，且 profile 与 permissionMode 均必填",
  },
  earlierInvalidSessionId: { en: "invalid sessionId (must be a UUID)", zh: "sessionId 非法（须为 UUID）" },
};

/** The whole ROW 15 roster resolved for one language — take it ONCE per render (ROW 5's
 *  `navLabelsFor` idiom), rather than re-reading `SESSIONS_LABELS` at each call site. */
export function sessionsLabelsFor(lang: Lang = DEFAULT_LANG): Record<SessionsKey, string> {
  const out = {} as Record<SessionsKey, string>;
  for (const key of SESSIONS_KEYS) out[key] = SESSIONS_LABELS[key][lang];
  return out;
}

/** One ROW 15 label by key. Unknown key ⇒ THROW (ROW 8's rule, same reason as `navLabel`). */
export function sessionLabel(
  key: SessionsKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(SESSIONS_LABELS, key) ? SESSIONS_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown sessions key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}

/** The LAYER → ROW map behind `sessionLayerHeading`. All FOUR of `SESSION_LAYERS`' headings are
 *  RENDERED strings (the page emits each as an `<h2>`), so all four get a row — three of them with
 *  identical columns because `Manager`/`Outer`/`Inner` really are the same word in both languages.
 *  ⛔ Not collapsing those three into "return the layer name" is deliberate: the roster stays
 *  CLOSED (ROW 8), so a later re-wording of, say, the Inner heading is a one-line change HERE
 *  instead of a code change at a render site. */
const SESSION_LAYER_ROWS: Record<string, SessionsKey> = {
  Manager: "layerManager",
  Outer: "layerOuter",
  Inner: "layerInner",
  Other: "layerOther",
};

/** The `<h2>` for one session layer on the /sessions page. `heading` is the shared layer table's
 *  own value, returned unchanged for a layer this dictionary does not know — an unmapped layer
 *  renders its caller's string rather than a blank (硬规则 6: 缺值 = 未查, never a fabricated
 *  label). */
export function sessionLayerHeading(
  layer: string,
  heading: string,
  lang: Lang = DEFAULT_LANG,
): string {
  const key = Object.prototype.hasOwnProperty.call(SESSION_LAYER_ROWS, layer) ? SESSION_LAYER_ROWS[layer] : undefined;
  return key === undefined ? heading : SESSIONS_LABELS[key][lang];
}
