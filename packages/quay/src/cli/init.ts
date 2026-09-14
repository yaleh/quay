// cli/init.ts — `quay init` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { parseFlags } from "./shared.ts";
import { runInit, printNextSteps } from "../init.ts";
import { ensureDocBranch, formatDocBranchReport } from "../branch-model.ts";
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
  quay init --branch-model-only [--adopt-branch-model] [--dry-run] [--root <path>]
  quay init --branch-model-only --doc-branch-name <name> [--dry-run] [--root <path>]

Flags:
  --force      Overwrite existing .quay/config.yml if present.
  --doc-branch-name <name>
               (with --branch-model-only) Establish the DOC-ONLY work branch: when the main
               checkout is sitting on the landing baseline 'develop', create <name> at that
               tip and switch the main checkout to it, so human edits and driver commits stop
               sharing one branch and one git index. Already off 'develop' => no-op. <name>
               taken by a branch unrelated to 'develop' => REFUSED (exit 1, nothing moved).
               Head detached => NOT-EVALUATED (no verdict, nothing moved). This CLI has NO
               default for <name>: it is supplied by the caller (the shipped quay-init.sh
               resolves --doc-branch-name, then loop.doc_branch, then its own default).
  --dry-run    Print the generated config to stdout without writing to disk.
  --adopt-branch-model
               When the project already has a 'develop' (or 'author') that is NOT
               a continuation of its default branch, preserve the existing tip
               under '<branch>-pre-quay-init-<sha>' and re-point the branch at the
               default branch tip. Without this flag such a project is REFUSED
               (fail-closed) — reusing a foreign branch silently would make every
               task's anti-drift diff meaningless.
  --branch-model-only
               Establish ONLY the quay branch model and touch NOTHING else: no
               .quay/config.yml write, no tasks/ mkdir, no profiles / launch
               settings lay-down. This is the entry for an ALREADY-initialized
               project (an existing config is its normal input, so the
               config-exists refusal does not apply). Exits 1 when the landing
               baseline is divergent and no adoption was requested.
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

  Use --branch-model-only when the project is already initialized and you only
  need the branch model established (the shipped plugin/scripts/quay-init.sh
  upgrade entry calls this): it never rewrites config, so an existing project's
  gates: / loop: / routines: survive.

  Adding --doc-branch-name to that entry also ESTABLISHES the doc-only work
  branch. 'quay init' REPORTS which branch fills the doc role and never names
  one itself; the name is the caller's (a CLI parameter, or the project's
  loop.doc_branch). A project whose main checkout stays on 'develop' has no
  buffer between human edits and the driver's own commits — they share one
  branch and one git index.

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
  const branchModelOnly = initFlags["branch-model-only"] === true;
  // The doc-branch NAME (gap-quay-init-no-doc-branch-bootstrap-…). ⛔ This CLI carries NO default
  // literal for it: the caller supplies it (`--doc-branch-name <name>`, or the shipped
  // plugin/scripts/quay-init.sh, which resolves flag → `loop.doc_branch` → its own CLI-parameter
  // default). An absent name is reported as NOT-EVALUATED rather than silently defaulted here —
  // inventing a branch name inside this layer is exactly the per-project identity literal
  // `target-identity-literal-check.ts` fails RED on (`"author"` is deliberately NOT in
  // `LEGAL_IDENTITY_VALUES`).
  const docBranchName = typeof initFlags["doc-branch-name"] === "string" ? initFlags["doc-branch-name"] : undefined;

  try {
    const result = runInit({ root: targetRoot, force, dryRun, adoptBranchModel, branchModelOnly });

    // The config-free branch-model entry (gap-upgrade-entry-never-establishes-branch-model). It
    // reports the model and decides, nothing else — so the only outcomes it can reach are this one
    // and the shared error path below.
    if (result.outcome === "branch-model-only") {
      console.log(result.branchModelReport);
      if (result.branchModel.skipped) {
        // Not a classifiable repo (no git / no commits). Reported as such, and NOT a failure —
        // "could not evaluate" must not be reported with the shape of a verdict (hard rule 3b).
        return;
      }
      if (!result.branchModel.ok && !dryRun) {
        // Fail-closed: a divergent landing baseline without an adoption decision. The report already
        // carries the remedy (`formatBranchModelReport` prints the `remedy:` line), so the caller
        // (the shipped quay-init.sh upgrade entry) can relay it verbatim. `--dry-run` reports the
        // same block but does not fail — a dry run's job is to say what WOULD happen.
        process.exitCode = 1;
        return;
      }
      // ── the doc-branch bootstrap (gap-quay-init-no-doc-branch-bootstrap-…) ──────────────────
      // Runs AFTER the landing baseline was judged (and after a divergence refusal above returned
      // early — never move the main checkout onto a doc branch for a project whose baseline is
      // already refused). Only in the config-free branch-model entry: that is the entry the shipped
      // upgrade (`plugin/scripts/quay-init.sh` → `ensure_target_branch_model`) drives, and it is the
      // one whose contract is "establish the branch model, touch nothing else" — a `git checkout` of
      // the main checkout is git metadata + the same commit's tree, never a config/content write.
      // Called UNCONDITIONALLY — an absent name is its own reported state (NOT-EVALUATED), never a
      // silently skipped step (硬规则 3b: "did not look" must not be shaped like "nothing to do").
      // `--adopt-branch-model` is the SAME declared decision for BOTH roles: it already carries the
      // doc-branch collision (`--adopt-branch-model`'s own help text names 'author'), so it is
      // threaded straight through rather than inventing a second adoption flag.
      const docBranch = ensureDocBranch(targetRoot, { name: docBranchName ?? "", dryRun, adopt: adoptBranchModel });
      console.log(formatDocBranchReport(docBranch));
      // Fail-closed on a real refusal (a name collision) or a failed mutation; a dry run only
      // reports, and an unreadable HEAD is NOT a failure (hard rule 3b).
      if (!docBranch.ok && !dryRun) process.exitCode = 1;
      return;
    }

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
