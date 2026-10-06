#!/usr/bin/env node
// quay-init-steps.ts — the STEP CLI for `plugin/scripts/quay-init.sh`.
//
// WHY THIS FILE EXISTS (gap-arch-quay-init-sh-python-heredocs-to-native; SPEC-architecture-
// consolidation-ts-and-shell-2026-09-19 §5 Phase 5.1). The shell entry used to carry TWELVE
// `python3` invocations — eight `<<'PYEOF'` heredocs plus four `python3 -c` one-liners. "以 bash 为
// 壳、内嵌 python3 为实" is a program that archguard cannot analyze, has no types, and is hard to
// test. The SPEC's rule is 「把「程序」收进 TS，把「胶水」留在 bash」: the LOGIC moved to
// `packages/quay/src/init.ts` (the functions this CLI dispatches to — ONE implementation, no second
// copy), and the shell keeps the ORCHESTRATION (which step runs when, in what order, with which
// report lines).
//
// ⛔ WHY NOT MAKE THESE SUBCOMMANDS OF `quay init`. `quay init` is a PUBLIC CLI surface with its own
// flag parser and its own collision guard (`gap-cli-quay-init-collides-with-the-canonical-slash-
// quay-init`: `--loop` on the CLI is an ERROR, the canonical onboarding path is the /quay:init
// skill). Adding positional sub-verbs there would change that public surface for a need that is
// INTERNAL to one shell script. A sibling step CLI keeps the public surface untouched.
//
// HOW THE SHELL REACHES IT. `node --no-warnings --experimental-strip-types "${SCRIPT_DIR}/
// quay-init-steps.ts" <step> [args…]` — the repo-tree / marketplace-directory form. For a SHIPPED
// artifact `build-plugin-dist.mjs` bundles this file into the self-contained sibling
// `dist/quay-init-steps.js` and rewrites the shell's invocation to it (that is why `yaml` — the one
// bare import Core needs here — is resolvable there: it is inlined, not resolved at runtime).
//
// ⛔ The Core module is acquired through `core-src-import.ts`, NOT a bare relative import: the static
// literal is inlined by esbuild (so the bundle is self-contained), and the walk-up fallback covers
// the STAGED `packages/quay/plugin/scripts/` layout where the same literal points at a path that
// does not exist. See that module's header for the full ruling.
//
// EXIT CODES: 0 on every step (including "the file was unreadable, here is the empty value" — the
// shell's `$(…)` reads are total by contract); 1 only for `has-npm-test` (a boolean predicate);
// 2 for usage errors (unknown step / missing args).

import { acquireCoreSrc } from "./core-src-import.ts";

const USAGE = `usage: quay-init-steps.ts <step> [args…]

steps (each mirrors the python3 invocation it replaced in plugin/scripts/quay-init.sh):
  loop-value          <cfg> <key>
  json-field          <json-path> <field> <fallback>
  has-npm-test        <package.json>
  ensure-loop-config  <cfg> <repo_root> <test_command> <tmux_session> <worktree_root> <dry_run:true|false>
  ensure-carrier-env  <cfg> <ws_root> <dry_run:true|false>
  reconcile-config    <cfg> <dry_run:true|false>
  refresh-plugin-link <ws_root> <plugin_root> <dry_run:true|false>
  migrate-mcp-entry   <cfg> <install_provider> <install_runtime> <install_core> <ws_root> <dry_run> <backup_ts>
  derive-loop-scripts <out-file> <plugin_root> <never-laydown-names>
  provider-entry-file <cfg> [plugin-root]
  write-claude-settings <dst> <plugin_name>
`;

async function main(): Promise<void> {
  const [step, ...args] = process.argv.slice(2);
  if (!step || step === "--help" || step === "-h") {
    process.stdout.write(USAGE);
    return;
  }

  const core = await acquireCoreSrc(() => import("../../packages/quay/src/init.ts"), "init.ts");
  const need = (n: number): void => {
    if (args.length < n) {
      process.stderr.write(`quay-init-steps: '${step}' needs ${n} argument(s), got ${args.length}\n${USAGE}`);
      process.exitCode = 2;
      throw new Error("usage");
    }
  };

  switch (step) {
    case "loop-value": {
      need(2);
      process.stdout.write(core.readExistingLoopValue(args[0]!, args[1]!) + "\n");
      return;
    }
    case "json-field": {
      need(3);
      process.stdout.write(core.readJsonField(args[0]!, args[1]!, args[2]!) + "\n");
      return;
    }
    case "has-npm-test": {
      need(1);
      if (!core.hasNpmTestScript(args[0]!)) process.exitCode = 1;
      return;
    }
    case "ensure-loop-config": {
      need(6);
      core.ensureLoopConfig({
        cfgPath: args[0]!,
        repoRoot: args[1]!,
        testCommand: args[2]!,
        tmuxSession: args[3]!,
        worktreeRoot: args[4]!,
        dryRun: args[5] === "true",
      });
      return;
    }
    case "ensure-carrier-env": {
      need(3);
      core.ensureProviderCarrierEnv({ cfgPath: args[0]!, wsRoot: args[1]!, dryRun: args[2] === "true" });
      return;
    }
    case "reconcile-config": {
      need(2);
      core.reconcileConfigFile({ cfgPath: args[0]!, dryRun: args[1] === "true" });
      return;
    }
    case "refresh-plugin-link": {
      need(3);
      core.refreshProjectPluginLink({ wsRoot: args[0]!, pluginRoot: args[1] || null, dryRun: args[2] === "true" });
      return;
    }
    case "migrate-mcp-entry": {
      need(7);
      core.migrateStaleMcpEntry({
        cfgPath: args[0]!,
        installProvider: args[1]!,
        installRuntime: args[2]!,
        installCore: args[3]!,
        wsRoot: args[4]!,
        dryRun: args[5] === "true",
        backupTs: args[6]!,
      });
      return;
    }
    case "derive-loop-scripts": {
      need(3);
      core.deriveLoopScriptsClosure({ outPath: args[0]!, pluginRoot: args[1]!, neverLaydown: args[2]! });
      return;
    }
    case "provider-entry-file": {
      need(1);
      // arg 2 (optional) is the caller's already-resolved plugin root. Passing it through verbatim
      // keeps the three states distinct: absent ⇒ the reader resolves the root itself; "" ⇒ "no
      // plugin root" (NOT-EVALUATED); a path ⇒ that root.
      process.stdout.write(core.providerEntryFile(args[0]!, args[1]) + "\n");
      return;
    }
    case "write-claude-settings": {
      need(2);
      core.writeClaudeSettings(args[0]!, args[1]!);
      return;
    }
    default: {
      process.stderr.write(`quay-init-steps: unknown step '${step}'\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
  }
}

main().catch((err: unknown) => {
  if (err instanceof Error && err.message === "usage") return;
  process.stderr.write(`quay-init-steps: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
