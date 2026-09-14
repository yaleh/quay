// cli/goal.ts — `quay goal` command handler (goal + AC records, provider-backed —
// SPEC-goal-mechanism-2026-09-06.md §5.2). Reads/writes goals through the Provider
// ABI (`client.goalList` / `client.goalGet` / `client.goalWrite`), never the store
// directly — the store lives in quay-native; Core keeps only the view-model + shim.
// Mirrors cli/adr.ts's `withProvider` shape (the same per-invocation context + flags).

import { withProvider, printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";
import type { GoalRecord } from "../abi.ts";

/**
 * AC2 — the staleness marker for a GOAL row's TEXT rendering
 * (gap-goal-status-stale-achieved-after-new-active-criterion-filed).
 *
 * THE DEFECT IT RENDERS: a GOAL whose `status` is `achieved` while a new undischarged criterion has
 * since been filed under it used to print EXACTLY the same `achieved` token as a genuinely closed
 * GOAL. A reader had no field that told the two apart. So the marker is appended to the status
 * token itself — ⛔ not as an optional extra column a reader can skip past.
 *
 * THREE-STATE, ⛔ never a boolean (hard rule 3b):
 *   clean         → ""                        (byte-identical to the pre-change output)
 *   stale         → "(⚠️stale:n=<N>)"         (N ENUMERATED — "how many", not just "something")
 *   not-evaluated → "(⚠️stale:NOT-EVALUATED)"  (an INSTRUMENT failure — deliberately a different
 *                                              string from both, so "could not read the carrier"
 *                                              can never be mistaken for "read it, nothing there")
 *
 * Applies to `status: achieved` GOAL rows ONLY: the field answers 「is this GOAL's `achieved` still
 * earned」, a question with no subject on a GOAL that is not claiming to be closed.
 */
export function goalStalenessMark(g: GoalRecord): string {
  const s = g.staleness;
  if (!s || g.status !== "achieved") return "";
  if (s.state === "stale") return `(⚠️stale:n=${s.signals?.length ?? 0})`;
  if (s.state === "not-evaluated") return "(⚠️stale:NOT-EVALUATED)";
  return "";
}

export async function handleGoal({ sub, positional, flags, wantsJson }: CliCtx) {
  if (sub === "list") {
    await withProvider(async (client) => {
      const filter: Record<string, unknown> = {};
      if (flags.status !== undefined) filter.status = flags.status;
      if (flags.kind !== undefined) filter.kind = flags.kind;
      if (flags.goal !== undefined) filter.goal = flags.goal;
      const goals = await client.goalList(filter);
      if (wantsJson) printJson(goals);
      else if (goals.length === 0) console.log("(no goals)");
      else for (const g of goals) console.log(`${g.id}\t${g.status}${goalStalenessMark(g)}\t${g.kind}\t${g.title}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "show" || sub === "view" || sub === "get") {
    const id = positional[0];
    if (!id) { console.error(`quay goal ${sub}: missing required <id> (GOAL-NNN or AC-NNN)`); process.exitCode = 1; return; }
    await withProvider(async (client) => {
      const g = await client.goalGet(id);
      if (!g) { console.error(`no such goal: ${id}`); process.exitCode = 1; return; }
      if (wantsJson) printJson(g);
      else {
        console.log(`${g.id}: ${g.title} [${g.status}${goalStalenessMark(g)}]${g.kind ? ` (${g.kind})` : ""}${g.goal ? ` → ${g.goal}` : ""}`);
        if (g.criterion) console.log(`criterion: ${g.criterion}`);
        if (g.status === "achieved" && g.staleness && g.staleness.state !== "clean") {
          // Same three-state distinction as the marker, spelled out: the reader needs to know WHICH
          // criterion introduced the divergence and HOW to record the human decision (AC3's path).
          if (g.staleness.state === "stale") {
            console.log(
              `staleness: ⚠️ ${g.staleness.signals.length} criterion/criteria were filed under this GOAL after it read achieved — its status field may be outdated. Triggering: ${g.staleness.signals
                .map((s) => `${s.triggeringAcId} (${s.staleSince})`)
                .join(", ")}. Reopening is a HUMAN decision: quay goal write ${g.id} --status active --reason "…"`,
            );
          } else {
            console.log(
              `staleness: ⚠️ NOT-EVALUATED — the signal carrier could not be read (${g.staleness.reason}); whether this GOAL's achieved is still earned is UNKNOWN, ⛔ not "no divergence".`,
            );
          }
        }
        if (g.body) console.log(g.body);
      }
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "write" || sub === "new") {
    const id = positional[0];
    if (!id) { console.error("quay goal write: missing required <id> (GOAL-NNN or AC-NNN)"); process.exitCode = 1; return; }
    await withProvider(async (client) => {
      const patch: Record<string, unknown> = { id };
      if (flags.title !== undefined) patch.title = flags.title;
      if (flags.status !== undefined) patch.status = flags.status;
      if (flags.goal !== undefined) patch.goal = flags.goal;
      if (flags.criterion !== undefined) patch.criterion = flags.criterion;
      if (flags.expect !== undefined) patch.expect = flags.expect;
      if (flags.origin !== undefined) patch.origin = flags.origin;
      if (flags.body !== undefined) patch.body = flags.body;
      if (flags["superseded-by"] !== undefined) patch.superseded_by = String(flags["superseded-by"]).split(",").filter(Boolean);
      const g = await client.goalWrite(patch);
      if (wantsJson) printJson(g); else console.log(`wrote ${id}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  console.error(`unknown goal subcommand: ${sub} (try: list, show, write)`);
  process.exitCode = 1;
  return;
}
