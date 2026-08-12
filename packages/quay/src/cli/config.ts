// cli/config.ts — `quay config validate`/`check` command handlers.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { loadConfig } from "../config.ts";
import { resolveWorkspaceRootOrThrow } from "../gate/config/loader.ts";
import { printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";

// DIR-099-A: config validate — structural validation pass over workspace config.
// Does NOT require a provider connection (pure static analysis of config files).
// gap-task-list-root-does-not-scope-config-lookup AC4: `--root <path>` is
// supported with the SAME semantics as every workspace-scoped command —
// config discovery starts at <path> (walk-up), fail-closed when no config.
export async function handleConfigValidate({ sub, flags, wantsJson }: CliCtx) {
  if (sub === "validate" || sub === "check") {
    if (flags.root !== undefined && typeof flags.root !== "string") {
      console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
      process.exitCode = 1;
      return;
    }
    let cfg;
    try {
      cfg = flags.root ? loadConfig(resolveWorkspaceRootOrThrow(flags.root as string)) : loadConfig();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    const workspaceRoot = cfg.workspaceRoot;
    const checkFiles = flags["check-files"] === true;

    const { validateConfig } = await import("../config-validate.ts");
    const result = validateConfig({ workspaceRoot, checkFiles });

    if (wantsJson) {
      printJson(result.issues);
    } else {
      if (result.issues.length === 0) {
        console.log("Config valid.");
      } else {
        for (const issue of result.issues) {
          console.log(`${issue.severity}: ${issue.field} — ${issue.message}`);
          if (issue.suggestion) console.log(`  suggestion: ${issue.suggestion}`);
        }
        const errorCount = result.issues.filter((i) => i.severity === "error").length;
        const warnCount = result.issues.filter((i) => i.severity === "warn").length;
        const parts = [];
        if (errorCount > 0) parts.push(`${errorCount} error(s)`);
        if (warnCount > 0) parts.push(`${warnCount} warning(s)`);
        console.log(`${parts.join(", ")} found.`);
      }
    }
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  // DIR-099-A: unknown config subcommand
  console.error(`quay config: unknown subcommand "${sub}" (try "validate" or "check")`);
  process.exitCode = 1;
  return;
}
