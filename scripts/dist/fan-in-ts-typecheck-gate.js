#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/fan-in-ts-typecheck-gate.ts
import fs3 from "node:fs";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/core-src-import.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2, pathToFileURL } from "node:url";
var HERE = path2.dirname(fileURLToPath2(import.meta.url));
var MAX_DEPTH2 = 8;
function resolveCoreSrcFile(rel, startDir = HERE) {
  let dir = path2.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH2; i++) {
    const repoTree = path2.join(dir, "packages", "quay", "src", rel);
    if (fs2.existsSync(repoTree)) return repoTree;
    const staged = path2.join(dir, "src", rel);
    if (fs2.existsSync(staged)) return staged;
    const parent = path2.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/fan-in-ts-typecheck-gate.ts
import path4 from "node:path";
import { execFileSync as execFileSync2, spawnSync } from "node:child_process";
import { fileURLToPath as fileURLToPath3, pathToFileURL as pathToFileURL2 } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path3 from "node:path";
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path3.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/touches-parser.ts
function stripTouchAnnotation(entry) {
  let s = String(entry);
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] === "\uFF09") {
    let depth = 0;
    let open = -1;
    for (let j = i; j >= 0; j--) {
      const c = t[j];
      if (c === "\uFF09") depth++;
      else if (c === "\uFF08" && --depth === 0) {
        open = j;
        break;
      }
    }
    if (open !== -1) {
      let k = open;
      while (k > 0 && /\s/.test(t[k - 1])) k--;
      s = t.slice(0, k);
    }
  }
  return s.replace(/\s*\([^)]*\)\s*$/, "").trim();
}
function tagFromAnnotation(text) {
  const a = String(text ?? "").trim().toLowerCase();
  if (a === "new") return "new";
  if (a === "delete" || a === "deleted") return "delete";
  return null;
}
function parseTouchEntriesWithTags(touchesSection) {
  if (!touchesSection) return [];
  const out = [];
  for (const raw of String(touchesSection).split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    let entry = m[1].trim();
    entry = entry.replace(/^[`"'']+|[`"'']+$/g, "").trim();
    let tag = tagFromAnnotation(entry.match(/\s*\(([^)]*)\)\s*$/)?.[1]);
    if (!tag) {
      const beforeFullWidth = entry.match(/\s*\(([^)]*)\)\s*[（]/);
      tag = tagFromAnnotation(beforeFullWidth?.[1]);
    }
    const stripped = stripTouchAnnotation(entry);
    const cleaned = stripped.replace(/^[`"'']+|[`"'']+$/g, "").trim();
    const path5 = cleaned.replace(/^\.\//, "").trim();
    if (!path5) continue;
    out.push({ path: path5, tag });
  }
  return out;
}
function extractTouchesSection(fullText) {
  const lines = String(fullText).split(/\r?\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].trimEnd().match(/^(#{1,6})\s+(.*)$/);
    if (!heading) continue;
    const text = heading[2].trim();
    if (/^touches\b/i.test(text)) candidates.push({ line: i, level: heading[1].length, text });
  }
  if (candidates.length === 0) {
    return { hasSection: false, section: "", heading: null, startLine: null, level: null };
  }
  const exact = candidates.filter((c) => c.text.toLowerCase() === "touches");
  const chosen = exact.length ? exact[0] : candidates.slice().sort((a, b) => a.level - b.level || a.line - b.line)[0];
  const out = [];
  for (let i = chosen.line + 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (/^#{1,6}\s+/.test(line)) break;
    out.push(line);
  }
  return {
    hasSection: true,
    section: out.join("\n"),
    heading: chosen.text,
    startLine: chosen.line + 1,
    level: chosen.level
  };
}
if (isDirectEntry(import.meta, void 0, "touches-parser")) {
  process.stdout.write("Usage: touches-parser.ts is a shared module, not a CLI \u2014 import { parseTouchEntries, extractTouchesSection, stripTouchAnnotation } from it.\n");
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/fan-in-ts-typecheck-gate.ts
function parseTouches(taskBody) {
  const { section } = extractTouchesSection(String(taskBody ?? ""));
  return parseTouchEntriesWithTags(section).map((e) => e.path).filter(Boolean);
}
function listNewMovedTsFiles(nameOnlyOutput) {
  const out = [];
  for (const line of String(nameOnlyOutput ?? "").split(/\r?\n/)) {
    const rel = line.trim();
    if (!rel) continue;
    if (rel.endsWith(".ts")) out.push(rel);
  }
  return out;
}
function touchCoversFile(touch, file) {
  const p = String(touch ?? "").trim().replace(/^\.\//, "").replace(/\/\*\*?$/, "");
  const f = String(file ?? "").trim().replace(/^\.\//, "");
  if (!p || !f) return false;
  if (f === p) return true;
  return f.startsWith(p.endsWith("/") ? p : p + "/");
}
function requiresTypecheck(touches, newMovedTsFiles) {
  if (!Array.isArray(touches) || touches.length === 0) return false;
  if (!Array.isArray(newMovedTsFiles) || newMovedTsFiles.length === 0) return false;
  return newMovedTsFiles.some((f) => touches.some((t) => touchCoversFile(t, f)));
}
var SCRIPT_DIR = path4.dirname(fileURLToPath3(import.meta.url));
var CORE_LOADER_REL = "gate/config/loader.ts";
function configLoaderCandidates(moduleRoot = null) {
  const out = [];
  const fromModule = moduleRoot ? resolveCoreSrcFile(CORE_LOADER_REL, path4.resolve(moduleRoot)) : null;
  if (fromModule) out.push(fromModule);
  const fromScript = resolveCoreSrcFile(CORE_LOADER_REL, SCRIPT_DIR);
  if (fromScript && fromScript !== fromModule) out.push(fromScript);
  return out;
}
function resolveConfigLoaderPath(moduleRoot = null) {
  for (const p of configLoaderCandidates(moduleRoot)) if (fs3.existsSync(p)) return p;
  return null;
}
var FALLBACK_TYPECHECK_CMD = "npx tsc --noEmit";
var TYPECHECK_GATE_NAMES = ["ts-typecheck", "typecheck"];
async function resolveTypecheckCommandDetailed(configRoot, moduleRoot = null) {
  const loaderPath = resolveConfigLoaderPath(moduleRoot);
  if (!loaderPath) {
    return { command: FALLBACK_TYPECHECK_CMD, source: "fallback", reason: "loader-not-found", loaderPath: null };
  }
  let cfg;
  try {
    const { readGatesConfig } = await import(pathToFileURL2(loaderPath).href);
    cfg = readGatesConfig(configRoot);
  } catch (err) {
    return { command: FALLBACK_TYPECHECK_CMD, source: "fallback", reason: "loader-import-failed", loaderPath, error: String(err) };
  }
  for (const name of TYPECHECK_GATE_NAMES) {
    const entry = (cfg.testPass || []).find((e) => e && e.name === name);
    if (entry && typeof entry.command === "string" && entry.command.trim()) {
      return { command: entry.command, source: "config", declaredAs: name, loaderPath };
    }
  }
  return { command: FALLBACK_TYPECHECK_CMD, source: "fallback", reason: "no-declaration", loaderPath };
}
async function resolveTypecheckCommand(configRoot, moduleRoot = null) {
  return (await resolveTypecheckCommandDetailed(configRoot, moduleRoot)).command;
}
async function runTypecheckGate(worktree, root, { fakeGate = null, command = null } = {}) {
  if (fakeGate === "pass") return { ok: true, fake: true, command: command ?? null, source: "fake", status: 0, stdout: "", stderr: "(fake pass)" };
  if (fakeGate === "fail") return { ok: false, fake: true, command: command ?? null, source: "fake", status: 1, stdout: "", stderr: "(fake fail)" };
  let cmd = command, source = command ? "explicit" : null, declaredAs = null, loaderPath = null, reason = null;
  if (cmd == null) {
    const resolved = await resolveTypecheckCommandDetailed(worktree, root);
    cmd = resolved.command;
    source = resolved.source;
    declaredAs = resolved.declaredAs ?? null;
    loaderPath = resolved.loaderPath ?? null;
    reason = resolved.reason ?? null;
  }
  const provenance = { source, declaredAs, loaderPath, reason };
  try {
    const r = spawnSync("bash", ["-c", cmd], {
      cwd: worktree,
      encoding: "utf8",
      timeout: 3e5,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: r.status === 0, command: cmd, ...provenance, status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } catch (err) {
    return { ok: false, command: cmd, ...provenance, status: null, stdout: "", stderr: String(err) };
  }
}
var usage = `fan-in-ts-typecheck-gate.ts \u2014 fan-in admission pre-check: run the ts-typecheck gate when a task's Touches include NEW/MOVED .ts files (gap-ts-touching-fan-in-needs-typecheck-gate)

Usage:
  node --experimental-strip-types fan-in-ts-typecheck-gate.ts --task <id> [--worktree <dir>] [--merge-target <ref>] [--json] [--check-only] [--fake-gate <pass|fail>] [--help]

  --task <id>        task id whose ## Touches to evaluate (REQUIRED \u2014 reads <worktree>/tasks/<id>.md)
  --worktree <dir>   the task's worktree (default: cwd). The typecheck command runs with cwd here \u2014
                     it typechecks the TASK'S tree. Read the task + run git diff here too.
  --merge-target <ref>  the ref the task was rebased onto before fan-in (the loop's $MERGE_TARGET).
                     The task's own diff is $MERGE_TARGET...HEAD (default: develop \u2014 a heuristic).
  --json             machine-readable output { required, typecheck, verdict, reason, ... }
  --check-only       report the DECISION (required: true/false) WITHOUT running the gate \u2014 the
                     fan-in step can pre-filter which tasks need the gate before paying its ~20s.
  --fake-gate <pass|fail>  TEST-ONLY backdoor: short-circuit the typecheck verdict without executing
                     the command (negative-control tests prove the gate-run wiring without real tsc).
  --help             this help

Exit codes:
  0  ADMITTED \u2014 no new/moved .ts in Touches, OR the ts-typecheck gate is green
  1  BLOCKED  \u2014 new/moved .ts in Touches AND the ts-typecheck gate is red (do NOT fan in)
  2  usage/env error (task file missing, git diff unavailable \u2014 fail-closed, never admitted)`;
async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage + "\n");
    return 0;
  }
  const taskId = flagValue(args, "--task");
  if (!taskId) {
    process.stderr.write(`fan-in-ts-typecheck-gate: --task is required
${usage}
`);
    return 2;
  }
  const worktree = path4.resolve(flagValue(args, "--worktree") ?? process.cwd());
  const mergeTarget = flagValue(args, "--merge-target") ?? "develop";
  const asJson = args.includes("--json");
  const checkOnly = args.includes("--check-only");
  const fakeGate = flagValue(args, "--fake-gate");
  if (fakeGate != null && fakeGate !== "pass" && fakeGate !== "fail") {
    process.stderr.write(`fan-in-ts-typecheck-gate: --fake-gate must be "pass" or "fail" (got "${fakeGate}")
`);
    return 2;
  }
  const root = repoRoot(worktree);
  const taskPath = path4.join(worktree, "tasks", `${taskId}.md`);
  if (!fs3.existsSync(taskPath)) {
    process.stderr.write(`fan-in-ts-typecheck-gate: task file not found: ${taskPath}
`);
    return 2;
  }
  const touches = parseTouches(fs3.readFileSync(taskPath, "utf8"));
  let newMovedTsFiles;
  try {
    const committed = execFileSync2("git", ["-C", worktree, "diff", "--name-only", "--diff-filter=ACR", "-M", `${mergeTarget}...HEAD`], {
      encoding: "utf8",
      timeout: 3e4,
      stdio: ["ignore", "pipe", "ignore"]
    });
    let workingTree = "";
    try {
      workingTree = execFileSync2("git", ["-C", worktree, "diff", "--name-only", "--diff-filter=ACR", "-M", "HEAD"], {
        encoding: "utf8",
        timeout: 3e4,
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
    }
    let untracked = "";
    try {
      untracked = execFileSync2("git", ["-C", worktree, "ls-files", "--others", "--exclude-standard"], {
        encoding: "utf8",
        timeout: 3e4,
        stdio: ["ignore", "pipe", "ignore"]
      });
    } catch {
    }
    newMovedTsFiles = listNewMovedTsFiles(`${committed}
${workingTree}
${untracked}`);
  } catch {
    process.stderr.write(
      `fan-in-ts-typecheck-gate: could not compute the task's git diff (${mergeTarget}...HEAD) in ${worktree} \u2014 ref absent or git error. Fail-closed: BLOCKED (an unknown type-graph change must not fan in on scoped-green alone).
`
    );
    if (asJson) {
      process.stdout.write(JSON.stringify({
        task: taskId,
        worktree,
        mergeTarget,
        touches,
        newMovedTsFiles: null,
        required: null,
        reason: "git-diff-unavailable",
        verdict: "blocked",
        exit: 1
      }, null, 2) + "\n");
    }
    return 1;
  }
  const required = requiresTypecheck(touches, newMovedTsFiles);
  if (checkOnly) {
    if (asJson) {
      process.stdout.write(JSON.stringify({
        task: taskId,
        worktree,
        mergeTarget,
        touches,
        newMovedTsFiles,
        required,
        typecheck: { ran: false },
        reason: required ? "new-moved-ts-in-touches" : "no-new-moved-ts-in-touches",
        verdict: required ? "gate-pending" : "admitted",
        exit: 0
      }, null, 2) + "\n");
    } else {
      console.log(`fan-in-ts-typecheck-gate: task ${taskId} \u2014 ${required ? "REQUIRES" : "does NOT require"} the ts-typecheck gate before fan-in (check-only)`);
    }
    return 0;
  }
  if (!required) {
    if (asJson) {
      process.stdout.write(JSON.stringify({
        task: taskId,
        worktree,
        mergeTarget,
        touches,
        newMovedTsFiles,
        required: false,
        typecheck: { ran: false },
        reason: "no-new-moved-ts-in-touches",
        verdict: "admitted",
        exit: 0
      }, null, 2) + "\n");
    } else {
      console.log(`fan-in-ts-typecheck-gate: task ${taskId} \u2014 Touches ${touches.length ? "do not cover any" : "are empty"}; new/moved .ts in diff: ${newMovedTsFiles.length}`);
      console.log(`fan-in-ts-typecheck-gate: no new/moved .ts in the declared write surface \u2014 no typecheck gate needed`);
      console.log("fan-in-ts-typecheck-gate: ADMITTED (exit 0)");
    }
    return 0;
  }
  const typecheck = await runTypecheckGate(worktree, root, { fakeGate });
  const admitted = typecheck.ok;
  if (asJson) {
    process.stdout.write(JSON.stringify({
      task: taskId,
      worktree,
      mergeTarget,
      touches,
      newMovedTsFiles,
      required: true,
      typecheck: {
        ran: true,
        ok: typecheck.ok,
        fake: typecheck.fake ?? false,
        status: typecheck.status,
        command: typecheck.command,
        commandSource: typecheck.source ?? null,
        declaredAs: typecheck.declaredAs ?? null,
        loaderPath: typecheck.loaderPath ?? null,
        reason: typecheck.reason ?? null,
        stdout: (typecheck.stdout ?? "").slice(0, 2e3),
        stderr: (typecheck.stderr ?? "").slice(0, 2e3)
      },
      reason: admitted ? "typecheck-green" : "typecheck-red",
      verdict: admitted ? "admitted" : "blocked",
      exit: admitted ? 0 : 1
    }, null, 2) + "\n");
  } else {
    console.log(`fan-in-ts-typecheck-gate: task ${taskId} \u2014 Touches cover new/moved .ts files (${newMovedTsFiles.length}); type graph changed`);
    console.log(`fan-in-ts-typecheck-gate: running ts-typecheck gate in worktree ${worktree}${fakeGate ? ` (fake ${fakeGate})` : ""}...`);
    if (!fakeGate) {
      const src = typecheck.source === "config" ? `the workspace's own declaration${typecheck.declaredAs ? ` (name: ${typecheck.declaredAs})` : ""}` : `FALLBACK${typecheck.reason ? ` (${typecheck.reason})` : ""}`;
      console.log(`fan-in-ts-typecheck-gate: command [${src}]: ${typecheck.command}`);
    }
    if (admitted) {
      console.log("fan-in-ts-typecheck-gate: typecheck GREEN \u2014 ADMITTED (exit 0)");
    } else {
      console.log("fan-in-ts-typecheck-gate: typecheck RED \u2014 BLOCKED (exit 1); do NOT fan in on scoped-green alone");
      const tail = (typecheck.stderr || typecheck.stdout || "").trim().split("\n").slice(-15).join("\n");
      if (tail) console.log("fan-in-ts-typecheck-gate: last lines:\n" + tail);
    }
  }
  return admitted ? 0 : 1;
}
if (isDirectEntry(import.meta, void 0, "fan-in-ts-typecheck-gate")) {
  main(process.argv).then((code) => process.exit(code));
}
export {
  FALLBACK_TYPECHECK_CMD,
  configLoaderCandidates,
  listNewMovedTsFiles,
  main,
  parseTouches,
  requiresTypecheck,
  resolveConfigLoaderPath,
  resolveTypecheckCommand,
  resolveTypecheckCommandDetailed,
  runTypecheckGate,
  touchCoversFile
};
