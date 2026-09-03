// cli/manager.ts — `quay manager start` / `adopt` / `arm` command handler.
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.
//
// NOTE on `import.meta.url` semantics: this module sits one directory deeper
// than bin/quay.ts did (src/cli/ vs bin/), but the plugin-scripts walk-up below
// still reaches the repo-root `plugin/scripts` within its 6-iteration bound
// (src/cli → src → packages/quay → packages → repo-root, ~5 hops), and in the
// bundled dist the same relative geometry holds from dist/quay.js.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseFlags, fsSyncExists } from "./shared.ts";
import type { CliCtx } from "./context.ts";

// ── manager commands (C1-C5, gap-manager-productization-five-constraints) ─────────────────────────
// `quay manager start` / `quay manager adopt <root>`. The manager is a plugin-layer product
// component: the CLI locates the plugin scripts (plugin/scripts/manager-*.sh) relative to this
// package's own root (the plugin ships under the repo root's plugin/ dir, and the npm pack's
// `files` includes `plugin`). Dispatches to the plugin scripts — the manager implementation lives
// in plugin/, not in Core (build ownership = outer/inner; SPEC-manager-productization §3).
export async function handleManager({ sub, rest, positional }: CliCtx) {
  const { flags: mgrFlags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

  if (sub === "--help" || sub === "-h" || mgrFlags.help) {
    process.stdout.write(`quay manager — start/adopt the manager layer (C4/C5)

Usage:
  quay manager start                 Start the manager independently (no project args; C5)
  quay manager adopt <root>          Adopt a project (three-state: healthy/empty-shell/missing)
  quay manager arm                   (re)arm the manager loop anchor (sentinel-idempotent; AC5/AC5c)

Flags:
  --dry-run            Print the plan without changing anything (start/adopt/arm)
  --json               Machine-readable output
  --verify             (arm) externally verify the loop-registry carries a fresh CronCreate receipt (AC4)

The manager is CROSS-PROJECT (SPEC-manager-productization C2): its session (quay-manager), home
(\$QUAY_GLOBAL_DIR/manager/) and loop anchor belong to no single project. 'start' and 'adopt' are
separate commands on purpose (C5: two commands, not one parameterised command).
`);
    return;
  }

  // Locate the plugin scripts dir. Walk upward from this file looking for a dir that contains
  // manager-start.sh — works in the dev tree (repo-root/plugin/scripts), the npm-pack root
  // (plugin/ shipped under the pack root), and the vendored plugin bundle (plugin/scripts at the
  // plugin root). Env override for hermetic tests.
  const scriptsDir = (() => {
    if (process.env.QUAY_MANAGER_SCRIPTS_DIR) return process.env.QUAY_MANAGER_SCRIPTS_DIR;
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      for (const rel of [path.join("plugin", "scripts"), "scripts"]) {
        const cand = path.join(dir, rel);
        if (fsSyncExists(path.join(cand, "manager-start.sh"))) return cand;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return path.resolve(dir, "plugin", "scripts");
  })();
  const managerStart = path.join(scriptsDir, "manager-start.sh");
  const managerAdopt = path.join(scriptsDir, "manager-adopt.sh");
  const managerArm = path.join(scriptsDir, "manager-arm-loop.sh");

  const runManagerScript = (script, args) => {
    const r = spawnSync("bash", [script, ...args], { encoding: "utf8" });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status;
  };

  if (sub === "start") {
    // C5: start 与 adopt 分开——`quay manager start` 不接受任何项目参数。CLI 层即拒绝，
    // 不把多余位置参数静默吞掉（脚本层也拒绝，双层防漏）。
    if (positional.length > 0) {
      console.error(`quay manager start: accepts NO project args (C5: 'start' ≠ 'adopt <root>') — unexpected: ${positional.join(" ")}`);
      process.exitCode = 1;
      return;
    }
    const args = [];
    if (mgrFlags["dry-run"]) args.push("--dry-run");
    if (mgrFlags.json) args.push("--json");
    process.exitCode = runManagerScript(managerStart, args) ?? 1;
    return;
  }
  if (sub === "adopt") {
    const root = positional[0];
    if (!root) {
      console.error("quay manager adopt: missing required <root> (the project root to adopt)");
      process.exitCode = 1;
      return;
    }
    const args = [root];
    if (mgrFlags["dry-run"]) args.push("--dry-run");
    if (mgrFlags.json) args.push("--json");
    process.exitCode = runManagerScript(managerAdopt, args) ?? 1;
    return;
  }
  if (sub === "arm") {
    const args = [];
    if (mgrFlags["dry-run"]) args.push("--dry-run");
    if (mgrFlags.json) args.push("--json");
    if (mgrFlags.verify) args.push("--verify");
    process.exitCode = runManagerScript(managerArm, args) ?? 1;
    return;
  }
  console.error(`unknown manager subcommand: ${sub} (try: start, adopt <root>, arm)`);
  process.exitCode = 1;
  return;
}
