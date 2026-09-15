#!/usr/bin/env node
// task-file-bypass-check.ts — fail-closed ratchet on direct `tasks/*.md` file access outside the
// Provider ABI (tasks/gap-adr013-gate-blind-spots-and-task-bypass-ratchet).
//
// THE DEFECT THIS CLOSES: ADR-013's own conformance gate had two evergreen-pass defects whose shared
// shape is "a checker that cannot see the thing it checks reports a PASS" (CLAUDE.md 硬规则 3b).
// The sibling class this task also closes: ~96 places read/write `tasks/*.md` directly instead of
// through the Provider ABI (`task_write`/`task_get`/etc.); fixing each instance without a standing
// check for the CLASS lets the class regress silently — the exact failure ADR-013's gate demonstrates.
//
// WHAT IT DETECTS (by POSITION, never by keyword): a `tasks/` path literal used as the argument of a
// FILE-OPERATION — a `fs.*` call / bare `readFileSync`/`writeFileSync`/… (the path is the FIRST
// argument), or an `execFileSync`/`execFile`/`execSync`/`spawnSync`/`spawn` call whose argument array
// carries a `tasks/` path (the `git show <ref>:tasks/<id>.md` / `git log -- tasks/` family). Shell
// files are scanned line-wise for a `tasks/` PATH on a file-op command line (`git`/`grep`/`cat`/`sed`/
// `awk`/`find`/`test`/`-f`/`-d`). A `tasks/` string used as a SEARCH NEEDLE, a path-prefix
// classification (`t.startsWith("tasks/")`), a doc/comment mention, or an embedded-selftest write into
// a per-run tmp/fixture store is NOT the live-store bypass this ratchet guards — call-site detection
// runs at CODE positions only (buildNonCodeMask), and the path literal must sit inside the
// file-operation's argument region.
//
// SCAN SURFACE (the executable layer that must talk to the store through the ABI, never the store's
// own filesystem): `packages/quay/src/**` + `plugin/**` (excluding `plugin/test/`, `plugin/vendor/`,
// `node_modules`, `checker-mutation-cases`), files `*.ts`/`*.js`/`*.mjs`/`*.sh`. `packages/quay-native`
// is the reference provider — reading the store's files IS its job — so it is deliberately out of scope.
//
// THE RATCHET (one-way): every hit must belong to a file in the ALLOWLIST below (the baseline of
// today's known, currently-necessary bypass sites — the ones the sibling tasks
// gap-task-ops-consolidate-driver-frontmatter-writers / gap-quay-task-consolidated-subagent /
// gap-worker-prompt-ac-check-via-abi-not-hand-edit are chipping away at). A hit in a NON-allowlisted
// file is a NEW bypass → FAIL (exit 1). An allowlisted file whose hit count differs from its recorded
// `expected` count is REPORTED (a WARN, exit unchanged) so shrinking the allowlist is a deliberate,
// reviewed one-line edit, never a silent capability loss.
//
// MODES:
//   --gate [--root]   the wired static-tier gate (scripts/test.sh run_static_checks). Exit 1 iff any
//                     hit is in a NON-allowlisted file; exit 0 otherwise (allowlisted-count drift is a
//                     WARN, not a fail).
//   --scan [--root]   measure mode — print every hit + its disposition (allowed/new). Exit 0.
//   --json            machine-readable output.
//
// Exit: 0 PASS/measure · 1 gate FAIL (>=1 new bypass) · 2 usage/env error · 3 NOT-EVALUATED (no scan
// surface found — the thing this checks cannot be located, never conflated with "0 bypasses").

import fs from "node:fs";
import path from "node:path";
import { buildNonCodeMask } from "./checker-lib.ts";
import { helpExit, isDirectEntry, emitPass, emitFail, emitNotEvaluated } from "./gate-script-base.ts";

// ── ALLOWLIST (the ratchet baseline) ───────────────────────────────────────────────────────────────
// file (repo-relative) → { reason, expected }. One entry per line so shrinking it later (as the
// sibling ABI-consolidation tasks land) is a one-line diff — a deliberate, reviewed edit, not inline
// scattered logic. `expected` = the measured hit count at baseline; a drift is a WARN, never a fail.
export const ALLOWLIST: Record<string, { reason: string; expected: number }> = {
  "packages/quay/src/observation.ts": { reason: "documented quarantine for git-ref reads (git show/ls-tree/log + one fs.readFileSync on tasks/) — the ONLY serve-path task-facts reader, re-implemented with git because it is the serve path's own dependency boundary", expected: 6 },
  "packages/quay/src/fan-in/ff-merge.ts": { reason: "fan-in ff-merge porcelain reads ` M tasks/*.md` via git (clean-tree auto-converge) — seeded from the Plan allowlist (its task-path is inside a comment/porcelain string, so it currently measures 0 hits)", expected: 0 },
  "packages/quay/src/config-validate.ts": { reason: "workspace config validation reads config/gates/loop files, not task files — seeded from the Plan allowlist for the sibling config-writer consolidation", expected: 0 },
  "packages/quay/src/init.ts": { reason: "quay-init creates the tasks/ dir skeleton (mkdir of the empty store) — not a per-task-file read/write; seeded from the Plan allowlist", expected: 0 },
  "plugin/scripts/driver-filters.ts": { reason: "promotion-driver reads task status via fs.readFileSync + git ls-tree -- tasks/ (the develop-ref authority) — gap-task-ops-consolidate-driver-frontmatter-writers will route it through the ABI", expected: 2 },
  "plugin/scripts/worker-driver.ts": { reason: "worker-driver reads the task body via fs.readFileSync and mechanically git add/commits tasks/<id>.md (the AC-tick landing write) — gap-worker-prompt-ac-check-via-abi-not-hand-edit will route it through the ABI", expected: 4 }, // expected 3→4: measured 4 (lines 1530/1736/3059/3064, all pre-existing task-body reads); ⛔ none of the 4 is from the gate-event-coverage work — the stale count predates it.
  "plugin/scripts/gate-event-coverage-check.ts": { reason: "PRODUCTION coverage detector: it must read the task store's STATUS HISTORY (git log -p -- tasks/ and git show <ref>:tasks/<id>.md) to decide what a LANDING is — the store itself is its object, same as packages/quay-native. ⛔ never writes a task file; its --json/--gate output is the adjudication, and the ratchet's sibling-value is served (not bypassed) because the reading is git-history-based, not a live-store mutation", expected: 2 },
  "plugin/scripts/ready-pool-check.ts": { reason: "promotion gate reads todo tasks via git cat-file --batch ${ref}:tasks/<id>.md (the develop-ref authority; the path is built in a separate statement so it currently measures 0 hits) — gap-task-ops-consolidate-driver-frontmatter-writers will route it through the ABI", expected: 0 },
  "plugin/scripts/prod-data-audit.ts": { reason: "prod-data audit reads task landing epoch via git log -- tasks/ (read-only accounting, not a store write)", expected: 2 },
  "plugin/scripts/task-schema.ts": { reason: "canonical task-schema reader reads <ref>:tasks/<id>.md via git show (the schema's own git-ref read, mirror of observation.ts)", expected: 2 },
  "plugin/scripts/defect-shape-aggregate.ts": { reason: "defect-shape aggregation reads the tasks/ tree read-only via git log --name-only -- tasks/", expected: 1 },
  "plugin/scripts/discovery-path-classify.ts": { reason: "read-only accounting — the discovery-path classifier needs each task's FILING COMMIT TIME and only git has it (the ABI exposes updatedAt, not first-added): ONE git log --diff-filter=A --name-only -- tasks/ call builds the filing-time table for the trend read. ⛔ it never writes a task file and never writes the store; its task-body reads are directory-listing reads of the store root (the same shape as defect-shape-aggregate/prod-data-audit below)", expected: 1 },
  "plugin/scripts/prefriction-count.sh": { reason: "prefriction count lists new task files via git log --diff-filter=A -- tasks/*.md (read-only)", expected: 1 },
  "plugin/scripts/dead-loop-check.sh": { reason: "dead-loop liveness greps task status across tasks/*.md (read-only status scan)", expected: 2 },
  "plugin/scripts/claim-task.sh": { reason: "claim-task asserts the task file exists via [ -f tasks/<id>.md ] before dispatch", expected: 1 },
  "plugin/scripts/l1-delivery-surface-check.ts": { reason: "L1 delivery-surface check probes owning-task existence via fs.existsSync on tasks/<id>.md (read-only attribution, not a content read/write)", expected: 1 },
  "plugin/scripts/verify-delivery-surface.ts": { reason: "delivery-surface inventory probes task-file attribution via fs.existsSync on tasks/<id>.md (read-only attribution)", expected: 1 },
  "plugin/scripts/verify-deliver-coldstart.sh": { reason: "AC-249 (GOAL-016) enumerates the TARGET project's OWN commits by POSITION: `git log ... -- tasks/<id>.md` is the task-file anchor of the commit-union (the criterion's `commit_files`), and the goal's criterion forbids quay from owning that judgment — read-only git-ref accounting on a FOREIGN repo (same family as prod-data-audit / defect-shape-aggregate), never a read/write of this repo's live store", expected: 6 },
  "plugin/scripts/rework-predictors.ts": { reason: "rework-predictor analysis reads task FILING EPOCHS read-only via git log --diff-filter=A --name-only -- tasks/ (the observation-window control's input) — read-only git-ref accounting over the whole store, same family as prod-data-audit / defect-shape-aggregate / prefriction-count; it never writes a task file and never reads one for a dispatch/status decision", expected: 1 },
  "plugin/scripts/run-identity.ts": { reason: "embedded --selftest fixture (_createGitFixture) writes a FAKE store under a per-run tmp dir — not the live store, tripped by the coarse positional detector", expected: 1 },
  "plugin/scripts/workflow-journal.ts": { reason: "embedded --selftest fixture writes a FAKE store under fs.mkdtempSync — not the live store, tripped by the coarse positional detector", expected: 1 },
  "plugin/skills/routines/": { reason: "routines skill doc — seeded from the Plan allowlist (scan surface is code files; kept for fidelity)", expected: 0 },
  "plugin/workflows/fan-in-execute.js": { reason: "fan-in workflow mechanically flips/commits tasks/<id>.md (the AC78 landing write, task-path in generated prompt/heredoc text so it currently measures 0 hits) — gap-quay-task-consolidated-subagent will route it through the ABI", expected: 0 },
};

// ── detection ─────────────────────────────────────────────────────────────────────────────────────

/** Mask comment-only positions (line `//`, block `/* *​/`) — leaves STRING/template literals unmasked,
 *  so a `tasks/` literal inside a file-op's string argument stays visible. The call-site token itself
 *  is guarded separately by buildNonCodeMask (a `fs.readFileSync(` spelled inside a string literal is
 *  NOT a call). */
function buildCommentMask(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { mask[i] = mask[i + 1] = 1; i += 2; while (i < n && src[i] !== "\n") { mask[i] = 1; i++; } continue; }
    if (c === "/" && d === "*") { mask[i] = mask[i + 1] = 1; i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { mask[i] = 1; i++; } if (i < n) { mask[i] = mask[i + 1] = 1; i += 2; } continue; }
    i++;
  }
  return mask;
}

/** fs-method family (the path is the FIRST argument): `fs.<method>(`, or a bare/destructured
 *  `readFileSync`/`writeFileSync`/… . */
const FS_METHOD_RE = /\b(?:fs\.[A-Za-z_$][A-Za-z0-9_$]*|readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile|readdirSync|readdir|existsSync|statSync|lstatSync|rmSync|unlinkSync|renameSync|copyFileSync|mkdirSync|createReadStream|createWriteStream)\s*\(/g;

/** child_process family (the path is in the args array / command string — check the whole region). */
const EXEC_RE = /\b(?:execFileSync|execFile|execSync|spawnSync|spawn)\s*\(/g;

/** True when `region` (a slice of `src` starting at `baseIdx`) carries a task-path literal at a
 *  NON-comment position: either `tasks/` (slash form — `"tasks/…"`, `` `tasks/${id}.md` ``,
 *  `git … -- tasks/`) or a quoted `"tasks"` path segment combined with a `.md` reference
 *  (`path.join(root, "tasks", id + ".md")`). */
function regionHasTaskPath(src: string, baseIdx: number, region: string, mask: Uint8Array): boolean {
  const slashRe = /tasks\//g;
  let m: RegExpExecArray | null;
  while ((m = slashRe.exec(region)) !== null) {
    if (mask[baseIdx + m.index] === 0) return true;
  }
  if (/\.md/.test(region)) {
    const segRe = /["']tasks["']/g;
    while ((m = segRe.exec(region)) !== null) {
      if (mask[baseIdx + m.index] === 0) return true;
    }
  }
  return false;
}

/** Region [start,end) of the FIRST argument of a call whose `(` is at `openIdx` (region = the
 *  balanced-paren span). Skips masked (string/comment) positions when tracking nesting so a comma
 *  inside a string literal never reads as the argument separator. */
function firstArgRegion(src: string, openIdx: number, region: string, mask: Uint8Array): [number, number] {
  const endBound = openIdx + region.length;
  let depth = 0;
  for (let i = openIdx + 1; i < endBound; i++) {
    if (mask[i] !== 0) continue;
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) return [openIdx + 1, i]; depth--; }
    else if (c === "," && depth === 0) return [openIdx + 1, i];
  }
  return [openIdx + 1, endBound - 1];
}

/** Scan one TS/JS/MJS source for task-path file-operation hits. Returns {line, snippet} list. */
export function scanCode(src: string): Array<{ line: number; snippet: string }> {
  const codeMask = buildNonCodeMask(src);   // comments + strings + regex → non-code (call-site guard)
  const commentMask = buildCommentMask(src); // comments only → non-code (path-literal guard)
  const lines = src.split("\n");
  const hits: Array<{ line: number; snippet: string }> = [];
  const seen = new Set<number>();
  const push = (idx: number) => {
    const line = src.slice(0, idx).split("\n").length;
    if (seen.has(line)) return;
    seen.add(line);
    hits.push({ line, snippet: (lines[line - 1] ?? "").trim().slice(0, 140) });
  };
  const balanced = (openIdx: number): number => {
    let depth = 0;
    for (let j = openIdx; j < src.length; j++) {
      const c = src[j];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) return j; }
    }
    return -1;
  };
  // fs methods — judge the FIRST argument only (the path).
  {
    const re = new RegExp(FS_METHOD_RE.source, FS_METHOD_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (codeMask[m.index] !== 0) continue;
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = balanced(openIdx);
      if (closeIdx < 0) continue;
      const region = src.slice(openIdx, closeIdx + 1);
      const [as, ae] = firstArgRegion(src, openIdx, region, codeMask);
      if (regionHasTaskPath(src, as, src.slice(as, ae), commentMask)) push(m.index);
    }
  }
  // exec/spawn — judge the WHOLE balanced region (the args array carries the task path).
  {
    const re = new RegExp(EXEC_RE.source, EXEC_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (codeMask[m.index] !== 0) continue;
      const openIdx = m.index + m[0].length - 1;
      const closeIdx = balanced(openIdx);
      if (closeIdx < 0) continue;
      if (regionHasTaskPath(src, openIdx, src.slice(openIdx, closeIdx + 1), commentMask)) push(m.index);
    }
  }
  return hits;
}

/** Shell file-op command tokens on a line that also carries a `tasks/` PATH. `git`/`grep`/`cat`/… as
 *  commands, plus `-f`/`-d` test flags. Assignment-only / catalog-table lines (`[name]=`) are not
 *  commands; `needs_human=$(grep … tasks/*.md)` is — the `grep` token wins. */
const SHELL_OP_RE = /\b(?:git|grep|cat|sed|awk|find|test|rm|cp|mv|ls|head|tail|wc|read)\b|-f\s|-d\s/;
/** A `tasks/` PATH (followed by a path char), not a prose mention like "no tasks/ dir". */
const SHELL_TASK_PATH_RE = /tasks\/[A-Za-z0-9_*${\\.]/;

/** Scan one shell source for task-path file-operation hits (line-wise). */
export function scanShell(src: string): Array<{ line: number; snippet: string }> {
  const hits: Array<{ line: number; snippet: string }> = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("#")) continue;
    if (/^\[[^\]]+\]=/.test(t)) continue; // catalog QUESTION/MATCHING/… table rows
    if (!SHELL_TASK_PATH_RE.test(raw)) continue;
    if (!SHELL_OP_RE.test(raw)) continue;
    hits.push({ line: i + 1, snippet: t.slice(0, 140) });
  }
  return hits;
}

// ── surface ────────────────────────────────────────────────────────────────────────────────────────

const CODE_EXT = /\.(ts|js|mjs)$/;
const SH_EXT = /\.sh$/;

export function scanSurface(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, base: string) => {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "test" || e.name === "vendor" || e.name === "checker-mutation-cases") continue;
        walk(abs, rel);
      } else if (CODE_EXT.test(e.name) || SH_EXT.test(e.name)) {
        out.push(rel);
      }
    }
  };
  walk(path.join(root, "packages/quay/src"), "packages/quay/src");
  walk(path.join(root, "plugin"), "plugin");
  return out.sort();
}

// ── core ──────────────────────────────────────────────────────────────────────────────────────────

export interface Hit { file: string; line: number; snippet: string; disposition: "new" | "allowed"; }

export function scan(root: string): { surface: string[]; hits: Hit[]; newHits: Hit[]; allowlistedFiles: Map<string, number> } {
  const surface = scanSurface(root);
  const hits: Hit[] = [];
  for (const rel of surface) {
    const abs = path.join(root, rel);
    let src: string;
    try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }
    const fileHits = SH_EXT.test(rel) ? scanShell(src) : scanCode(src);
    for (const h of fileHits) {
      hits.push({ file: rel, line: h.line, snippet: h.snippet, disposition: rel in ALLOWLIST ? "allowed" : "new" });
    }
  }
  const newHits = hits.filter((h) => h.disposition === "new");
  const allowlistedFiles = new Map<string, number>();
  for (const h of hits) if (h.disposition === "allowed") allowlistedFiles.set(h.file, (allowlistedFiles.get(h.file) ?? 0) + 1);
  return { surface, hits, newHits, allowlistedFiles };
}

function countWarnings(allowlistedFiles: Map<string, number>): string[] {
  const warns: string[] = [];
  for (const [file, entry] of Object.entries(ALLOWLIST)) {
    const actual = allowlistedFiles.get(file) ?? 0;
    if (actual !== entry.expected) {
      warns.push(`allowlisted ${file}: expected ${entry.expected} hit(s), got ${actual} — review the allowlist (shrink it deliberately, never silently)`);
    }
  }
  return warns;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

const usage = `task-file-bypass-check.ts — fail-closed ratchet on direct tasks/*.md access outside the Provider ABI
(gap-adr013-gate-blind-spots-and-task-bypass-ratchet)

Usage:
  node --experimental-strip-types task-file-bypass-check.ts --gate [--root <dir>] [--json]
      gate mode — exit 1 iff any task-path file-operation hit is in a NON-allowlisted file (a new
      bypass). Allowlisted-count drift is a WARN (exit 0).
  node --experimental-strip-types task-file-bypass-check.ts --scan [--root <dir>] [--json]
      measure mode — print every hit with its disposition (new/allowed). Exit 0.

Exit codes: 0 PASS/measure · 1 gate FAIL (>=1 new bypass) · 2 usage/env error · 3 NOT-EVALUATED.`;

function resolveRoot(rootArg: string | undefined): string {
  return path.resolve(rootArg ?? process.cwd());
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const flagVal = (name: string) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
  const asJson = args.includes("--json");
  const root = resolveRoot(flagVal("--root"));
  const { surface, hits, newHits, allowlistedFiles } = scan(root);

  if (surface.length === 0) {
    return emitNotEvaluated("no scan surface found (packages/quay/src + plugin/ absent) — cannot judge task-file bypass", { surface: 0, newHits: 0 }, asJson ? { json: true } : undefined);
  }

  const warns = countWarnings(allowlistedFiles);

  if (args.includes("--scan")) {
    if (asJson) {
      console.log(JSON.stringify({ mode: "scan", surface: surface.length, hits, newHits, warnings: warns }, null, 2));
    } else {
      console.log(`task-file-bypass-check --scan — ${surface.length} file(s) scanned, ${hits.length} task-path file-op hit(s)`);
      for (const h of hits) console.log(`  [${h.disposition === "new" ? "NEW" : "allowed"}] ${h.file}:${h.line}  ${h.snippet}`);
      for (const w of warns) console.log(`  WARN: ${w}`);
      console.log(`new: ${newHits.length}  allowed: ${hits.length - newHits.length}`);
    }
    return 0;
  }

  if (args.includes("--gate")) {
    const detail = { surface: surface.length, hits, newHits, warnings: warns };
    if (!asJson) {
      for (const w of warns) console.error(`WARN: ${w}`);
      for (const h of newHits) console.error(`  NEW ${h.file}:${h.line}  ${h.snippet}`);
    }
    if (newHits.length === 0) {
      return emitPass(`no new task-file bypass — ${hits.length} hit(s), all within the allowlist`, detail, asJson ? { json: true } : undefined);
    }
    return emitFail(`${newHits.length} NEW task-file bypass site(s) outside the allowlist`, detail, asJson ? { json: true } : undefined);
  }

  console.error(usage);
  return 2;
}

if (isDirectEntry(import.meta, undefined, "task-file-bypass-check")) {
  process.exit(main(process.argv));
}
