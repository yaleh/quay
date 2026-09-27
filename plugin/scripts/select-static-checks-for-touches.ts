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
import { repoRoot } from "./repo-root.ts";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractSection } from "./task-schema.ts";
import { parseTouchEntriesWithTags } from "./touches-parser.ts";
// `loop.doc_surfaces` is read from the target's `.quay/config.yml`. The `yaml` package is already a
// shipped dependency of this plugin bundle (worker-fan-in.ts / task-schema.ts / driver-config.ts all
// import it, and the plugin bundle carries the createRequire banner yaml's CJS interop needs) — ⛔ not
// a hand-rolled YAML scanner, that would be a second parser to drift.
import { parse as parseYaml } from "yaml";
// getArgValue now lives in gate-script-base.ts as `flagValue` (it was one of the byte-identical
// copies of the indexOf+next-arg idiom in plugin/scripts; .quay/routine-findings.jsonl finding
// `arg-parsing-helper-family`, routine `semantic-dedup-scan`).
import { isDirectEntry, normalizeRel, flagValue } from "./gate-script-base.ts";
// The ONE regex-literal escaper (kernel leaf via the plugin shim). This file used to carry a private
// char-by-char `Set`-loop rewrite; its comment claimed the TS type-stripper mis-parses the
// character-class literal — measured false on Node v24 (the kernel leaf IS that literal, alive), and
// the rewrite made the copy invisible to the previous sweep's byte-identical-body needle (finding
// `escaperegexp-sweep-missed-two`, routine `semantic-dedup-scan`; see
// packages/quay/test/kernel-regex-escape.test.mjs ④).
import { escapeRegExp } from "./regex-escape.ts";

// ── Constants ──────────────────────────────────────────────────────────────────────────────────────────

/** Default tier for an unannotated checker: `full` — a checker with no annotation stays in the
 *  FULL set only, and scoped conservatively defers it (never silently drops it from the full gate). */
export const DEFAULT_TIER = "full";
const TIERS = new Set(["always", "change", "full"]);
/** The registry's FILE NAME — the ONE path literal in the repo (see REGISTRY_REL_CANDIDATES); every
 *  layout's location is derived from it, so a second copy can never drift from it. */
export const REGISTRY_BASENAME = "runner-static-gate.ts";

/** Where the checker registry is looked up, relative to a candidate root, in PRIORITY ORDER. The
 *  registry is the single source for the mapping (`runner-static-gate.ts`'s `run_static_checks()`
 *  body, extracted from scripts/test.sh, gap-ac128-hub-split-harness-concerns) and it exists in the
 *  tree under TWO layouts, because the SHIPPED artifact does not preserve the source tree's shape:
 *
 *    1. `plugin/scripts/runner-static-gate.ts` — the dev/source checkout and anything carrying a
 *       `plugin/` layer (`<repo>/plugin/scripts/…`, the main-checkout merge root). Tried FIRST, so the
 *       source tree's own registry always wins where it exists (behavior unchanged).
 *    2. `scripts/runner-static-gate.ts` — the PACKAGED artifact: `package.sh` stages `plugin/` INTO
 *       `packages/quay/plugin/` and `npm pack` ships that dir as the package's `plugin/`, so the
 *       installed plugin ROOT carries `scripts/` DIRECTLY — ⛔ no nested `plugin/` layer underneath.
 *       Before this fallback the lookup joined the single relative literal above and exited 2 on every
 *       install (`<pluginroot>/plugin/scripts/…` never exists there) ⇒ `--classify-delta` could not
 *       judge a non-empty delta in ANY third-party project ⇒ the fan-in suite-certificate gate refused
 *       every non-flip delta ⇒ full suites burned (gap-classify-delta-registry-path-layout-aware).
 *
 *  ⛔ Still three-state, not boolean (hard rule 3b): "not found under ANY layout" stays exit 2 with the
 *  original wording for every mode that genuinely NEEDS the registry (the scoped selection / --list /
 *  the ## Touches registration check) — a caller must never read a missing registry as an invented
 *  "empty registry ⇒ nothing selected". The two modes that CAN answer without it are handled above the
 *  requirement and do NOT exit 2: `--bootstrap-orchestration` (reads only the fan-in file set) and
 *  `--classify-delta` (falls back to the project's declared `loop.doc_surfaces`, then to the
 *  conservative quay-written-surfaces default — gap-fan-in-delta-classify-declared-doc-surfaces). */
export const REGISTRY_REL_CANDIDATES = [
  path.posix.join("plugin", "scripts", REGISTRY_BASENAME),
  path.posix.join("scripts", REGISTRY_BASENAME),
];

/** The PRIMARY layout's relative path — kept as the module's historical export (`ff-merge.ts` and the
 *  scanners refer to it by this name). It is a READ of the candidate list, ⛔ not a second literal. */
export const TEST_SH_REL = REGISTRY_REL_CANDIDATES[0];

/** The FIRST candidate root that actually carries the registry, or null when none does. Pure lookup:
 *  the caller decides what an absent registry MEANS (the registry-requiring modes exit 2; the
 *  `--classify-delta` path falls back to the declared/conservative doc surfaces), so a miss can never
 *  be mistaken for a verdict. */
export function resolveRegistryPath(root) {
  for (const rel of REGISTRY_REL_CANDIDATES) {
    const abs = path.join(root, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

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
 * The registration files a task whose Touches declare a NEW `plugin/scripts/*` file MUST ALSO
 * authorize in its Touches (gap-new-script-touches-missing-inventory-catalog-registration, AC3). A
 * new script landing in the plugin-bundle has ONE mechanical-necessity sync product that lives
 * OUTSIDE the script file itself:
 *   1. `plugin/scripts/capability-catalog-declarations.json` — the AC1c QUESTION-table declaration
 *      entry (a new script with no declaration is `unclassified` and the catalog exits non-zero).
 *      ⛔ This is the DECLARATION DATA FILE, not capability-catalog.sh: the tables moved out of the
 *      .sh into data (gap-arch-catalog-declarations-leave-bash), so that file — not the shell entry,
 *      which is now a thin exec wrapper — is where a new script is registered.
 *   (The former SECOND product — `docs/proposals/quay-product-outline.md` §6 DELIVERY-INVENTORY
 *   snapshot — is RETIRED: the inventory is now computed at check time by
 *   verify-delivery-surface.ts --inventory (gap-delivery-inventory-check-time-computation), so a new
 *   script no longer drifts a committed snapshot and no longer needs outline authorization.)
 * When these are NOT in the task's Touches, the dispatched agent is NOT authorized to touch them —
 * the 3-instance regression this task closes (2 agents overstepped and edited them anyway, 1 agent
 * correctly stopped). This check turns that "post-hoc authorization" into a dispatch-preflight
 * precondition: a new-script task whose Touches omit the registration files is flagged
 * `touches-missing-registration` and must be fixed (add the files to ## Touches) before it can be
 * worked — the agent either oversteps or stops today, both of which this task removes.
 */
export const NEW_SCRIPT_REGISTRATION_REQUIRED = ["plugin/scripts/capability-catalog-declarations.json"];

/**
 * Dispatch-preflight registration check (gap-new-script-touches-missing-inventory-catalog-
 * registration, AC2/AC3/AC4). Pure: given the task's declared `## Touches` paths and its NEW-file
 * subset (the `(new)`-tagged and/or git-untracked plugin/scripts paths — the SAME signal
 * CAPABILITY_CATALOG_CHECKER uses), return ok:false with reason
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


// ── Path helpers ──────────────────────────────────────────────────────────────────────────────────────


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

// ── Fan-in delta doc/code classification (gap-fan-in-delta-scope-doc-only-skip, AC2) ─────────────────
//
// The fan-in step-2 "is this delta doc-only (skip the full suite) or code (must re-run it)?" judgment
// used to be a HAND-WRITTEN regex (`grep -vE '^tasks/|^docs/|…|[.]md$'`) in fan-in-execute.js. That
// table drifted (it classified orchestration/manager-tick-core.md as doc — but tick-core-static-check
// READS orchestration/*.md, so a (src:N) violation there reddens the suite; the hand table missed it,
// and would next miss .claude/workflows/ or docs/references/). The task's ruling (manager 2026-08-16
// 22:0xZ, adopted by gap-fan-in-delta-scope-doc-only-skip):
//   doc ≠ "filename ends in .md" or any hand-written path table — doc = "NO suite checker reads this
//   path". Mechanizable: each checker self-declares (or is enumerated to declare) which paths it
//   reads ⇒ doc-only = delta ∩ (union of all checker-read paths) = ∅. That union is COMPUTED here
//   from scripts/test.sh's `@static-object` annotations (the SAME single source
//   parseStaticCheckRegistry parses — never a hand-maintained list).
//
// Operational carve-out (documented, deliberate): `tasks/` is still doc even though landing-target-
// check's `@static-object tasks/` glob technically matches it. Reason: every fan-in's OWN task file is
// ALWAYS in the scoped run's always-tier task-file checker set (select-static-checks-for-touches
// appends `tasks/<id>.md` to the touched set), so a task-file-only change is already fully verified
// by the scoped + doc phases the fan-in always runs — making it "code" would force a full suite for
// every task-file-only fan-in with zero correctness gain. The carve-out is one line (below), isolated
// from the registry computation.
//
// A path is CODE (needs the full suite) iff:
//   ① any change/full-tier static checker's self-declared `@static-object` glob matches it
//      (computed from scripts/test.sh — the "suite-read path" set), OR
//   ② it is NOT under a known task-board/doc/telemetry surface (docs/, adr/, .quay/, measurements/,
//      milestones/, orchestration/archive/, plugin/loop/) — product code / unknown paths fail-closed
//      to code (hard rule 3b: 判不出 ≠ 不需要; an unrecognized path may break the suite).
// A path is DOC only when neither holds AND it is a task file or under a doc surface.
//
// ⚠️ ① only exists in REGISTRY mode — the tree carries quay's checker list, i.e. it IS quay's own tree
// (or vendored a copy). A tree without it has no checker set to ask "does anything read this?", so the
// judgment is ② alone over the surfaces the project declared (`loop.doc_surfaces`) or, absent a
// declaration, the conservative quay-written default. Which of the three applies is
// `resolveDocSurfaceDecision` — the ONE entry both the fan-in step-4 skip/rerun judgment and the
// ff-merge certificate gate call (gap-fan-in-delta-classify-declared-doc-surfaces, 硬规则 5b).
//
// Falsification (pinned by plugin/test/fan-in-execute-paths.test.mjs):
//   取假二: orchestration/manager-tick-core.md (read by tick-core-static-check / rhythm-consumer's
//   `orchestration/*-tick-core.md`) must classify as CODE — never doc-only skip.

/** Known task-board / documentation / telemetry surfaces — a delta that ONLY touches these is already
 *  verified by the scoped + doc phases the fan-in always runs. Registry overrides fire first (a
 *  checker-read path under docs/, e.g. docs/analysis/ac69-*.json, is code). */
export const DOC_SURFACES = [
  "tasks/", "goals/", "docs/", "adr/", ".quay/", "measurements/", "milestones/",
  "orchestration/archive/", "plugin/loop/",
];

/** The conservative, layout-INDEPENDENT doc-surface default — used when this tree carries NO quay
 *  static-check registry and the project declared no `loop.doc_surfaces` (i.e. a third-party project).
 *  It names ONLY the surfaces quay's own machinery writes into EVERY workspace (the task board, the
 *  goal store, the workspace config/telemetry dir): a project with none of these has an empty doc
 *  face and every delta is code — fail-closed, hard rule 3b.
 *
 *  ⛔ `DOC_SURFACES` above is NOT a valid default here. It is quay's OWN layout (docs/, adr/,
 *  measurements/, milestones/, orchestration/archive/, plugin/loop/); applying it to a foreign tree
 *  would call that tree's product code "doc" and silently skip its full suite — the exact
 *  "判不出 ≠ 不需要" failure the conservative default exists to prevent.
 *  (gap-fan-in-delta-classify-declared-doc-surfaces) */
export const CONSERVATIVE_DOC_SURFACES = ["tasks", "goals", ".quay"];

/** The `loop:` key a project uses to DECLARE its doc-only path prefixes — the third-party half of the
 *  fan-in doc/code classification (see plugin/skills/init/SKILL.md, section "loop.doc_surfaces"). */
export const DOC_SURFACES_KEY = "doc_surfaces";

/** Read `<root>/.quay/config.yml` `loop.doc_surfaces` — the project's EXPLICIT declaration, or null
 *  when it is absent / unreadable / malformed / not a non-empty list of strings.
 *
 *  ⛔ null means "not declared", NEVER "declared to be empty": an empty list is indistinguishable from
 *  a truncated read, and reading a malformed value as a deliberate one is exactly the
 *  "读不懂 ⇒ 伪装成合格" shape of hard rule 3b. Entries are canonicalised through `normalizeRel` and
 *  de-slashed, so `docs`, `docs/`, `./docs/` and `docs//` all match the delta path `docs/x.md`. */
export function readDeclaredDocSurfaces(root) {
  let parsed;
  try {
    parsed = parseYaml(fs.readFileSync(path.join(root, ".quay", "config.yml"), "utf8"));
  } catch {
    return null; // absent or unparseable ⇒ not declared (never an invented empty declaration)
  }
  const loop = parsed && typeof parsed === "object" ? parsed.loop : undefined;
  const declared = loop && typeof loop === "object" ? loop[DOC_SURFACES_KEY] : undefined;
  if (!Array.isArray(declared)) return null;
  const out = declared
    .filter((s) => typeof s === "string")
    .map((s) => normalizeRel(s))
    .filter((s) => s !== "");
  return out.length > 0 ? [...new Set(out)] : null;
}

/** Canonicalise a doc-surface entry for prefix matching: `normalizeRel` (drops `./`, `.`, `..`, a
 *  trailing `/`) then compare segment-wise. ⛔ The match is `p === s || p.startsWith(s + "/")`, never a
 *  bare `startsWith(s)`: `docs` must not swallow `docs-old/x.ts` (the same over-broad-substring defect
 *  the `goals/` fixture pins). */
export function isUnderDocSurface(p, docSurfaces) {
  return (docSurfaces ?? []).some((raw) => {
    const s = normalizeRel(raw);
    return s !== "" && (p === s || p.startsWith(`${s}/`));
  });
}

/** How the doc/code judgment is decided for a given root — the THREE states the classifier can be in.
 *  ⛔ Never collapse them into a boolean (hard rule 3b): a reader must be able to ask WHICH rule
 *  produced a verdict, and "the tree carries no registry and declares no surfaces" must be visible
 *  rather than looking like a well-founded registry verdict.
 *
 *    registry             this tree carries quay's static-check registry ⇒ the registry decides (the
 *                         delta∩{checker-@static-object} test), with DOC_SURFACES as the surface list.
 *                         This is quay's OWN tree (and any tree that vendored the registry).
 *    declared             no registry, but `.quay/config.yml` declares `loop.doc_surfaces` ⇒ those
 *                         prefixes (plus the `tasks/` carve-out) are doc, everything else is code.
 *    conservative-default neither ⇒ task board / goal store / `.quay/` are doc, everything else is code.
 *
 *  THE DEFECT THIS CLOSES (gap-fan-in-delta-classify-declared-doc-surfaces): the registry lookup was
 *  the ONLY path, so a third-party tree exited 2 ⇒ worker-fan-in's `__CLASSIFY_FAILED__` ⇒ full suite
 *  on EVERY non-empty delta (measured: 11 of 177 delta judgments on claudecodeui), and the project
 *  "fixed" it by committing a COPY of quay's registry into its own repo — at which point quay's
 *  checker list decided a foreign tree's doc/code split, which is meaningless. */
/** The absolute paths the registry lookup actually tries, in priority order — `REGISTRY_REL_CANDIDATES`
 *  joined to `root`. ⛔ Never a second copy of the rel-path list: the caller (the instrument probe's
 *  `detail` line) must be able to say WHAT it looked for without re-deriving it (硬规则 5b). */
export function registryLookupCandidates(root) {
  return REGISTRY_REL_CANDIDATES.map((rel) => path.join(root, rel));
}

export function resolveDocSurfaceDecision(root) {
  const registryPath = resolveRegistryPath(root);
  const candidates = registryLookupCandidates(root);
  if (registryPath) {
    return {
      mode: "registry",
      registryPath,
      registryCandidates: candidates,
      registry: parseStaticCheckRegistry(fs.readFileSync(registryPath, "utf8")),
      docSurfaces: DOC_SURFACES,
      detail: `registry at ${registryPath}`,
    };
  }
  const declared = readDeclaredDocSurfaces(root);
  if (declared) {
    return {
      mode: "declared",
      registryPath: null,
      registryCandidates: candidates,
      registry: null,
      docSurfaces: declared,
      detail: `no registry (tried ${candidates.join(" , ")}) but loop.${DOC_SURFACES_KEY} declares [${declared.join(", ")}]`,
    };
  }
  return {
    mode: "conservative-default",
    registryPath: null,
    registryCandidates: candidates,
    registry: null,
    docSurfaces: CONSERVATIVE_DOC_SURFACES,
    detail: `no registry and no loop.${DOC_SURFACES_KEY} declaration ⇒ quay-written surfaces only`,
  };
}

/** The decision as a MACHINE-readable line — the shape `--classify-delta --resolution` prints and the
 *  ONLY thing the ff-merge instrument probe parses. WHY a separate face instead of the exit code: the
 *  probe used to read `--classify-delta` exit 0 as "this root carries a registry", which held only
 *  while a registry-less root exited 2. That is exactly the condition this task removes, so the probe
 *  would have read `evaluated: true` for EVERY root — a reading that can no longer take false is not a
 *  measurement (硬规则 4). Reporting the MODE keeps the reading falsifiable and makes "it judged, but
 *  without quay's checker list" visible instead of collapsing it into "available". */
export function docSurfaceDecisionLine(decision) {
  return JSON.stringify({
    mode: decision.mode,
    registryPath: decision.registryPath,
    registryCandidates: decision.registryCandidates,
    docSurfaces: decision.docSurfaces,
  });
}

/** The fan-in's ONE classification entry (`--classify-delta` is its CLI face): given the tree the
 *  delta is relative to and the delta paths, return the decision AND the CODE subset. Both the fan-in
 *  step-4 skip/rerun judgment (worker-fan-in.ts) and the ff-merge suite-certificate gate
 *  (packages/quay/src/fan-in/ff-merge.ts) go through this one judgment — 硬规则 5b: a second
 *  doc-surface list anywhere is a drift, not an optimization. */
export function classifyDeltaPaths(root, paths) {
  const decision = resolveDocSurfaceDecision(root);
  const codePaths = (paths ?? []).filter((p) => !isDocPath(p, decision.registry, decision.docSurfaces));
  return { decision, codePaths };
}

/** True iff a repo-relative delta path is DOC (safe to skip the full suite). false = code (the full
 *  suite must re-run). `registry` is the parsed static-check registry (parseStaticCheckRegistry) —
 *  null when the tree carries none, in which case `docSurfaces` (the caller's decision, see
 *  resolveDocSurfaceDecision) is the whole judgment. Defaults keep the pre-existing callers (the
 *  scoped selector / driver-filters) on quay's own surface list. */
export function isDocPath(pathStr, registry, docSurfaces = DOC_SURFACES) {
  const p = String(pathStr).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!p) return true;
  // The task-file carve-out (see the block comment above): task files are the doc surface the
  // doc-only skip exists FOR. Must precede the registry check so landing-target's `tasks/` glob does
  // not flip them to code.
  if (p === "tasks" || p.startsWith("tasks/")) return true;
  const codeObjects = (registry ?? [])
    .filter((c) => c.tier === "change" || c.tier === "full")
    .flatMap((c) => c.objects);
  if (codeObjects.some((o) => matchesObject(o, p))) return false; // a checker reads it ⇒ code
  if (isUnderDocSurface(p, docSurfaces)) return true; // known task-board/doc/telemetry surface
  return false; // product code / unknown path ⇒ code (fail-closed)
}

// ── Fan-in orchestration bootstrap detection (gap-fan-in-orchestration-bootstrap-self-fix) ────────────
//
// THE DEFECT (from the task title): fan-in orchestration files
// (`.claude/workflows/fan-in-execute.js`, `select-static-checks-for-touches.ts`, `fan-in-ff-merge.sh`,
// `per-task-suite-record.ts`, `full-suite-runner.ts`, …) are dispatched/resolved from the MAIN
// checkout, so a task that MODIFIES one of these files has its own fan-in run by the OLD main-checkout
// version — its own fix is never exercised (bootstrap/self-reference). Structural exposure = 8
// (commits touching .claude/workflows/fan-in-execute.js), observable misjudgment = 1 (delta-scope:
// the old step-2 `git diff fork develop` judged doc-only while the branch's own code slipped through).
//
// THE FIX (two halves, both keyed to THIS file set so it cannot drift from the code that runs):
//   ① DISPATCH (workflow file): the inner A6 dispatcher checks `--bootstrap-orchestration` on the
//     branch's delta; a HIT ⇒ the fan-in is dispatched with scriptPath = the WORKTREE's
//     `.claude/workflows/fan-in-execute.js` (the branch's own version), so step-2 logic + the whole
//     generated prompt come from the task's own fix. Miss ⇒ main checkout (status quo).
//   ② WORKTREE RESOLUTION (inside fan-in-execute.js's prompt): every fan-in orchestration script call
//     (classify / ff-merge / per-task-suite-record / full-suite-runner / …) is invoked with an explicit
//     `${worktree}`-rooted path — NOT cwd-dependent, NOT `${root}` — so a task's modifications to those
//     scripts are what actually runs, regardless of the fan-in subagent's working directory.
//
// This file set is the SINGLE source for both halves (the workflow's step-0 bash calls this same CLI,
// and the A6 dispatch rule references the same command). Falsification (pinned by
// plugin/test/fan-in-execute-paths.test.mjs):
//   取假一: a branch that modifies `.claude/workflows/fan-in-execute.js` ⇒ `--bootstrap-orchestration`
//   returns that path (the dispatcher MUST use the worktree scriptPath).
//   取假二: a branch that modifies ONLY `tasks/*.md` ⇒ empty output (miss — main-checkout scriptPath is
//   correct); the two paths are distinguishable (negative control).

/** The fan-in orchestration pipeline's OWN file set — the files a task can modify whose modification
 *  must be exercised by that task's own fan-in. Enumerated per AC1 of
 *  gap-fan-in-orchestration-bootstrap-self-fix; extend here (and ONLY here) when the pipeline grows. */
export const FAN_IN_ORCHESTRATION_FILES = [
  "plugin/workflows/fan-in-execute.js",
  "plugin/scripts/select-static-checks-for-touches.ts",
  "plugin/scripts/fan-in-ff-merge.sh",
  "plugin/scripts/per-task-suite-record.ts",
  "plugin/scripts/pre-verified-round-record.ts", // the shared verification-round writer (both fan-in branches)
  "plugin/scripts/full-suite-runner.ts",
  "plugin/scripts/mirror-full-suite-state.ts", // the full-suite-state mirror MODULE LIBRARY, no CLI entry — consumed in-process by worker-driver.ts's mechanical fan-in (gap-full-suite-state-stale-no-writer AC1; CLI face retired by gap-mirror-full-suite-state-retire-dead-cli-face)
];

/** PURE: given a branch's repo-relative delta paths (from `git diff --name-only <merge-base> HEAD`),
 *  return the subset that are fan-in orchestration files (empty = miss ⇒ the branch does not modify
 *  the pipeline itself ⇒ the main-checkout scriptPath is fine). Used by BOTH the A6 dispatch rule and
 *  the workflow's step-0 bootstrap block (same command, one source). */
export function fanInOrchestrationBootstrapHit(deltaPaths) {
  return (deltaPaths || [])
    .map(normalizeRel)
    .filter(Boolean)
    .filter((p) => FAN_IN_ORCHESTRATION_FILES.some((o) => matchesObject(o, p)));
}

// ── Bootstrap worktree sync (gap-bootstrap-worktree-stale-fan-in-execute, AC1/AC2) ────────────────────
//
// THE DEFECT (from the task title): a bootstrap-HIT task's fan-in is dispatched with the WORKTREE's
// fan-in-execute.js as scriptPath so the branch's own fix is self-validated. But the worktree forked
// from develop at SOME earlier commit; if a fan-in orchestration fix landed on develop AFTER the fork
// (e.g. the poll-bounded blocking wait — `timeout 540` — 23a75eba), the worktree's fan-in-execute.js
// is the OLD version — that fix does NOT take effect for bootstrap-HIT tasks (empirical: the
// full-suite-state-stale worktree forked at e29e5de9, before poll-bounded landed ⇒ its fan-in used the
// non-blocking poll, ~21 round trips instead of ~3).
//
// THE FIX: before the fan-in dispatches with the worktree scriptPath (A6 dispatch rule), and again at
// the workflow's step 0 (before step-1's `git merge develop`), MERGE develop into the worktree. After a
// clean merge, EVERY orchestration file = the branch's own modifications (self-validation) MERGED WITH
// develop's latest (the poll fix is present even in unmodified regions of a branch-modified file). On
// conflict, abort and leave the worktree clean (the workflow's step-1 merge will surface and resolve
// it — status quo). On a dirty worktree / unresolvable merge-target ref, skip (step-1 handles it). The
// merge is idempotent: if the dispatch already merged, step-0's merge reports "Already up to date".
//
// Callers resolve the SCRIPT from the worktree first (the branch's own copy — it carries this mode on
// the branch even before it lands on develop), falling back to ${root} (a worktree forked before this
// mode landed on develop cannot run it from itself).

export interface BootstrapSyncResult {
  worktree: string;
  mergeTarget: string;
  merged: boolean;
  conflict: boolean;
  skipped: boolean;
  skipReason: string;
  head: string | null;
  error: string | null;
}

/** Run `git merge <mergeTarget>` inside a task worktree so the worktree's fan-in orchestration files
 *  (fan-in-execute.js + scripts) are the LATEST develop version while preserving the branch's own
 *  modifications (bootstrap self-validation). Never fail-closed: a conflict / dirty tree / unresolvable
 *  ref returns a distinguishable skipped/conflict result and leaves the worktree clean — the fan-in's
 *  step-1 merge is the authoritative conflict-resolution point. */
export function syncWorktreeOrchestration(
  worktree: string,
  mergeTarget: string,
  opts: { timeoutMs?: number } = {},
): BootstrapSyncResult {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const base: BootstrapSyncResult = {
    worktree, mergeTarget, merged: false, conflict: false,
    skipped: false, skipReason: "", head: null, error: null,
  };
  const run = (args: string[], cwd: string): { status: number; stdout: string; stderr: string } => {
    try {
      const out = execFileSync("git", args, { cwd, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] });
      return { status: 0, stdout: out, stderr: "" };
    } catch (e) {
      const err = e as { status?: number; stdout?: string | Buffer; stderr?: string | Buffer };
      return { status: err.status ?? 1, stdout: String(err.stdout ?? ""), stderr: String(err.stderr ?? "") };
    }
  };
  const tail = (s: string) => s.trim().split("\n").filter(Boolean).slice(-3).join(" ");

  const probe = run(["rev-parse", "--is-inside-work-tree"], worktree);
  if (probe.status !== 0) return { ...base, skipped: true, skipReason: "not-a-git-worktree" };

  const refProbe = run(["rev-parse", "--verify", "--quiet", `${mergeTarget}^{commit}`], worktree);
  if (refProbe.status !== 0) return { ...base, skipped: true, skipReason: `merge-target-unavailable:${mergeTarget}` };

  // Dirty-check ignores UNTRACKED files (--untracked-files=no): a merge is blocked by MODIFIED tracked
  // files, not by untracked additions (test fixtures symlink plugin/ as untracked; production worktrees
  // at fan-in time carry no tracked modifications).
  const status = run(["status", "--porcelain", "--untracked-files=no"], worktree);
  if (status.status === 0 && status.stdout.trim() !== "") return { ...base, skipped: true, skipReason: "dirty-worktree" };

  const m = run(["merge", "--no-edit", "--no-progress", mergeTarget], worktree);
  if (m.status === 0) {
    const head = run(["rev-parse", "HEAD"], worktree);
    return { ...base, merged: true, head: head.status === 0 ? head.stdout.trim() : null };
  }
  if (/CONFLICT/i.test(m.stderr) || /CONFLICT/i.test(m.stdout)) {
    try { execFileSync("git", ["merge", "--abort"], { cwd: worktree, stdio: "ignore", timeout: timeoutMs }); } catch { /* best-effort */ }
    return { ...base, conflict: true, error: tail(`${m.stderr}\n${m.stdout}`) };
  }
  return { ...base, error: tail(`${m.stderr}\n${m.stdout}`) || "git merge failed" };
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
  // (The former AC2 DELIVERY-INVENTORY drift check is RETIRED — gap-delivery-inventory-check-time-
  // computation: the inventory is computed at check time by verify-delivery-surface.ts --inventory,
  // so a new script no longer drifts a committed snapshot and needs no scoped drift gate.)
  const newTouches = opts && opts.newTouches ? opts.newTouches : [];
  const newPluginScript = [...new Set(newTouches.map(normalizeRel))]
    .some((t) => isShippedPluginScript(t));
  if (newPluginScript) {
    selected.push(CAPABILITY_CATALOG_CHECKER);
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
      the registration file (plugin/scripts/capability-catalog.sh).
      Prints JSON { ok, reason, missing, newScript, ... }, exits 0 when ok, 1 when touches-missing-registration.
      The same check runs implicitly in every --task selection mode: a failing task makes the scoped
      static-check selection exit non-zero, so scripts/test.sh's scoped gate turns red (fail-closed)
      instead of dispatching an agent whose Touches do not authorize the sync products.

Selection rule (AC1/AC3, parsed mechanically from scripts/test.sh's run_static_checks body):
  scoped = { tier=always } ∪ { tier=change whose object ∩ touches } − { tier=full }
  tier annotations live in scripts/test.sh (never hand-listed here).
  PLUS: a NEW plugin/scripts file in the touches ((new) tag or git-untracked) adds the
  capability-catalog AC1c entry-point gate to the scoped set
  (gap-capability-catalog-declarations-not-enforced-at-script-creation).
  (The former DELIVERY-INVENTORY drift check is RETIRED — gap-delivery-inventory-check-time-
   computation.)

Output modes:
  --commands (default) — concrete shell commands for the selected checkers (one per line)
  --names              — checker names only (one per line)
  --list               — the full registry (tier / objects / scoped-mode per checker)
  --json               — machine-readable selection {selected, deferred, always, change}
  --classify-delta <path>… — fan-in doc/code classification (gap-fan-in-delta-scope-doc-only-skip):
      print the CODE (non-doc) paths among the given repo-relative delta files (one per line). WHICH
      paths count as doc is decided in three states, never a bare boolean
      (gap-fan-in-delta-classify-declared-doc-surfaces):
        registry              this tree carries quay's checker registry (plugin/scripts/… or scripts/…)
                              ⇒ doc = "no change/full-tier checker's @static-object glob matches it" AND
                              under a task-board/doc/telemetry surface (tasks/, docs/, adr/, .quay/,
                              measurements/, milestones/, orchestration/archive/, plugin/loop/).
        declared              no registry, but the config's loop.doc_surfaces declares the
                              project's doc prefixes ⇒ those (plus tasks/) are doc.
        conservative-default  neither ⇒ only the surfaces quay itself writes (tasks/, goals/, .quay/)
                              are doc; everything else is code.
      Exit 0 on every well-formed input (empty input ⇒ empty output = doc-only). ⛔ Absence of a
      registry is NOT exit 2 here — a third-party tree gets a real verdict, not a fail-closed rerun.
  --classify-delta --resolution — the SAME decision, reported instead of applied: print ONE JSON line
      {mode, registryPath, registryCandidates, docSurfaces}. mode is the three-state above, so a
      caller can tell "judged by quay's own checker registry" from "judged without it" — the reading the
      ff-merge instrument probe consumes. ⛔ Never infer capability from the exit code: this mode and
      the code-subset mode BOTH exit 0 for every registry-less tree.
  --bootstrap-orchestration <path>… — fan-in orchestration bootstrap detection
      (gap-fan-in-orchestration-bootstrap-self-fix): print the given repo-relative delta paths that are
      fan-in orchestration files themselves (fan-in-execute.js / select-static-checks-for-touches.ts /
      fan-in-ff-merge.sh / per-task-suite-record.ts / full-suite-runner.ts + mirrors), one per line.
      Empty = miss (the branch does not modify the pipeline ⇒ main-checkout scriptPath is fine);
      non-empty = HIT ⇒ the fan-in must run the WORKTREE's own version of the pipeline.
  --bootstrap-sync --worktree <dir> [--merge-target <branch>] [--root <dir>] — bootstrap worktree
      sync (gap-bootstrap-worktree-stale-fan-in-execute): merge the merge-target into the task worktree
      so its fan-in orchestration files (fan-in-execute.js + scripts) are the LATEST develop version
      while preserving the branch's own modifications (self-validation). Run BEFORE the fan-in
      dispatches with the worktree scriptPath (A6 rule) and again at the workflow's step 0 (before
      step-1 merge develop). Prints FAN-IN-BOOTSTRAP-SYNC merged/conflict/skipped (or --json); exit 0
      always (informational — a conflict/skip leaves the worktree clean for step-1 to resolve).

Exit codes: 0 ok; 2 usage/task-not-found.`;

/** The positional (non-flag) args — for the fan-in CLI modes (--classify-delta / --bootstrap-
 *  orchestration) where the delta paths are positional and `--root <dir>` is a flag+value pair. A
 *  value immediately following a `--flag` is that flag's value (e.g. the `--root` directory), never a
 *  delta path — without this carve-out the root directory leaks into the path list and every absolute
 *  path classifies as code (fail-closed false positive). */
function positionalArgs(args) {
  return args.filter((a, i) => {
    if (String(a).startsWith("--")) return false;
    if (i > 0 && args[i - 1] && String(args[i - 1]).startsWith("--")) return false;
    return String(a).trim() !== "";
  });
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
  // so the capability-catalog scoped checker AND the dispatch-preflight registration check fire for
  // the ACTUAL annotation format, not just the ASCII test fixture form.
  for (const p of fullWidthNewScriptPaths(sec)) {
    if (!newPaths.includes(p)) newPaths.push(p);
  }
  return { paths, newPaths };
}

export function main(argv) {
  const args = argv.slice(2);
  const taskId = flagValue(args, "--task");
  const rootArg = flagValue(args, "--root");
  const touchesArg = flagValue(args, "--touches");
  const asJson = args.includes("--json");
  const namesOnly = args.includes("--names");
  const listMode = args.includes("--list");
  const classifyDelta = args.includes("--classify-delta");
  // `--resolution` is a FACE OF `--classify-delta`, not a mode of its own (see
  // docSurfaceDecisionLine): same root, same decision, one machine-readable line instead of the code
  // subset. It is what the ff-merge instrument probe parses.
  const resolutionMode = args.includes("--resolution");
  const bootstrapOrchestration = args.includes("--bootstrap-orchestration");
  const bootstrapSync = args.includes("--bootstrap-sync");
  const commandsMode = args.includes("--commands");
  const checkRegOnly = args.includes("--check-registration");

  const root = path.resolve(rootArg ?? repoRoot());
  // --check-registration validates a task's ## Touches authorization — it requires a task id (the
  // --touches CSV mode is a raw file-list with no ## Touches to validate, so it is not a target).
  if (checkRegOnly && !taskId) {
    process.stderr.write(`select-static-checks-for-touches: --check-registration requires --task <id> (a file-list --touches has no ## Touches to validate)\n`);
    return 2;
  }

  // --bootstrap-sync --worktree <dir> [--merge-target <branch>] [--root <dir>] — bootstrap worktree
  // sync (gap-bootstrap-worktree-stale-fan-in-execute, AC1). A bootstrap-HIT task's fan-in is
  // dispatched with the WORKTREE's fan-in-execute.js as scriptPath; if the worktree forked BEFORE a
  // fan-in orchestration fix landed on develop, that file is stale and the fix never takes effect.
  // Merge develop into the worktree so every orchestration file = branch modifications MERGED WITH
  // develop's latest. Informational (exit 0 even on conflict/skip — the fan-in's step-1 merge is the
  // authoritative conflict-resolution point; the sync result distinguishes merged/conflict/skipped).
  // Referenced by BOTH the A6 dispatch rule (fast-mode-tick-core.md, run before Workflow() so the
  // dispatch-time scriptPath is the merged file) and the workflow's step-0 bootstrap block (the
  // "merge develop 前先同步" safety net — fixes the orchestration SCRIPTS even when the dispatcher
  // misses the sync). Runs BEFORE the scripts/test.sh registry check (a pure git op — no registry).
  if (bootstrapSync) {
    const worktreeArg = flagValue(args, "--worktree");
    const mergeTarget = flagValue(args, "--merge-target") ?? "develop";
    if (!worktreeArg) {
      process.stderr.write(`select-static-checks-for-touches: --bootstrap-sync requires --worktree <dir> (the task worktree to sync)\n`);
      return 2;
    }
    const result = syncWorktreeOrchestration(path.resolve(worktreeArg), mergeTarget);
    if (asJson) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      const parts = [
        `FAN-IN-BOOTSTRAP-SYNC worktree=${result.worktree}`,
        `merged=${result.merged ? 1 : 0}`,
        `conflict=${result.conflict ? 1 : 0}`,
        `skipped=${result.skipped ? 1 : 0}`,
        result.head ? `head=${result.head}` : null,
        result.skipReason ? `skip_reason=${result.skipReason}` : null,
        result.error ? `error=${result.error}` : null,
      ].filter(Boolean).join(" ");
      process.stdout.write(parts + "\n");
    }
    return 0;
  }

  // --classify-delta <path>… — fan-in step-4 doc/code classification (gap-fan-in-delta-scope-doc-only-
  // skip, AC2; declared-surface fallback by gap-fan-in-delta-classify-declared-doc-surfaces). Each argv
  // path is a repo-relative delta file (from `git diff --name-only`); print the CODE (non-doc) ones, one
  // per line. Which paths count as doc is decided by resolveDocSurfaceDecision(root) — the registry when
  // the tree carries one, else the project's declared `loop.doc_surfaces`, else the conservative
  // quay-written-surfaces default. Exit 0 always on well-formed input (empty input ⇒ empty output =
  // doc-only), and ⛔ NEVER exit 2 for a delta it can judge: a third-party tree without a registry is a
  // real verdict ("these paths are code"), not an un-evaluable one. This branch runs BEFORE the
  // registry requirement below — it is the one mode that does not need the registry at all.
  if (classifyDelta) {
    const { decision, codePaths } = classifyDeltaPaths(root, positionalArgs(args));
    if (resolutionMode) {
      console.log(docSurfaceDecisionLine(decision));
      return 0;
    }
    for (const p of codePaths) console.log(p);
    return 0;
  }

  // --bootstrap-orchestration <path>… — fan-in orchestration bootstrap detection
  // (gap-fan-in-orchestration-bootstrap-self-fix). Each argv path is a branch's repo-relative delta
  // file; print the ones that are fan-in orchestration files themselves (one per line). Empty output
  // = miss (the branch does not modify the pipeline ⇒ the main-checkout scriptPath / root resolution
  // is fine). HIT ⇒ the fan-in MUST be dispatched with the WORKTREE's fan-in-execute.js and its inner
  // orchestration scripts MUST resolve from the worktree — the branch's own fix must be exercised by
  // its own fan-in. Same command is referenced by the A6 dispatch rule (fast-mode-tick-core.md) and by
  // the workflow's step-0 bootstrap block — ONE source for the file set.
  if (bootstrapOrchestration) {
    const paths = positionalArgs(args);
    for (const p of fanInOrchestrationBootstrapHit(paths)) console.log(p);
    return 0;
  }

  // ── from here on the mode genuinely NEEDS the checker registry ─────────────────────────────────
  // (the scoped selection / --list / the ## Touches registration check all read it: without it there
  // is no mapping to compute, so a miss is exit 2 — the un-evaluable state, ⛔ never an invented
  // "empty registry ⇒ nothing selected". The two modes above deliberately sit ABOVE this line because
  // they can answer without it: --classify-delta has its declared/conservative fallback, and
  // --bootstrap-orchestration reads only the fan-in orchestration file set.)
  const testSh = resolveRegistryPath(root);
  if (!testSh) {
    const looked = REGISTRY_REL_CANDIDATES.map((rel) => path.join(root, rel)).join(" or ");
    process.stderr.write(`select-static-checks-for-touches: registry file (${REGISTRY_BASENAME}) not found at ${looked}\n`);
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
  // catalog declaration, and either oversteps or stops (the 3-instance regression). The check runs
  // ONLY in --task mode (the task's ## Touches are the authorization to
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
