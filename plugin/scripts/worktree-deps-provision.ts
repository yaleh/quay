#!/usr/bin/env node
// worktree-deps-provision.ts — the TASK-worktree `node_modules` step (present / package-manager
// install / symlink / npm fallback), as a thin plugin CLI over the SHARED judgment + provisioning in
// packages/quay/src/worktree-deps.ts. ⛔ ONE implementation, two callers: the goal path
// (packages/quay/src/goal-preview.ts `ensureWorktreeNodeModules`) imports the SAME module.
//
// WHY a CLI: `dispatch-worktree-setup.sh` is bash and cannot import the TS judgment; this is the
// boundary. The shell side reaches it through the thin entry
// plugin/scripts/worktree-deps-provision.sh (the house `exec node --experimental-strip-types` form,
// so the plugin-dist rewriter can bundle it) — the .sh stays a pure-bash orchestrator and does NOT
// itself gain an embedded interpreter (the sh-census ratchet is at zero slack).
//
// Usage:
//   node --experimental-strip-types worktree-deps-provision.ts <worktree> --root <main> [--dry-run]
//
//   <worktree>   the freshly created task worktree (REQUIRED)
//   --root <m>   the main checkout whose `.quay/config.yml` declares loop.worktree_deps_install
//                (REQUIRED)
//   --dry-run    print the plan, create/run nothing
//   --help       usage, exit 0
//
// Exit: 0 = provisioned (or already-provisioned / dry-run); 2 = usage error OR a failed install —
//       FAIL-CLOSED (⛔ never a silent symlink that lets the suite die in milliseconds, hard rule 3b).

import { helpExit, flagValue, isDirectEntry } from "./gate-script-base.ts";
import {
  provisionWorktreeDeps,
  readDeclaredWorktreeDepsInstall,
  type WorktreeDepsReading,
} from "../../packages/quay/src/worktree-deps.ts";

const USAGE = `worktree-deps-provision.ts — make a freshly created task worktree's node_modules present.

Usage:
  node --experimental-strip-types worktree-deps-provision.ts <worktree> --root <main> [--dry-run]

  <worktree>   the freshly created task worktree (REQUIRED)
  --root <m>   the main checkout (REQUIRED; its .quay/config.yml may declare loop.worktree_deps_install)
  --dry-run    print the plan, create/run nothing
  --help       usage, exit 0

Order: existing entry kept > declared install command > pnpm-detected install command > symlink the
main checkout's node_modules > bare-clone npm install. An install that fails (non-zero, or no
node_modules produced) exits 2 and names the cause.`;

/** Print the reading on the streams the pre-existing .sh used (stdout for progress, stderr for a
 *  failure), so `dispatch-worktree-setup.sh`'s callers see the same shape they always did. */
function render(r: WorktreeDepsReading, mainRoot: string, worktree: string): void {
  switch (r.state) {
    case "present":
      console.log(`dispatch-worktree-setup: node_modules already present, keeping: ${r.nodeModulesPath}`);
      return;
    case "linked":
      console.log(`dispatch-worktree-setup: linked ${r.target} -> ${r.nodeModulesPath}`);
      return;
    case "installed":
      if (r.decision !== null) {
        // pnpm (or a declared command): the install ran INSIDE the worktree, no symlink.
        console.log(`dispatch-worktree-setup: ${r.decision} project — installing deps in ${worktree} (${r.command})`);
        console.log(`dispatch-worktree-setup: install done — ${r.nodeModulesPath}`);
      } else {
        console.log(`dispatch-worktree-setup: main ${mainRoot} has no node_modules — npm install in ${worktree}...`);
        console.log(`dispatch-worktree-setup: npm install done — ${r.nodeModulesPath}`);
      }
      return;
    case "dry-run":
      console.log(`dispatch-worktree-setup: [dry-run] ${r.reason}`);
      return;
    case "failed":
      process.stderr.write(`dispatch-worktree-setup: ${r.reason}\n`);
      return;
  }
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(USAGE);
  const dryRun = args.includes("--dry-run");
  const mainRoot = flagValue(args, "--root");
  const worktree = args.find((a) => !a.startsWith("--") && a !== mainRoot);
  if (!worktree) {
    process.stderr.write("worktree-deps-provision: worktree path is required\n");
    return 2;
  }
  if (!mainRoot) {
    process.stderr.write("worktree-deps-provision: --root <main> is required\n");
    return 2;
  }
  const declaredInstall = readDeclaredWorktreeDepsInstall(mainRoot);
  const reading = provisionWorktreeDeps({ mainRoot, worktreeRoot: worktree, declaredInstall, dryRun });
  render(reading, mainRoot, worktree);
  return reading.state === "failed" ? 2 : 0;
}

if (isDirectEntry(import.meta, undefined, "worktree-deps-provision")) {
  process.exit(main(process.argv));
}
