#!/usr/bin/env node
// malformed-task-check.ts — gap-malformed-task-silent-vanish-no-alert.
//
// THE DEFECT (from the task title): a task file whose YAML frontmatter fails to
// parse is SILENTLY REMOVED from the whole task store. The ONLY signal is a
// one-line Warning on `quay task list` stdout ("N task file(s) could not be
// parsed and were excluded"), and NO checker reads that signal — so a malformed
// task is indistinguishable from "task successfully archived / not in the pool"
// on every store consumer (ready-pool-check / slot-refill / pool counts /
// `quay task edit`). Invisible ≡ non-existent (CLAUDE.md hard rule ④).
//
// Live sample (2026-08-13): `gap-touches-bare-dir-reject-outright.md`'s
// `title: [封存] bare-dir …` was parsed by YAML as a flow sequence (`[` opens,
// `]` closes, text after `]` is an "unexpected scalar") ⇒ the whole frontmatter
// failed ⇒ `quay task list` listed 1074 of 1075 .md files, slot-refill hit the
// task 0 times, and `quay task edit … --status needs-human` said "task does not
// exist yet". It looked "archived / out of the pool" when the truth was "it does
// not exist" — the two are identical in every reading.
//
// THE FIX: consume the store's OWN malformed signal — store.listWithMalformed(),
// the SAME producer the `quay task list` Warning reads — and turn a non-empty
// malformed list RED, printing each excluded file and its parser error. The
// instrument already existed; the missing piece was a consumer.
//
// COMPLEMENT to 57c30fdf (gap-serve-task-list-dies-on-one-malformed-task):
//   that fix made the WEB SERVER + `task list` tolerant — one bad file no longer
//   500s the whole list; it poisons exactly its own row and is surfaced on
//   stderr. This checker makes the SAME signal a FAILING GATE on the test suite —
//   the consumer that actually guards commits. It does NOT re-derive parsing
//   (硬规则 1: 用机件，不手搓); it reads the store's own malformed array (硬规则
//   4b: 优先观测直接量). A task-file syntax problem is a DIFFERENT risk class from
//   product-code unavailability, but unlike a Contract syntax nit it is a SILENT
//   REMOVAL — so this checker BLOCKS (exit 1), matching the defect's severity.
//
// Run:
//   node --no-warnings --experimental-strip-types malformed-task-check.ts [--root <dir>] [--selftest]
//   scripts/test.sh plugin/test/malformed-task-check.test.mjs
//
// Exit: 0 = no malformed task file; 1 = >=1 malformed (each file + error printed);
//       2 = usage/environment error. --selftest: 0 = both directions hold
//       (clean stays green, the live-sample shape goes red); non-zero = selftest
//       assertion failure (mutation-case surface, checker-mutation-check.sh).

import fs from "node:fs";
import { repoRoot } from "./repo-root.ts";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// Dynamic imports of product modules (the plugin bundle build stages plugin/scripts
// WITHOUT the packages/ tree — the same pathToFileURL pattern config-wiring-check.ts
// and loop-complete-task.ts use).
async function importStoreFactory(repoRoot) {
  return import(pathToFileURL(path.join(repoRoot, "packages/quay-native/src/store.ts")).href);
}

// ── Tasks-dir resolution (config-aware, fail-open to <root>/tasks) ─────────────────────────────────
// A fresh worktree lacks the gitignored .quay/config.yml until scripts/worktree-include.sh
// copies it; a repo with no native provider declared has no tasks_dir. Both fall back to
// <root>/tasks — the same fallback loop-complete-task.ts uses.
export async function resolveTasksDir(root) {
  const fallback = path.join(root, "tasks");
  try {
    const { loadConfig, activeProvider } = await import(
      pathToFileURL(path.join(root, "packages/quay/src/config.ts")).href
    );
    const loaded = loadConfig(root);
    const { workspaceRoot } = loaded;
    const provider = activeProvider(loaded, "native");
    if (provider && provider.tasks_dir) {
      return path.resolve(workspaceRoot, provider.tasks_dir);
    }
  } catch {
    // no config / no native provider — fall back to <root>/tasks
  }
  return fallback;
}

// ── The core judgment: scan one tasks dir through the store's own parser ───────────────────────────
// Returns the store's malformed array ({file, error}[]). Throws only on store/environment
// failure (a real problem, not a per-file parse failure — those come back in `malformed`).
export async function scanMalformed(tasksDir, repoRoot) {
  const { createStore } = await importStoreFactory(repoRoot);
  const store = createStore(tasksDir);
  const { malformed } = store.listWithMalformed();
  return malformed;
}

// ── checkRoot: the CLI-facing check over a workspace ───────────────────────────────────────────────
// The store IMPLEMENTATION comes from the checker's OWN repo (repoRoot), while the tasks dir
// comes from --root: the tool reads whatever workspace it is pointed at with its own parser —
// the two only coincide when --root IS the checker's repo (the full-suite / scoped-gate case).
export async function checkRoot(root) {
  const tasksDir = await resolveTasksDir(root);
  if (!fs.existsSync(tasksDir)) {
    // Fail-closed: a requested workspace whose tasks dir is absent is an environment
    // error, never a silent "0 malformed" (the empty = healthy shape is the defect class).
    throw new Error(`malformed-task-check: no tasks dir at ${tasksDir} (root ${root})`);
  }
  const malformed = await scanMalformed(tasksDir, repoRoot(__dirname));
  return { tasksDir, malformed };
}

// ── selftest (mutation-case surface) ───────────────────────────────────────────────────────────────
// Builds a temp tasks dir; asserts BOTH directions:
//   GREEN  — a clean task file is NOT reported malformed;
//   RED    — the live-sample shape (`title: [封存] …`, the exact 2026-08-13 sample) IS.
// The mutation case (plugin/scripts/checker-mutation-cases/malformed-task-check.sh)
// runs this; checker-mutation-check.sh treats non-zero as a case failure.
export async function selfTestMain(root = repoRoot(__dirname)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "malformed-task-check-selftest-"));
  let failures = 0;
  try {
    const tasksDir = path.join(tmp, "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    // Clean file → must stay GREEN.
    fs.writeFileSync(
      path.join(tasksDir, "OK-1.md"),
      "---\nid: OK-1\ntitle: a well-formed task\n---\nbody\n",
    );
    // Live-sample malformed: `title: [封存] …` — YAML flow sequence with trailing scalar.
    fs.writeFileSync(
      path.join(tasksDir, "BAD-1.md"),
      "---\nid: BAD-1\ntitle: [封存] bare-dir thing\n---\nbody\n",
    );

    const malformed = await scanMalformed(tasksDir, root);
    const badFiles = malformed.map((m) => m.file);
    if (!badFiles.includes("BAD-1.md")) {
      console.error("SELFTEST RED-LEAK: the live-sample malformed shape was NOT reported malformed");
      failures++;
    }
    if (badFiles.includes("OK-1.md")) {
      console.error("SELFTEST FALSE-POSITIVE: the clean task file was reported malformed");
      failures++;
    }
    if (malformed.length === 0) {
      console.error("SELFTEST RED-LEAK: malformed array is empty (the defect class is invisible)");
      failures++;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures === 0) {
    console.log("SELFTEST PASS: clean task stays green; the [封存] malformed shape goes red.");
    return 0;
  }
  console.error(`SELFTEST FAIL: ${failures} assertion(s)`);
  return 2;
}

function usage() {
  process.stderr.write(
    "Usage: malformed-task-check.ts [--root <dir>] [--selftest]\n" +
      "Exit: 0 no malformed task file; 1 >=1 malformed; 2 usage/environment error.\n",
  );
}

export async function main(argv) {
  const args = argv.slice(2);
  let root = process.cwd();
  let selfTest = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { root = args[++i] ?? root; continue; }
    if (args[i] === "--selftest") { selfTest = true; continue; }
    if (args[i] === "--strict-subset") {
      // The scoped tier appends `--strict-subset <touched task files>`. The check is the
      // WHOLE-STORE scan — a malformed task anywhere is a silent vanish, not just the
      // touched file — so the subset arg is consumed and the scan is not narrowed.
      i = args.length; // consume the rest as the subset (ignored)
      continue;
    }
    // Unknown flag: usage error (fail closed rather than silently scanning the wrong root).
    process.stderr.write(`malformed-task-check: unknown argument: ${args[i]}\n`);
    usage();
    return 2;
  }
  if (selfTest) return selfTestMain(repoRoot(__dirname));
  try {
    const { tasksDir, malformed } = await checkRoot(root);
    if (malformed.length === 0) return 0;
    console.error(
      `FAIL: ${malformed.length} task file(s) could not be parsed and are SILENTLY excluded from the store:`,
    );
    for (const m of malformed) console.error(`  ${m.file}: ${m.error}`);
    console.error(`  tasks dir: ${tasksDir}`);
    return 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

// ── entry ─────────────────────────────────────────────────────────────────────────────────────────
// Only run as the entry module (not when imported by a test). Mirrors the other plugin
// scripts' `main()` gate so the module is importable for unit tests.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).then(
    (code) => { process.exitCode = code; },
    (err) => {
      console.error(String(err?.stack ?? err));
      process.exitCode = 2;
    },
  );
}
