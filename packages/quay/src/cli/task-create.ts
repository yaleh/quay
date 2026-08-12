// cli/task-create.ts — `quay task create <task-id> --title <title>` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { withProvider, printJson, resolveBody } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleTaskCreate({ positional, flags, wantsJson }: CliCtx) {
  // M29-cli-create-ergonomics (GAP-001): dedicated Core-CLI `task create`
  // verb. --title is MANDATORY at the CLI-parsing layer — a hard usage
  // error (no provider call made at all) if missing or empty. This is
  // the structural/ergonomic complement to the `task edit` guard below;
  // together they close GAP-002 (see that guard's own comment for the
  // full mechanism trace).
  const id = positional[0];
  if (!id) {
    console.error("quay task create: missing required <id> argument");
    process.exitCode = 1;
    return;
  }
  if (flags.body !== undefined && flags["body-file"] !== undefined) {
    console.error("quay task create: --body and --body-file are mutually exclusive");
    process.exitCode = 1;
    return;
  }
  if (typeof flags.title !== "string" || flags.title.trim() === "") {
    console.error("quay task create: --title <title> is required (and must be non-empty)");
    process.exitCode = 1;
    return;
  }

  const patch: Record<string, unknown> = { title: flags.title };
  if (flags.status !== undefined) patch.status = flags.status;
  if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
  if (flags.parent !== undefined) patch.parent = flags.parent;
  if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
  if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra as string);
  if (flags.body !== undefined || flags["body-file"] !== undefined) {
    patch.body = await resolveBody(flags);
  }

  await withProvider(async (client) => {
    const t = await client.taskWrite({ id, ...patch });
    if (wantsJson) printJson(t);
    else console.log(`${t.id}: ${t.title} [${t.status}]`);
  }, { providerId: flags.provider, root: flags.root });
  return;
}
