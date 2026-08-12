// cli/task-view.ts — `quay task view <task-id>` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { withProvider, printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleTaskView({ positional, flags, wantsJson }: CliCtx) {
  const id = positional[0];
  await withProvider(async (client) => {
    const t = await client.taskGet(id);
    if (!t) {
      console.error(`no such task: ${id}`);
      process.exitCode = 1;
      return;
    }
    if (wantsJson) printJson(t);
    else {
      console.log(`${t.id}: ${t.title} [${t.status}]`);
      console.log(t.body);
    }
  }, { providerId: flags.provider, root: flags.root });
  return;
}
