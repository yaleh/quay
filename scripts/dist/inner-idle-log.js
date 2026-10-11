#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/inner-idle-log.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/inner-idle-log.ts
var REPO_ROOT = repoRoot();
function resolveRoot(argv) {
  const idx = argv.indexOf("--root");
  return idx !== -1 && argv[idx + 1] ? path2.resolve(argv[idx + 1]) : REPO_ROOT;
}
var LOG_PATH = path2.join(REPO_ROOT, "orchestration", "inner-idle-log.jsonl");
var VALID_IDLE_REASONS = Object.freeze([
  "awaiting-subagent",
  "queue-empty",
  "awaiting-ruling",
  "rate-limited",
  "no-reason"
]);
var IDLE_REASON_DESCRIPTIONS = {
  "awaiting-subagent": "\u7B49\u5F85\u81EA\u5DF1\u6D3E\u7684 subagent \u8FD4\u56DE \u2014 waiting for a subagent I dispatched",
  "queue-empty": "\u5C31\u7EEA\u961F\u5217\u4E3A\u7A7A\uFF0C\u65E0\u53EF\u6D3E\u4EFB\u52A1 \u2014 no dispatchable task",
  "awaiting-ruling": "\u771F\u6B63\u5728\u7B49\u5916\u5C42\u88C1\u5B9A \u2014 genuinely awaiting an outer ruling",
  "rate-limited": "\u88AB\u9650\u6D41 \u2014 rate limited",
  "no-reason": "\u8BF4\u4E0D\u51FA\u4E3A\u4EC0\u4E48\u2014\u2014\u8BA1\u6570\u672C\u8EAB\u5C31\u662F\u4E0B\u4E00\u8F6E\u8981\u4FEE\u7684\u4E1C\u897F \u2014 can't say why; its count is next round's target"
};
function logPath(root) {
  return path2.join(root, "orchestration", "inner-idle-log.jsonl");
}
function appendLine(root, entry) {
  const p = logPath(root);
  fs2.mkdirSync(path2.dirname(p), { recursive: true });
  fs2.appendFileSync(p, JSON.stringify(entry) + "\n", "utf8");
}
function readLines(root) {
  const p = logPath(root);
  if (!fs2.existsSync(p)) return [];
  return fs2.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
}
function printUsage(stream) {
  stream.write(
    [
      "usage: inner-idle-log.ts <mode> [args]",
      '  --append --reason <enum> --note "<one sentence>"  append an idle entry (ISO `at`)',
      `  --counts                                     per-reason tally (no-reason count = next target)`,
      "  --read                                       print all entries (one JSON line each)",
      `  reason \u2208 {${VALID_IDLE_REASONS.join(", ")}} (fail-closed; invalid reason appends nothing)`,
      ""
    ].join("\n")
  );
}
function main(argv) {
  const root = resolveRoot(argv);
  if (argv.includes("--append")) {
    const reasonIdx = argv.indexOf("--reason");
    const noteIdx = argv.indexOf("--note");
    if (reasonIdx === -1 || noteIdx === -1 || !argv[reasonIdx + 1] || !argv[noteIdx + 1]) {
      process.stderr.write('--append requires --reason <enum> and --note "<text>"\n');
      printUsage(process.stderr);
      return 1;
    }
    const reason = argv[reasonIdx + 1];
    const note = argv[noteIdx + 1];
    if (!VALID_IDLE_REASONS.includes(reason)) {
      process.stderr.write(
        `invalid reason "${reason}" \u2014 must be one of: ${VALID_IDLE_REASONS.join(", ")}
`
      );
      return 1;
    }
    appendLine(root, { at: (/* @__PURE__ */ new Date()).toISOString(), reason, note });
    process.stdout.write(`appended {at: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}, reason: ${reason}}
`);
    return 0;
  }
  if (argv.includes("--counts")) {
    const counts = {};
    for (const r of VALID_IDLE_REASONS) counts[r] = 0;
    for (const e of readLines(root)) {
      if (e && typeof e.reason === "string") counts[e.reason] = (counts[e.reason] ?? 0) + 1;
    }
    for (const r of VALID_IDLE_REASONS) {
      process.stdout.write(`${r}	${counts[r]}
`);
    }
    return 0;
  }
  if (argv.includes("--read")) {
    for (const e of readLines(root)) {
      process.stdout.write(JSON.stringify(e) + "\n");
    }
    return 0;
  }
  printUsage(process.stderr);
  return 1;
}
var isDirect = process.argv[1] && fileURLToPath2(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv.slice(2)));
}
export {
  IDLE_REASON_DESCRIPTIONS,
  VALID_IDLE_REASONS
};
