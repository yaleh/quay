#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/test-framework-policy-check.ts
import fs3 from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
export {
  DATA_FILE_REL,
  canonicalTestFiles,
  groupDeclRE,
  hasNodeTestImport,
  main,
  parseBaselineCount,
  parseExemptionList,
  runPolicyChecks,
  runSelftest
};
