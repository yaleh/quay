// wiring-coverage-check.mjs — mechanism-claim wiring coverage check (canonical-task-schema unit,
// DIR-117/DIR-122 shared module). Both directives require the SAME underlying concept applied to
// different sections: DIR-117 applies it to a directive's `## Proposal` (via task-schema.ts's
// checkDirectiveSections/preparation-review path), DIR-122 applies it to a `kind=gap` task's
// `## Requested action` (via task-schema.ts's checkGapSections). This module is the ONE
// implementation both callers share — per DIR-122's own AC ("does not weaken or duplicate DIR-117's
// ... check — the two share the same underlying concept/implementation applied to different
// sections").
//
// Heuristic (mechanical, not NLP — deliberately narrow, see NON-GOAL below): a "claim" is a
// sentence in the source section that (a) contains a wiring verb (invokes/calls/dispatches/
// enforces/wires/owns/routes/delegates, singular or plural) and (b) mentions >=2 distinct
// backtick-quoted code identifiers (`` `foo.ts` ``, `` `Bar` ``, `` `bar()` ``, ...) — the
// convention this repo's own Proposal/Requested-action prose already uses heavily when naming a
// real call/dispatch/ownership/enforcement relationship between two named components. The claim's
// "key" is the set of those identifiers.
//
// A claim is COVERED iff at least one `## Acceptance Criteria` checklist bullet (continuation
// lines joined) contains ALL of the claim's identifiers AND an evidence-requiring keyword (real /
// production / callsite / reachability / evidence / wired / confirmed / reproduc* / verified /
// proven). An uncovered claim is a real finding, not a stylistic nit (both directives require
// this to be a genuine mechanically-checkable failure mode).
//
// NON-GOAL: this cannot detect a mechanism claim phrased entirely in prose with no backtick
// identifiers (e.g. "the scheduler now talks to the reconciler") — closing that gap would require
// real NLP relation extraction, which both directives' Proposal/Requested-action text does not
// currently need because this repo's own authoring convention already names components in
// backticks. This is an explicit, accepted limitation of a mechanical gate, not an oversight (same
// posture as task-schema.ts's own documented NON-GOAL for semantic emptiness).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// `owns?` intentionally excludes the ubiquitous possessive-determiner usage ("the task's own AC
// section", "its own merits") via a negative lookbehind on `'s `/`s' `/a possessive pronoun
// immediately before the word — this repo's own authoring convention (CLAUDE.md and every task
// body) uses "X's own Y" constantly for cross-referencing, which is NOT an ownership-verb claim
// ("component X owns Y") and must not be treated as one. Confirmed real recurring false-positive
// source (gap-wiring-coverage-check-owns-false-positive, M198/DIR-119-D1): every one of 5
// mechanically-flagged "uncovered claims" against DIR-119-D1's Proposal traced to this single word.
// Considered adding `imports?|reuses?|reused|parses?|parsed` (M201/DIR-126-B, real "X imports Y
// from Z" claims currently go unextracted, neither passing nor failing coverage) but REJECTED: a
// live re-run against DIR-126-A's and DIR-119-D1's already-landed, already-audited `## Proposal`
// text showed the wider verb set surfaces multiple NEW uncovered claims on those tasks (sentences
// using "exports"/"maps 1:1 onto" that were never checked against AC coverage when those tasks
// were authored/audited) — reopening DONE, landed work is a worse cost than the narrow gap it
// would close. Left as a known, narrower limitation; the DIR-126-B content gap this would have
// caught is instead closed directly in that task's own AC text.
const WIRING_VERB_RE =
  /\b(invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?)\b|(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b/i;
const EVIDENCE_RE = /\b(real|production|callsite|call site|reachability|reachable|evidence|wired|confirm(?:ed|s|ation)?|reproduc\w*|verifi(?:ed|es|cation)?|proven?|proves?)\b/i;

// Split a paragraph into Markdown-list-aware blocks: a new block starts at every bullet-list line
// (`- `/`* `/`1. ` at the start of a line, allowing leading indentation), so a dense,
// un-blank-lined bullet list (this repo's own authoring convention frequently produces these —
// confirmed real recurrence: M198/DIR-119-D1 and M199/DIR-126-A both hit 13-26 blocking findings
// from exactly this merging, not content, on their first real ProposalReview generation) no longer
// merges multiple distinct wiring claims — one per bullet — into a single giant sentence the
// original punctuation-only splitter treated as one claim. A continuation line under a bullet
// (indented, non-bullet-starting) stays part of that bullet's own block. Text before the first
// bullet in a paragraph is its own block, split further by the existing punctuation rule below —
// this is strictly additive (only ever creates MORE split points, never fewer), so a claim that
// already qualified (>=2 backtick identifiers + a wiring verb) before this fix still qualifies
// after it; it can only ever surface previously-hidden claims a merged sentence obscured, never
// hide one that was already visible.
// Exported (M201/DIR-126-B): `prepare-admission-check.ts`'s new `preflightMergedMarkdownClaims`
// detector reuses this SAME list-aware splitter — never a second, independently-buggy
// implementation of the boundary logic `335317d` already fixed here.
export function splitListAwareBlocks(paragraph) {
  const lines = paragraph.split(/\n/);
  // A GFM table row line ("| cell | cell |") is a bullet-start-equivalent boundary for the same
  // reason a `- `/`* `/`1. ` bullet is (gap-wiring-coverage-check-reuse-verbs-and-tables,
  // M201/DIR-126-B): a real Proposal's own comparison table ("| Code | Class | Reuses |" style,
  // one row per mechanism) merged all its rows into a single giant claim under the pre-fix
  // splitter, hiding per-row wiring claims from independent AC coverage the same way an
  // un-blank-lined bullet list did before 335317d.
  const bulletStart = /^\s*(?:[-*]\s+|\d+\.\s+|\|.*\|\s*$)/;
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (bulletStart.test(line) && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

// Split into sentence-ish chunks: paragraph boundaries first, then Markdown-list-aware blocks
// (above), then sentence-ending punctuation followed by whitespace + an uppercase letter or
// backtick/quote (avoids splitting on "e.g." or "Fig. 2" style abbreviations enough for this
// heuristic's purpose — it does not need to be exact, only good enough to keep two co-occurring
// identifiers in the same claim).
// Exported (M201/DIR-126-B): same reuse rationale as `splitListAwareBlocks` above.
export function splitSentences(text) {
  return text
    .split(/\n{2,}/)
    .flatMap((para) => splitListAwareBlocks(para))
    .flatMap((block) => block.split(/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/))
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Extract every distinct backtick-quoted identifier from a sentence.
function backtickIdentifiers(sentence) {
  const idents = new Set();
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(sentence))) {
    const id = m[1].trim();
    if (id) idents.add(id);
  }
  return [...idents];
}

// ── extractMechanismClaims — find every wiring-verb sentence naming >=2 code identifiers. ────────
export function extractMechanismClaims(sectionText) {
  if (!sectionText) return [];
  const claims = [];
  for (const sentence of splitSentences(sectionText)) {
    if (!WIRING_VERB_RE.test(sentence)) continue;
    const identifiers = backtickIdentifiers(sentence);
    if (identifiers.length >= 2) {
      claims.push({ sentence, identifiers });
    }
  }
  return claims;
}

// ── bulletsOf — GFM checklist bullets from an AC section, continuation lines joined. ─────────────
// A checklist item in this repo's authoring convention commonly wraps across multiple lines (the
// continuation indented under the `- [ ]`/`- [x]` line); join those so an identifier/evidence
// keyword split across lines is still matched as one bullet.
export function bulletsOf(sectionText) {
  if (!sectionText) return [];
  const lines = sectionText.split(/\r?\n/);
  const bullets = [];
  let current = null;
  for (const line of lines) {
    if (/^\s*[-*]\s+\[[ xX]\]\s+\S/.test(line)) {
      if (current !== null) bullets.push(current);
      current = line.trim();
    } else if (current !== null && /^\s+\S/.test(line)) {
      current += " " + line.trim();
    } else if (current !== null && line.trim() === "") {
      // blank line: fall through — a following non-indented, non-bullet line will close it below
    } else if (current !== null && /^\S/.test(line)) {
      bullets.push(current);
      current = null;
    }
  }
  if (current !== null) bullets.push(current);
  return bullets;
}

// ── checkWiringCoverage — the one assertion both callers run. ─────────────────────────────────────
// sourceSectionText: the claim-bearing section's raw text (e.g. task-schema.ts's
//   extractSection(body, "Proposal") or extractSection(body, "Requested action")).
// acSectionText: the task's `## Acceptance Criteria` section raw text.
export function checkWiringCoverage(sourceSectionText, acSectionText) {
  const claims = extractMechanismClaims(sourceSectionText);
  if (claims.length === 0) {
    return {
      ok: true,
      code: "wiring-coverage-none-claimed",
      message: "no mechanism claims (wiring-verb sentence naming >=2 backtick identifiers) found in the source section",
      claims: [],
      uncovered: [],
    };
  }
  const bullets = bulletsOf(acSectionText);
  const uncovered = claims.filter(
    (claim) => !bullets.some((b) => claim.identifiers.every((id) => b.includes(id)) && EVIDENCE_RE.test(b))
  );
  if (uncovered.length > 0) {
    return {
      ok: false,
      code: "wiring-coverage-uncovered",
      message: `${uncovered.length} of ${claims.length} mechanism claim(s) have no matching, evidence-requiring '## Acceptance Criteria' item: ${uncovered
        .map((c) => `"${c.sentence.slice(0, 100)}${c.sentence.length > 100 ? "…" : ""}"`)
        .join("; ")}`,
      claims,
      uncovered,
    };
  }
  return {
    ok: true,
    code: "wiring-coverage-complete",
    message: `all ${claims.length} mechanism claim(s) have a matching, evidence-requiring AC item`,
    claims,
    uncovered: [],
  };
}

// ── CLI main (DIR-117-B/M195) — the grep-confirmable PRODUCTION call site ────────────
// Workflow scripts (prepare-milestone.js) cannot `import` (sandboxed/resumable — the file's own
// no-import convention), so the ProposalReview phase dispatches an agent to run THIS CLI and
// returns the parsed verdict. That is the SAME dispatch pattern the Receipt and Prepared phases
// already use for milestone-preparation-check.ts — no new mechanism class is introduced, and the
// call site stays grep-confirmable in a plain-text workflow file. `checkWiringCoverage()` above
// remains the ONE assertion; this block only adapts its return value to the typed finding-ledger
// shape the workflow already consumes — it does NOT re-implement any claim extraction (DIR-122's
// AC forbids a second implementation).
//
// Usage: node --experimental-strip-types <this-file> --task <path/to/task.md>
// Prints a JSON verdict on stdout:
//   { ok, code, message, claims: [...], findings: [ <one BLOCKING typed ledger finding per uncovered claim> ] }
// The `findings` array is in the exact shape prepare-milestone.js's `_upsertFindings(..., 0)`
// already consumes ({subsystem, summary, severity:"blocker", blocking:true, evidence, claimRef,
// disposition}), so the workflow merges them mechanically: the ProposalReview phase's open-blocking
// count increments by `findings.length` from THIS function's real return value, not an LLM's
// independent judgment. Exit codes: 0 = verdict produced (even when uncovered findings exist — the
// verdict IS the signal); 2 = usage/IO error (no --task, unreadable file) — the workflow fails the
// ProposalReview phase CLOSED on a non-parseable result rather than silently skipping coverage.

// Extract the raw text of one `## <heading>` section (everything up to the next `## ` heading or
// EOF), mirroring the section semantics task-schema.ts's extractSection relies on — kept local and
// minimal here so this module stays dependency-free (the one source both callers share).
function extractSectionForCli(body, heading) {
  const lines = body.split(/\r?\n/);
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headRe = new RegExp(`^##\\s+${escaped}\\s*$`);
  const out = [];
  let inSection = false;
  for (const line of lines) {
    if (headRe.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (inSection) out.push(line);
  }
  return out.join("\n").trim();
}

// Map each uncovered claim to a BLOCKING typed finding in the ledger shape ProposalReview consumes.
function wiringFindingsFromUncovered(uncovered) {
  return (uncovered || []).map((claim, i) => ({
    subsystem: "wiring-coverage",
    summary: `Mechanism claim has no matching, evidence-requiring AC item: "${claim.sentence.slice(0, 120)}${claim.sentence.length > 120 ? "…" : ""}"`,
    severity: "blocker",
    blocking: true,
    evidence: `checkWiringCoverage() returned uncovered claim #${i + 1}; identifiers: ${claim.identifiers.map((id) => "`" + id + "`").join(", ")}`,
    claimRef: claim.identifiers.join("+"),
    disposition: "unresolved",
  }));
}

const _runAsCli = (() => {
  try {
    return (
      typeof process !== "undefined" &&
      Array.isArray(process.argv) &&
      typeof process.argv[1] === "string" &&
      import.meta.url === pathToFileURL(process.argv[1]).href
    );
  } catch {
    return false;
  }
})();

if (_runAsCli) {
  const argv = process.argv.slice(2);
  const taskIdx = argv.indexOf("--task");
  const taskPath = taskIdx >= 0 ? argv[taskIdx + 1] : undefined;
  if (!taskPath) {
    console.error("usage: wiring-coverage-check.ts --task <path/to/task.md>");
    process.exit(2);
  }
  let body;
  try {
    body = readFileSync(taskPath, "utf8");
  } catch (e) {
    console.error(`wiring-coverage-check: cannot read task file ${taskPath}: ${e.message}`);
    process.exit(2);
  }
  const proposalText = extractSectionForCli(body, "Proposal");
  const acText = extractSectionForCli(body, "Acceptance Criteria");
  const verdict = checkWiringCoverage(proposalText, acText);
  const findings = wiringFindingsFromUncovered(verdict.uncovered);
  console.log(
    JSON.stringify(
      { ok: verdict.ok, code: verdict.code, message: verdict.message, claims: verdict.claims, findings },
      null,
      2
    )
  );
  process.exit(0);
}
