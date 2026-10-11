#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/dev-stats-collect.ts
import fs2 from "node:fs";
import path3 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path2 from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/dev-stats-collect.ts
var MARK_START = "<!-- dev-stats:start -->";
var MARK_END = "<!-- dev-stats:end -->";
var REF_LINE_PREFIX = "Snapshot commit: ";
var README_REL = "README.md";
var INSERT_ANCHOR = "## Deeper design and methodology material";
var SCRIPT_REL = "plugin/scripts/dev-stats-collect.ts";
var MIN_REPORTABLE_VALUE = 10;
var STAT_ORDER = [
  "snapshot_date",
  "history_days",
  "tasks_total",
  "tasks_done",
  "tasks_ready",
  "tasks_todo",
  "tasks_needs_human",
  "tasks_superseded",
  "tasks_other",
  "commits_total",
  "scripts_total",
  "goals_total",
  "contributors_total"
];
function git(root, args, opts = {}) {
  try {
    return execFileSync2("git", ["-C", root, "-c", "core.quotepath=false", ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (e) {
    if (opts.allowEmpty && typeof e?.status === "number" && e.status === 1) return "";
    const stderr = typeof e?.stderr === "string" ? e.stderr.trim() : String(e?.message ?? e);
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
}
function lines(s) {
  return s.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
}
function refExists(root, ref) {
  try {
    git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}
function resolveRef(root, ref) {
  return git(root, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}
function collectStats(root, commit) {
  const sha = resolveRef(root, commit);
  const raw = {};
  raw.snapshot_date = git(root, ["log", "-1", "--format=%cs", sha]).trim();
  const rootTimes = lines(git(root, ["log", "--format=%ct", "--max-parents=0", sha])).map((n) => Number(n));
  const refTime = Number(git(root, ["log", "-1", "--format=%ct", sha]).trim());
  if (rootTimes.length > 0 && Number.isFinite(refTime)) {
    raw.history_days = Math.floor((refTime - Math.min(...rootTimes)) / 86400);
  }
  const taskFiles = lines(git(root, ["ls-tree", "-r", "--name-only", sha, "--", "tasks"])).filter(
    (p) => p.endsWith(".md")
  );
  raw.tasks_total = taskFiles.length;
  const statusOut = lines(git(root, ["grep", "-m1", "-E", "^status: ", sha, "--", "tasks"], { allowEmpty: true }));
  const byStatus = /* @__PURE__ */ new Map();
  let statusFiles = 0;
  for (const raw2 of statusOut) {
    const line = raw2.startsWith(`${sha}:`) ? raw2.slice(sha.length + 1) : raw2;
    const i = line.indexOf(":");
    if (i < 0) continue;
    if (!line.slice(0, i).endsWith(".md")) continue;
    const m = /^status:[ \t]*(.+?)[ \t]*$/.exec(line.slice(i + 1));
    if (!m) continue;
    statusFiles += 1;
    byStatus.set(m[1], (byStatus.get(m[1]) ?? 0) + 1);
  }
  if (taskFiles.length > 0 && statusFiles === 0) {
    throw new Error(`cannot read task statuses at ${sha} (${taskFiles.length} task files, 0 status lines)`);
  }
  const named = ["done", "ready", "todo", "needs-human", "superseded"];
  let namedTotal = 0;
  for (const s of named) {
    const n = byStatus.get(s) ?? 0;
    namedTotal += n;
    raw[`tasks_${s.replace(/-/g, "_")}`] = n;
  }
  raw.tasks_other = taskFiles.length - namedTotal;
  raw.commits_total = Number(git(root, ["rev-list", "--count", sha]).trim());
  raw.scripts_total = lines(git(root, ["ls-tree", "-r", "--name-only", sha, "--", "plugin/scripts"])).filter(
    (p) => p.endsWith(".ts")
  ).length;
  raw.goals_total = lines(git(root, ["ls-tree", "-r", "--name-only", sha, "--", "goals"])).filter(
    (p) => p.endsWith(".md")
  ).length;
  raw.contributors_total = lines(git(root, ["shortlog", "-sn", sha])).length;
  const out = {};
  for (const k of STAT_ORDER) {
    const v = raw[k];
    if (v === void 0) continue;
    if (typeof v === "number" && Math.abs(v) < MIN_REPORTABLE_VALUE) continue;
    if (typeof v === "string" && v === "") continue;
    out[k] = v;
  }
  return out;
}
function renderBlock(stats, commit) {
  const keys = [
    ...STAT_ORDER.filter((k) => k in stats),
    ...Object.keys(stats).filter((k) => !STAT_ORDER.includes(k)).sort()
  ];
  return [
    MARK_START,
    `${REF_LINE_PREFIX}${commit}`,
    ...keys.map((k) => `- ${k}: ${stats[k]}`),
    MARK_END
  ].join("\n");
}
var EMPTY_BLOCK = { found: false, text: "", commit: null, entries: {}, reason: "absent" };
function parseBlock(readmeText) {
  const all = readmeText.split("\n");
  const startIdx = all.indexOf(MARK_START);
  const endIdx = all.indexOf(MARK_END);
  if (startIdx === -1) return { ...EMPTY_BLOCK };
  if (endIdx === -1) return { ...EMPTY_BLOCK, reason: "unterminated" };
  if (endIdx < startIdx) return { ...EMPTY_BLOCK, reason: "reversed" };
  const body = all.slice(startIdx + 1, endIdx);
  const entries = {};
  let commit = null;
  for (const line of body) {
    const ref = new RegExp(`^${REF_LINE_PREFIX}([0-9a-f]{40})$`).exec(line);
    if (ref) commit = ref[1];
    const m = /^- ([A-Za-z0-9_]+):[ \t]*(.*)$/.exec(line);
    if (m) entries[m[1]] = m[2];
  }
  return { found: true, text: body.join("\n"), commit, entries, reason: null };
}
function compareBlock(fresh, blockText) {
  const missing = Object.keys(fresh).filter((k) => !blockText.includes(String(fresh[k])));
  const extra = Object.keys(parseBlock([MARK_START, blockText, MARK_END].join("\n")).entries).filter(
    (k) => !(k in fresh)
  );
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}
function writeBlockInto(readmeText, block) {
  const cur = parseBlock(readmeText);
  if (cur.found) {
    const all2 = readmeText.split("\n");
    const s = all2.indexOf(MARK_START);
    const e = all2.indexOf(MARK_END);
    return [...all2.slice(0, s), ...block.split("\n"), ...all2.slice(e + 1)].join("\n");
  }
  if (cur.reason !== "absent") {
    throw new Error(`README has a malformed dev-stats block (${cur.reason}) \u2014 fix it by hand, not by guessing`);
  }
  const all = readmeText.split("\n");
  const at = all.indexOf(INSERT_ANCHOR);
  if (at === -1) {
    throw new Error(`README has neither a dev-stats block nor the insertion anchor (${INSERT_ANCHOR})`);
  }
  const section = [
    "## Development process statistics",
    "",
    "Machine-generated from this repository's **tracked** development carriers (git history,",
    "`tasks/*.md`, `goals/*.md`, `plugin/scripts/*.ts`) by",
    "[`plugin/scripts/dev-stats-collect.ts`](plugin/scripts/dev-stats-collect.ts). The block is a",
    "snapshot pinned to the commit it names, so the values are stable and any hand-edited number",
    "stops matching \u2014 `--check` fails on that drift. Regenerate with `--write`; never edit by hand.",
    "",
    block,
    ""
  ];
  return [...all.slice(0, at), ...section, ...all.slice(at)].join("\n");
}
var USAGE = `\u7528\u6CD5:
  node --experimental-strip-types ${SCRIPT_REL} --json [--ref <commit>] [--root <dir>]
  node --experimental-strip-types ${SCRIPT_REL} --write [--ref <commit>] [--root <dir>] [--readme <path>]
  node --experimental-strip-types ${SCRIPT_REL} --check [--json] [--root <dir>] [--readme <path>]
\u8BF4\u660E: \u5FEB\u7167\u70B9 = README \u5757\u91CC\u5199\u7684\u90A3\u4E2A\u63D0\u4EA4\uFF08\u65E0\u5757\u65F6\u53D6 HEAD\uFF09\uFF1B--ref <commit> \u663E\u5F0F\u6307\u5B9A\uFF08\u79FB\u52A8\u5FEB\u7167\u70B9
      \u5230\u5F53\u524D\u70B9\u7528 --ref HEAD\uFF0C\u8FD9\u662F\u552F\u4E00\u4F1A\u8BA9\u6570\u5B57\u968F\u4ED3\u5E93\u524D\u8FDB\u7684\u5199\u6CD5\uFF09\u3002
      --json \u6253\u5370\u6241\u5E73\u6807\u91CF\u7EDF\u8BA1 JSON\uFF1B--write \u5728\u5FEB\u7167\u70B9\u4E0A\u91CD\u751F\u6210\u6807\u8BB0\u5757\uFF08\u4EBA\u4E0D\u5F97\u624B\u586B\uFF1B\u540C\u4E00\u5FEB\u7167\u70B9\u91CD\u590D
      \u751F\u6210\u9010\u5B57\u8282\u76F8\u540C\uFF09\uFF1B--check \u6BD4\u5BF9\u300C\u91CD\u7B97\u503C vs \u5757\u5185\u503C\u300D\uFF0C\u6F02\u79FB\u65F6 exit 1 \u4E14 stderr \u5E26
      CAUSE=stats-drift\u3002`;
function parseCli(argv) {
  let mode = null;
  let root = "";
  let readme = "";
  let ref = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE + "\n");
      process.exit(0);
    } else if (a === "--json") json = true;
    else if (a === "--write") mode = "write";
    else if (a === "--check") mode = "check";
    else if (a === "--ref") ref = argv[++i] ?? "";
    else if (a === "--root") root = argv[++i] ?? "";
    else if (a === "--readme") readme = argv[++i] ?? "";
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!mode) mode = "json";
  return {
    mode,
    root: root ? path3.resolve(root) : repoRoot(),
    readme: readme ? path3.resolve(readme) : "",
    ref: ref || null,
    json
  };
}
function fail(code, cause, detail) {
  process.stderr.write(`CAUSE=${cause} \u2014 ${detail}
`);
  process.exit(code);
}
function main(argv) {
  let cli;
  try {
    cli = parseCli(argv);
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}
${USAGE}
`);
    return 2;
  }
  const readmePath = cli.readme || path3.join(cli.root, README_REL);
  const readmeExists = fs2.existsSync(readmePath);
  const readmeText = readmeExists ? fs2.readFileSync(readmePath, "utf8") : "";
  const block = readmeExists ? parseBlock(readmeText) : EMPTY_BLOCK;
  const wantRef = cli.ref ?? (block.found ? block.commit : null);
  const chosen = wantRef ?? "HEAD";
  let commit;
  let stats;
  try {
    if (!refExists(cli.root, chosen)) {
      return fail(2, "snapshot-ref-unresolvable", `cannot resolve ${chosen} in ${cli.root}`);
    }
    commit = resolveRef(cli.root, chosen);
    stats = collectStats(cli.root, commit);
  } catch (e) {
    return fail(2, "stats-unreadable", String(e?.message ?? e));
  }
  if (cli.mode === "json") {
    process.stdout.write(JSON.stringify(stats) + "\n");
    return 0;
  }
  if (cli.mode === "write") {
    if (!readmeExists) return fail(2, "readme-absent", `${readmePath} does not exist`);
    let next;
    try {
      next = writeBlockInto(readmeText, renderBlock(stats, commit));
    } catch (e) {
      return fail(2, "readme-block-unwritable", String(e?.message ?? e));
    }
    fs2.writeFileSync(readmePath, next, "utf8");
    process.stdout.write(`dev-stats: wrote ${Object.keys(stats).length} field(s) pinned to ${commit}
`);
    return 0;
  }
  if (!readmeExists) return fail(2, "readme-marker-absent", `${readmePath} does not exist`);
  if (!block.found) {
    return fail(2, "readme-marker-absent", `README has no complete ${MARK_START}/${MARK_END} block (${block.reason})`);
  }
  if (!block.commit) return fail(2, "snapshot-ref-unresolvable", `block has no "${REF_LINE_PREFIX}<sha>" line`);
  if (!refExists(cli.root, block.commit)) {
    return fail(2, "snapshot-ref-unresolvable", `block names ${block.commit}, which does not resolve in ${cli.root}`);
  }
  const cmp = compareBlock(stats, block.text);
  if (cli.json) process.stdout.write(JSON.stringify({ ...cmp, commit }) + "\n");
  if (!cmp.ok) {
    return fail(
      1,
      "stats-drift",
      `block differs from ${block.commit}: missing=[${cmp.missing.join(",")}] extra=[${cmp.extra.join(",")}]`
    );
  }
  process.stdout.write(`dev-stats: consistent with ${block.commit}
`);
  return 0;
}
if (isDirectEntry(import.meta, process.argv[1], path3.basename(SCRIPT_REL, ".ts"))) {
  process.exit(main(process.argv.slice(2)));
}
export {
  INSERT_ANCHOR,
  MARK_END,
  MARK_START,
  MIN_REPORTABLE_VALUE,
  README_REL,
  REF_LINE_PREFIX,
  SCRIPT_REL,
  STAT_ORDER,
  collectStats,
  compareBlock,
  parseBlock,
  refExists,
  renderBlock,
  resolveRef,
  writeBlockInto
};
