// cli/migrate.ts — `quay migrate --from <providerId> --to <providerId>` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { loadConfig } from "../config.ts";
import { resolveWorkspaceRootOrThrow } from "../gate/config/loader.ts";
import { migrateTasks } from "../migrate.ts";
import { parseFlags, printJson, connectNamedProvider } from "./shared.ts";
import type { CliCtx } from "./context.ts";

// DIR-039 (A): `quay migrate --from <providerId> --to <providerId>` — the
// generic ABI provider-to-provider migration command. No positional task
// id (mirrors `run`'s own shape: it acts over the WHOLE board, not one
// task), so any flag lands in `sub` exactly like `run` — re-parse from
// [sub, ...rest].
export async function handleMigrate({ sub, rest }: CliCtx) {
  const { flags: mf } = parseFlags([sub, ...rest].filter((a) => a !== undefined));
  if (typeof mf.from !== "string" || mf.from.trim() === "") {
    console.error("quay migrate: --from <providerId> is required");
    process.exitCode = 1;
    return;
  }
  if (typeof mf.to !== "string" || mf.to.trim() === "") {
    console.error("quay migrate: --to <providerId> is required");
    process.exitCode = 1;
    return;
  }
  if (mf.from === mf.to) {
    console.error("quay migrate: --from and --to must name different providers");
    process.exitCode = 1;
    return;
  }
  // gap-task-list-root-does-not-scope-config-lookup: honor `--root` the same
  // way every workspace-scoped command does (start config discovery at
  // <path>, walk-up, fail-closed when no config).
  if (mf.root !== undefined && typeof mf.root !== "string") {
    console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
    process.exitCode = 1;
    return;
  }
  let cfg;
  try {
    cfg = mf.root ? loadConfig(resolveWorkspaceRootOrThrow(mf.root as string)) : loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }
  const { client: source } = await connectNamedProvider(cfg, mf.from as string);
  try {
    const { client: target } = await connectNamedProvider(cfg, mf.to as string);
    try {
      const result = await migrateTasks({
        source,
        target,
        onTask: mf.json ? undefined : (t) => console.log(`migrated ${t.id}: ${t.title}`),
      });
      if (mf.json) {
        printJson(result);
      } else {
        console.log(
          `migrate --from ${mf.from} --to ${mf.to}: ${result.migrated.length}/${result.total} tasks migrated` +
            (result.errors.length ? `, ${result.errors.length} error(s)` : "")
        );
        for (const e of result.errors) console.error(`  error: ${e.id ?? "(no id)"}: ${e.error}`);
      }
      process.exitCode = result.errors.length > 0 ? 1 : 0;
    } finally {
      await target.close();
    }
  } finally {
    await source.close();
  }
  return;
}
