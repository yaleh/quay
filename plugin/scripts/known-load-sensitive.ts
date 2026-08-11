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
//   child-spawn   — spawns real child processes whose spawn/kill is load-race-prone under full-suite
//                   concurrency (relation-sync.test.mjs spawns 2 real node child processes for the
//                   file-lock cross-reparent proof; round-209 silent passed=false at 1932ms —
//                   gap-relation-sync-load-flake-child-spawn-under-suite;
//                   threshold-scope-check.test.mjs spawns the checker ~9× via spawnSync per AC —
//                   round-215 silent passed=false at 7721ms —
//                   gap-threshold-scope-load-flake-fifth-family-member). Sibling family to
//                   create-mcp / proposal-convergence (which declare `heavy`).
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
// Serial-phase ruling (manager 2026-08-10, mechanism-side carrier; the doc-side anchor lives in the
// shipped orchestrator-tick-core.md): 收编到 serial 相（把一族测试移进 concurrency-1 的 serial 阶段）
// 只应在「证明并发确实造成了该 flake」之后执行——判定依据必须是实测并发失败归因到该族的证据，
// 不是「最近在 suite 里闪了一下」的印象。先归因，再收编；收编本身不替代归因。本文件的 KINDS 就是
// 归因分类器（一个 root cause = 一个 kind）——收编决策应落在 kind 已证实的族上。
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
export const KINDS = ["wall-clock", "nested-spawn", "heavy", "child-spawn"] as const;
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

// ── Exit-mechanism entry records (gap-load-sensitive-serial-phase-unbounded-growth-measure-first
// AC4, 人明确要求：串行相要有退出机制) ─────────────────────────────────────────────────────────────
// Every family member that is routed to the SERIAL group (concurrency-1 phase) must record WHY it
// entered (the flake root cause that justified the admission) and WHEN, via a companion annotation
// `// @load-sensitive-entry <YYYY-MM-DD> <reason>`. The review hook (--list-entry / --check-exit)
// makes the record mechanically checkable: --check-exit fails on a serial-group family member with
// no entry record (an un-reviewable admission), and --list-entry sorts by entry date so the
// longest-in-serial members surface for periodic root-cause review (每 N 轮或每周复核该测试的 flake
// 根因是否已修；已修的应尝试退回原并发相验证，不永久留在串行相).

export interface LoadSensitiveEntry {
  /** ISO date the family member was admitted to the serial/lowconc phase: YYYY-MM-DD. */
  date: string;
  /** Why it was admitted (the flake root cause / the round + signature that justified serial). */
  reason: string;
}

/**
 * Parse the `@load-sensitive-entry <YYYY-MM-DD> <reason>` companion annotation. Returns null when
 * absent or malformed. The annotation is a line comment `// @load-sensitive-entry <date> <reason>`
 * (one per file); a bare mention does NOT count.
 * @param {string} text — full file text
 * @returns {LoadSensitiveEntry | null}
 */
export function parseLoadSensitiveEntry(text) {
  // [ \t]+ separators (never \n) keep the reason on the SAME line as the annotation — a bare
  // `// @load-sensitive-entry 2026-08-09` with nothing after must NOT swallow the next code line.
  const m = /^\s*\/\/\s*@load-sensitive-entry[ \t]+(\d{4}-\d{2}-\d{2})[ \t]+(.+?)[ \t]*$/m.exec(text);
  if (!m) return null;
  const reason = m[2].trim();
  if (!reason) return null;
  return { date: m[1], reason };
}

/** Whether a file's raw text carries an explicit `@load-sensitive-entry` record. */
export function hasLoadSensitiveEntry(text) {
  return parseLoadSensitiveEntry(text) !== null;
}

/**
 * Whether a file's text declares `@test-group serial` (the concurrency-1 load-sensitive phase).
 * A file that is a family member AND is routed to the serial group must carry an entry record —
 * that is the mechanical exit-review invariant.
 * @param {string} text — full file text
 */
export function isSerialGroupFile(text) {
  return /^\s*\/\/\s*@test-group\s+serial\b/m.test(text);
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
  /** The serial/lowconc entry record (exit-mechanism AC4), when the file carries one. */
  entry?: LoadSensitiveEntry;
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
  // gap-known-load-sensitive-scan-glob-lags-suite-glob (2026-08-09): scripts/test.sh's canonical glob
  // ALSO includes experiments/*/test/*.test.mjs (AC2), but this scanner only covered plugin/test/ and
  // packages/*/test/ — so an experiments/ test carrying the KNOWN-LOAD-SENSITIVE + @load-sensitive
  // markers (e.g. proposal-convergence.test.mjs, round-164/186/193/204 rotate-red) was INVISIBLE to
  // the load-sensitive partition and never routed to the serial phase. Mirror the packages/ shape so
  // the scan glob stays aligned with the suite glob (single source: scripts/test.sh's own glob).
  const experiments = path.join(root, "experiments");
  if (fs.existsSync(experiments)) {
    for (const exp of fs.readdirSync(experiments)) {
      const expTest = path.join(experiments, exp, "test");
      if (!fs.existsSync(expTest)) continue;
      for (const f of fs.readdirSync(expTest)) {
        if (f.endsWith(".test.mjs")) out.push(path.posix.join("experiments", exp, "test", f));
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
    if (kind !== null) {
      const entry = parseLoadSensitiveEntry(text);
      members.push(entry ? { rel, kind, entry } : { rel, kind });
    }
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

// ── Exit-mechanism invariant (gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC4) ──

export interface SerialEntryViolation {
  rel: string;
  reason: string;
}

/**
 * AC4 (exit mechanism, 人明确要求) — every family member whose file ALSO declares `@test-group serial`
 * MUST carry a `// @load-sensitive-entry <YYYY-MM-DD> <reason>` record. A serial-group family member
 * without an entry record is an un-reviewable admission (nobody can later decide whether the root
 * cause is fixed and the test can leave the concurrency-1 serial phase). Returns the violation list
 * (empty = invariant holds). This is the mechanical review hook: --list-entry surfaces the records
 * sorted by entry date (oldest first = longest in serial, the review candidates), and --check-exit
 * fails closed on an un-recorded admission.
 * @param {string} root
 * @returns {SerialEntryViolation[]}
 */
export function checkSerialEntries(root) {
  const violations = [];
  for (const rel of listTestFiles(root)) {
    const p = path.join(root, rel);
    let text;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (isSerialGroupFile(text) && hasLoadSensitiveAnnotation(text) && !hasLoadSensitiveEntry(text)) {
      violations.push({
        rel,
        reason: "serial-group family member (KNOWN-LOAD-SENSITIVE) with no // @load-sensitive-entry <date> <reason> — 进入原因+进入时间 must be recorded so the root cause can be reviewed for a serial exit",
      });
    }
  }
  return violations;
}

/**
 * One `--list-entry` line for a family member, or null when it has no entry record.
 * `<rel>\t<date>\t<reason>` (the reason may contain spaces — it is the LAST field).
 */
export function entryLineFor(member) {
  if (!member.entry) return null;
  return `${member.rel}\t${member.entry.date}\t${member.entry.reason}`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────

const usage = `known-load-sensitive.ts — machine-readable KNOWN-LOAD-SENSITIVE family manifest
(tasks/gap-known-load-sensitive-rule-is-doc-only-no-mechanical-triage AC1/AC2;
 gap-load-sensitive-serial-phase-unbounded-growth-measure-first AC4 — serial exit mechanism)

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
      # AC4 invariant: every serial-group family member carries @load-sensitive-entry
      # (进入原因+进入时间); exit 1 on a violation

Exit: 0 ok; 1 a --check/--check-exit invariant violation; 2 usage/env error.`;

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
  const listEntryMode = args.includes("--list-entry");
  const checkExitMode = args.includes("--check-exit");
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

  if (listEntryMode) {
    // Exit-mechanism review hook: family members WITH an entry record, sorted by entry date
    // (oldest first = longest in serial → the periodic-review candidates, AC4).
    const lines = scanFamily(root)
      .map((m) => entryLineFor(m))
      .filter((l) => l !== null)
      .sort((a, b) => {
        const da = a.split("\t")[1];
        const db = b.split("\t")[1];
        return da < db ? -1 : da > db ? 1 : 0;
      });
    for (const l of lines) process.stdout.write(`${l}\n`);
    return 0;
  }

  if (checkExitMode) {
    const violations = checkSerialEntries(root);
    if (violations.length > 0) {
      for (const v of violations) {
        process.stderr.write(`known-load-sensitive --check-exit: ${v.rel}: ${v.reason}\n`);
      }
      process.stderr.write(
        `known-load-sensitive --check-exit: ${violations.length} serial-group family member(s) without an entry record — add // @load-sensitive-entry <YYYY-MM-DD> <reason> to each (AC4, serial exit mechanism)\n`
      );
      return 1;
    }
    process.stdout.write("known-load-sensitive --check-exit: ok — every serial-group family member records 进入原因+进入时间 (serial exit mechanism AC4)\n");
    return 0;
  }

  process.stderr.write(`${usage}\n`);
  return 2;
}

if (isDirectEntry(import.meta)) {
  process.exitCode = main(process.argv);
}
