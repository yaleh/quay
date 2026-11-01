// live.ts — extracted from serve-i18n.ts by gap-routine-architecture-analysis-god-package-serve-view.
// /live BODY copy (ROW 19).
// ⛔ This file is a VERBATIM extraction — the words here are the same source of truth they
// were in serve-i18n.ts; serve-i18n.ts is now only a barrel re-exporting this module.

import { DEFAULT_LANG, type Lang } from "../serve-lang.ts";
import { fillLabel } from "./fill.ts";

// ── ROW 19: the /live BODY copy (gap-webui-live-body-copy-en-zh) ─────────────────────────────────
//
// ROW 5 opened the body-copy series for /dashboard; ROW 18 did /needs-human; this is the next page and
// it obeys ROW 2 / ROW 6 / ROW 7 / ROW 8 unchanged: the roster is CLOSED, the zh column is the
// pre-existing literal BYTE FOR BYTE, interpolated copy carries `{name}` in both columns, and both an
// unknown key and an unfilled `{name}` THROW.
//
// HOW THE ROSTER WAS FOUND — by MEASUREMENT, not by reading the source. The red baseline rendered
// /live from a REAL server in FOUR states (the task named two; the other two exist because two more
// rows render only in them): idle (telemetry present, 0 in flight), in flight (3 runs, with a real
// Touches/depends_on blocking relation AND a task with neither), the running-unwired banner, and the
// read-failure degradation. ⚠️ ONE FETCH CANNOT SEE THE OTHERS: `noBlockingRelation` and
// `blockingHeading` are mutually exclusive, `noInFlight` renders only at 0 in flight, the two banner
// rows only when telemetry is EMPTY, and `readFailed` only when the store is unreadable.
//
// ⚠️ THE SOURCE-LINE COUNT THE TASK QUOTED (24) IS NOT THE CURRENT ONE (17), and the difference is a
// MEASURED hand-off, not drift: `gap-webui-journal-body-copy-en-zh` landed between this task's filing
// and its execution and removed /journal's own seven Chinese lines from this shared file. Both readings
// are re-runnable on the two commits (`24` on eaa9799a0~1, `17` on eaa9799a0), by the same predicate.
// ⇒ The `/journal`-exclusive bucket of this task's three-way classification is now EMPTY.
//
// ⚠️ THE PHASE WORDS ARE **NOT** IN THIS TABLE — they resolve through ROW 5's `dashboardLabel`
// (`phaseImplementing` / `phaseAwaitingLand` / `phaseLanded`), because this page renders the SAME
// `InFlightPhase` enum in the same role the dashboard's liveCard does. The recorded trade-off (see the
// task body's 决定记录): ROW 11 ③ forbids cross-page sharing as a general rule — a value owned by
// another page's table makes that page's next re-wording a cross-table edit — but here the two pages
// are rendering ONE machine enum, so two independent translations of 「实现中」 are exactly the drift
// this series exists to remove ("改一处漏一处"), and the task's contract names that duplication and
// forbids a second copy. ⇒ Sharing here is CONTRACT-MANDATED, ⛔ not a licence to share elsewhere:
// the three state words below are byte-identical to ROW 5's rows and are still duplicated on purpose.
//
// ⚠️ `{task}` / `{ids}` / `{flags}` / `{value}` holes ARE MARKUP OR DATA, exactly as ROW 18's `{code}`
// is: the two blocking sentences carry `<a href="/task/…">` links mid-sentence and the next-step lines
// carry a `<code>` element, so the sentence is ONE template and the element stays at the render site
// (the dictionary stays copy-only). The hole VALUES are never request-derived prose — ids go through
// `escapeHtml` at the call site before they are interpolated, and the `{flags}` payload is a repo
// literal.
export const LIVE_KEYS = [
  // page header — the `<h1>`'s suffix (⛔ the page NAME token is ROW 3's business, and the `<title>`'s
  // token likewise: `Live — loop activity` is PAGE_LABELS'. Only the trailing suffix is body copy.)
  "titleSuffix",
  // the running summary line (② — each row carries its OWN leading ` · `, see the note below)
  "inFlightCap", "cpuPressure",
  // the two telemetry-empty banners: their state word, and their next-step line
  "liveStateRunningUnwired", "liveStateNotRunning", "nextStepUnwired", "nextStepNotRunning",
  // the read-failure degradation (a bare label — the reader's reason is DATA, see the note below)
  "readFailed",
  // the in-flight table: the five Chinese headers (the other six are already English) + the two
  // cell words that are not language-neutral
  "colStatus", "colPhase", "colAwaitingDuration", "colBlocks", "colBlockedBy",
  "elapsedMinutes", "cellNone",
  // the cross-task blocking section
  "blockingHeading", "blockingLine", "blockedByLine", "noBlockingRelation",
  // the empty state
  "noInFlight",
] as const;

export type LiveKey = (typeof LIVE_KEYS)[number];

/** The /live body-copy dictionary — see ROW 19 and ROW 2/ROW 6/ROW 7/ROW 8. */
export const LIVE_LABELS: Record<LiveKey, { en: string; zh: string }> = {
  titleSuffix: { en: "what the loop is doing right now", zh: "循环此刻在做什么" },

  // ── the running summary line ──────────────────────────────────────────────────────────────────
  // ⚠️ ② EACH ROW CARRIES ITS OWN LEADING ` · `, and it is INSIDE the value on purpose. The line is
  // `<code>live_state=running</code> · 在飞: N / 上限: M · CPU 压力 …`: the separator belongs to the
  // rendered run-on line, and keeping it in the row means the zh bytes are exactly the pre-extraction
  // ones no matter how the call site is later re-indented (the same reading as ROW 5's
  // `identityWorkspaceDisk` and ROW 12 ①'s space-leading fragments — ⛔ neither value is "trimmed for
  // tidiness", which would run the code element into the sentence).
  inFlightCap: { en: " · In flight: {inFlight} / cap: {cap}", zh: " · 在飞: {inFlight} / 上限: {cap}" },
  // ⚠️ TWO rows and not one optional-placeholder template: an empty fill would leave a trailing
  // separator the zh baseline does not have (ROW 5's `awaitingLandWithDuration` note). The row is
  // rendered ONLY when `/proc/pressure/cpu` was readable — absent ⇒ the segment is absent entirely.
  cpuPressure: { en: " · CPU pressure (some avg10): {value}", zh: " · CPU 压力 (some avg10): {value}" },

  // ── the two telemetry-empty banners ───────────────────────────────────────────────────────────
  // ⚠️ These two words used to be `LIVE_STATE_RUNNING_UNWIRED_LABEL` / `LIVE_STATE_NOT_RUNNING_LABEL`
  // in serve-render.ts — a module every page imports, holding a constant exactly ONE page rendered.
  // They are here now and those exports are DELETED (hard rule 5b: fixing one instance means sweeping
  // for its siblings — the sweep found 3 files naming them: the definition, this file's own comments,
  // and the one consumer). They are BYTE-IDENTICAL to ROW 5's `liveStateRunningUnwired` /
  // `liveStateNotRunning`, and ⛔ deliberately NOT shared with them — see the phase-words note above.
  liveStateRunningUnwired: { en: "Running, telemetry not wired", zh: "在跑但未接遥测" },
  liveStateNotRunning: { en: "Not running", zh: "未在运行" },
  // The `{flags}` hole carries `<code>--task-start</code>/<code>--task-end</code>` — a repo literal,
  // inserted as markup (ROW 19's header note). ⚠️ The zh 「。」 sits AFTER the hole, i.e. outside the
  // `<code>` element, exactly as the pre-extraction literal had it: moving it inside would render a
  // full-width stop inside the code span, a byte change invisible to every "does it contain the
  // payload" probe.
  nextStepUnwired: {
    en: "Next: check that the target project's loop calls {flags}.",
    zh: "下一步：检查目标项目的循环是否调用 {flags}。",
  },
  nextStepNotRunning: { en: "Next: check whether the session / cron is running.", zh: "下一步：检查会话/cron 是否启动。" },

  // ── the read-failure degradation ──────────────────────────────────────────────────────────────
  // ⚠️ The LABEL is copy; the reader's `reason` that follows it is DATA (observation.ts's own
  // diagnostic, rendered through `escapeHtml` in both languages — the classification /dashboard,
  // /journal, /board and /architecture all made for the same string). ⛔ Not translated, and it is
  // this page's NAMED out-of-scope residue: under `en` the line still carries Chinese, and the
  // black-box test pins that fact rather than letting it read as an oversight.
  readFailed: { en: "Read failed", zh: "读失败" },

  // ── the in-flight table ───────────────────────────────────────────────────────────────────────
  colStatus: { en: "status", zh: "状态" },
  colPhase: { en: "phase", zh: "阶段" },
  colAwaitingDuration: { en: "awaiting-land duration", zh: "待落地时长" },
  // ⚠️ `colBlocks` / `colBlockedBy` are the two headers that were HALF translated already
  // (`阻塞 (blocks)`), so their zh column keeps the pre-existing ASCII parenthetical BYTE FOR BYTE
  // (ROW 7) — the en column is the bare field name the parenthetical was glossing.
  colBlocks: { en: "blocks", zh: "阻塞 (blocks)" },
  colBlockedBy: { en: "blockedBy", zh: "被阻塞 (blockedBy)" },
  elapsedMinutes: { en: "{minutes} min", zh: "{minutes} 分钟" },
  // The table cell's word for "this task has no relation on this side". A row rather than a literal
  // so the roster stays closed (ROW 8), ⛔ NOT because it has a translation.
  cellNone: { en: "none", zh: "无" },

  // ── the cross-task blocking section ───────────────────────────────────────────────────────────
  blockingHeading: { en: "Cross-task blocking", zh: "跨任务阻塞关系" },
  // ⚠️ The sentence's two holes are HTML LINKS, so the two columns place them where their own word
  // order needs them — the reason ROW 18's `{code}` shape exists. `{task}` is the linked task id and
  // `{ids}` the comma-joined list of (already `escapeHtml`ed) ids.
  // ⚠️ The `[` … `]` AROUND the id list are INSIDE the template, not at the call site: they are part
  // of the rendered sentence, and leaving them out is a SILENT zh byte change — the AC3 differential
  // caught exactly that on the first run (`正在阻塞 [X, Y]` had become `正在阻塞 X, Y`), which no
  // "does the page contain the ids" probe can see.
  blockingLine: { en: "Task {task} is blocking [{ids}]", zh: "任务 {task} 正在阻塞 [{ids}]" },
  blockedByLine: { en: "Task {task} is blocked by [{ids}]", zh: "任务 {task} 被 [{ids}] 阻塞" },
  noBlockingRelation: { en: "No cross-task blocking relation.", zh: "无跨任务阻塞关系。" },

  // ── the empty state ───────────────────────────────────────────────────────────────────────────
  noInFlight: { en: "No in-flight tasks right now.", zh: "当前无在飞任务。" },
};

/** The whole /live roster resolved for one language — take it ONCE per render (the
 *  `dashboardLabelsFor` idiom), rather than re-reading `LIVE_LABELS` per call site. */
export function liveLabelsFor(lang: Lang = DEFAULT_LANG): Record<LiveKey, string> {
  const out = {} as Record<LiveKey, string>;
  for (const key of LIVE_KEYS) out[key] = LIVE_LABELS[key][lang];
  return out;
}

/** One /live label, interpolated. Unknown key ⇒ THROW; missing parameter ⇒ THROW (both via ROW 8's /
 *  ROW 6's rule — see `dashboardLabel`, whose body this mirrors exactly). */
export function liveLabel(
  key: LiveKey,
  lang: Lang = DEFAULT_LANG,
  params?: Record<string, string | number>,
): string {
  const entry: { en: string; zh: string } | undefined =
    Object.prototype.hasOwnProperty.call(LIVE_LABELS, key) ? LIVE_LABELS[key] : undefined;
  if (entry === undefined) {
    throw new Error(`serve-i18n: unknown live key ${JSON.stringify(key)} — the dictionary has no label for it`);
  }
  return fillLabel(entry[lang], params ?? {});
}
