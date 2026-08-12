// cli/gate-log.ts — `quay gate-log <task-id>` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { runGateLogQuery } from "../gate/gate-log.ts";
import { parseVerbless, withProvider, printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";

// AC3: read-only query of GateEvents for <task>, filtered by pipeline_id.
// Never appends. `--json` is read directly off flags.json. Id + flags are
// flag-aware in either order (see the verb-less CLI arg-ordering note above).
// A missing id is an
// explicit usage error (exit 1) — chosen deliberately over the previous
// silent-empty output, to mirror the other five verb-less commands, which all
// require an id; querying ALL ids unfiltered is a distinct operation that
// would need its own explicit flag, not a missing-argument fallthrough.
export async function handleGateLog({ sub, rest }: CliCtx) {
  const { flags: vf, id } = parseVerbless(sub, rest);
  if (!id) { console.error("quay gate-log: missing required <task-id> argument"); process.exitCode = 1; return; }
  await withProvider(async (client, cfg) => {
    const events = runGateLogQuery(cfg.workspaceRoot, {
      pipelineId: id,
      gate: vf.gate,
      file: vf.file,
    });
    if (vf.json) printJson(events);
    else events.forEach((e) => console.log(`${e.timestamp} ${e.gate} ${e.verdict}`));
  }, { providerId: vf.provider, root: vf.root });
  return;
}
