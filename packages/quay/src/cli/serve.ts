// cli/serve.ts — `quay serve` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.
//
// gap-serve-same-root-admission-lock: `startServer()` now holds a same-root admission lock and
// REFUSES to start a second host for the same workspace root (the refusal is thrown as its own,
// distinguishable error). For THIS verb that refusal is not a failure: the requested end state —
// 「this root is being served by exactly one live host」— already holds, which is the same
// idempotency contract the driver kernel gives for `already-running`. So the CLI exits **0** and
// prints one line naming the holder.
//
// ⛔ The line ends with the machine-readable admission marker (SERVE_ADMISSION_REFUSED_MARKER,
// carrying this process's own pid) because the exit code cannot say WHICH of the two 0-exits
// happened. `plugin/scripts/start-drivers.ts` is the consumer: it spawns this CLI, reads the bytes
// appended to the log since its own spawn, and maps the marker to `already-running`. Without the
// marker, a refused start and a crashed-then-exited-0 start would look the same to it.

import { parseFlags } from "./shared.ts";
import type { CliCtx } from "./context.ts";

export async function handleServe({ argv }: CliCtx) {
  const { startServer, isServeAdmissionRefused, formatAdmissionRefusal } = await import("../serve.ts");
  // `serve` has no subcommand token — reparse from argv[2] so `--port` etc.
  // is read correctly instead of being swallowed into `sub`.
  const { flags: serveFlags } = parseFlags(argv.slice(1));
  try {
    await startServer({
      port: serveFlags.port ? Number(serveFlags.port) : undefined,
      host: serveFlags.host || undefined,
    });
  } catch (err) {
    if (!isServeAdmissionRefused(err)) throw err;
    // stdout, not stderr: this is a successful no-op (exit 0), and it is also the channel
    // start-drivers captures into `.quay/serve.log` for the marker read.
    process.stdout.write(formatAdmissionRefusal(err));
  }
  return;
}
