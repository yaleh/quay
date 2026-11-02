// observation/needs-human-ledger.ts — the NEEDS-HUMAN EXPLICIT-TAKEOVER ledger seam (split out of
// observation.ts, task gap-routine-architecture-analysis-fan-hub-quay-src).
//
// Responsibility: read the promotion-driver's outcome ledger (`.quay/promotion-outcome.jsonl`,
// AC134) and surface the records whose action is "needs-human" — the historical "was ever
// escalated to a human" truth, INCLUDING tasks whose store status has since moved on. The
// /needs-human page reads this carrier so a needs-human event stays visible to a human even after
// the task store moves on.
//
// ⛔ It only READS one small runtime carrier, never throws (a workspace that never ran the
// promotion-driver has no ledger — a real "none", not a read failure), and never touches git or
// the task store. The banner below documents the same degradation contract as observation.ts.
import fs from "node:fs";
import path from "node:path";

// ── needs-human 显式承接（gap-ac146-human-interface-explicit-owner） ──────────────────────────
// The promotion-driver's outcome ledger (AC134) carries `action: "needs-human"` records — the
// historical "was ever escalated to a human" ledger, INCLUDING tasks whose store status has since
// moved on (the 3 real needs-human samples were later re-dispatched to done/superseded, so their
// status alone no longer surfaces them). The /needs-human page reads this carrier so a needs-human
// event stays visible to a human even after the task store moves on — the store status
// (`status: needs-human`) is the "currently awaiting" truth; this ledger is the "was ever
// awaiting" truth. Both are independent reads of workspace runtime state, so both are quarantined
// here beside the worker-outcome/round carriers (same convention, same degradation contract).

/** The promotion-driver's outcome ledger, repo-relative (AC134, gap-ac134-promotion-outcome-ledger). */
export const PROMOTION_OUTCOME_REL = ".quay/promotion-outcome.jsonl";

/** One promotion-outcome record (AC134 shape). Fields are best-effort runtime-log reads — a
 *  missing/unknown field degrades to null, never a fabricated value (hard rule ③b). */
export interface PromotionOutcomeRecord {
  task_id: string | null;
  action: string | null;
  detail: string | null;
  ts: string | null;
}

/** Parse `.quay/promotion-outcome.jsonl` (one JSON object per line) into records. Pure — never
 *  throws; a malformed/torn-tail line is skipped (best-effort runtime log, not a store). */
export function parsePromotionOutcomeRecords(text: string): PromotionOutcomeRecord[] {
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  const out: PromotionOutcomeRecord[] = [];
  for (const line of String(text).split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(s) as Record<string, unknown>; } catch { continue; }
    const result = (j.result && typeof j.result === "object" ? j.result : {}) as Record<string, unknown>;
    out.push({
      task_id: str(j.task_id),
      action: str(j.action),
      detail: str(result.detail),
      ts: str(j.ts),
    });
  }
  return out;
}

/** Read the needs-human ledger: promotion-outcome records with action === "needs-human", newest
 *  first. Absent/unreadable ⇒ [] (degrade, never throw — a workspace that never ran the
 *  promotion-driver has no ledger, which is a real "none", not a read failure). */
export function readNeedsHumanLedger(root: string): PromotionOutcomeRecord[] {
  try {
    const abs = path.join(root, PROMOTION_OUTCOME_REL);
    if (!fs.existsSync(abs)) return [];
    return parsePromotionOutcomeRecords(fs.readFileSync(abs, "utf8"))
      .filter((r) => r.action === "needs-human")
      .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
  } catch {
    return [];
  }
}
