#!/usr/bin/env node --experimental-strip-types
/**
 * codex-stage1-live-proof-audit — INDEPENDENT TRUTH audit for the DIR-121 (Codex
 * adoption Stage 1) durable milestone-evidence record. This is the truth half of the
 * pair; codex-stage1-live-proof-check.ts is the SHAPE-ONLY half.
 *
 *   Usage: node --experimental-strip-types plugin/scripts/codex-stage1-live-proof-audit.ts <milestone-evidence.json> [--root <workspaceRoot>]
 *
 * For each mutation the record claims, this command reads the claimed objects back from
 * their authoritative sources and requires them to match the declared fields:
 *   - the taskId is read back through the Quay Provider ABI/CLI (`quay task view --json`)
 *     and must exist with the same id, and providerQualifiedId must name the same task;
 *   - the declared content hash (afterHash) must equal the sha256 of the task file as Git
 *     records it at the mutation's own scoped commit (`git show <sha>:<task-file>`), so a
 *     fabricated hash or commit cannot pass;
 *   - the scoped commit SHA must exist in Git and its changed paths must be EXACTLY the
 *     declared filesChanged set;
 *   - the read-back live task file must pass `node plugin/scripts/task-schema-check.ts`.
 *
 * Exits 0 iff EVERY claimed object is read back from the authoritative store/Git and
 * matches its declared fields. An exit 0 from THIS command IS a truth claim — the
 * evidence names real, present, un-tampered objects. (An exit 0 from
 * codex-stage1-live-proof-check.ts is NOT.)
 *
 * Default --root is the repository root two levels above this script (works in the main
 * checkout and in a task worktree). The task file path is resolved from the workspace's
 * native `tasks_dir` in `.quay/config.yml` (default `./tasks`).
 */

import { readFileSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { helpExit } from "./gate-script-base.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) console.log(`PASS: ${msg}`);
  else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

// ── argv ────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  helpExit(
    "codex-stage1-live-proof-audit — INDEPENDENT TRUTH audit (reads objects back from the store/Git)\n" +
    "usage: node --experimental-strip-types plugin/scripts/codex-stage1-live-proof-audit.ts <milestone-evidence.json> [--root <workspaceRoot>]\n" +
    "\n" +
    "Exit 0 = every claimed taskId/commit/hash was read back from the authoritative\n" +
    "store/Git and matched the declared fields. This IS a truth claim, unlike the\n" +
    "shape-only codex-stage1-live-proof-check.ts."
  );
}

let file: string | undefined;
let rootArg: string | undefined;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--root") {
    rootArg = argv[++i];
  } else if (!a.startsWith("--") && file === undefined) {
    file = a;
  }
}
if (!file) {
  console.error("usage: node --experimental-strip-types plugin/scripts/codex-stage1-live-proof-audit.ts <milestone-evidence.json> [--root <workspaceRoot>]");
  process.exit(2);
}

const root = resolve(rootArg ?? resolve(SCRIPT_DIR, "../.."));

// ── evidence load ───────────────────────────────────────────────────────────────
let ev: any;
try {
  ev = JSON.parse(readFileSync(resolve(file), "utf8"));
} catch (e) {
  console.error(`ENV-ERROR: cannot read/parse evidence file ${file}: ${(e as Error).message}`);
  process.exit(2);
}

const mutations = Array.isArray(ev.mutations) ? ev.mutations : [];
if (mutations.length === 0) {
  console.error("AUDIT FAIL: the evidence records no mutations to audit.");
  process.exit(1);
}

// ── workspace surface ───────────────────────────────────────────────────────────
const cliBin = resolve(root, "packages/quay/bin/quay.ts");
const schemaCheck = resolve(root, "plugin/scripts/task-schema-check.ts");

function tasksDir(): string {
  try {
    const cfg = readFileSync(resolve(root, ".quay/config.yml"), "utf8");
    const m = cfg.match(/^\s*tasks_dir:\s*["']?([^"'\s#]+)["']?/m);
    if (m) return m[1].replace(/\/+$/, "");
  } catch {
    // fall through to default
  }
  return "tasks";
}

function run(cmd: string, args: string[], cwd?: string) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8" });
}

function cliViewTask(taskId: string): { ok: boolean; parsed: any; status: number } {
  const r = run("node", [cliBin, "task", "view", taskId, "--json"], root);
  const out = r.stdout || "";
  const start = out.search(/[\[{]/);
  let parsed: any = null;
  if (start !== -1) {
    try {
      parsed = JSON.parse(out.slice(start));
    } catch {
      parsed = null;
    }
  }
  return { ok: r.status === 0 && parsed !== null, parsed, status: r.status ?? -1 };
}

function gitShow(cmdArgs: string[]): { status: number; stdout: string } {
  const r = run("git", ["-C", root, ...cmdArgs]);
  return { status: r.status ?? -1, stdout: r.stdout ?? "" };
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ── per-mutation truth readback ─────────────────────────────────────────────────
const tdir = tasksDir();
for (const m of mutations) {
  const taskId: string = typeof m?.taskId === "string" ? m.taskId : "";
  const label = `mutation[${taskId || "?"}]`;

  // 1. task existence + provider-qualified id, read back through the Provider ABI/CLI.
  if (!taskId) {
    ok(false, `${label}: taskId is not a non-empty string (cannot read back)`);
    continue;
  }
  const view = cliViewTask(taskId);
  ok(view.ok, `${label}: task "${taskId}" read back from the authoritative store (quay task view exit ${view.status})`);
  if (view.ok && (view.parsed.id ?? view.parsed.task?.id) !== taskId) {
    ok(false, `${label}: read-back id does not match the claimed taskId "${taskId}"`);
  }
  const pqi = typeof m.providerQualifiedId === "string" ? m.providerQualifiedId : "";
  ok(pqi === taskId || pqi.split(":").pop() === taskId, `${label}: providerQualifiedId "${pqi}" names the same task as taskId "${taskId}"`);

  // Live task file path (for schema check) resolved from the native tasks_dir.
  const taskFileAbs = resolve(root, tdir, `${taskId}.md`);

  // 2. scoped commit: object exists + changed paths exactly the declared set.
  const sha = typeof m?.scopedCommit?.sha === "string" ? m.scopedCommit.sha : "";
  const declared = Array.isArray(m?.scopedCommit?.filesChanged) ? m.scopedCommit.filesChanged.map(String) : [];
  if (!sha) {
    ok(false, `${label}: scoped commit SHA is missing (cannot read back from Git)`);
  } else {
    const cat = gitShow(["cat-file", "-e", sha]);
    ok(cat.status === 0, `${label}: commit ${sha} exists in Git (cat-file -e exit ${cat.status})`);
    if (cat.status === 0) {
      const show = gitShow(["show", "--name-only", "--format=", sha]);
      const actual = show.stdout.split("\n").map((l) => l.trim()).filter(Boolean).sort();
      const declaredSorted = [...declared].sort();
      const same = JSON.stringify(actual) === JSON.stringify(declaredSorted);
      ok(same, `${label}: commit ${sha} changed paths match the scoped declaration (actual: ${actual.join(", ") || "<none>"}; declared: ${declaredSorted.join(", ") || "<none>"})`);
    }
  }

  // 3. declared content hash must equal the committed task-file content (not the live
  //    file, which may legitimately have been edited since — Git is the authority for
  //    what the mutation actually produced).
  const afterHash = typeof m?.afterHash === "string" ? m.afterHash : "";
  if (sha && afterHash) {
    const relPath = relative(root, taskFileAbs);
    const blob = gitShow(["show", `${sha}:${relPath}`]);
    if (blob.status === 0) {
      const actualHash = sha256Hex(blob.stdout);
      ok(actualHash === afterHash, `${label}: afterHash matches the committed content of ${relPath} (declared ${afterHash})`);
    } else {
      ok(false, `${label}: cannot read back ${relPath} at commit ${sha} to verify afterHash`);
    }
  } else {
    ok(false, `${label}: cannot verify afterHash (missing commit SHA or afterHash)`);
  }

  // 4. schema check on the read-back LIVE task file.
  const schema = run("node", [schemaCheck, taskFileAbs]);
  ok(schema.status === 0, `${label}: read-back task file ${relative(root, taskFileAbs)} passes task-schema-check (exit ${schema.status})`);
}

// ── summary ──────────────────────────────────────────────────────────────────────
console.log("");
if (failures > 0) {
  console.error(`AUDIT FAIL: ${failures} claimed object(s)/field(s) could not be read back from the authoritative store/Git or did not match.`);
  process.exit(1);
}
console.log("AUDIT PASS: every claimed object was read back from the authoritative store/Git and matched the declared fields.");
process.exit(0);
