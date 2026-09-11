// cli/init.ts — `quay init` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { parseFlags } from "./shared.ts";
import { runInit, printNextSteps } from "../init.ts";
import type { CliCtx } from "./context.ts";

// DIR-098: quay init — scaffold a new workspace (.quay/config.yml + tasks/ dir).
// Does NOT require an existing config (loadConfig() throws without one — that
// is the whole point of `init`). No provider connection needed.
export async function handleInit({ sub, rest }: CliCtx) {
  // Re-parse flags from [sub, ...rest] so --force, --dry-run, --root are seen
  // regardless of whether they land in sub or rest.
  const { flags: initFlags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

  // --help / -h for init subcommand
  if (sub === "--help" || sub === "-h" || initFlags.help) {
    process.stdout.write(`quay init — scaffold a new quay workspace

Usage:
  quay init [--force] [--dry-run] [--adopt-branch-model] [--root <path>]

Flags:
  --force      Overwrite existing .quay/config.yml if present.
  --dry-run    Print the generated config to stdout without writing to disk.
  --adopt-branch-model
               When the project already has a 'develop' (or 'author') that is NOT
               a continuation of its default branch, preserve the existing tip
               under '<branch>-pre-quay-init-<sha>' and re-point the branch at the
               default branch tip. Without this flag such a project is REFUSED
               (fail-closed) — reusing a foreign branch silently would make every
               task's anti-drift diff meaningless.
  --root <path>  Scaffold at <path> instead of the current working directory.

Description:
  Creates .quay/config.yml (with all 3 sections: providers, gates, loop) and
  a tasks/ directory at the project root. Auto-detects project type (Node.js /
  Go) to suggest appropriate gate defaults.

  It also ESTABLISHES the quay branch model: the landing baseline 'develop'
  (the ref the fan-in / anti-drift path diffs task branches against) and the
  doc-only branch 'author' are created at the default branch tip when absent.
  quay's fan-in reads 'develop'; without this step a project whose own
  'develop' is an unrelated ancient fork makes every task structurally
  un-landable (anti-drift reports thousands of violations that are not the
  task's work).

  If .quay/config.yml already exists, refuses to overwrite unless --force.

  This command only scaffolds a brand-new EMPTY task store. It does NOT lay
  down the loop mechanism (workflows, agents, gate scripts, tick docs) — the
  canonical path for onboarding an existing project onto quay-driven
  development is the /quay:init skill inside a Claude Code session:
  /quay:init --all --loop. CLI init has no --loop flag; passing it is an error.
`);
    return;
  }

  // Collision guard (gap-cli-quay-init-collides-with-the-canonical-slash-quay-init).
  // CLI `quay init` (DIR-098) scaffolds a brand-new EMPTY task store
  // (.quay/config.yml + tasks/) — it does NOT lay down the loop mechanism.
  // The full two-layer loop install (workflows, agents, gate scripts, tick
  // docs) is the /quay:init skill — the human-ruled CANONICAL onboarding path.
  // A real user on B ran `quay init --loop`; the flag was silently swallowed
  // and exit 0 reported success while plugin/scripts=0 and orchestration/=0
  // (nothing but the empty store was laid). Fail closed and point at the skill.
  if (initFlags.loop) {
    console.error(
      "quay init: unrecognized option --loop.\n" +
      "CLI `quay init` only scaffolds a brand-new EMPTY quay task store\n" +
      "(.quay/config.yml + tasks/); it accepts only --force / --dry-run / --root.\n" +
      "\n" +
      "To lay the full quay loop mechanism into an existing project, the canonical\n" +
      "path is the /quay:init skill inside a Claude Code session:\n" +
      "\n" +
      "    /quay:init --all --loop\n" +
      "\n" +
      "Run `quay init --help` for the CLI surface, or open Claude Code in this\n" +
      "project and run /quay:init."
    );
    process.exitCode = 1;
    return;
  }

  const targetRoot = typeof initFlags.root === "string" ? initFlags.root : process.cwd();
  const force = initFlags.force === true;
  const dryRun = initFlags["dry-run"] === true;
  const adoptBranchModel = initFlags["adopt-branch-model"] === true;

  try {
    const result = runInit({ root: targetRoot, force, dryRun, adoptBranchModel });

    if (result.outcome === "skipped") {
      console.error(
        `.quay/config.yml already exists at ${result.configPath}. ` +
        "Use --force to overwrite, or --dry-run to preview."
      );
      process.exitCode = 1;
      return;
    }

    if (result.outcome === "branch-model-blocked") {
      // Fail-closed, tree untouched: the project's landing baseline is a foreign line and silently
      // reusing it would make every task's anti-drift diff meaningless. Nothing was written.
      console.error(result.branchModelReport);
      console.error(
        "quay init: refusing to initialize — the project's landing baseline is not a continuation " +
        "of its default branch. Nothing was written."
      );
      process.exitCode = 1;
      return;
    }

    if (result.outcome === "dry-run") {
      console.log(result.content);
      console.log(`\n# Dry run — nothing written to disk.`);
      console.log(`# Would create: ${result.configPath}`);
      console.log(`# Would create: ${result.tasksDir}/`);
      console.log(`# Would create: ${result.launchSettingsPath}`);
      console.log(`# Would create: ${result.profilesPath}`);
      console.log(`# ${result.branchModelReport}`);
      return;
    }

    console.log(`Created ${result.configPath}`);
    console.log(`Created ${result.tasksDir}/ (or already existed)`);
    console.log(`Created ${result.launchSettingsPath}`);
    console.log(`Created ${result.profilesPath}`);
    console.log(result.branchModelReport);
    printNextSteps("native", result.tasksDir);
  } catch (err) {
    console.error(`quay init: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
  return;
}
