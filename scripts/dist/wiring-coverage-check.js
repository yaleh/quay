import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/wiring-coverage-check.ts
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/wiring-coverage-check.ts
var WIRING_VERB_RE = /\b(invokes?|calls?|dispatches?|enforces?|wires?|routes?|delegates?)\b|(?<!(?:'s|s'|its|their|my|our|your|his|her|whose)\s)\bowns?\b/i;
var EVIDENCE_RE = /\b(real|production|callsite|call site|reachability|reachable|evidence|wired|confirm(?:ed|s|ation)?|reproduc\w*|verifi(?:ed|es|cation)?|proven?|proves?)\b/i;
function splitListAwareBlocks(paragraph) {
  const lines = paragraph.split(/\n/);
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
function splitSentences(text) {
  return text.split(/\n{2,}/).flatMap((para) => splitListAwareBlocks(para)).flatMap((block) => block.split(/(?<=[.!?]|\*\*)\s+(?=[A-Z`"]|\*\*)/)).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function backtickIdentifiers(sentence) {
  const idents = /* @__PURE__ */ new Set();
  const re = /`([^`]+)`/g;
  let m;
  while (m = re.exec(sentence)) {
    const id = m[1].trim();
    if (id) idents.add(id);
  }
  return [...idents];
}
var STAGE_BOUNDARY_TOKENS = /* @__PURE__ */ new Set([
  // execute-milestone.js phase boundaries (workflow-event-schema.mjs VALID_STAGES)
  "Verify",
  "Prepared",
  "Build",
  "Build-Evidence",
  "Audit",
  "Gate",
  "Reconcile",
  "Land",
  // prepare-milestone.js phase boundaries
  "Admission",
  "Preflight",
  "ProposalAuthors",
  "Adjudicate",
  "ProposalReview",
  "PlanAuthor",
  "PlanCheck",
  "Receipt"
]);
var STAGE_BOUNDARY_WORD_RE = /(?:^|[^A-Za-z])(?:verify|prepared|build|audit|gate|reconcile|land|admission|preflight|proposalauthors|adjudicate|proposalreview|planauthor|plancheck|receipt|stage)(?:[^A-Za-z]|$)/i;
var CLAIM_MARKER_RE = /(?:^|\s)[-*]?\s*\*\*\s*\[?\s*(?:WIRING[- ]CLAIM|CLAIM)[-\s]*[A-Za-z0-9-]*\s*[):.]?\s*\*\*/;
var ENUM_LABEL_RE = /[-_.]?(?:e|ac|c|m|b|a|w|find|finding|claim|clause)\s*[-_.]?\d+\b/gi;
var MIRROR_NAME_RE = /\b(?:execute-milestone|prepare-milestone)(?:\.js)?\b/gi;
function _stageStripped(id) {
  let x = id.replace(STAGE_BOUNDARY_WORD_RE, "").replace(ENUM_LABEL_RE, "").replace(MIRROR_NAME_RE, "workflow");
  x = x.replace(/([a-z])(stage)([A-Z])/gi, "$1$3");
  x = x.replace(/(?:^|[^a-z])emit[-_ ]?event[a-z0-9-]*/i, "emitevent");
  return x;
}
function _normalizedIdents(identifiers) {
  return [
    ...new Set(
      identifiers.filter((id) => !STAGE_BOUNDARY_TOKENS.has(id)).map((id) => _stageStripped(id.trim())).filter(Boolean)
    )
  ];
}
function _patternKey(identifiers) {
  return _normalizedIdents(identifiers).sort().join("\0");
}
function extractMechanismClaims(sectionText) {
  if (!sectionText) return [];
  const claims = [];
  for (const sentence of splitSentences(sectionText)) {
    if (!WIRING_VERB_RE.test(sentence)) continue;
    const identifiers = backtickIdentifiers(sentence);
    if (identifiers.length >= 2) {
      claims.push({ sentence, identifiers });
    }
  }
  const byKey = /* @__PURE__ */ new Map();
  for (const c of claims) {
    const key = _patternKey(c.identifiers);
    if (key === "") continue;
    if (!byKey.has(key)) byKey.set(key, { ...c, sentence: c.sentence });
    else {
      const existing = byKey.get(key);
      existing.sentence += " " + c.sentence;
    }
  }
  return [...byKey.values()];
}
function countMechanisms(sectionText) {
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
  const components = [];
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
      sentence: comp.reps[0].sentence
    }))
  };
}
var MECHANISM_HEADING_RE = /^(?:chosen mechanism|key design decisions|mechanism-claim(?:\s+wiring\s+coverage|\s*(?:→|->|=>|to)\s*(?:ac|acceptance)\s*coverage))\b/i;
var WIRING_CLAIM_MARKER_RE = /^\*\*\s*\[?\s*WIRING[- ]CLAIM\b/i;
function isMechanismSubsectionHeading(headingText) {
  return MECHANISM_HEADING_RE.test((headingText || "").trim());
}
function extractMechanismSubsections(proposalText) {
  if (!proposalText) return "";
  const lines = proposalText.split(/\r?\n/);
  const out = [];
  let inMechanism = false;
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    const h3 = line.match(/^#{3}\s+(.+)$/);
    if (h3) {
      inMechanism = isMechanismSubsectionHeading(h3[1]);
      if (inMechanism) out.push(rawLine);
      i++;
      continue;
    }
    const boldHead = line.match(/^\*\*\s*(.+?)\s*[:.]\s*\*\*/);
    if (boldHead && isMechanismSubsectionHeading(boldHead[1])) {
      inMechanism = true;
      out.push(rawLine);
      i++;
      continue;
    }
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
    if (inMechanism) out.push(rawLine);
    i++;
  }
  return out.join("\n");
}
function sourceForWiringCoverage(sourceSectionText) {
  if (!sourceSectionText) return "";
  const narrowed = extractMechanismSubsections(sourceSectionText);
  return narrowed.trim() !== "" ? narrowed : sourceSectionText;
}
function bulletsOf(sectionText) {
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
    } else if (current !== null && /^\S/.test(line)) {
      bullets.push(current);
      current = null;
    }
  }
  if (current !== null) bullets.push(current);
  return bullets;
}
function checkWiringCoverage(sourceSectionText, acSectionText) {
  if (!sourceSectionText || !sourceSectionText.trim()) {
    return {
      ok: false,
      code: "wiring-coverage-empty-source",
      message: "source section is empty/absent \u2014 nothing to wire-check (fail-closed: an empty source section is indistinguishable from 'never looked'; pass --allow-empty to waive)",
      claims: [],
      uncovered: []
    };
  }
  const claims = extractMechanismClaims(sourceForWiringCoverage(sourceSectionText));
  if (claims.length === 0) {
    return {
      ok: true,
      code: "wiring-coverage-none-claimed",
      message: "no mechanism claims (wiring-verb sentence naming >=2 backtick identifiers) found in the source section",
      claims: [],
      uncovered: []
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
      message: `${uncovered.length} of ${claims.length} mechanism claim(s) have no matching, evidence-requiring '## Acceptance Criteria' item: ${uncovered.map((c) => `"${c.sentence.slice(0, 100)}${c.sentence.length > 100 ? "\u2026" : ""}"`).join("; ")}`,
      claims,
      uncovered
    };
  }
  return {
    ok: true,
    code: "wiring-coverage-complete",
    message: `all ${claims.length} mechanism claim(s) have a matching, evidence-requiring AC item`,
    claims,
    uncovered: []
  };
}
var WIRING_REACHABILITY_DECL_RE = /\d+\s*条[\s\S]*?(读到|读取|样本|现成)|(读到|读取|样本|现成)[\s\S]*?\d+\s*条/;
var REAL_INPUT_PROBE_RE = /(真实|生产|主检出|正本|实读|实跑|回放|真机|argv|\/proc\/|curl|现网|生产环境)/;
var GREP_REAL_FILE_PROBE_RE = /\bgrep\b[^\n]{0,160}?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.(?:md|mjs|js|ts|tsx|mts|cts|json|jsonl|yml|yaml|sh|css|html|py|txt|lock|toml)\b/;
function checkWiringClaimAcProbe(acSectionText) {
  if (!acSectionText || !acSectionText.trim()) return [];
  const findings = [];
  for (const bullet of bulletsOf(acSectionText)) {
    const identifiers = backtickIdentifiers(bullet);
    if (identifiers.length === 0) continue;
    if (!WIRING_REACHABILITY_DECL_RE.test(bullet)) continue;
    if (REAL_INPUT_PROBE_RE.test(bullet)) continue;
    if (GREP_REAL_FILE_PROBE_RE.test(bullet)) continue;
    findings.push({
      code: "wiring-claim-ac-no-probe",
      identifiers,
      bullet,
      message: `AC bullet names a quantified reachability/real-data declaration (${identifiers.map((id) => "`" + id + "`").join(", ")}) but names no real input probe \u2014 a \u771F\u5B9E\u751F\u4EA7\u8F7D\u4F53\u8BB0\u5F55\u6570 / \u771F\u5B9E argv / /proc/<pid>/* / \u771F\u5B9E curl / \u771F\u673A\u56DE\u653E direct\u91CF is required; a string-literal/fixture/mkdtemp self-check is not a probe`
    });
  }
  return findings;
}
function extractSectionForCli(body, heading) {
  const lines = body.split(/\r?\n/);
  const escaped = escapeRegExp(heading);
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
function wiringFindingsFromUncovered(uncovered) {
  return (uncovered || []).map((claim, i) => ({
    subsystem: "wiring-coverage",
    summary: `Mechanism claim has no matching, evidence-requiring AC item: "${claim.sentence.slice(0, 120)}${claim.sentence.length > 120 ? "\u2026" : ""}"`,
    severity: "blocker",
    blocking: true,
    evidence: `checkWiringCoverage() returned uncovered claim #${i + 1}; identifiers: ${claim.identifiers.map((id) => "`" + id + "`").join(", ")}`,
    claimRef: claim.identifiers.join("+"),
    disposition: "unresolved",
    rootCauseKey: "wiring-coverage-format",
    repairable: true
  }));
}
var _runAsCli = (() => {
  try {
    const entryReal = typeof process.argv[1] === "string" ? realpathSync(process.argv[1]) : "";
    return typeof process !== "undefined" && Array.isArray(process.argv) && typeof process.argv[1] === "string" && // Bundler-friendly (gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact):
    // when wiring-coverage-check is BUNDLED into another tool (task-schema → many entries), the
    // inlined module shares the bundle's import.meta.url, so URL equality would falsely fire its
    // CLI block. Basename match distinguishes running wiring-coverage-check itself from being
    // inlined into another entry.
    import.meta.url === pathToFileURL(entryReal).href && path.basename(entryReal).replace(/\.(?:js|ts|mjs)$/, "") === "wiring-coverage-check";
  } catch {
    return false;
  }
})();
if (_runAsCli) {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: wiring-coverage-check.ts --task <path/to/task.md> [--allow-empty]");
  const allowEmpty = argv.includes("--allow-empty");
  const taskIdx = argv.indexOf("--task");
  const taskPath = taskIdx >= 0 ? argv[taskIdx + 1] : void 0;
  if (!taskPath) {
    console.error("usage: wiring-coverage-check.ts --task <path/to/task.md> [--allow-empty]");
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
  let verdict = checkWiringCoverage(proposalText, acText);
  if (verdict.code === "wiring-coverage-empty-source") {
    if (!allowEmpty) {
      console.error(`wiring-coverage-check: ${verdict.message}`);
      process.exit(1);
    }
    verdict = {
      ...verdict,
      ok: true,
      code: "wiring-coverage-empty-source-allow-empty",
      message: "source section is empty/absent but --allow-empty was passed \u2014 the empty-source guard is waived (verification did NOT run; the 'empty' report is explicit)"
    };
  }
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
export {
  EVIDENCE_RE,
  GREP_REAL_FILE_PROBE_RE,
  REAL_INPUT_PROBE_RE,
  WIRING_REACHABILITY_DECL_RE,
  WIRING_VERB_RE,
  backtickIdentifiers,
  bulletsOf,
  checkWiringClaimAcProbe,
  checkWiringCoverage,
  countMechanisms,
  extractMechanismClaims,
  extractMechanismSubsections,
  splitListAwareBlocks,
  splitSentences
};
