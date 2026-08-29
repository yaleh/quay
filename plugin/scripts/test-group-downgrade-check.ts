#!/usr/bin/env node
// test-group-downgrade-check.ts — gap-test-group-downgrade-no-guard (AC1/AC2/AC3):
// block un-reasoned @test-group downgrades (product/engine → governance/serial/lowconc) that
// silently remove a test from the default run set.
//
// THREAT (the finding this task closes): scripts/test.sh's check_group_declarations only rejected
// UNRECOGNIZED group values (typo / dropped group). A LEGAL re-tag — `// @test-group engine` →
// `// @test-group governance` — silently moved the test out of the default {product,engine} set:
// governance self-skips in default runs, serial/lowconc route to their own lower-concurrency
// phases. No check reported that a test had been downgraded out of the default set. An actor under
// suite-time pressure could (and, per the finding, likely did) take exactly this path to shrink a
// red suite without any gate going red.
//
// DETECTION (baseline-bounded — 硬规则 5: historical debt is never re-scanned, only NEW downgrades
// after the enforcement baseline are judged, same discipline as fan-in-ff-protocol-check
// --baseline / direct-to-develop-bypass-check --baseline):
//   baseline = the commit where this guard landed on develop (develop HEAD at enforcement time).
//   A "downgrade" is a file whose @test-group moved FROM product|engine TO
//   governance|serial|lowconc. Two paths:
//
//   1) UNCOMMITTED (working tree vs git HEAD): the downgrade sits in the working tree, so no
//      commit message can carry the reason yet → always RED. The legitimate flow is: make the
//      change, COMMIT it with the reason marker, then re-run — at that point HEAD == working tree
//      and the committed path (2) judges the reason.
//   2) COMMITTED (git HEAD vs baseline): for each file whose HEAD group is a target but whose
//      baseline group was product|engine (or the file did not exist at baseline), find every
//      commit in <baseline>..HEAD that changed the file's @test-group to a target value (git log
//      -S, OR'd across the three target tokens). A commit whose PARENT declared product|engine is a
//      real downgrade and must carry the marker `@test-group-downgrade` in its message; otherwise
//      RED. A commit whose parent declared a target (a lateral target→target move) or whose parent
//      does not have the file at all (the file was CREATED with a target group) is NOT a downgrade
//      — it never left the default set.
//
// MARKER: the commit message must contain the literal token `@test-group-downgrade`
// (commit message 显式标注理由). e.g. `test: @test-group-downgrade move flaky npm-e2e to serial`.
//
// Exit: 0 = no un-reasoned downgrade; 1 = ≥1 violation; 2 = usage/environment error (including a
// missing baseline commit — 硬规则 3b: a broken baseline FAILS CLOSED, never conflated with green).
//
// Usage:
//   node test-group-downgrade-check.ts [--root <repo-root>] [--baseline <sha>] [--json] [--selftest]
//
// Wired: run_static_checks (AC3) via `run_checker` with @static-tier change + @static-object
// <test globs>, AND invoked from check_group_declarations() (AC1 — the declarations guard now
// includes the downgrade detector). Negative/positive controls: checker-mutation-cases/
// test-group-downgrade-check.sh (temp-git-repo fixture, real git output) + --selftest.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { helpExit, readFileSafe } from "./gate-script-base.ts";
import { canonicalTestFiles } from "./canonical-test-files.ts";
export { canonicalTestFiles };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The enforcement baseline: develop HEAD when this guard landed (the parent of the commit that
 * wired it). Only downgrades committed AFTER this commit are judged — historical group changes
 * (pre-guard) are documented debt and are not re-scanned. */
export const DEFAULT_BASELINE = "8ea050c7";

/** The groups a downgrade may move INTO — each silently leaves the default {product,engine} set. */
export const TARGET_GROUPS = ["governance", "serial", "lowconc"] as const;

/** The groups a downgrade moves OUT of — the default-run set. */
export const ORIGIN_GROUPS = ["product", "engine"] as const;

/** The commit-message marker that makes a downgrade legitimate (显式标注理由). */
export const MARKER = "@test-group-downgrade";

const GROUP_RE = /@test-group[ \t]+([A-Za-z]+)/;

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────

/** First declared `@test-group <name>` in a source string; default `engine` when absent (AC7 —
 * an undeclared file defaults to engine, the current work surface). */
export function groupOfSource(src: string): string {
  const m = src.match(GROUP_RE);
  return m ? m[1] : "engine";
}

function git(root: string, args: string[], allowFail = false): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  const status = r.status ?? 1;
  if (!allowFail && status !== 0) {
    throw new Error(`git ${args[0]} failed (exit ${status}): ${(r.stderr || r.stdout || "").trim().slice(0, 500)}`);
  }
  return { status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// ── git set helpers ──────────────────────────────────────────────────────────────────────────────────

/** The subset of `files` that exists at `rev`. */
function gitFilesAtRev(root: string, rev: string, files: string[]): Set<string> {
  if (files.length === 0) return new Set();
  const r = git(root, ["ls-tree", "-r", rev, "--name-only", "--", ...files], true);
  if (r.status !== 0) return new Set(); // rev invalid / no such paths — caller decides via revExists
  return new Set(r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
}

/** The subset of `files` whose content at `rev` declares a target group (git grep — ONE command). */
function gitTargetFiles(root: string, rev: string, files: string[]): Set<string> {
  if (files.length === 0) return new Set();
  const r = git(root, ["grep", "-l", "-E", "@test-group[[:space:]]+(governance|serial|lowconc)", rev, "--", ...files], true);
  if (r.status !== 0) return new Set(); // exit 1 = no matches → empty set
  const out = new Set<string>();
  for (const line of r.stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    // `git grep -l <rev>` prefixes each line with `<rev>:`.
    const idx = t.indexOf(":");
    out.add(idx === -1 ? t : t.slice(idx + 1));
  }
  return out;
}

/** The declared @test-group of `file` at `rev`, or `null` when the file is absent at `rev`. */
function groupAt(root: string, file: string, rev: string): string | null {
  const r = git(root, ["show", `${rev}:${file}`], true);
  if (r.status !== 0) return null;
  return groupOfSource(r.stdout);
}

/** Commits in <baseline>..HEAD that changed any target-group token's occurrence count in `file`.
 * git's multiple -S are ANDed (a commit changing ALL three tokens is impossible), so each token is
 * queried separately and the results merged/deduped. */
function gitLogTargetTokenCommits(root: string, baseline: string, file: string): { sha: string; subject: string }[] {
  const out: { sha: string; subject: string }[] = [];
  for (const token of TARGET_GROUPS) {
    const r = git(root, ["log", `${baseline}..HEAD`, "--format=%H%x09%s", "-S", `@test-group ${token}`, "--", file], true);
    if (r.status !== 0) continue;
    for (const line of r.stdout.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const tab = t.indexOf("\t");
      if (tab === -1) continue;
      out.push({ sha: t.slice(0, tab), subject: t.slice(tab + 1) });
    }
  }
  return out;
}

// ── the detection ─────────────────────────────────────────────────────────────────────────────────────

export interface DowngradeViolation {
  kind: "uncommitted" | "committed";
  file: string;
  fromGroup: string;
  toGroup: string;
  commit?: string;
  subject?: string;
}

export interface DowngradeResult {
  violations: DowngradeViolation[];
  files: number;
  baseline: string;
}

/** Detect un-reasoned @test-group downgrades in `root` against the `baseline` commit. Pure git +
 * fs — the mutation case and --selftest drive it over temp repos. */
export function detectDowngrades(root: string, baseline: string): DowngradeResult {
  const files = canonicalTestFiles(root);

  // Working-tree groups (what test.sh would run today).
  const wtGroups = new Map<string, string>();
  for (const rel of files) {
    wtGroups.set(rel, groupOfSource(readFileSafe(path.join(root, rel))));
  }
  const wtTarget = new Set(files.filter((f) => (TARGET_GROUPS as readonly string[]).includes(wtGroups.get(f)!)));

  const headFiles = gitFilesAtRev(root, "HEAD", files);
  const headTarget = gitTargetFiles(root, "HEAD", [...headFiles]);
  const baseTarget = gitTargetFiles(root, baseline, [...headFiles]);

  const violations: DowngradeViolation[] = [];

  // 1) Uncommitted downgrades: working-tree group is a target, HEAD group is product/engine, and the
  //    file exists at HEAD (a NEW file may declare any group — C3 in test-framework-policy-check).
  for (const f of wtTarget) {
    if (headTarget.has(f)) continue; // committed state is already target → judged by path 2
    if (!headFiles.has(f)) continue; // new file created with a target group → allowed
    const from = groupAt(root, f, "HEAD") ?? "engine";
    violations.push({ kind: "uncommitted", file: f, fromGroup: from, toGroup: wtGroups.get(f)! });
  }

  // 2) Committed downgrades: HEAD group is a target, baseline group was product/engine (or absent),
  //    and some commit after baseline moved it out of the default set without the marker.
  for (const f of headTarget) {
    if (baseTarget.has(f)) continue; // already a target at baseline → historical, no re-scan
    const to = groupAt(root, f, "HEAD") ?? "engine";
    const seen = new Set<string>();
    for (const { sha, subject } of gitLogTargetTokenCommits(root, baseline, f)) {
      if (seen.has(sha)) continue;
      seen.add(sha);
      const parentGroup = groupAt(root, f, `${sha}^`);
      if (parentGroup !== null && (ORIGIN_GROUPS as readonly string[]).includes(parentGroup)) {
        // parent declared product/engine → this commit is the default-set escape.
        if (!subject.includes(MARKER)) {
          violations.push({ kind: "committed", file: f, fromGroup: parentGroup, toGroup: to, commit: sha, subject });
        }
      }
    }
  }

  return { violations, files: files.length, baseline };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────

function usage(): never {
  console.error(
    "usage: node test-group-downgrade-check.ts [--root <repo-root>] [--baseline <sha>] [--json] [--selftest]\n" +
      "Exit: 0 = no un-reasoned @test-group downgrade; 1 = violation(s); 2 = usage/environment error."
  );
  process.exit(2);
}

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node test-group-downgrade-check.ts [--root <repo-root>] [--baseline <sha>] [--json] [--selftest]");
  if (args.includes("--selftest")) {
    return runSelftest() ? 0 : 1;
  }
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const root = path.resolve(positional[0] ?? process.cwd());
  const baseline = getArgValue(args, "--baseline") ?? DEFAULT_BASELINE;

  if (!fs.existsSync(path.join(root, "scripts", "test.sh"))) {
    console.error(`ERROR: ${path.join(root, "scripts", "test.sh")} not found — is <repo-root> correct?`);
    return 2;
  }

  // 硬规则 3b: a broken/missing baseline FAILS CLOSED — a downgrade check that cannot see the
  // baseline must never return the same value as "no downgrades".
  const verify = git(root, ["rev-parse", "--verify", `${baseline}^{commit}`], true);
  if (verify.status !== 0) {
    console.error(
      `NOT-EVALUATED: baseline commit ${baseline} is not present in this worktree — the @test-group downgrade guard cannot see its enforcement baseline. ` +
        `A downgrade after the baseline would be invisible (硬规则 3b: 无法评估 ≠ 合格). ` +
        `Run in a real checkout with ${baseline} in history, or pass --baseline <sha>.`
    );
    return 2;
  }

  const result = detectDowngrades(root, baseline);

  if (asJson) {
    console.log(JSON.stringify({ ok: result.violations.length === 0, baseline, files: result.files, violations: result.violations }, null, 2));
    return result.violations.length === 0 ? 0 : 1;
  }

  console.log(`test-group-downgrade-check — @test-group downgrade guard (baseline ${baseline}, ${result.files} glob file(s))`);
  if (result.violations.length === 0) {
    console.log("PASS: no test file was moved out of the default {product,engine} set without a commit-message reason.");
    return 0;
  }
  console.log(`FAIL: ${result.violations.length} un-reasoned @test-group downgrade(s):`);
  for (const v of result.violations) {
    if (v.kind === "committed") {
      console.log(`  - [committed] ${v.file}: ${v.fromGroup} → ${v.toGroup} (commit ${v.commit?.slice(0, 7)} "${v.subject}")`);
      console.log(`      a move out of {product,engine} must carry the reason marker "${MARKER}" in the commit message`);
    } else {
      console.log(`  - [uncommitted] ${v.file}: ${v.fromGroup} → ${v.toGroup} (working tree, not committed)`);
      console.log(`      commit the downgrade first with the reason marker "${MARKER}" in the commit message`);
    }
  }
  return 1;
}

// ── selftest (ADR-018: demonstrate BOTH the RED and GREEN state) ─────────────────────────────────────

export function runSelftest(): boolean {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  // Pure helpers.
  check("groupOfSource: engine", groupOfSource('// @test-group engine\n') === "engine");
  check("groupOfSource: governance", groupOfSource('// @test-group governance\n') === "governance");
  check("groupOfSource: default engine", groupOfSource('// no declaration\n') === "engine");
  check("groupOfSource: first only", groupOfSource('// @test-group serial\n// @test-group engine\n') === "serial");
  check("MARKER present", "@test-group-downgrade move flaky".includes(MARKER));
  check("MARKER absent", "move flaky to governance".includes(MARKER) === false);

  // Integration: temp git repos with real engine→governance downgrades. Each scenario gets a FRESH
  // repo (a prior RED case in the same history would legitimately stay red and mask a later GREEN).
  const makeFixture = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-group-downgrade-"));
    const run = (args: string[]) => git(dir, args, true);
    const testFile = "plugin/test/fixture.test.mjs";
    const src = (g: string) => `// @test-group ${g}\nimport { test } from "node:test";\ntest("x", () => {});\n`;
    fs.mkdirSync(path.join(dir, "plugin", "test"), { recursive: true });
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "test.sh"), 'glob=(plugin/test/*.test.mjs)\n');
    fs.writeFileSync(path.join(dir, "seed.txt"), "a\n");
    run(["init", "-q"]);
    run(["config", "user.email", "t@t"]);
    run(["config", "user.name", "t"]);
    run(["add", "seed.txt"]);
    run(["commit", "-qm", "c1"]);
    fs.writeFileSync(path.join(dir, testFile), src("engine"));
    run(["add", testFile]);
    run(["commit", "-qm", "add engine test"]);
    const baseline = run(["rev-parse", "HEAD"]).stdout.trim();
    return { dir, run, testFile, src, baseline };
  };
  const cleanup = (dir: string) => fs.rmSync(dir, { recursive: true, force: true });

  try {
    // GREEN baseline: no downgrade.
    {
      const fx = makeFixture();
      try {
        let res = detectDowngrades(fx.dir, fx.baseline);
        check("GREEN: no downgrade passes", res.violations.length === 0, JSON.stringify(res.violations));

        // RED: uncommitted engine→governance downgrade.
        fs.writeFileSync(path.join(fx.dir, fx.testFile), fx.src("governance"));
        res = detectDowngrades(fx.dir, fx.baseline);
        check("RED: uncommitted downgrade detected", res.violations.length === 1 && res.violations[0].kind === "uncommitted" && res.violations[0].toGroup === "governance", JSON.stringify(res.violations));

        // RED: committed downgrade WITHOUT marker.
        fx.run(["commit", "-aqm", "move to governance"]);
        res = detectDowngrades(fx.dir, fx.baseline);
        check("RED: committed downgrade without marker detected", res.violations.length === 1 && res.violations[0].kind === "committed" && !res.violations[0].subject!.includes(MARKER), JSON.stringify(res.violations));
      } finally {
        cleanup(fx.dir);
      }
    }

    // GREEN: committed downgrade WITH marker.
    {
      const fx = makeFixture();
      try {
        fs.writeFileSync(path.join(fx.dir, fx.testFile), fx.src("governance"));
        fx.run(["commit", "-aqm", `test: ${MARKER} move flaky to governance`]);
        const res = detectDowngrades(fx.dir, fx.baseline);
        check("GREEN: marked downgrade passes", res.violations.length === 0, JSON.stringify(res.violations));
      } finally {
        cleanup(fx.dir);
      }
    }

    // GREEN: NEW file created with a target group is not a downgrade.
    {
      const fx = makeFixture();
      try {
        fs.writeFileSync(path.join(fx.dir, "plugin/test/new-gov.test.mjs"), fx.src("governance"));
        fx.run(["add", "plugin/test/new-gov.test.mjs"]);
        fx.run(["commit", "-qm", "add new governance test"]);
        const res = detectDowngrades(fx.dir, fx.baseline);
        check("GREEN: new file with target group passes", res.violations.length === 0, JSON.stringify(res.violations));
      } finally {
        cleanup(fx.dir);
      }
    }
  } finally {
    // no-op — per-fixture cleanup already ran
  }

  console.log(`\ntest-group-downgrade-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  process.exit(main(process.argv));
}
