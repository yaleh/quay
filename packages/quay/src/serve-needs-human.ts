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
import type { Manifest } from "./serve-render.ts";
import { html, escapeHtml, pageStyles, modernistStyles, relativeTime, renderSiteNav, renderMobileChrome } from "./serve-render.ts";
import { readNeedsHumanLedger } from "./observation.ts";
import { TASK_STATUS } from "./abi.ts";

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

/** One active needs-human task row (store truth) + its extracted reason. */
interface ActiveRow {
  id: string;
  title: string;
  labels: string[];
  reason: string | null;
}

/** One ledger record row (was-ever-escalated truth) + a display timestamp. */
interface LedgerRow {
  taskId: string;
  detail: string | null;
  ts: string | null;
}

export function renderNeedsHumanPage(active: ActiveRow[], ledger: LedgerRow[], manifest: Manifest): string {
  const activeRows = active.length === 0
    ? html`<tr><td colspan="3">当前无 needs-human 任务（升级台账见下）。</td></tr>`
    : active.map((r) => html`<tr>
        <td><a href="/task/${encodeURIComponent(r.id)}">${escapeHtml(r.id)}</a></td>
        <td>${escapeHtml(r.title)}${r.labels.length > 0 ? ` · ${escapeHtml(r.labels.join(", "))}` : ""}</td>
        <td>${r.reason != null ? escapeHtml(r.reason) : html`<span style="color:var(--color-neutral-700)">未记录</span>`}</td>
      </tr>`).join("\n");

  const ledgerRows = ledger.length === 0
    ? html`<tr><td colspan="3">无 needs-human 升级记录（<code>.quay/promotion-outcome.jsonl</code>）。</td></tr>`
    : ledger.map((r) => html`<tr>
        <td><a href="/task/${encodeURIComponent(r.taskId)}">${escapeHtml(r.taskId)}</a></td>
        <td>${r.detail != null ? escapeHtml(r.detail) : "—"}</td>
        <td>${r.ts != null ? escapeHtml(relativeTime(Date.parse(r.ts))) : "—"}</td>
      </tr>`).join("\n");

  return html`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Quay needs-human — 显式人机承接界面">${modernistStyles()}${pageStyles()}<title>Needs Human — ${escapeHtml(manifest.name)}</title></head>
    <body>${renderMobileChrome("needs-human", "needs human")}${renderSiteNav("needs-human")}<main>
      <h1>Needs Human — 待人类决定</h1>
      <p class="meta">人机接口的显式承接者：一条 <code>needs-human</code> 产生后，无需读任何 transcript，在此页即可看到。上面是「当前待办」，下面是「升级台账」（含状态已流转的历史样本）。</p>

      <h2>当前待办（<code>status: needs-human</code>）</h2>
      <table>
        <tr><th>id</th><th>title</th><th>阻碍原因</th></tr>
        ${activeRows}
      </table>

      <h2>升级台账（<code>action: needs-human</code>）</h2>
      <table>
        <tr><th>task_id</th><th>detail</th><th>ts</th></tr>
        ${ledgerRows}
      </table>
    </main></body></html>`;
}

export async function handleNeedsHuman(
  req: IncomingMessage,
  res: ServerResponse,
  client: ProviderClient,
  manifest: Manifest,
  cfg: { workspaceRoot: string },
): Promise<void> {
  // ① 当前待办 — the provider store, status-filtered (default includeBody=true so the reason can be
  //    extracted from the `## Needs-Human` body section). The needs-human pool is small, so the full
  //    body round-trip is not the cost it is on /tasks (which strips bodies).
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
  res.end(renderNeedsHumanPage(active, ledger, manifest));
}
