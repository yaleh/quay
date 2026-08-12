// cli/adr.ts — `quay adr` command handler (decision-record lifecycle verbs).
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change (golden-replay
// equivalence verified in packages/quay/test/cli.test.mjs).

import fs from "node:fs/promises";
import { withProvider, printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";

// ── ADR commands (separate object kind — decision lifecycle, not task lifecycle) ──
export async function handleAdr({ sub, positional, flags, wantsJson }: CliCtx) {
  if (sub === "list") {
    await withProvider(async (client) => {
      const adrs = await client.adrList({ status: flags.status, tag: flags.tag });
      if (wantsJson) printJson(adrs);
      else if (adrs.length === 0) console.log("(no ADRs)");
      else for (const a of adrs) console.log(`${a.id}\t${a.status}\t${a.title}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "show" || sub === "view") {
    const id = positional[0];
    await withProvider(async (client) => {
      const a = await client.adrGet(id);
      if (!a) { console.error(`no such ADR: ${id}`); process.exitCode = 1; return; }
      if (wantsJson) printJson(a);
      else {
        console.log(`${a.id}: ${a.title} [${a.status}]${a.date ? `  (${a.date})` : ""}`);
        if (a.supersedes?.length) console.log(`supersedes: ${a.supersedes.join(", ")}`);
        if (a.supersededBy?.length) console.log(`superseded-by: ${a.supersededBy.join(", ")}`);
        console.log(a.body);
      }
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "new") {
    const id = positional[0];
    if (!id) { console.error("quay adr new: missing required <id> (ADR-NNN)"); process.exitCode = 1; return; }
    if (typeof flags.title !== "string" || flags.title.trim() === "") {
      console.error("quay adr new: --title <title> is required"); process.exitCode = 1; return;
    }
    if (flags.body !== undefined && flags["body-file"] !== undefined) {
      console.error("quay adr new: --body and --body-file are mutually exclusive"); process.exitCode = 1; return;
    }
    const body = flags["body-file"] !== undefined ? await fs.readFile(flags["body-file"], "utf8") : flags.body;
    await withProvider(async (client) => {
      const patch: Record<string, unknown> = { id, title: flags.title, status: flags.status ?? "proposed" };
      if (flags.date !== undefined) patch.date = flags.date;
      if (flags.supersedes !== undefined) patch.supersedes = String(flags.supersedes).split(",").filter(Boolean);
      if (flags.tags !== undefined) patch.tags = String(flags.tags).split(",").filter(Boolean);
      if (body !== undefined) patch.body = body;
      const a = await client.adrWrite(patch);
      if (wantsJson) printJson(a); else console.log(`created ${id}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (["accept", "deprecate", "reject"].includes(sub ?? "")) {
    const statusMap: Record<string, string> = { accept: "accepted", deprecate: "deprecated", reject: "rejected" };
    const id = positional[0];
    if (!id) { console.error(`quay adr ${sub}: missing required <id>`); process.exitCode = 1; return; }
    await withProvider(async (client) => {
      const a = await client.adrWrite({ id, status: statusMap[sub as string] });
      if (wantsJson) printJson(a); else console.log(`${id} → ${statusMap[sub as string]}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "supersede") {
    const id = positional[0];
    const by = flags.by;
    if (!id || typeof by !== "string") { console.error("quay adr supersede <id> --by <newId>"); process.exitCode = 1; return; }
    await withProvider(async (client) => {
      await client.adrWrite({ id, status: "superseded", superseded_by: [by] });
      const target = await client.adrGet(by);
      const supersedes = [...new Set([...(target?.supersedes ?? []), id])];
      await client.adrWrite({ id: by, supersedes });
      if (wantsJson) printJson({ id, status: "superseded", superseded_by: [by] });
      else console.log(`${id} superseded by ${by}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  console.error(`unknown adr subcommand: ${sub} (try: list, show, new, accept, deprecate, reject, supersede)`);
  process.exitCode = 1;
  return;
}
