// cli/action.ts — `quay action list` / `quay action run` command handlers.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { withProvider, printJson } from "./shared.ts";
import { composePayload, deliverTrigger } from "../action.ts";
import type { CliCtx } from "./context.ts";

export async function handleActionList({ positional, flags, wantsJson }: CliCtx) {
  const id = positional[0];
  await withProvider(async (client) => {
    const manifest = await client.manifest();
    const t = await client.taskGet(id);
    if (!t) {
      console.error(`no such task: ${id}`);
      process.exitCode = 1;
      return;
    }
    const buttons = (manifest.action_buttons ?? []).filter(
      (b) => !b.whenStatus || b.whenStatus.includes(t.status)
    );
    if (wantsJson) printJson(buttons);
    else for (const b of buttons) console.log(`${b.id}\t${b.label}`);
  }, { providerId: flags.provider, root: flags.root });
  return;
}

export async function handleActionRun({ positional, flags }: CliCtx) {
  const [id, actionId] = positional;
  await withProvider(async (client, cfg) => {
    const manifest = await client.manifest();
    const t = await client.taskGet(id);
    if (!t) {
      console.error(`no such task: ${id}`);
      process.exitCode = 1;
      return;
    }
    const payloadObj = composePayload({ providerManifest: manifest, task: t, actionId });
    console.log(`[quay action run] composed trigger for ${id} (status=${t.status}, skill=${payloadObj.skill}):`);
    console.log(`  ${payloadObj.payload}`);
    const channel = `task-${id}`;
    // QN-042 (DIR-009): QUAY_ACTION_MOCK_LOG opts into the deterministic
    // mock/file-log delivery mode instead of manda/print — see
    // src/action.js#deliverTrigger's own doc comment.
    const mockLogPath = process.env.QUAY_ACTION_MOCK_LOG || undefined;
    const result = await deliverTrigger({ root: cfg.workspaceRoot, channel, payloadObj, mockLogPath });
    printJson({ ...payloadObj, channel, ...result });
  }, { providerId: flags.provider, root: flags.root });
  return;
}
