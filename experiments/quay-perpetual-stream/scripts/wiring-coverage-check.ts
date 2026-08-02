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
// Scope narrowing (gap-wiring-coverage-scope-narrowing, P0 #60): for a `## Proposal` — a section
// structured into `### ` subsections (or `**...**` bold-heading equivalents) — mechanism claims are
// extracted ONLY from the mechanism-bearing subsections: Chosen mechanism, Mechanism-claim wiring
// coverage, Key design decisions, Mechanism-claim → AC coverage, and any `**WIRING-CLAIM (...):**` /
// `**[WIRING CLAIM N — ...]**` explicit claim markers. Problem framing / Finding, Risks, Defaults
// and failure behavior, Compatibility, Alternatives considered, Non-goals, and the `**P1/P2/P3…**`
// finding paragraphs are background/syntax/motivation prose — code references there (e.g. "the
// installed `execute-milestone.js` dispatches `composite-preflight.ts` from `phase('Verify')`",
// naming the PRE-EXISTING wiring being motivated) are NOT mechanism claims and must not be wired-
// checked against AC. Before this narrowing a large Proposal's Problem-framing section full of code
// references produced a `mechanism-inventory-invalid` terminal (the same fingerprint 4161ab22b641
// recurring across A2/A5/DIR-099-B/DIR-124-C). Non-Proposal source sections (`## Requested action`,
// which is flat) still scan the whole section — backward-compatible with DIR-122's gap path.
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
// RC1 (2026-08-01, over-split root cause 1): collapse claims that are the SAME mechanism operation
// repeated across an enumerated boundary/stage list. DIR-124-A1b's "14 mechanisms" were actually the
// same `_emitStageEvent` instrumentation applied at 8 stage boundaries — each boundary's wiring
// sentence ("call `_emitStageEvent` at `Prepared`", "…at `Build`", …) named the SAME core operation
// plus ONE varying stage token, so the raw extractor counted one claim per boundary and the
// mechanism count over-reported. The rule "same pattern repeated N times = 1 mechanism" means:
// claims whose identifier sets are identical after removing STAGE_BOUNDARY_TOKENS (the workflow
// phase vocabulary — Verify/Prepared/Build/…/Receipt) collapse to ONE representative claim, keeping
// the union of their sentences for evidence but only ONE mechanism-claim entry.
const STAGE_BOUNDARY_TOKENS = new Set([
  // execute-milestone.js phase boundaries (workflow-event-schema.mjs VALID_STAGES)
  "Verify", "Prepared", "Build", "Build-Evidence", "Audit", "Gate", "Reconcile", "Land",
  // prepare-milestone.js phase boundaries
  "Admission", "Preflight", "ProposalAuthors", "Adjudicate", "ProposalReview", "PlanAuthor",
  "PlanCheck", "Receipt",
]);
// Matches a stage-boundary word ANYWHERE inside an identifier token — e.g. `phase('Build-Evidence')`,
// `emit-event-<stage>-<kind>`, `_emitStageEvent` (contains "Stage"), `stageIndex`. A1b's boundary
// claims embed the varying stage name inside the identifier (not as a bare backtick token), so the
// exact-match Set above alone would miss them. Stripping stage words means two claims that differ
// ONLY in which boundary they instrument collapse to the same pattern key.
const STAGE_BOUNDARY_WORD_RE =
  /(?:^|[^A-Za-z])(?:verify|prepared|build|audit|gate|reconcile|land|admission|preflight|proposalauthors|adjudicate|proposalreview|planauthor|plancheck|receipt|stage)(?:[^A-Za-z]|$)/i;

// Explicit mechanism-claim markers — `**WIRING-CLAIM (X):**`, `**[WIRING CLAIM N — …]**`,
// `- **CLAIM-B1:** …`. A marker line IS a mechanism claim by declaration: real Proposals (DIR-124-B's
// CLAIM-B1..B14, DIR-124-A4's findings) express mechanism claims as markers whose sentences use
// verbs OUTSIDE the narrow WIRING_VERB_RE set ("appends", "binds", "replaced", "returns", "maps",
// "validates") — requiring a wiring verb for them under-counts the genuine mechanism inventory
// (measured: DIR-124-B extracted 2 of its 4 mechanisms because 12 of its 14 CLAIM markers were
// verb-invisible). The marker's existence IS the claim; the surrounding text is its evidence.
const CLAIM_MARKER_RE =
  /(?:^|\s)[-*]?\s*\*\*\s*\[?\s*(?:WIRING[- ]CLAIM|CLAIM)[-\s]*[A-Za-z0-9-]*\s*[):.]?\s*\*\*/;

// gap-extract-mechanism-claims-calibration (RC2): strip enumeration and mirror-file labels from an
// identifier so claims that differ ONLY in which enumerated item / mirror they name collapse to one
// mechanism. Numeric/alpha enumeration: E1..E8, AC1..AC14, C1..C8, B1..B14, WIRING-CLAIM-1, finding
// suffixes. Mirror enumeration: `execute-milestone.js` / `prepare-milestone.js` → `workflow` (the
// SAME operation wired into both mirrors is one mechanism, not two).
const ENUM_LABEL_RE = /[-_.]?(?:e|ac|c|m|b|a|w|find|finding|claim|clause)\s*[-_.]?\d+\b/gi;
const MIRROR_NAME_RE = /\b(?:execute-milestone|prepare-milestone)(?:\.js)?\b/gi;

function _stageStripped(id) {
  let x = id
    .replace(STAGE_BOUNDARY_WORD_RE, "")
    .replace(ENUM_LABEL_RE, "")
    .replace(MIRROR_NAME_RE, "workflow");
  // CamelCase-embedded stage words — `_emitStageEvent` carries "Stage" at a case boundary
  // (emit+Stage+Event), which STAGE_BOUNDARY_WORD_RE's `[^A-Za-z]` delimiter never sees; strip it
  // so the identifier normalizes to `_emitEvent` like the event family below.
  x = x.replace(/([a-z])(stage)([A-Z])/gi, "$1$3");
  // Event-emission label family (DIR-124-A1b/A): `_emitStageEvent`, `emit-event-<stage>-<eventKind>`,
  // `emit-eventstart`, `emit-eventend`, `--emit-event` are the SAME operation's identifiers with
  // varying stage/kind/start/end decorations — collapse to one token so claims about the emission
  // mechanism connect regardless of which variant they name.
  x = x.replace(/(?:^|[^a-z])emit[-_ ]?event[a-z0-9-]*/i, "emitevent");
  return x;
}
// The normalized identifier SET for a claim — stage/enumeration/mirror labels stripped, exact stage
// tokens removed. Shared by `_patternKey` (RC1 exact-key merge) and `countMechanisms` (RC2
// connectivity clustering).
function _normalizedIdents(identifiers) {
  return [
    ...new Set(
      identifiers
        .filter((id) => !STAGE_BOUNDARY_TOKENS.has(id))
        .map((id) => _stageStripped(id.trim()))
        .filter(Boolean)
    ),
  ];
}
function _patternKey(identifiers) {
  // The mechanism pattern key = the normalized identifier set, sorted+joined. Two claims that
  // instrument the same operation at different boundaries collapse to the same key.
  return _normalizedIdents(identifiers).sort().join(" ");
}
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
  // RC1: collapse same-pattern-repeated claims. Group by the stage-stripped pattern key; keep the
  // first claim per key (representative) and merge the sentences of the collapsed group into it for
  // evidence completeness. Order preserved (first-seen).
  const byKey = new Map();
  for (const c of claims) {
    const key = _patternKey(c.identifiers);
    if (key === "") continue; // all identifiers were stage tokens — not a real mechanism claim
    if (!byKey.has(key)) byKey.set(key, { ...c, sentence: c.sentence });
    else {
      // merge sentences so the retained claim's evidence spans all repeated instances
      const existing = byKey.get(key);
      existing.sentence += " " + c.sentence;
      // identifiers remain the representative's — the pattern key is what matters
    }
  }
  return [...byKey.values()];
}

// ── countMechanisms — RC2 connectivity clustering (gap-extract-mechanism-claims-calibration). ─────
// `extractMechanismClaims` counts CLAIMS; a single mechanism legitimately produces many claims (the
// 14 WIRING-CLAIM markers of DIR-124-A1b are 14 coverage items of ONE `_emitStageEvent` mechanism;
// DIR-124-A4's 16 findings are implementation details of ONE conformance script). The mechanism COUNT
// that feeds the `> 2 → split` decision must count MECHANISMS, not claims. Claims whose normalized
// identifier sets OVERLAP are the same mechanism (they name the same core components); disjoint
// claims are distinct mechanisms (DIR-124-B's run-identity / stage-receipt / workflow-journal /
// workflow-resume families stay separate). Deterministic: first-seen component order, no randomness.
export function countMechanisms(sectionText) {
  // Own claim extraction: the verb-based rule PLUS explicit claim markers (`**WIRING-CLAIM (X):**`,
  // `**CLAIM-B1:**`), so a verb-invisible marker still counts toward the mechanism inventory. This
  // is scoped to the COUNT path only — `extractMechanismClaims` stays verb-based so the
  // wiring-coverage check does not surface new uncovered claims on DONE tasks (the module's
  // documented anti-regression stance).
  const claims = [];
  for (const sentence of splitSentences(sectionText)) {
    const identifiers = backtickIdentifiers(sentence);
    if (CLAIM_MARKER_RE.test(sentence) && identifiers.length >= 1) {
      claims.push({ sentence, identifiers });
      continue;
    }
    if (!WIRING_VERB_RE.test(sentence)) continue;
    if (identifiers.length >= 2) claims.push({ sentence, identifiers });
  }
  const components = []; // [{ key:Set, reps:[claim] }]
  for (const c of claims) {
    const norm = new Set(_normalizedIdents(c.identifiers));
    if (norm.size === 0) continue;
    let merged = -1;
    for (let i = 0; i < components.length; i++) {
      const overlap = [...norm].filter((x) => components[i].key.has(x)).length;
      if (overlap > 0) {
        if (merged < 0) {
          for (const x of norm) components[i].key.add(x);
          components[i].reps.push(c);
          merged = i;
        } else {
          for (const x of components[i].key) components[merged].key.add(x);
          components[merged].reps.push(...components[i].reps);
          components.splice(i, 1);
          i--;
        }
      }
    }
    if (merged < 0) components.push({ key: new Set(norm), reps: [c] });
  }
  return {
    mechanismCount: components.length,
    claims: claims.length,
    mechanisms: components.map((comp, i) => ({
      mechanismId: "M" + (i + 1),
      identifiers: [...comp.key],
      claimCount: comp.reps.length,
      sentence: comp.reps[0].sentence,
    })),
  };
}

// ── Mechanism-subsection narrowing (gap-wiring-coverage-scope-narrowing, P0 #60) ────────────────
// The canonical `## Proposal` subsection vocabulary (DIR-117/DIR-122). Mechanism claims live ONLY
// under these headings (whether `### Heading` or `**Heading.**`/`**Heading:**` bold equivalents);
// every other Proposal subsection (Problem framing, Risks, Defaults and failure behavior,
// Compatibility, Alternatives considered, Non-goals) is background/motivation prose and is excluded
// from claim extraction. `Mechanism-claim → AC coverage` may carry a parenthetical suffix (e.g.
// "(DIR-117 wiring)") and the arrow may be `→`/`->`/`=>`/`to`.
const MECHANISM_HEADING_RE =
  /^(?:chosen mechanism|key design decisions|mechanism-claim(?:\s+wiring\s+coverage|\s*(?:→|->|=>|to)\s*(?:ac|acceptance)\s*coverage))\b/i;
// `**WIRING-CLAIM (X):**` / `**[WIRING CLAIM N — ...]**` — explicit claim markers; mechanism-bearing
// regardless of which subsection they sit in.
const WIRING_CLAIM_MARKER_RE = /^\*\*\s*\[?\s*WIRING[- ]CLAIM\b/i;

function isMechanismSubsectionHeading(headingText) {
  return MECHANISM_HEADING_RE.test((headingText || "").trim());
}

// Return ONLY the mechanism-bearing subsections of a Proposal section's text (concatenated), or ""
// when the section has no mechanism-bearing subsection — callers then fall back to scanning the
// whole section (a flat `## Requested action`, or a Proposal with no `### Chosen mechanism`-style
// subsection at all, has nothing to narrow to and keeps pre-fix behavior).
export function extractMechanismSubsections(proposalText) {
  if (!proposalText) return "";
  const lines = proposalText.split(/\r?\n/);
  const out = [];
  let inMechanism = false;
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    // `### <heading>` — a subsection boundary. Mechanism subsections are claim sources; everything
    // else (Problem framing, Risks, Defaults, Compatibility, Non-goals, Alternatives) is excluded.
    const h3 = line.match(/^#{3}\s+(.+)$/);
    if (h3) {
      inMechanism = isMechanismSubsectionHeading(h3[1]);
      if (inMechanism) out.push(rawLine);
      i++;
      continue;
    }
    // `**<Mechanism heading>.**` / `:**` bold-heading subsection markers (DIR-117-B style, where a
    // Proposal uses `**Chosen mechanism.**` instead of `### Chosen mechanism`).
    const boldHead = line.match(/^\*\*\s*(.+?)\s*[:.]\s*\*\*/);
    if (boldHead && isMechanismSubsectionHeading(boldHead[1])) {
      inMechanism = true;
      out.push(rawLine);
      i++;
      continue;
    }
    // `**WIRING-CLAIM (X):**` / `**[WIRING CLAIM N — ...]**` — explicit claim markers. The marker
    // line and its OWN paragraph are claim sources, but the marker must NOT pull in the rest of a
    // non-mechanism enclosing subsection (Problem framing) — real DIR-124-A2 places its
    // `**WIRING-CLAIM (A2-M192-CODE):**` markers inside Problem framing, so capturing-to-next-`###`
    // would wrongly re-flag that prose. Capture just this paragraph (until blank line or `###`).
    if (WIRING_CLAIM_MARKER_RE.test(line)) {
      out.push(rawLine);
      i++;
      while (i < lines.length) {
        const cont = lines[i];
        const ct = cont.trim();
        if (ct === "" || /^#{3}\s+/.test(ct)) break;
        out.push(cont);
        i++;
      }
      continue;
    }
    // Regular line: included only inside a mechanism subsection. A non-mechanism bold heading
    // (e.g. `**Problem framing ...**`, `**Mechanism-claim (X):**`) falls through here and is kept
    // only when it is a sub-heading INSIDE an already-active mechanism subsection.
    if (inMechanism) out.push(rawLine);
    i++;
  }
  return out.join("\n");
}

// A `## Proposal` narrows to its mechanism-bearing subsections; a flat section (e.g. a gap task's
// `## Requested action`, which has no `###`/`**...**` subsection structure) has nothing to narrow to
// and keeps scanning the whole section (backward-compatible with DIR-122's checkGapWiringCoverage).
function sourceForWiringCoverage(sourceSectionText) {
  if (!sourceSectionText) return "";
  const narrowed = extractMechanismSubsections(sourceSectionText);
  return narrowed.trim() !== "" ? narrowed : sourceSectionText;
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
//   extractSection(body, "Proposal") or extractSection(body, "Requested action")). For a `##
//   Proposal` (a section with `### `/`**...**` subsection structure) only the mechanism-bearing
//   subsections are claim sources — see extractMechanismSubsections above; problem-framing/risks/
//   motivation prose full of code references is NOT mechanism-claimed. Non-Proposal sections
//   (`## Requested action`) scan the whole section (backward compat).
// acSectionText: the task's `## Acceptance Criteria` section raw text.
export function checkWiringCoverage(sourceSectionText, acSectionText) {
  const claims = extractMechanismClaims(sourceForWiringCoverage(sourceSectionText));
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
    rootCauseKey: "wiring-coverage-format",
    repairable: true,
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
