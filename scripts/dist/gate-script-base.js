import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function parseArgs(argv, spec) {
  const result = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};
  const unknownMode = spec.unknown ?? (spec.strict ? "reject" : "accept");
  const scriptName = path.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    if (spec.help === "return") {
      result.help = true;
      return result;
    }
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }
  const usageError = (message) => {
    if (spec.errors === "return") {
      result.error = message;
      return result;
    }
    console.error(message);
    process.exit(2);
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (!def && unknownMode === "reject") return usageError(`unknown argument: --${name}`);
      if (!def && unknownMode === "skip") continue;
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (def?.type === "string[]") {
        if (!result.lists) result.lists = {};
        const list = result.lists[name] ??= [];
        if (eqIdx >= 0) list.push(a.slice(eqIdx + 1));
        else if (def.greedy) {
          while (i + 1 < raw.length && !raw[i + 1].startsWith("--")) list.push(raw[++i]);
        } else if (i + 1 < raw.length) list.push(raw[++i]);
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }
  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    return usageError(`Usage: ${scriptName} ${spec.usage}`);
  }
  return result;
}
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function resolveRoot(rootArg) {
  return path.resolve(rootArg ?? process.cwd());
}
function parseJsonArg(raw, makeError) {
  let s = raw;
  if (s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  try {
    return JSON.parse(s);
  } catch {
    const message = `invalid JSON argument: ${raw}`;
    throw makeError ? makeError("invalid-json", message) : new Error(message);
  }
}
function readFrontmatter(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const front = {};
  for (const line of m[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    if (value === "" || value === "[]" || value === "null") {
      value = value === "null" ? null : value === "[]" ? [] : "";
    } else if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    }
    front[key] = value;
  }
  return front;
}
function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function readJsonLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) rows.push(v);
    } catch {
    }
  }
  return rows;
}
function readJsonlLines(file) {
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push({ __unparseable: true });
    }
  }
  return out;
}
function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function normalizeRel(p) {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}
function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
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
function requireArg(value, name) {
  if (value === void 0 || value === null || value === "") {
    console.error(`ERROR: ${name} is required`);
    process.exit(2);
  }
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}
function git(args, cwd) {
  try {
    const stdout = execSync(`git ${args.join(" ")}`, { cwd, encoding: "utf8", timeout: 1e4 }).trim();
    return { ok: true, stdout };
  } catch (e) {
    return { ok: false, stdout: "", error: e.message };
  }
}
function gitLastCommitForPath(cwd, relPath) {
  const result = git(["log", "-1", "--format=%H", "--", relPath], cwd);
  return result.ok ? result.stdout : "";
}
function serializeSortedJson(value) {
  const source = value;
  const sorted = {};
  for (const key of Object.keys(source).sort()) {
    const v = source[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = {};
      for (const k of Object.keys(v).sort()) {
        nested[k] = v[k];
      }
      sorted[key] = nested;
    } else {
      sorted[key] = v;
    }
  }
  return JSON.stringify(sorted);
}
function createSelftest(opts) {
  const { flavor, label, verb = "selftest", collectFailures = false, dumpFailuresJson = false } = opts;
  let pass = 0;
  let fail = 0;
  let allPassed = true;
  const failures = [];
  const check = (name, condition, detail) => {
    if (condition) {
      pass++;
      if (flavor !== "counters") console.log(`SELFTEST PASS: ${name} \u2014 ${detail}`);
      return;
    }
    fail++;
    allPassed = false;
    if (flavor === "counters") {
      console.error(`FAIL: ${name}${detail ? ` \u2014 ${detail}` : ""}`);
      return;
    }
    console.error(`SELFTEST FAIL: ${name} \u2014 ${detail}`);
    if (collectFailures) failures.push({ name, detail });
  };
  const report = () => {
    if (flavor === "counters") {
      console.log(`
${label} --${verb}: ${pass} passed, ${fail} failed`);
      return fail === 0;
    }
    if (flavor === "cases-period") {
      if (allPassed) {
        console.log("SELFTEST: all fixture cases PASS.");
        return true;
      }
      console.error("SELFTEST: one or more fixture cases FAILED.");
      return false;
    }
    console.log(`
SELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
    if (dumpFailuresJson && !allPassed) console.log(JSON.stringify({ ok: false, failures }));
    return allPassed;
  };
  return {
    check,
    get pass() {
      return pass;
    },
    get fail() {
      return fail;
    },
    get allPassed() {
      return allPassed;
    },
    get failures() {
      return failures;
    },
    report
  };
}
export {
  VERDICT_EXIT_CODE,
  createSelftest,
  emitFail,
  emitNotEvaluated,
  emitPass,
  emitVerdict,
  flagValue,
  git,
  gitLastCommitForPath,
  helpExit,
  isDirectEntry,
  normalizeRel,
  parseArgs,
  parseJsonArg,
  readFileSafe,
  readFrontmatter,
  readJsonLines,
  readJsonOrNull,
  readJsonlLines,
  requireArg,
  resolveRoot,
  seededRng,
  serializeSortedJson,
  verdictExitCode
};
