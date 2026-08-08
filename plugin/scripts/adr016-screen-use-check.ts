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
// Detection is by CODE POSITION, not keyword. We scan SHELL SCRIPTS (.sh/.bash) only — the ADR's
// own prose (.md) is never scanned, so the words "md5(capture-pane)" written in the Amendment can
// never self-match (this repo has recorded 6 keyword-checker false positives of exactly that
// shape). Within a shell script a file is flagged only when a `tmux capture-pane` result actually
// FLOWS into a hash tool (md5sum / sha1sum / cksum):
//   - same command: `tmux capture-pane -p -t x | md5sum` on one line;
//   - variable taint: `raw=$(tmux capture-pane …)` → `masked=$(… "$raw" …)` → `… | md5sum`
//     (the session-liveness.sh shape — capture, mask, hash across separate commands).
//
// Band (task ## Contract, measure adr016_violations = 0..1): the repo currently has exactly ONE
// ACTIVE whole-screen-hash observer — session-liveness.sh, carried by the sibling task
// gap-pane-state-is-hashed-not-classified-so-needs-input-is-unobservable. send-keys-verified.sh is
// excluded as RETIRED (its task was superseded under outer ruling F 2026-08-04; the file awaits
// retirement). The gate exits 0 when active violations ≤ 1 and 1 when a NEW active violation
// appears. Retired files are still REPORTED (so the audit trail is visible) but not counted.
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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** Known RETIRED whole-screen-hash implementations. send-keys-verified.sh's task was superseded
 * under outer ruling F (2026-08-04) and its hash mechanism is deprecated; the file awaits
 * retirement. Reported but NOT counted against the band — it is not a "new" violation. The
 * packages/quay/plugin/ copy is the gitignored pack-time snapshot of plugin/ (package.sh
 * materializes it so the tarball carries the plugin bundle) — the same retired file, so it
 * inherits the same retirement rather than double-counting against the band. */
export const RETIRED_FILES = new Set([
  "plugin/scripts/send-keys-verified.sh",
  "packages/quay/plugin/scripts/send-keys-verified.sh",
]);

/** Shell script extensions scanned (the pattern lives in shell commands, not .md prose). */
const SHELL_EXT = new Set([".sh", ".bash"]);

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

/** Strip shell line comments (`#` to end of line) that are outside single/double quotes. A comment
 * mentioning `capture-pane | md5sum` must never satisfy the detector (same comment-vs-code
 * principle as test-framework-policy-check's non-code mask). Heredoc bodies are not fully modeled —
 * the scan excludes checker-mutation-cases (the only place heredocs embed the anti-pattern), so
 * the residual risk is accepted and documented. */
export function stripShellComments(src: string): string {
  const out: string[] = [];
  for (const rawLine of src.split("\n")) {
    let inS = false;
    let inD = false;
    let outLine = "";
    for (let i = 0; i < rawLine.length; i++) {
      const c = rawLine[i];
      if (inS) {
        outLine += c;
        if (c === "'") inS = false;
        continue;
      }
      if (inD) {
        outLine += c;
        if (c === "\\") { outLine += rawLine[i + 1] ?? ""; i++; continue; }
        if (c === '"') inD = false;
        continue;
      }
      if (c === "'") { inS = true; outLine += c; continue; }
      if (c === '"') { inD = true; outLine += c; continue; }
      if (c === "#" && (i === 0 || /\s/.test(rawLine[i - 1]))) break; // line comment
      outLine += c;
    }
    out.push(outLine);
  }
  return out.join("\n");
}

/** Collect the repo-relative .sh/.bash files under `root`, skipping SKIP_DIRS and non-script files. */
export function collectShellScripts(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e)) continue;
      const full = path.join(dir, e);
      let st: fs.Stats;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (SHELL_EXT.has(path.extname(e))) {
        out.push(path.relative(root, full).split(path.sep).join("/"));
      }
    }
  }
  walk(root);
  return out.sort();
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

/** Scan a tree for whole-screen-hash violations. Pure + fs: the caller picks the root. */
export function scanForScreenHashViolations(root: string): ScanResult {
  const files = collectShellScripts(root);
  const violations: Violation[] = [];
  const retired: Violation[] = [];
  for (const rel of files) {
    const source = fs.readFileSync(path.join(root, rel), "utf8");
    const found = detectFileViolations(rel, source);
    for (const v of found) {
      if (RETIRED_FILES.has(v.rel)) retired.push(v);
      else violations.push(v);
    }
  }
  return { violations, retired, files };
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
  if (args.includes("--selftest")) {
    process.exit(selftest() ? 0 : 1);
  }
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());

  if (!fs.existsSync(root)) {
    console.error(`ERROR: scan root not found: ${root}`);
    process.exit(2);
  }

  const { violations, retired, files } = scanForScreenHashViolations(root);
  const active = violations.length;
  const inBand = active <= 1;

  if (asJson) {
    console.log(JSON.stringify({ ok: inBand, violations: active, active: violations, retired, files_scanned: files.length }, null, 2));
  } else {
    console.log(`adr016-screen-use-check — ${files.length} shell script(s) scanned`);
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
  return inBand ? 0 : 1;
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  process.exit(main(process.argv));
}
