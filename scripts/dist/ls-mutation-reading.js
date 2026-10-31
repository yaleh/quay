#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/ls-mutation-reading.ts
import fs from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/gate-script-base.ts
import path from "node:path";
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/source-text-lib.ts
function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/ls-mutation-reading.ts
var CARRIER_REL = ".quay/ls-readings.jsonl";
var DEFAULT_TIMEOUT_MS = 12e4;
var OPERATORS = [
  "equality-flip",
  "logical-operator",
  "boolean-literal",
  "bracket-empty",
  "string-empty",
  "return-early"
];
function skipQuoted(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === q) return i + 1;
    i++;
  }
  return -1;
}
function findMatching(src, open) {
  const openCh = src[open];
  const closeCh = openCh === "(" ? ")" : openCh === "[" ? "]" : "}";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const after = skipQuoted(src, i);
      if (after === -1) return -1;
      i = after - 1;
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function nextNonWs(src, from) {
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i++;
  return i;
}
function findBodyBrace(src, from) {
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return -1;
      i = nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return -1;
      i = end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const after = skipQuoted(src, i);
      if (after === -1) return -1;
      i = after;
      continue;
    }
    if (c === "(" || c === "[") {
      const m = findMatching(src, i);
      if (m < 0) return -1;
      i = m + 1;
      continue;
    }
    if (c === "{") {
      const m = findMatching(src, i);
      if (m < 0) return -1;
      const after = nextNonWs(src, m + 1);
      const ch = src[after];
      if (ch === "|" || ch === "&" || ch === ",") {
        i = m + 1;
        continue;
      }
      if (ch === "{") {
        i = after;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}
function findFunctionBody(src, name) {
  const esc = escapeRegExp(name);
  const declRe = new RegExp(`(?:^|\\n)[ \\t]*(?:export[ \\t]+)?(?:async[ \\t]+)?function[ \\t]+${esc}[ \\t]*\\(`);
  const decl = declRe.exec(src);
  if (decl) {
    const parenOpen = src.indexOf("(", decl.index + decl[0].length - 1);
    const parenClose = findMatching(src, parenOpen);
    if (parenClose < 0) return null;
    const bodyOpen = findBodyBrace(src, parenClose + 1);
    if (bodyOpen < 0) return null;
    const bodyClose = findMatching(src, bodyOpen);
    if (bodyClose < 0) return null;
    return { bodyStart: bodyOpen + 1, bodyEnd: bodyClose, line: lineOf(src, decl.index) };
  }
  const arrowRe = new RegExp(`(?:^|\\n)[ \\t]*(?:export[ \\t]+)?(?:const|let|var)[ \\t]+${esc}[ \\t]*(?::[^=\\n]*)?=`);
  const arrow = arrowRe.exec(src);
  if (!arrow) return null;
  const arrowIdx = src.indexOf("=>", arrow.index + arrow[0].length);
  if (arrowIdx < 0) return null;
  const afterArrow = nextNonWs(src, arrowIdx + 2);
  if (src[afterArrow] === "{") {
    const close = findMatching(src, afterArrow);
    if (close < 0) return null;
    return { bodyStart: afterArrow + 1, bodyEnd: close, line: lineOf(src, arrow.index) };
  }
  const end = findStatementEnd(src, afterArrow);
  if (end < 0) return null;
  return { bodyStart: afterArrow, bodyEnd: end, line: lineOf(src, arrow.index) };
}
function findStatementEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const after = skipQuoted(src, i);
      if (after === -1) return -1;
      i = after - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) return i;
  }
  return -1;
}
function sitesForOperator(op, src, worker, bodyStart, bodyEnd) {
  const region = src.slice(bodyStart, bodyEnd);
  const out = [];
  const push = (relStart, relEnd, to) => {
    const from = region.slice(relStart, relEnd);
    if (from === to) return;
    const start = bodyStart + relStart;
    out.push({ fn: worker, operator: op, start, end: bodyStart + relEnd, to, from, line: lineOf(src, start) });
  };
  if (op === "equality-flip") {
    for (const m of region.matchAll(/===|!==/g)) {
      push(m.index, m.index + m[0].length, m[0] === "===" ? "!==" : "===");
    }
  } else if (op === "logical-operator") {
    for (const m of region.matchAll(/&&|\|\|/g)) {
      push(m.index, m.index + m[0].length, m[0] === "&&" ? "||" : "&&");
    }
  } else if (op === "boolean-literal") {
    for (const m of region.matchAll(/\b(true|false)\b/g)) {
      push(m.index, m.index + m[0].length, m[0] === "true" ? "false" : "true");
    }
  } else if (op === "bracket-empty") {
    for (const m of region.matchAll(/\[[^[\]]*\]/g)) {
      if (m[0].length <= 2) continue;
      push(m.index, m.index + m[0].length, "[]");
    }
  } else if (op === "string-empty") {
    for (const m of region.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)) {
      if (m[0].length <= 2) continue;
      push(m.index, m.index + m[0].length, '""');
    }
  } else if (op === "return-early") {
    const m = /\breturn\b/.exec(region);
    if (m) {
      const exprStart = nextNonWs(region, m.index + m[0].length);
      if (region[exprStart] !== ";") {
        const end = findStatementEnd(region, exprStart);
        if (end > exprStart) push(exprStart, end, "");
      }
    }
  }
  return out;
}
function collectMutantSites(src, functions, operators) {
  const out = [];
  for (const fn of functions) {
    const body = findFunctionBody(src, fn);
    if (!body) continue;
    for (const op of operators) out.push(...sitesForOperator(op, src, fn, body.bodyStart, body.bodyEnd));
  }
  return out;
}
function applySite(src, site) {
  return src.slice(0, site.start) + site.to + src.slice(site.end);
}
function copyTree(src, dst) {
  fs.cpSync(src, dst, {
    recursive: true,
    filter: (p) => !/(^|\/)(node_modules|\.git)(\/|$)/.test(p)
  });
}
function buildSandbox(root, rels) {
  const dir = fs.mkdtempSync(path2.join(os.tmpdir(), "ls-mutation-reading-"));
  const tops = new Set(rels.map((r) => r.split("/")[0]));
  for (const top of tops) {
    const from = path2.join(root, top);
    const to = path2.join(dir, top);
    const st = fs.statSync(from);
    if (st.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
  const pkg = path2.join(root, "package.json");
  if (fs.existsSync(pkg) && !tops.has("package.json")) fs.copyFileSync(pkg, path2.join(dir, "package.json"));
  const nm = path2.join(root, "node_modules");
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path2.join(dir, "node_modules"), "dir");
  return dir;
}
function runTestOnce(cwd, testRel, timeoutMs) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "NODE_TEST_CONTEXT" || key === "NODE_TEST_WORKER_ID") delete env[key];
  }
  const res = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=tap", testRel], {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024
  });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  if (res.error && res.error.code === "ETIMEDOUT") {
    return { verdict: "not-evaluated", exitCode: null, detail: "timeout" };
  }
  if (res.error) return { verdict: "not-evaluated", exitCode: null, detail: `spawn-error:${res.error.message}` };
  const fail = /^# fail (\d+)$/m.exec(stdout);
  const pass = /^# pass (\d+)$/m.exec(stdout);
  const failed = fail ? Number(fail[1]) : 0;
  const passed = pass ? Number(pass[1]) : 0;
  const output = stdout + stderr;
  const loadFailure = /SyntaxError|ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED|Cannot find module|Unexpected token|Unexpected end of input/.test(output);
  if (loadFailure) return { verdict: "not-evaluated", exitCode: res.status, detail: "load-or-parse-failure" };
  if (failed >= 1 && passed >= 1) return { verdict: "killed", exitCode: res.status, detail: `fail:${failed}/${passed + failed}` };
  if (failed === 0 && passed >= 1 && res.status === 0) {
    return { verdict: "survived", exitCode: res.status, detail: `pass:${passed}` };
  }
  return { verdict: "not-evaluated", exitCode: res.status, detail: "no-test-ran" };
}
function gitHead(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}
function takeReading(args) {
  const root = path2.resolve(args.root);
  const targetAbs = path2.join(root, args.target);
  const testAbs = path2.join(root, args.test);
  if (!fs.existsSync(targetAbs)) throw new Error(`target-not-found: ${args.target}`);
  if (!fs.existsSync(testAbs)) throw new Error(`test-not-found: ${args.test}`);
  const operators = args.operators && args.operators.length > 0 ? args.operators : OPERATORS;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const src = fs.readFileSync(targetAbs, "utf8");
  const missing = args.functions.filter((fn) => findFunctionBody(src, fn) === null);
  if (missing.length > 0) throw new Error(`functions-not-found: ${missing.join(",")}`);
  const sites = collectMutantSites(src, args.functions, operators);
  if (sites.length === 0) throw new Error("no-mutants: no operator matched inside the named functions");
  const sandbox = buildSandbox(root, [args.target, args.test]);
  const sandboxTarget = path2.join(sandbox, args.target);
  const sandboxTest = args.test.split(path2.sep).join("/");
  try {
    fs.mkdirSync(path2.dirname(sandboxTarget), { recursive: true });
    fs.writeFileSync(sandboxTarget, src);
    const baseline = runTestOnce(sandbox, sandboxTest, timeoutMs);
    if (baseline.verdict !== "survived") {
      throw new Error(`baseline-not-green: ${baseline.detail} (a red baseline makes every kill meaningless)`);
    }
    const verdicts = [];
    for (const site of sites) {
      fs.writeFileSync(sandboxTarget, applySite(src, site));
      const outcome = runTestOnce(sandbox, sandboxTest, timeoutMs);
      verdicts.push({ site, verdict: outcome.verdict, detail: outcome.detail });
    }
    fs.writeFileSync(sandboxTarget, src);
    return { reading: summarize(args, operators, sites, verdicts, root), sites, verdicts };
  } finally {
    if (args.keepSandbox) process.stderr.write(`ls-mutation-reading: sandbox kept at ${sandbox}
`);
    else fs.rmSync(sandbox, { recursive: true, force: true });
  }
}
function summarize(args, operators, sites, verdicts, root) {
  const killed = verdicts.filter((v) => v.verdict === "killed").length;
  const survived = verdicts.filter((v) => v.verdict === "survived").length;
  const notEvaluated = verdicts.filter((v) => v.verdict === "not-evaluated").length;
  const denominator = sites.length - notEvaluated;
  return {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    head: gitHead(root),
    target: args.target.split(path2.sep).join("/"),
    functions: [...args.functions],
    operators: [...operators],
    mutants: sites.length,
    killed,
    survived,
    notEvaluated,
    score: denominator > 0 ? Number((killed / denominator).toFixed(4)) : null,
    survivors: verdicts.filter((v) => v.verdict === "survived").map((v) => ({ fn: v.site.fn, line: v.site.line, operator: v.site.operator }))
  };
}
function appendReading(carrierPath, reading) {
  fs.mkdirSync(path2.dirname(carrierPath), { recursive: true });
  fs.appendFileSync(carrierPath, JSON.stringify(reading) + "\n");
}
function usage() {
  return [
    "ls-mutation-reading \u2014 the first L_S (behaviour-variance) reading on product code (observation only; no gate, no threshold)",
    "",
    "  node --experimental-strip-types plugin/scripts/ls-mutation-reading.ts \\",
    "    --target <repo-relative source file> --functions <a,b,c> --test <repo-relative test file>",
    "",
    "Options:",
    "  --root <dir>         workspace root (default: cwd); carrier and git HEAD resolve here",
    "  --operators <list>   comma-separated subset of: " + OPERATORS.join(","),
    "  --timeout-ms <n>     per-mutant timeout (default " + DEFAULT_TIMEOUT_MS + ")",
    "  --carrier <path>     carrier path (default: <root>/" + CARRIER_REL + ")",
    "  --json               print the reading record as JSON on stdout",
    "  --keep-sandbox       keep the temp sandbox (debugging)",
    "  --help               print this text",
    "",
    "Exit: 0 reading taken (whatever the score); 2 usage error; 3 NOT-EVALUATED (inputs unreadable,",
    "      a named function missing, the unmutated baseline not green, or the carrier unwritable)."
  ].join("\n");
}
function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage() + "\n");
    return 0;
  }
  const root = path2.resolve(flagValue(argv, "--root") ?? process.cwd());
  const target = flagValue(argv, "--target");
  const test = flagValue(argv, "--test");
  const functions = (flagValue(argv, "--functions") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!target || !test || functions.length === 0) {
    process.stderr.write("ls-mutation-reading: usage error \u2014 --target, --functions and --test are required\n" + usage() + "\n");
    return 2;
  }
  const operatorArg = flagValue(argv, "--operators");
  const operators = operatorArg ? operatorArg.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    if (!OPERATORS.includes(s)) throw new Error(`unknown-operator: ${s}`);
    return s;
  }) : [...OPERATORS];
  const timeoutRaw = flagValue(argv, "--timeout-ms");
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    process.stderr.write("ls-mutation-reading: usage error \u2014 --timeout-ms must be a positive number\n");
    return 2;
  }
  const carrier = path2.resolve(flagValue(argv, "--carrier") ?? path2.join(root, CARRIER_REL));
  try {
    const { reading } = takeReading({
      root,
      target,
      functions,
      test,
      operators,
      timeoutMs,
      keepSandbox: argv.includes("--keep-sandbox")
    });
    appendReading(carrier, reading);
    if (argv.includes("--json")) {
      process.stdout.write(JSON.stringify(reading) + "\n");
    } else {
      process.stdout.write(
        `ls-mutation-reading: ${reading.target} | mutants=${reading.mutants} killed=${reading.killed} survived=${reading.survived} notEvaluated=${reading.notEvaluated} score=${reading.score === null ? "null" : reading.score}
  carrier: ${carrier}
` + (reading.survivors.length > 0 ? `  survivors:
${reading.survivors.map((s) => `    ${s.fn}:${s.line} ${s.operator}`).join("\n")}
` : "")
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(`ls-mutation-reading: NOT-EVALUATED \u2014 ${err.message}
`);
    return 3;
  }
}
var invokedDirectly = (() => {
  try {
    return isDirectEntry(import.meta, void 0, "ls-mutation-reading");
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
export {
  CARRIER_REL,
  DEFAULT_TIMEOUT_MS,
  OPERATORS,
  appendReading,
  applySite,
  buildSandbox,
  collectMutantSites,
  findFunctionBody,
  runTestOnce,
  takeReading
};
