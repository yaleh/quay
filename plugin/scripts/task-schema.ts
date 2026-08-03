// task-schema.mjs — the ONE canonical definition of a quay task's authoring schema (canonical-task-schema unit B1). The validator IS the schema: this module exports pure,
// side-effect-free check functions consumed by BOTH the standalone CLI (task-schema-check.mjs)
// and it0-dod-check.mjs (which imports extractSection from here so section-parsing is shared, not
// forked). There is exactly ONE definition of "schema-conformant" — checkTask() below. This header
// block-comment is the human-readable, generated-FROM-code view of that schema; if the comment and
// the code ever disagree, THE CODE WINS (the comment is regenerable, never a second authoritative
// source doc).
//
// ── Schema view (7 assertions, evaluated only on tasks bearing the marker) ────────────────────────
//
//   Marker (grandfather boundary, FORWARD-ONLY): a task is schema-applicable iff its frontmatter
//   carries `extra.schema: "v1"`. Unmarked tasks (all pre-existing legacy tasks) are reported
//   EXPLICITLY as N/A-legacy — never silently skipped. The marker is stamped by the authoring
//   sources (/quay-directive, OUTER-LOOP SELECT) going forward; no retroactive backfill. The
//   boundary is set by AUTHORSHIP, uniform across directive and milestone-candidate kinds (unlike
//   it0-dod-check.mjs Clause 8's milestone-number>=40 cutover, which only works for milestone-
//   labelled tasks). These are two INDEPENDENT gates by design — see the divergence note below.
//
//   Kind (label-aware): `labels:` contains "directive" → directive; contains "milestone-candidate"
//   → milestone-candidate; else → "other" (treated milestone-strict, fail-closed). ADRs are NOT a
//   task kind — they are a first-class quay object with their own store/validator
//   (packages/quay-native/src/adr-store.js); this validator only ever sees tasks.
//
//   A1 checkProposal          — `## Proposal` present and non-placeholder (real approach text).
//   A2 checkPlan(kind)        — directive: `## Plan` MAY be absent (PASS); if present, well-formed
//                               (`N/A — <reason>` OR a resolving docs/plans/*.md path).
//                               milestone-candidate/other: `## Plan` MUST be present AND well-formed.
//   A3 checkAcceptanceChecklist — `## Acceptance Criteria` present as a GFM checklist (>=1 `- [ ]`/
//                               `- [x]` box), not prose.
//   A4 checkDodChecklist      — `## Definition of Done` present as a GFM checklist referencing the
//                               standard DoD clauses, not prose.
//   A5 checkResolution        — forbids the two concrete Resolution DEFECTS, not the heading itself:
//                               (a) >1 `## Resolution` heading; (b) empty/placeholder body (only
//                               HTML comments / whitespace); (c) bare status-mirror (a lone
//                               `outcome: applied|deferred|pending|rejected` with no evidence). A
//                               not-yet-resolved task with NO `## Resolution` PASSES; a legitimately
//                               resolved task that folds real evidence under `## Resolution` PASSES.
//                               (Decided FIX #5 wording — do NOT "tighten" into a blanket ban.)
//   A6 checkNoScaffolding     — forbids dual-source projection scaffolding: (a) a body line that
//                               STARTS with `Source: `experiments/`; (b) a frontmatter `extra.dirFile`
//                               key (parsed, not grepped); (c) a body `Status mirror:` line whose
//                               whole value is a status word. False-positive-safe: DIR-009/010's
//                               mid-prose / line-wrapped mentions of "Source"/"Status mirror"/"dirFile"
//                               do NOT fire (verified against tasks/DIR-009.md:231, DIR-010.md:121,
//                               and the DIR-028 prose "dirFile" mentions).
//   A7 checkDirectiveSections — directive-kind ONLY: `## Finding` AND `## Requested action` MUST
//                               both be present (required by the /quay-directive authoring template).
//                               milestone-candidate/other: assertion is skipped (PASS vacuously).
//   A9 checkContractSyntax     — REPORT-ONLY (never a FAIL). If a `## Contract` section is present,
//                               its six keys (measure|band|invariant|invoke|control|resume) must be
//                               well-formed: `n/a: <reason>` is a legal value for every key, a blank
//                               value is not; measure/band must declare a NAME; invoke must be a
//                               backtick command. Absent section = INFO (the pre-ratchet baseline).
//                               The five consumer judgments (AC↔measure ref, measure command+field,
//                               invoke verbatim evidence, defect→control, blank-value) live in
//                               task-contract-check.ts — the syntax is defined HERE, shared there.
//   A10 checkDispatchReview    — REPORT-ONLY. `## Dispatch review` format: `reviewer:` (outer|none),
//                               `at:` (ISO), `changed:` (逐条；无则「无」). `reviewer: none` is legal.
//                               Missing section → finding (not a FAIL); malformed → finding.
//
//   NON-GOAL — semantic emptiness: A structural gate cannot detect a syntactically valid but
//   meaningless checklist item (a `- [ ]` box with ≥40 chars of boilerplate passes A3/A4). Closing
//   that gap is irreducibly a human/DoD-audit concern — the DoD audit's job, not this structural
//   gate's. This is an explicit, accepted limitation, NOT an oversight.
//
//   Verdict: applicable && no failures → "PASS"; applicable && >=1 failure → "FAIL"; !applicable →
//   "N/A-legacy" (results = []). Every task produces EXACTLY ONE of {PASS, FAIL, N/A-legacy} — no
//   silent-skip path exists anywhere.
//
//   Boundary-divergence note (B3): the authoring sources stamp `extra.schema:"v1"`. it0-dod-check.mjs
//   Clause 8 still gates on `milestone:M<N>`>=40. These are two INTENTIONALLY-independent boundaries
//   (a marker-based one covering both kinds, a milestone-number one for milestone tasks) — NOT two
//   copies of the assertion logic (checkTask is the single definition; Clause 8 shares only
//   extractSection). A file can be Clause-8-applicable but schema-N/A, or vice-versa; that is
//   accepted, documented here, and does not fork the checks.

const STATUS_WORDS = "pending|resolved|deferred|applied|rejected";

// ── extractSection — reused VERBATIM from it0-dod-check.mjs (moved here, then re-imported there). ──
// Depth-aware: match the heading line, capture its `#` depth, stop the body at the next line whose
// heading is at the SAME OR SHALLOWER depth (so a `## X` section extends through its nested `### `
// subheadings and stops only at the next `## ` or shallower — never silently truncated).
export function extractSection(fullText, heading) {
  const headingLineRe = new RegExp(`^(##+)\\s*${heading}\\s*$`, "im");
  const headingMatch = fullText.match(headingLineRe);
  if (!headingMatch) return null;
  const depth = headingMatch[1].length;
  const startIdx = headingMatch.index + headingMatch[0].length;
  const rest = fullText.slice(startIdx);
  const stopRe = new RegExp(`^#{1,${depth}}\\s`, "m");
  const stopMatch = rest.match(stopRe);
  return stopMatch ? rest.slice(0, stopMatch.index) : rest;
}

// ── parseTask — lenient YAML frontmatter parse (enough to read labels[] + extra.{schema,dirFile}). ─
// Splits on the first two `---` fences. Returns { labels, extra, frontmatterRaw, body }. Does NOT
// pull in a YAML dependency (the store's frontmatter is simple block-scalar/flow); parses labels as
// either a `- item` block list or a `[a, b]` flow list, and reads the `extra:` block's scalar keys.
export function parseTask(fullText) {
  const fmMatch = fullText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { labels: [], extra: {}, frontmatterRaw: "", body: fullText };
  }
  const frontmatterRaw = fmMatch[1];
  const body = fmMatch[2];

  // labels: block list (`labels:\n  - a\n  - b`) OR flow list (`labels: [a, b]`).
  const labels = [];
  const flowMatch = frontmatterRaw.match(/^labels:\s*\[([^\]]*)\]\s*$/m);
  if (flowMatch) {
    for (const raw of flowMatch[1].split(",")) {
      const v = raw.trim().replace(/^["']|["']$/g, "");
      if (v) labels.push(v);
    }
  } else {
    const lines = frontmatterRaw.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^labels:\s*$/.test(l));
    if (idx >= 0) {
      for (let i = idx + 1; i < lines.length; i++) {
        const m = lines[i].match(/^\s+-\s+(.+?)\s*$/);
        if (m) labels.push(m[1].replace(/^["']|["']$/g, ""));
        else if (/^\S/.test(lines[i])) break; // next top-level key ends the list
      }
    }
  }

  // extra: block — read its indented scalar keys (`  key: value`). Enough for schema/dirFile/dirStatus.
  const extra = {};
  const eLines = frontmatterRaw.split(/\r?\n/);
  const eIdx = eLines.findIndex((l) => /^extra:\s*$/.test(l));
  if (eIdx >= 0) {
    for (let i = eIdx + 1; i < eLines.length; i++) {
      if (/^\S/.test(eLines[i])) break; // dedent → end of extra block
      const m = eLines[i].match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
      if (m) {
        let v = m[2].trim().replace(/^["']|["']$/g, "");
        extra[m[1]] = v;
      }
    }
  } else {
    // inline flow: `extra: { schema: "v1", ... }`
    const inline = frontmatterRaw.match(/^extra:\s*\{([^}]*)\}\s*$/m);
    if (inline) {
      for (const pair of inline[1].split(",")) {
        const m = pair.match(/\s*([A-Za-z0-9_]+)\s*:\s*(.+?)\s*$/);
        if (m) extra[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }

  return { labels, extra, frontmatterRaw, body };
}

// ── Marker read (canonical grandfather boundary). ─────────────────────────────────────────────────
export function hasSchemaMarker(task) {
  return task.extra && task.extra.schema === "v1";
}

// ── Kind classification (label-aware). ────────────────────────────────────────────────────────────
// DIR-122: `gap` is checked BEFORE `milestone-candidate` because a well-formed gap/defect task
// commonly carries BOTH labels (e.g. `labels: [gap, defect, milestone-candidate]`) once it's
// SELECTed for a milestone — the lighter, gap-proportionate assertion set must still apply to it,
// not the heavier milestone-candidate one (which would wrongly demand a full `## Proposal`).
export function classifyKind(task) {
  const labels = task.labels || [];
  if (labels.includes("directive")) return "directive";
  if (labels.includes("gap")) return "gap";
  if (labels.includes("milestone-candidate")) return "milestone-candidate";
  return "other";
}

// NOTE: ADRs are NOT tasks and are NOT validated here. They are a first-class quay
// object kind (packages/quay-native/src/adr-store.js — decision lifecycle, its own
// store under adr/), reached via the Provider ABI. An earlier stopgap added a
// `kind=adr` branch to THIS task validator (ADRs-as-label:adr-tasks); that conflation
// was retired when the first-class ADR kind landed (E1). Do not re-add it — an ADR
// is never a task.

// ── Assertion A1: Proposal present and non-placeholder. ───────────────────────────────────────────
export function checkProposal(task) {
  const sec = extractSection(task.body, "Proposal");
  if (sec === null) {
    return { ok: false, code: "proposal-missing", message: "no '## Proposal' section found in the task body" };
  }
  const trimmed = sec.trim();
  const placeholderRe = /^\s*(TBD|TODO|N\/A|xxx|\.\.\.)?\s*$/i;
  if (placeholderRe.test(trimmed) || trimmed.length < 40) {
    return { ok: false, code: "proposal-placeholder", message: "'## Proposal' is empty/placeholder-only (needs real approach text, not a stub)" };
  }
  return { ok: true, code: "proposal-present", message: `'## Proposal' present (${trimmed.length} chars)` };
}

// ── Assertion A2: Plan requirement (label-aware). ─────────────────────────────────────────────────
// Well-formedness (naRe + docs/plans path) reuses it0-dod-check.mjs Clause 8's exact rule.
export function checkPlan(task, kind) {
  const sec = extractSection(task.body, "Plan");
  if (sec === null) {
    if (kind === "directive" || kind === "gap") {
      return { ok: true, code: "plan-absent-ok", message: `'## Plan' absent — allowed for kind=${kind}` };
    }
    return { ok: false, code: "plan-required-for-milestone", message: `'## Plan' required for kind=${kind} but not found` };
  }
  const body = sec.trim();
  const naRe = /^\s*N\/A\s*[—\-:]\s*\S+/i;
  const planPathMatches = [...body.matchAll(/docs\/plans\/[A-Za-z0-9._\/-]*\.md/g)].map((m) => m[0]);
  if (planPathMatches.length > 0 || naRe.test(body)) {
    return { ok: true, code: "plan-wellformed", message: "'## Plan' well-formed (N/A-with-reason or docs/plans/*.md ref)" };
  }
  return { ok: false, code: "plan-malformed", message: "'## Plan' present but neither 'N/A — <reason>' nor a docs/plans/*.md reference" };
}

// ── Assertion A3: Acceptance Criteria is a GFM checklist. ─────────────────────────────────────────
// Reuses it0-dod-check.mjs Clause 0's exact checklist-box regexes (box detection, not prose).
const UNCHECKED_BOX_RE = /^\s*[-*]\s+\[\s\]\s+(\S.*)$/;
const CHECKED_BOX_RE = /^\s*[-*]\s+\[[xX]\]\s+(\S.*)$/;

// Exported (DIR-117 iteration-2 item 3): milestone-preparation-check.ts's structural Plan
// validation reuses this SAME box-counting logic to derive a task's real AC-item count — never a
// second, drift-prone reimplementation of the checklist-box regexes.
export function countBoxes(sectionBody) {
  const lines = sectionBody.split(/\r?\n/);
  const unchecked = lines.filter((l) => UNCHECKED_BOX_RE.test(l)).length;
  const checked = lines.filter((l) => CHECKED_BOX_RE.test(l)).length;
  return { unchecked, checked, total: unchecked + checked };
}

export function checkAcceptanceChecklist(task) {
  const sec = extractSection(task.body, "Acceptance Criteria");
  if (sec === null) {
    return { ok: false, code: "ac-missing", message: "no '## Acceptance Criteria' section found" };
  }
  const { total } = countBoxes(sec);
  if (total === 0) {
    return { ok: false, code: "ac-not-checklist", message: "'## Acceptance Criteria' is prose, not a GFM checklist (needs >=1 `- [ ]`/`- [x]` box)" };
  }
  return { ok: true, code: "ac-checklist", message: `'## Acceptance Criteria' is a checklist (${total} box(es))` };
}

// ── Assertion A4: Definition of Done is a GFM checklist referencing the standard clauses. ─────────
export function checkDodChecklist(task) {
  const sec = extractSection(task.body, "Definition of Done");
  if (sec === null) {
    return { ok: false, code: "dod-missing", message: "no '## Definition of Done' section found" };
  }
  const { total } = countBoxes(sec);
  if (total === 0) {
    return { ok: false, code: "dod-not-checklist", message: "'## Definition of Done' is prose, not a GFM checklist (needs >=1 `- [ ]`/`- [x]` box)" };
  }
  const dodRefRe = /(standard|inherited-core|five clauses|clause\s*[0-9]|meta-enforcer)/i;
  if (!dodRefRe.test(sec)) {
    return { ok: false, code: "dod-no-standard-ref", message: "'## Definition of Done' does not reference the standard DoD (inherited-core / the standard clauses)" };
  }
  return { ok: true, code: "dod-checklist", message: `'## Definition of Done' is a checklist referencing the standard (${total} box(es))` };
}

// ── Assertion A5: Resolution — forbids dup / empty-placeholder / bare-status-mirror shapes. ───────
export function checkResolution(task) {
  const body = task.body;
  const headingCount = (body.match(/^##\s+Resolution\s*$/gim) || []).length;
  if (headingCount > 1) {
    return { ok: false, code: "resolution-duplicate", message: `${headingCount} '## Resolution' headings found (exactly one, or none, allowed)` };
  }
  if (headingCount === 0) {
    return { ok: true, code: "resolution-absent-ok", message: "no '## Resolution' section (not-yet-resolved is fine)" };
  }
  const sec = extractSection(body, "Resolution") || "";
  const stripped = sec.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (stripped.length === 0) {
    return { ok: false, code: "resolution-empty", message: "'## Resolution' is empty/placeholder-only (an empty stub like `<!-- filled at close -->` is forbidden)" };
  }
  // Bare status-mirror: a lone `outcome: <status>` (optionally as a `-` bullet) with no substantive
  // evidence. Strip the leading outcome token; if <40 non-ws chars remain AND no evidence keyword
  // anywhere in the section, it is a bare status mirror.
  const outcomeRe = new RegExp(`^\\s*-?\\s*outcome:\\s*(${STATUS_WORDS})\\b`, "im");
  if (outcomeRe.test(stripped)) {
    const withoutOutcome = stripped.replace(outcomeRe, "").replace(/[-\s]/g, "");
    const hasEvidence = /\b(evidence|audit|diffstat|net\s*-?\d|round-trip|verified|renders?|commit|PR-\d|log|GateEvent)\b/i.test(stripped);
    if (withoutOutcome.length < 40 && !hasEvidence) {
      return { ok: false, code: "resolution-status-mirror", message: "'## Resolution' is a bare status mirror (a lone `outcome: <status>` with no evidence) — evidence belongs in `## Execution record` or folded into a real Resolution" };
    }
  }
  return { ok: true, code: "resolution-wellformed", message: "'## Resolution' present with substantive content" };
}

// ── Assertion A6: No projection scaffolding (false-positive-safe). ───────────────────────────────
const SOURCE_SCAFFOLD_RE = /^Source:\s*`experiments\//m;
// Status-mirror scaffolding: a WHOLE line that is `Status mirror:` followed only by a status word
// (optionally back-ticked). This is the robust form (plan-check must-fix 1): it does NOT fire on
// DIR-009.md:231 (`Status mirror: ` body line). Design the`) or DIR-010.md:121 (`Status mirror: `
// is stuck at `pending` while...`), whose lines end in prose, not a lone status word.
const STATUS_MIRROR_RE = new RegExp(`^Status mirror:\\s*\`?(${STATUS_WORDS})\`?\\s*$`, "im");

export function checkNoScaffolding(task) {
  const hits = [];
  const srcMatch = task.body.match(SOURCE_SCAFFOLD_RE);
  if (srcMatch) hits.push({ code: "scaffolding-source-line", what: `leading Source-line: "${srcMatch[0].trim()}…"` });
  if (task.extra && typeof task.extra.dirFile !== "undefined") {
    hits.push({ code: "scaffolding-dirfile", what: `frontmatter extra.dirFile: "${task.extra.dirFile}"` });
  }
  const smMatch = task.body.match(STATUS_MIRROR_RE);
  if (smMatch) hits.push({ code: "scaffolding-status-mirror", what: `Status-mirror line: "${smMatch[0].trim()}"` });

  if (hits.length === 0) {
    return { ok: true, code: "no-scaffolding", message: "no projection scaffolding (no Source: line, no extra.dirFile, no Status mirror: line)" };
  }
  // Report the first hit's code but name ALL that fired in the message.
  return { ok: false, code: hits[0].code, message: `projection scaffolding present — ${hits.map((h) => h.what).join("; ")}` };
}

// ── Assertion A7: Directive sections — Finding + Requested action required for directive kind. ────
// The /quay-directive authoring template mandates both `## Finding` and `## Requested action`.
// For milestone-candidate/other kinds, this assertion is vacuously skipped (returns ok:true).
export function checkDirectiveSections(task, kind) {
  if (kind !== "directive") {
    return { ok: true, code: "directive-sections-na", message: `kind=${kind}: A7 directive-sections check not applicable` };
  }
  const findingSec = extractSection(task.body, "Finding");
  const requestedSec = extractSection(task.body, "Requested action");
  const missing = [];
  if (findingSec === null) missing.push("'## Finding'");
  if (requestedSec === null) missing.push("'## Requested action'");
  if (missing.length > 0) {
    return { ok: false, code: "directive-sections-missing", message: `directive task is missing required section(s): ${missing.join(", ")} (required by the /quay-directive authoring template)` };
  }
  return { ok: true, code: "directive-sections-present", message: "'## Finding' and '## Requested action' both present" };
}

// ── Assertion set B (kind=gap only, DIR-122): a lightweight tier proportionate to a gap task's
// typical size. `## Finding` plays the role `## Proposal` plays for directives (problem framing +
// root cause — already the de facto convention every well-formed gap task follows); `## Requested
// action` plays the role a Proposal's "chosen mechanism" plays. No dual-author/adjudication/
// multi-round Plan-check machinery — that stays DIR-117's directive-class domain.
import { checkWiringCoverage } from "./wiring-coverage-check.ts";

export function checkGapFinding(task) {
  const sec = extractSection(task.body, "Finding");
  if (sec === null) {
    return { ok: false, code: "gap-finding-missing", message: "no '## Finding' section found (plays the role '## Proposal' plays for directives — problem framing + root cause)" };
  }
  const trimmed = sec.trim();
  if (trimmed.length < 40) {
    return { ok: false, code: "gap-finding-placeholder", message: "'## Finding' is empty/placeholder-only (needs real problem framing + root cause, not a stub)" };
  }
  return { ok: true, code: "gap-finding-present", message: `'## Finding' present (${trimmed.length} chars)` };
}

export function checkGapRequestedAction(task) {
  const sec = extractSection(task.body, "Requested action");
  if (sec === null) {
    return { ok: false, code: "gap-requested-action-missing", message: "no '## Requested action' section found (plays the role a Proposal's chosen mechanism plays)" };
  }
  const trimmed = sec.trim();
  if (trimmed.length < 40) {
    return { ok: false, code: "gap-requested-action-placeholder", message: "'## Requested action' is empty/placeholder-only (needs a real chosen mechanism, not a stub)" };
  }
  return { ok: true, code: "gap-requested-action-present", message: `'## Requested action' present (${trimmed.length} chars)` };
}

// Mechanism-claim wiring coverage, applied to `## Requested action` (the gap-task analogue of
// DIR-117's `## Proposal`-side check) — SAME underlying implementation
// (wiring-coverage-check.ts), different source section, per DIR-122's own AC ("does not weaken or
// duplicate DIR-117's check — the two share the same underlying concept/implementation applied to
// different sections").
export function checkGapWiringCoverage(task) {
  const requestedAction = extractSection(task.body, "Requested action") || "";
  const ac = extractSection(task.body, "Acceptance Criteria") || "";
  return checkWiringCoverage(requestedAction, ac);
}

// ── Assertion A8: Touches declaration — must be present & well-formed on execution-type tasks. ──────
// Import isOverbroadDeclaration from the single-source module (ADR-004).
import { isOverbroadDeclaration } from "./touches-orthogonality-check.ts";
// SINGLE-SOURCE (gap-task-body-has-n-parsers-and-no-authority): the ONE Touches bullet parser.
// The validator's glob extraction delegates here too — there is no separate inline parse.
import { parseTouchEntries } from "./touches-parser.ts";

// TYPE_EXEC_RE matches a `type: execution` line in the charter body (same regex as
// concurrent-batch-scheduler.ts's parseCandidate, for determinism).
const TYPE_EXEC_RE = /^\s*\*{0,2}type\*{0,2}\s*:\s*\*{0,2}\s*`?execution`?/im;

export function checkTouches(task, kind) {
  // Read type from body text (charter convention: `type: execution`).
  const isExec = TYPE_EXEC_RE.test(task.body);
  const sec = extractSection(task.body, "Touches");
  if (!isExec) {
    // DIR-113 item 2: a milestone-candidate task (not a charter — charters use `isExec` above)
    // with NEITHER a manually-declared NOR an auto-derived `## Touches` section gets a SOFT
    // (warn, non-blocking) note — select-preflight.ts's pre-charter orthogonality pass (DIR-113
    // item 3) has nothing to work with for this candidate until one exists. Both manual and
    // auto-derived declarations render the same `## Touches` heading (auto-derived is
    // distinguished only by an "(auto-derived, unverified…)" annotation in the body, per
    // derive-touches-heuristic.ts's renderTouchesSection) — so "heading absent" correctly covers
    // "neither kind present" without needing to parse the annotation.
    if ((kind === "milestone-candidate" || kind === "gap") && sec === null) {
      return {
        ok: true,
        code: "touches-absent-milestone-candidate",
        message: `INFO: ${kind} task has no '## Touches' (manual or auto-derived) — the pre-charter orthogonality scheduler has no hint for this candidate and will treat it conservatively`,
      };
    }
    // Non-execution types (learning, methodology, discovery, etc.): skip vacuously.
    return { ok: true, code: "touches-na", message: "type is not execution — ## Touches check not applicable" };
  }
  if (sec === null) {
    // INFO only — execution-type task without ## Touches can still run serial.
    return { ok: true, code: "touches-absent-info", message: "INFO: type:execution but no '## Touches' section — task can run serial but CANNOT be batched concurrently" };
  }
  // Parse glob lines from the ## Touches section (bullet list: `- <glob>` or `* <glob>`).
  // SINGLE-SOURCE: parseTouchEntries is the ONE shared Touches bullet parser — the validator does
  // NOT carry its own copy. The old inline parse only stripped backticks when BOTH ends were
  // backticked, so `` - `foo.ts` (new) `` stayed a single weird glob `"`foo.ts` (new)"`; the shared
  // parser strips quotes/backticks before AND after the trailing "(…)" annotation strip.
  const globs = parseTouchEntries(sec);
  if (globs.length === 0) {
    return { ok: false, code: "touches-empty", message: "## Touches section is present but has zero non-empty glob lines — ill-formed (add concrete paths or remove the section)", globs };
  }
  // Validate each glob: no overbroad declarations.
  const overbroad = globs.filter((g) => isOverbroadDeclaration(g));
  if (overbroad.length > 0) {
    return { ok: false, code: "touches-overbroad", message: `## Touches has overbroad glob(s): ${overbroad.map((g) => `"${g}"`).join(", ")} — need >=2 concrete leading path segments before any wildcard, or an exact path`, globs };
  }
  // Validate no empty-expansion globs (globs ending in `/` with no wildcard resolve to nothing).
  const dubious = globs.filter((g) => g.endsWith("/") && !/[?*]/.test(g));
  if (dubious.length > 0) {
    return { ok: false, code: "touches-dubious", message: `## Touches has dubious glob(s): ${dubious.map((g) => `"${g}"`).join(", ")} — trailing-slash without wildcard may expand to nothing (likely a typo)`, globs };
  }
  return { ok: true, code: "touches-wellformed", message: `## Touches well-formed with ${globs.length} glob(s)`, globs };
}

// ── Assertion A11 (REPORT-ONLY): no non-bullet content inside `## Touches` ──────────────────────────
// DIR-124-F1's claim, softened to report-only this window (AC6, gap-task-body-has-n-parsers-and-
// no-authority): content inside the `## Touches` section that is NOT a bullet entry (prose,
// grounded facts, an illustrative fenced block, a stray horizontal rule) sits where a Touches
// parser will either ignore it or — worse — misread it as a Touches entry. repo-ground-truth.md
// §3 already grounds the fact: "Content appended AFTER `## Touches` is parsed as Touches entries
// and can trip touches-overbroad — grounded facts must live in `## Finding`, never after
// `## Touches`." This check REPORTS such content (a finding, never a FAIL); blocking is deferred
// to the next window, with the shrink-only violator list (plugin/touches-post-content-violators.txt)
// as the ratchet baseline.
export function checkTouchesPostContent(task) {
  const sec = extractSection(task.body, "Touches");
  const findings = [];
  if (sec === null) {
    return { ok: true, code: "touches-post-content-na", message: "no '## Touches' section — post-content check not applicable", findings };
  }
  const bad = [];
  for (const raw of sec.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-*]\s+/.test(line)) continue;   // a Touches bullet
    if (/^#{1,6}\s/.test(line)) continue;  // a (nested) heading
    bad.push(line);
  }
  if (bad.length > 0) {
    findings.push({
      code: "touches-post-content",
      what: `non-bullet content inside '## Touches': ${bad.map((l) => JSON.stringify(l.length > 60 ? `${l.slice(0, 60)}…` : l)).join(", ")} — grounded facts/prose belong in '## Finding', never after '## Touches'`,
    });
  }
  return {
    ok: true,
    code: bad.length > 0 ? "touches-post-content-report" : "touches-post-content-clean",
    message: bad.length > 0 ? `INFO: '## Touches' has ${bad.length} non-bullet content line(s) — see findings (report-only this window)` : "no non-bullet content inside '## Touches'",
    findings,
  };
}

// ── extractSectionFenceAware — like extractSection, but ignores headings INSIDE fenced code blocks. ──
// Needed for ## Contract / ## Dispatch review: a task body may illustrate the format inside a ``` fence
// (the gap-dispatch-gate task's own Chosen mechanism does) and that MUST NOT be read as a real section.
// A real section's heading sits at column 0 outside any fence; the resource-awareness task's real
// ## Contract has its ENTRIES fenced but its heading outside — both cases are handled here.
export function extractSectionFenceAware(fullText, heading) {
  const headingLineRe = new RegExp(`^(##+)\\s*${heading}\\s*$`, "im");
  const lines = fullText.split(/\r?\n/);
  let inFence = false;
  let startIdx = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
    if (!inFence) {
      const m = lines[i].match(headingLineRe);
      if (m) { startIdx = i; depth = m[1].length; break; }
    }
  }
  if (startIdx === -1) return null;
  const out = [];
  inFence = false;
  const stopRe = new RegExp(`^#{1,${depth}}\\s`);
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; out.push(lines[i]); continue; }
    if (!inFence && stopRe.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

// ── Assertions A9/A10: ## Contract + ## Dispatch review (gap-dispatch-gate-has-no-checklist-and-no-trace) ──
// The dispatch gate's five verbal questions become a machine-readable `## Contract` block written at
// task-creation time. Six keys, each traceable to a real dispatch intervention (2026-08-02/03); the
// key set is NOT extended beyond that evidence (ADR-021: don't mechanize strategy without evidence).
// `n/a: <reason>` is a legal value for EVERY key; a blank value is not (blank is indistinguishable
// from "never thought about it" — same principle as `reviewer: none`). The syntax is DEFINED here
// (the schema), but ENFORCEMENT is REPORT-ONLY in the initial ratchet — a malformed contract is a
// finding, never a schema FAIL (the dispatch gate must not block; the violation list can only shrink;
// see task-contract-check.ts for the consumer-side judgments).
export const CONTRACT_KEYS = ["measure", "band", "invariant", "invoke", "control", "resume"];

// Strip a trailing `# comment` only outside backtick spans (a `#` inside `…` is part of the command).
export function stripCommentOutsideBackticks(raw) {
  const parts = raw.split("`");
  const out = parts.map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/\s+#.*$/, "")));
  return out.join("`").trim();
}

// Parse the `## Contract` section into structured entries. The showcase format wraps the entries in a
// fenced code block (gap-no-resource-awareness-heavy-ops-run-blind.md); both fenced and bare lines are
// accepted. A trailing `# comment` is stripped. Each entry: { key, name, value, na, naReason, raw }.
//   - measure/band/invariant: `KEY <name> = <value>` (invariant MAY be a bare statement without `=`).
//   - invoke/control/resume: `KEY <value>` (invoke MUST be a backtick command).
//   - every key: `KEY n/a: <reason>` is legal.
export function parseContract(body) {
  const sec = extractSectionFenceAware(body, "Contract");
  if (sec === null) return { present: false, entries: [] };
  let text = sec.trim();
  const fenceMatch = text.match(/^```[A-Za-z0-9_-]*\r?\n([\s\S]*?)\r?\n```\s*$/);
  if (fenceMatch) text = fenceMatch[1];
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    if (/^#/.test(raw)) continue; // comment-only line
    // Strip a trailing `# comment` ONLY when the `#` is outside a backtick span — a `#` inside a
    // backtick command (e.g. `echo a # b`, `grep '#pragma'`) is part of the command, not a comment.
    const noComment = stripCommentOutsideBackticks(raw);
    const m = noComment.match(/^(measure|band|invariant|invoke|control|resume)\s+(.+)$/);
    if (!m) {
      entries.push({ key: null, name: null, value: null, na: false, naReason: null, raw });
      continue;
    }
    const key = m[1];
    const rest = m[2].trim();
    // `n/a: <reason>` (or `n/a：<reason>`) is the legal empty-form. A colon-less bare `n/a` is treated
    // the same. The reason may be EMPTY — an `n/a` with no reason is indistinguishable from
    // "never thought about it", so na:true + empty naReason lets checkContractSyntax report it.
    const naMatch = rest.match(/^n\/a\s*[:：]?\s*(.*)$/i);
    if (naMatch) {
      entries.push({ key, name: null, value: null, na: true, naReason: naMatch[1].trim(), raw });
      continue;
    }
    if (key === "measure" || key === "band" || key === "invariant") {
      const eq = rest.indexOf("=");
      if (eq >= 0) {
        entries.push({ key, name: rest.slice(0, eq).trim(), value: rest.slice(eq + 1).trim(), na: false, naReason: null, raw });
      } else {
        entries.push({ key, name: null, value: rest, na: false, naReason: null, raw });
      }
    } else {
      entries.push({ key, name: null, value: rest, na: false, naReason: null, raw });
    }
  }
  return { present: true, entries };
}

// Syntax check for the `## Contract` section (A9). REPORT-ONLY: `ok` is always true; every problem is
// a finding. A missing section is an INFO finding (the pre-ratchet baseline — most of the store has
// none yet). Present-but-malformed is reported, never a FAIL.
export function checkContractSyntax(task) {
  const { present, entries } = parseContract(task.body);
  const findings = [];
  if (!present) {
    return {
      ok: true,
      code: "contract-absent-info",
      message: "INFO: no '## Contract' section — add one for a machine-readable goal↔code contract (measure/band/invariant/invoke/control/resume; `n/a: <reason>` legal, blank not)",
      findings: [],
    };
  }
  for (const e of entries) {
    if (e.key === null) {
      findings.push({ code: "contract-line-unknown", what: `line does not start with a known key (${CONTRACT_KEYS.join("|")}): "${e.raw}"` });
      continue;
    }
    if (e.na) {
      if (!e.naReason) {
        findings.push({ code: "contract-empty-value", what: `"${e.key}" present but empty — write a value or "n/a: <reason>" (blank is indistinguishable from never thought about it)` });
      }
      continue;
    }
    if (e.value === null || e.value === "") {
      findings.push({ code: "contract-empty-value", what: `"${e.key}" present but empty — write a value or "n/a: <reason>"` });
      continue;
    }
    if ((e.key === "measure" || e.key === "band") && !e.name) {
      findings.push({ code: "contract-measure-no-name", what: `"${e.key}" must declare a NAME (referenced by AC items): "${e.raw}"` });
    }
    if (e.key === "invoke" && !/`/.test(e.value)) {
      findings.push({ code: "contract-invoke-not-command", what: `"invoke" must be a backtick command: "${e.raw}"` });
    }
  }
  return { ok: true, code: "contract-syntax", message: `'## Contract' present (${entries.length} entry/entries)`, findings };
}

// Format check for the `## Dispatch review` section (A10). REPORT-ONLY. `reviewer: none` is legal —
// not every task needs a gate, but "no gate" must be a recorded choice. Missing section → finding.
// Format:
//   ## Dispatch review
//   reviewer: outer | none
//   at: <ISO>
//   changed: <逐条改动，无则「无」>
export function checkDispatchReview(task) {
  const sec = extractSectionFenceAware(task.body, "Dispatch review");
  const findings = [];
  if (sec === null) {
    return {
      ok: true,
      code: "dispatch-review-absent-info",
      message: "INFO: no '## Dispatch review' section — record who reviewed the dispatch and what changed (reviewer: outer|none; at: <ISO>; changed: <list> or 无)",
      findings: [{ code: "dispatch-review-missing", what: "no '## Dispatch review' section" }],
    };
  }
  const lines = sec.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#/.test(l));
  const valOf = (line, re) => (line && line.match(re) ? line.replace(re, "").trim() : "");
  const reviewer = valOf(lines.find((l) => /^reviewer\s*[:：]/.test(l)), /^reviewer\s*[:：]\s*/);
  const at = valOf(lines.find((l) => /^at\s*[:：]/.test(l)), /^at\s*[:：]\s*/);
  const changed = valOf(lines.find((l) => /^changed\s*[:：]/.test(l)), /^changed\s*[:：]\s*/);
  if (!reviewer) {
    findings.push({ code: "dispatch-review-malformed", what: "'## Dispatch review' is missing a non-empty `reviewer:` line (reviewer: outer | none)" });
  } else if (!/^(outer|none|human|inner)$/.test(reviewer)) {
    // AC3 defines the reviewer as outer|none; other actor values are not part of the gate format.
    findings.push({ code: "dispatch-review-malformed", what: `'## Dispatch review' reviewer must be one of outer|none|human|inner, got "${reviewer}"` });
  }
  if (!at) {
    findings.push({ code: "dispatch-review-malformed", what: "'## Dispatch review' is missing a non-empty `at:` line (ISO timestamp)" });
  } else if (!/^\d{4}-\d{2}-\d{2}/.test(at)) {
    findings.push({ code: "dispatch-review-malformed", what: `'## Dispatch review' at: must be an ISO-like date (YYYY-MM-DD…), got "${at}"` });
  }
  if (!changed) {
    findings.push({ code: "dispatch-review-malformed", what: "'## Dispatch review' is missing a non-empty `changed:` line (逐条改动；无则写「无」)" });
  }
  return { ok: true, code: "dispatch-review-present", message: "'## Dispatch review' present", findings };
}

// ── checkTask — the SINGLE entry point both callers use. ──────────────────────────────────────────
export function checkTask(fullText) {
  const task = parseTask(fullText);
  const marker = hasSchemaMarker(task);
  const kind = classifyKind(task);
  if (!marker) {
    return { marker: false, kind, applicable: false, results: [], verdict: "N/A-legacy", failures: [], warnings: [], findings: [] };
  }
  // DIR-122: kind=gap runs the lightweight tier (checkGapFinding/checkGapRequestedAction/
  // checkGapWiringCoverage in place of checkProposal/checkDirectiveSections) — a proportionately
  // smaller assertion set than directive/milestone-candidate/other, not the SAME set relaxed.
  // A9/A10 (Contract syntax + Dispatch review format) are REPORT-ONLY — they join the results but are
  // ok:true by construction and only contribute `findings`, never a FAIL (the dispatch gate must not
  // block; the violation list can only shrink).
  const contract = checkContractSyntax(task);
  const dispatchReview = checkDispatchReview(task);
  const touchesPostContent = checkTouchesPostContent(task);
  const results = kind === "gap"
    ? [
        checkGapFinding(task),
        checkPlan(task, kind),
        checkAcceptanceChecklist(task),
        checkDodChecklist(task),
        checkResolution(task),
        checkNoScaffolding(task),
        checkGapRequestedAction(task),
        checkGapWiringCoverage(task),
        checkTouches(task, kind),
        touchesPostContent,
        contract,
        dispatchReview,
      ]
    : [
        checkProposal(task),
        checkPlan(task, kind),
        checkAcceptanceChecklist(task),
        checkDodChecklist(task),
        checkResolution(task),
        checkNoScaffolding(task),
        checkDirectiveSections(task, kind),
        checkTouches(task, kind),
        touchesPostContent,
        contract,
        dispatchReview,
      ];
  const failures = results.filter((r) => !r.ok);
  const warnings = results.filter((r) => r.code === "touches-absent-info" || r.code === "touches-absent-milestone-candidate");
  const findings = [...contract.findings, ...dispatchReview.findings, ...touchesPostContent.findings];
  return {
    marker: true,
    kind,
    applicable: true,
    results,
    failures,
    warnings,
    findings,
    verdict: failures.length === 0 ? "PASS" : "FAIL",
  };
}
