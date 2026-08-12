// cli/task-check.ts — `quay task check <task-id>` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.
//
// QN-027 (iteration 13): generic task_check passthrough — same
// withProvider() path as list/view/edit, zero backend branch. Whether
// the active Provider actually implements task_check (gate capability)
// is a Provider-manifest question, not something this command
// special-cases (mirrors task edit's own comment, QN-024).

import { withProvider, printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleTaskCheck({ positional, flags, wantsJson }: CliCtx) {
  const id = positional[0];
  let result;
  await withProvider(async (client) => {
    result = await client.taskCheck(id);
  }, { providerId: flags.provider, root: flags.root });
  if (wantsJson) {
    printJson(result);
  } else {
    console.log(`${result.id}: ${result.ok ? "PASS" : "FAIL"} — ${result.reason}`);
  }
  process.exitCode = result.ok ? 0 : 1;
  return;
}
