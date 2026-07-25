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
export function classifyKind(task) {
  const labels = task.labels || [];
  if (labels.includes("directive")) return "directive";
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
    if (kind === "directive") {
      return { ok: true, code: "plan-absent-directive-ok", message: "'## Plan' absent — allowed for a directive" };
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

function countBoxes(sectionBody) {
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

// ── Assertion A8: Touches declaration — must be present & well-formed on execution-type tasks. ──────
// Import isOverbroadDeclaration from the single-source module (ADR-004).
import { isOverbroadDeclaration } from "./touches-orthogonality-check.ts";

// TYPE_EXEC_RE matches a `type: execution` line in the charter body (same regex as
// concurrent-batch-scheduler.ts's parseCandidate, for determinism).
const TYPE_EXEC_RE = /^\s*\*{0,2}type\*{0,2}\s*:\s*\*{0,2}\s*`?execution`?/im;

export function checkTouches(task) {
  // Read type from body text (charter convention: `type: execution`).
  const isExec = TYPE_EXEC_RE.test(task.body);
  if (!isExec) {
    // Non-execution types (learning, methodology, discovery, etc.): skip vacuously.
    return { ok: true, code: "touches-na", message: "type is not execution — ## Touches check not applicable" };
  }
  const sec = extractSection(task.body, "Touches");
  if (sec === null) {
    // INFO only — execution-type task without ## Touches can still run serial.
    return { ok: true, code: "touches-absent-info", message: "INFO: type:execution but no '## Touches' section — task can run serial but CANNOT be batched concurrently" };
  }
  // Parse glob lines from the ## Touches section (bullet list: `- <glob>` or `* <glob>`).
  const globs = [];
  for (const line of sec.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/);
    if (!m) continue;
    let g = m[1].trim();
    if (g.startsWith("`") && g.endsWith("`")) g = g.slice(1, -1);
    g = g.trim();
    if (g) globs.push(g);
  }
  if (globs.length === 0) {
    return { ok: false, code: "touches-empty", message: "## Touches section is present but has zero non-empty glob lines — ill-formed (add concrete paths or remove the section)" };
  }
  // Validate each glob: no overbroad declarations.
  const overbroad = globs.filter((g) => isOverbroadDeclaration(g));
  if (overbroad.length > 0) {
    return { ok: false, code: "touches-overbroad", message: `## Touches has overbroad glob(s): ${overbroad.map((g) => `"${g}"`).join(", ")} — need >=2 concrete leading path segments before any wildcard, or an exact path` };
  }
  // Validate no empty-expansion globs (globs ending in `/` with no wildcard resolve to nothing).
  const dubious = globs.filter((g) => g.endsWith("/") && !/[?*]/.test(g));
  if (dubious.length > 0) {
    return { ok: false, code: "touches-dubious", message: `## Touches has dubious glob(s): ${dubious.map((g) => `"${g}"`).join(", ")} — trailing-slash without wildcard may expand to nothing (likely a typo)` };
  }
  return { ok: true, code: "touches-wellformed", message: `## Touches well-formed with ${globs.length} glob(s)` };
}

// ── checkTask — the SINGLE entry point both callers use. ──────────────────────────────────────────
export function checkTask(fullText) {
  const task = parseTask(fullText);
  const marker = hasSchemaMarker(task);
  const kind = classifyKind(task);
  if (!marker) {
    return { marker: false, kind, applicable: false, results: [], verdict: "N/A-legacy", failures: [], warnings: [] };
  }
  const results = [
        checkProposal(task),
        checkPlan(task, kind),
        checkAcceptanceChecklist(task),
        checkDodChecklist(task),
        checkResolution(task),
        checkNoScaffolding(task),
        checkDirectiveSections(task, kind),
        checkTouches(task),
      ];
  const failures = results.filter((r) => !r.ok);
  const warnings = results.filter((r) => r.code === "touches-absent-info");
  return {
    marker: true,
    kind,
    applicable: true,
    results,
    failures,
    warnings,
    verdict: failures.length === 0 ? "PASS" : "FAIL",
  };
}
