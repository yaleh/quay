#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/test-isolation-check.ts
import fs4 from "node:fs";
import path3 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/source-text-lib.ts
function firstArgRegion(src, mask, openIdx, region) {
  const endBound = openIdx + region.length;
  let depth = 0;
  for (let i = openIdx + 1; i < endBound; i++) {
    if (mask[i] !== 0) continue;
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return [openIdx + 1, i];
      depth--;
    } else if (c === "," && depth === 0) return [openIdx + 1, i];
  }
  return [openIdx + 1, endBound - 1];
}
function lineOf(src, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}
function snippetOf(src, idx, maxLen = Infinity) {
  let start = idx;
  while (start > 0 && src[start - 1] !== "\n") start--;
  let end = idx;
  while (end < src.length && src[end] !== "\n") end++;
  const line = src.slice(start, end).trim();
  return line.length > maxLen ? `${line.slice(0, maxLen - 3)}...` : line;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/checker-lib.ts
var REGEX_PRECURSOR_KEYWORDS = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await"
]);
function isRegexStart(prevCode, src, i) {
  if (prevCode === "") return true;
  if (/\s/.test(prevCode)) return true;
  if ((prevCode === "+" || prevCode === "-") && src[i - 2] === prevCode) return false;
  if (/[A-Za-z0-9_$]/.test(prevCode)) {
    const m = src.slice(0, i).match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    return m ? REGEX_PRECURSOR_KEYWORDS.has(m[1]) : false;
  }
  if (prevCode === ")" || prevCode === "]" || prevCode === '"' || prevCode === "'" || prevCode === "`") return false;
  return true;
}
function buildNonCodeMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  let prevCode = "";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < n && src[i] !== "\n") {
        mask[i] = 1;
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      mask[i] = 1;
      mask[i + 1] = 1;
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        mask[i] = 1;
        i++;
      }
      if (i < n) {
        mask[i] = 1;
        mask[i + 1] = 1;
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      mask[i] = 1;
      i++;
      while (i < n) {
        mask[i] = 1;
        if (src[i] === "\\") {
          if (i + 1 < n) {
            mask[i + 1] = 1;
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      prevCode = q;
      continue;
    }
    if (c === "/" && isRegexStart(prevCode, src, i)) {
      mask[i] = 1;
      i++;
      let inClass = false;
      while (i < n) {
        mask[i] = 1;
        const cc = src[i];
        if (cc === "\\") {
          if (i + 1 < n) {
            mask[i + 1] = 1;
            i += 2;
          } else {
            i++;
          }
          continue;
        }
        if (cc === "[") inClass = true;
        else if (cc === "]") inClass = false;
        else if (cc === "/" && !inClass) {
          i++;
          break;
        } else if (cc === "\n") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    prevCode = c;
    i++;
  }
  return mask;
}
function enumerativeExistence(items, present) {
  const presentList = [];
  const absentList = [];
  for (const it of items) {
    if (present(it)) presentList.push(it);
    else absentList.push(it);
  }
  return { present: presentList, absent: absentList };
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import fs from "node:fs";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/test-framework-policy-check.ts
import fs3 from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/canonical-test-files.ts
import fs2 from "node:fs";
import path from "node:path";
function parseCanonicalGlobs(repoRoot) {
  const src = readFileSafe(path.join(repoRoot, "scripts", "test.sh"));
  const m = src.match(/glob=\(([^)]*)\)/);
  if (!m) return [];
  return m[1].split(/\s+/).map((s) => s.trim()).filter(Boolean);
}
function globSegmentToRegex(seg) {
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}
function expandGlob(pattern, root) {
  const segments = pattern.split("/");
  let current = [root];
  for (const seg of segments) {
    if (!seg.includes("*")) {
      current = current.map((dir) => path.join(dir, seg)).filter((p) => fs2.existsSync(p));
      continue;
    }
    const re = globSegmentToRegex(seg);
    const next = [];
    for (const dir of current) {
      let entries = [];
      try {
        entries = fs2.readdirSync(dir);
      } catch {
        entries = [];
      }
      for (const e of entries) {
        if (re.test(e)) next.push(path.join(dir, e));
      }
    }
    current = next;
  }
  return current.filter((p) => {
    try {
      return fs2.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}
function canonicalTestFiles(repoRoot) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const pattern of parseCanonicalGlobs(repoRoot)) {
    for (const abs of expandGlob(pattern, repoRoot)) {
      let rp = abs;
      try {
        rp = fs2.realpathSync(abs);
      } catch {
        rp = abs;
      }
      if (seen.has(rp)) continue;
      seen.add(rp);
      out.push(path.relative(repoRoot, rp).split(path.sep).join("/"));
    }
  }
  return out.sort();
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/ratchet-baseline.ts
var BASELINE_COUNT_RE = /^#[ \t]*baseline-count:\s*(\d+)/m;
function parseBaselineCount(text) {
  const m = text.match(BASELINE_COUNT_RE);
  return m ? Number(m[1]) : null;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/test-framework-policy-check.ts
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var DATA_FILE_REL = "plugin/test-framework-policy-exemptions.txt";
function atStatementStart(source, mask, i) {
  let j = i - 1;
  while (j >= 0 && mask[j] === 1) j--;
  if (j < 0) return true;
  return /[\s;(){}\[\],]/.test(source[j]);
}
function hasNodeTestImport(source) {
  const mask = buildNonCodeMask(source);
  const n = source.length;
  const isIdent = (c) => !!c && /[A-Za-z0-9_$]/.test(c);
  let i = 0;
  while (i < n) {
    if (mask[i] === 1) {
      i++;
      continue;
    }
    const c = source[i];
    if (c === "i" && source.startsWith("import", i) && !isIdent(source[i - 1]) && !isIdent(source[i + 6]) && atStatementStart(source, mask, i)) {
      const rest = source.slice(i);
      if (/^import\s*["']node:test["']/.test(rest)) return true;
      if (/^import\(\s*["']node:test["']\s*\)/.test(rest)) return true;
      let j = i + 6;
      let depth = 0;
      while (j < n) {
        if (mask[j] === 0) {
          const cc = source[j];
          if (cc === ";" && depth === 0) break;
          if (cc === "{") depth++;
          if (cc === "}") depth--;
          if (depth === 0 && cc === "f" && source.startsWith("from", j) && !isIdent(source[j - 1]) && !isIdent(source[j + 4])) {
            const spec = source.slice(j + 4).match(/^\s*["']([^"']+)["']/);
            if (spec && spec[1] === "node:test") return true;
            break;
          }
        }
        j++;
      }
    }
    if (c === "r" && source.startsWith("require", i) && !isIdent(source[i - 1]) && !isIdent(source[i + 7]) && atStatementStart(source, mask, i)) {
      if (/^require\(\s*["']node:test["']\s*\)/.test(source.slice(i))) return true;
    }
    i++;
  }
  return false;
}
function groupDeclRE() {
  return /@test-group\s+(product|engine|serial|lowconc)/;
}
function parseExemptionList(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
}
function runPolicyChecks(i) {
  const failures = [];
  const exemptionSet = new Set(i.exemptionList);
  const baselineExemptionSet = new Set(i.baselineExemptionList);
  const bootstrap = i.baselineExemptionList.length === 0;
  const globSet = new Set(i.files.map((f) => f.rel));
  if (i.baselineCount !== null && i.exemptionList.length > i.baselineCount) {
    failures.push(
      `AC4: the exemption list has ${i.exemptionList.length} entries, over the ratchet ceiling of ${i.baselineCount} (${DATA_FILE_REL} header "# baseline-count"). The list can only get SHORTER \u2014 a new hand-rolled test can never be exempted.`
    );
  }
  if (!bootstrap && i.baselineCountHead !== null && i.baselineCount !== null && i.baselineCount > i.baselineCountHead) {
    failures.push(
      `AC4: the ratchet ceiling was RAISED from ${i.baselineCountHead} to ${i.baselineCount} in ${DATA_FILE_REL} \u2014 the ceiling is shrink-only (it can only get LOWER). Do not raise it to admit more legacy files.`
    );
  }
  const { absent: nonCompliantFiles } = enumerativeExistence(
    i.files,
    (f) => hasNodeTestImport(f.source) || exemptionSet.has(f.rel)
  );
  for (const f of nonCompliantFiles) {
    failures.push(
      `AC3: ${f.rel} uses the hand-rolled harness (no "node:test" import) and is NOT on the legacy exemption list (${DATA_FILE_REL}). New test files MUST import node:test.`
    );
  }
  if (!bootstrap) {
    for (const rel of i.exemptionList) {
      if (!baselineExemptionSet.has(rel)) {
        failures.push(
          `AC4: ${rel} was ADDED to the exemption list \u2014 the list can only get SHORTER. Convert the file to node:test instead; there is no way to exempt a new hand-rolled test.`
        );
      }
    }
  }
  for (const rel of i.exemptionList) {
    if (!i.fileExists(rel)) {
      failures.push(
        `AC4: exemption entry ${rel} no longer exists on disk \u2014 remove it from ${DATA_FILE_REL} (the list only shrinks).`
      );
      continue;
    }
    if (!globSet.has(rel)) {
      failures.push(
        `AC4: exemption entry ${rel} names a file OUTSIDE the canonical test glob \u2014 the list may only name glob-covered test files; remove it.`
      );
      continue;
    }
    const f = i.files.find((x) => x.rel === rel);
    if (f && hasNodeTestImport(f.source)) {
      failures.push(
        `AC4: exemption entry ${rel} now imports node:test \u2014 the file was converted but the list was not shortened. Remove it from ${DATA_FILE_REL} (the list only shrinks).`
      );
    }
  }
  for (const f of i.files) {
    if (exemptionSet.has(f.rel)) continue;
    if (i.baselineTestFiles.has(f.rel)) continue;
    if (!groupDeclRE().test(f.source)) {
      failures.push(
        `AC5: ${f.rel} is a NEW test file (not on the exemption list, not in the committed tree) and has no VALID "// @test-group <product|engine|serial|lowconc>" declaration (missing, or not product|engine|serial|lowconc) \u2014 add one.`
      );
    }
  }
  return failures;
}
function gitHeadExists(root) {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}
function gitShowFile(root, ref, rel) {
  try {
    return execFileSync("git", ["-C", root, "show", `${ref}:${rel}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
}
function gitTestFilesAtRef(root, ref) {
  const out = /* @__PURE__ */ new Set();
  let listing = "";
  try {
    listing = execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", ref], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return out;
  }
  for (const line of listing.split(/\r?\n/)) {
    const rel = line.trim();
    if (!rel) continue;
    if (rel.endsWith(".test.mjs") && rel.split("/").includes("test")) out.add(rel);
  }
  return out;
}
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node test-framework-policy-check.ts [<workspace-root>] [--json] [--selftest] [--data-file <path>] [--baseline-file <path>] [--baseline-files <path>]");
  if (args.includes("--selftest")) {
    const ok = runSelftest();
    process.exit(ok ? 0 : 1);
  }
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const root = path2.resolve(positional[0] ?? process.cwd());
  const dataFileRel = flagValue(args, "--data-file") ?? DATA_FILE_REL;
  const dataFileAbs = path2.isAbsolute(dataFileRel) ? dataFileRel : path2.join(root, dataFileRel);
  if (!fs3.existsSync(path2.join(root, "scripts", "test.sh"))) {
    console.error(`ERROR: ${path2.join(root, "scripts", "test.sh")} not found \u2014 is <workspace-root> correct?`);
    process.exit(2);
  }
  const files = canonicalTestFiles(root).map((rel) => ({ rel, source: readFileSafe(path2.join(root, rel)) }));
  const currentList = parseExemptionList(readFileSafe(dataFileAbs));
  const baselineCount = parseBaselineCount(readFileSafe(dataFileAbs));
  let baselineList = currentList;
  let baselineFiles = new Set(files.map((f) => f.rel));
  let baselineCountHead = null;
  const baselineFileArg = flagValue(args, "--baseline-file");
  const baselineFilesArg = flagValue(args, "--baseline-files");
  if (baselineFileArg) {
    const baselineText = readFileSafe(path2.resolve(root, baselineFileArg));
    baselineList = parseExemptionList(baselineText);
    baselineCountHead = parseBaselineCount(baselineText);
  } else if (baselineFilesArg) {
  } else {
    const gitOk = gitHeadExists(root);
    if (!gitOk) {
      console.error(
        "ERROR: test-framework-policy-check needs a git baseline (git HEAD) to enforce the AC4 ratchet and AC5 @test-group rule, but this is not a usable git worktree. Pass --baseline-file/--baseline-files for a non-git fixture, or run in the real checkout."
      );
      process.exit(2);
    }
    const committed = gitShowFile(root, "HEAD", dataFileRel);
    if (committed === null) {
      baselineList = currentList;
      baselineFiles = new Set(files.map((f) => f.rel));
    } else {
      baselineList = parseExemptionList(committed);
      baselineCountHead = parseBaselineCount(committed);
      const atHead = gitTestFilesAtRef(root, "HEAD");
      if (atHead.size > 0) baselineFiles = atHead;
    }
  }
  if (baselineFilesArg) {
    baselineFiles = new Set(readFileSafe(path2.resolve(root, baselineFilesArg)).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  }
  const failures = runPolicyChecks({
    files,
    exemptionList: currentList,
    baselineExemptionList: baselineList,
    baselineTestFiles: baselineFiles,
    baselineCountHead,
    baselineCount,
    fileExists: (rel) => fs3.existsSync(path2.join(root, rel))
  });
  if (asJson) {
    console.log(JSON.stringify({ ok: failures.length === 0, files: files.length, exemptionCount: currentList.length, failures }, null, 2));
  } else {
    console.log(`test-framework-policy-check \u2014 ${files.length} glob file(s), ${currentList.length} exemption(s)`);
    if (failures.length === 0) {
      console.log("PASS: every test file uses node:test or is a listed legacy exemption; exemption list is at/below the ratchet ceiling and did not grow; new files declare @test-group.");
    } else {
      console.log(`FAIL: ${failures.length} violation(s):`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  }
  return failures.length === 0 ? 0 : 1;
}
function runSelftest() {
  const st = createSelftest({ flavor: "counters", label: "test-framework-policy-check" });
  const check = st.check;
  const nodeTestSource = '// @test-group engine\nimport { test } from "node:test";\ntest("x", () => {});\n';
  const legacySource = "// @test-group product\nfunction makeAssert() {}\nmakeAssert();\n";
  const legacyConverted = '// @test-group product\nimport { test } from "node:test";\n';
  const newNoGroup = '// plain\nimport { test } from "node:test";\n';
  const newBadGroup = '// @test-group nope\nimport { test } from "node:test";\n';
  const pc = (o) => runPolicyChecks({ baselineCount: null, baselineCountHead: null, fileExists: () => true, ...o });
  const files = [
    { rel: "packages/quay/test/modern.test.mjs", source: nodeTestSource },
    { rel: "packages/quay/test/legacy-handrolled.test.mjs", source: legacySource }
  ];
  const exemptionList = ["packages/quay/test/legacy-handrolled.test.mjs"];
  const baselineExemption = ["packages/quay/test/legacy-handrolled.test.mjs"];
  const baselineFiles = /* @__PURE__ */ new Set(["packages/quay/test/modern.test.mjs", "packages/quay/test/legacy-handrolled.test.mjs"]);
  let failures = pc({ files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("GREEN: compliant set passes", failures.length === 0, JSON.stringify(failures));
  const c1Files = [...files, { rel: "packages/quay/test/other-handrolled.test.mjs", source: legacySource }];
  failures = pc({ files: c1Files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C1 RED: unlisted hand-rolled file fails", failures.some((f) => f.includes("other-handrolled") && f.includes("AC3")), JSON.stringify(failures));
  const grownList = [...exemptionList, "packages/quay/test/other-handrolled.test.mjs"];
  failures = pc({ files: c1Files, exemptionList: grownList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C2a RED: added list entry fails", failures.some((f) => f.includes("ADDED to the exemption list")), JSON.stringify(failures));
  check("C2a RED: listed file is exempt from C1", !failures.some((f) => f.includes("other-handrolled") && f.includes("AC3")), JSON.stringify(failures));
  const c2cFiles = files.map((f) => f.rel === "packages/quay/test/legacy-handrolled.test.mjs" ? { ...f, source: legacyConverted } : f);
  failures = pc({ files: c2cFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C2c RED: converted-but-not-removed entry fails", failures.some((f) => f.includes("now imports node:test")), JSON.stringify(failures));
  failures = pc({ files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles, fileExists: (rel) => rel !== "packages/quay/test/legacy-handrolled.test.mjs" });
  check("C2b RED: missing-file entry fails", failures.some((f) => f.includes("no longer exists")), JSON.stringify(failures));
  failures = pc({ files, exemptionList: [...exemptionList, "plugin/scripts/not-a-test.mjs"], baselineExemptionList: [...baselineExemption, "plugin/scripts/not-a-test.mjs"], baselineTestFiles: baselineFiles });
  check("C2d RED: non-glob entry fails", failures.some((f) => f.includes("OUTSIDE the canonical test glob")), JSON.stringify(failures));
  const c3Files = [...files, { rel: "packages/quay/test/brand-new.test.mjs", source: newNoGroup }];
  failures = pc({ files: c3Files, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C3 RED: new file without @test-group fails", failures.some((f) => f.includes("brand-new") && f.includes("AC5")), JSON.stringify(failures));
  const c3bFiles = [...files, { rel: "packages/quay/test/brand-new-bad.test.mjs", source: newBadGroup }];
  failures = pc({ files: c3bFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C3 RED: new file with invalid @test-group fails", failures.some((f) => f.includes("brand-new-bad") && f.includes("AC5")), JSON.stringify(failures));
  const c3gFiles = [...files, { rel: "packages/quay/test/brand-new-ok.test.mjs", source: nodeTestSource }];
  failures = pc({ files: c3gFiles, exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("C3 GREEN: new file with valid @test-group passes", failures.length === 0, JSON.stringify(failures));
  failures = pc({ files: c1Files, exemptionList: grownList, baselineExemptionList: [], baselineTestFiles: new Set(c1Files.map((f) => f.rel)) });
  check("bootstrap: empty baseline passes (no C2a, no new-file requirement)", failures.length === 0, JSON.stringify(failures));
  const commentSneak = '// @test-group engine\n// TODO: migrate this to import { test } from "node:test"\nfunction makeAssert(){}\nmakeAssert();\n';
  check(
    "comment-bypass: hand-rolled file with a node:test-comment is NOT node:test (AC3 fires)",
    hasNodeTestImport(commentSneak) === false,
    "comment must not count as an import"
  );
  failures = pc({ files: [...files, { rel: "packages/quay/test/sneak.test.mjs", source: commentSneak }], exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("comment-bypass: sneaky hand-rolled file FAILS AC3", failures.some((f) => f.includes("sneak") && f.includes("AC3")), JSON.stringify(failures));
  failures = pc({ files: files.map((f) => f.rel === "packages/quay/test/legacy-handrolled.test.mjs" ? { ...f, source: commentSneak } : f), exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("comment-bypass: listed legacy file with a node:test-comment is NOT reported converted", !failures.some((f) => f.includes("now imports node:test")), JSON.stringify(failures));
  const stringSneak = '// @test-group engine\nconst s = "require(\\"node:test\\")";\nfunction makeAssert(){}\nmakeAssert();\n';
  check("string-literal-bypass: require() inside a string is NOT an import", hasNodeTestImport(stringSneak) === false);
  failures = runPolicyChecks({
    files: c1Files,
    exemptionList: grownList,
    baselineExemptionList: grownList,
    // HEAD already moved past the addition — the git subset is blind
    baselineTestFiles: new Set(c1Files.map((f) => f.rel)),
    baselineCount: 1,
    // ceiling of 1, list has 2
    baselineCountHead: 1,
    fileExists: () => true
  });
  check("count-ceiling RED: list over the ceiling fails at a clean commit", failures.some((f) => f.includes("over the ratchet ceiling")), JSON.stringify(failures));
  failures = runPolicyChecks({
    files: c1Files,
    exemptionList: grownList,
    baselineExemptionList: grownList,
    baselineTestFiles: new Set(c1Files.map((f) => f.rel)),
    baselineCount: 2,
    baselineCountHead: 2,
    fileExists: () => true
  });
  check("count-ceiling GREEN: list at the ceiling passes", failures.length === 0, JSON.stringify(failures));
  failures = runPolicyChecks({
    files: c1Files,
    exemptionList: grownList,
    // 2 entries, ceiling raised to 2
    baselineExemptionList: grownList,
    baselineTestFiles: new Set(c1Files.map((f) => f.rel)),
    baselineCount: 2,
    // raised from 1
    baselineCountHead: 1,
    fileExists: () => true
  });
  check("ceiling-bump RED: raising the ratchet ceiling fails", failures.some((f) => f.includes("ceiling was RAISED")), JSON.stringify(failures));
  const regexSneak = '// @test-group engine\nconst re = /import { test } from "node:test"/;\nfunction makeAssert(){}\nmakeAssert();\n';
  check("regex-literal: a regex spelling the import is NOT an import", hasNodeTestImport(regexSneak) === false, "regex literal must be masked");
  failures = pc({ files: [...files, { rel: "packages/quay/test/regex-sneak.test.mjs", source: regexSneak }], exemptionList, baselineExemptionList: baselineExemption, baselineTestFiles: baselineFiles });
  check("regex-literal: regex-spelling file FAILS AC3", failures.some((f) => f.includes("regex-sneak") && f.includes("AC3")), JSON.stringify(failures));
  const methodCall = '// @test-group engine\nloader.import("node:test");\nimport { test } from "node:test";\n';
  check("method-call: loader.import(...) is not a dynamic import", hasNodeTestImport(methodCall) === true, "the REAL import still counts");
  const divisionOk = 'const x = 5;\nlet a = 10;\nconst r = a / 2; // division\nx++ / 2;\nimport { test } from "node:test";\ntest("x", () => {});\n';
  check("division: x++ / 2 and a / 2 must not hide the real import", hasNodeTestImport(divisionOk) === true, "import after divisions must still be detected");
  return st.report();
}
var isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/test-isolation-check.ts
var __dirname2 = path3.dirname(fileURLToPath2(import.meta.url));
var DATA_FILE_REL2 = "plugin/test-isolation-violations.txt";
var RULE_KEYS = [
  "fixed-path-write",
  "shared-build-artifact-write",
  "spawns-test-sh",
  "process-exit-1",
  "mkdtemp-no-cleanup",
  "live-data-dir-write",
  "shared-root-mkdtemp"
];
function codePositions(src, mask, re) {
  const out = [];
  for (const m of src.matchAll(re)) {
    if (mask[m.index] === 0) out.push(m.index);
  }
  return out;
}
function callRegion(src, mask, openIdx) {
  let depth = 0;
  let i = openIdx;
  for (; i < src.length; i++) {
    if (mask[i] !== 0) continue;
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return src.slice(openIdx);
}
function codeStrings(src, _mask, from, to) {
  const out = [];
  let inLine = false;
  let inBlock = false;
  let i = from;
  while (i < to) {
    const c = src[i];
    const d = src[i + 1];
    if (inLine) {
      if (c === "\n") inLine = false;
      i++;
      continue;
    }
    if (inBlock) {
      if (c === "*" && d === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (c === "/" && d === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === "/" && d === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      let j = i + 1;
      let content = "";
      while (j < to) {
        const cc = src[j];
        if (cc === "\\") {
          if (j + 1 < to) {
            content += cc + src[j + 1];
            j += 2;
            continue;
          }
          j++;
          continue;
        }
        if (cc === q) break;
        content += cc;
        j++;
      }
      out.push(content);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}
function codeRegionHas(src, mask, openIdx, region, re) {
  const regionMask = mask.subarray(openIdx, openIdx + region.length);
  const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of region.matchAll(gre)) {
    if (regionMask[m.index] === 0) return true;
  }
  return false;
}
function insideMkdtempCall(src, mask, idx) {
  const m = /mkdtemp(?:Sync)?\s*\(/g;
  for (const hit of src.matchAll(m)) {
    if (mask[hit.index] !== 0) continue;
    const region = callRegion(src, mask, hit.index + hit[0].length - 1);
    const regionStart = hit.index + hit[0].length - 1;
    if (idx >= regionStart && idx < regionStart + region.length) return true;
  }
  return false;
}
function varsReferencing(src, mask, needle) {
  const names = /* @__PURE__ */ new Set();
  const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  for (const m of src.matchAll(declRe)) {
    if (mask[m.index] !== 0) continue;
    let depth = 0;
    let end = m.index + m[0].length;
    for (let i = end; i < src.length; i++) {
      if (mask[i] !== 0) continue;
      const c = src[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ";" && depth <= 0) {
        end = i;
        break;
      }
    }
    const initializer = src.slice(m.index, end);
    if (needle.test(initializer)) names.add(m[1]);
  }
  return names;
}
function detectFixedPathWrites(src, rel) {
  const mask = buildNonCodeMask(src);
  const out = [];
  const joinRe = /\b(?:path\.join|join|resolve|path\.resolve)\s*\(/g;
  for (const m of src.matchAll(joinRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const end = openIdx + region.length;
    const isCheckoutPath = codeRegionHas(src, mask, openIdx, region, /__dirname|import\.meta|fileURLToPath/);
    const hasDotTmp = codeStrings(src, mask, openIdx, end).some((s) => /\.tmp(?:-|\b)/.test(s));
    if (!isCheckoutPath || !hasDotTmp) continue;
    if (insideMkdtempCall(src, mask, openIdx)) continue;
    out.push({ rel, rule: "fixed-path-write", line: lineOf(src, m.index), snippet: snippetOf(src, m.index, 80) });
  }
  return out;
}
function detectSharedBuildArtifactWrites(src, rel) {
  const mask = buildNonCodeMask(src);
  const out = [];
  const spawnRe = /\b(?:execSync|execFileSync|spawnSync|spawn|execFile|fork)\s*\(/g;
  for (const m of src.matchAll(spawnRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const end = openIdx + region.length;
    const args = codeStrings(src, mask, openIdx, end);
    const invokesSyncVendor = args.some((s) => s.includes("sync-vendor.sh"));
    const isCheckOnly = args.some((s) => s.includes("--check"));
    if (invokesSyncVendor && !isCheckOnly) {
      out.push({ rel, rule: "shared-build-artifact-write", line: lineOf(src, m.index), snippet: snippetOf(src, m.index, 80) });
      continue;
    }
  }
  const writeRe = /\b(?:writeFileSync|writeFile|appendFileSync|mkdirSync|mkdir|rmSync|rm|unlinkSync|cpSync|copyFileSync|createWriteStream)\s*\(/g;
  for (const m of src.matchAll(writeRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const literalArg = region.match(/^\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (!literalArg) continue;
    const p = literalArg[1];
    if (/(?:packages\/[^/]+\/dist\/|plugin\/vendor\/)/.test(p)) {
      out.push({ rel, rule: "shared-build-artifact-write", line: lineOf(src, m.index), snippet: snippetOf(src, m.index, 80) });
    }
  }
  return out;
}
function detectSpawnsTestSh(src, rel) {
  const mask = buildNonCodeMask(src);
  const testShVars = varsReferencing(src, mask, /test\.sh/);
  const out = [];
  const spawnRe = /\b(?:execSync|execFileSync|spawnSync|spawn|execFile|fork)\s*\(/g;
  for (const m of src.matchAll(spawnRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const end = openIdx + region.length;
    const hitsLiteral = codeStrings(src, mask, openIdx, end).some((s) => s.includes("test.sh"));
    const hitsVar = [...testShVars].some((v) => codeRegionHas(src, mask, openIdx, region, new RegExp(`\\b${v}\\b`)));
    if (hitsLiteral || hitsVar) {
      out.push({ rel, rule: "spawns-test-sh", line: lineOf(src, m.index), snippet: snippetOf(src, m.index, 80) });
    }
  }
  return out;
}
function detectProcessExit1(src, rel) {
  if (hasNodeTestImport(src)) return [];
  const mask = buildNonCodeMask(src);
  const out = [];
  const re = /process\.exit\s*\(\s*1\s*\)/g;
  for (const m of src.matchAll(re)) {
    if (mask[m.index] !== 0) continue;
    out.push({ rel, rule: "process-exit-1", line: lineOf(src, m.index), snippet: snippetOf(src, m.index, 80) });
    break;
  }
  return out;
}
function detectMkdtempNoCleanup(src, rel) {
  const mask = buildNonCodeMask(src);
  const mkdtempRe = /\bmkdtemp(?:Sync)?\s*\(/g;
  const mkdtempCalls = [];
  for (const m of src.matchAll(mkdtempRe)) {
    if (mask[m.index] !== 0) continue;
    mkdtempCalls.push({ index: m.index, varName: mkdtempResultVar(src, mask, m.index) });
  }
  if (mkdtempCalls.length === 0) return [];
  const prefixes = mkdtempCalls.map((c) => mkdtempPrefix(src, mask, c.index));
  const exemptPrefix = /^claude-/;
  if (prefixes.length > 0 && prefixes.every((p) => exemptPrefix.test(p))) return [];
  const regions = cleanupRegions(src, mask);
  if (regions.length === 0) {
    return [{ rel, rule: "mkdtemp-no-cleanup", line: lineOf(src, mkdtempCalls[0].index), snippet: snippetOf(src, mkdtempCalls[0].index, 80) }];
  }
  const defs = functionDefs(src, mask);
  const rets = returnsReferencingMkdtemp(src, mask, defs);
  for (const c of mkdtempCalls) {
    if (!c.varName) {
      const fname = nearestFuncName(defs, c.index);
      if (fname && rets.inline.has(fname)) {
        if (callerCleansReturn(src, mask, fname, (v) => isCoveredVar(src, mask, v, regions))) continue;
        return [{ rel, rule: "mkdtemp-no-cleanup", line: lineOf(src, c.index), snippet: snippetOf(src, c.index, 80) }];
      }
      continue;
    }
    if (isCoveredVar(src, mask, c.varName, regions)) continue;
    const rec = rets.byVar.get(c.varName);
    if (rec && rec.funcName && callerCleansReturn(src, mask, rec.funcName, (v) => isCoveredVar(src, mask, v, regions))) continue;
    return [{ rel, rule: "mkdtemp-no-cleanup", line: lineOf(src, c.index), snippet: snippetOf(src, c.index, 80) }];
  }
  return [];
}
var LIVE_DIR_SEGMENT_RE = /^(?:tasks|\.quay|\.workflow-events|adr)$/;
var LIVE_DIR_PATH_RE = /^(?:tasks|\.quay|\.workflow-events|adr)(?:[/\\]|$)/;
function tmpRootVars(src, mask) {
  const names = /* @__PURE__ */ new Set();
  const declRe = /\b(?:const|let|var)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g;
  for (const m of src.matchAll(declRe)) {
    if (mask[m.index] !== 0) continue;
    let depth = 0;
    let end = m.index + m[0].length;
    for (let i = end; i < src.length; i++) {
      if (mask[i] !== 0) continue;
      const c = src[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ";" && depth <= 0) {
        end = i;
        break;
      }
    }
    if (/mkdtemp|os\.tmpdir|makeTmp/.test(src.slice(m.index, end))) names.add(m[1]);
  }
  return names;
}
var SHARED_ROOT_TOKEN_RE = /\b(?:REPO_ROOT|repoRoot|__dirname)\b|process\.cwd\s*\(|import\.meta|\bfileURLToPath\b/;
function sharedRootVars(src, mask, initRe = /process\.cwd|__dirname|import\.meta|fileURLToPath/) {
  const names = /* @__PURE__ */ new Set();
  const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g;
  for (const m of src.matchAll(declRe)) {
    if (mask[m.index] !== 0) continue;
    let depth = 0;
    let end = m.index + m[0].length;
    for (let i = end; i < src.length; i++) {
      if (mask[i] !== 0) continue;
      const c = src[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ";" && depth <= 0) {
        end = i;
        break;
      }
    }
    if (initRe.test(src.slice(m.index, end))) names.add(m[1]);
  }
  return names;
}
function initializerRegionOf(src, mask, name, beforeIdx) {
  const declRe = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=(?!=)`, "g");
  let best = null;
  for (const m of src.matchAll(declRe)) {
    if (m.index >= beforeIdx) break;
    if (mask[m.index] !== 0) continue;
    const start = m.index + m[0].length;
    let depth = 0;
    let end = start;
    for (let i = start; i < src.length; i++) {
      if (mask[i] !== 0) continue;
      const c = src[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ";" && depth <= 0) {
        end = i;
        break;
      }
    }
    if (end > start) best = [start, end];
  }
  return best;
}
function findLiveDirJoin(src, mask, from, to, tmpVars, sharedVars) {
  const slice = src.slice(from, to);
  const joinRe = /\b(?:path\.join|path\.resolve|join|resolve)\s*\(/g;
  for (const m of slice.matchAll(joinRe)) {
    const absIdx = from + m.index;
    if (mask[absIdx] !== 0) continue;
    const jOpen = absIdx + m[0].length - 1;
    const jRegion = callRegion(src, mask, jOpen);
    const jEnd = jOpen + jRegion.length;
    const jLits = codeStrings(src, mask, jOpen, jEnd);
    if (!jLits.some((s) => LIVE_DIR_SEGMENT_RE.test(s) || LIVE_DIR_PATH_RE.test(s))) continue;
    if (codeRegionHas(src, mask, jOpen, jRegion, /os\.tmpdir\s*\(/)) return null;
    if (insideMkdtempCall(src, mask, jOpen)) return null;
    for (const v of tmpVars) if (codeRegionHas(src, mask, jOpen, jRegion, new RegExp(`\\b${v}\\b`))) return null;
    if (codeRegionHas(src, mask, jOpen, jRegion, /process\.cwd\s*\(\s*\)|__dirname|import\.meta|fileURLToPath/)) return absIdx;
    for (const v of sharedVars) if (codeRegionHas(src, mask, jOpen, jRegion, new RegExp(`\\b${v}\\b`))) return absIdx;
    return null;
  }
  return null;
}
function detectLiveDataDirWrites(src, rel) {
  const mask = buildNonCodeMask(src);
  const out = [];
  const writeRe = /\b(?:writeFileSync|writeFile|appendFileSync|mkdirSync|mkdir|rmSync|rm|unlinkSync|cpSync|copyFileSync|createWriteStream)\s*\(/g;
  const tmpVars = tmpRootVars(src, mask);
  const sharedVars = sharedRootVars(src, mask);
  const fileChdirs = codePositions(src, mask, /process\.chdir\s*\(/g).length > 0;
  for (const m of src.matchAll(writeRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    const end = openIdx + region.length;
    const [argStart, argEnd] = firstArgRegion(src, mask, openIdx, region);
    const argText = src.slice(argStart, argEnd).trim();
    let hit = null;
    if (!fileChdirs && /^["'`]/.test(argText) && codeStrings(src, mask, argStart, argEnd).some((s) => LIVE_DIR_PATH_RE.test(s))) {
      hit = m.index;
    } else {
      const idm = argText.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
      if (idm) {
        const init = initializerRegionOf(src, mask, idm[1], m.index);
        if (init) hit = findLiveDirJoin(src, mask, init[0], init[1], tmpVars, sharedVars);
      } else {
        hit = findLiveDirJoin(src, mask, argStart, argEnd, tmpVars, sharedVars);
      }
    }
    if (hit !== null) {
      out.push({ rel, rule: "live-data-dir-write", line: lineOf(src, hit), snippet: snippetOf(src, hit, 80) });
    }
  }
  return out;
}
function detectSharedRootMkdtemp(src, rel) {
  const mask = buildNonCodeMask(src);
  const out = [];
  const mkdtempRe = /\bmkdtemp(?:Sync)?\s*\(/g;
  const tmpVars = tmpRootVars(src, mask);
  const sharedVars = sharedRootVars(src, mask, /\b(?:REPO_ROOT|repoRoot)\b|process\.cwd|__dirname|import\.meta|fileURLToPath/);
  for (const m of src.matchAll(mkdtempRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].length - 1;
    const region = callRegion(src, mask, openIdx);
    if (codeRegionHas(src, mask, openIdx, region, /os\.tmpdir\s*\(/)) continue;
    let safeTmp = false;
    for (const v of tmpVars) {
      if (codeRegionHas(src, mask, openIdx, region, new RegExp(`\\b${v}\\b`))) {
        safeTmp = true;
        break;
      }
    }
    if (safeTmp) continue;
    if (codeRegionHas(src, mask, openIdx, region, SHARED_ROOT_TOKEN_RE)) {
      out.push({ rel, rule: "shared-root-mkdtemp", line: lineOf(src, m.index), snippet: snippetOf(src, m.index, 80) });
      continue;
    }
    let shared = false;
    for (const v of sharedVars) {
      if (codeRegionHas(src, mask, openIdx, region, new RegExp(`\\b${v}\\b`))) {
        shared = true;
        break;
      }
    }
    if (shared) {
      out.push({ rel, rule: "shared-root-mkdtemp", line: lineOf(src, m.index), snippet: snippetOf(src, m.index, 80) });
    }
  }
  return out;
}
function mkdtempPrefix(src, mask, callIdx) {
  const openIdx = src.indexOf("(", callIdx);
  const region = callRegion(src, mask, openIdx);
  const args = codeStrings(src, mask, openIdx, openIdx + region.length);
  return args[0] ?? "";
}
function mkdtempResultVar(src, mask, callIdx) {
  const lineStart = src.lastIndexOf("\n", callIdx) + 1;
  const before = src.slice(lineStart, callIdx);
  let eq = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    if (mask[lineStart + i] !== 0) continue;
    if (before[i] === "=") {
      eq = i;
      break;
    }
  }
  if (eq === -1) return null;
  const lhs = before.slice(0, eq).trim();
  const m = lhs.match(/(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
  if (m) return m[1];
  const m2 = lhs.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
  return m2 ? m2[1] : null;
}
function cleanupRegions(src, mask) {
  const regions = [];
  const rmRe = /\b(?:rmSync|rm|unlinkSync)\s*\(/g;
  for (const m of src.matchAll(rmRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].indexOf("(");
    const region = callRegion(src, mask, openIdx);
    regions.push({ start: openIdx, end: openIdx + region.length });
  }
  const afterRe = /\b(?:t\.)?(?:after|afterEach)\s*\(/g;
  for (const m of src.matchAll(afterRe)) {
    if (mask[m.index] !== 0) continue;
    const openIdx = m.index + m[0].indexOf("(");
    const region = callRegion(src, mask, openIdx);
    regions.push({ start: openIdx, end: openIdx + region.length });
  }
  const finRe = /\bfinally\s*\{/g;
  for (const m of src.matchAll(finRe)) {
    if (mask[m.index] !== 0) continue;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (mask[i] !== 0) continue;
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    regions.push({ start: m.index, end: i + 1 });
  }
  return regions;
}
function isCoveredVar(src, mask, name, regions) {
  for (const r of regions) if (varInRegion(src, mask, name, r)) return true;
  const arrs = arraysReceivingVar(src, mask, name);
  for (const a of arrs) for (const r of regions) if (varInRegion(src, mask, a, r)) return true;
  return false;
}
function varInRegion(src, mask, name, region) {
  const re = new RegExp(`\\b${name}\\b`, "g");
  for (const m of src.slice(region.start, region.end).matchAll(re)) {
    const abs = region.start + m.index;
    if (mask[abs] === 0) return true;
  }
  return false;
}
function arraysReceivingVar(src, mask, name) {
  const arrs = /* @__PURE__ */ new Set();
  const pushRe = new RegExp(`([A-Za-z_$][A-Za-z0-9_$]*)\\.push\\s*\\(\\s*${name}\\s*\\)`, "g");
  for (const m of src.matchAll(pushRe)) {
    if (mask[m.index] !== 0) continue;
    arrs.add(m[1]);
  }
  return arrs;
}
function functionDefs(src, mask) {
  const defs = [];
  const patterns = [
    /\b(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?function\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g,
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      if (mask[m.index] !== 0) continue;
      defs.push({ name: m[1], index: m.index, matchLen: m[0].length });
    }
  }
  return defs.sort((a, b) => a.index - b.index);
}
function nearestFuncName(defs, idx) {
  let best = null;
  for (const d of defs) {
    if (d.index < idx) best = d.name;
    else break;
  }
  return best;
}
function returnsReferencingMkdtemp(src, mask, defs) {
  const byVar = /* @__PURE__ */ new Map();
  const inline = /* @__PURE__ */ new Set();
  const retRe = /\breturn\s+([^\n;]+)/g;
  for (const m of src.matchAll(retRe)) {
    if (mask[m.index] !== 0) continue;
    const expr = m[1].trim();
    const fname = nearestFuncName(defs, m.index);
    if (/mkdtemp/.test(expr)) {
      if (fname) inline.add(fname);
      continue;
    }
    const varM = expr.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (varM) {
      if (!byVar.has(varM[1])) byVar.set(varM[1], { returned: false, funcName: null });
      const rec = byVar.get(varM[1]);
      rec.returned = true;
      if (fname) rec.funcName = fname;
    }
  }
  return { byVar, inline };
}
function callerCleansReturn(src, mask, funcName, isCovered) {
  const re = new RegExp(`\\b${funcName}\\s*\\(`, "g");
  const def = functionDefs(src, mask).find((d) => d.name === funcName);
  for (const m of src.matchAll(re)) {
    if (mask[m.index] !== 0) continue;
    if (def && m.index >= def.index && m.index < def.index + def.matchLen) continue;
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const before = src.slice(lineStart, m.index);
    const destr = before.match(
      /(?:const|let|var)\s*\{\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\s*:\s*[A-Za-z_$][A-Za-z0-9_$]*)?(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\s*:\s*[A-Za-z_$][A-Za-z0-9_$]*)?)*)\s*\}\s*=\s*$/
    );
    if (destr) {
      const caps = destr[1].split(",").map((s) => s.trim().split(":")[0].trim());
      if (caps.some((v) => isCovered(v))) return true;
      continue;
    }
    const stripped = before.replace(/\s*[A-Za-z_$][A-Za-z0-9_$]*\s*$/, "");
    const direct = stripped.match(/(?:const|let|var)?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\?\?=|\|\|=|=)\s*$/);
    if (direct && !/\b(?:return|if|else|while|for|throw)\b/.test(before)) {
      if (isCovered(direct[1])) return true;
    }
  }
  return false;
}
function detectAll(src, rel) {
  return [
    ...detectFixedPathWrites(src, rel),
    ...detectSharedBuildArtifactWrites(src, rel),
    ...detectSpawnsTestSh(src, rel),
    ...detectProcessExit1(src, rel),
    ...detectMkdtempNoCleanup(src, rel),
    ...detectLiveDataDirWrites(src, rel),
    ...detectSharedRootMkdtemp(src, rel)
  ];
}
function parseViolationList(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
}
function parseEntry(entry) {
  const idx = entry.lastIndexOf(":");
  if (idx <= 0 || idx === entry.length - 1) return null;
  const rel = entry.slice(0, idx);
  const rule = entry.slice(idx + 1);
  if (!RULE_KEYS.includes(rule)) return null;
  return { rel, rule };
}
function runIsolationChecks(i) {
  const failures = [];
  const currentSet = new Set(i.current);
  const dataSet = new Set(i.dataEntries);
  const baselineSet = new Set(i.baselineEntries);
  const bootstrap = i.baselineEntries.length === 0;
  if (i.baselineCount !== null && i.dataEntries.length > i.baselineCount) {
    failures.push(
      `AC5: the violation list has ${i.dataEntries.length} entries, over the ratchet ceiling of ${i.baselineCount} (${DATA_FILE_REL2} header "# baseline-count"). The list can only get SHORTER.`
    );
  }
  if (!bootstrap && i.baselineCountHead !== null && i.baselineCount !== null && i.baselineCount > i.baselineCountHead) {
    failures.push(
      `AC5: the ratchet ceiling was RAISED from ${i.baselineCountHead} to ${i.baselineCount} in ${DATA_FILE_REL2} \u2014 the ceiling is shrink-only.`
    );
  }
  for (const v of i.current) {
    if (!dataSet.has(v)) {
      failures.push(
        `AC5: ${v} is a CURRENT violation with no entry in ${DATA_FILE_REL2} \u2014 a new violation was introduced. The list can only get SHORTER; fix the test (mkdtemp / build to a temp tree / stop spawning scripts/test.sh / use process.exitCode). Do NOT add it to the list.`
      );
    }
  }
  if (!bootstrap) {
    for (const e of i.dataEntries) {
      if (!baselineSet.has(e)) {
        failures.push(
          `AC5: ${e} was ADDED to the violation list \u2014 the list can only get SHORTER. Fix the test instead; there is no way to exempt a new violation.`
        );
      }
    }
  }
  for (const e of i.dataEntries) {
    const parsed = parseEntry(e);
    if (!parsed) {
      failures.push(`AC5: malformed entry "${e}" in ${DATA_FILE_REL2} \u2014 expected "<repo-relative-test-file>:<one of ${RULE_KEYS.join("|")}>".`);
      continue;
    }
    if (!i.fileExists(parsed.rel)) {
      failures.push(`AC5: violation entry ${e} names a file that no longer exists \u2014 remove it (the list only shrinks).`);
      continue;
    }
    if (!currentSet.has(e)) {
      failures.push(`AC5: violation entry ${e} is STALE \u2014 the code no longer triggers this rule. Remove it (the list only shrinks; fixing a violation means shortening the list).`);
    }
  }
  return failures;
}
function gitHeadExists2(root) {
  try {
    execFileSync2("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}
function gitShowFile2(root, ref, rel) {
  try {
    return execFileSync2("git", ["-C", root, "show", `${ref}:${rel}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return null;
  }
}
function main2(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node test-isolation-check.ts [<workspace-root>] [--json] [--list] [--selftest] [--data-file <path>] [--baseline-file <path>]");
  if (args.includes("--selftest")) {
    process.exit(runSelftest2() ? 0 : 1);
  }
  const asJson = args.includes("--json");
  const asList = args.includes("--list");
  const positional = args.filter((a) => !a.startsWith("--"));
  const root = path3.resolve(positional[0] ?? process.cwd());
  const dataFileRel = flagValue(args, "--data-file") ?? DATA_FILE_REL2;
  const dataFileAbs = path3.isAbsolute(dataFileRel) ? dataFileRel : path3.join(root, dataFileRel);
  if (!fs4.existsSync(path3.join(root, "scripts", "test.sh"))) {
    console.error(`ERROR: ${path3.join(root, "scripts", "test.sh")} not found \u2014 is <workspace-root> correct?`);
    return 2;
  }
  const files = canonicalTestFiles(root);
  const violations = [];
  for (const rel of files) {
    violations.push(...detectAll(readFileSafe(path3.join(root, rel)), rel));
  }
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const v of violations) {
    const key = `${v.rel}:${v.rule}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(v);
  }
  deduped.sort((a, b) => `${a.rel}:${a.rule}`.localeCompare(`${b.rel}:${b.rule}`));
  const current = deduped.map((v) => `${v.rel}:${v.rule}`);
  if (asList) {
    for (const v of current) console.log(v);
    return 0;
  }
  const dataText = readFileSafe(dataFileAbs);
  const dataEntries = parseViolationList(dataText);
  const baselineCount = parseBaselineCount(dataText);
  let baselineEntries = dataEntries;
  let baselineCountHead = null;
  const baselineFileArg = flagValue(args, "--baseline-file");
  if (baselineFileArg) {
    const baselineText = readFileSafe(path3.resolve(root, baselineFileArg));
    baselineEntries = parseViolationList(baselineText);
    baselineCountHead = parseBaselineCount(baselineText);
  } else {
    const gitOk = gitHeadExists2(root);
    if (!gitOk) {
      console.error(
        "ERROR: test-isolation-check needs a git baseline (git HEAD) to enforce the AC5 ratchet. Pass --baseline-file for a non-git fixture, or run in the real checkout."
      );
      return 2;
    }
    const committed = gitShowFile2(root, "HEAD", dataFileRel);
    if (committed !== null) {
      baselineEntries = parseViolationList(committed);
      baselineCountHead = parseBaselineCount(committed);
    }
  }
  const failures = runIsolationChecks({
    current,
    dataEntries,
    baselineEntries,
    baselineCount,
    baselineCountHead,
    fileExists: (rel) => fs4.existsSync(path3.join(root, rel))
  });
  const ruleCounts = {};
  for (const v of deduped) ruleCounts[v.rule] = (ruleCounts[v.rule] ?? 0) + 1;
  const breakdown = RULE_KEYS.map((k) => `${k}=${ruleCounts[k] ?? 0}`).join(" ");
  const liveDataDirWrites = ruleCounts["live-data-dir-write"] ?? 0;
  const summary = `test-isolation-check \u2014 ${files.length} glob file(s), ${deduped.length} current violation(s) [${breakdown}]`;
  if (asJson) {
    console.log(JSON.stringify({
      ok: failures.length === 0,
      files: files.length,
      violations: deduped.map((v) => ({ rel: v.rel, rule: v.rule, line: v.line, snippet: v.snippet })),
      liveDataDirWrites,
      ratchetFailures: failures
    }, null, 2));
  } else {
    console.log(summary);
    for (const v of deduped) {
      console.log(`  ${v.rel}:${v.rule}  (line ${v.line}) ${v.snippet}`);
    }
    if (failures.length === 0) {
      console.log(`PASS: all ${deduped.length} violation(s) are baselined in ${dataFileRel}; the list can only get SHORTER (no additions, no growth, no stale entries).`);
    } else {
      console.log(`FAIL: ${failures.length} ratchet violation(s):`);
      for (const f of failures) console.log(`  - ${f}`);
    }
  }
  return failures.length === 0 ? 0 : 1;
}
function runSelftest2() {
  const st = createSelftest({ flavor: "counters", label: "test-isolation-check" });
  const check = st.check;
  const fixedTmp = 'const tasksDir = path.join(__dirname, ".tmp-lock-test");\n';
  check("R1 RED: fixed __dirname/.tmp- path reports", detectFixedPathWrites(fixedTmp, "x.test.mjs").some((v) => v.rule === "fixed-path-write"));
  const mkdtempOk = 'const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-sync-"));\n';
  check("R1 GREEN: mkdtemp/os.tmpdir prefix does NOT report", detectFixedPathWrites(mkdtempOk, "x.test.mjs").length === 0);
  const mkdtempDirname = 'const dir = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", ".tmp-tree-"));\n';
  check("R1 GREEN: mkdtemp under __dirname is a PREFIX, not a fixed write", detectFixedPathWrites(mkdtempDirname, "x.test.mjs").length === 0);
  const commentOnly = '// path.join(__dirname, ".tmp-comment-only") mention\n';
  check("R1 GREEN: a comment mentioning .tmp does NOT report", detectFixedPathWrites(commentOnly, "x.test.mjs").length === 0);
  const joinInlineComment = "path.join(a, b /* __dirname .tmp- */)\n";
  check("R1 GREEN: an INLINE comment inside the join args does NOT report", detectFixedPathWrites(joinInlineComment, "x.test.mjs").length === 0);
  const syncNoCheck = 'execFileSync("bash", [path.join(pluginDir, "scripts", "sync-vendor.sh")], { cwd: repoRoot });\n';
  check("R2 RED: sync-vendor.sh sync-mode (no --check) reports", detectSharedBuildArtifactWrites(syncNoCheck, "x.test.mjs").some((v) => v.rule === "shared-build-artifact-write"));
  const syncCheck = 'execFileSync("bash", [syncScript, "--check"], { cwd: repoRoot });\n';
  check("R2 GREEN: sync-vendor.sh --check (read-only) does NOT report", detectSharedBuildArtifactWrites(syncCheck, "x.test.mjs").length === 0);
  const tempBuild = 'fs.writeFileSync(path.join(root, "dist", "quay.js"), "x"); // root is a mkdtemp\n';
  check("R2 GREEN: writing dist under a temp root does NOT report", detectSharedBuildArtifactWrites(tempBuild, "x.test.mjs").length === 0);
  const sharedDist = 'fs.writeFileSync("packages/quay/dist/quay.js", "x");\n';
  check("R2 RED: direct write to a shared packages/*/dist path reports", detectSharedBuildArtifactWrites(sharedDist, "x.test.mjs").some((v) => v.rule === "shared-build-artifact-write"));
  const spawnLiteral = 'const r = spawnSync("bash", ["scripts/test.sh", "--list-files"], { encoding: "utf8" });\n';
  check("R3 RED: spawnSync of scripts/test.sh literal reports", detectSpawnsTestSh(spawnLiteral, "x.test.mjs").some((v) => v.rule === "spawns-test-sh"));
  const spawnVar = 'const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");\nspawnSync("bash", [TEST_SH, "--for-task", "x"]);\n';
  check("R3 RED: spawn via a test.sh variable reports", detectSpawnsTestSh(spawnVar, "x.test.mjs").some((v) => v.rule === "spawns-test-sh"));
  const spawnOther = 'spawnSync("bash", ["plugin/scripts/other.sh"], {});\n';
  check("R3 GREEN: spawning an unrelated script does NOT report", detectSpawnsTestSh(spawnOther, "x.test.mjs").length === 0);
  const spawnComment = '// spawnSync("bash", ["scripts/test.sh"])\nconst x = 1;\n';
  check("R3 GREEN: a comment mentioning the spawn does NOT report", detectSpawnsTestSh(spawnComment, "x.test.mjs").length === 0);
  const spawnInlineComment = 'spawnSync("bash", [otherScript], { // spawns scripts/test.sh inside the suite\n  cwd: root,\n});\n';
  check("R3 GREEN: an INLINE comment inside a spawn region does NOT report", detectSpawnsTestSh(spawnInlineComment, "x.test.mjs").length === 0);
  const spawnVarComment = 'const TEST_SH = path.join(REPO_ROOT, "scripts", "test.sh");\nconst r = spawnSync("bash", [other], { // TEST_SH\n});\n';
  check("R3 GREEN: a comment naming the test.sh var inside a spawn region does NOT report", detectSpawnsTestSh(spawnVarComment, "x.test.mjs").length === 0);
  const pe1Handrolled = "// @test-group product\nfunction fail() { process.exit(1); }\n";
  check("R4 RED: process.exit(1) in a hand-rolled file reports", detectProcessExit1(pe1Handrolled, "x.test.mjs").some((v) => v.rule === "process-exit-1"));
  const pe1NodeTest = '// @test-group engine\nimport { test } from "node:test";\nprocess.exit(1);\n';
  check("R4 GREEN: process.exit(1) in a node:test file does NOT report (out of rule scope)", detectProcessExit1(pe1NodeTest, "x.test.mjs").length === 0);
  const peCode = "// @test-group product\nprocess.exitCode = 1;\n";
  check("R4 GREEN: process.exitCode = 1 never reports", detectProcessExit1(peCode, "x.test.mjs").length === 0);
  const pe1Comment = "// @test-group product\n// uses process.exit(1) \u2014 dangerous\nfunction f() {}\n";
  check("R4 GREEN: a comment spelling process.exit(1) does NOT report", detectProcessExit1(pe1Comment, "x.test.mjs").length === 0);
  const pe1String = '// @test-group product\nconst s = "process.exit(1)";\n';
  check("R4 GREEN: process.exit(1) inside a string literal does NOT report", detectProcessExit1(pe1String, "x.test.mjs").length === 0);
  const leakBare = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\n';
  check("R6 RED: mkdtemp with no cleanup reports", detectMkdtempNoCleanup(leakBare, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const leakNoMkdtemp = "// @test-group product\nconst x = 1;\n";
  check("R6 GREEN: no mkdtemp never reports", detectMkdtempNoCleanup(leakNoMkdtemp, "x.test.mjs").length === 0);
  const cleanedAfter = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\nt.after(() => fs.rmSync(dir, { recursive: true, force: true }));\n';
  check("R6 GREEN: t.after cleanup does NOT report", detectMkdtempNoCleanup(cleanedAfter, "x.test.mjs").length === 0);
  const cleanedRm = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-"));\nfs.rmSync(dir, { recursive: true, force: true });\n';
  check("R6 GREEN: rmSync cleanup does NOT report", detectMkdtempNoCleanup(cleanedRm, "x.test.mjs").length === 0);
  const cleanedFinally = '// @test-group product\ntry { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")); } finally {}\n';
  check("R6 RED: an EMPTY finally (no rmSync of the mkdtemp dir) is a leak \u2014 reports", detectMkdtempNoCleanup(cleanedFinally, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const finallyRm = '// @test-group product\ntry { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")); } finally { fs.rmSync(dir, { recursive: true, force: true }); }\n';
  check("R6 GREEN: try/finally that rmSyncs the mkdtemp dir does NOT report", detectMkdtempNoCleanup(finallyRm, "x.test.mjs").length === 0);
  const partialClean = '// @test-group product\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-"));\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-"));\nconst c = fs.mkdtempSync(path.join(os.tmpdir(), "adr-c-"));\nt.after(() => fs.rmSync(a, { recursive: true, force: true }));\n';
  check("R6 RED: 3 mkdtemp / 1 cleaned reports (partial cleanup)", detectMkdtempNoCleanup(partialClean, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const allClean = '// @test-group product\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-"));\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-"));\nconst c = fs.mkdtempSync(path.join(os.tmpdir(), "adr-c-"));\nt.after(() => { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }); fs.rmSync(c, { recursive: true, force: true }); });\n';
  check("R6 GREEN: 3 mkdtemp / 3 cleaned does NOT report", detectMkdtempNoCleanup(allClean, "x.test.mjs").length === 0);
  const carrierArray = '// @test-group product\nconst _createdDirs = [];\nconst a = fs.mkdtempSync(path.join(os.tmpdir(), "adr-a-")); _createdDirs.push(a);\nconst b = fs.mkdtempSync(path.join(os.tmpdir(), "adr-b-")); _createdDirs.push(b);\nafter(() => { for (const dir of _createdDirs) fs.rmSync(dir, { recursive: true, force: true }); });\n';
  check("R6 GREEN: _createdDirs.push + after-loop removes all \u2014 does NOT report", detectMkdtempNoCleanup(carrierArray, "x.test.mjs").length === 0);
  const callerCleaned = '// @test-group product\nfunction makeFakeGhBin() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-fake-")); return dir; }\nconst fakeBinDir = makeFakeGhBin();\nt.after(() => fs.rmSync(fakeBinDir, { recursive: true, force: true }));\n';
  check("R6 GREEN: helper-return captured into a cleaned var does NOT report", detectMkdtempNoCleanup(callerCleaned, "x.test.mjs").length === 0);
  const callerLeaks = '// @test-group product\nfunction makeWs() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gw-leak-")); return dir; }\nconst ws = makeWs();\n';
  check("R6 RED: helper-return never cleaned reports", detectMkdtempNoCleanup(callerLeaks, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const claudePrefix = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-abc123"));\n';
  check("R6 GREEN: /tmp/claude-* prefix NEVER reports (AC6)", detectMkdtempNoCleanup(claudePrefix, "x.test.mjs").length === 0);
  const quayWtPrefix = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-wt-some-task"));\n';
  check("R6 RED: quay-wt-* prefix NOW reports \u2014 the worktree exemption was removed (worktrees are git worktree add at loop.worktree_root, never mkdtemp'd)", detectMkdtempNoCleanup(quayWtPrefix, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const mixedPrefix = '// @test-group product\nconst dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-wt-inuse"));\nconst leak = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-ok-leak"));\n';
  check("R6 RED: a non-exempt prefix alongside another non-exempt prefix still reports (AC6)", detectMkdtempNoCleanup(mixedPrefix, "x.test.mjs").some((v) => v.rule === "mkdtemp-no-cleanup"));
  const mkdtempCommentOnly = '// @test-group product\n// fs.mkdtempSync(path.join(os.tmpdir(), "adr-store-")) mention\nconst x = 1;\n';
  check("R6 GREEN: a comment mentioning mkdtemp does NOT report (code-position matching)", detectMkdtempNoCleanup(mkdtempCommentOnly, "x.test.mjs").length === 0);
  const r7Specimen = 'const taskPath = path.join(process.cwd(), "tasks", "M-FAKE.md");\nfs.writeFileSync(taskPath, taskText);\n';
  check('R7 RED: path.join(process.cwd(), "tasks", \u2026) write reports', detectLiveDataDirWrites(r7Specimen, "x.test.mjs").some((v) => v.rule === "live-data-dir-write"));
  const r7Workspace = 'const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dod-check-"));\nfs.mkdirSync(path.join(workspaceRoot, "tasks"));\nconst taskPath = path.join(workspaceRoot, "tasks", "M-FAKE.md");\nfs.writeFileSync(taskPath, taskText);\n';
  check("R7 GREEN: a write under a mkdtemp workspace root does NOT report", detectLiveDataDirWrites(r7Workspace, "x.test.mjs").length === 0);
  const r7BareTmp = 'let workspaceRoot;\nworkspaceRoot = makeTmpDir("x-ws-");\nfs.writeFileSync(path.join(workspaceRoot, ".quay", "config.yml"), "x");\n';
  check("R7 GREEN: a bare-assigned makeTmpDir root (no const) does NOT report", detectLiveDataDirWrites(r7BareTmp, "x.test.mjs").length === 0);
  const r7SaveRestore = 'const originalCwd = process.cwd();\nprocess.chdir(workspaceRoot);\ntry { fs.writeFileSync("config.yml", "x"); } finally { process.chdir(originalCwd); }\n';
  check("R7 GREEN: originalCwd = process.cwd() save/restore does NOT report", detectLiveDataDirWrites(r7SaveRestore, "x.test.mjs").length === 0);
  const r7Literal = 'fs.writeFileSync("tasks/M-FAKE.md", taskText);\n';
  check("R7 RED: a literal relative tasks/ write reports (no chdir in file)", detectLiveDataDirWrites(r7Literal, "x.test.mjs").some((v) => v.rule === "live-data-dir-write"));
  const r7Comment = '// const taskPath = path.join(process.cwd(), "tasks", "M-FAKE.md")\nconst x = 1;\n';
  check("R7 GREEN: a comment mentioning the pattern does NOT report (code-position matching)", detectLiveDataDirWrites(r7Comment, "x.test.mjs").length === 0);
  const r7ReadOnly = 'const realTasksDir = path.join(REPO_ROOT, "tasks");\nconst raw = fs.readFileSync(path.join(realTasksDir, "x.md"), "utf8");\n';
  check("R7 GREEN: a READ from REPO_ROOT/tasks does NOT report (write ops only)", detectLiveDataDirWrites(r7ReadOnly, "x.test.mjs").length === 0);
  const r8RepoRoot = 'const logFile = path.join(fs.mkdtempSync(path.join(REPO_ROOT, ".quay-tmp-test-")), "g.jsonl");\n';
  check("R8 RED: mkdtempSync(path.join(REPO_ROOT, ...)) reports", detectSharedRootMkdtemp(r8RepoRoot, "x.test.mjs").some((v) => v.rule === "shared-root-mkdtemp"));
  const r8Dirname = 'const tmp = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", "loadbearing", ".tmp-tree-"));\n';
  check("R8 RED: mkdtempSync(path.join(__dirname, ...)) reports", detectSharedRootMkdtemp(r8Dirname, "x.test.mjs").some((v) => v.rule === "shared-root-mkdtemp"));
  const r8Tmpdir = 'const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-ts-typecheck-gate-"));\n';
  check("R8 GREEN: mkdtempSync(path.join(os.tmpdir(), ...)) does NOT report", detectSharedRootMkdtemp(r8Tmpdir, "x.test.mjs").length === 0);
  const r8MakeTmpVar = 'const ws = makeTmpDir("x-ws-");\nconst d = fs.mkdtempSync(path.join(ws, "sub-"));\n';
  check("R8 GREEN: mkdtemp under a makeTmp-derived variable does NOT report", detectSharedRootMkdtemp(r8MakeTmpVar, "x.test.mjs").length === 0);
  const r8CwdVar = 'const cwd = process.cwd();\nconst dir = fs.mkdtempSync(path.join(cwd, "leak-"));\n';
  check("R8 RED: mkdtemp under a process.cwd()-derived variable reports", detectSharedRootMkdtemp(r8CwdVar, "x.test.mjs").some((v) => v.rule === "shared-root-mkdtemp"));
  const r8Indirect = 'const ROOT = path.join(REPO_ROOT, "fixtures");\nconst dir = fs.mkdtempSync(path.join(ROOT, "leak-"));\n';
  check("R8 RED: mkdtemp under a REPO_ROOT-derived variable reports (variable indirection)", detectSharedRootMkdtemp(r8Indirect, "x.test.mjs").some((v) => v.rule === "shared-root-mkdtemp"));
  const r8Unknown = 'const dir = fs.mkdtempSync(path.join(rootParam, "x-"));\n';
  check("R8 GREEN: mkdtemp under an unknown (function-param) root is lenient-skipped", detectSharedRootMkdtemp(r8Unknown, "x.test.mjs").length === 0);
  const r8Comment = '// fs.mkdtempSync(path.join(REPO_ROOT, ".quay-tmp-test-")) mention\nconst x = 1;\n';
  check("R8 GREEN: a comment mentioning the pattern does NOT report (code-position matching)", detectSharedRootMkdtemp(r8Comment, "x.test.mjs").length === 0);
  const r8String = `const s = 'const dir = fs.mkdtempSync(path.join(__dirname, "..", "fixtures", ".tmp-tree-"));';
`;
  check("R8 GREEN: the pattern inside a STRING LITERAL does NOT report (AC3 \u2014 the detector's own test fixture)", detectSharedRootMkdtemp(r8String, "x.test.mjs").length === 0);
  const entries = ["a.test.mjs:fixed-path-write", "b.test.mjs:process-exit-1"];
  const baseline = ["a.test.mjs:fixed-path-write", "b.test.mjs:process-exit-1"];
  let failures = runIsolationChecks({ current: entries, dataEntries: entries, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("ratchet GREEN: current == data file passes", failures.length === 0, JSON.stringify(failures));
  failures = runIsolationChecks({ current: [...entries, "c.test.mjs:spawns-test-sh"], dataEntries: entries, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("C1 RED: new current violation (no entry) fails", failures.some((f) => f.includes("c.test.mjs:spawns-test-sh") && f.includes("no entry")), JSON.stringify(failures));
  const grown = [...entries, "c.test.mjs:spawns-test-sh"];
  failures = runIsolationChecks({ current: grown, dataEntries: grown, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("C2a RED: data-file entry added vs HEAD fails", failures.some((f) => f.includes("c.test.mjs:spawns-test-sh") && f.includes("ADDED")), JSON.stringify(failures));
  failures = runIsolationChecks({ current: entries.slice(0, 1), dataEntries: entries, baselineEntries: baseline, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("C2c RED: stale entry (violation fixed, not removed) fails", failures.some((f) => f.includes("STALE")), JSON.stringify(failures));
  failures = runIsolationChecks({ current: grown, dataEntries: grown, baselineEntries: grown, baselineCount: 2, baselineCountHead: 2, fileExists: () => true });
  check("C0a RED: list over the ratchet ceiling fails at a clean commit", failures.some((f) => f.includes("over the ratchet ceiling")), JSON.stringify(failures));
  failures = runIsolationChecks({ current: grown, dataEntries: grown, baselineEntries: grown, baselineCount: 3, baselineCountHead: 2, fileExists: () => true });
  check("C0b RED: raising the ratchet ceiling fails", failures.some((f) => f.includes("ceiling was RAISED")), JSON.stringify(failures));
  failures = runIsolationChecks({ current: [], dataEntries: ["not-a-valid-entry"], baselineEntries: [], baselineCount: null, baselineCountHead: null, fileExists: () => true });
  check("C2d RED: malformed entry fails", failures.some((f) => f.includes("malformed")), JSON.stringify(failures));
  return st.report();
}
var isDirect2 = process.argv[1] && fileURLToPath2(import.meta.url) === process.argv[1];
if (isDirect2) {
  process.exit(main2(process.argv));
}
export {
  DATA_FILE_REL2 as DATA_FILE_REL,
  RULE_KEYS,
  callRegion,
  codePositions,
  codeStrings,
  detectAll,
  detectFixedPathWrites,
  detectLiveDataDirWrites,
  detectMkdtempNoCleanup,
  detectProcessExit1,
  detectSharedBuildArtifactWrites,
  detectSharedRootMkdtemp,
  detectSpawnsTestSh,
  main2 as main,
  parseBaselineCount,
  parseEntry,
  parseViolationList,
  runIsolationChecks,
  runSelftest2 as runSelftest,
  varsReferencing
};
