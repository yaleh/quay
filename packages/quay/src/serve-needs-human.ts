// serve-needs-human.ts — /needs-human route handler (gap-ac146-human-interface-explicit-owner).
//
// The gap: after outer was retired, the only channel to a human was `status: needs-human` + the
// prose `orchestration/escalations.md`, and the driver cannot AskUserQuestion. A needs-human task
// was invisible until the manager happened to scan the ledger — no interface a human could consult
// WITHOUT reading a transcript. This page is that explicit owner: one place that joins the two
// carriers —
//
//   ① 当前待办 (currently awaiting) — tasks whose store status is `status: needs-human` (the SAME
//     store the promotion-driver writes via markNeedsHuman, read through the provider ABI). Each
//     row carries the `## Needs-Human` 阻碍原因 the driver wrote into the body.
//   ② 升级台账 (was-ever-escalated) — `.quay/promotion-outcome.jsonl` records with
//     `action: "needs-human"` (read via observation.readNeedsHumanLedger). This is the ledger that
//     still shows a sample whose status has since moved on (done/superseded), so a needs-human event
//     is never lost to a later re-dispatch.
//   ③ 最近失败原文 (latest failure, RAW) — gap-needs-human-raw-fan-in-reason-observation-surface
//     (人 2026-09-20 逐字: 「driver 当然应当记录相应的日志，人类观测面（如 quay cli/mcp/web）也应提供
//     这些日志的访问。」). The driver writes one record per dispatch attempt into
//     `.quay/worker-outcome.jsonl`; this page now shows, per active task, WHICH STEP the latest
//     attempt died on and its failure text — verbatim, escaped, and ⛔ never classified (the same
//     ruling that created this page: a needs-human cause is an exception, and an enum of causes is
//     unreliable, so the surface shows the原文 and nothing else). Read ONCE for the page through
//     observation.readFanInAttempts — the ONE reader the /task/<id> Runs block, `quay driver log`
//     and the MCP `driver_log` tool also use.
//
// AC1 (能取假, 显式承接者): a needs-human produced → visible on this page, no transcript read.
// AC2 (能取假, 负控制): the ledger section shows the existing `action:"needs-human"` samples from
//     `.quay/promotion-outcome.jsonl` (negative control: if the page dropped the ledger, those 3
//     samples — whose status is now done/superseded — would vanish).
//
// Data access is quarantined: the ledger read lives in observation.ts (the ONLY serve module allowed
// to know `.quay/`); the store read goes through the provider ABI (client.taskList) like /tasks.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderClient } from "./provider-client.ts";
import type { Manifest, ServePageCfg, ServeIdentity } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, relativeTime, renderSiteNav, renderMobileChrome, tableWrap, pageTitle, pageNameFor, htmlLangTag, DEFAULT_LANG, type Lang } from "./serve-render.ts";
import { needsHumanLabelsFor, needsHumanLabel, type NeedsHumanKey } from "./serve-i18n.ts";
import { readNeedsHumanLedger, readFanInAttempts, type FanInAttemptsResult } from "./observation.ts";
import { TASK_STATUS } from "./abi.ts";

// The `<code>` ELEMENTS this page embeds mid-sentence, as `{code}` payloads (serve-i18n.ts ROW 18).
// They sit HERE rather than in the dictionary because the dictionary carries copy, not markup; the
// two store/ledger discriminators are ASCII and identical in both languages, so one definition
// serves both columns. ⛔ They are repo literals, never request data — nothing here is escaped.
const CODE_NEEDS_HUMAN = "<code>needs-human</code>";
const CODE_STATUS_NEEDS_HUMAN = "<code>status: needs-human</code>";
const CODE_ACTION_NEEDS_HUMAN = "<code>action: needs-human</code>";
const CODE_PROMOTION_OUTCOME_LEDGER = "<code>.quay/promotion-outcome.jsonl</code>";

/** Extract the `阻碍原因：` line from a task body's `## Needs-Human` section (written by
 *  promotion-driver.markNeedsHuman). Returns null when the section/line is absent — a needs-human
 *  task set by a different path (e.g. manual `task edit --status needs-human`) legitimately has no
 *  recorded reason, and null reads as 「未记录」 rather than a fabricated reason (hard rule ③b). */
export function extractNeedsHumanReason(body: string | undefined | null): string | null {
  const src = String(body ?? "");
  const m = /^[-*]\s*阻碍原因[：:]\s*(.+)$/m.exec(src);
  if (m) return m[1].trim();
  return null;
}

/**
 * What the 「最近失败原文」 cell shows for one row. ENUMERATED, and deliberately four-valued: the
 * page must distinguish "the reader did not run for this row" from "the reader ran and this task has
 * no attempt" from "the reader ran and the log could not be read" — collapsing any two of them would
 * make 「读不出」 render exactly like 「这里没有」 (硬规则 3b).
 *
 *   not-evaluated — the caller handed the render function no reader result at all. Renders 「—」,
 *                   the same marker this page already uses for an absent ledger detail. This is the
 *                   shape every DIRECT `renderNeedsHumanPage(...)` unit call produces; the HTTP path
 *                   always supplies a real result, so no production row is ever in this state.
 *   none          — the reader ran and this task has no recorded attempt.
 *   unreadable    — the reader ran and the attempt carrier could not be read.
 *   attempt       — a recorded attempt; `step`/`reason` are the record's OWN values, verbatim.
 */
type FailureCell =
  | { kind: "not-evaluated" }
  | { kind: "none" }
  | { kind: "unreadable" }
  | { kind: "attempt"; step: string | null; reason: string | null };

/** One active needs-human task row (store truth) + its extracted reason + its latest raw failure. */
interface ActiveRow {
  id: string;
  title: string;
  labels: string[];
  reason: string | null;
  /** Omitted ⇒ `not-evaluated` (see `FailureCell`). */
  latestFailure?: FailureCell;
}

/** The `title` attribute's plain-text form of a `FailureCell` — the same words the cell shows, with
 *  the markup stripped (an attribute cannot carry the `<code>` element the cell uses for the step).
 *  Shares the cell's vocabulary so the tooltip and the cell cannot drift into two different readings
 *  of the same state (ROW 18's `reasonNotRecorded` one-row-two-call-sites rule). */
function failureTitle(cell: FailureCell, L: Record<NeedsHumanKey, string>): string {
  if (cell.kind === "attempt") {
    if (cell.step == null && cell.reason == null) return L.latestFailureNotRecorded;
    return [cell.step, cell.reason].filter((x): x is string => x != null).join(" ");
  }
  if (cell.kind === "none") return L.latestFailureNotRecorded;
  if (cell.kind === "unreadable") return L.latestFailureUnreadable;
  return "—";
}

/** Group a page-level `readFanInAttempts` result by task, keeping each task's LATEST attempt (the
 *  carrier is oldest → newest, so the last write wins). Pure — the tri-state collapse policy lives
 *  here, in ONE place, rather than being re-decided per row (硬规则 5b). */
export function latestFailureByTask(res: FanInAttemptsResult): Map<string, FailureCell> {
  const out = new Map<string, FailureCell>();
  if (res.status === "carrier-unreadable") return out; // the caller renders 「读不出」 for every row
  if (res.status === "carrier-absent") return out; // every row is honestly `none`
  for (const a of res.attempts) {
    if (a.task == null) continue;
    out.set(a.task, { kind: "attempt", step: a.step, reason: a.reason ?? a.failure_reason });
  }
  return out;
}

/** One ledger record row (was-ever-escalated truth) + a display timestamp. */
interface LedgerRow {
  taskId: string;
  detail: string | null;
  ts: string | null;
}

/** `lang` is the request's resolved language (AC-288's mechanism, threaded in by the dispatcher as
 *  `cfg.lang`).
 *
 *  AC-295 (GOAL-024) wired the CHROME: the `<html lang>` attribute, the shared desktop nav bar, the
 *  MOBILE nav, and this page's OWN `<title>`/`<h1>` tokens (`pageNameFor` against serve-i18n.ts's
 *  PAGE_LABELS) — the criterion's `title-unchanged` arm exists because a nav bar that switches while
 *  the page's own `<title>` stays English is a real half-fix.
 *
 *  gap-webui-needs-human-body-copy-en-zh wired the BODY: every remaining interface string on this
 *  page now resolves through serve-i18n.ts ROW 18 (`needsHumanLabelsFor` / `needsHumanLabel`) —
 *  the `<h1>` suffix, the `<meta name="description">`, the intro paragraph, both section headings
 *  and their `{code}` payloads, the reason column's header and its absent-value word, and both
 *  tables' empty states. ⛔ What stays un-translated by design is DATA: task ids, task titles, the
 *  阻碍原因 text the driver wrote into the body, and the ledger's `detail`/`ts` — this page renders
 *  those verbatim, in whatever language their author wrote them.
 *
 *  ⛔ The `"needs human"` literal passed to `renderMobileChrome` below is deliberately NOT routed
 *  through `pageNameFor`: it renders into `<span class="mobile-header-page">`, which sits BEFORE the
 *  first `<nav>` and is therefore neither inside the criterion's nav region nor a nav label. It keeps
 *  the raw ASCII token, matching AC-289's `/dashboard` handling (`renderMobileChrome("dashboard",
 *  "dashboard", lang)`) and AC-291's / AC-296's — ⛔ not a per-page convention to re-invent here. */
export function renderNeedsHumanPage(
  active: ActiveRow[],
  ledger: LedgerRow[],
  manifest: Manifest,
  identity: ServeIdentity | null = null,
  lang: Lang = DEFAULT_LANG,
): string {
  // The whole roster for this request's language, taken ONCE (serve-i18n.ts ROW 18 / the
  // `dashboardLabelsFor` idiom). The four `{code}`-bearing rows are filled through `needsHumanLabel`
  // so a forgotten payload THROWS rather than rendering `{code}` onto the page (ROW 6).
  const L = needsHumanLabelsFor(lang);
  const notRecorded = needsHumanLabel("reasonNotRecorded", lang);

  /** The 「最近失败原文」 cell. The ATTEMPT arm renders the record's own `step` + `reason` verbatim —
   *  `escapeHtml` on both, because the text is whatever the suite/driver wrote (a reason carrying
   *  `<script>` must land as text). ⛔ NO classification, no badge, no interpretation (人 2026-09-20:
   *  the cause is an exception, an enum of causes is unreliable). */
  const failureCell = (cell: FailureCell): string => {
    if (cell.kind === "not-evaluated") return "—";
    if (cell.kind === "none") return html`<span style="color:var(--color-neutral-700)">${L.latestFailureNotRecorded}</span>`;
    if (cell.kind === "unreadable") return html`<span style="color:var(--color-neutral-700)">${L.latestFailureUnreadable}</span>`;
    if (cell.step == null && cell.reason == null) {
      return html`<span style="color:var(--color-neutral-700)">${L.latestFailureNotRecorded}</span>`;
    }
    const step = cell.step != null ? html`<code>${escapeHtml(cell.step)}</code> ` : "";
    return html`${step}${cell.reason != null ? escapeHtml(cell.reason) : ""}`;
  };

  const activeRows = active.length === 0
    ? html`<tr><td colspan="4">${L.emptyActive}</td></tr>`
    : active.map((r) => html`<tr>
        <td><a href="/task/${encodeURIComponent(r.id)}">${escapeHtml(r.id)}</a></td>
        <td>${escapeHtml(r.title)}${r.labels.length > 0 ? ` · ${escapeHtml(r.labels.join(", "))}` : ""}</td>
        <td class="clamp" title="${r.reason != null ? escapeHtml(r.reason) : escapeHtml(notRecorded)}">${r.reason != null ? escapeHtml(r.reason) : html`<span style="color:var(--color-neutral-700)">${notRecorded}</span>`}</td>
        <td class="clamp" title="${escapeHtml(failureTitle(r.latestFailure ?? { kind: "not-evaluated" }, L))}">${failureCell(r.latestFailure ?? { kind: "not-evaluated" })}</td>
      </tr>`).join("\n");

  const ledgerRows = ledger.length === 0
    ? html`<tr><td colspan="3">${needsHumanLabel("emptyLedger", lang, { code: CODE_PROMOTION_OUTCOME_LEDGER })}</td></tr>`
    : ledger.map((r) => html`<tr>
        <td><a href="/task/${encodeURIComponent(r.taskId)}">${escapeHtml(r.taskId)}</a></td>
        <td class="clamp" title="${r.detail != null ? escapeHtml(r.detail) : "—"}">${r.detail != null ? escapeHtml(r.detail) : "—"}</td>
        <td>${r.ts != null ? escapeHtml(relativeTime(Date.parse(r.ts))) : "—"}</td>
      </tr>`).join("\n");

  return html`<!doctype html>
    ${htmlLangTag(lang)}<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(L.metaDescription)}">${modernistStyles()}${pageStyles()}<title>${pageTitle("Needs Human", identity, lang)}</title></head>
    <body>${renderMobileChrome("needs-human", "needs human", lang)}${renderSiteNav("needs-human", lang)}<main id="main">
      <h1>${pageNameFor("Needs Human", lang)} — ${L.titleSuffix}</h1>
      <p class="meta">${needsHumanLabel("intro", lang, { code: CODE_NEEDS_HUMAN })}</p>

      <h2>${needsHumanLabel("sectionActive", lang, { code: CODE_STATUS_NEEDS_HUMAN })}</h2>
      ${tableWrap(html`<table>
        <tr><th>id</th><th>title</th><th>${L.colReason}</th><th>${L.colLatestFailure}</th></tr>
        ${activeRows}
      </table>`)}

      <h2>${needsHumanLabel("sectionLedger", lang, { code: CODE_ACTION_NEEDS_HUMAN })}</h2>
      ${tableWrap(html`<table>
        <tr><th>task_id</th><th>detail</th><th>ts</th></tr>
        ${ledgerRows}
      </table>`)}
    </main></body></html>`;
}

export async function handleNeedsHuman(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  manifest: Manifest,
  cfg: ServePageCfg,
): Promise<void> {
  // ① 当前待办 — the provider store, status-filtered (default includeBody=true so the reason can be
  //    extracted from the `## Needs-Human` body section). The needs-human pool is small, so the full
  //    body round-trip is not the cost it is on /tasks (which strips bodies).
  // ③ 最近失败原文 — the driver's per-attempt log, read ONCE for the whole page through the ONE
  //    fan-in attempt reader (observation.readFanInAttempts — the same reader the /task/<id> Runs
  //    block, `quay driver log` and the MCP `driver_log` tool use; ⛔ this page does not parse the
  //    carrier itself). It answers the question the 阻碍原因 column cannot: an external project had
  //    three tasks go needs-human for the same cause and nothing on any surface said WHICH STEP each
  //    attempt died on. The result's tri-state status is preserved as far as the rows — an unreadable
  //    carrier renders 「读不出」 on every row, never an empty-looking cell (硬规则 3b).
  const attempts = readFanInAttempts(cfg.workspaceRoot, {});
  const failureByTask = latestFailureByTask(attempts);
  const pageFailure: FailureCell = attempts.status === "carrier-unreadable" ? { kind: "unreadable" } : { kind: "none" };

  let active: ActiveRow[] = [];
  try {
    const r = await client.taskList({ status: TASK_STATUS.NEEDS_HUMAN });
    active = (r.tasks ?? [])
      .filter((t): t is typeof t & { id: string } => typeof t.id === "string" && t.id.length > 0)
      .map((t) => ({
        id: t.id,
        title: typeof t.title === "string" ? t.title : "",
        labels: Array.isArray(t.labels) ? (t.labels as unknown[]).filter((l): l is string => typeof l === "string") : [],
        reason: extractNeedsHumanReason(t.body),
        latestFailure: failureByTask.get(t.id) ?? pageFailure,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    // store read failed → the page still renders (ledger below + an empty active table), never a 500.
    active = [];
  }

  // ② 升级台账 — the promotion-outcome ledger (observation.readNeedsHumanLedger). Absent/unreadable
  //    ⇒ [] (a real "none", never a fabricated read — the page degrades, does not throw).
  const ledger: LedgerRow[] = readNeedsHumanLedger(cfg.workspaceRoot)
    .filter((r) => r.task_id != null)
    .map((r) => ({ taskId: r.task_id as string, detail: r.detail, ts: r.ts }));

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderNeedsHumanPage(active, ledger, manifest, cfg.identity, cfg.lang));
}
