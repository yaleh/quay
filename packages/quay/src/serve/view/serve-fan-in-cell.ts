// serve-fan-in-cell.ts — the mechanical-fan-in cell renderer shared by /task/<id> and the
// dashboard's FAN-IN overview card.
//
// WHY THIS MODULE EXISTS (gap-routine-architecture-analysis-god-package-serve-fanout-556): the
// function used to live in `feat/serve-task.ts`, and `view/serve-dashboard.ts` imported it from
// there. That one import closed a directory cycle — `serve/view` → `serve/feat` → `serve/view` —
// which AC-916's standing guard (`packages/quay/test/directory-cycle.test.mjs`) rejects. The
// renderer is presentation-only (it takes a WorkerOutcomeRecord and returns HTML), so it belongs
// in the leaf `view` package: moving it here makes `view` import NOTHING from the other serve
// subpackages. `feat/serve-task.ts` keeps its own call site by importing the function; behaviour
// and exported name are unchanged.

import type { WorkerOutcomeRecord } from "../../observation.ts";
import { html, escapeHtml } from "./serve-render.ts";

/** Render one attempt's mechanical-fan-in cell (gap-mech-fan-in-log-webui-visible-clickable B2):
 *  landed/red + first failing step + lock hold + suite outcome + landed sha, plus a view/download
 *  link when the record carries a fanInLog file name. A null record renders an honest "—" (never a
 *  fabricated "landed").
 *
 *  gap-dashboard-fanin-card-hide-reason: `mfi.reason` is unbounded free text (measured up to 1084
 *  chars) — right on /task/<id>'s Runs table (one cell per attempt), but it balloons the dashboard's
 *  five-row FAN-IN overview card. The `showReason` option (default true → /task/<id> unchanged) lets
 *  the dashboard skip that one span entirely, rather than truncate.
 *
 *  gap-dashboard-fanin-cell-inline-layout-and-id-truncation: `layout` switches field *layout* (not
 *  field selection — `showReason` already does that). `"inline"` joins the parts with " · " on one
 *  line for the dashboard's compact five-row card; the default `"stacked"` keeps the `<br>`-separated
 *  vertical stack for /task/<id>'s Runs table (its call site is unchanged). */
export function renderFanInCell(
  taskId: string,
  r: WorkerOutcomeRecord,
  opts: { showReason?: boolean; layout?: "stacked" | "inline" } = {},
): string {
  const mfi = r.mechanical_fan_in;
  if (mfi == null) return "—";
  const showReason = opts.showReason ?? true;
  const layout = opts.layout ?? "stacked";
  const parts: string[] = [];
  // gap-dashboard-status-tag-badges: landed/red/unknown were bare <strong> text with no background,
  // so the outcome blended into the row copy. Reuse the .tag soft-badge set (landed → tag-positive,
  // red → tag-accent, unknown → tag-neutral); the failing step tag shares tag-neutral so both read
  // as one badge family. Reason/lock/suite/sha stay plain text.
  if (mfi.outcome === "landed") parts.push(html`<span class="tag tag-positive">landed</span>`);
  else if (mfi.outcome === "red") parts.push(html`<span class="tag tag-accent">red</span>`);
  else parts.push(html`<span class="tag tag-neutral">${escapeHtml(mfi.outcome ?? "?")}</span>`);
  if (mfi.outcome === "red" && mfi.step) parts.push(html`<span class="tag tag-neutral">step ${escapeHtml(mfi.step)}</span>`);
  if (showReason && mfi.reason != null) parts.push(html`<span style="font-size:0.75rem;color:var(--color-neutral-700)">${escapeHtml(mfi.reason)}</span>`);
  // gap-dashboard-fanin-monospace-ids: sha/lock are git hash / duration data — same monospace stack as
  // the 「最近提交」 card (serve-dashboard.ts) and the system resources card (serve-system.ts), so they
  // align vertically and read as data instead of prose. Zero extra font files (system stack).
  if (mfi.lockHoldSecs != null) parts.push(html`<span style="font-family:ui-monospace,monospace">lock ${mfi.lockHoldSecs}s</span>`);
  if (mfi.suiteOutcome != null) parts.push(`suite ${escapeHtml(mfi.suiteOutcome)}`);
  if (mfi.landedSha != null) parts.push(html`<span style="font-family:ui-monospace,monospace">sha <code>${escapeHtml(mfi.landedSha.slice(0, 7))}</code></span>`);
  if (mfi.fanInLog != null && mfi.fanInLog.length > 0) {
    parts.push(html`<a href="/fan-in-log/${encodeURIComponent(taskId)}/${encodeURIComponent(mfi.fanInLog)}">view</a> · <a href="/fan-in-log/${encodeURIComponent(taskId)}/${encodeURIComponent(mfi.fanInLog)}/download">download</a>`);
  }
  return parts.join(layout === "inline" ? " · " : "<br>");
}
