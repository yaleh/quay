// cli/provider.ts — `quay provider switch <name>` command handler.
// gap-provider-switch-no-dedicated-entry-point.
//
// THE GAP. `quay init` writes `providers.<id>.enabled`, and nothing else in the product ever wrote
// it again: switching an existing project from native to github (or back) meant hand-editing
// `.quay/config.yml` — uncomment a block, flip two `enabled:` values by hand — with no check that
// the provider being switched TO is configured at all, and no check that the file still validates
// after the edit. `quay migrate --from A --to B` is a DIFFERENT axis: it moves task DATA between two
// live providers and never touches which one is enabled.
//
// THE PRECONDITION IS THE CANDIDATE, JUDGED BY THE EXISTING VALIDATOR. The switch is refused unless
// the WHOLE config-as-it-would-be validates, and it is `validateConfigText` — the same pipeline
// `quay config validate` runs on the same bytes — that answers it. That is deliberate: the target
// provider is `enabled: true` in the candidate, and `validateConfigText`'s provider + provider-env
// checks judge exactly the enabled ones, so "the switch's precondition" and "`quay config validate`
// after the switch" are ONE question asked twice, not two rules that can drift (硬规则 5b).
// Validate-then-write: a refusal leaves `.quay/config.yml` byte-for-byte untouched.

import fs from "node:fs";
import { loadConfig } from "../config.ts";
import { resolveWorkspaceRootOrThrow } from "../gate/config/loader.ts";
import { switchEnabledProviderText } from "../init.ts";
import { validateConfigText } from "../config-validate.ts";
import { printJson } from "./shared.ts";
import type { CliCtx } from "./context.ts";

/** The one subcommand. A single source for both the usage line and the dispatch guard. */
export const PROVIDER_VERBS = ["switch"] as const;

/** The `<name>` argument was missing / not a usable provider id. */
const USAGE = "Usage: quay provider switch <name> [--json] [--root <path>]";

/**
 * Why a text-level flip could not be expressed, as operator-facing prose. Each note is its OWN
 * sentence — an unreadable config shape must never read like "there was nothing to do" (硬规则 3b).
 */
const FLIP_NOTE_PROSE: Record<string, string> = {
  "no-providers": "the file has no `providers:` section",
  "inline-providers": "`providers:` is a flow mapping (`providers: {…}`) — there is no per-provider line to rewrite",
  "no-target": "no provider entry for that name could be located in the `providers:` block",
};

export async function handleProvider({ sub, flags, positional, wantsJson }: CliCtx) {
  if (sub !== "switch") {
    const got = typeof sub === "string" && sub !== "" ? `"${sub}"` : "(none)";
    console.error(`quay provider: unknown subcommand ${got} (try ${PROVIDER_VERBS.map((v) => `"${v}"`).join(" or ")})`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  // gap-task-list-root-does-not-scope-config-lookup: honor `--root` exactly the way every other
  // workspace-scoped command does — config discovery starts at <path>, walk-up, fail-closed when
  // no config is found there (no silent cwd fallback).
  if (flags.root !== undefined && typeof flags.root !== "string") {
    console.error("Error: --root requires a value (e.g., --root /path/to/workspace)");
    process.exitCode = 1;
    return;
  }

  const target = positional[0];
  if (typeof target !== "string" || target.trim() === "") {
    console.error("quay provider switch: <name> is required (e.g., quay provider switch github)");
    console.error(USAGE);
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

  const providers = cfg.config?.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    console.error(
      `quay provider switch: ${cfg.configPath} has no usable "providers:" mapping — nothing to switch`,
    );
    process.exitCode = 1;
    return;
  }

  const declared = Object.keys(providers);
  if (!Object.prototype.hasOwnProperty.call(providers, target)) {
    console.error(
      `quay provider switch: no provider "${target}" in ${cfg.configPath} (declared: ${declared.join(", ") || "(none)"}) — ` +
        `add the entry first (a provider the config does not declare cannot be switched to)`,
    );
    process.exitCode = 1;
    return;
  }

  const enabledNow = declared.filter((pid) => providers[pid] && providers[pid].enabled === true);

  // Idempotent: the target already IS the enabled provider. No write, no re-validation, exit 0 —
  // the same "already in the requested state is not a failure" reading `quay server start` uses.
  if (enabledNow.length === 1 && enabledNow[0] === target) {
    if (wantsJson) {
      printJson({ provider: target, alreadyEnabled: true, configPath: cfg.configPath, changed: [], added: [] });
    } else {
      console.log(`quay provider switch: "${target}" is already the enabled provider — nothing to do (${cfg.configPath})`);
    }
    return;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(cfg.configPath, "utf8");
  } catch (err) {
    console.error(`quay provider switch: cannot read ${cfg.configPath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const flipped = switchEnabledProviderText(raw, target);
  if (flipped.note !== null) {
    console.error(
      `quay provider switch: cannot flip the enabled provider in ${cfg.configPath} — ` +
        `${FLIP_NOTE_PROSE[flipped.note] ?? flipped.note}; nothing was written. Edit the file by hand.`,
    );
    process.exitCode = 1;
    return;
  }

  // The target is `enabled: true` in the candidate, so the validator's provider checks (a launchable
  // mcp_entry; the native path when one is declared) and its provider-env checks (github's
  // QUAY_GITHUB_REPO shape) judge the provider being switched TO. Errors REFUSE the write.
  const verdict = validateConfigText({ text: flipped.text, workspaceRoot: cfg.workspaceRoot });
  const errors = verdict.issues.filter((i) => i.severity === "error");
  if (!verdict.ok) {
    console.error(
      `quay provider switch: refused — "${target}" is not fully configured, and ${cfg.configPath} was NOT modified.`,
    );
    for (const i of errors) console.error(`  ${i.field} — ${i.message}${i.code ? ` [${i.code}]` : ""}`);
    for (const i of errors) if (i.suggestion) console.error(`    fix: ${i.suggestion}`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(cfg.configPath, flipped.text, "utf8");

  const warnings = verdict.issues.filter((i) => i.severity === "warn");
  for (const w of warnings) console.error(`  warn: ${w.field} — ${w.message}`);

  // AC-330 / GOAL-029: `quay init` no longer takes an overwrite or reconcile selector — re-running it
  // on an existing project upgrades the config IN PLACE (validated before the write). So the honest
  // instruction is "just run it again", with no flag to remember.
  const initHint =
    "Next `quay init` (or the /quay:init skill) reconciles automatically — there is no flag to pass: " +
    "it upgrades .quay/config.yml in place and re-validates the newly enabled provider's binding.";

  if (wantsJson) {
    printJson({
      provider: target,
      previousEnabled: enabledNow,
      configPath: cfg.configPath,
      changed: flipped.changed,
      added: flipped.added,
      warnings: warnings.map((w) => ({ field: w.field, message: w.message })),
      initReconcileHint: initHint,
    });
  } else {
    const from = enabledNow.length > 0 ? enabledNow.join(", ") : "(none)";
    console.log(`quay provider switch: enabled provider ${from} -> ${target} (${cfg.configPath})`);
    for (const c of flipped.changed) console.log(`  providers.${c.provider}.enabled: ${c.from} -> ${c.to}`);
    for (const pid of flipped.added) console.log(`  providers.${pid}.enabled: (absent) -> true`);
    console.log("");
    console.log(initHint);
  }
}
