// cli/init.ts — `quay init` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { parseFlags } from "./shared.ts";
// The init help prose + the shipped entry's name: ONE naming point, in cli/help.ts
// (gap-quay-init-sh-no-single-naming-point). The two renderings of `quay init --help` — this
// handler's and help.ts's — used to carry byte-identical copies of these sentences, so every edit
// had to be made twice and the two could drift apart silently.
import { INIT_BRANCH_MODEL_ONLY_PROSE, INIT_DOC_BRANCH_NO_DEFAULT_PROSE } from "./help.ts";
import { runInit, printNextSteps } from "../init.ts";
import {
  ensureDocBranch,
  formatBaselineCheckoutReport,
  formatDocBranchReport,
  landingBaselineEstablishedNow,
  moveCheckoutOntoLandingBaseline,
} from "../branch-model.ts";
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
  quay init [--force] [--reconcile] [--drop-incompatible] [--dry-run] [--adopt-branch-model] [--root <path>]
  quay init --branch-model-only [--adopt-branch-model] [--dry-run] [--root <path>]
  quay init --branch-model-only --doc-branch-name <name> [--dry-run] [--root <path>]

Flags:
  --force      Overwrite an existing .quay/config.yml wholesale (a fresh install at the
               same path). Without it, an EXISTING config is UPGRADED in place.
  --drop-incompatible
               When the upgraded config does not validate, delete the user values the
               validator rejects (e.g. a loop.gates naming an unregistered gate) and
               retry. Without it, such a value makes the upgrade FAIL: non-zero exit,
               the report names the offending field, and your config is left
               byte-identical. Nothing is deleted silently.
  --reconcile  LEGACY, now inert: plain 'quay init' upgrades an existing config, so this
               selects the same single engine. Kept for one release for existing callers.
               Per-key diff: keys this version added since your project was initialized
               are FILLED from the defaults, retired keys are DELETED, values this version
               considers incompatible are migrated through an explicit table, and every
               other key (and every comment) is left byte-for-byte alone. The result is
               VALIDATED before it is written — an upgrade that does not validate writes
               nothing (use --drop-incompatible to delete the offending values).
               Scope: when the config already EXISTS, this mode touches
               .quay/config.yml ONLY — it never lays down tasks/, profiles.yml or
               the launch settings. An ABSENT config gets the full fresh scaffold.
               --force still wins when both are given (an overwrite is not a diff).
  --doc-branch-name <name>
               (with --branch-model-only) Establish the DOC-ONLY work branch: when the main
               checkout is sitting on the landing baseline 'develop', create <name> at that
               tip and switch the main checkout to it, so human edits and driver commits stop
               sharing one branch and one git index. Already off 'develop' => no-op. <name>
               taken by a branch unrelated to 'develop' => REFUSED (exit 1, nothing moved).
               Head detached => NOT-EVALUATED (no verdict, nothing moved). This CLI has NO
               ${INIT_DOC_BRANCH_NO_DEFAULT_PROSE}
  --dry-run    Report what would happen without writing to disk.
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

  If .quay/config.yml already exists, it is UPGRADED in place (single engine, GOAL-029):
  merged, comment-preserving, and validated BEFORE anything is written. --force replaces
  it wholesale instead.

  If an existing .quay/config.yml cannot be PARSED, it is not refused: its bytes are
  preserved as .quay/config.yml.corrupt-<timestamp> and the config is REBUILT from this
  version's defaults (validated before the write, exit 0). The rebuild does NOT carry the
  old file's project values — compare with the backup and re-apply them.

  ${INIT_BRANCH_MODEL_ONLY_PROSE}

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
  const reconcile = initFlags.reconcile === true;
  const dryRun = initFlags["dry-run"] === true;
  const dropIncompatible = initFlags["drop-incompatible"] === true;
  const adoptBranchModel = initFlags["adopt-branch-model"] === true;
  const branchModelOnly = initFlags["branch-model-only"] === true;
  // The plugin root THIS run executes from — threaded so the upgrade can resolve the native binding
  // and refresh `<root>/.quay/plugin` AFTER the config write. ⛔ Never a registry lookup (the link
  // names the plugin root that is actually running — see init.ts's own ruling). Unset ⇒ the link
  // step is skipped here; the shell's own step still owns it until AC-331.
  const pluginRoot = typeof process.env.CLAUDE_PLUGIN_ROOT === "string" && process.env.CLAUDE_PLUGIN_ROOT !== ""
    ? process.env.CLAUDE_PLUGIN_ROOT
    : null;
  // The doc-branch NAME (gap-quay-init-no-doc-branch-bootstrap-…). ⛔ This CLI carries NO default
  // literal for it: the caller supplies it (`--doc-branch-name <name>`, or the shipped upgrade
  // entry — cli/help.ts's `QUAY_INIT_REL` — which resolves flag → `loop.doc_branch` → its own
  // CLI-parameter default). An absent name is reported as NOT-EVALUATED rather than silently
  // defaulted here — inventing a branch name inside this layer is exactly the per-project identity
  // literal `target-identity-literal-check.ts` fails RED on (`"author"` is deliberately NOT in
  // `LEGAL_IDENTITY_VALUES`).
  const docBranchName = typeof initFlags["doc-branch-name"] === "string" ? initFlags["doc-branch-name"] : undefined;

  try {
    const result = runInit({ root: targetRoot, force, reconcile, dryRun, dropIncompatible, pluginRoot, adoptBranchModel, branchModelOnly });

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
        // (the shipped upgrade entry) can relay it verbatim. `--dry-run` reports the
        // same block but does not fail — a dry run's job is to say what WOULD happen.
        process.exitCode = 1;
        return;
      }
      // ── the baseline→checkout handoff (gap-quay-init-doc-branch-noop-when-fresh-develop-…) ───
      // The gap this closes: `ensureBranchModel` CREATES `develop` when it is absent — the normal
      // shape of a project whose default branch is `main`/`master`, i.e. most real projects meeting
      // quay for the first time — and creating a ref does not move the main checkout. The doc-branch
      // bootstrap below judges by ONE fact (which branch the main checkout is on), reads the UNMOVED
      // state, lands on its `independent` arm and truthfully reports a NO-OP ⇒ the doc branch is
      // never created and the user keeps working on the branch fan-in must fast-forward.
      // ⛔ `ensureDocBranch`'s judgment is NOT taught about this: the moved checkout simply IS the
      // input its already-working `default == develop` case has always received. The handoff runs
      // only when the baseline was (re)established by THIS run AND points at the very commit the
      // checkout is on, so it is a ref rename with zero tree effect (branch-model.ts owns both
      // conditions). Placed AFTER the divergence refusal above: a refused project must not have its
      // checkout moved. Not in `--dry-run` — a plan says what WOULD happen.
      if (!dryRun && landingBaselineEstablishedNow(result.branchModel)) {
        const checkout = moveCheckoutOntoLandingBaseline(targetRoot);
        console.log(formatBaselineCheckoutReport(checkout));
        if (!checkout.ok) {
          // Fail-closed: continuing would fall straight back into the silent no-op this step exists
          // to end (the doc-branch judgment would read the unmoved checkout). The detail line above
          // names the cause for the shell entry, which relays it instead of mislabelling it.
          console.error(
            "quay init: could not move the main checkout onto the landing baseline it just " +
              "established — refusing to continue, because the doc-branch bootstrap would then " +
              "silently report a no-op.",
          );
          process.exitCode = 1;
          return;
        }
      }

      // ── the doc-branch bootstrap (gap-quay-init-no-doc-branch-bootstrap-…) ──────────────────
      // Runs AFTER the landing baseline was judged (and after a divergence refusal above returned
      // early — never move the main checkout onto a doc branch for a project whose baseline is
      // already refused). Only in the config-free branch-model entry: that is the entry the shipped
      // upgrade (cli/help.ts's `QUAY_INIT_REL` → `ensure_target_branch_model`) drives, and it is the
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

    // ⛔ On a branch of its own, and never the "already exists" arm: an unparseable config is not a
    // config-conflict, and answering it with "already exists, use --force" sends the operator looking
    // for a conflict that does not exist while the real cause (the parse error) is never printed
    // (硬规则 3b — "could not read the input" must not be shaped like a verdict about the input).
    //
    // GOAL-029 / 人 2026-10-07: an unparseable config is REBUILT (backed up, then regenerated from
    // this version's defaults, validated, written — exit 0), not refused. The operator is told the
    // real cause AND the rebuild's real cost: the new file does NOT carry the old one's project
    // values. That cost must never be silent.
    if (result.outcome === "rebuild-invalid") {
      // The rebuilt body itself failed validation ⇒ nothing was written; the corrupt original and
      // its backup are both kept, and the offending field is named.
      console.error(
        `${result.configPath}: the existing config could not be read, and the config rebuilt from ` +
        "this version's defaults did not validate either — so nothing was written."
      );
      if (result.corruptBackupPath) {
        console.error(`  the unreadable bytes are preserved at ${result.corruptBackupPath}`);
      }
      for (const i of result.rebuildIssues ?? []) {
        console.error(`  ${i.severity}: ${i.field} — ${i.message}`);
        if (i.suggestion) console.error(`    suggestion: ${i.suggestion}`);
      }
      process.exitCode = 1;
      return;
    }

    if (result.outcome === "corrupt") {
      // LEGACY outcome — no longer produced (an unparseable config is rebuilt above). Kept as a
      // defensive arm so a future regression that resurrects the refusal is reported as a refusal
      // rather than silently falling through to the "Created" arm.
      console.error(
        `.quay/config.yml exists at ${result.configPath} but could not be read as a config:\n` +
        `  ${result.corruptReason}\n` +
        "Re-run to rebuild it from this version's defaults (the unreadable file is kept beside the " +
        "new one as .quay/config.yml.corrupt-<timestamp>)."
      );
      process.exitCode = 1;
      return;
    }

    if (result.outcome === "skipped") {
      // LEGACY outcome — no longer produced by the single upgrade engine (GOAL-029): an existing
      // valid config is UPGRADED, not refused. Kept as a defensive arm so a future regression that
      // resurrects it is still reported as a refusal rather than silently falling through.
      console.error(
        `.quay/config.yml already exists at ${result.configPath} and was not upgraded. ` +
        "Re-run, or use --force to overwrite."
      );
      process.exitCode = 1;
      return;
    }

    // The upgraded CANDIDATE failed validation ⇒ NOTHING was written (validate-before-write). The
    // report names the offending field(s); `--drop-incompatible` is the escape hatch for a
    // user-pinned value this version cannot accept.
    if (result.outcome === "upgrade-invalid") {
      console.error(
        `${result.configPath}: upgrade REFUSED — the upgraded config did not validate, ` +
          "so nothing was written (your config is byte-identical)."
      );
      for (const i of result.upgradeIssues ?? []) {
        console.error(`  ${i.severity}: ${i.field} — ${i.message}`);
        if (i.suggestion) console.error(`    suggestion: ${i.suggestion}`);
      }
      console.error("  (pass --drop-incompatible to delete the offending values, or edit them by hand)");
      process.exitCode = 1;
      return;
    }

    // The upgrade diff (GOAL-029 single engine). Reporting the DIFF — not just "ok" — is what makes
    // the upgrade auditable: an operator re-running `quay init` after a plugin upgrade can see
    // exactly which keys this version added/migrated/removed and which unknown keys were kept.
    if (result.outcome === "reconciled" || result.outcome === "unchanged") {
      const r = result.upgrade;
      if (result.outcome === "unchanged") {
        console.log(`${result.configPath}: already current for this version of quay — not rewritten.`);
      } else {
        console.log(`${result.configPath}: ${dryRun ? "would be upgraded to" : "upgraded to"} this version's defaults.`);
        for (const k of r?.added ?? []) console.log(`  ${dryRun ? "would-fill" : "filled"} loop.${k} (was absent)`);
        for (const k of r?.addedServe ?? []) console.log(`  ${dryRun ? "would-fill" : "filled"} serve.${k} (was absent)`);
        for (const m of r?.migrated ?? []) console.log(`  ${dryRun ? "would-migrate" : "migrated"} loop.${m}`);
        for (const k of r?.removed ?? []) console.log(`  ${dryRun ? "would-remove" : "removed"} ${k} (retired key)`);
        for (const k of r?.pinned ?? []) console.log(`  ${dryRun ? "would-pin" : "pinned"} providers.native.env.${k} (carrier dir pin)`);
        for (const k of r?.dropped ?? []) console.log(`  dropped ${k} (--drop-incompatible: it did not validate)`);
      }
      for (const k of r?.unknownKeys ?? []) {
        console.error(`  warning: unrecognized top-level config key "${k}" — kept as-is (not deleted)`);
      }
      if (dryRun && result.outcome === "reconciled") console.log("# Dry run — nothing written to disk.");
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
      // The corrupt plan is not the same as the fresh plan: a real run would PRESERVE the bytes that
      // could not be parsed, so the plan says where. A dry run that omitted this would understate
      // what the real run does (and a rebuild that dropped the file silently is exactly the failure
      // the backup exists to prevent).
      if (result.corruptBackupPath) {
        console.log(`# Would back up the unreadable .quay/config.yml to: ${result.corruptBackupPath}`);
        console.log(`# Would rebuild it from this version's defaults (the old file's project values are NOT carried over).`);
      }
      console.log(`# Would create: ${result.configPath}`);
      console.log(`# Would create: ${result.tasksDir}/`);
      console.log(`# Would create: ${result.launchSettingsPath}`);
      console.log(`# Would create: ${result.profilesPath}`);
      console.log(`# ${result.branchModelReport}`);
      return;
    }

    if (result.outcome === "rebuilt") {
      // A corrupt config was salvaged: the bytes are preserved and the config regenerated. Reporting
      // the cause, the backup location and the LOST project values makes the salvage auditable — a
      // silent rebuild would destroy the user's own settings with no trace of what they were.
      console.log(`${result.configPath}: rebuilt from this version's defaults.`);
      console.log(`  the previous file could not be read as a config: ${result.corruptReason}`);
      if (result.corruptBackupPath) {
        console.log(`  its bytes were preserved at ${result.corruptBackupPath} (byte-identical)`);
      }
      console.error(
        "warning: the rebuilt config carries THIS VERSION's defaults, not the old file's project " +
        "values (e.g. a pinned serve binding, loop.test_command, loop.gates). Compare it with the " +
        `backup${result.corruptBackupPath ? ` at ${result.corruptBackupPath}` : ""} and re-apply what you need.`
      );
    } else {
      console.log(`Created ${result.configPath}`);
    }
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
