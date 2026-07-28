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

const WIRING_VERB_RE = /\b(invokes?|calls?|dispatches?|enforces?|wires?|owns?|routes?|delegates?)\b/i;
const EVIDENCE_RE = /\b(real|production|callsite|call site|reachability|reachable|evidence|wired|confirm(?:ed|s|ation)?|reproduc\w*|verifi(?:ed|es|cation)?|proven?|proves?)\b/i;

// Split into sentence-ish chunks: paragraph boundaries first, then sentence-ending punctuation
// followed by whitespace + an uppercase letter or backtick/quote (avoids splitting on "e.g." or
// "Fig. 2" style abbreviations enough for this heuristic's purpose — it does not need to be exact,
// only good enough to keep two co-occurring identifiers in the same claim).
function splitSentences(text) {
  return text
    .split(/\n{2,}/)
    .flatMap((para) => para.split(/(?<=[.!?])\s+(?=[A-Z`"])/))
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
