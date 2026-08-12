// cli/serve.ts — `quay serve` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { parseFlags } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleServe({ argv }: CliCtx) {
  const { startServer } = await import("../serve.ts");
  // `serve` has no subcommand token — reparse from argv[2] so `--port` etc.
  // is read correctly instead of being swallowed into `sub`.
  const { flags: serveFlags } = parseFlags(argv.slice(1));
  await startServer({
    port: serveFlags.port ? Number(serveFlags.port) : undefined,
    host: serveFlags.host || undefined,
  });
  return;
}
