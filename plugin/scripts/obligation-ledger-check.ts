#!/usr/bin/env node
/**
 * obligation-ledger-check.ts — 义务台账完整性的顶层机械审计（gap-obligation-ledger-mechanization）
 *
 * The top-level audit the known weakness demands ("台账由本层写、上层审；顶层审计 = 人 + 接进套件静态
 * 检查的机械核对"). Runs as a static checker (wired into scripts/test.sh's run_static_checks) and
 * mechanically verifies the ledger's integrity invariants on the checked ledger:
 *
 *   1. obligation_set_derived = 1  — every round record's obligation `id` MUST equal the deterministic
 *      derivation deriveObligationId(key). A hand-written / drifted id (same condition, different id)
 *      is the "作者写义务集" shape the derivation exists to prevent.
 *   2. band oldest_undischarged_age_visible  — age (ticks_true) must be MONOTONIC across consecutive
 *      live rounds: never decreases while live, and increments by exactly 1 per live round (a jump or
 *      a drop is a corrupted age; a reset is allowed only across a not-live round).
 *   3. round_cannot_close_with_undischarged = 1  — each round record's `canClose` must EQUAL the value
 *      recomputed from its obligations (live-or-unchecked ∧ undischarged ∧ undeferred ⇒ canClose=false).
 *      A round recorded canClose:true while an obligation is still live+undischarged is the "强行闭轮"
 *      shape — a silent acceptance the gate exists to refuse.
 *
 * Fail-open on absence: an absent ledger is a not-yet-adopted mechanism (a fresh workspace) ⇒ exit 0.
 * Fail-closed on a present ledger: any invariant violation exits 1 (set -euo pipefail red-lights it).
 *
 * usage: node obligation-ledger-check.ts --root <repo> [--ledger <file>]
 */

import fs from "node:fs";
import path from "node:path";
import { deriveObligationId } from "./obligation-discharge-agent.ts";
import { helpExit, emitPass, emitFail, readJsonLines } from "./gate-script-base.ts";

interface Obligation {
  id: string;
  key: string;
  live: boolean | null;
  ticks_true: number;
  discharged_at: number | null;
  defer_reason: string | null;
  unblock_condition: string | null;
}

interface RoundRecord {
  _kind: "round";
  round: number;
  obligations: Obligation[];
  canClose: boolean;
}

/** Recompute the round-close verdict from a round's obligations (same rule as the engine). */
function recomputeCanClose(obligations: Obligation[]): boolean {
  return !obligations.some(
    (o) => (o.live === true || o.live === null) && o.discharged_at === null && !(o.defer_reason && o.unblock_condition),
  );
}

export interface LedgerCheckResult {
  ok: boolean;
  violations: string[];
  roundCount: number;
  notes: string[];
}

export function checkLedger(file: string): LedgerCheckResult {
  const rows = readJsonLines(file);
  const rounds = rows.filter((r) => r._kind === "round") as unknown as RoundRecord[];
  rounds.sort((a, b) => a.round - b.round);
  const violations: string[] = [];
  const notes: string[] = [];
  if (rounds.length === 0) {
    notes.push("no round records — ledger not yet adopted (fail-open)");
    return { ok: true, violations, roundCount: 0, notes };
  }

  for (const rec of rounds) {
    // 1. derived-id invariant
    for (const ob of rec.obligations) {
      const expected = deriveObligationId(ob.key);
      if (ob.id !== expected) {
        violations.push(
          `round ${rec.round}: obligation id "${ob.id}" != derived "${expected}" (key "${ob.key}") — obligation_set_derived=1 violated`,
        );
      }
    }
    // 3. round-close invariant (recompute; recorded must match)
    const recomputed = recomputeCanClose(rec.obligations);
    if (recomputed !== rec.canClose) {
      violations.push(
        `round ${rec.round}: recorded canClose=${rec.canClose} but recomputed=${recomputed} — round_cannot_close_with_undischarged=1 violated`,
      );
    }
  }

  // 2. monotonic-age band across consecutive live rounds
  const byId = new Map<string, { round: number; ticks: number; live: boolean }[]>();
  for (const rec of rounds) {
    for (const ob of rec.obligations) {
      if (!byId.has(ob.id)) byId.set(ob.id, []);
      byId.get(ob.id)!.push({ round: rec.round, ticks: ob.ticks_true, live: ob.live === true });
    }
  }
  for (const [id, seq] of byId) {
    seq.sort((a, b) => a.round - b.round);
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1];
      const cur = seq[i];
      if (prev.live && cur.live) {
        // consecutive live rounds: age must be exactly prev+1 (never decrease, never jump)
        if (cur.ticks !== prev.ticks + 1) {
          violations.push(
            `obligation ${id}: age went ${prev.ticks} (round ${prev.round}) → ${cur.ticks} (round ${cur.round}) while live — band violated (must be +1 per live round)`,
          );
        }
      }
    }
  }

  return { ok: violations.length === 0, violations, roundCount: rounds.length, notes };
}

function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: node obligation-ledger-check.ts [--root <dir>] [--ledger <file>]");
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 && argv[rootIdx + 1] ? argv[rootIdx + 1] : process.cwd();
  const ledgerIdx = argv.indexOf("--ledger");
  const ledger = ledgerIdx >= 0 && argv[ledgerIdx + 1] ? argv[ledgerIdx + 1] : path.join(root, ".quay", "obligation-ledger.jsonl");

  if (!fs.existsSync(ledger)) {
    process.stdout.write(`obligation-ledger-check: no ledger at ${ledger} — mechanism not yet adopted (fail-open, exit 0)\n`);
    return 0;
  }
  const result = checkLedger(ledger);
  for (const n of result.notes) process.stdout.write(`obligation-ledger-check: note — ${n}\n`);
  if (!result.ok) {
    for (const v of result.violations) process.stderr.write(`  ${v}\n`);
    return emitFail(`obligation-ledger-check: ${result.violations.length} ledger-integrity violation(s)`, {
      violations: result.violations,
      roundCount: result.roundCount,
    });
  }
  return emitPass(`obligation-ledger-check: ${result.roundCount} round(s), 0 ledger-integrity violations`);
}

process.exit(main(process.argv.slice(2)));
