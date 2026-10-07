// cli/init.ts — `quay init` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.

import { parseFlags, resolveJsonFlag } from "./shared.ts";
// The init help prose + the shipped entry's name: ONE naming point, in cli/help.ts
// (gap-quay-init-sh-no-single-naming-point). The two renderings of `quay init --help` — this
// handler's and help.ts's — used to carry byte-identical copies of these sentences, so every edit
// had to be made twice and the two could drift apart silently.
import { INIT_BRANCH_MODEL_ONLY_PROSE, INIT_DOC_BRANCH_NO_DEFAULT_PROSE } from "./help.ts";
import {
  runInit,
  printNextSteps,
  buildInitReport,
  printInstallSteps,
  providerRuntimeExistenceReport,
  deliverySurfaceL1Report,
} from "../init.ts";
import {
  ensureDocBranch,
  formatBaselineCheckoutReport,
  formatDocBranchReport,
  landingBaselineEstablishedNow,
  moveCheckoutOntoLandingBaseline,
} from "../branch-model.ts";
import type { CliCtx } from "./context.ts";

/**
 * Every option the `quay init` surface DECLARES. ⛔ This is the allowlist the retired-option guard
 * checks argv against — it is what makes "unrecognized option" a real judgment rather than a list of
 * known-bad spellings (硬规则 13's shape: enumerate what IS allowed, not what is not). `h`/`help` are
 * here because the help arm reads them off the same flag bag.
 */
const KNOWN_INIT_FLAGS: ReadonlySet<string> = new Set([
  "help",
  "h",
  "root",
  "dry-run",
  "drop-incompatible",
  "adopt-branch-model",
  "branch-model-only",
  "doc-branch-name",
  "project",
  "plugin-root",
  "json",
  "format",
  // AC-331 — the PROJECT-DERIVED `loop:` values the shipped shell entry used to supply.
  "repo-root",
  "test-command",
  "tmux-session",
  "worktree-root",
  // AC-331 — the optional post-write auto-commit of the closed-set paths.
  "auto-commit-config",
  "auto-commit-confirm",
  "auto-commit-skip",
]);

// DIR-098: quay init — scaffold a new workspace (.quay/config.yml + tasks/ dir).
// Does NOT require an existing config (loadConfig() throws without one — that
// is the whole point of `init`). No provider connection needed.
export async function handleInit({ sub, rest }: CliCtx) {
  // Re-parse flags from [sub, ...rest] so --dry-run, --json, --project, --root are seen
  // regardless of whether they land in sub or rest.
  const { flags: initFlags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

  // --help / -h for init subcommand
  if (sub === "--help" || sub === "-h" || initFlags.help) {
    process.stdout.write(`quay init — scaffold a new quay workspace

Usage:
  quay init [--drop-incompatible] [--dry-run] [--json] [--project <name>] [--root <path>]
  quay init --branch-model-only [--adopt-branch-model] [--dry-run] [--root <path>]
  quay init --branch-model-only --doc-branch-name <name> [--dry-run] [--root <path>]

⛔ There is no overwrite flag and no reconcile selector. The STATE of the target decides:
     absent config      ⇒ write a fresh one
     parseable config   ⇒ upgrade it in place (comment-preserving, validated before write)
     unreadable config  ⇒ rebuild it from this version's defaults, preserving the broken
                           bytes beside the new file as config.yml.corrupt-<timestamp>
   Re-running init on a current project changes nothing (byte-identical, not rewritten).

Flags:
  --drop-incompatible
               When the upgraded config does not validate, delete the user values the
               validator rejects (e.g. a loop.gates naming an unregistered gate) and
               retry. Without it, such a value makes the upgrade FAIL: non-zero exit,
               the report names the offending field, and your config is left
               byte-identical. Nothing is deleted silently.
  --json       Print ONE machine-readable JSON report on stdout (the same document the MCP
               \`init\` tool returns): outcome, the keys filled/migrated/removed, warnings,
               whether the result validated, and the .quay/plugin link status. Human-facing
               progress moves to stderr so stdout stays parseable.
  --project <name>
               The project's name, used for the .quay/profiles.yml role session prefixes
               (<name>-task-worker, …). Default: the basename of the target root.
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
  --repo-root <path>
               The repo root the loop's fan-in operates on (loop.repo_root). Default: the target
               root, or the target's existing value on an upgrade.
  --test-command <cmd>
               The target project's test command (loop.test_command). Default: the target's existing
               value, else DETECTED from scripts/test.sh → package.json scripts.test → go.mod →
               Cargo.toml. When nothing can be detected the run FAILS CLOSED (exit 2, nothing
               written) rather than guessing.
  --tmux-session <name>
               Pin loop.tmux_session. Default: the target's existing value, else a BEST-EFFORT
               detection by project name; zero or several matches leave it null (tmux is optional —
               a guessed session name would make a monitor report a LIVE loop as gone).
  --worktree-root <path>
               Where per-task worktrees are created. Default: a sibling of repo_root. A root on
               tmpfs FAILS CLOSED (that is RAM, not disk).
  --auto-commit-config
               After the write, stage ONLY the closed-set paths and commit them as
               \"chore(quay-init): ...\". Without it a non-interactive run DECLINES (it never sweeps a
               working tree it did not create). --auto-commit-confirm / --auto-commit-skip are the
               shipped shell entry's spellings of the same decision.

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
  merged, comment-preserving, and validated BEFORE anything is written. An UNREADABLE
  config is rebuilt from this version's defaults with the broken bytes preserved beside
  it. There is no overwrite mode — re-running init never destroys what it did not write.

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
      "(.quay/config.yml + tasks/); run `quay init --help` for its flags.\n" +
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

  // ── The RETIRED-OPTION guard (AC-330) ───────────────────────────────────────────────────────────
  // `quay init` used to offer an overwrite mode and a reconcile selector; GOAL-029 (人 2026-10-07)
  // removed both, because the target's STATE now decides everything and a second mode is exactly the
  // drift this change exists to remove. A caller that still passes one must be TOLD, not silently
  // obeyed with different semantics (硬规则 3b: "I did something else" must not look like success).
  //
  // ⛔ The rejected names are read off the parsed argv, never spelled out below: the check is
  // "every option is one this surface declares", which stays true for the NEXT retirement too.
  const unknownFlags = Object.keys(initFlags).filter((k) => !KNOWN_INIT_FLAGS.has(k));
  if (unknownFlags.length > 0) {
    console.error(
      `quay init: unrecognized option${unknownFlags.length > 1 ? "s" : ""}: ` +
      unknownFlags.map((k) => `--${k}`).join(", ") + "\n" +
      "The state of the target decides what init does — an absent config is written, a parseable\n" +
      "one is upgraded in place, an unreadable one is rebuilt with the broken bytes preserved\n" +
      "beside it. There is no overwrite mode and no reconcile selector any more; re-run without\n" +
      "the option (plain `quay init` already upgrades an existing config).\n" +
      "Run `quay init --help` for the current surface."
    );
    process.exitCode = 1;
    return;
  }

  const jsonFlag = resolveJsonFlag(initFlags);
  if (jsonFlag === null) {
    console.error(`quay init: --format only accepts "json" (got ${JSON.stringify(initFlags.format)})`);
    process.exitCode = 1;
    return;
  }
  const json = jsonFlag.json;
  // ⛔ In `--json` mode stdout carries ONE JSON document and nothing else: every human-facing line
  // (including the plugin-link step's own reporting, which runInit does for us) goes to stderr.
  const say = json
    ? (line: string) => process.stderr.write(line + "\n")
    : (line: string) => console.log(line);

  const targetRoot = typeof initFlags.root === "string" ? initFlags.root : process.cwd();
  const dryRun = initFlags["dry-run"] === true;
  const dropIncompatible = initFlags["drop-incompatible"] === true;
  const adoptBranchModel = initFlags["adopt-branch-model"] === true;
  const branchModelOnly = initFlags["branch-model-only"] === true;
  const project = typeof initFlags.project === "string" ? initFlags.project : undefined;
  // The plugin root THIS run executes from — threaded so the upgrade can resolve the native binding
  // and refresh `<root>/.quay/plugin` AFTER the config write. ⛔ Never a registry lookup (the link
  // names the plugin root that is actually running — see init.ts's own ruling). Unset ⇒ the link
  // step is skipped here; the shell's own step still owns it until AC-331.
  const pluginRoot = typeof initFlags["plugin-root"] === "string"
    ? initFlags["plugin-root"]
    : typeof process.env.CLAUDE_PLUGIN_ROOT === "string" && process.env.CLAUDE_PLUGIN_ROOT !== ""
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

  // ── AC-331: the project-derived `loop:` values + the optional auto-commit ────────────────────────
  // Explicit flags win; absent ⇒ the target's existing value, else detection / the documented default
  // (all four resolutions live in init.ts, one implementation).
  const repoRoot = typeof initFlags["repo-root"] === "string" ? initFlags["repo-root"] : undefined;
  const testCommand = typeof initFlags["test-command"] === "string" ? initFlags["test-command"] : undefined;
  const tmuxSession = typeof initFlags["tmux-session"] === "string" ? initFlags["tmux-session"] : undefined;
  const worktreeRoot = typeof initFlags["worktree-root"] === "string" ? initFlags["worktree-root"] : undefined;
  // `--auto-commit-config` is the canonical name; the shipped shell entry's `--auto-commit-confirm` /
  // `--auto-commit-skip` are accepted as the SAME decision, so the two surfaces take the same inputs.
  const autoCommitConfig: "yes" | "no" | "prompt" =
    initFlags["auto-commit-config"] === true || initFlags["auto-commit-confirm"] === true
      ? "yes"
      : initFlags["auto-commit-skip"] === true
        ? "no"
        : "prompt";

  // The post-init runtime-existence check (ported from the retired shell entry — see
  // `providerRuntimeExistenceReport`). Emitted on EVERY successful arm so the reading is never
  // "absent because this branch forgot it"; a failure exits 2 (the shell entry's `|| exit 2`), so a
  // config that binds a runtime that is not there is not reported as a clean init.
  const verifyRuntime = (configPath: string): void => {
    // The retired shell entry ran the L1 delivery-surface check FIRST, then the runtime-existence
    // check, and exited 2 if either failed. Both are ported (see `deliverySurfaceL1Report` /
    // `providerRuntimeExistenceReport`), and the order and the exit code are unchanged.
    const l1 = deliverySurfaceL1Report(pluginRoot);
    for (const line of l1.lines) say(line);
    for (const err of l1.errors) console.error(err);
    const v = providerRuntimeExistenceReport(configPath, pluginRoot, { dryRun });
    for (const line of v.lines) say(line);
    for (const err of v.errors) console.error(err);
    if (!l1.ok || !v.ok) process.exitCode = 2;
  };

  try {
    // The closed set this run is responsible for — printed up front so the report's own lines have a
    // referent (the shipped shell entry's banner).
    if (!json && !branchModelOnly) {
      say("  closed set: .quay/config.yml, .quay/profiles.yml, tasks/, goals/, .gitignore, .claude/launch.settings.json, .claude/settings.json");
    }
    const result = runInit({
      root: targetRoot,
      dryRun,
      dropIncompatible,
      pluginRoot,
      adoptBranchModel,
      branchModelOnly,
      project,
      log: say,
      repoRoot,
      testCommand,
      tmuxSession,
      worktreeRoot,
      autoCommitConfig,
      // The doc-branch NAME, when the caller gave one. Absent ⇒ `runInit` resolves the target's
      // `loop.doc_branch`, else the `author` convention (the retired shell entry's own precedence).
      docBranchName,
      // AC-331: the CLI must lay the WHOLE closed set alone, and the `.quay/plugin` link is part of it.
      // The fresh arm (no existing link) may therefore point at a source checkout; an existing link is
      // still left untouched and reported NOT-EVALUATED (the 2026-10-06 ruling). See runInit.
      allowSourceCheckoutLink: true,
    });

    // The ONE report (AC-330): `--json` prints exactly this, and the MCP `init` tool returns it
    // verbatim. Emitting it BEFORE the human branches (each of which returns early) is what makes the
    // two surfaces the same document rather than two renderings that must be kept in step by hand.
    if (json) {
      process.stdout.write(JSON.stringify(buildInitReport(result, { dryRun }), null, 2) + "\n");
    }

    // The BRANCH MODEL and the DOC-branch bootstrap are the FIRST step of every shipped init — the
    // retired shell entry ran them (as `quay init --branch-model-only …`) before its closed-set
    // write — so their verdicts are reported ONCE here, ahead of whatever the config arm does. Doing
    // it in one place is also what makes the reading present on arms that return early (a refused
    // upgrade still has to answer "was my baseline judged?").
    //
    // ⛔ The blocked arms report their own: they must ALSO name the consequence and set the exit
    // code, and `branch-model-blocked` prints its verdict on stdout where this would double it.
    if (
      result.outcome !== "branch-model-only" &&
      result.outcome !== "branch-model-blocked" &&
      result.outcome !== "doc-branch-blocked" &&
      result.branchModelReport
    ) {
      say(result.branchModelReport);
      if (result.baselineCheckoutReport) say(result.baselineCheckoutReport);
      if (result.docBranchReport) say(result.docBranchReport);
    }

    // The config-free branch-model entry (gap-upgrade-entry-never-establishes-branch-model). It
    // reports the model and decides, nothing else — so the only outcomes it can reach are this one
    // and the shared error path below.
    if (result.outcome === "branch-model-only") {
      say(result.branchModelReport);
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
        say(formatBaselineCheckoutReport(checkout));
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
      say(formatDocBranchReport(docBranch));
      // Fail-closed on a real refusal (a name collision) or a failed mutation; a dry run only
      // reports, and an unreadable HEAD is NOT a failure (hard rule 3b).
      if (!docBranch.ok && !dryRun) process.exitCode = 1;
      return;
    }

    // ── AC-331: a fail-closed project-value resolution, or a mid-write abort ────────────────────────
    // Both carry the per-item closed-set state so "initialized half-way" stays distinguishable from
    // "not initialized" (硬规则 3b, write side). The real cause is printed verbatim.
    if (result.outcome === "project-values-unresolved" || result.outcome === "write-failed") {
      if (result.failureReason) console.error(`quay init: ${result.failureReason}`);
      for (const d of result.failureDetail ?? []) console.error(`  ${d}`);
      if (result.closedSetState) {
        console.error("quay-init FAILED — closed-set write state:");
        for (const e of result.closedSetState) console.error(`  ${e.state}: ${e.item}`);
      }
      process.exitCode = result.outcome === "project-values-unresolved" ? 2 : 1;
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
        `.quay/config.yml already exists at ${result.configPath} and was not upgraded. Re-run init.`
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
      // The VERSION-LEVEL reconcile's own line — the same wording the shell entry's `reconcile-config`
      // step emits (one vocabulary for one judgment), so an operator re-running on either surface
      // reads the same sentence.
      const reconcileKeys = [...(r?.added ?? []).map((k) => `loop.${k}`), ...(r?.migrated ?? []).map((m) => `loop.${m}`)];
      if (result.outcome === "unchanged") {
        say("  unchanged: .quay/config.yml (already current for this version of quay — version-level defaults present, not rewritten)");
      } else if (dryRun) {
        if (reconcileKeys.length > 0) say(`  would-reconcile: .quay/config.yml (${reconcileKeys.join(", ")})`);
      } else if (reconcileKeys.length > 0) {
        say(`  reconciled: .quay/config.yml version-level defaults (${reconcileKeys.join(", ")}); comments and every other key preserved`);
      }
      if (result.outcome === "unchanged") {
        say(`${result.configPath}: already current for this version of quay — not rewritten.`);
      } else {
        say(`${result.configPath}: ${dryRun ? "would be upgraded to" : "upgraded to"} this version's defaults.`);
        for (const k of r?.added ?? []) say(`  ${dryRun ? "would-fill" : "filled"} loop.${k} (was absent)`);
        for (const m of r?.migrated ?? []) say(`  ${dryRun ? "would-migrate" : "migrated"} loop.${m}`);
        for (const k of r?.removed ?? []) say(`  ${dryRun ? "would-remove" : "removed"} ${k} (retired key)`);
        for (const k of r?.pinned ?? []) say(`  ${dryRun ? "would-pin" : "pinned"} providers.native.env.${k} (carrier dir pin)`);
        for (const k of r?.dropped ?? []) say(`  dropped ${k} (--drop-incompatible: it did not validate)`);
      }
      for (const k of r?.projectValues ?? []) say(`  ${dryRun ? "would-update" : "updated"} loop.${k} (project-derived value)`);
      for (const k of r?.unknownKeys ?? []) {
        console.error(`  warning: unrecognized top-level config key "${k}" — kept as-is (not deleted)`);
      }
      if (dryRun && result.outcome === "reconciled") say("# Dry run — nothing written to disk.");
      verifyRuntime(result.configPath);
      if (result.autoCommit) {
        const sink = json || result.autoCommit.state === "declined" ? process.stderr : process.stdout;
        sink.write(`  auto-commit: ${result.autoCommit.detail}\n`);
      }
      return;
    }

    if (result.outcome === "doc-branch-blocked") {
      // The doc-branch bootstrap refused (a name collision with a branch unrelated to the landing
      // baseline, or a checkout that could not be moved onto it). Its own report carries the detail;
      // this arm names the consequence. NOTHING was written — the bootstrap runs before any write.
      console.error(result.docBranchReport ?? "");
      console.error("");
      console.error("ERROR: quay init REFUSES to establish the doc-only work branch — the requested name");
      console.error("       is already taken by a branch unrelated to the landing baseline 'develop'.");
      console.error("       NOTHING WAS MOVED (no branch created, HEAD not switched, config untouched).");
      console.error("       Re-run with a different name: --doc-branch-name <other-name>.");
      if (result.failureReason) console.error(`       detail: ${result.failureReason}`);
      process.exitCode = 1;
      return;
    }

    if (result.outcome === "branch-model-blocked") {
      // Fail-closed, tree untouched: the project's landing baseline is a foreign line and silently
      // reusing it would make every task's anti-drift diff meaningless. Nothing was written. The
      // verdict goes to STDOUT and the consequence to stderr — the retired shell entry's split, kept
      // so a caller reading either stream sees the same thing it always did.
      say(result.branchModelReport);
      console.error("");
      console.error("ERROR: quay init REFUSES to upgrade this project — its landing baseline is not a continuation");
      console.error("       of the project's default branch ('develop' is a foreign line), so every task would be");
      console.error("       structurally un-landable (anti-drift would diff against the whole divergent history).");
      console.error("       NOTHING WAS WRITTEN — .quay/config.yml is byte-for-byte unchanged.");
      console.error("       Re-run with the adoption decision to proceed; the existing tip is preserved under");
      console.error("       '<branch>-pre-quay-init-<sha>' and NOTHING is destroyed:");
      console.error("           quay init --root <root> --adopt-branch-model <same flags as before>");
      process.exitCode = 1;
      return;
    }

    if (result.outcome === "dry-run") {
      say(result.content);
      say(`\n# Dry run — nothing written to disk.`);
      // The corrupt plan is not the same as the fresh plan: a real run would PRESERVE the bytes that
      // could not be parsed, so the plan says where. A dry run that omitted this would understate
      // what the real run does (and a rebuild that dropped the file silently is exactly the failure
      // the backup exists to prevent).
      if (result.corruptBackupPath) {
        say(`# Would back up the unreadable .quay/config.yml to: ${result.corruptBackupPath}`);
        say(`# Would rebuild it from this version's defaults (the old file's project values are NOT carried over).`);
      }
      say(`# Would create: ${result.configPath}`);
      say(`# Would create: ${result.tasksDir}/`);
      say(`# Would create: ${result.launchSettingsPath}`);
      say(`# Would create: ${result.profilesPath}`);
      verifyRuntime(result.configPath);
      say(`  auto-commit: SKIP (--dry-run — nothing was written)`);
      if (!json) say(printInstallSteps());
      return;
    }

    if (result.outcome === "rebuilt") {
      // A corrupt config was salvaged: the bytes are preserved and the config regenerated. Reporting
      // the cause, the backup location and the LOST project values makes the salvage auditable — a
      // silent rebuild would destroy the user's own settings with no trace of what they were.
      say(`${result.configPath}: rebuilt from this version's defaults.`);
      say(`  the previous file could not be read as a config: ${result.corruptReason}`);
      if (result.corruptBackupPath) {
        say(`  its bytes were preserved at ${result.corruptBackupPath} (byte-identical)`);
      }
      console.error(
        "warning: the rebuilt config carries THIS VERSION's defaults, not the old file's project " +
        "values (e.g. a pinned serve binding, loop.test_command, loop.gates). Compare it with the " +
        `backup${result.corruptBackupPath ? ` at ${result.corruptBackupPath}` : ""} and re-apply what you need.`
      );
    } else {
      say(`Created ${result.configPath}`);
    }
    say(`Created ${result.tasksDir}/ (or already existed)`);
    say(`Created ${result.launchSettingsPath}`);
    say(`Created ${result.profilesPath}`);
    verifyRuntime(result.configPath);
    // ── AC-331: the fresh install's own reporting ───────────────────────────────────────────────
    // The auto-commit reading is enumerated (committed / skipped / declined / not-a-repo) and its
    // detail line names WHAT happened — a decline goes to stderr (the shipped shell entry's own
    // channel) so a script reading stdout never mistakes "declined" for "committed".
    if (result.autoCommit) {
      const sink = json || result.autoCommit.state === "declined" ? process.stderr : process.stdout;
      sink.write(`  auto-commit: ${result.autoCommit.detail}\n`);
    }
    if (result.installSteps && !json) say(result.installSteps);
    if (!json) printNextSteps("native", result.tasksDir);
  } catch (err) {
    console.error(`quay init: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
  return;
}
