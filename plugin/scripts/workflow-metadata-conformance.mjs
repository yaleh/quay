#!/usr/bin/env node
// workflow-metadata-conformance.mjs — DIR-124-A4: workflow metadata vs executable-driver conformance.
//
// A deterministic, import-free Node ESM module (imports ONLY Node built-ins: fs, path, url) that
// mechanically checks each installed workflow's `export const meta` metadata surface against its
// own executable body:
//   1. Phase-list claim vs. actual phase() call sites        (FAIL on false claim)
//   2. Return-outcome claim vs. actual return-site outcomes  (FAIL on false/incomplete claim)
//   3. Agent-count claim (only if meta.description claims one)
//   4. Node-invocation convention consistency (+ cross-file --no-warnings divergence WARN, C8)
//   5. Worktree/isolation mechanism mention                   (WARN on unmentioned mechanism)
//   6. Cache/resume mechanism mention                         (FAIL on stale claim, WARN on omission)
//   7. Gate-count precision (only if meta claims a specific count)
//   8. Mirror byte-identity across same-basename files (workflow dual copies retired: no default mirrors)
//   9. Re-entrant phase documentation                         (WARN on unannotated multiplicity)
//
// Extraction is PURE regex/string-operation on source TEXT — never eval/import of the workflow
// source (the workflow files reference DSL globals `agent`/`phase`/`parallel`/`log`/`args` that are
// not importable). This mirrors the established pattern of it0-dod-check.ts (regex extraction) and
// workflow-invariant-ownership.mjs (pure functions + thin CLI).
//
// The module is importable for tests (all extraction functions are exported and pure) with a thin
// CLI wrapper for DoD-gate shell-out:
//   node workflow-metadata-conformance.mjs [--json] [--workspace-root <dir>] [<file...>]
// Exit codes: 0 = all hard checks pass; 1 = >=1 FAIL; 2 = usage/env error (missing file).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Low-level string scanners ────────────────────────────────────────────────────────────────────

// Consume a single/double-quoted string starting at `start` (source[start] is the opening quote).
// Returns the index one PAST the closing quote. Backslash escapes are honored.
function consumeQuoted(source, start) {
  const quote = source[start];
  let i = start + 1;
  const n = source.length;
  while (i < n) {
    if (source[i] === "\\") { i += 2; continue; }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return n;
}

// Regex-literal-vs-division disambiguation heuristic (the classic JS scanner ambiguity — needed so a
// `'`/`"`/`{`/`(` inside a regex literal like /'\/ /M(\d+)/ is not misread as opening a string or
// bracket). A `/` is a regex start when the previous significant token is an operator / open bracket
// / punct / comma / assignment, or the region's start, or a keyword that expects an expression
// (return/typeof/case/throw/yield/in/of/instanceof/new/delete/void/do/else/await).
const REGEX_START_OPERATORS = /[([{:;,=!&|?+\-*%^~<>]/;
const REGEX_START_KEYWORDS = new Set([
  "return", "typeof", "case", "throw", "yield", "in", "of", "instanceof",
  "new", "delete", "void", "do", "else", "await", "&&", "||", "??",
]);
function isRegexStart(source, index, regionStart) {
  let j = index - 1;
  while (j >= regionStart && /\s/.test(source[j])) j--;
  if (j < regionStart) return true;
  const prev = source[j];
  if (REGEX_START_OPERATORS.test(prev)) return true;
  if (/[A-Za-z0-9_$]/.test(prev)) {
    let k = j;
    while (k >= regionStart && /[A-Za-z0-9_$]/.test(source[k])) k--;
    const ident = source.slice(k + 1, j + 1);
    return REGEX_START_KEYWORDS.has(ident);
  }
  return false; // prev is a closing paren/bracket or other token — treat as division
}

// Consume a regex literal starting at `start` (source[start] === '/'), honoring escapes and
// character classes. Returns the index one PAST the closing '/'.
function consumeRegex(source, start) {
  let i = start + 1;
  let inClass = false;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return i + 1;
    i++;
  }
  return n;
}

// Consume a template literal starting at `start` (source[start] === '`'). Handles backslash escapes
// and ${...} interpolation (brace-depth aware, strings inside interpolation are respected).
// Returns the index one PAST the closing backtick.
function consumeTemplate(source, start) {
  let i = start + 1;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "`") return i + 1;
    if (ch === "$" && source[i + 1] === "{") {
      const nestedStart = i + 2;
      let depth = 1;
      i = nestedStart;
      while (i < n && depth > 0) {
        const c = source[i];
        if (c === "'" || c === '"' || c === "`") {
          i = c === "`" ? consumeTemplate(source, i) : consumeQuoted(source, i);
          continue;
        }
        if (c === "/" && source[i + 1] !== "/" && source[i + 1] !== "*" && isRegexStart(source, i, nestedStart)) {
          i = consumeRegex(source, i);
          continue;
        }
        if (c === "\\") { i += 2; continue; }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return n;
}

// maskNonCode(source) — single pass marking positions that are inside a string literal, template
// literal, line comment, or block comment (mask[i] === 1). Positions at mask[i] === 0 are "code".
// This is the deterministic tokenizer-lite that lets extraction functions skip phase()/agent()/
// return/outcome text that merely appears inside prose, agent prompts, or comments.
function maskNonCode(source) {
  const mask = new Uint8Array(source.length);
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const start = i;
      while (i < n && source[i] !== "\n") i++;
      mask.fill(1, start, i);
      continue;
    }
    if (ch === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(i + 2, n);
      mask.fill(1, start, i);
      continue;
    }
    // A bare `/` that starts a regex literal (not a comment) must be consumed as a unit so any
    // `'`/`"`/`{`/`(` inside it is not misread as opening a string/bracket — AND its whole span is
    // masked so DSL tokens inside a regex (e.g. /phase('Ghost')/) are never counted as real sites.
    if (ch === "/" && next !== "/" && next !== "*" && isRegexStart(source, i, 0)) {
      const start = i;
      i = consumeRegex(source, i);
      mask.fill(1, start, i);
      continue;
    }
    if (ch === "'" || ch === '"') {
      const start = i;
      i = consumeQuoted(source, i);
      mask.fill(1, start, i);
      continue;
    }
    if (ch === "`") {
      const start = i;
      i = consumeTemplate(source, i);
      mask.fill(1, start, i);
      continue;
    }
    i++;
  }
  return mask;
}

// findBalanced(source, openIndex, openChar, closeChar) — from the position of an opening bracket,
// returns the index of its MATCHING close bracket (string/comment/template aware), or -1.
function findBalanced(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let i = openIndex;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === "'" || ch === '"') { i = consumeQuoted(source, i); continue; }
    if (ch === "`") { i = consumeTemplate(source, i); continue; }
    if (ch === "/" && source[i + 1] === "/") { while (i < n && source[i] !== "\n") i++; continue; }
    if (ch === "/" && source[i + 1] === "*") { i += 2; while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++; i += 2; continue; }
    if (ch === "/" && source[i + 1] !== "/" && source[i + 1] !== "*" && isRegexStart(source, i, openIndex)) { i = consumeRegex(source, i); continue; }
    if (ch === openChar) depth++;
    else if (ch === closeChar) { depth--; if (depth === 0) return i; }
    i++;
  }
  return -1;
}

// 1-based line number of a character index.
function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

// Unescape a single/double-quoted JS string body (as captured between the quotes).
function unescapeJsString(raw) {
  return raw.replace(/\\(['"\\`nrtb])/g, (m, c) => {
    switch (c) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "b": return "\b";
      default: return c;
    }
  });
}

// Remove the `export const meta = {...}` block from source text, returning the executable body.
// Body-oriented extraction functions use this so a meta claim's OWN mention of a mechanism
// (e.g. a description that literally says "worktree" or "resumable") is never counted as evidence
// that the BODY implements it — otherwise Check 4/5/6's "false claim" FAIL branches would be
// unreachable (the meta mention itself would always satisfy the body-presence check).
function removeMetaBlock(source) {
  const markerRe = /export\s+const\s+meta\s*=/g;
  const m = markerRe.exec(source);
  if (!m) return source;
  const braceOpen = source.indexOf("{", m.index + m[0].length);
  if (braceOpen === -1) return source;
  const braceEnd = findBalanced(source, braceOpen, "{", "}");
  if (braceEnd === -1) return source;
  return source.slice(0, m.index) + source.slice(braceEnd + 1);
}

// ── Extraction functions (pure — source text in, structured data out) ────────────────────────────

// Extract the `export const meta = {...}` object via balanced-brace extraction.
// Returns { ok, name, description, phases: [{title, detail}], error? }.
export function extractMeta(source) {
  // Skip any `export const meta =` marker that lives inside a comment or string (e.g. a
  // commented-out historical copy before the real declaration) — the REAL meta declaration is the
  // first UNMASKED marker.
  const mask = maskNonCode(source);
  const markerRe = /export\s+const\s+meta\s*=/g;
  let m = markerRe.exec(source);
  while (m && mask[m.index]) {
    m = markerRe.exec(source);
  }
  if (!m) return { ok: false, error: "no `export const meta =` found in source" };
  const braceOpen = source.indexOf("{", m.index + m[0].length);
  if (braceOpen === -1) return { ok: false, error: "no `{` after `export const meta =`" };
  const braceEnd = findBalanced(source, braceOpen, "{", "}");
  if (braceEnd === -1) return { ok: false, error: "unbalanced meta object (no matching `}`)" };
  const objText = source.slice(braceOpen + 1, braceEnd);

  const nameMatch = objText.match(/name\s*:\s*['"]([^'"]+)['"]/);
  const name = nameMatch ? nameMatch[1] : null;

  let description = "";
  const descMatch =
    objText.match(/description\s*:\s*'((?:[^'\\]|\\.)*)'/s) ||
    objText.match(/description\s*:\s*"((?:[^"\\]|\\.)*)"/s);
  if (descMatch) description = unescapeJsString(descMatch[1]);

  const phases = [];
  const phasesKey = objText.search(/phases\s*:/);
  if (phasesKey !== -1) {
    const bracketOpen = objText.indexOf("[", phasesKey);
    if (bracketOpen !== -1) {
      const bracketEnd = findBalanced(objText, bracketOpen, "[", "]");
      if (bracketEnd !== -1) {
        const phasesText = objText.slice(bracketOpen + 1, bracketEnd);
        const titleRe = /\btitle\s*:\s*['"]([^'"]+)['"]/g;
        const detailRe = /\bdetail\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
        const titles = [];
        const details = [];
        let tm;
        while ((tm = titleRe.exec(phasesText)) !== null) titles.push(tm[1]);
        let dm;
        while ((dm = detailRe.exec(phasesText)) !== null) details.push(dm[1] !== undefined ? dm[1] : dm[2]);
        for (let i = 0; i < titles.length; i++) {
          phases.push({ title: titles[i], detail: details[i] !== undefined ? unescapeJsString(details[i]) : "" });
        }
      }
    }
  }

  return { ok: true, name, description, phases };
}

// Extract all `phase('<Label>')` call sites in CODE (skips comments, strings, templates).
// Returns { uniqueLabels, callCounts (Map), callSites: [{label, line}] }.
export function extractPhases(source) {
  const mask = maskNonCode(source);
  const uniqueLabels = [];
  const callCounts = new Map();
  const callSites = [];
  const re = /\bphase\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (mask[m.index]) continue; // inside comment/string/template — not a real call site
    const label = m[1];
    if (!callCounts.has(label)) { callCounts.set(label, 0); uniqueLabels.push(label); }
    callCounts.set(label, callCounts.get(label) + 1);
    callSites.push({ label, line: lineOf(source, m.index) });
  }
  return { uniqueLabels, callCounts, callSites };
}

// Count `agent(` dispatch sites in CODE (both `await agent(` and bare `agent(` / `() => agent(`).
// Returns { callCount, awaitCallCount, callSites: [{awaitPrefix, line}] }.
export function extractAgents(source) {
  const mask = maskNonCode(source);
  const callSites = [];
  const re = /\b(await\s+)?agent\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    if (mask[m.index]) continue;
    callSites.push({ awaitPrefix: !!m[1], line: lineOf(source, m.index) });
  }
  const callCount = callSites.length;
  const awaitCallCount = callSites.filter((s) => s.awaitPrefix).length;
  return { callCount, awaitCallCount, callSites };
}

// Count `node --experimental-strip-types` invocations, distinguishing --no-warnings presence.
// These commands appear inside agent-prompt template literals, so extraction is RAW (no mask).
// Returns { totalCount, withNoWarnings, withoutNoWarnings, callSites: [{withNoWarnings, line}] }.
export function extractNodeInvocations(source) {
  source = removeMetaBlock(source); // body-only — meta's own node-pattern mention must not count as an invocation
  const callSites = [];
  // Matches `node --experimental-strip-types ...` AND `node --no-warnings --experimental-strip-types`
  // (and reverse order) on a single line; the whole line is then checked for --no-warnings.
  const re = /\bnode\s+[^\n]*?--experimental-strip-types\b/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const lineStart = source.lastIndexOf("\n", m.index) + 1;
    const lineEnd = source.indexOf("\n", m.index);
    const lineText = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    const withNoWarnings = /--no-warnings/.test(lineText);
    callSites.push({ withNoWarnings, line: lineOf(source, m.index) });
  }
  const totalCount = callSites.length;
  const withNoWarnings = callSites.filter((s) => s.withNoWarnings).length;
  const withoutNoWarnings = totalCount - withNoWarnings;
  return { totalCount, withNoWarnings, withoutNoWarnings, callSites };
}

// Extract outcome string literals at actual `return` statements (single- and multi-line, covering
// both `return { outcome: 'x' }` and `return _wtRet({ outcome: 'x' })` shapes). Agent-prompt /
// comment / observability (e.g. _emitStageEvent) outcome literals are NOT captured.
// Returns { outcomeValues: [], sites: [{value, line}] }.
export function extractReturnOutcomes(source) {
  const mask = maskNonCode(source);
  const outcomeValues = [];
  const valueSet = new Set();
  const sites = [];
  const returnRe = /\breturn\b/g;
  let m;
  while ((m = returnRe.exec(source)) !== null) {
    if (mask[m.index]) continue; // `return` inside comment/string — not a code return site
    const scanned = scanReturnStatement(source, m.index);
    if (!scanned) continue;
    for (const o of scanned.outcomes) {
      if (!valueSet.has(o.value)) { valueSet.add(o.value); outcomeValues.push(o.value); }
      sites.push({ value: o.value, line: lineOf(source, o.index) });
    }
    returnRe.lastIndex = scanned.endIndex; // skip past the consumed statement
  }
  return { outcomeValues, sites };
}

// Scan one return statement starting at the `return` keyword index; returns
// { endIndex, outcomes: [{value, index}] } or null if the return has no value.
function scanReturnStatement(source, start) {
  let i = start + 6; // past "return"
  const n = source.length;
  while (i < n && /\s/.test(source[i])) i++;
  if (i >= n) return null;
  if (source[i] === ";" || source[i] === "}" || source[i] === "\n") return null; // bare return
  let depth = 0;
  const outcomes = [];
  while (i < n) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      i = ch === "`" ? consumeTemplate(source, i) : consumeQuoted(source, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") { while (i < n && source[i] !== "\n") i++; continue; }
    if (ch === "/" && source[i + 1] === "*") { i += 2; while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++; i += 2; continue; }
    if (ch === "/" && source[i + 1] !== "/" && source[i + 1] !== "*" && isRegexStart(source, i, start)) { i = consumeRegex(source, i); continue; }
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth < 0) break; // closed the enclosing block/statement
    }
    else if (ch === ";" && depth === 0) { i++; break; }
    else if (ch === "\n" && depth === 0) break;
    // Detect an `outcome:` literal (only in code — we're past strings/comments above).
    if (ch === "o" && source.startsWith("outcome", i)) {
      let j = i + 7;
      while (j < n && /\s/.test(source[j])) j++;
      if (source[j] === ":") {
        j++;
        while (j < n && /\s/.test(source[j])) j++;
        const q = source[j];
        if (q === "'" || q === '"') {
          const end = consumeQuoted(source, j);
          outcomes.push({ value: source.slice(j + 1, end - 1), index: j });
          i = end;
          continue;
        }
      }
    }
    i++;
  }
  return { endIndex: i, outcomes };
}

// Count lines containing worktree/isolation references (raw — the mechanism's presence is what
// matters, including prompt/comment references). Returns { lineCount, present }.
export function extractWorktreeRefs(source) {
  source = removeMetaBlock(source); // body-only — a meta claim that literally says "worktree" is a claim, not evidence
  const re = /_useWorktree|_isolationPlan|isolationMode|worktree|milestone-worktree/g;
  const lines = new Set();
  let m;
  while ((m = re.exec(source)) !== null) lines.add(lineOf(source, m.index));
  return { lineCount: lines.size, present: lines.size > 0 };
}

// Detect cache/resume mechanism patterns in the body.
// Returns { present, patterns: [] }.
export function extractCacheResumePatterns(source) {
  source = removeMetaBlock(source); // body-only — the meta's own "resumable" claim is a claim, not a mechanism
  const patterns = [
    "cacheFingerprints", "_cached(", "verifyCacheUpdates",
    "resumeFromAdjudicatedProposal", "--decide-resume", "cacheable", "resumable",
  ];
  const found = patterns.filter((p) => source.includes(p));
  return { present: found.length > 0, patterns: found };
}

// Parse the gate dispatch array(s): `const gates = await parallel([ ...label: 'x'... ])`.
// Returns { gateLabels (unique quoted labels), count, arrays: [] }.
export function extractGateDispatch(source) {
  const arrays = [];
  const parallelRe = /\bparallel\s*\(/g;
  let m;
  while ((m = parallelRe.exec(source)) !== null) {
    const parenOpen = m.index + m[0].length - 1;
    let j = parenOpen + 1;
    while (j < source.length && /\s/.test(source[j])) j++;
    if (source[j] === "[") {
      const bracketEnd = findBalanced(source, j, "[", "]");
      if (bracketEnd !== -1) arrays.push(source.slice(j + 1, bracketEnd));
    }
  }
  const gateLabels = [];
  const seen = new Set();
  for (const arr of arrays) {
    const labelRe = /\blabel\s*:\s*['"]([^'"]+)['"]/g;
    let lm;
    while ((lm = labelRe.exec(arr)) !== null) {
      if (!seen.has(lm[1])) { seen.add(lm[1]); gateLabels.push(lm[1]); }
    }
  }
  return { gateLabels, count: gateLabels.length, arrays };
}

// Extract an outcome-union claim from meta.description text (e.g. `{outcome: "a"|"b"|"c"}` or
// `{outcome: 'a'|'b'|'c'}`). Returns { found, values }.
export function extractOutcomeClaims(description) {
  const values = [];
  const re = /\boutcome\s*:\s*((?:(?:'[^']*'|"[^"]*")\s*\|\s*)*(?:'[^']*'|"[^"]*"))/g;
  let found = false;
  let m;
  while ((m = re.exec(description || "")) !== null) {
    found = true;
    for (const part of m[1].split("|")) {
      const v = part.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      if (v && !values.includes(v)) values.push(v);
    }
  }
  return { found, values };
}

// Extract a whole-file numeric agent-count claim from meta.description (e.g. "N=2 agents").
// Returns { found, count, claimText }.
export function extractAgentCountClaim(description) {
  const re1 = /\b(\d+)\s+(?:independent\s+)?agent(?:s)?\b/i;
  const m1 = (description || "").match(re1);
  if (m1) return { found: true, count: parseInt(m1[1], 10), claimText: m1[0] };
  const re2 = /\bN\s*=\s*(\d+)\b/i;
  const m2 = (description || "").match(re2);
  if (m2) return { found: true, count: parseInt(m2[1], 10), claimText: m2[0] };
  return { found: false, count: null, claimText: null };
}

// Does the file carry an explicit comment documenting an intentional --no-warnings divergence?
function hasNodeDivergenceDoc(source) {
  return /(?:\/\/|\/\*)[^\n]*--no-warnings[^\n]*(intentional|divergence|deliberate|convention|rationale)/i.test(source);
}

// C8 — cross-file --no-warnings convention divergence WARN (pure, exported for tests).
// Returns a warning object or null.
export function nodeConventionWarn({ execNodes, prepNodes, execSrc, prepSrc, execPath, prepPath }) {
  const execAllWith = execNodes.totalCount > 0 && execNodes.withoutNoWarnings === 0;
  const execAllWithout = execNodes.totalCount > 0 && execNodes.withNoWarnings === 0;
  const prepAllWith = prepNodes.totalCount > 0 && prepNodes.withoutNoWarnings === 0;
  const prepAllWithout = prepNodes.totalCount > 0 && prepNodes.withNoWarnings === 0;
  const divergent = (execAllWith && prepAllWithout) || (execAllWithout && prepAllWith);
  if (!divergent) return null;
  if (hasNodeDivergenceDoc(execSrc) || hasNodeDivergenceDoc(prepSrc)) return null; // documented intent
  return {
    file: `${execPath} vs ${prepPath}`,
    check: "node-convention",
    detail:
      `execute-milestone.js and prepare-milestone.js have contradictory --no-warnings conventions ` +
      `(one file uses it at every node invocation, the other at none) with no documented-intent ` +
      `comment in either — indistinguishable from accidental drift`,
    severity: "AMBER",
  };
}

// ── Assertions: checkFile / checkAll ──────────────────────────────────────────────────────────────

// Run all per-file assertions against ONE workflow source. Returns
// { file, name, failures[], warnings[], informational[] }.
export function checkFile(filePath, source) {
  const rel = filePath;
  const baseName = path.basename(filePath);
  const failures = [];
  const warnings = [];
  const informational = [];

  const meta = extractMeta(source);
  if (!meta.ok) {
    failures.push({ file: rel, check: "metadata", detail: `metadata-unparseable: ${meta.error}`, severity: "RED" });
    return { file: rel, name: baseName, failures, warnings, informational };
  }

  const phases = extractPhases(source);
  const agents = extractAgents(source);
  const nodes = extractNodeInvocations(source);
  const outcomes = extractReturnOutcomes(source);
  const worktree = extractWorktreeRefs(source);
  const cacheResume = extractCacheResumePatterns(source);
  const gates = extractGateDispatch(source);

  const metaTitles = meta.phases.map((p) => p.title);
  const metaSet = new Set(metaTitles);
  const bodySet = new Set(phases.uniqueLabels);

  // Check 1 — phase-list claim vs. actual phase() call sites (FAIL).
  for (const lbl of bodySet) {
    if (!metaSet.has(lbl)) {
      const sites = phases.callSites.filter((s) => s.label === lbl).map((s) => s.line).join(", ");
      failures.push({ file: rel, check: "phase-set", detail: `phase '${lbl}' called in body (line(s) ${sites}) but absent from meta.phases — stale metadata`, severity: "RED" });
    }
  }
  for (const lbl of metaSet) {
    if (!bodySet.has(lbl)) {
      failures.push({ file: rel, check: "phase-set", detail: `phase '${lbl}' listed in meta.phases but never called in body — phantom phase`, severity: "RED" });
    }
  }

  // Check 9 — re-entrant phase multiplicity (WARN).
  for (const [lbl, count] of phases.callCounts) {
    if (count > 1) {
      const sites = phases.callSites.filter((s) => s.label === lbl).map((s) => s.line).join(", ");
      warnings.push({ file: rel, check: "reentrant-phase", detail: `phase '${lbl}' entered ${count} times (line(s) ${sites}) but meta.phases has a single entry — re-entrant multiplicity not annotated`, severity: "AMBER" });
    }
  }

  // Check 2 — return-outcome claim vs. actual return-site outcomes (FAIL).
  const claimed = extractOutcomeClaims(meta.description);
  if (claimed.found) {
    const actualSet = new Set(outcomes.outcomeValues);
    for (const c of claimed.values) {
      if (!actualSet.has(c)) {
        failures.push({ file: rel, check: "return-outcomes", detail: `meta.description claims outcome '${c}' but no return site in the body produces it — stale claim`, severity: "RED" });
      }
    }
    for (const a of outcomes.outcomeValues) {
      if (!claimed.values.includes(a)) {
        failures.push({ file: rel, check: "return-outcomes", detail: `return site produces outcome '${a}' but meta.description does not claim it — incomplete metadata`, severity: "RED" });
      }
    }
  } else {
    warnings.push({ file: rel, check: "return-outcomes", detail: `meta.description makes no parseable {outcome: ...} claim — the actual return-outcome union [${outcomes.outcomeValues.join(", ") || "none"}] is unverified`, severity: "AMBER" });
  }

  // Check 3 — agent-count claim (informational unless claimed).
  const agentClaim = extractAgentCountClaim(meta.description);
  if (agentClaim.found) {
    if (agentClaim.count !== agents.callCount) {
      failures.push({ file: rel, check: "agent-count", detail: `meta.description claims ${agentClaim.count} agent dispatch(es) ("${agentClaim.claimText}") but the body has ${agents.callCount} agent() call site(s)`, severity: "RED" });
    }
  } else {
    informational.push({ file: rel, check: "agent-count", detail: `no whole-file agent-count claim in meta.description; body has ${agents.callCount} agent() call site(s) (${agents.awaitCallCount} awaited)` });
  }

  // Check 4 — node-invocation convention (per-file counts + meta-divergence FAIL; cross-file WARN in checkAll).
  informational.push({ file: rel, check: "node-convention", detail: `node --experimental-strip-types: ${nodes.totalCount} invocation(s), ${nodes.withNoWarnings} with --no-warnings, ${nodes.withoutNoWarnings} without` });
  const metaNodeText = (meta.description || "") + " " + meta.phases.map((p) => p.detail || "").join(" ");
  if (/\bnode\s+--no-warnings\s+--experimental-strip-types\b/.test(metaNodeText) && nodes.withNoWarnings === 0) {
    failures.push({ file: rel, check: "node-convention", detail: `meta mentions 'node --no-warnings --experimental-strip-types' but the body never invokes it`, severity: "RED" });
  } else if (/\bnode\s+--experimental-strip-types\b/.test(metaNodeText) && !/--no-warnings/.test(metaNodeText) && nodes.withNoWarnings > 0 && nodes.withoutNoWarnings === 0) {
    failures.push({ file: rel, check: "node-convention", detail: `meta mentions plain 'node --experimental-strip-types' but every body invocation uses --no-warnings`, severity: "RED" });
  }

  // Check 5 — worktree/isolation mechanism mention (WARN on unmentioned mechanism, FAIL on false claim).
  const metaWorktreeMention = /worktree|isolation/i.test(metaNodeText);
  if (worktree.lineCount > 5 && !metaWorktreeMention) {
    warnings.push({ file: rel, check: "worktree", detail: `body has ${worktree.lineCount} worktree/isolation reference(s) but meta mentions neither — metadata omission`, severity: "AMBER" });
  } else if (metaWorktreeMention && worktree.lineCount === 0) {
    failures.push({ file: rel, check: "worktree", detail: `meta claims worktree/isolation support but the body has zero worktree references — false claim`, severity: "RED" });
  }

  // Check 6 — cache/resume mechanism mention (FAIL on stale claim, WARN on unmentioned mechanism).
  const metaCacheResumeMention = /\b(cache|resume|resumable)\b/i.test(meta.description || "");
  if (metaCacheResumeMention) {
    if (!cacheResume.present) {
      failures.push({ file: rel, check: "cache-resume", detail: `meta.description mentions cache/resume but the body has none of the mechanism patterns (cacheFingerprints/_cached(/verifyCacheUpdates/resumeFromAdjudicatedProposal/--decide-resume) — stale claim`, severity: "RED" });
    }
  } else if (cacheResume.present) {
    warnings.push({ file: rel, check: "cache-resume", detail: `body has cache/resume logic (${cacheResume.patterns.join(", ")}) but meta.description never mentions it — metadata omission`, severity: "AMBER" });
  }

  // Check 7 — gate-count precision (WARN only if meta claims a specific count).
  const gateCountClaim = metaNodeText.match(/\b(\d+)\s+gate(?:s)?\b/i);
  if (gateCountClaim) {
    const claimedCount = parseInt(gateCountClaim[1], 10);
    if (claimedCount !== gates.count) {
      warnings.push({ file: rel, check: "gate-count", detail: `meta implies ${claimedCount} gate(s) but the gate dispatch array has ${gates.count} named type(s) [${gates.gateLabels.join(", ")}]`, severity: "AMBER" });
    }
  } else {
    informational.push({ file: rel, check: "gate-count", detail: `no specific gate-count claim in meta; gate dispatch array has ${gates.count} named type(s) [${gates.gateLabels.join(", ") || "none"}]` });
  }

  return { file: rel, name: baseName, failures, warnings, informational, phaseCount: phases.uniqueLabels.length, agentCallCount: agents.callCount };
}

// Run checks across all files: per-file assertions + mirror byte-identity + cross-file node WARN.
// Returns { ok, files[], failures[], warnings[], informational[], mirrored[] }.
export function checkAll(filePaths) {
  const files = [];
  const failures = [];
  const warnings = [];
  const informational = [];
  const mirrored = [];

  for (const filePath of filePaths) {
    const source = fs.readFileSync(filePath, "utf8");
    const res = checkFile(filePath, source);
    files.push(res);
    for (const f of res.failures) failures.push(f);
    for (const w of res.warnings) warnings.push(w);
    for (const i of res.informational) informational.push(i);
  }

  // Check 8 — mirror byte-identity (FAIL): same-basename files must be byte-identical.
  const byBase = new Map();
  for (const p of filePaths) {
    const base = path.basename(p);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(p);
  }
  for (const [base, ps] of byBase) {
    if (ps.length > 1) {
      const contents = ps.map((p) => fs.readFileSync(p, "utf8"));
      const first = contents[0];
      const identical = contents.every((c) => c === first);
      mirrored.push({ name: base, identical, paths: ps });
      if (!identical) {
        const mismatched = ps.filter((p, i) => contents[i] !== first);
        failures.push({ file: ps.join(", "), check: "mirror-identity", detail: `mirror files for '${base}' are NOT byte-identical: ${mismatched.join(", ")}`, severity: "RED" });
      }
    }
  }

  // Check 4 (cross-file) — C8 node-convention divergence WARN for the execute/prepare pair.
  const execFile = filePaths.find((p) => path.basename(p) === "execute-milestone.js");
  const prepFile = filePaths.find((p) => path.basename(p) === "prepare-milestone.js");
  if (execFile && prepFile) {
    const execSrc = fs.readFileSync(execFile, "utf8");
    const prepSrc = fs.readFileSync(prepFile, "utf8");
    const warn = nodeConventionWarn({
      execNodes: extractNodeInvocations(execSrc),
      prepNodes: extractNodeInvocations(prepSrc),
      execSrc, prepSrc,
      execPath: execFile, prepPath: prepFile,
    });
    if (warn) warnings.push(warn);
  }

  const ok = failures.length === 0;
  return { ok, files, failures, warnings, informational, mirrored };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const args = { files: [], json: false, workspaceRoot: null, help: false };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--json") { args.json = true; }
    else if (a === "--files") { /* marker — following positionals are file paths */ }
    else if (a === "--workspace-root") { args.workspaceRoot = argv[++i]; }
    else if (a === "--help" || a === "-h") { args.help = true; }
    else if (!a.startsWith("--")) { args.files.push(a); }
    i++;
  }
  return args;
}

function usage() {
  console.log(
    "usage: node workflow-metadata-conformance.mjs [--json] [--workspace-root <dir>] [<file...>]\n" +
    "  --json              emit the full result object as one JSON line (for DoD-gate machine consumption)\n" +
    "  --workspace-root    override the repo root used for the default 2-file list (default: auto-derived)\n" +
    "  <file...>           override the default file list (each file is checked independently)\n" +
    "Exit: 0 = all hard checks pass; 1 = >=1 FAIL; 2 = usage/env error (missing file)."
  );
}

// Resolve the repository root independent of process.cwd() — the DoD gate shells out with cwd at the
// EXPERIMENT root (it0-dod-check.sh cds into experiments/quay-perpetual-stream/), so the default
// 4-file list must be derived from the script's OWN location, not the caller's cwd.
function resolveRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { usage(); process.exit(0); }

  let filePaths;
  if (args.files.length > 0) {
    filePaths = args.files.map((p) => path.resolve(p));
  } else {
    const repoRoot = args.workspaceRoot ? path.resolve(args.workspaceRoot) : resolveRepoRoot();
    filePaths = [
      // gap-retire-the-prepare-execute-pipeline-cluster: prepare-milestone.js / execute-milestone.js
      // were retired with the classic milestone loop (ADR-022).
      // gap-select-preflight-retirement-decision: select-preflight.js retired with the classic
      // OUTER-LOOP SELECT phase (2026-08-16). The surviving checked-in workflows are
      // drain-directives and run-routines (single source in plugin/workflows/ — the .claude/workflows/
      // dual copies were retired by gap-ac166-second-copy-retirement).
      path.join(repoRoot, "plugin/workflows/drain-directives.js"),
      path.join(repoRoot, "plugin/workflows/run-routines.js"),
    ];
  }

  for (const p of filePaths) {
    if (!fs.existsSync(p)) {
      console.error(`ERROR: workflow file not found: ${p}`);
      process.exit(2);
    }
  }

  let result;
  try {
    result = checkAll(filePaths);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(2);
  }

  if (args.json) {
    console.log(JSON.stringify(result));
  } else {
    for (const f of result.failures) console.log(`FAIL: ${f.file} :: ${f.check} :: ${f.detail}`);
    for (const w of result.warnings) console.log(`WARN: ${w.file} :: ${w.check} :: ${w.detail}`);
    for (const i of result.informational) console.log(`INFO: ${i.file} :: ${i.check} :: ${i.detail}`);
    for (const m of result.mirrored) console.log(`MIRROR: ${m.name} — ${m.identical ? "identical" : "DIFFERENT"}`);
    console.log(result.ok ? "PASS: all workflow-metadata conformance checks satisfied." : `FAIL: ${result.failures.length} conformance failure(s).`);
  }

  process.exit(result.ok ? 0 : 1);
}

// Run the CLI only when invoked directly (not when imported by a test).
// ⛔ NOT a URL-equality check. Under a mirror invocation (a deeper `experiments/**/scripts/` copy
// symlinked back to this file), Node resolves `import.meta.url` to the REALPATH while
// `process.argv[1]` keeps the path as written ⇒ URL equality is permanently false, `main()` never
// runs, and the process exits 0 with ZERO output — a "could not read the input" failure printed in
// the same shape as "all clear". Basename match answers the same question on both call paths (the
// same idiom workflow-event-schema.mjs already uses for its own isDirectEntry), and it stays correct
// when this module is inlined into a bundle, whose argv[1] basename is the bundle's.
const isDirect = process.argv[1] != null && path.basename(process.argv[1]) === "workflow-metadata-conformance.mjs";
if (isDirect) main(process.argv.slice(2));
