#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/known-load-sensitive.ts
import fs2 from "node:fs";

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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/known-load-sensitive.ts
import path3 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path2 from "node:path";
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path2.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/known-load-sensitive.ts
var MARKER = "KNOWN-LOAD-SENSITIVE";
var KINDS = ["wall-clock", "nested-spawn", "real-install", "child-spawn", "fixture-vs-sweeper"];
var SERIAL_KINDS = ["wall-clock", "nested-spawn", "real-install", "child-spawn", "fixture-vs-sweeper"];
var TEST_GLOB_PARTS = ["packages/*/test/*.test.mjs", "plugin/test/*.test.mjs"];
function parseLoadSensitiveAnnotation(text) {
  const m = /^\s*\/\/\s*@load-sensitive\s+([A-Za-z0-9_-]+)\s*$/m.exec(text);
  if (!m) return null;
  return m[1];
}
function hasLoadSensitiveAnnotation(text) {
  return parseLoadSensitiveAnnotation(text) !== null;
}
function parseLoadSensitiveEntry(text) {
  const m = /^\s*\/\/\s*@load-sensitive-entry[ \t]+(\d{4}-\d{2}-\d{2})[ \t]+(.+?)[ \t]*$/m.exec(text);
  if (!m) return null;
  const reason = m[2].trim();
  if (!reason) return null;
  return { date: m[1], reason };
}
function hasLoadSensitiveEntry(text) {
  return parseLoadSensitiveEntry(text) !== null;
}
function isSerialGroupFile(text) {
  return /^\s*\/\/\s*@test-group\s+serial\b/m.test(text);
}
function hasHeaderClaim(text) {
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("//")) {
      if (/^\/\/\s*KNOWN-LOAD-SENSITIVE\s+\(see\b/.test(line)) return true;
      continue;
    }
    return false;
  }
  return false;
}
function isKnownKind(kind) {
  return KINDS.includes(kind);
}
function listTestFiles(root) {
  const out = [];
  const pluginTest = path3.join(root, "plugin", "test");
  if (fs2.existsSync(pluginTest)) {
    for (const f of fs2.readdirSync(pluginTest)) {
      if (f.endsWith(".test.mjs")) out.push(path3.posix.join("plugin", "test", f));
    }
  }
  const packages = path3.join(root, "packages");
  if (fs2.existsSync(packages)) {
    for (const pkg of fs2.readdirSync(packages)) {
      const pkgTest = path3.join(packages, pkg, "test");
      if (!fs2.existsSync(pkgTest)) continue;
      for (const f of fs2.readdirSync(pkgTest)) {
        if (f.endsWith(".test.mjs")) out.push(path3.posix.join("packages", pkg, "test", f));
      }
    }
  }
  const experiments = path3.join(root, "experiments");
  if (fs2.existsSync(experiments)) {
    for (const exp of fs2.readdirSync(experiments)) {
      const expTest = path3.join(experiments, exp, "test");
      if (!fs2.existsSync(expTest)) continue;
      for (const f of fs2.readdirSync(expTest)) {
        if (f.endsWith(".test.mjs")) out.push(path3.posix.join("experiments", exp, "test", f));
      }
    }
  }
  return out.sort();
}
function scanFamily(root) {
  const members = [];
  for (const rel of listTestFiles(root)) {
    const p = path3.join(root, rel);
    let text;
    try {
      text = fs2.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const kind = parseLoadSensitiveAnnotation(text);
    if (kind !== null) {
      const entry = parseLoadSensitiveEntry(text);
      members.push(entry ? { rel, kind, entry } : { rel, kind });
    }
  }
  return members;
}
function kindForFile(family, rel) {
  const normalized = String(rel).replace(/\\/g, "/");
  const m = family.find((x) => x.rel === normalized);
  return m ? m.kind : void 0;
}
function isFamilyMember(family, rel) {
  return kindForFile(family, rel) !== void 0;
}
function checkNoUnannotatedClaims(root) {
  const violations = [];
  for (const rel of listTestFiles(root)) {
    const p = path3.join(root, rel);
    let text;
    try {
      text = fs2.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (hasHeaderClaim(text) && !hasLoadSensitiveAnnotation(text)) {
      violations.push({
        rel,
        reason: "header carries a KNOWN-LOAD-SENSITIVE claim but no // @load-sensitive <kind> annotation"
      });
    }
  }
  return violations;
}
function checkSerialEntries(root) {
  const violations = [];
  for (const rel of listTestFiles(root)) {
    const p = path3.join(root, rel);
    let text;
    try {
      text = fs2.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (isSerialGroupFile(text) && hasLoadSensitiveAnnotation(text) && !hasLoadSensitiveEntry(text)) {
      violations.push({
        rel,
        reason: "serial-group family member (KNOWN-LOAD-SENSITIVE) with no // @load-sensitive-entry <date> <reason> \u2014 \u8FDB\u5165\u539F\u56E0+\u8FDB\u5165\u65F6\u95F4 must be recorded so the root cause can be reviewed for a serial exit"
      });
    }
  }
  return violations;
}
function checkSerialKinds(root) {
  const violations = [];
  for (const rel of listTestFiles(root)) {
    const p = path3.join(root, rel);
    let text;
    try {
      text = fs2.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (!isSerialGroupFile(text)) continue;
    const kind = parseLoadSensitiveAnnotation(text);
    if (kind === null) continue;
    if (!SERIAL_KINDS.includes(kind)) {
      violations.push({
        rel,
        kind,
        reason: `serial-group family member declares @load-sensitive ${kind} \u2014 NOT a serial-lane mechanism kind (allowed: ${SERIAL_KINDS.join(", ")}). A ${kind} admission reason does not hit this lane's kind set (\u5206\u7EA7\u95F8; the 'heavy' \u515C\u5E95\u6876 has been retired \u2014 re-tag to a mechanism kind or re-split the lane)`
      });
    }
  }
  return violations;
}
function entryLineFor(member) {
  if (!member.entry) return null;
  return `${member.rel}	${member.entry.date}	${member.entry.reason}`;
}
var usage = `known-load-sensitive.ts \u2014 machine-readable KNOWN-LOAD-SENSITIVE family manifest
(tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage AC1/AC2;
 gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC4 \u2014 serial exit mechanism)

Usage:
  node --experimental-strip-types known-load-sensitive.ts --list [--root <dir>]
      # one line per family member: <rel-file>\\t<kind>  (Contract measure known_family_members)
  node --experimental-strip-types known-load-sensitive.ts --kind <rel-file> [--root <dir>]
      # the kind for one file (empty when not in family)
  node --experimental-strip-types known-load-sensitive.ts --check [--root <dir>]
      # AC2 invariant: no unannotated KNOWN-LOAD-SENSITIVE header claims; exit 1 on violation
  node --experimental-strip-types known-load-sensitive.ts --list-entry [--root <dir>]
      # exit-mechanism review hook: one line per family member WITH an entry record,
      # <rel-file>\\t<date>\\t<reason>, sorted by entry date (oldest first = longest in serial)
  node --experimental-strip-types known-load-sensitive.ts --check-exit [--root <dir>]
      # \u5206\u7EA7\u95F8 (AC4 + gap-suite-tiering-kind-heavy-not-a-mechanism): every serial-group family
      # member carries @load-sensitive-entry (\u8FDB\u5165\u539F\u56E0+\u8FDB\u5165\u65F6\u95F4) AND declares a serial-lane mechanism
      # kind (wall-clock|nested-spawn|real-install|child-spawn); exit 1 on a violation. A catch-all
      # kind (e.g. the retired 'heavy' \u515C\u5E95\u6876) is FAIL-closed \u2014 a downgrade must hit the lane's set.

Exit: 0 ok; 1 a --check/--check-exit invariant violation; 2 usage/env error.`;
function main(argv) {
  const args = argv.slice(2);
  const listMode = args.includes("--list");
  const kindArg = flagValue(args, "--kind");
  const checkMode = args.includes("--check");
  const listEntryMode = args.includes("--list-entry");
  const checkExitMode = args.includes("--check-exit");
  const root = path3.resolve(flagValue(args, "--root") ?? repoRoot());
  if (listMode) {
    for (const m of scanFamily(root)) {
      process.stdout.write(`${m.rel}	${m.kind}
`);
    }
    return 0;
  }
  if (kindArg !== void 0) {
    const family = scanFamily(root);
    const kind = kindForFile(family, kindArg);
    if (kind !== void 0) process.stdout.write(`${kind}
`);
    return 0;
  }
  if (checkMode) {
    const violations = checkNoUnannotatedClaims(root);
    if (violations.length > 0) {
      for (const v of violations) {
        process.stderr.write(`known-load-sensitive --check: ${v.rel}: ${v.reason}
`);
      }
      process.stderr.write(
        `known-load-sensitive --check: ${violations.length} unannotated KNOWN-LOAD-SENSITIVE claim(s) \u2014 add // @load-sensitive <kind> to each
`
      );
      return 1;
    }
    process.stdout.write("known-load-sensitive --check: ok \u2014 every KNOWN-LOAD-SENSITIVE header claim carries @load-sensitive <kind>\n");
    return 0;
  }
  if (listEntryMode) {
    const lines = scanFamily(root).map((m) => entryLineFor(m)).filter((l) => l !== null).sort((a, b) => {
      const da = a.split("	")[1];
      const db = b.split("	")[1];
      return da < db ? -1 : da > db ? 1 : 0;
    });
    for (const l of lines) process.stdout.write(`${l}
`);
    return 0;
  }
  if (checkExitMode) {
    const entryViolations = checkSerialEntries(root);
    const kindViolations = checkSerialKinds(root);
    if (entryViolations.length > 0 || kindViolations.length > 0) {
      for (const v of entryViolations) {
        process.stderr.write(`known-load-sensitive --check-exit: ${v.rel}: ${v.reason}
`);
      }
      for (const v of kindViolations) {
        process.stderr.write(`known-load-sensitive --check-exit: ${v.rel}: ${v.reason}
`);
      }
      process.stderr.write(
        `known-load-sensitive --check-exit: ${entryViolations.length + kindViolations.length} violation(s) \u2014 serial-group family members must carry (1) an @load-sensitive-entry <date> <reason> record AND (2) a serial-lane mechanism kind (${SERIAL_KINDS.join(", ")}); a ${kindViolations.length ? "non-mechanism/catch-all kind" : "missing entry"} is FAIL-closed (\u5206\u7EA7\u95F8, gap-suite-tiering-kind-heavy-not-a-mechanism)
`
      );
      return 1;
    }
    process.stdout.write("known-load-sensitive --check-exit: ok \u2014 every serial-group family member records \u8FDB\u5165\u539F\u56E0+\u8FDB\u5165\u65F6\u95F4 AND declares a serial-lane mechanism kind (\u5206\u7EA7\u95F8)\n");
    return 0;
  }
  process.stderr.write(`${usage}
`);
  return 2;
}
if (isDirectEntry(import.meta, void 0, "known-load-sensitive")) {
  process.exitCode = main(process.argv);
}
export {
  KINDS,
  MARKER,
  SERIAL_KINDS,
  TEST_GLOB_PARTS,
  checkNoUnannotatedClaims,
  checkSerialEntries,
  checkSerialKinds,
  entryLineFor,
  hasHeaderClaim,
  hasLoadSensitiveAnnotation,
  hasLoadSensitiveEntry,
  isFamilyMember,
  isKnownKind,
  isSerialGroupFile,
  kindForFile,
  listTestFiles,
  main,
  parseLoadSensitiveAnnotation,
  parseLoadSensitiveEntry,
  scanFamily
};
