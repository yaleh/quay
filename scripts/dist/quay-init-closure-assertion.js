import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/quay-init-closure-assertion.ts
import fs2 from "node:fs";
import path3 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage2) {
  process.stdout.write(usage2.endsWith("\n") ? usage2 : usage2 + "\n");
  process.exit(0);
}
var VERDICT_EXIT_CODE = {
  pass: 0,
  fail: 1,
  "not-evaluated": 3
};
function verdictExitCode(status) {
  return VERDICT_EXIT_CODE[status];
}
function emitVerdict(verdict, opts = {}) {
  const { json = false, stream = "stdout" } = opts;
  const out = stream === "stderr" ? process.stderr : process.stdout;
  if (json) {
    const detail = verdict.detail;
    const base = detail !== null && typeof detail === "object" && !Array.isArray(detail) ? { ...detail } : detail === void 0 ? {} : { detail };
    base.status = verdict.status;
    base.ok = verdict.status === "pass";
    base.message = verdict.message;
    out.write(JSON.stringify(base) + "\n");
  } else {
    const prefix = verdict.status === "pass" ? "PASS" : verdict.status === "fail" ? "FAIL" : "NOT-EVALUATED";
    out.write(`${prefix}: ${verdict.message}
`);
  }
  return verdictExitCode(verdict.status);
}
function emitPass(message, detail, opts) {
  return emitVerdict({ status: "pass", message, detail }, opts);
}
function emitFail(message, detail, opts) {
  return emitVerdict({ status: "fail", message, detail }, opts);
}
function emitNotEvaluated(message, detail, opts) {
  return emitVerdict({ status: "not-evaluated", message, detail }, opts);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path2.dirname(fileURLToPath(import.meta.url))) {
  let dir = path2.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path2.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path2.join(dir, "plugin")) && fs.existsSync(path2.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path2.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path2.join(dir, ".git"))) {
      return dir;
    }
    const parent = path2.dirname(dir);
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/quay-init-closure-assertion.ts
var QUAY_INIT_REL = "plugin/scripts/quay-init.sh";
var CLOSED_SET_FILES = /* @__PURE__ */ new Set([
  ".quay/config.yml",
  ".quay/profiles.yml",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json"
]);
var CLOSED_SET_DIRS = ["tasks", "goals"];
var FORBIDDEN_PREFIXES = [
  ".claude/skills/",
  ".claude/workflows/",
  ".claude/agents/",
  ".claude/commands/",
  ".claude/hooks/",
  "plugin/scripts/",
  ".mcp.json"
];
function isInClosedSet(rel) {
  if (CLOSED_SET_FILES.has(rel)) return true;
  const norm = rel.split(path3.sep).join("/");
  for (const dir of CLOSED_SET_DIRS) {
    if (norm === dir || norm.startsWith(dir + "/")) return true;
  }
  return false;
}
function assertClosure(relPaths) {
  const outsideClosedSet = [];
  const forbiddenCopies = [];
  for (const rel of relPaths) {
    if (!isInClosedSet(rel)) outsideClosedSet.push(rel);
    for (const p of FORBIDDEN_PREFIXES) {
      const hit = p.endsWith("/") ? rel === p.slice(0, -1) || rel.startsWith(p) : rel === p;
      if (hit) {
        forbiddenCopies.push(rel);
        break;
      }
    }
  }
  return { ok: outsideClosedSet.length === 0 && forbiddenCopies.length === 0, outsideClosedSet, forbiddenCopies };
}
function runLaydownPaths(root) {
  const quayInit = path3.join(root, QUAY_INIT_REL);
  if (!fs2.existsSync(quayInit)) return null;
  const tmpBase = fs2.mkdtempSync(path3.join(path3.dirname(root), "quay-init-assertion-"));
  const target = path3.join(tmpBase, "target");
  const worktreeRoot = path3.join(tmpBase, "worktrees");
  fs2.mkdirSync(target);
  fs2.mkdirSync(worktreeRoot);
  try {
    execFileSync2(
      "bash",
      [
        quayInit,
        "--all",
        "--loop",
        "--manager",
        "--root",
        target,
        "--repo-root",
        target,
        "--test-command",
        "node --test",
        "--tmux-session",
        "quay-init-closure-assertion-probe",
        "--worktree-root",
        worktreeRoot,
        "--plugin-root",
        path3.join(root, "plugin")
      ],
      { timeout: 18e4, stdio: ["ignore", "ignore", "pipe"] }
    );
    const rels = [];
    const walk = (d) => {
      for (const e of fs2.readdirSync(d, { withFileTypes: true })) {
        const p = path3.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) rels.push(path3.relative(target, p).split(path3.sep).join("/"));
      }
    };
    walk(target);
    rels.sort();
    return rels;
  } catch {
    return null;
  } finally {
    try {
      fs2.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
    }
  }
}
var CLOSED_SET_ALL = [
  ".quay/config.yml",
  ".quay/profiles.yml",
  "tasks",
  "goals",
  ".gitignore",
  ".claude/launch.settings.json",
  ".claude/settings.json"
];
var CLOSED_SET_ITEM_STATES = [
  "written",
  "pre-existing",
  "unwritten",
  "unreadable"
];
function reportedItems(report) {
  return [...report.written, ...report.preExisting, ...report.unwritten, ...report.unreadable];
}
function runFailureStateReport(root) {
  const quayInit = path3.join(root, QUAY_INIT_REL);
  if (!fs2.existsSync(quayInit)) return null;
  const tmpBase = fs2.mkdtempSync(path3.join(path3.dirname(root), "quay-init-fail-"));
  const target = path3.join(tmpBase, "target");
  fs2.mkdirSync(target);
  try {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    try {
      execFileSync2(
        "bash",
        [quayInit, "--root", target, "--repo-root", target, "--plugin-root", path3.join(root, "plugin")],
        { timeout: 18e4, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }
      );
    } catch (e) {
      const err = e;
      stdout = typeof err.stdout === "string" ? err.stdout : "";
      stderr = typeof err.stderr === "string" ? err.stderr : "";
      exitCode = typeof err.status === "number" ? err.status : 1;
    }
    if (exitCode === 0) return null;
    const output = stdout + "\n" + stderr;
    const written = [];
    const preExisting = [];
    const unwritten = [];
    const unreadable = [];
    for (const line of output.split("\n")) {
      const m = line.match(/^\s*(pre-existing|unwritten|unreadable|written):\s*(.+?)\s*$/);
      if (!m) continue;
      const item = m[2].trim();
      if (m[1] === "written") written.push(item);
      else if (m[1] === "pre-existing") preExisting.push(item);
      else if (m[1] === "unwritten") unwritten.push(item);
      else unreadable.push(item);
    }
    return { exitCode, written, preExisting, unwritten, unreadable, output };
  } finally {
    try {
      fs2.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
    }
  }
}
var usage = `quay-init-closure-assertion.ts \u2014 closed-set membership assertion over a REAL quay-init laydown (SPEC \xA76 / AC168)

Usage:
  node --experimental-strip-types quay-init-closure-assertion.ts --gate [--root <dir>] [--json]
      gate mode \u2014 exit 1 iff a laid-down path is outside the closed set (\u222A tasks/ and goals/ descendants), a
      forbidden extension-file copy is present, or the failure path does not report every closed-set
      item; exit 3 (NOT-EVALUATED) iff the laydown could not run.`;
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path3.resolve(args.includes("--root") ? args[args.indexOf("--root") + 1] : repoRoot());
  const asJson = args.includes("--json");
  if (!args.includes("--gate")) {
    process.stderr.write(`${usage}
`);
    return 2;
  }
  const rels = runLaydownPaths(root);
  if (rels === null) {
    return emitNotEvaluated(
      "quay-init-closure-assertion: NOT-EVALUATED \u2014 the real quay-init laydown could not run (a checker that cannot read its input is never conflated with 'closed set satisfied')",
      { evaluated: false },
      { json: asJson }
    );
  }
  const verdict = assertClosure(rels);
  const failReport = runFailureStateReport(root);
  const failMissing = [];
  if (failReport === null) {
    failMissing.push("(failure path NOT-EVALUATED: a failing quay-init did not run to a non-zero exit)");
  } else {
    const seen = reportedItems(failReport);
    for (const item of CLOSED_SET_ALL) {
      if (!seen.includes(item)) failMissing.push(item);
    }
  }
  if (verdict.ok && failReport !== null && failMissing.length === 0) {
    return emitPass(
      `quay-init laydown is within the closed set (${rels.length} file(s), zero extension-file copies) and the failure path reports all ${CLOSED_SET_ALL.length} closed-set items`,
      { evaluated: true, files: rels.length, ...verdict, failureExit: failReport.exitCode },
      { json: asJson }
    );
  }
  for (const rel of verdict.outsideClosedSet) {
    process.stdout.write(`  outside-closed-set: ${rel}
`);
  }
  for (const rel of verdict.forbiddenCopies) {
    process.stdout.write(`  forbidden-copy: ${rel}
`);
  }
  for (const item of failMissing) {
    process.stdout.write(`  failure-report-missing: ${item}
`);
  }
  return emitFail(
    `quay-init laydown VIOLATES the closed set (${verdict.outsideClosedSet.length} outside, ${verdict.forbiddenCopies.length} forbidden) or the failure path is uncovered (${failMissing.length} missing report item(s))`,
    { evaluated: true, files: rels.length, ...verdict, failureReportMissing: failMissing },
    { json: asJson }
  );
}
if (isDirectEntry(import.meta, void 0, "quay-init-closure-assertion")) {
  process.exitCode = main(process.argv);
}
export {
  CLOSED_SET_ALL,
  CLOSED_SET_DIRS,
  CLOSED_SET_FILES,
  CLOSED_SET_ITEM_STATES,
  FORBIDDEN_PREFIXES,
  QUAY_INIT_REL,
  assertClosure,
  isInClosedSet,
  reportedItems,
  runFailureStateReport,
  runLaydownPaths
};
