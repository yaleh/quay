#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/eligible-no-goal-source-check.ts
import fs2 from "node:fs";
import path3 from "node:path";

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
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/eligible-no-goal-source-check.ts
var DEFAULT_SOURCE_REL = "plugin/scripts/ready-pool-check.ts";
var INJECTED_TERM = " && !goalAcMissing";
function liveSurface(src) {
  const n = src.length;
  let out = "";
  let i = 0;
  const blankTo = (end) => {
    while (i < end) {
      out += src[i] === "\n" ? "\n" : " ";
      i++;
    }
  };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blankTo(j);
      continue;
    }
    if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++;
      blankTo(Math.min(n, j + 2));
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += " ";
          i++;
          if (i < n) {
            out += src[i] === "\n" ? "\n" : " ";
            i++;
          }
          continue;
        }
        if (src[i] === quote) {
          out += " ";
          i++;
          break;
        }
        if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
          let depth = 1;
          let j = i + 2;
          while (j < n && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          out += liveSurface(src.slice(i, j));
          i = j;
          continue;
        }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
function readExpression(src, start) {
  let i = start;
  let depth = 0;
  let text = "";
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    }
    if (depth === 0 && (c === "," || c === ";")) break;
    if (c === "\n") {
      const trimmed = text.replace(/\s+$/, "");
      const last = trimmed.slice(-1);
      const incomplete = trimmed === "" || /[&|+\-*/?:(=<>!,]/.test(last);
      if (!incomplete) break;
      text += " ";
      i++;
      continue;
    }
    text += c;
    i++;
  }
  return { text: text.replace(/\s+/g, " ").trim(), endOffset: i };
}
function goalSourceTokens(expression) {
  const hits = [];
  const re = /[A-Za-z_$][\w$]*/g;
  let m;
  while ((m = re.exec(expression)) !== null) {
    if (/goal/i.test(m[0])) hits.push(m[0]);
  }
  return hits;
}
function findMembershipSites(src) {
  const live = liveSurface(src);
  const sites = [];
  const re = /(^|[^\w$.])(eligible)\s*(?::|=(?!=)|\|\|=|&&=)/g;
  let m;
  while ((m = re.exec(live)) !== null) {
    const opEnd = m.index + m[0].length;
    const { text, endOffset } = readExpression(live, opEnd);
    if (!text) continue;
    sites.push({
      line: live.slice(0, m.index).split("\n").length,
      expression: text,
      endOffset,
      goalTokens: goalSourceTokens(text)
    });
    re.lastIndex = endOffset;
  }
  return sites;
}
function judgeSource(src) {
  const sites = findMembershipSites(src);
  if (sites.length === 0) {
    return {
      status: "not-evaluated",
      message: "no `eligible` membership expression found in the live surface \u2014 the invariant cannot be evaluated (\u8BFB\u4E0D\u61C2\u8F93\u5165 \u2260 \u5408\u683C, \u786C\u89C4\u5219\u2462b; the object may have been renamed or restructured)",
      detail: { membership_sites: 0, violating_sites: [] }
    };
  }
  const violating = sites.filter((s) => s.goalTokens.length > 0);
  const detail = {
    membership_sites: sites.length,
    membership_lines: sites.map((s) => s.line),
    violating_sites: violating.map((s) => ({ line: s.line, expression: s.expression, goal_tokens: s.goalTokens }))
  };
  if (violating.length > 0) {
    return {
      status: "fail",
      message: `${violating.length}/${sites.length} promotion membership expression(s) read a GOAL-layer source \u2014 \u51C6\u5165\u96C6\u5408\u5FC5\u987B\u53EA\u7531 task \u81EA\u8EAB\u7684\u81EA\u8DB3\u5C5E\u6027\u51B3\u5B9A\uFF1Bgoal \u4FE1\u606F\u6700\u591A\u6539\u53D8\u96C6\u5408\u5185\u7684\u987A\u5E8F\uFF0C\u6C38\u4E0D\u6539\u53D8\u6210\u5458\u8D44\u683C (\u50F5\u5C38\u4EFB\u52A1\u6210\u56E0, \u4EBA 2026-09-11 \u88C1\u5B9A)`,
      detail
    };
  }
  return {
    status: "pass",
    message: `${sites.length} promotion membership expression(s) scanned \u2014 no goal-layer source in membership`,
    detail
  };
}
function injectGoalSourceFixture(src) {
  const sites = findMembershipSites(src);
  if (sites.length === 0) return null;
  let target = sites[0];
  for (const s of sites) if (s.expression.length > target.expression.length) target = s;
  return src.slice(0, target.endOffset) + INJECTED_TERM + src.slice(target.endOffset);
}
var USAGE = "usage: eligible-no-goal-source-check.ts [--source <path>] [--inject-goal-source-fixture] [--json]\n  judges the promotion admission gate's `eligible` membership expressions carry NO goal-layer source\n  exit 0 = pass \xB7 1 = fail \xB7 3 = NOT-EVALUATED (source unreadable, or no membership expression found)\n";
async function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }
  const json = args.includes("--json");
  const inject = args.includes("--inject-goal-source-fixture");
  let sourceArg = "";
  const sIdx = args.findIndex((a) => a === "--source" || a.startsWith("--source="));
  if (sIdx >= 0) {
    const a = args[sIdx];
    sourceArg = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[sIdx + 1] || "";
  }
  const sourcePath = sourceArg ? path3.resolve(sourceArg) : path3.join(repoRoot(), DEFAULT_SOURCE_REL);
  let src;
  try {
    src = fs2.readFileSync(sourcePath, "utf8");
  } catch (e) {
    const code = emitNotEvaluated(
      `cannot read the judged source ${sourcePath} (${e?.code ?? "unknown"}) \u2014 NOT-EVALUATED, not a pass`,
      { source: sourcePath, reason: "source-unreadable" },
      { json }
    );
    return code;
  }
  if (inject) {
    const mutated = injectGoalSourceFixture(src);
    if (mutated === null) {
      return emitNotEvaluated(
        `--inject-goal-source-fixture: no membership expression to mutate in ${sourcePath} \u2014 the negative control could not be constructed (NOT-EVALUATED, never a pass)`,
        { source: sourcePath, reason: "no-membership-site-to-mutate" },
        { json }
      );
    }
    const r2 = judgeSource(mutated);
    const detail2 = { source: sourcePath, fixture: "goal-source-injected", injected_term: INJECTED_TERM, ...r2.detail };
    if (r2.status === "fail") return emitFail(r2.message, detail2, { json });
    return emitNotEvaluated(
      `negative control did NOT fire \u2014 the injected goal-source term was not detected (verdict ${r2.status}); the checker cannot take the value false`,
      { source: sourcePath, fixture: "goal-source-injected", injected_term: INJECTED_TERM, injected_verdict: r2.status },
      { json }
    );
  }
  const r = judgeSource(src);
  const detail = { source: sourcePath, ...r.detail };
  if (r.status === "pass") return emitPass(r.message, detail, { json });
  if (r.status === "fail") return emitFail(r.message, detail, { json });
  return emitNotEvaluated(r.message, detail, { json });
}
if (isDirectEntry(import.meta, void 0, "eligible-no-goal-source-check")) {
  main(process.argv).then((code) => process.exit(code));
}
export {
  DEFAULT_SOURCE_REL,
  INJECTED_TERM,
  findMembershipSites,
  goalSourceTokens,
  injectGoalSourceFixture,
  judgeSource,
  liveSurface
};
