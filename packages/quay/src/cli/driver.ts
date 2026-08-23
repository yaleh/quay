// cli/driver.ts — `quay driver <start|stop|drain|status|restart> --kind <promotion|worker>` handler.
// (tasks/gap-ac139-unified-driver-subcommand)
//
// AC139: the two drivers' launch surface converges onto ONE `quay` subcommand that delegates to a
// single generalized supervisor (plugin/scripts/promotion-driver-launch.sh). The supervisor itself
// owns the respawn loop and the per-kind registry table; this CLI handler is a THIN layer (same
// shape as cli/manager.ts's spawnSync delegate) that:
//   - validates the verb + --kind
//   - resolves the carrier/entry path from the WORKSPACE ROOT (AC139-4, see below)
//   - rejects a worktree root (AC139-4)
//   - spawnSync's the supervisor script with the same argv
//
// ⛔ AC139-4 (承载路径显式从 workspace root 解析, 拒绝 worktree): this is NOT the manager.ts
//   import.meta.url walk-up. That walk-up finds the *worktree copy* of plugin/scripts when the CLI
//   is invoked from a worktree — the exact 2026-08-23 carrier-death cause (resident supervisor
//   hanging on a short-lived worktree). Here the launch-script path is resolved from the workspace
//   root (discovered via .quay/config.yml or --root), and a worktree root is REJECTED — not
//   relocated, not silently started (relocation is the supervisor script's own second-layer
//   defense for direct script invocation; the CLI entry is the first layer).

import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { parseFlags, fsSyncExists } from "./flags.ts";
import { findConfig } from "../config.ts";
import type { CliCtx } from "./context.ts";

const VERBS = ["start", "stop", "drain", "status", "restart"];
const KINDS = ["promotion", "worker"];
const LAUNCH_SCRIPT_REL = path.join("plugin", "scripts", "promotion-driver-launch.sh");

/** Resolve the workspace root from `--root` (walk-up) or the process cwd; null when no config. */
function resolveRoot(rootFlag: string | undefined): string | null {
  const startDir =
    typeof rootFlag === "string" && rootFlag.trim() !== "" ? path.resolve(rootFlag) : process.cwd();
  const configPath = findConfig(startDir);
  if (!configPath) return null;
  return path.dirname(path.dirname(configPath));
}

/** AC139-4: is `root` a git worktree (the literal quay-worktrees/ convention, or a linked worktree)? */
function isWorktreeRoot(root: string): boolean {
  // ① literal convention the AC names: a `quay-worktrees/` path.
  if (/(^|\/)quay-worktrees(\/|$)/.test(root)) return true;
  // ② git-backed: root is a LINKED worktree (any non-main entry in `git worktree list`).
  try {
    const out = execFileSync("git", ["-C", root, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
    });
    const worktrees = out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => path.resolve(l.slice("worktree ".length).trim()));
    const real = path.resolve(root);
    return worktrees.slice(1).some((w) => w === real);
  } catch {
    return false; // git unavailable / not a repo → only the path check applies
  }
}

export async function handleDriver({ sub, rest, positional }: CliCtx) {
  const { flags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

  if (sub === "--help" || sub === "-h" || flags.help) {
    process.stdout.write(`quay driver — start/stop/drain/status/restart the promotion & worker drivers (AC139)

Usage:
  quay driver <start|stop|drain|status|restart> --kind <promotion|worker> [--root <path>] [flags]

  start      Start the resident driver under the single supervisor (respawn on exit/kill/crash)
  stop       Hard stop: terminate the supervisor + driver. For worker, in-flight workers are
             NOT killed (they orphan and finish) — use drain for a graceful stop.
  drain      (worker only) Halt new dispatch WITHOUT killing in-flight workers (worker-control.json
             halted=true). promotion does NOT support drain (it has no halt mechanism) — error.
  status     Report {kind, supervisor_pid, driver_pid, alive, carrier_path, carrier_records,
             last_record_ts} — last_record_ts is the carrier's last-record timestamp (⛔ not just a
             record count, which cannot distinguish "growing" from "stalled").
  restart    stop then start.

  --kind <promotion|worker>   Required. Which driver the command targets.
  --root <path>               Workspace root (default: discovered via .quay/config.yml from cwd).

⛔ Starting from a git worktree (quay-worktrees/…) is REJECTED — the resident supervisor must be
carried from the workspace root (main checkout), not a short-lived worktree.
`);
    return;
  }

  if (!VERBS.includes(sub)) {
    console.error(`quay driver: unknown subcommand: ${sub} (try: ${VERBS.join(", ")})`);
    process.exitCode = 1;
    return;
  }
  const kind = flags.kind;
  if (!KINDS.includes(kind)) {
    console.error(`quay driver: missing/invalid --kind: ${kind ?? "<empty>"} (expected ${KINDS.join("|")})`);
    process.exitCode = 1;
    return;
  }

  // AC139-4: resolve the carrier/entry path from the workspace root (NOT import.meta walk-up).
  const root = resolveRoot(flags.root);
  if (!root) {
    console.error(
      `quay driver: no .quay/config.yml found (searched from ${flags.root ?? process.cwd()} upward). ` +
        `Run from a quay workspace root, or pass --root <workspace-root>.`
    );
    process.exitCode = 1;
    return;
  }

  // AC139-4: reject a worktree root (fail closed; never start a supervisor on a worktree).
  if (isWorktreeRoot(root)) {
    console.error(
      `quay driver: refusing to run from a git worktree (${root}). ` +
        `The resident supervisor must be carried from the workspace root (main checkout), ` +
        `not a short-lived worktree. Run from the main checkout instead.`
    );
    process.exitCode = 1;
    return;
  }

  const script = path.join(root, LAUNCH_SCRIPT_REL);
  if (!fsSyncExists(script)) {
    console.error(`quay driver: launch script not found at ${script}`);
    process.exitCode = 1;
    return;
  }

  // Forward the user's argv verbatim (rest already carries --kind/--root/--json/…), then pin
  // --root to the resolved workspace root (last-wins in the script's parser) so the script runs
  // against the same root this handler resolved — never a stale/missing one.
  const args = [sub, ...rest, "--root", root];
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.status ?? 1;
  return;
}
