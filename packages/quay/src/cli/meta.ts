// cli/meta.ts — `quay meta` command handler (META records, provider-backed —
// gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label). Reads/writes META records
// through the Provider ABI (`client.metaList` / `client.metaGet` / `client.metaWrite`), never the
// store directly — the store lives in quay-native; Core keeps only the view-model + shim.
// Mirrors cli/goal.ts's `withProvider` shape (the same per-invocation context + flags).

import fs from "node:fs/promises";
import { withProvider, printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleMeta({ sub, positional, flags, wantsJson }: CliCtx) {
  if (sub === "list") {
    await withProvider(async (client) => {
      const filter: Record<string, unknown> = {};
      if (flags.status !== undefined) filter.status = flags.status;
      const metas = await client.metaList(filter);
      if (wantsJson) printJson(metas);
      else if (metas.length === 0) console.log("(no meta records)");
      else for (const m of metas) console.log(`${m.id}\t${m.status}\t${m.handler}\t${m.title}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "show" || sub === "view" || sub === "get") {
    const id = positional[0];
    if (!id) { console.error(`quay meta ${sub}: missing required <id> (META-NNN)`); process.exitCode = 1; return; }
    await withProvider(async (client) => {
      const m = await client.metaGet(id);
      if (!m) { console.error(`no such META: ${id}`); process.exitCode = 1; return; }
      if (wantsJson) printJson(m);
      else {
        console.log(`${m.id}: ${m.title} [${m.status}]${m.handler ? ` (${m.handler})` : ""}`);
        if (m.reply) console.log(`reply: ${m.reply}`);
        if (m.body) console.log(m.body);
      }
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "write" || sub === "new") {
    const id = positional[0];
    if (!id) { console.error("quay meta write: missing required <id> (META-NNN)"); process.exitCode = 1; return; }
    if (flags.body !== undefined && flags["body-file"] !== undefined) {
      console.error("quay meta write: --body and --body-file are mutually exclusive"); process.exitCode = 1; return;
    }
    const body = flags["body-file"] !== undefined ? await fs.readFile(flags["body-file"], "utf8") : flags.body;
    await withProvider(async (client) => {
      const patch: Record<string, unknown> = { id };
      if (flags.title !== undefined) patch.title = flags.title;
      if (flags.status !== undefined) patch.status = flags.status;
      if (flags.handler !== undefined) patch.handler = flags.handler;
      if (flags.reply !== undefined) patch.reply = flags.reply;
      if (body !== undefined) patch.body = body;
      const m = await client.metaWrite(patch);
      if (wantsJson) printJson(m); else console.log(`wrote ${id}`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  if (sub === "reply") {
    const id = positional[0];
    if (!id) { console.error("quay meta reply: missing required <id> (META-NNN)"); process.exitCode = 1; return; }
    if (typeof flags.reply !== "string" || flags.reply.trim() === "") {
      console.error("quay meta reply: --reply <text> is required"); process.exitCode = 1; return;
    }
    await withProvider(async (client) => {
      const m = await client.metaWrite({ id, status: "answered", reply: flags.reply });
      if (wantsJson) printJson(m); else console.log(`${id} → answered`);
    }, { providerId: flags.provider, root: flags.root });
    return;
  }
  console.error(`unknown meta subcommand: ${sub} (try: list, show, write, reply)`);
  process.exitCode = 1;
  return;
}
