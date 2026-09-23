// plugin/scripts/loop-complete-task.ts — the loop's completion path AS the gate engine
// (gap-loop-completion-path-produces-zero-gateevents).
//
// PROBLEM IT FIXES: the loop completed tasks by writing `status: ready → done` into
// `tasks/<id>.md` directly (outer 1b "翻 done"), which bypassed the QENG gate engine —
// so a loop-completed task produced ZERO GateEvents ("meter is runnable, not asserted"
// was violated: the loop flipped status without ever running the meter). Same-workspace
// CLI path (`quay complete`) wrote dod/promote/acceptance/complete events; the loop path
// wrote none (gate-events.jsonl didn't even exist on ad-arm1/archguard TASK-81).
//
// WHAT IT DOES: the mechanical ready→done completion the outer 1b calls instead of the
// direct file write. It routes the flip through QENG-3 `runCompleteLoop` (lifecycle.ts) —
// the SAME gate engine the CLI uses (runGate + appendGateEvent + CAS taskWrite) — and
// records a `complete` pass GateEvent to `<workspaceRoot>/.quay/gate-events.jsonl`,
// readable via `quay gate-log <task>`. The outer still does the AC/DoD verification
// ("勾得上就勾、勾不上写理由或留 ready") BEFORE calling this script; this script is the
// mechanical completion + meter-record, not the AC judge.
//
// Package imports are DYNAMIC (pathToFileURL) — the same pattern config-wiring-check.ts
// uses — so the plugin's `build-plugin-dist` esbuild bundle does NOT try to resolve
// `../../packages/...` (the plugin bundle is staged WITHOUT the packages/ tree).
//
// Usage:
//   node --no-warnings --experimental-strip-types plugin/scripts/loop-complete-task.ts \
//     --root <repo-root> --task <id> [--verified-by "<evidence>"] [--actor <actor>]
//
// Exit: 0 = completed (status done + complete pass event written); 1 = not completed
// (non-ready task, or an acceptance meter that failed); 2 = usage error.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// AC47 (gap-ac47-completion-predicate-consumer-fail-closed, AC4): the flip-done path's AC/DoD
// section-recognition consumer — the same shape-aware completion counter the pool/slot-refill use
// (single source, never a parallel copy). A plugin→plugin static import (ready-pool-check imports no
// packages/ tree), so the esbuild plugin bundle resolves it fine.
import { countCompletionCheckboxes } from "./ready-pool-check.ts";
import { repoRoot as moduleRepoRoot } from "./repo-root.ts";

const repoRoot = moduleRepoRoot();

function usage() {
  process.stderr.write(
    "Usage: loop-complete-task.ts --root <repo-root> --task <id> [--verified-by <evidence>] [--actor <actor>]\n"
  );
}

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  let root = process.cwd();
  let id: string | null = null;
  let verifiedBy: string | undefined;
  let actor: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { root = args[++i]; continue; }
    if (args[i] === "--task") { id = args[++i]; continue; }
    if (args[i] === "--verified-by") { verifiedBy = args[++i]; continue; }
    if (args[i] === "--actor") { actor = args[++i]; continue; }
  }
  if (!id) {
    usage();
    return 2;
  }

  const { loadConfig, activeProvider } = await import(
    pathToFileURL(path.join(repoRoot, "packages/quay/src/config.ts")).href
  );
  const { createStore } = await import(
    pathToFileURL(path.join(repoRoot, "packages/quay-native/src/store.ts")).href
  );
  const { runCompleteLoop } = await import(
    pathToFileURL(path.join(repoRoot, "packages/quay/src/gate/lifecycle.ts")).href
  );
  const { DEFAULT_GATE_LOG_RELATIVE_PATH } = await import(
    pathToFileURL(path.join(repoRoot, "packages/quay/src/gate/gate-log.ts")).href
  );

  const loaded = loadConfig(root);
  const { workspaceRoot } = loaded;
  let tasksDir: string | null = null;
  try {
    // activeProvider reads cfg.config.providers — pass the FULL loadConfig result.
    const provider = activeProvider(loaded, "native");
    if (provider.tasks_dir) tasksDir = path.resolve(workspaceRoot, provider.tasks_dir);
  } catch {
    // no native provider declared — fall back to the default `<root>/tasks` layout
    tasksDir = null;
  }
  if (!tasksDir) tasksDir = path.join(workspaceRoot, "tasks");

  const store = createStore(tasksDir);
  const client = {
    taskGet: async (tid: string) => store.get(tid),
    taskWrite: async ({ id: tid, status, expectedStatus }: { id: string; status: string; expectedStatus: string }) =>
      store.write(tid, { status, expectedStatus }),
    taskCheck: async (tid: string) => store.check(tid),
  };

  const logPath = path.join(workspaceRoot, DEFAULT_GATE_LOG_RELATIVE_PATH);
  // AC47 (gap-ac47-completion-predicate-consumer-fail-closed, AC4): the inner flip-done gate must NOT
  // silently pass a task whose AC/DoD section it cannot READ. Before running the QENG complete loop,
  // verify the task's AC/DoD sections are RECOGNIZED (sectionFound) — an ABSENT/UNREGISTERED section
  // (e.g. `## Acceptance Criteria (runnable — …)` before AC3 registration) would otherwise be judged
  // complete with its unchecked boxes unseen. sectionFound:false ⇒ REFUSE the flip-done and report
  // "AC/DoD 段未识别" (fail-closed, not a silent pass). The checkbox-completeness judgment itself
  // stays the caller's (the outer 1b "勾得上就勾、勾不上写理由或留 ready" before invoking this
  // script) — this check is the "can we even READ the AC/DoD" safety net, not a re-judge.
  const existing = await store.get(id);
  if (existing?.body) {
    const { sectionFound } = countCompletionCheckboxes(existing.body);
    if (!sectionFound) {
      process.stderr.write(
        `REFUSE flip done for ${id}: AC/DoD 段未识别 (sectionFound=false — no recognizable AC/DoD section)\n`
      );
      return 1;
    }
  }
  const r = await runCompleteLoop({ client, id, logPath, actor: actor ?? "quay-loop", workspaceRoot, verifiedBy });
  // runCompleteLoop sets process.exitCode for CLI backward-compat; reset it so a
  // long-running parent (outer session) isn't polluted, and use the returned field.
  process.exitCode = 0;
  return r.exitCode;
}

// ── entry ─────────────────────────────────────────────────────────────────────────
// Only run as the entry module (not when imported by a test). Mirrors the other
// plugin scripts' `main()` gate so the module is importable for unit tests.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then(
    (code) => { process.exitCode = code; },
    (err) => {
      console.error(String(err?.stack ?? err));
      process.exitCode = 1;
    }
  );
}
