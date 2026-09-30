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
  quay init [--force] [--reconcile] [--dry-run] [--adopt-branch-model] [--root <path>]
  quay init --branch-model-only [--adopt-branch-model] [--dry-run] [--root <path>]
  quay init --branch-model-only --doc-branch-name <name> [--dry-run] [--root <path>]

Flags:
  --force      Overwrite existing .quay/config.yml if present.
  --reconcile  Bring an EXISTING .quay/config.yml up to what THIS version of quay
               requires, instead of refusing it — the mode /quay:init re-runs use.
               Per-key diff over the current-version schema: keys the version added
               since your project was initialized are FILLED from the defaults,
               values this version considers incompatible are rewritten through an
               explicit migration table, and every other key (and every comment) is
               left byte-for-byte alone. A config that is already current is not
               rewritten at all. Total over the three states, so re-running init is
               always legal: absent => a normal fresh write; unparseable => rebuilt
               from defaults with the broken file preserved beside it.
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
  const adoptBranchModel = initFlags["adopt-branch-model"] === true;
  const branchModelOnly = initFlags["branch-model-only"] === true;
  // The doc-branch NAME (gap-quay-init-no-doc-branch-bootstrap-…). ⛔ This CLI carries NO default
  // literal for it: the caller supplies it (`--doc-branch-name <name>`, or the shipped upgrade
  // entry — cli/help.ts's `QUAY_INIT_REL` — which resolves flag → `loop.doc_branch` → its own
  // CLI-parameter default). An absent name is reported as NOT-EVALUATED rather than silently
  // defaulted here — inventing a branch name inside this layer is exactly the per-project identity
  // literal `target-identity-literal-check.ts` fails RED on (`"author"` is deliberately NOT in
  // `LEGAL_IDENTITY_VALUES`).
  const docBranchName = typeof initFlags["doc-branch-name"] === "string" ? initFlags["doc-branch-name"] : undefined;

  try {
    const result = runInit({ root: targetRoot, force, reconcile, dryRun, adoptBranchModel, branchModelOnly });

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

    // ⛔ BEFORE the "already exists" arm, and on a branch of its own: an unparseable config is not a
    // config-conflict, and answering it with "already exists, use --force" sends the operator looking
    // for a conflict that does not exist while the real cause (the parse error) is never printed
    // (硬规则 3b — "could not read the input" must not be shaped like a verdict about the input).
    if (result.outcome === "corrupt") {
      console.error(
        `.quay/config.yml exists at ${result.configPath} but could not be read as a config:\n` +
        `  ${result.corruptReason}\n` +
        "\n" +
        "This is NOT a name conflict — re-running with --force would not have told you that.\n" +
        "Two legal moves, both non-destructive:\n" +
        "  --reconcile  rebuild it from this version's defaults (the unparseable file is kept\n" +
        "               beside the new one as .quay/config.yml.corrupt-<timestamp>)\n" +
        "  --dry-run    print what a rebuild would write, without touching anything"
      );
      process.exitCode = 1;
      return;
    }

    if (result.outcome === "skipped") {
      console.error(
        `.quay/config.yml already exists at ${result.configPath}. ` +
        "Use --force to overwrite, --reconcile to bring it up to this version's defaults, " +
        "or --dry-run to preview."
      );
      process.exitCode = 1;
      return;
    }

    // The reconcile diff (SPEC §3.2). Reporting the DIFF — not just "ok" — is what makes the upgrade
    // auditable: an operator re-running /quay:init after a plugin upgrade can see exactly which keys
    // this version added and whether anything else moved (nothing else can: the document is edited in
    // place, so a key that is not listed here was not touched).
    if (result.outcome === "reconciled" || result.outcome === "unchanged") {
      const r = result.reconcile;
      if (result.outcome === "unchanged") {
        console.log(`${result.configPath}: already current for this version of quay — not rewritten.`);
      } else {
        console.log(`${result.configPath}: reconciled to this version's defaults.`);
        for (const k of r?.added ?? []) console.log(`  filled loop.${k} (was absent)`);
        for (const k of r?.addedServe ?? []) console.log(`  filled serve.${k} (was absent)`);
        for (const m of r?.migrated ?? []) console.log(`  migrated loop.${m}`);
      }
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
    // A rebuild-over-corrupt reports where the unreadable bytes went; silence here would make the
    // salvage step invisible (the operator would have to notice the extra file themselves).
    if (result.corruptReason) console.log(`  ${result.corruptReason}`);
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
