import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/checked-in-write-check.ts
import fs2 from "node:fs";
import os from "node:os";
import path3 from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/checked-in-write-check.ts
var DEFAULT_ROOT = repoRoot();
var DEFAULT_TEST_DIR_REL = "plugin/test";
var GUARD_REL = "plugin/scripts/checked-in-write-guard.cjs";
var RUNNER_REL = "plugin/scripts/checked-in-write-run.cjs";
var DEFAULT_TIMEOUT_MS = 3e5;
var DELTA_BASE_CANDIDATES = ["develop", "origin/develop", "master", "origin/master"];
function parseGuardLog(text) {
  let guardLoaded = 0;
  let judgedCalls = 0;
  const opened = /* @__PURE__ */ new Set();
  const evaluated = /* @__PURE__ */ new Set();
  const unread = [];
  const violations = [];
  const badLines = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try {
      rec = JSON.parse(t);
    } catch {
      badLines.push(t);
      continue;
    }
    if (rec.guardLoaded) {
      guardLoaded++;
      continue;
    }
    if (typeof rec.judgedTotal === "number") {
      judgedCalls += rec.judgedTotal;
      continue;
    }
    if (typeof rec.moduleOpened === "string") {
      opened.add(rec.moduleOpened);
      continue;
    }
    if (typeof rec.evaluated === "string") {
      evaluated.add(rec.evaluated);
      continue;
    }
    if (typeof rec.evaluationFailed === "string") {
      unread.push({ input: rec.evaluationFailed, error: String(rec.error ?? "") });
      continue;
    }
    if (typeof rec.fn === "string" && typeof rec.target === "string") {
      violations.push({
        fn: rec.fn,
        target: rec.target,
        located: String(rec.located ?? rec.target),
        rawArg: String(rec.rawArg ?? ""),
        cwd: String(rec.cwd ?? ""),
        stack: String(rec.stack ?? "")
      });
    }
  }
  return { guardLoaded, judgedCalls, opened, evaluated, unread, violations, badLines };
}
function listInputs(dir) {
  let entries;
  try {
    entries = fs2.readdirSync(dir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith(".test.mjs")).map((f) => path3.join(dir, f)).sort();
}
function runGit(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim() };
}
function resolveDeltaBase(root, override) {
  const candidates = override ? [override] : [...DELTA_BASE_CANDIDATES];
  for (const c of candidates) {
    if (runGit(root, ["rev-parse", "--verify", "--quiet", `${c}^{commit}`]).ok) return c;
  }
  return null;
}
function changedTestInputs(root, override) {
  const base = resolveDeltaBase(root, override);
  if (!base) {
    return {
      base: null,
      inputs: [],
      deltaPaths: [],
      notEvaluated: `no delta base ref resolved (tried ${(override ? [override] : DELTA_BASE_CANDIDATES).join(", ")}) \u2014 cannot tell which files this change touched`
    };
  }
  const committed = runGit(root, ["diff", "--name-only", `${base}...HEAD`]);
  const working = runGit(root, ["diff", "--name-only", "HEAD"]);
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"]);
  for (const [what, r] of [["diff base...HEAD", committed], ["diff HEAD", working], ["ls-files --others", untracked]]) {
    if (!r.ok) return { base, inputs: [], deltaPaths: [], notEvaluated: `git ${what} failed in ${root}` };
  }
  const deltaPaths = [...new Set(
    [committed.out, working.out, untracked.out].flatMap((t) => t.split("\n")).map((s) => s.trim()).filter(Boolean)
  )].sort();
  const inputs = deltaPaths.filter((p) => p.endsWith(".test.mjs") || p.endsWith(".test.ts")).map((p) => path3.resolve(root, p)).filter((abs) => fs2.existsSync(abs));
  return { base, inputs, deltaPaths };
}
function checkCheckedInWrites(opts) {
  const root = path3.resolve(opts.root);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scanDir = path3.resolve(root, opts.dir ?? DEFAULT_TEST_DIR_REL);
  const files = (opts.files && opts.files.length > 0 ? opts.files : listInputs(scanDir)).map((f) => path3.resolve(f));
  const empty = (reason) => ({
    ok: false,
    evaluated: false,
    notEvaluatedReason: reason,
    inputs: files,
    evaluatedInputs: [],
    opened: [],
    unread: [],
    judgedCalls: 0,
    violations: [],
    childStatuses: []
  });
  if (files.length === 0) {
    return empty(`no input files matched under ${scanDir} \u2014 nothing was judged`);
  }
  const guard = path3.resolve(root, GUARD_REL);
  if (!fs2.existsSync(guard)) return empty(`the runtime guard is missing: ${guard}`);
  const runner = path3.resolve(root, RUNNER_REL);
  if (!fs2.existsSync(runner)) return empty(`the per-input runner is missing: ${runner}`);
  const missing = files.filter((f) => !fs2.existsSync(f));
  if (missing.length > 0) return empty(`input file(s) unreadable: ${missing.join(", ")}`);
  const logDir = fs2.mkdtempSync(path3.join(os.tmpdir(), "checked-in-write-check-"));
  const logPath = path3.join(logDir, "guard.jsonl");
  const spawnInput = opts.spawnInput ?? ((input, o) => {
    const res = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--require", o.guard, o.runner],
      {
        cwd: o.root,
        env: {
          ...process.env,
          // QUAY_TEST_NESTED / _ROOT — the judged child is NOT inside a suite, but it must behave
          // like a nested suite invocation for two reasons, and this is the same marker
          // scripts/test.sh:mark_nested() sets: (1) RECURSION — a test file that spawns
          // `scripts/test.sh` would otherwise re-enter run_static_checks, which is where THIS
          // checker is wired, and loop (checker → test.sh → checker → …); (2) SEMANTICS — inside a
          // real suite a nested invocation skips the whole-store work the OUTER pass already ran
          // (run_static_checks / build_dist_once), and this checker IS an outer whole-store pass,
          // so the nested run must skip exactly the same work. QUAY_TEST_NESTED_ROOT = this judged
          // root keeps test.sh's own same-root guard intact: a child that spawns test.sh in a
          // DIFFERENT tree still pays that tree's checks.
          QUAY_TEST_NESTED: "1",
          QUAY_TEST_NESTED_ROOT: o.root,
          QUAY_WRITE_GUARD_ROOT: o.root,
          QUAY_WRITE_GUARD_LOG: o.logPath,
          QUAY_WRITE_GUARD_WATCH: input,
          QUAY_WRITE_GUARD_INPUT: input
        },
        encoding: "utf8",
        timeout: o.timeoutMs,
        maxBuffer: 64 * 1024 * 1024
      }
    );
    if (res.error && res.error.code === "ETIMEDOUT") {
      fs2.appendFileSync(o.logPath, JSON.stringify({ evaluationFailed: input, error: `timeout after ${o.timeoutMs}ms` }) + "\n");
      return null;
    }
    return res.status;
  });
  const childStatuses = [];
  for (const input of files) childStatuses.push(spawnInput(input, { guard, runner, logPath, root, timeoutMs }));
  let text = "";
  try {
    text = fs2.readFileSync(logPath, "utf8");
  } catch {
    text = "";
  }
  const parsed = parseGuardLog(text);
  try {
    fs2.rmSync(logDir, { recursive: true, force: true });
  } catch {
  }
  const base = {
    inputs: files,
    evaluatedInputs: [...parsed.evaluated].sort(),
    opened: [...parsed.opened].sort(),
    unread: parsed.unread,
    judgedCalls: parsed.judgedCalls,
    violations: parsed.violations,
    childStatuses
  };
  if (parsed.guardLoaded === 0) {
    const sample = text.split("\n").filter(Boolean).slice(0, 2).join(" | ").slice(0, 300);
    return {
      ...base,
      ok: false,
      evaluated: false,
      notEvaluatedReason: `the runtime guard never loaded (no guardLoaded marker; child status(es) ${JSON.stringify(childStatuses)}) \u2014 the ${files.length} input(s) were not judged. First log line(s): ${sample || "<log empty>"}`
    };
  }
  if (parsed.unread.length > 0) {
    const first = parsed.unread.slice(0, 3).map((u) => `${u.input} (${u.error})`).join("; ");
    return {
      ...base,
      ok: false,
      evaluated: false,
      notEvaluatedReason: `${parsed.unread.length}/${files.length} input(s) did not finish evaluation \u2014 a file that never loaded performs no writes, which is UNREAD, not clean: ${first}`
    };
  }
  const evaluatedSet = new Set([...parsed.evaluated].map((p) => path3.resolve(p)));
  const openedSet = new Set([...parsed.opened].map((p) => path3.resolve(p)));
  const unexplained = files.filter((f) => !evaluatedSet.has(f) || !openedSet.has(f));
  if (unexplained.length > 0) {
    return {
      ...base,
      ok: false,
      evaluated: false,
      notEvaluatedReason: `${unexplained.length}/${files.length} input(s) have no confirmed evaluation+open pair \u2014 the two independent readings disagree, so nothing is claimed about them: ${unexplained.slice(0, 5).join(", ")}`
    };
  }
  return { ...base, ok: parsed.violations.length === 0, evaluated: true };
}
function parseArgs2(argv) {
  const { flags, lists, args } = parseArgs(argv, {
    minArgs: 0,
    usage: "[--root <dir>] [--dir <dir>] [--files <f> [<f>\u2026]] [--changed [--base <ref>]] [--json] [--timeout-ms <n>]",
    unknown: "reject",
    flags: {
      root: { type: "string" },
      dir: { type: "string" },
      files: { type: "string[]", greedy: true },
      changed: { type: "boolean" },
      base: { type: "string" },
      json: { type: "boolean" },
      "timeout-ms": { type: "string" }
    }
  });
  if (args.length > 0) {
    console.error(`unknown: ${args[0]}`);
    process.exit(2);
  }
  const rawTimeout = flags["timeout-ms"];
  const timeoutMs = typeof rawTimeout === "string" && rawTimeout !== "" ? Number(rawTimeout) : void 0;
  const files = lists?.files ?? [];
  const dir = typeof flags.dir === "string" ? flags.dir : void 0;
  const base = typeof flags.base === "string" ? flags.base : void 0;
  const changed = flags.changed === true;
  if (changed && (files.length > 0 || dir !== void 0)) {
    console.error("--changed selects its own inputs from the git delta; it cannot be combined with --files/--dir");
    process.exit(2);
  }
  return {
    root: typeof flags.root === "string" ? flags.root : DEFAULT_ROOT,
    dir,
    files,
    json: flags.json === true,
    timeoutMs,
    changed,
    base
  };
}
function main(argv) {
  const { root, dir, files, json, timeoutMs, changed, base } = parseArgs2(argv);
  if (changed) {
    const selection = changedTestInputs(root, base);
    if (selection.notEvaluated) {
      return changedNotEvaluated(
        `--changed: ${selection.notEvaluated}`,
        { evaluated: false, inputs: selection.inputs, deltaPaths: selection.deltaPaths },
        json
      );
    }
    if (selection.inputs.length === 0) {
      return changedNotEvaluated(
        `--changed: the delta against ${selection.base} carries no existing *.test.mjs/*.test.ts file (${selection.deltaPaths.length} delta path(s) considered) \u2014 nothing was judged`,
        { evaluated: false, base: selection.base, deltaPaths: selection.deltaPaths },
        json
      );
    }
    const res2 = checkCheckedInWrites({ root, files: selection.inputs, timeoutMs });
    return render(res2, json, { changed: true, base: selection.base, deltaPaths: selection.deltaPaths });
  }
  const res = checkCheckedInWrites({ root, files, dir, timeoutMs });
  return render(res, json);
}
function changedNotEvaluated(message, detail, json) {
  emitNotEvaluated(message, detail, { json, stream: json ? "stdout" : "stderr" });
  return 0;
}
function render(res, json, changed) {
  const detail = changed ? { ...res, ...changed } : res;
  if (!res.evaluated) {
    const code = emitNotEvaluated(res.notEvaluatedReason ?? "could not evaluate the checked-in-write surface", detail, {
      json,
      stream: json ? "stdout" : "stderr"
    });
    return changed ? 0 : code;
  }
  if (res.ok) {
    const message = changed ? `no checked-in-tree writes: ${res.judgedCalls} write-verb call(s) across ${res.inputs.length} executed input(s), 0 inside the tree \u2014 delta against ${changed.base} (${res.inputs.length} of ${changed.deltaPaths.length} delta path(s) judged; unchanged test files are NOT judged by --changed)` : `no checked-in-tree writes: ${res.judgedCalls} write-verb call(s) across ${res.inputs.length} executed input(s), 0 inside the tree`;
    return emitPass(message, detail, { json });
  }
  if (!json) {
    for (const v of res.violations) {
      process.stderr.write(
        v.located === v.target ? `  ${v.fn}(${v.rawArg}) -> ${v.located}
` : `  ${v.fn}(${v.rawArg}) -> ${v.located}  [named: ${v.target}]
`
      );
      for (const line of v.stack.split("\n").filter(Boolean).slice(0, 3)) process.stderr.write(`      ${line.trim()}
`);
    }
  }
  return emitFail(
    `${res.violations.length} write(s) into the checked-in tree across ${res.inputs.length} input(s): ` + res.violations.slice(0, 4).map((v) => `${v.fn} -> ${v.located}`).join("; "),
    detail,
    { json }
  );
}
if (process.argv[1] && fileURLToPath2(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv);
}
export {
  DEFAULT_ROOT,
  DEFAULT_TEST_DIR_REL,
  DEFAULT_TIMEOUT_MS,
  DELTA_BASE_CANDIDATES,
  GUARD_REL,
  RUNNER_REL,
  changedTestInputs,
  checkCheckedInWrites,
  main,
  parseGuardLog,
  resolveDeltaBase
};
