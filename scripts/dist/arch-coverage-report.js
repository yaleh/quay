#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/arch-coverage-report.ts
import fs2 from "node:fs";
import os from "node:os";
import path3 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
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
function mainCheckoutRoot(startDir = path2.dirname(fileURLToPath(import.meta.url))) {
  const dir = path2.resolve(startDir);
  let commonDir = "";
  try {
    commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    commonDir = "";
  }
  if (!commonDir) {
    try {
      commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], {
        encoding: "utf8",
        timeout: 5e3,
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      return "";
    }
    if (commonDir && !path2.isAbsolute(commonDir)) commonDir = path2.resolve(dir, commonDir);
  }
  if (!commonDir) return "";
  const main2 = path2.dirname(commonDir);
  try {
    return fs.realpathSync(main2);
  } catch {
    return main2;
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/arch-coverage-report.ts
var EXIT_OK = 0;
var EXIT_SELFTEST_FAILED = 1;
var EXIT_NOT_EVALUATED = 2;
var EXIT_USAGE = 3;
var REPORT_GENERATED_AT_PLACEHOLDER = "<generated-at>";
var DEFAULT_MANIFEST_REL = path3.join(".archguard", "query", "manifest.json");
var LANGUAGES = [
  { language: "ts", ext: ".ts", analyzer: "archguard" },
  { language: "mjs", ext: ".mjs", analyzer: null },
  { language: "js", ext: ".js", analyzer: null },
  { language: "sh", ext: ".sh", analyzer: null },
  { language: "py", ext: ".py", analyzer: null }
];
var EXCLUSION_RULES = {
  /** A file whose BASENAME contains this substring is a test file. */
  basenameContains: ".test.",
  /** A file having any of these as a whole path SEGMENT is excluded. Segment equality — not a
   *  substring test — is load-bearing: a substring test on `vendor` wrongly drops
   *  `plugin/scripts/sync-vendor.sh`, which is a real production script (measured: it is the one file
   *  that made a naive caliber read 139 instead of 144). */
  segments: ["node_modules", "dist", "vendor", "checker-mutation-cases"],
  /** Root-anchored only (mirrors the `grep -v '^archive/'` in the AC's own caliber command). */
  rootPrefixes: ["archive/"],
  /** ⛔ Deliberately NOT a rule. The task's Proposal prose lists `/test/` among the exclusions, but its
   *  AC2 pins `sh.trackedFiles` to the output of
   *  `git ls-files '*.sh' | grep -v 'checker-mutation-cases/' | grep -v '^archive/' | wc -l`,
   *  a caliber that RETAINS `test/`, `plugin/test/` and `packages/quay/test/`. Applied together they
   *  disagree by exactly 4 files. The runnable AC wins over the prose (and, independently, a coverage
   *  census should count hand-written test-dir sources rather than hide them). Recorded here so the
   *  divergence is a declared decision, not a silent discrepancy. */
  noteTestDirs: "not excluded \u2014 AC2's caliber retains test/ dirs (see this field's doc comment)"
};
function isExcluded(rel) {
  const segs = rel.split("/");
  const base = segs[segs.length - 1] ?? "";
  if (base.includes(EXCLUSION_RULES.basenameContains)) return true;
  for (const s of segs) if (EXCLUSION_RULES.segments.includes(s)) return true;
  for (const p of EXCLUSION_RULES.rootPrefixes) if (rel.startsWith(p)) return true;
  return false;
}
function listTrackedFiles(root) {
  try {
    const out = execFileSync2("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      timeout: 6e4,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const files = out.split("\0").filter((s) => s !== "").map((s) => s.split(path3.sep).join("/")).sort();
    return { ok: true, files };
  } catch (e) {
    return { ok: false, files: [], error: String(e?.stderr ?? e?.message ?? e) };
  }
}
function censusFiles(tracked) {
  const kept = tracked.filter((f) => !isExcluded(f));
  const byLang = /* @__PURE__ */ new Map();
  for (const spec of LANGUAGES) byLang.set(spec.language, []);
  for (const f of kept) {
    const spec = LANGUAGES.find((s) => f.endsWith(s.ext));
    if (spec) byLang.get(spec.language).push(f);
  }
  return byLang;
}
function parseManifestText(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `manifest is not valid JSON: ${e?.message ?? e}` };
  }
  if (raw === null || typeof raw !== "object" || !Array.isArray(raw.scopes)) {
    return { ok: false, reason: "manifest has no `scopes` array" };
  }
  const scopes = [];
  for (const s of raw.scopes) {
    if (s === null || typeof s !== "object" || typeof s.key !== "string" || !Array.isArray(s.sources)) {
      return { ok: false, reason: `manifest scope entry is malformed (need string key + sources array)` };
    }
    scopes.push({
      key: s.key,
      label: typeof s.label === "string" ? s.label : void 0,
      sources: s.sources.filter((x) => typeof x === "string"),
      entityCount: typeof s.entityCount === "number" ? s.entityCount : 0
    });
  }
  return {
    ok: true,
    manifest: { globalScopeKey: typeof raw.globalScopeKey === "string" ? raw.globalScopeKey : null, scopes }
  };
}
function canonicalPath(p) {
  const resolved = path3.resolve(p);
  try {
    return fs2.realpathSync(resolved);
  } catch {
    return resolved;
  }
}
function relativizeSource(source, root, mainRoot) {
  const norm = canonicalPath(source);
  const bases = [root, mainRoot].filter((b) => typeof b === "string" && b !== "");
  for (const b of bases) {
    const base = canonicalPath(b);
    if (norm === base) return "";
    if (norm.startsWith(base + path3.sep)) return norm.slice(base.length + 1).split(path3.sep).join("/");
  }
  const segs = norm.split(path3.sep).filter((s) => s !== "");
  for (let i = 0; i < segs.length; i++) {
    const cand = segs.slice(i).join("/");
    if (cand !== "" && fs2.existsSync(path3.join(root, cand))) return cand;
  }
  return norm.split(path3.sep).join("/");
}
function dirInsideSource(dir, source) {
  if (source === "") return true;
  return dir === source || dir.startsWith(source + "/");
}
function dirOf(rel) {
  const i = rel.lastIndexOf("/");
  return i === -1 ? "" : rel.slice(0, i);
}
function mostSpecificScope(dir, scopes) {
  let best = null;
  let bestLen = -1;
  for (const s of scopes) {
    for (const src of s.relSources) {
      if (dirInsideSource(dir, src) && src.length > bestLen) {
        best = s.key;
        bestLen = src.length;
      }
    }
  }
  return best;
}
function buildReport(input) {
  const root = path3.resolve(input.root);
  const byLang = censusFiles(input.tracked);
  const tsFiles = byLang.get("ts") ?? [];
  const gitOk = input.gitError === void 0;
  const manifestReadable = !input.manifestParseFailed;
  const evaluated = gitOk && manifestReadable;
  const emptyArchguard = {
    manifestFound: input.manifestFound,
    manifestPath: input.manifestPath,
    manifestParsed: false,
    globalScopeKey: null,
    globalScopeResolved: false,
    globalScopeSources: [],
    globalScopeCoversTsFraction: null,
    globalScopeKind: "unresolved",
    globalScopeNote: null,
    scopes: []
  };
  let archguard = emptyArchguard;
  let uncoveredTsDirs = [];
  let uncoveredTsDirsEvaluated = false;
  if (input.manifest) {
    const mainRoot = safeMainCheckoutRoot(root);
    const scopes = input.manifest.scopes.map((s) => {
      const sources = s.sources.map((src) => relativizeSource(src, root, mainRoot));
      return {
        key: s.key,
        label: s.label ?? null,
        sources,
        rawSources: [...s.sources],
        entityCount: s.entityCount,
        tsFiles: 0,
        // "" is the repo root: a scope anchored there contains every tracked path, so nothing can ever
        // be outside it. See the attribution comment below for why that must not be credited.
        wholeRepo: sources.includes("")
      };
    });
    const attributionScopes = scopes.filter((s) => !s.wholeRepo);
    const scopeRefs = attributionScopes.map((s) => ({ key: s.key, relSources: s.sources }));
    const attribution = /* @__PURE__ */ new Map();
    for (const f of tsFiles) attribution.set(f, mostSpecificScope(dirOf(f), scopeRefs));
    for (const [f, key] of attribution) {
      if (key === null) continue;
      const row = scopes.find((s) => s.key === key);
      if (row) row.tsFiles++;
    }
    const globalKey = input.manifest.globalScopeKey;
    const globalScope = globalKey === null ? void 0 : scopes.find((s) => s.key === globalKey);
    const globalScopeResolved = globalScope !== void 0;
    const globalScopeKind = !globalScope ? "unresolved" : globalScope.wholeRepo ? "whole-repo" : "narrow";
    const globalCovered = globalScope ? tsFiles.filter((f) => globalScope.sources.some((src) => dirInsideSource(dirOf(f), src))).length : 0;
    const uncovered = [...new Set(tsFiles.filter((f) => attribution.get(f) === null).map(dirOf))].sort();
    uncoveredTsDirs = uncovered;
    uncoveredTsDirsEvaluated = true;
    archguard = {
      manifestFound: true,
      manifestPath: input.manifestPath,
      manifestParsed: true,
      globalScopeKey: globalKey,
      globalScopeResolved,
      globalScopeSources: globalScope ? [...globalScope.sources] : [],
      globalScopeCoversTsFraction: globalScope ? tsFiles.length === 0 ? 0 : globalCovered / tsFiles.length : null,
      globalScopeKind,
      globalScopeNote: globalScopeKind === "whole-repo" ? `the manifest's global scope ${globalKey} is the REPOSITORY ROOT (relativized sources [""]) \u2014 it contains every tracked path BY CONSTRUCTION, so "covers everything" is a tautology rather than a coverage reading, and it is therefore reported here but NOT credited in the per-scope attribution` : null,
      scopes
    };
  }
  const countable = input.gitError === void 0;
  const languages = LANGUAGES.map((spec) => {
    const files = byLang.get(spec.language) ?? [];
    if (!countable) {
      return {
        language: spec.language,
        trackedFiles: null,
        analyzedBy: null,
        status: "NOT-EVALUATED",
        reason: "git-unavailable",
        coverageFraction: null
      };
    }
    if (spec.analyzer === null) {
      return {
        language: spec.language,
        trackedFiles: files.length,
        analyzedBy: null,
        status: "NOT-EVALUATED",
        reason: "no-analyzer",
        coverageFraction: null
      };
    }
    if (!input.manifestFound) {
      return {
        language: spec.language,
        trackedFiles: files.length,
        analyzedBy: null,
        status: "NOT-EVALUATED",
        reason: "manifest-missing",
        coverageFraction: null
      };
    }
    if (input.manifestParseFailed) {
      return {
        language: spec.language,
        trackedFiles: files.length,
        analyzedBy: null,
        status: "NOT-EVALUATED",
        reason: "manifest-unreadable",
        coverageFraction: null
      };
    }
    const narrowRefs = archguard.scopes.filter((s) => !s.wholeRepo).map((s) => ({ key: s.key, relSources: s.sources }));
    const covered = files.filter((f) => (narrowRefs.length > 0 ? mostSpecificScope(dirOf(f), narrowRefs) : null) !== null).length;
    const counts = /* @__PURE__ */ new Map();
    for (const f of files) {
      const k = mostSpecificScope(dirOf(f), narrowRefs);
      if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const globalCovers = archguard.globalScopeResolved ? files.filter((f) => archguard.globalScopeSources.some((src) => dirInsideSource(dirOf(f), src))).length : 0;
    const globalClause = archguard.globalScopeKind === "whole-repo" ? `; the declared GLOBAL scope ${archguard.globalScopeKey} is the repository root, so it covers every file BY CONSTRUCTION and is NOT credited as coverage` : archguard.globalScopeResolved ? `; the GLOBAL scope ${archguard.globalScopeKey} alone covers ${globalCovers}/${files.length}` : "";
    const analyzedBy = archguard.globalScopeResolved && archguard.globalScopeKind !== "whole-repo" && globalCovers > 0 ? archguard.globalScopeKey : ranked[0]?.[0] ?? null;
    const fraction = files.length === 0 ? 1 : covered / files.length;
    const reason = covered === files.length ? `fully-covered: all ${files.length} tracked non-test ${spec.language} file(s) fall inside a registered archguard scope` + (archguard.globalScopeResolved || archguard.globalScopeKind === "whole-repo" ? globalClause : "; the manifest declares no resolvable global scope") : `partial-coverage: ${covered}/${files.length} tracked non-test ${spec.language} file(s) (${(fraction * 100).toFixed(1)}%) fall inside any registered archguard scope` + globalClause + `; ${uncoveredTsDirs.length} director${uncoveredTsDirs.length === 1 ? "y" : "ies"} uncovered`;
    return {
      language: spec.language,
      trackedFiles: files.length,
      analyzedBy,
      status: "analyzed",
      reason,
      coverageFraction: fraction,
      analyzedByScopeKeys: ranked.map(([k]) => k)
    };
  });
  const countedFiles = countable ? [...byLang.values()].reduce((a, b) => a + b.length, 0) : null;
  const analyzedFiles = countable ? languages.filter((l) => l.status === "analyzed").reduce((a, l) => a + (l.trackedFiles ?? 0), 0) : null;
  const notEvaluatedFiles = countable ? countedFiles - analyzedFiles : null;
  const report = {
    evaluated,
    generatedAt: input.now ?? (/* @__PURE__ */ new Date()).toISOString(),
    root,
    runner: "arch-coverage-report.ts",
    exclusionRules: EXCLUSION_RULES,
    languages,
    archguard,
    uncoveredTsDirs,
    uncoveredTsDirsEvaluated,
    totals: {
      trackedFiles: countable ? input.tracked.length : null,
      countedFiles,
      analyzedFiles,
      notEvaluatedFiles
    }
  };
  if (!evaluated) {
    report.reason = input.gitError !== void 0 ? "not-a-git-worktree" : "manifest-unreadable";
    report.error = input.gitError !== void 0 ? `git ls-files failed in ${root}: ${input.gitError.trim().split("\n")[0] ?? ""}` : `archguard manifest at ${input.manifestPath} could not be parsed: ${input.manifestError ?? "unknown"}`;
  }
  return report;
}
function safeMainCheckoutRoot(startDir) {
  try {
    return mainCheckoutRoot(startDir);
  } catch {
    return "";
  }
}
function runReport(opts) {
  const root = path3.resolve(opts.root);
  const manifestPath = opts.manifestPath ? path3.resolve(opts.manifestPath) : path3.join(root, DEFAULT_MANIFEST_REL);
  const listed = listTrackedFiles(root);
  const manifestFound = fs2.existsSync(manifestPath);
  let manifest = null;
  let manifestError;
  let manifestParseFailed = false;
  if (manifestFound) {
    const parsed = parseManifestText(readFileOrEmpty(manifestPath));
    if (parsed.ok) manifest = parsed.manifest;
    else {
      manifestParseFailed = true;
      manifestError = parsed.reason;
    }
  }
  const report = buildReport({
    root,
    tracked: listed.files,
    manifestFound,
    manifestPath,
    manifest,
    manifestError,
    manifestParseFailed,
    gitError: listed.ok ? void 0 : listed.error ?? "unknown git failure",
    now: opts.now
  });
  return { report, exitCode: report.evaluated ? EXIT_OK : EXIT_NOT_EVALUATED };
}
function readFileOrEmpty(p) {
  try {
    return fs2.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}
function renderSources(sources) {
  return sources.map((s) => s === "" ? "(repo root)" : s).join(", ");
}
function renderHuman(report) {
  const lines = [];
  lines.push(`arch-coverage-report \u2014 ${report.root}`);
  lines.push(`evaluated: ${report.evaluated}${report.reason ? `  (reason: ${report.reason})` : ""}`);
  lines.push("");
  lines.push("language   tracked  status         analyzedBy  reason");
  for (const l of report.languages) {
    lines.push(
      `${l.language.padEnd(10)} ${(l.trackedFiles === null ? "-" : String(l.trackedFiles)).padStart(7)}  ${l.status.padEnd(13)}  ${(l.analyzedBy ?? "-").padEnd(10)}  ${l.reason ?? ""}`
    );
  }
  lines.push("");
  const a = report.archguard;
  lines.push(`archguard manifest: ${a.manifestFound ? a.manifestPath : "NOT FOUND"}`);
  lines.push(`  global scope key:  ${a.globalScopeKey ?? "-"}  resolved=${a.globalScopeResolved}  kind=${a.globalScopeKind}`);
  lines.push(`  global sources:    ${a.globalScopeSources.length > 0 ? renderSources(a.globalScopeSources) : "-"}`);
  lines.push(
    `  global covers ts:  ${a.globalScopeCoversTsFraction === null ? "not evaluable" : `${(a.globalScopeCoversTsFraction * 100).toFixed(1)}%`}`
  );
  if (a.globalScopeNote !== null) lines.push(`  \u26A0\uFE0F  global scope note: ${a.globalScopeNote}`);
  lines.push(`  scopes (${a.scopes.length}):`);
  for (const s of a.scopes) {
    lines.push(
      `    ${s.key}  entities=${String(s.entityCount).padStart(6)}  tsFiles=${String(s.tsFiles).padStart(4)}  ${s.wholeRepo ? "[WHOLE-REPO \u2014 not credited] " : ""}${renderSources(s.sources)}`
    );
  }
  lines.push("");
  lines.push(
    `uncovered .ts dirs (${report.uncoveredTsDirsEvaluated ? report.uncoveredTsDirs.length : "NOT EVALUATED"}): ${report.uncoveredTsDirsEvaluated ? report.uncoveredTsDirs.length > 0 ? report.uncoveredTsDirs.join(", ") : "(none)" : "-"}`
  );
  lines.push(
    `totals: tracked=${report.totals.trackedFiles} counted=${report.totals.countedFiles} analyzed=${report.totals.analyzedFiles} notEvaluated=${report.totals.notEvaluatedFiles}`
  );
  if (!report.evaluated) lines.push(`ERROR: ${report.error}`);
  return lines.join("\n");
}
var GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "arch-coverage-report fixture",
  GIT_AUTHOR_EMAIL: "arch-coverage-report@example.invalid",
  GIT_COMMITTER_NAME: "arch-coverage-report fixture",
  GIT_COMMITTER_EMAIL: "arch-coverage-report@example.invalid"
};
function gitFixtureInit(dir) {
  execFileSync2("git", ["-C", dir, "init", "-q"], { env: GIT_ENV, stdio: "ignore" });
}
function gitFixtureCommitAll(dir) {
  execFileSync2("git", ["-C", dir, "add", "-A"], { env: GIT_ENV, stdio: "ignore" });
  execFileSync2("git", ["-C", dir, "commit", "-q", "-m", "fixture"], { env: GIT_ENV, stdio: "ignore" });
}
function writeFixture(dir, rel, body = "// fixture\n") {
  const p = path3.join(dir, rel);
  fs2.mkdirSync(path3.dirname(p), { recursive: true });
  fs2.writeFileSync(p, body);
}
function selftest() {
  const st = createSelftest({ flavor: "cases" });
  const check = st.check;
  const tmp = fs2.mkdtempSync(path3.join(os.tmpdir(), "arch-coverage-selftest-"));
  const repo = path3.join(tmp, "repo");
  fs2.mkdirSync(repo, { recursive: true });
  writeFixture(repo, "packages/quay/src/a.ts");
  writeFixture(repo, "packages/quay/src/b.ts");
  writeFixture(repo, "plugin/scripts/c.ts");
  writeFixture(repo, "src/x.mjs");
  writeFixture(repo, "README.md");
  gitFixtureInit(repo);
  gitFixtureCommitAll(repo);
  const partialManifest = JSON.stringify({
    version: "1.0",
    globalScopeKey: "SCOPE_GLOBAL",
    scopes: [
      { key: "SCOPE_GLOBAL", label: "src (typescript)", sources: [path3.join(repo, "packages/quay/src")], entityCount: 2 }
    ]
  });
  const manifestPath = path3.join(tmp, "manifest.json");
  const badManifestPath = path3.join(tmp, "manifest-bad.json");
  {
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const ts = r.report.languages.find((l) => l.language === "ts");
    check(
      "manifest-missing-ts-is-not-evaluated",
      ts.status === "NOT-EVALUATED" && ts.reason === "manifest-missing" && ts.analyzedBy === null,
      `status=${ts.status} reason=${ts.reason} analyzedBy=${ts.analyzedBy}`
    );
    check("manifest-missing-still-evaluated-and-exit-0", r.report.evaluated === true && r.exitCode === 0, `evaluated=${r.report.evaluated} exit=${r.exitCode}`);
  }
  {
    fs2.writeFileSync(manifestPath, partialManifest);
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const ts = r.report.languages.find((l) => l.language === "ts");
    check(
      "scope-covers-only-quay-src-leaves-plugin-scripts-uncovered",
      r.report.uncoveredTsDirs.includes("plugin/scripts") && r.report.uncoveredTsDirsEvaluated === true,
      `uncoveredTsDirs=${JSON.stringify(r.report.uncoveredTsDirs)}`
    );
    check(
      "partial-coverage-ts-row-analyzed-with-reason",
      ts.status === "analyzed" && ts.analyzedBy === "SCOPE_GLOBAL" && (ts.coverageFraction ?? 1) < 1 && /partial-coverage/.test(ts.reason ?? ""),
      `status=${ts.status} analyzedBy=${ts.analyzedBy} frac=${ts.coverageFraction}`
    );
    check(
      "partial-coverage-drops-out-of-uncovered-when-scope-widened",
      (() => {
        const wide = JSON.stringify({
          version: "1.0",
          globalScopeKey: "SCOPE_GLOBAL",
          scopes: [
            { key: "SCOPE_GLOBAL", label: "packages", sources: [path3.join(repo, "packages")], entityCount: 2 }
          ]
        });
        const widePath = path3.join(tmp, "manifest-wide.json");
        fs2.writeFileSync(widePath, wide);
        const rr = runReport({ root: repo, manifestPath: widePath, now: "T" });
        return rr.report.uncoveredTsDirsEvaluated === true && !rr.report.uncoveredTsDirs.includes("packages/quay/src") && rr.report.uncoveredTsDirs.includes("plugin/scripts");
      })(),
      "widening to packages/ must drop packages/quay/src but keep plugin/scripts uncovered"
    );
    {
      const whole = JSON.stringify({
        version: "1.0",
        globalScopeKey: "SCOPE_ROOT",
        scopes: [{ key: "SCOPE_ROOT", label: "all", sources: [repo], entityCount: 3 }]
      });
      const wholePath = path3.join(tmp, "manifest-whole-repo.json");
      fs2.writeFileSync(wholePath, whole);
      const r2 = runReport({ root: repo, manifestPath: wholePath, now: "T" });
      const a = r2.report.archguard;
      check(
        "whole-repo-global-scope-is-classified-not-silently-narrow",
        a.globalScopeKind === "whole-repo" && a.globalScopeResolved === true && a.globalScopeNote !== null,
        `kind=${a.globalScopeKind} resolved=${a.globalScopeResolved} note=${a.globalScopeNote === null ? "null" : "set"}`
      );
      check(
        "whole-repo-scope-is-not-credited-as-coverage",
        r2.report.uncoveredTsDirsEvaluated === true && r2.report.uncoveredTsDirs.length === 2 && r2.report.uncoveredTsDirs.includes("packages/quay/src") && r2.report.uncoveredTsDirs.includes("plugin/scripts") && r2.report.archguard.scopes.every((s) => s.wholeRepo ? s.tsFiles === 0 : true),
        `uncoveredTsDirs=${JSON.stringify(r2.report.uncoveredTsDirs)} tsFiles=${JSON.stringify(r2.report.archguard.scopes.map((s) => [s.key, s.tsFiles, s.wholeRepo]))}`
      );
    }
  }
  {
    const sh = (() => {
      const r = runReport({ root: repo, manifestPath, now: "T" });
      return r.report.languages.find((l) => l.language === "sh");
    })();
    check(
      "no-sh-files-yields-a-zero-row-not-a-missing-row",
      sh !== void 0 && sh.trackedFiles === 0,
      `shRow=${JSON.stringify(sh)}`
    );
  }
  {
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const mjs = r.report.languages.find((l) => l.language === "mjs");
    check(
      "mjs-present-is-not-evaluated-no-analyzer",
      mjs.status === "NOT-EVALUATED" && mjs.reason === "no-analyzer" && mjs.trackedFiles > 0 && mjs.analyzedBy === null,
      `trackedFiles=${mjs.trackedFiles} status=${mjs.status} reason=${mjs.reason}`
    );
  }
  {
    fs2.writeFileSync(badManifestPath, "{ this is not json");
    const r = runReport({ root: repo, manifestPath: badManifestPath, now: "T" });
    const ts = r.report.languages.find((l) => l.language === "ts");
    check(
      "bad-json-manifest-is-not-evaluated-with-exit-2",
      r.report.evaluated === false && r.exitCode === 2 && r.report.reason === "manifest-unreadable",
      `evaluated=${r.report.evaluated} exit=${r.exitCode} reason=${r.report.reason}`
    );
    check(
      "bad-json-manifest-does-not-look-like-an-empty-scope-list",
      ts.status === "NOT-EVALUATED" && ts.reason === "manifest-unreadable" && r.report.uncoveredTsDirsEvaluated === false,
      `tsReason=${ts.reason} uncoveredEvaluated=${r.report.uncoveredTsDirsEvaluated}`
    );
  }
  {
    const nonGit = path3.join(tmp, "not-git");
    fs2.mkdirSync(nonGit, { recursive: true });
    writeFixture(nonGit, "packages/quay/src/a.ts");
    const r = runReport({ root: nonGit, manifestPath, now: "T" });
    check(
      "non-git-directory-is-not-evaluated-with-exit-2",
      r.report.evaluated === false && r.exitCode === 2 && r.report.reason === "not-a-git-worktree",
      `evaluated=${r.report.evaluated} exit=${r.exitCode} reason=${r.report.reason}`
    );
    check(
      "non-git-directory-rows-are-null-not-zero",
      r.report.languages.length === LANGUAGES.length && r.report.languages.every((l) => l.trackedFiles === null && l.status === "NOT-EVALUATED" && l.reason === "git-unavailable") && r.report.totals.countedFiles === null,
      `rows=${JSON.stringify(r.report.languages.map((l) => [l.language, l.trackedFiles]))}`
    );
  }
  {
    check(
      "exclusion-caliber-is-segment-based-not-substring",
      isExcluded("plugin/scripts/sync-vendor.sh") === false && isExcluded("plugin/scripts/checker-mutation-cases/x.sh") === true && isExcluded("a/b/node_modules/c.ts") === true && isExcluded("packages/quay/src/a.test.ts") === true && isExcluded("archive/old/plugin/scripts/y.sh") === true && isExcluded("plugin/test/delivery.sh") === false && isExcluded("test/e2e.sh") === false,
      "sync-vendor.sh must survive a `vendor` segment rule; test/ dirs are retained by the AC2 caliber"
    );
  }
  {
    check(
      "absolute-foreign-root-source-is-relativized",
      relativizeSource("/somewhere/else/packages/quay/src", repo, "/somewhere/else") === "packages/quay/src",
      `got=${relativizeSource("/somewhere/else/packages/quay/src", repo, "/somewhere/else")}`
    );
    check(
      "relativized-source-is-a-repo-relative-path",
      (() => {
        const m = JSON.parse(partialManifest);
        const r = runReport({ root: repo, manifestPath, now: "T" });
        void m;
        return r.report.archguard.globalScopeSources.length === 1 && r.report.archguard.globalScopeSources[0] === "packages/quay/src";
      })(),
      JSON.stringify(runReport({ root: repo, manifestPath, now: "T" }).report.archguard.globalScopeSources)
    );
  }
  {
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const unresolved = (() => {
      const p = path3.join(tmp, "manifest-no-global.json");
      fs2.writeFileSync(p, JSON.stringify({ version: "1.0", globalScopeKey: "NOPE", scopes: [{ key: "K", sources: [repo], entityCount: 1 }] }));
      return runReport({ root: repo, manifestPath: p, now: "T" }).report.archguard;
    })();
    check(
      "global-scope-fraction-is-less-than-one-and-null-when-unresolvable",
      (r.report.archguard.globalScopeCoversTsFraction ?? 1) < 1 && r.report.archguard.globalScopeResolved === true && unresolved.globalScopeCoversTsFraction === null && unresolved.globalScopeResolved === false,
      `partial=${r.report.archguard.globalScopeCoversTsFraction} unresolved=${unresolved.globalScopeCoversTsFraction}`
    );
  }
  {
    const r = runReport({ root: repo, manifestPath, now: "T" });
    const anyNotEvaluated = r.report.languages.some((l) => l.status === "NOT-EVALUATED");
    check(
      "report-only-unevaluated-language-still-exits-0",
      anyNotEvaluated && r.exitCode === 0,
      `anyNotEvaluated=${anyNotEvaluated} exit=${r.exitCode}`
    );
  }
  try {
    fs2.rmSync(tmp, { recursive: true, force: true });
  } catch {
  }
  return st.report();
}
var USAGE = `arch-coverage-report.ts \u2014 who analyzed which language, and how much of it
usage: arch-coverage-report.ts [<root>] [--json] [--archguard-manifest <path>] [--selftest]
  exit 0 = report produced (\u26A0\uFE0F NOT "everything is evaluated" \u2014 read the rows)
  exit 1 = a --selftest case failed | 2 = NOT EVALUATED (manifest unparseable / git unavailable) | 3 = usage`;
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) helpExit(USAGE);
  if (argv.includes("--selftest")) return selftest() ? EXIT_OK : EXIT_SELFTEST_FAILED;
  let root;
  let manifestPath;
  const json = argv.includes("--json");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") continue;
    if (a === "--archguard-manifest") {
      manifestPath = argv[++i];
      if (manifestPath === void 0) {
        process.stderr.write("arch-coverage-report: --archguard-manifest requires a path\n");
        return EXIT_USAGE;
      }
      continue;
    }
    if (a.startsWith("--")) {
      process.stderr.write(`arch-coverage-report: unknown flag ${a}
${USAGE}
`);
      return EXIT_USAGE;
    }
    if (root !== void 0) {
      process.stderr.write(`arch-coverage-report: unexpected extra argument ${a}
${USAGE}
`);
      return EXIT_USAGE;
    }
    root = a;
  }
  const { report, exitCode } = runReport({ root: root ?? repoRoot(), manifestPath });
  process.stdout.write(json ? JSON.stringify(report, null, 2) + "\n" : renderHuman(report) + "\n");
  return exitCode;
}
if (isDirectEntry(import.meta, process.argv[1], "arch-coverage-report")) {
  process.exit(main());
}
export {
  DEFAULT_MANIFEST_REL,
  EXCLUSION_RULES,
  EXIT_NOT_EVALUATED,
  EXIT_OK,
  EXIT_SELFTEST_FAILED,
  EXIT_USAGE,
  LANGUAGES,
  REPORT_GENERATED_AT_PLACEHOLDER,
  buildReport,
  canonicalPath,
  censusFiles,
  dirInsideSource,
  dirOf,
  isExcluded,
  listTrackedFiles,
  mostSpecificScope,
  parseManifestText,
  relativizeSource,
  renderHuman,
  runReport,
  selftest
};
