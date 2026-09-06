// cli/goal.ts — `quay goal` command handler (goal + AC records, provider-backed —
// SPEC-goal-mechanism-2026-09-06.md §5.2). Reads/writes goals through the Provider
// ABI (`client.goalList` / `client.goalGet` / `client.goalWrite`), never the store
// directly — the store lives in quay-native; Core keeps only the view-model + shim.
// Mirrors cli/adr.ts's `withProvider` shape (the same per-invocation context + flags).

import { withProvider, printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";

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
      else for (const g of goals) console.log(`${g.id}\t${g.status}\t${g.kind}\t${g.title}`);
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
        console.log(`${g.id}: ${g.title} [${g.status}]${g.kind ? ` (${g.kind})` : ""}${g.goal ? ` → ${g.goal}` : ""}`);
        if (g.criterion) console.log(`criterion: ${g.criterion}`);
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
