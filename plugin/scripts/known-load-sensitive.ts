#!/usr/bin/env node
// known-load-sensitive.ts — the machine-readable KNOWN-LOAD-SENSITIVE family manifest
// (tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage, AC1/AC2).
//
// The 已知负载敏感族 rule was DOC-ONLY: fast-mode-loop-tick.md prose + per-file KNOWN-LOAD-SENSITIVE
// header comments, with ZERO code hits (`grep plugin/scripts/*.ts` = 0). Red-window triage relied on
// a human/agent remembering to do isolated reruns, the SAME marker conflated two root causes
// (session-liveness wall-clock vs runner-grouping nested-spawn), and a non-family cross-file race
// (test-file-snapshot baseline REMOVED vs runner-grouping AC7 zz- fixture) got swept into the
// 'environmental' bucket.
//
// This module makes the family machine-readable. Each family test file declares a machine-parseable
// `// @load-sensitive <kind>` annotation in its header (pattern reused from
// select-static-checks-for-touches.ts's `@static-tier` parsing). The parser scans the canonical test
// glob (packages/*/test/*.test.mjs plugin/test/*.test.mjs — the same glob scripts/test.sh owns) and
// emits the family list: {file, kind} pairs. One root cause = one kind; different root causes =
// different kinds (判读不得混用):
//
//   wall-clock    — real processes + tmux/session timing (session-liveness family, cold-start-skill)
//   nested-spawn  — spawns nested node --test / full-suite sub-suites (runner-grouping,
//                   quay-init-loop-core)
//   heavy         — real subprocess + port binding (serve.test.mjs)
//
// Commands:
//   node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --list
//       # one line per family member: `<rel-file>\t<kind>` (the Contract `measure known_family_members`
//       # counts `--list | wc -l`)
//   node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --kind <file>
//       # print the kind for one repo-relative file (empty + exit 0 when not in family)
//   node --no-warnings --experimental-strip-types plugin/scripts/known-load-sensitive.ts --check
//       # AC2 invariant: every canonical-glob test file whose HEADER carries a line-start
//       # `// KNOWN-LOAD-SENSITIVE` claim must ALSO carry `// @load-sensitive <kind>`; exit 1 on a
//       # violation (a new unannotated claim is mechanically rejected)
//
// Exit: 0 ok; 1 a `--check` invariant violation; 2 usage/env error.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

/** The grep literal the doc's batch-run protocol uses (kept as the marker identity). */
export const MARKER = "KNOWN-LOAD-SENSITIVE";

/** The known root-cause kinds. One root cause = one kind; different root causes = different kinds. */
export const KINDS = ["wall-clock", "nested-spawn", "heavy"] as const;
export type LoadSensitiveKind = (typeof KINDS)[number];

/** The canonical test glob scripts/test.sh owns (single source — do not hand-write a second copy). */
export const TEST_GLOB_PARTS = ["packages/*/test/*.test.mjs", "plugin/test/*.test.mjs"];

// ── Repo-root detection (mirrors select-tests-for-touches.ts) ───────────────────────────────────────

export function findRepoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

// ── Annotation parsing (reuses the select-static-checks-for-touches `@static-tier` pattern) ──────────

/**
 * Extract the `@load-sensitive <kind>` annotation from a file's text. Returns the kind, or null
 * when the file does not declare one. The annotation is a line comment `// @load-sensitive <kind>`
 * (regexed, same shape as `@test-group` / `@static-tier`); a comment/string merely mentioning
 * `KNOWN-LOAD-SENSITIVE` does NOT count — only an explicit `@load-sensitive` declaration does.
 * @param {string} text — full file text
 * @returns {string | null}
 */
export function parseLoadSensitiveAnnotation(text) {
  const m = /^\s*\/\/\s*@load-sensitive\s+([A-Za-z0-9_-]+)\s*$/m.exec(text);
  if (!m) return null;
  return m[1];
}

/** Whether a file's raw text carries an explicit `@load-sensitive` declaration. */
export function hasLoadSensitiveAnnotation(text) {
  return parseLoadSensitiveAnnotation(text) !== null;
}

/**
 * Whether a file's HEADER comment block carries a line-start KNOWN-LOAD-SENSITIVE *claim* — a
 * comment line in the canonical family-declaration shape: `// KNOWN-LOAD-SENSITIVE (see ...)`
 * (e.g. `// KNOWN-LOAD-SENSITIVE (see plugin/loop/fast-mode-loop-tick.md "已知负载敏感族")`).
 * Only the HEADER block (comment lines before the first `import`/code line) is scanned; and only
 * the DECLARATION shape counts — a mid-sentence prose mention ("... carries a KNOWN-LOAD-SENSITIVE
 * marker ...") or a fixture string inside a template literal does NOT count (that is why
 * `load-sensitive-release-check.test.mjs`'s MARKED_SRC fixture — a string literal after the
 * imports — is not treated as a family claim, and a doc comment DESCRIBING the marker is not a
 * family declaration).
 * @param {string} text — full file text
 */
export function hasHeaderClaim(text) {
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("//")) {
      if (/^\/\/\s*KNOWN-LOAD-SENSITIVE\s+\(see\b/.test(line)) return true;
      continue;
    }
    // First non-comment line = end of the header block; a claim must live in the header.
    return false;
  }
  return false;
}

/** True iff `kind` is one of the known kinds. */
export function isKnownKind(kind) {
  return KINDS.includes(kind);
}

// ── Family scanning (canonical glob → manifest) ─────────────────────────────────────────────────────

export interface FamilyMember {
  /** Repo-relative test file path, e.g. `plugin/test/session-liveness-events.test.mjs`. */
  rel: string;
  /** The declared kind (wall-clock | nested-spawn | heavy | ...). */
  kind: string;
}

/** List the canonical-glob test files under a repo root (repo-relative paths, sorted). */
export function listTestFiles(root) {
  const out = [];
  const pluginTest = path.join(root, "plugin", "test");
  if (fs.existsSync(pluginTest)) {
    for (const f of fs.readdirSync(pluginTest)) {
      if (f.endsWith(".test.mjs")) out.push(path.posix.join("plugin", "test", f));
    }
  }
  const packages = path.join(root, "packages");
  if (fs.existsSync(packages)) {
    for (const pkg of fs.readdirSync(packages)) {
      const pkgTest = path.join(packages, pkg, "test");
      if (!fs.existsSync(pkgTest)) continue;
      for (const f of fs.readdirSync(pkgTest)) {
        if (f.endsWith(".test.mjs")) out.push(path.posix.join("packages", pkg, "test", f));
      }
    }
  }
  return out.sort();
}

/**
 * Scan the family manifest: every canonical-glob test file carrying an explicit
 * `// @load-sensitive <kind>` annotation. This is the SINGLE machine-readable source of the family
 * (fast-mode-loop-tick.md's prose 族段 references it; no second hand-maintained list).
 * @param {string} root — repo root
 * @returns {FamilyMember[]}
 */
export function scanFamily(root) {
  const members = [];
  for (const rel of listTestFiles(root)) {
    const p = path.join(root, rel);
    let text;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const kind = parseLoadSensitiveAnnotation(text);
    if (kind !== null) members.push({ rel, kind });
  }
  return members;
}

/** Look up a repo-relative file in the family manifest → its kind, or undefined when not a member. */
export function kindForFile(family, rel) {
  const normalized = String(rel).replace(/\\/g, "/");
  const m = family.find((x) => x.rel === normalized);
  return m ? m.kind : undefined;
}

/** Whether a repo-relative file is a family member. */
export function isFamilyMember(family, rel) {
  return kindForFile(family, rel) !== undefined;
}

// ── AC2 invariant check ──────────────────────────────────────────────────────────────────────────────

export interface UnannotatedViolation {
  rel: string;
  /** The file carries a header KNOWN-LOAD-SENSITIVE claim but no `@load-sensitive <kind>`. */
  reason: string;
}

/**
 * AC2 — every canonical-glob test file whose HEADER carries a line-start KNOWN-LOAD-SENSITIVE claim
 * must ALSO carry `// @load-sensitive <kind>`. An unannotated claim is a regression (the marker was
 * the whole defect: doc-only, untyped, conflating root causes). Returns the violation list (empty =
 * invariant holds).
 * @param {string} root
 * @returns {UnannotatedViolation[]}
 */
export function checkNoUnannotatedClaims(root) {
  const violations = [];
  for (const rel of listTestFiles(root)) {
    const p = path.join(root, rel);
    let text;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (hasHeaderClaim(text) && !hasLoadSensitiveAnnotation(text)) {
      violations.push({
        rel,
        reason: "header carries a KNOWN-LOAD-SENSITIVE claim but no // @load-sensitive <kind> annotation",
      });
    }
  }
  return violations;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

const usage = `known-load-sensitive.ts — machine-readable KNOWN-LOAD-SENSITIVE family manifest
(tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage AC1/AC2)

Usage:
  node --experimental-strip-types known-load-sensitive.ts --list [--root <dir>]
      # one line per family member: <rel-file>\\t<kind>  (Contract measure known_family_members)
  node --experimental-strip-types known-load-sensitive.ts --kind <rel-file> [--root <dir>]
      # the kind for one file (empty when not in family)
  node --experimental-strip-types known-load-sensitive.ts --check [--root <dir>]
      # AC2 invariant: no unannotated KNOWN-LOAD-SENSITIVE header claims; exit 1 on violation

Exit: 0 ok; 1 a --check invariant violation; 2 usage/env error.`;

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

export function main(argv) {
  const args = argv.slice(2);
  const listMode = args.includes("--list");
  const kindArg = getArgValue(args, "--kind");
  const checkMode = args.includes("--check");
  const root = path.resolve(getArgValue(args, "--root") ?? findRepoRoot());

  if (listMode) {
    for (const m of scanFamily(root)) {
      process.stdout.write(`${m.rel}\t${m.kind}\n`);
    }
    return 0;
  }

  if (kindArg !== undefined) {
    const family = scanFamily(root);
    const kind = kindForFile(family, kindArg);
    if (kind !== undefined) process.stdout.write(`${kind}\n`);
    return 0;
  }

  if (checkMode) {
    const violations = checkNoUnannotatedClaims(root);
    if (violations.length > 0) {
      for (const v of violations) {
        process.stderr.write(`known-load-sensitive --check: ${v.rel}: ${v.reason}\n`);
      }
      process.stderr.write(
        `known-load-sensitive --check: ${violations.length} unannotated KNOWN-LOAD-SENSITIVE claim(s) — add // @load-sensitive <kind> to each\n`
      );
      return 1;
    }
    process.stdout.write("known-load-sensitive --check: ok — every KNOWN-LOAD-SENSITIVE header claim carries @load-sensitive <kind>\n");
    return 0;
  }

  process.stderr.write(`${usage}\n`);
  return 2;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
