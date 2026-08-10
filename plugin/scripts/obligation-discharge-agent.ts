/**
 * obligation-discharge-agent.ts — 义务台账「已处置」语义判定的 schema 契约
 * (gap-obligation-ledger-mechanization)
 *
 * Per ADR-033, "这条义务算不算已处置" is a SEMANTIC judgment — the value cannot be produced by a
 * regex/heuristic. It must flow through a schema'd `agent()` (the same family as no-action-check's
 * agent₁/₂/₃). This module is the CONTRACT that agent must satisfy:
 *
 *   - `DISCHARGE_VERDICT_SCHEMA` — the machine-readable shape the semantic judgment must produce.
 *   - `validateDischargeVerdict(v)` — the fail-closed validator. `obligation-ledger.ts` accepts a
 *     discharge/defer ONLY if the verdict passes this validator. A verdict that fails is REJECTED,
 *     never silently accepted.
 *
 * Two hard properties encoded here (from the task body, human-ruled 2026-08-09):
 *   1. 未处置或未显式 defer（带理由+解阻塞条件）⇒ 不能判已处置 —— a `discharged:false` verdict
 *      WITHOUT both `defer_reason` AND `unblock_condition` is a SILENT SKIP renamed as a verdict;
 *      the validator rejects it (missing keys ⇒ not-a-verdict, 缺值 = 未查).
 *   2. defer 的阻塞源必须不是自己 —— the blocker must be an external source, not the layer itself.
 *      This is a DOCUMENTED discipline (semantic — not mechanically keyword-checked, because
 *      按位置判定不按关键词); the validator only requires the fields be non-empty, and the schema
 *      notes the rule so the agent() must judge it.
 */

export const DISCHARGE_VERDICT_SCHEMA = {
  id: "string (required) — the obligation id; must exist in the ledger",
  discharged: "boolean (required) — true = handled this round; false = still open",
  discharged_by: "string — which layer/actor handled it (required iff discharged:true)",
  discharge_reason: "string — semantic justification for why it counts as handled (required iff discharged:true)",
  defer_reason: "string — the blocking source (required iff discharged:false; must NOT be the layer itself)",
  unblock_condition: "string — the condition that would unblock the defer (required iff discharged:false)",
} as const;

export interface DischargeVerdict {
  id: string;
  discharged: boolean;
  discharged_by?: string;
  discharge_reason?: string;
  defer_reason?: string;
  unblock_condition?: string;
}

export type VerdictValidation = { ok: true; verdict: DischargeVerdict } | { ok: false; errors: string[] };

/** Fail-closed validator for a discharge/defer verdict. `errors` names every missing/malformed key. */
export function validateDischargeVerdict(v: unknown): VerdictValidation {
  const errors: string[] = [];
  if (typeof v !== "object" || v === null) return { ok: false, errors: ["verdict must be an object"] };
  const verdict = v as DischargeVerdict;

  if (typeof verdict.id !== "string" || verdict.id.trim() === "") {
    errors.push("id: non-empty string (required)");
  }
  if (typeof verdict.discharged !== "boolean") {
    errors.push("discharged: boolean (required)");
  }

  if (verdict.discharged === true) {
    // A discharge must name WHO handled it and WHY it counts as handled.
    if (typeof verdict.discharged_by !== "string" || verdict.discharged_by.trim() === "") {
      errors.push("discharged_by: non-empty string (required when discharged:true)");
    }
    if (typeof verdict.discharge_reason !== "string" || verdict.discharge_reason.trim() === "") {
      errors.push("discharge_reason: non-empty string (required when discharged:true)");
    }
    // A discharge that ALSO carries defer fields is malformed — pick one state.
    if (verdict.defer_reason !== undefined || verdict.unblock_condition !== undefined) {
      errors.push("discharged:true must not carry defer_reason/unblock_condition (pick discharge OR defer)");
    }
  } else if (verdict.discharged === false) {
    // A non-discharge MUST be an explicit defer — reason + unblock condition. Otherwise it is a
    // silent skip dressed as a verdict (the exact cherry-pick the ledger exists to close).
    if (typeof verdict.defer_reason !== "string" || verdict.defer_reason.trim() === "") {
      errors.push("defer_reason: non-empty string (required when discharged:false — else the round stays open)");
    }
    if (typeof verdict.unblock_condition !== "string" || verdict.unblock_condition.trim() === "") {
      errors.push("unblock_condition: non-empty string (required when discharged:false — else the defer is unverifiable)");
    }
    if (verdict.discharged_by !== undefined || verdict.discharge_reason !== undefined) {
      errors.push("discharged:false must not carry discharged_by/discharge_reason (pick discharge OR defer)");
    }
  }
  // Note (semantic, documented not keyword-checked): a defer's blocking source must not be the
  // layer itself — "阻塞源必须不是自己，否则就是把静默跳过改名". The agent() judging the verdict
  // is responsible for that judgment.

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, verdict };
}

/** Stable, derived obligation id for a generator key — same key ⇒ same id, every round, everywhere. */
export function deriveObligationId(key: string): string {
  const slug = String(key)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `OB-${slug}` : "OB-UNKNOWN";
}
