#!/usr/bin/env node
// adr016-screen-use-check.ts — ADR-016 Amendment 2026-08-04 mechanical enforcement
// (tasks/gap-adr-016-carve-out-permits-the-whole-screen-hash-it-was-meant-to-forbid, ruling A).
//
// ADR-016 clause 1 says `capture-pane` is only a coarse "idle / ready-for-input" check + a settle,
// but the carve-out had no boundary, so live implementations (session-liveness.sh,
// send-keys-verified.sh) each read it as whole-screen equality/md5 — the exact judgment the ADR's
// title forbids. The Amendment pins three boundaries, and THIS checker enforces the third one
// mechanically:
//   (a) allowed screen states are ENUMERATED (waiting-input / permission-prompt / busy /
//       error-banner / unknown) — an open set is not allowed;
//   (b) the permitted region is the BOTTOM region (input box + status line), not the whole screen;
//   (c) whole-screen equality/HASH of capture-pane output (the `md5(capture-pane)` family) is
//       FORBIDDEN, with or without prior masking.
//
// Detection is by CODE POSITION, not keyword. We scan SHELL SCRIPTS (.sh/.bash) EVERYWHERE plus
// the fenced ```bash INSTRUCTION blocks inside the shipped/live tick docs (MD_TICK_DOCS — the same
// doc set instrument-failure-check scans; gap-adr016-md5-ban-...-scope-gap AC3); the ADR's own
// prose (.md) is never scanned, so the words "md5(capture-pane)" written in the Amendment can never
// self-match (this repo has recorded 6 keyword-checker false positives of exactly that shape).
// `.ts` is also NOT scanned — decision record in the SHELL_EXT comment (AC2). Within a shell script
// a file is flagged only when a `tmux capture-pane` result actually FLOWS into a hash tool
// (md5sum / sha1sum / cksum):
//   - same command: `tmux capture-pane -p -t x | md5sum` on one line;
//   - variable taint: `raw=$(tmux capture-pane …)` → `masked=$(… "$raw" …)` → `… | md5sum`
//     (the session-liveness.sh shape — capture, mask, hash across separate commands).
//
// Band (task ## Contract, measure adr016_violations = 0..1): the repo currently has exactly ONE
// ACTIVE whole-screen-hash observer — session-liveness.sh, carried by the sibling task
// gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable. The former RETIRED
// observer, send-keys-verified.sh (superseded under outer ruling F 2026-08-04), was DELETED by
// gap-retired-script-still-callable (2026-08-10 human ruling — a superseded implementation must
// NOT exist in the executable layer), so RETIRED_FILES is empty. The gate exits 0 when active
// violations ≤ 1 and 1 when a NEW active violation appears.
//
// <!-- enforcement: plugin/scripts/adr016-screen-use-check.ts -->
//
// Usage:
//   node adr016-screen-use-check.ts [--root <dir>] [--json] [--selftest]
//
// Exit codes:
//   0 = PASS — active whole-screen-hash violations within the tolerated band (≤ 1)
//   1 = FAIL — a NEW active violation (count > 1)
//   2 = usage/environment error

// ── path→content 判定形状 (tasks/gap-b5-input-shape-path-to-content) ─────────────────────────────
// 判定逻辑 = 对【字符串/内容】的纯函数（detectFileViolations / detectTickDocViolations /
// stripShellComments / extractBashBlocks / judgeBand——输入是文件内容字符串，不是路径）,
// I/O（走树、读文件）留在薄 main() CLI 壳。纯函数测试零 spawn 零 mkdtemp 直调
// （plugin/test/adr016-screen-use-check.test.mjs）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit } from "./gate-script-base.ts";

import { verified, failed, driverResultToExit } from "./checker-io.ts";
import type { DriverResult } from "./checker-io.ts";
import { walkFiles } from "./fs-walk.ts";
// stripShellComments now lives in source-text-lib.ts (it was byte-identical to
// dead-code-after-return-check.ts's copy apart from brace layout — .quay/routine-findings.jsonl
// finding `firstargregion-stripshellcomments`). Re-exported so this module's public surface is
// unchanged (plugin/test/adr016-screen-use-check.test.mjs imports it from here).
import { stripShellComments } from "./source-text-lib.ts";
export { stripShellComments };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Hash tools whose co-occurrence with a capture-pane result is the forbidden whole-screen hash
 * (Amendment boundary (c), the exact trio named in the task's AC3). */
const HASH_TOOL_RE = /(md5sum|sha1sum|cksum)/;

/** The `capture-pane` tmux subcommand that reads a pane's full text. */
const CAPTURE_PANE_RE = /capture-pane/;

/** Subdirectories never scanned. check-mutation cases deliberately embed the anti-pattern (their
 * heredocs write `capture-pane | md5sum`) to prove the checker catches it — scanning them would
 * self-match. milestones/ holds classic-loop worktree archives, not live code. dist/ and dist-sea/
 * are gitignored build outputs (esbuild bundle / SEA sidecar snapshot) whose .sh files are
 * generated copies of plugin/, never live code — scanning them would double-count every pattern
 * the real plugin/ scripts carry (gap-release-sea-bundle-excludes-plugin-tree). */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-sea",
  "checker-mutation-cases",
  "milestones",
  "worktrees",
]);

/** Known RETIRED whole-screen-hash implementations: files whose capture-pane→md5 flow is a known
 * retired artifact, reported but NOT counted against the band (not a "new" violation). The sole
 * retired observer, send-keys-verified.sh (superseded under outer ruling F 2026-08-04), was
 * DELETED by gap-retired-script-still-callable (human ruling 2026-08-10 — a superseded
 * implementation must NOT exist in the executable layer). The set is kept as a maintenance hook:
 * any future retired observer must be listed here, and the superseded-capability check
 * (capability-catalog.sh --superseded-check) forbids a superseded implementation from existing
 * on disk. */
export const RETIRED_FILES = new Set<string>([]);

/** Shell script extensions scanned. `.ts` is deliberately NOT scanned (decision record, NOT a
 * silent omission — gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap AC2):
 * stripShellComments models only SHELL comments (`#`); a TS file's `//`-comments and string
 * literals would self-match the pattern in this very checker (its selftest embeds the flow),
 * and no EXECUTABLE .ts instance of the whole-screen-hash flow exists in the repo
 * (grep-verified 2026-08-08). If a .ts ever carries the flow, add a TS-aware comment/string
 * stripper first — code-position detection keeps the band honest. */
const SHELL_EXT = new Set([".sh", ".bash"]);

/** Shipped/live tick docs whose fenced ```bash blocks are INSTRUCTIONS, not prose — same weight
 * as a .sh file (gap-adr016-md5-ban-violated-in-shipped-md-and-checker-scope-gap AC3). The ADR's
 * own prose (adr/ADR-016*.md) and every other .md stay exempt: only this allowlist is scanned,
 * and within each doc only the fenced BASH blocks (never the surrounding prose), so the words
 * "md5(capture-pane)" written in a sentence can never self-match. Same doc set
 * instrument-failure-check.ts scans. */
const MD_TICK_DOCS = new Set([
  "plugin/loop/fast-mode-loop-tick.md",
  "plugin/loop/manager-loop-tick.md",
  "plugin/loop/orchestrator-loop-tick.md",
  "orchestration/manager-loop-tick.md",
  "orchestration/orchestrator-loop-tick.md",
]);

export interface Violation {
  rel: string;
  line: number;
  snippet: string;
  reason: string; // "same-command" | "taint-flow"
  taintSource?: string;
}

export interface ScanResult {
  violations: Violation[];
  retired: Violation[];
  files: string[];
}

/** Collect the repo-relative .sh/.bash files under `root`, skipping SKIP_DIRS and non-script files.
 *  Traversal (fs-walk.ts); the skip-set and the extension set stay this checker's own. */
export function collectShellScripts(root: string): string[] {
  return walkFiles(root, {
    entryKind: "stat",
    prune: (name) => SKIP_DIRS.has(name),
    include: (name, ext) => SHELL_EXT.has(ext),
  });
}

/** True iff `text` references shell variable `name` as `$name` or `${name}`. */
function referencesVar(text: string, name: string): boolean {
  const plain = new RegExp(`\\$${name}\\b`);
  const braced = new RegExp(`\\$\\{${name}\\}`);
  return plain.test(text) || braced.test(text);
}

/** Detect whole-screen-hash violations in ONE shell script's source. Code-position based: a
 * `capture-pane` result must actually flow into a hash tool — same command (line) or via variable
 * taint (`raw=$(tmux capture-pane …)` → `masked=$(… $raw …)` → `… | md5sum`). */
export function detectFileViolations(rel: string, source: string): Violation[] {
  const code = stripShellComments(source);
  const lines = code.split("\n");
  const out: Violation[] = [];
  const tainted = new Set<string>();

  // Fixed-point taint propagation: capture assignments seed the set; a line that references a
  // tainted var and assigns a new var propagates. (Assignments flow forward, so 3 passes covers
  // any short chain; a full loop is cheap insurance.)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      // seed: var=$(tmux … capture-pane …)
      for (const m of line.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\$\(/g)) {
        if (CAPTURE_PANE_RE.test(line.slice(line.indexOf("$(")))) tainted.add(m[1]);
      }
      // propagate: any var assigned on a line that references a tainted var
      if ([...tainted].some((v) => referencesVar(line, v))) {
        for (const m of line.matchAll(/(?:^|[\s;]|local\s+|declare\s+)([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
          tainted.add(m[1]);
        }
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (!line.trim()) continue;
    const hasHash = HASH_TOOL_RE.test(line);
    if (!hasHash) continue;

    const snippet = line.trim().slice(0, 90);

    // Rule 1 — same command: capture-pane and a hash tool on the same line (the AC5 negative
    // control shape: `tmux capture-pane -p -t x | md5sum`).
    if (CAPTURE_PANE_RE.test(line)) {
      out.push({ rel, line: lineNo, snippet, reason: "same-command" });
      continue;
    }

    // Rule 2 — taint flow: a hash tool applied to a variable that traces back to capture-pane.
    const taintSource = [...tainted].find((v) => referencesVar(line, v));
    if (taintSource) {
      out.push({ rel, line: lineNo, snippet, reason: "taint-flow", taintSource });
    }
  }
  return out;
}

/** Extract language-tagged fenced code blocks (` ```bash ` / ` ```sh ` / ` ```shell `) from a
 * markdown doc. A fenced bash block in a tick doc is an INSTRUCTION (same weight as a .sh file),
 * unlike the surrounding prose — so the whole-screen-hash ban applies inside it. Returns
 * { startLine (1-based), code } per block so violations can be offset back to the .md line. */
export function extractBashBlocks(source: string): Array<{ startLine: number; code: string }> {
  const blocks: Array<{ startLine: number; code: string }> = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*```(bash|sh|shell)\s*$/);
    if (!m) continue;
    const startLine = i + 1;
    const codeLines: string[] = [];
    i++;
    while (i < lines.length && !/^\s*```/.test(lines[i])) {
      codeLines.push(lines[i]);
      i++;
    }
    blocks.push({ startLine, code: codeLines.join("\n") });
    if (i < lines.length) i++; // skip the closing fence
  }
  return blocks;
}

/** Scan ONE tick doc's fenced bash blocks for whole-screen-hash violations. Reuses the shell
 * detector (block content IS shell) and offsets reported line numbers back to the .md file
 * (the first content line sits one line below the opening fence, so the offset is `+ startLine`). */
export function detectTickDocViolations(rel: string, source: string): Violation[] {
  const out: Violation[] = [];
  for (const { startLine, code } of extractBashBlocks(source)) {
    for (const v of detectFileViolations(rel, code)) {
      out.push({ ...v, line: v.line + startLine });
    }
  }
  return out;
}

/** Scan a tree for whole-screen-hash violations. Pure + fs: the caller picks the root. Shell
 * scripts everywhere (.sh/.bash); shipped/live tick docs' fenced BASH blocks (MD_TICK_DOCS). */
export function scanForScreenHashViolations(root: string): ScanResult {
  const files = collectShellScripts(root);
  const violations: Violation[] = [];
  const retired: Violation[] = [];
  const absorb = (rel: string, found: Violation[]) => {
    for (const v of found) {
      if (RETIRED_FILES.has(v.rel)) retired.push(v);
      else violations.push(v);
    }
  };
  for (const rel of files) {
    absorb(rel, detectFileViolations(rel, fs.readFileSync(path.join(root, rel), "utf8")));
  }
  for (const rel of MD_TICK_DOCS) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) {
      files.push(rel);
      absorb(rel, detectTickDocViolations(rel, fs.readFileSync(full, "utf8")));
    }
  }
  return { violations, retired, files };
}

/** Pure band judgment (path→content, gap-b5): the whole-screen-hash band is 0..1 ACTIVE violations
 * (one legacy observer tolerated); a count above 1 is a NEW active violation. PURE over the count —
 * the same threshold main() applies, exported so the test can assert it without spawning the CLI. */
export function judgeBand(activeCount: number): { inBand: boolean; verdict: "PASS" | "FAIL" } {
  const inBand = activeCount <= 1;
  return { inBand, verdict: inBand ? "PASS" : "FAIL" };
}

/**
 * B4 (gap-b4-checker-reuse-driver-result)：判定收敛到 DriverResult<T> 词表。
 *   活跃违例 ≤ 1（band 0..1）⇒ verified；> 1（新活跃违例）⇒ failed。
 * 判定依据是【文件内容】（detectFileViolations 按代码位置），⛔ 非调用方自述。
 */
export function judgeScreenHashScan(scan: ScanResult): DriverResult<ScanResult> {
  const { inBand } = judgeBand(scan.violations.length);
  if (!inBand) {
    return failed(`${scan.violations.length} active whole-screen-hash violations — band is 0..1`);
  }
  return verified(scan, "活跃 whole-screen-hash 违例在 band 内（0..1）");
}

/** Pure RED/GREEN selftest (ADR-018 selfcheck-fixture pattern). */
export function selftest(): boolean {
  let pass = 0;
  let fail = 0;
  const check = (name: string, cond: boolean, detail = "") => {
    if (cond) pass++;
    else {
      fail++;
      console.error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };

  // GREEN: a clean script with no hash is not a violation.
  check("green-clean-script", detectFileViolations("ok.sh", 'raw=$(cat file)\ncat "$raw"\n').length === 0);

  // RED (same-command): the AC5 negative-control shape is detected.
  let vs = detectFileViolations("evil.sh", "hash=$(tmux capture-pane -p -t x | md5sum | cut -c1-16)\n");
  check("red-same-command", vs.length === 1 && vs[0].reason === "same-command", JSON.stringify(vs));

  // RED (taint-flow): the session-liveness.sh shape (capture → mask → hash across commands).
  vs = detectFileViolations(
    "live.sh",
    'raw=$(tmux capture-pane -p -t "$t" 2>/dev/null)\nmasked=$(printf \'%s\\n\' "$raw" | mask_pane)\nh=$(printf \'%s\' "$masked" | md5sum | cut -c1-16)\n',
  );
  check("red-taint-flow", vs.length === 1 && vs[0].reason === "taint-flow", JSON.stringify(vs));

  // GREEN: a comment mentioning the pattern is NOT a violation (comment-vs-code).
  check("green-comment-mention", detectFileViolations("c.sh", '# never do: capture-pane | md5sum\nx=1\n').length === 0);

  // GREEN: md5 without any capture-pane (hashing a file) is not a violation.
  check("green-hash-no-pane", detectFileViolations("d.sh", 'md5sum data.txt\n').length === 0);

  // RED (tick-doc bash block): a fenced ```bash instruction block carrying the flow is a violation
  // even though the file is .md — shipped bash blocks are instructions, not prose (AC3).
  const mdEvil = [
    "# heading prose is never scanned",
    "```bash",
    "tmux capture-pane -p -t x | md5sum",
    "```",
    "tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle", // compliant — no hash
  ].join("\n");
  vs = detectTickDocViolations("plugin/loop/t.md", mdEvil);
  check("red-md-bash-block", vs.length === 1 && vs[0].reason === "same-command" && vs[0].line === 3, JSON.stringify(vs));

  // GREEN (tick-doc prose): the same flow written as prose (not in a fenced bash block) is NOT a
  // violation — prose is exempt so a correction note can never self-match.
  const mdProse = "judge idle: capture-pane result flows into md5sum — but prose never self-matches\n";
  check("green-md-prose", detectTickDocViolations("plugin/loop/t.md", mdProse).length === 0);

  // GREEN (tick-doc compliant block): the `tail -3 | grep 'esc to interrupt'` shape has no hash.
  const mdCompliant = ["```bash", "tmux capture-pane -p -t x | tail -3 | grep -q 'esc to interrupt' && echo busy || echo idle", "```"].join("\n");
  check("green-md-compliant-block", detectTickDocViolations("plugin/loop/t.md", mdCompliant).length === 0);

  console.log(`\nadr016-screen-use-check --selftest: ${pass} passed, ${fail} failed`);
  return fail === 0;
}

function usage(): never {
  console.error(
    "usage: node adr016-screen-use-check.ts [--root <dir>] [--json] [--selftest]\n" +
      "Exit: 0 = active whole-screen-hash violations within band (≤ 1); 1 = new active violation; 2 = usage error.",
  );
  process.exit(2);
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node adr016-screen-use-check.ts [--root <dir>] [--json] [--selftest]");
  if (args.includes("--selftest")) {
    return selftest() ? 0 : 1;
  }
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());

  if (!fs.existsSync(root)) {
    console.error(`ERROR: scan root not found: ${root}`);
    return 2;
  }

  const scan = scanForScreenHashViolations(root);
  const { violations, retired, files } = scan;
  const active = violations.length;
  const result = judgeScreenHashScan(scan);
  const inBand = result.state === "verified";

  if (asJson) {
    console.log(JSON.stringify({ ok: inBand, violations: active, active: violations, retired, files_scanned: files.length }, null, 2));
  } else {
    console.log(`adr016-screen-use-check — ${files.length} file(s) scanned (shell scripts + tick-doc bash blocks)`);
    if (active === 0) console.log("violations: 0");
    else {
      console.log(`violations: ${active}`);
      for (const v of violations) {
        console.log(`  ${v.rel}:${v.line}  ${v.snippet}  [${v.reason}${v.taintSource ? ` ← $${v.taintSource}` : ""}]`);
      }
    }
    if (retired.length) {
      console.log(`retired (reported, not counted): ${retired.length}`);
      for (const v of retired) {
        console.log(`  ${v.rel}:${v.line}  ${v.snippet}  [${v.reason}]`);
      }
    }
    if (inBand) {
      console.log(`PASS: active whole-screen-hash violations (${active}) within band (0..1)`);
    } else {
      console.log(`FAIL: ${active} active whole-screen-hash violations — band is 0..1 (new active violation detected)`);
    }
  }
  return driverResultToExit(result);
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "adr016-screen-use-check";
if (isDirect) {
  process.exit(main(process.argv));
}
