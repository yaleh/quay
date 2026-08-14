// select-static-checks-for-touches.ts — the touch→static-check relevance mapping
// (tasks/gap-scoped-runs-pay-full-static-check-overhead, AC1/AC3). Scoped test runs
// (`scripts/test.sh --for-task <id>` / `--scoped`) used to pay the FULL `run_static_checks`
// fixed overhead (~16s, 13s of it checker-mutation-check) on every per-task invocation —
// for 13 of 22 sub-3s scoped runs that overhead was >5× the tests themselves.
//
// This module makes the "change-relevant static-check subset" MECHANICAL (AC3): it parses the
// checker registry out of scripts/test.sh's `run_static_checks()` body (the SAME single source
// checker-mutation-check.sh parses — never a hand-maintained list), reads each checker's tier
// annotation (`# @static-tier <always|change|full>`), its object glob(s) (`# @static-object`),
// and scoped-mode marker (`# @static-scoped-mode subset-touched`), then given a task's `## Touches`
// computes the scoped subset:
//
//   scoped subset = { tier=always checkers } ∪ { tier=change checkers whose object ∩ touches ≠ ∅ }
//                   − { tier=full checkers }
//
// Tier semantics (annotated in test.sh, parsed here):
//   always  — cheap, always-relevant task-store invariant; runs in scoped in a TASK-SCOPED form
//             (the `subset-touched` mode runs the checker against ONLY the touched task files,
//             e.g. the ## Contract consumer on the touched task — AC1's exemplar).
//   change  — relevant only when the checker's object intersects this change's touches
//             (test-framework-policy/isolation when a test file is touched; doc/shell ratchets
//             when their objects are touched).
//   full    — NEVER in scoped; deferred to the full-suite gate (checker-mutation-check ~13s,
//             split-or-commit whole-store, ac-carryover whole-store). AC2: the full set is
//             unchanged — deferred-not-dropped (see test.sh's run_static_checks()).
//
// Deferred-discovery contract (AC4-ii): a violation in an object this change does NOT touch is
// NOT caught by the scoped run and MUST be caught by the full-suite gate. This is the documented
// "scoped = fast feedback on the change; full = complete gate" trade-off (AC6, CLAUDE.md).
//
// Integration: `scripts/test.sh`'s scoped paths call this with `--task <id>` and execute the
// emitted commands. The full-suite path (`run_static_checks`) is byte-unchanged, so the gate is
// not weakened.
//
// Run:
//   node --experimental-strip-types select-static-checks-for-touches.ts --task <id> [--root <dir>]
//       [--touches <csv>] [--commands|--names|--list] [--json]

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractSection } from "./task-schema.ts";
import { parseTouchEntriesWithTags } from "./touches-parser.ts";
import { isDirectEntry } from "./gate-script-base.ts";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

/** Default tier for an unannotated checker: `full` — a checker with no annotation stays in the
 *  FULL set only, and scoped conservatively defers it (never silently drops it from the full gate). */
export const DEFAULT_TIER = "full";
const TIERS = new Set(["always", "change", "full"]);
/** The single source for the checker registry: scripts/test.sh's `run_static_checks()` body. */
export const TEST_SH_REL = "scripts/test.sh";

/**
 * The capability-catalog AC1c ENTRY-POINT gate (gap-eighty-two-shipped-checks-and-none-says-what-it-
 * answers): every shipped plugin/scripts check must declare what QUESTION it makes askable — a NEW
 * script that enters the artifact without a declaration line is `unclassified` and the catalog exits
 * non-zero. That gate is a whole-artifact scan, so it only ever ran at the full-suite verification
 * round; a task that CREATES a new plugin/scripts file shipped scoped-green and the catalog turned
 * red only at fan-in (the 14-script regression this task closes —
 * gap-capability-catalog-declarations-not-enforced-at-script-creation).
 *
 * This scoped-only VIRTUAL checker is the fix: when a task's `## Touches` declare a NEW
 * plugin/scripts file (`(new)` tag, or git-untracked at selection time), the capability-catalog AC1c
 * gate enters the change-relevant static set, so an undeclared new script turns the SCOPED gate red
 * at creation time. The command line mirrors run_static_checks' invocation shape
 * (`run_checker "<name>" …`, with `${repo_root}` resolved by buildCommand like every registry
 * command line), and `--json` is the catalog's machine-readable AC1c mode (exits 1 on
 * unclassified > 0, matching the source task's `## Contract` invoke).
 */
export const CAPABILITY_CATALOG_CHECKER = {
  name: "capability-catalog",
  tier: "change",
  objects: [],
  scopedMode: null,
  commandLine: 'run_checker "capability-catalog" bash "${repo_root}/plugin/scripts/capability-catalog.sh" --json',
};

/**
 * The DELIVERY-INVENTORY drift check (gap-inventory-drift-inner-exec-mode-report-missing-snapshot-
 * regen, AC2): the outline §6 DELIVERY-INVENTORY snapshot is a DERIVED copy of disk's
 * plugin-bundle directory counts, validated by verify-delivery-surface.ts --inventory. A NEW
 * plugin/scripts file (the `(new)` tag or git-untracked — the same signal CAPABILITY_CATALOG_CHECKER
 * uses) changes disk's scripts count, so the snapshot MUST be regenerated (--write-inventory).
 * Before this scoped-only VIRTUAL checker, a task that added a new script shipped scoped-green and
 * the drift surfaced only at the full-suite verification round (5 instances: halt-check/spec-goal/
 * accounting-emit/DIR-043/inner-exec-mode). Pulling --inventory into the scoped tier for new-script
 * tasks turns the scoped gate red at creation time when the snapshot was not regenerated.
 */
export const DELIVERY_INVENTORY_CHECKER = {
  name: "delivery-inventory",
  tier: "change",
  objects: [],
  scopedMode: null,
  commandLine: 'run_checker "delivery-inventory" node --no-warnings --experimental-strip-types "${repo_root}/plugin/scripts/verify-delivery-surface.ts" --inventory',
};

/**
 * The registration files a task whose Touches declare a NEW `plugin/scripts/*` file MUST ALSO
 * authorize in its Touches (gap-new-script-touches-missing-inventory-catalog-registration, AC3). A
 * new script landing in the plugin-bundle has TWO mechanical-necessity sync products that live
 * OUTSIDE the script file itself:
 *   1. `plugin/scripts/capability-catalog.sh`  — the AC1c QUESTION-table declaration line (a new
 *      script with no declaration is `unclassified` and the catalog exits non-zero);
 *   2. `docs/proposals/quay-product-outline.md` — the §6 DELIVERY-INVENTORY snapshot (a DERIVED copy
 *      of disk's bundle counts; a new script drifts disk-vs-snapshot until `--write-inventory`).
 * When these are NOT in the task's Touches, the dispatched agent is NOT authorized to touch them —
 * the 3-instance regression this task closes (2 agents overstepped and edited them anyway, 1 agent
 * correctly stopped). This check turns that "post-hoc authorization" into a dispatch-preflight
 * precondition: a new-script task whose Touches omit the registration files is flagged
 * `touches-missing-registration` and must be fixed (add the files to ## Touches) before it can be
 * worked — the agent either oversteps or stops today, both of which this task removes.
 */
export const NEW_SCRIPT_REGISTRATION_REQUIRED = [
  "plugin/scripts/capability-catalog.sh",
  "docs/proposals/quay-product-outline.md",
];

/**
 * Dispatch-preflight registration check (gap-new-script-touches-missing-inventory-catalog-
 * registration, AC2/AC3/AC4). Pure: given the task's declared `## Touches` paths and its NEW-file
 * subset (the `(new)`-tagged and/or git-untracked plugin/scripts paths — the SAME signal
 * CAPABILITY_CATALOG_CHECKER and DELIVERY_INVENTORY_CHECKER use), return ok:false with reason
 * `touches-missing-registration` when the task declares a NEW `plugin/scripts/*` file but its
 * Touches do NOT authorize the registration files. A task with NO new plugin/scripts file is always
 * ok:true (AC4 negative control — existing scripts are never re-gated, the artifact is not
 * rescanned whole). A task that declares a new script AND lists all required registration files is
 * ok:true (AC3 — the fix for the gap is "补 Touches", exactly what the flagged agent is told to do).
 */
/** True iff a repo-relative path is a SHIPPED top-level plugin/scripts script (as opposed to a
 *  checker-mutation-case FIXTURE). The capability-catalog's check-set is derived from the TOP-LEVEL
 *  `ls plugin/scripts/*.{sh,ts,mjs}` glob — files under plugin/scripts/checker-mutation-cases/ are
 *  test fixtures, NOT shipped checks, so they never need catalog/inventory registration. Without
 *  this carve-out, every mutation-case-only task (a task that adds mutation fixtures for ALREADY
 *  registered checkers) would fail the dispatch-preflight registration check — a false positive,
 *  because the catalog never scans the subdir and the full-suite gate never reddens. */
function isShippedPluginScript(t) {
  return matchesObject("plugin/scripts/", t) && !String(t).startsWith("plugin/scripts/checker-mutation-cases/");
}

export function checkTouchesRegistration(touches, newTouches) {
  const norm = (p) => normalizeRel(String(p));
  const newScripts = [...new Set((newTouches || []).map(norm).filter(Boolean))]
    .filter((t) => isShippedPluginScript(t));
  if (newScripts.length === 0) return { ok: true };
  const declared = new Set((touches || []).map(norm).filter(Boolean));
  const missing = NEW_SCRIPT_REGISTRATION_REQUIRED.filter((f) => !declared.has(f));
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    reason: "touches-missing-registration",
    newScript: newScripts[0],
    missing,
  };
}

// ── Repo-root detection (mirrors select-tests-for-touches.ts) ─────────────────────────────────────────

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

// ── Path helpers ──────────────────────────────────────────────────────────────────────────────────────

/** Normalize a repo-relative path/glob (forward slashes, collapse ./ and //, resolve ..). */
export function normalizeRel(p) {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out = [];
  for (const seg of parts) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

function escapeRegExp(s) {
  // Escaped char-by-char (no tricky character-class literal — the TS type-stripper mis-parses
  // `/[.*+?^${}()|[\]\\]/g` inside this file; this loop is equivalent).
  const SPECIAL = new Set([".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]);
  let out = "";
  for (const ch of String(s)) out += SPECIAL.has(ch) ? `\\${ch}` : ch;
  return out;
}

/**
 * True iff a repo-relative touch path falls inside a checker's object glob.
 * Object forms supported: dir prefix `tasks/`, concrete file `docs/x.md`, and star-globs
 * (e.g. the canonical test glob, or a `**`+`.sh` suffix). `**` collapses to `.*`.
 * NOTE: never write a literal `*` followed by `/` inside a block comment (it closes the comment).
 * @param {string} object
 * @param {string} touch
 */
export function matchesObject(object, touch) {
  const o = normalizeRel(object);
  const t = normalizeRel(touch);
  if (!o || !t) return false;
  if (o === "**") return true;
  if (o.startsWith("**/")) {
    // `**/<rest>` — suffix match (e.g. `**/*.sh` → any path ending `.sh`).
    const rest = o.slice(3);
    if (rest.includes("*")) {
      return new RegExp(`${rest.split("*").map(escapeRegExp).join(".*")}$`).test(t);
    }
    return t === rest || t.endsWith(`/${rest}`);
  }
  if (o.includes("*")) {
    const re = new RegExp(`^${o.split("*").map(escapeRegExp).join(".*")}.*$`);
    return re.test(t);
  }
  if (o.endsWith("/")) return t.startsWith(o);
  return t === o || t.startsWith(`${o}/`);
}

/**
 * True iff `relPath` is a NEW file at selection time: it exists on disk under `root` AND git does
 * not track it (the task created it but has not yet committed it — the AC4 "not-yet-tracked"
 * signal of gap-capability-catalog-declarations-not-enforced-at-script-creation). Requires a git
 * repo at `root` (`.git` present — a worktree's `.git` is a FILE pointing at the gitdir, which
 * existsSync also sees); a non-git workspace (hermetic temp fixture) returns false — there the
 * `(new)` Touches tag is the signal. A glob or a non-existent path is never "new" by this check
 * (there is nothing to scan).
 */
export function isGitUntracked(root, relPath) {
  const normalized = normalizeRel(relPath);
  if (!normalized || /[*?]/.test(normalized)) return false;
  if (!fs.existsSync(path.join(root, ".git"))) return false;
  if (!fs.existsSync(path.join(root, normalized))) return false;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", normalized], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5_000,
    });
    return false; // tracked — an existing script already in the artifact
  } catch {
    return true; // untracked — a file the task created that git does not know yet
  }
}

// ── Registry parsing (single source: scripts/test.sh's run_static_checks body) ───────────────────────

/**
 * Extract the body of `run_static_checks()` from scripts/test.sh source text.
 * Mirrors checker-mutation-check.sh's awk: from the `run_static_checks() {` line to the next `}`.
 * @param {string} src
 * @returns {string[]} lines of the function body
 */
export function extractRunStaticChecksBody(src) {
  const lines = src.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^run_static_checks\(\)\s*\{/.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\}/.test(lines[i])) return lines.slice(start + 1, i);
  }
  return lines.slice(start + 1);
}

const CHECKER_RE = /\$\{repo_root\}\/plugin\/scripts\/([A-Za-z0-9_.-]+)\.(sh|ts)/;

/**
 * Parse the static-check registry from a scripts/test.sh body.
 * For each checker invocation (`plugin/scripts/<name>.(sh|ts)`) capture the tier/object/scoped-mode
 * set by the `# @static-…` comment lines immediately preceding it. A checker with no tier defaults
 * to `full` (conservative: stays in the full set only).
 * @param {string} bodySrc — full scripts/test.sh source text
 * @returns {{name:string, tier:string, objects:string[], scopedMode:string|null, commandLine:string}[]}
 */
export function parseStaticCheckRegistry(bodySrc) {
  const body = extractRunStaticChecksBody(bodySrc);
  const registry = [];
  let tier = DEFAULT_TIER;
  let objects = [];
  let scopedMode = null;
  for (const raw of body) {
    const line = raw.trim();
    const tierM = line.match(/^#\s*@static-tier\s+(\S+)/);
    if (tierM) {
      tier = TIERS.has(tierM[1]) ? tierM[1] : DEFAULT_TIER;
      continue;
    }
    const objM = line.match(/^#\s*@static-object\s+(.+)$/);
    if (objM) {
      objects = objM[1].trim().split(/\s+/).filter(Boolean);
      continue;
    }
    const modeM = line.match(/^#\s*@static-scoped-mode\s+(\S+)/);
    if (modeM) {
      scopedMode = modeM[1];
      continue;
    }
    const m = line.match(CHECKER_RE);
    if (m) {
      registry.push({
        name: m[1],
        tier,
        objects: [...objects],
        scopedMode,
        commandLine: raw.trim(),
      });
      // Each annotation block applies to exactly one checker.
      tier = DEFAULT_TIER;
      objects = [];
      scopedMode = null;
    }
  }
  return registry;
}

// ── Scoped selection ─────────────────────────────────────────────────────────────────────────────────

/**
 * Compute the scoped static-check subset for a set of repo-relative touches.
 * Rule (AC1/AC3): always ∪ { change whose object ∩ touches ≠ ∅ } − full.
 * Also returns the touched task files (for the subset-touched mode) and the deferred (skipped) set.
 *
 * `opts.newTouches` (optional, backward-compatible) is the set of touches that are NEW files — the
 * `(new)`-tagged and/or git-untracked plugin/scripts paths a task declares it CREATES
 * (gap-capability-catalog-declarations-not-enforced-at-script-creation). When a new plugin/scripts
 * file is touched, the capability-catalog AC1c entry-point gate is added to the change-relevant set
 * (scoped-only VIRTUAL checker — not a run_static_checks registry entry), so an undeclared new
 * script turns the scoped gate red at creation time. Existing scripts are never rescanned (AC3/AC4
 * negative controls: only NEW files trigger, the artifact is not re-scanned whole).
 *
 * @param {string[]} touches
 * @param {{name:string, tier:string, objects:string[], scopedMode:string|null, commandLine:string}[]} registry
 * @param {{newTouches?: string[]}} [opts]
 * @returns {{selected:{name:string, commandLine:string, touchedTasks:string[]}[],
 *            deferred:string[]}}
 */
export function selectStaticChecksForTouches(touches, registry, opts = {}) {
  const touchedTasks = [...new Set(
    touches
      .map(normalizeRel)
      .filter((t) => t && t.startsWith("tasks/") && t.endsWith(".md")),
  )].sort();
  const selected = [];
  const deferred = [];
  for (const c of registry) {
    if (c.tier === "full") { deferred.push(c.name); continue; }
    if (c.tier === "always") {
      if (c.scopedMode === "subset-touched") {
        if (touchedTasks.length > 0) {
          selected.push({ name: c.name, commandLine: c.commandLine, touchedTasks });
        } else {
          // Nothing to check against — skip (nothing was touched under tasks/).
          deferred.push(c.name);
        }
      } else {
        selected.push({ name: c.name, commandLine: c.commandLine, touchedTasks: [] });
      }
      continue;
    }
    // tier === change
    const relevant = c.objects.some((o) => touches.some((t) => matchesObject(o, t)));
    if (relevant) selected.push({ name: c.name, commandLine: c.commandLine, touchedTasks: [] });
    else deferred.push(c.name);
  }
  // AC1 (gap-capability-catalog-declarations-not-enforced-at-script-creation): a NEW plugin/scripts
  // file in this change pulls the capability-catalog AC1c entry-point gate into the scoped tier.
  // AC2 (gap-inventory-drift-inner-exec-mode-report-missing-snapshot-regen): the SAME new-file
  // signal ALSO pulls the DELIVERY-INVENTORY drift check — a new script changes disk's scripts count,
  // and the outline §6 snapshot is a derived copy that must be regenerated (--write-inventory);
  // without this wiring the drift surfaced only at the full-suite round (5 prior instances).
  const newTouches = opts && opts.newTouches ? opts.newTouches : [];
  const newPluginScript = [...new Set(newTouches.map(normalizeRel))]
    .some((t) => isShippedPluginScript(t));
  if (newPluginScript) {
    selected.push(CAPABILITY_CATALOG_CHECKER);
    selected.push(DELIVERY_INVENTORY_CHECKER);
  }
  return { selected, deferred };
}

// ── Concrete command emission ────────────────────────────────────────────────────────────────────────

/** Shell-single-quote a string (for embedding in the emitted command lines). */
export function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the concrete shell command for one selected checker, with `${repo_root}` resolved to the
 * absolute root and the subset-touched mode expanded to `--strict-subset <touched task files>`.
 * The command line parsed from test.sh already wraps `${repo_root}` in double quotes, so the raw
 * root is substituted verbatim; only the appended touched-task file args need explicit quoting.
 * @param {{name:string, commandLine:string, touchedTasks:string[]}} sel
 * @param {string} root
 * @returns {string}
 */
export function buildCommand(sel, root) {
  let cmd = sel.commandLine.split("${repo_root}").join(root);
  if (sel.touchedTasks && sel.touchedTasks.length > 0) {
    const files = sel.touchedTasks.map((t) => shq(path.join(root, t)));
    cmd += ` --strict-subset ${files.join(" ")}`;
  }
  return cmd;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────

const usage = `select-static-checks-for-touches.ts — mechanical touch→static-check relevance mapping
(gap-scoped-runs-pay-full-static-check-overhead)

Usage:
  node --experimental-strip-types select-static-checks-for-touches.ts --task <id> [--root <dir>]
      [--touches <csv>] [--commands|--names|--list] [--json] [--check-registration]

Dispatch-preflight registration check (gap-new-script-touches-missing-inventory-catalog-registration):
  --check-registration — with --task <id>, validate that a task whose ## Touches declare a NEW
      plugin/scripts file ((new) tag, git-untracked, or the full-width （新：…） marker) ALSO authorizes
      the registration files (plugin/scripts/capability-catalog.sh + docs/proposals/quay-product-outline.md).
      Prints JSON { ok, reason, missing, newScript, ... }, exits 0 when ok, 1 when touches-missing-registration.
      The same check runs implicitly in every --task selection mode: a failing task makes the scoped
      static-check selection exit non-zero, so scripts/test.sh's scoped gate turns red (fail-closed)
      instead of dispatching an agent whose Touches do not authorize the sync products.

Selection rule (AC1/AC3, parsed mechanically from scripts/test.sh's run_static_checks body):
  scoped = { tier=always } ∪ { tier=change whose object ∩ touches } − { tier=full }
  tier annotations live in scripts/test.sh (never hand-listed here).
  PLUS: a NEW plugin/scripts file in the touches ((new) tag or git-untracked) adds the
  capability-catalog AC1c entry-point gate AND the DELIVERY-INVENTORY drift check
  (verify-delivery-surface.ts --inventory) to the scoped set
  (gap-capability-catalog-declarations-not-enforced-at-script-creation /
   gap-inventory-drift-inner-exec-mode-report-missing-snapshot-regen).

Output modes:
  --commands (default) — concrete shell commands for the selected checkers (one per line)
  --names              — checker names only (one per line)
  --list               — the full registry (tier / objects / scoped-mode per checker)
  --json               — machine-readable selection {selected, deferred, always, change}

Exit codes: 0 ok; 2 usage/task-not-found.`;

function getArgValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

/**
 * Strip a trailing parenthetical annotation from a touch, in BOTH spellings the repo uses:
 * ASCII `(… )` (stripped by the shared touches-parser) and full-width `（… ）` (the CJK convention
 * used in many task Touches bullet lists, e.g. `plugin/scripts/（触摸→…映射）`). The shared
 * touches-parser strips only ASCII; the scoped tier must never skip a change-relevant check just
 * because an annotation used the full-width form, so it strips both here (AC3 mechanical mapping —
 * this is path normalization, not a hand-maintained list).
 */
export function stripTrailingAnnotation(touch) {
  return String(touch)
    .replace(/\s*（[^）]*）\s*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

/**
 * Full-width new-file marker detection (gap-new-script-touches-missing-inventory-catalog-registration,
 * AC2): the repo's REAL new-script Touches annotations use the FULL-WIDTH form `（新）`/`（新：…）`
 * (e.g. `plugin/scripts/fan-in-runid-check.ts（新：runId 存在性检查器）` — the 2 overstep instances), while
 * the shared touches-parser's TAG recognition only reads the ASCII `(new)` spelling (its path
 * extraction DOES strip full-width annotations, so the path is still found — only the `new` tag is
 * missed). This normalization layer mirrors the existing full-width annotation stripping
 * (stripTrailingAnnotation — the scoped tier must never skip a change-relevant signal just because
 * an annotation used the full-width form). It flags the TAG (a `plugin/scripts/*` bullet whose
 * trailing full-width/half-width （…)/(…) annotation carries a leading 新 marker) and delegates the
 * PATH to the ONE shared parser (parseTouchEntriesWithTags) — no second path parser.
 * @returns {string[]} repo-relative plugin/scripts paths annotated full-width-new
 */
export function fullWidthNewScriptPaths(touchesSection) {
  const out = [];
  for (const raw of String(touchesSection ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.+)$/);
    if (!m) continue;
    const annM = m[1].match(/(?:（([^）]*)）|\(([^)]*)\))\s*$/);
    if (!annM) continue;
    const annotation = (annM[1] ?? annM[2] ?? "").trim();
    if (!/^新/.test(annotation)) continue; // 新 / 新：… / 新增 / 新脚本 — the full-width new marker
    // Reuse the ONE parser for the path (a single bullet parses fine), then require plugin/scripts/*:
    // a full-width-new file OUTSIDE the plugin bundle is not a registration trigger.
    const paths = parseTouchEntriesWithTags(line).map((e) => e.path).filter(Boolean);
    for (const p of paths) {
      if (isShippedPluginScript(p) && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

/**
 * Read a task body's `## Touches` bullet list (reuses the ONE shared touches parser — AC3), plus
 * the NEW-file subset: touches tagged `(new)` — OR the full-width `（新）`/`（新：…）` marker the repo's
 * real new-script Touches actually use (fullWidthNewScriptPaths, AC2) — are the authoritative
 * "this task CREATES this file" declarations (gap-capability-catalog-declarations-not-enforced-at-
 * script-creation + gap-new-script-touches-missing-inventory-catalog-registration). The tag-aware
 * parser's path extraction is BYTE-IDENTICAL to the plain one (touches-parser parity contract), so
 * change-relevance matching is unchanged — only the new-file tag is additionally surfaced.
 * @returns {{paths:string[], newPaths:string[]}|null}
 */
function touchesFromTask(root, taskId) {
  const taskFile = path.join(root, "tasks", `${taskId}.md`);
  if (!fs.existsSync(taskFile)) return null;
  const text = fs.readFileSync(taskFile, "utf8");
  const sec = extractSection(text, "Touches");
  const parsed = sec ? parseTouchEntriesWithTags(sec) : [];
  const paths = parsed.map((e) => e.path).filter(Boolean);
  const newPaths = parsed.filter((e) => e.tag === "new").map((e) => e.path).filter(Boolean);
  // Full-width new-marker augmentation (AC2): the shared parser only tags ASCII `(new)`; the repo's
  // real new-script Touches use `（新：…）`. Merge those plugin/scripts paths into the new-file subset
  // so the capability-catalog / delivery-inventory scoped checkers AND the dispatch-preflight
  // registration check fire for the ACTUAL annotation format, not just the ASCII test fixture form.
  for (const p of fullWidthNewScriptPaths(sec)) {
    if (!newPaths.includes(p)) newPaths.push(p);
  }
  return { paths, newPaths };
}

export function main(argv) {
  const args = argv.slice(2);
  const taskId = getArgValue(args, "--task");
  const rootArg = getArgValue(args, "--root");
  const touchesArg = getArgValue(args, "--touches");
  const asJson = args.includes("--json");
  const namesOnly = args.includes("--names");
  const listMode = args.includes("--list");
  const commandsMode = args.includes("--commands");
  const checkRegOnly = args.includes("--check-registration");

  const root = path.resolve(rootArg ?? findRepoRoot());
  // --check-registration validates a task's ## Touches authorization — it requires a task id (the
  // --touches CSV mode is a raw file-list with no ## Touches to validate, so it is not a target).
  if (checkRegOnly && !taskId) {
    process.stderr.write(`select-static-checks-for-touches: --check-registration requires --task <id> (a file-list --touches has no ## Touches to validate)\n`);
    return 2;
  }
  const testSh = path.join(root, TEST_SH_REL);
  if (!fs.existsSync(testSh)) {
    process.stderr.write(`select-static-checks-for-touches: scripts/test.sh not found at ${testSh}\n`);
    return 2;
  }
  const registry = parseStaticCheckRegistry(fs.readFileSync(testSh, "utf8"));

  if (listMode) {
    for (const c of registry) {
      const obj = c.objects.length ? ` [${c.objects.join(", ")}]` : "";
      const mode = c.scopedMode ? ` (${c.scopedMode})` : "";
      console.log(`${c.tier}\t${c.name}${mode}${obj}`);
    }
    return 0;
  }

  let touches;
  let newTouches = [];
  if (touchesArg !== undefined) {
    touches = touchesArg.split(",").map((s) => stripTrailingAnnotation(s)).filter(Boolean);
    // `--touches` mode carries no `(new)` tags — a plugin/scripts touch that is git-untracked at
    // selection time is the new-file signal (a file the task created but has not yet committed).
    for (const t of touches) {
      if (matchesObject("plugin/scripts/", t) && isGitUntracked(root, t)) newTouches.push(t);
    }
  } else if (taskId) {
    const taskTouches = touchesFromTask(root, taskId);
    if (taskTouches === null) {
      process.stderr.write(`select-static-checks-for-touches: task file not found: tasks/${taskId}.md\n`);
      return 2;
    }
    touches = [...taskTouches.paths];
    newTouches = [...taskTouches.newPaths];
    // AC4-i: the change IS this task, so its OWN file is always a touched task — the ## Contract
    // consumer must scan it even when the task's `## Touches` omits the self-touch (pre-convention
    // tasks). Deduped in selectStaticChecksForTouches.
    touches.push(`tasks/${taskId}.md`);
    // git-untracked fallback (AC4): a plugin/scripts touch NOT marked `(new)` that is nonetheless
    // not yet tracked is still a NEW file (the task created it but omitted the marker — the exact
    // regression class this gate exists to catch at creation time).
    for (const t of touches) {
      if (matchesObject("plugin/scripts/", t) && !newTouches.includes(t) && isGitUntracked(root, t)) {
        newTouches.push(t);
      }
    }
  } else {
    process.stderr.write(`${usage}\n`);
    return 2;
  }

  const { selected, deferred } = selectStaticChecksForTouches(touches, registry, { newTouches });

  // DISPATCH-PREFLIGHT REGISTRATION CHECK (gap-new-script-touches-missing-inventory-catalog-
  // registration, AC2/AC3/AC4): a task whose ## Touches declare a NEW plugin/scripts file must ALSO
  // authorize the registration files — otherwise the dispatched agent is not authorized to touch the
  // catalog declaration / DELIVERY-INVENTORY snapshot, and either oversteps or stops (the 3-instance
  // regression). The check runs ONLY in --task mode (the task's ## Touches are the authorization to
  // validate); the --touches CSV mode is a raw file-list (no ## Touches to validate) and is never
  // gated (a `--scoped <files>` run keyed to an untracked new script must not false-positive). A
  // failing task fails the scoped static-check selection (exit 1), which scripts/test.sh's
  // run_scoped_static_checks_sel treats as a FATAL gate (`if ! cmds=...; then exit 1; fi`) —
  // fail-closed, the task cannot pass its own scoped run until its Touches authorize the files.
  const regCheck = taskId ? checkTouchesRegistration(touches, newTouches) : { ok: true };

  if (checkRegOnly) {
    process.stdout.write(JSON.stringify({
      taskId: taskId ?? null,
      touches,
      newTouches,
      registrationCheck: regCheck,
    }, null, 2) + "\n");
    return regCheck.ok ? 0 : 1;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      taskId: taskId ?? null,
      touches,
      selected: selected.map((s) => s.name),
      deferred,
      commands: selected.map((s) => buildCommand(s, root)),
      registrationCheck: regCheck,
    }, null, 2) + "\n");
    return regCheck.ok ? 0 : 1;
  }
  if (!regCheck.ok) {
    process.stderr.write(
      `select-static-checks-for-touches: ${regCheck.reason} — task declares new plugin/scripts file ` +
      `"${regCheck.newScript}" but its ## Touches do not authorize the registration file(s): ` +
      `${regCheck.missing.join(", ")}. Add these to ## Touches before dispatching.\n`,
    );
    return 1;
  }
  if (namesOnly) {
    for (const s of selected) process.stdout.write(`${s.name}\n`);
    return 0;
  }
  if (commandsMode) {
    for (const s of selected) process.stdout.write(`${buildCommand(s, root)}\n`);
    return 0;
  }
  // default --commands
  for (const s of selected) process.stdout.write(`${buildCommand(s, root)}\n`);
  return 0;
}

if (isDirectEntry(import.meta, undefined, "select-static-checks-for-touches")) {
  process.exitCode = main(process.argv);
}
