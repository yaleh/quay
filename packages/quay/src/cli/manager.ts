// cli/manager.ts — `quay manager start` / `arm` command handler (`adopt` retired with the outer tmux session).
// Migrated verbatim from packages/quay/bin/quay.ts dispatch body by
// gap-cli-import-command-migration-into-src. No behavior change.
//
// NOTE on plugin-script resolution: the plugin scripts dir is resolved via the canonical
// plugin-root.ts resolver (SPEC §6b) — NOT a workspace-root join (AC168 removes the copy) and NOT
// an import.meta.url walk-up without a worktree check (AC139-4's carrier-death root cause).

import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseFlags } from "./shared.ts";
import { resolvePluginScript } from "../plugin-root.ts";
import type { CliCtx } from "./context.ts";

// ── manager commands (C1-C5, gap-manager-productization-five-constraints) ─────────────────────────
// `quay manager start` / `arm`. (`adopt <root>` was retired with the outer tmux session —
// gap-retire-outer-tmux-window-logic.) The manager is a plugin-layer product
// component: the CLI locates the plugin scripts (plugin/scripts/manager-*.sh) relative to this
// package's own root (the plugin ships under the repo root's plugin/ dir, and the npm pack's
// `files` includes `plugin`). Dispatches to the plugin scripts — the manager implementation lives
// in plugin/, not in Core (build ownership = outer/inner; SPEC-manager-productization §3).
export async function handleManager({ sub, rest, positional }: CliCtx) {
  const { flags: mgrFlags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

  if (sub === "--help" || sub === "-h" || mgrFlags.help) {
    process.stdout.write(`quay manager — start/arm the manager layer (C4/C5)

Usage:
  quay manager start                 Start the manager independently (no project args; C5)
  quay manager arm                   (re)arm the manager loop anchor (sentinel-idempotent; AC5/AC5c)

Flags:
  --dry-run            Print the plan without changing anything (start/arm)
  --json               Machine-readable output
  --verify             (arm) externally verify the loop-registry carries a fresh CronCreate receipt (AC4)

The manager is CROSS-PROJECT (SPEC-manager-productization C2): its session (quay-manager), home
(\$QUAY_GLOBAL_DIR/manager/) and loop anchor belong to no single project. 'adopt <root>' was retired
with the outer tmux session (gap-retire-outer-tmux-window-logic): the per-project outer session it
adopted no longer exists as an independent role.
`);
    return;
  }

  // Locate the plugin scripts via the canonical resolver (SPEC §6b). The env override (hermetic
  // tests) still wins; otherwise resolve from the plugin root — never the workspace root (AC168)
  // and never a worktree copy (AC139-4).
  const resolveManagerScript = (name: string): string | null => {
    if (process.env.QUAY_MANAGER_SCRIPTS_DIR) {
      return path.join(process.env.QUAY_MANAGER_SCRIPTS_DIR, name);
    }
    return resolvePluginScript(path.join("scripts", name));
  };
  const managerStart = resolveManagerScript("manager-start.sh");
  const managerArm = resolveManagerScript("manager-arm-loop.sh");

  const runManagerScript = (script: string | null, args: string[]): number => {
    if (script == null) {
      console.error("quay manager: plugin script not found — plugin-root resolution failed (manager layer not installed, SPEC §6b)");
      return 1;
    }
    const r = spawnSync("bash", [script, ...args], { encoding: "utf8" });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status ?? 1;
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
  if (sub === "arm") {
    const args = [];
    if (mgrFlags["dry-run"]) args.push("--dry-run");
    if (mgrFlags.json) args.push("--json");
    if (mgrFlags.verify) args.push("--verify");
    process.exitCode = runManagerScript(managerArm, args) ?? 1;
    return;
  }
  console.error(`unknown manager subcommand: ${sub} (try: start, arm)`);
  process.exitCode = 1;
  return;
}
