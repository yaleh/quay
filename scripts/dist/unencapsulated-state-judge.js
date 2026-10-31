#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/unencapsulated-state-judge.ts
import fs2 from "node:fs";
import path3 from "node:path";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/routine-engine-module-loader.ts
import fs from "node:fs";
import path2 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var SCRIPT_REPO_ROOT = path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "..", "..");
function resolveEngineModuleIn(root, file, dirRel) {
  const tried = [
    path2.join(SCRIPT_REPO_ROOT, dirRel, file),
    path2.join(root, dirRel, file)
  ];
  for (const candidate of tried) {
    if (fs.existsSync(candidate)) return { path: candidate, tried };
  }
  return { path: null, tried };
}
async function importEngineModuleAt(absPath, cache) {
  const cached = cache.get(absPath);
  if (cached !== void 0) return cached;
  const mod = await import(
    /* @vite-ignore */
    pathToFileURL(absPath).href
  );
  cache.set(absPath, mod);
  return mod;
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/unencapsulated-state-judge.ts
var EXIT_OK = 0;
var EXIT_USAGE = 2;
var EXIT_INSTRUMENT = 3;
var JUDGE_KIND = "unencapsulated-state";
var DEFAULT_CORPUS_REL = "plugin/fixtures/unencapsulated-state/recorded-verdicts.json";
var CONTRACT_DIR_REL = "docs/analysis";
var CONTRACT_FILE = "semantic-admission-contract.mjs";
var contractCache = /* @__PURE__ */ new Map();
async function loadContract(root) {
  const r = resolveEngineModuleIn(root, CONTRACT_FILE, CONTRACT_DIR_REL);
  if (r.path === null) {
    throw new Error(
      `CAUSE=semantic-admission-contract-unresolved \u2014 the judge vocabulary lives in ${CONTRACT_FILE} and could not be found; tried ${r.tried.join(" , ")}`
    );
  }
  return importEngineModuleAt(r.path, contractCache);
}
function verdictKey(subject) {
  const base = String(subject ?? "").split(/[\\/]/).pop() ?? "";
  return base.replace(/\.[A-Za-z0-9]+$/, "");
}
function loadCorpus(file) {
  let raw;
  try {
    raw = fs2.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`CAUSE=corpus-unreadable \u2014 ${file} could not be read (${e?.code ?? e?.message ?? e})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`CAUSE=corpus-unparsable \u2014 ${file} is not JSON (${e?.message ?? e})`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`CAUSE=corpus-malformed \u2014 ${file} must be a JSON ARRAY of recorded verdicts (got ${parsed === null ? "null" : typeof parsed})`);
  }
  const seen = /* @__PURE__ */ new Map();
  parsed.forEach((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`CAUSE=corpus-malformed \u2014 ${file}[${i}] is not an object`);
    }
    if (typeof entry.subject !== "string" || entry.subject.trim() === "") {
      throw new Error(`CAUSE=corpus-malformed \u2014 ${file}[${i}] carries no non-empty subject`);
    }
    if (typeof entry.rationale !== "string" || entry.rationale.trim() === "") {
      throw new Error(`CAUSE=corpus-malformed \u2014 ${file}[${i}] (${entry.subject}) carries no rationale; a verdict without a reason is not replayable`);
    }
    if (typeof entry.provenance !== "string" || entry.provenance.trim() === "") {
      throw new Error(`CAUSE=corpus-malformed \u2014 ${file}[${i}] (${entry.subject}) carries no provenance; a recorded verdict must say where the recording came from`);
    }
    const key = verdictKey(entry.subject);
    if (seen.has(key)) {
      throw new Error(`CAUSE=corpus-ambiguous \u2014 ${file} records two verdicts for the same key ${JSON.stringify(key)} (indices ${seen.get(key)} and ${i}); a lookup would silently pick one`);
    }
    seen.set(key, i);
  });
  return parsed;
}
function replayVerdict(candidate, corpus, contract) {
  const subject = typeof candidate === "string" ? candidate : candidate?.subject;
  if (typeof subject !== "string" || subject.trim() === "") {
    throw new Error("CAUSE=unjudgeable-candidate \u2014 the candidate names no subject, so no recorded verdict can be looked up");
  }
  const key = verdictKey(subject);
  const hit = (Array.isArray(corpus) ? corpus : []).find((e) => verdictKey(e?.subject) === key) ?? null;
  if (hit === null) {
    const record2 = contract.judgeRecord({
      candidate_ref: subject,
      verdict: contract.JUDGE_VERDICT.NEEDS_MORE_EVIDENCE,
      rationale: `no recorded verdict names ${JSON.stringify(key)} \u2014 the corpus was read and did not decide this subject (\u7F3A\u503C = \u672A\u67E5; never upgraded to a confirmation)`
    });
    return { ...record2, key, subject, found: false, provenance: null };
  }
  const record = contract.judgeRecord({
    candidate_ref: subject,
    verdict: hit.verdict,
    rationale: hit.rationale,
    counterfactual: hit.counterfactual ?? null
  });
  return { ...record, key, subject, found: true, provenance: hit.provenance ?? null };
}
function judgeCandidates(candidates, corpus, contract) {
  return (Array.isArray(candidates) ? candidates : []).map((c) => replayVerdict(c, corpus, contract));
}
function semanticAdmissionFromJudge(corpus, contract) {
  return (record) => {
    const subject = record?.clue_subject ?? record?.subject ?? null;
    if (typeof subject !== "string" || subject.trim() === "") {
      return { admit: false, verdict: contract.JUDGE_VERDICT.NEEDS_MORE_EVIDENCE };
    }
    const judgment = replayVerdict({ subject }, corpus, contract);
    const out = {
      admit: judgment.verdict === contract.JUDGE_VERDICT.CONFIRMED,
      verdict: judgment.verdict
    };
    if (judgment.counterfactual) out.counterfactual = judgment.counterfactual;
    return out;
  };
}
var USAGE = "unencapsulated-state-judge.ts --subjects <a,b,...> [--corpus <path>] [--json]\n  stage 2 of the two-stage admission pipeline: replays RECORDED verdicts (never a live model).";
async function main(argv) {
  let corpusPath = path3.join(SCRIPT_REPO_ROOT, DEFAULT_CORPUS_REL);
  let subjects = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE + "\n");
      return EXIT_OK;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--corpus") {
      corpusPath = argv[i + 1] ?? "";
      i += 1;
      if (!corpusPath) {
        process.stderr.write("CAUSE=missing-argument \u2014 --corpus needs a path\n" + USAGE + "\n");
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--subjects") {
      const v = argv[i + 1] ?? "";
      i += 1;
      if (!v) {
        process.stderr.write("CAUSE=missing-argument \u2014 --subjects needs a comma-separated list\n" + USAGE + "\n");
        return EXIT_USAGE;
      }
      subjects = v.split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    process.stderr.write(`CAUSE=unknown-argument \u2014 ${a}
` + USAGE + "\n");
    return EXIT_USAGE;
  }
  if (subjects.length === 0) {
    process.stderr.write("CAUSE=no-subjects \u2014 the judge replays recorded verdicts for NAMED subjects\n" + USAGE + "\n");
    return EXIT_USAGE;
  }
  let contract;
  let corpus;
  try {
    contract = await loadContract(SCRIPT_REPO_ROOT);
    corpus = loadCorpus(corpusPath);
  } catch (e) {
    process.stderr.write(`${e?.message ?? e}
`);
    return EXIT_INSTRUMENT;
  }
  let judgments;
  try {
    judgments = judgeCandidates(subjects, corpus, contract);
  } catch (e) {
    process.stderr.write(`CAUSE=corpus-contract-violation \u2014 ${e?.name ?? "Error"}: ${e?.message ?? e}
`);
    return EXIT_INSTRUMENT;
  }
  if (json) {
    process.stdout.write(JSON.stringify({ corpus: corpusPath, judgments }, null, 2) + "\n");
  } else {
    for (const j of judgments) {
      process.stdout.write(`${j.verdict.padEnd(20)} ${j.key}${j.found ? "" : "  (no recorded verdict \u2192 needs-more-evidence)"}
`);
      process.stdout.write(`  ${j.rationale}
`);
      if (j.counterfactual) process.stdout.write(`  counterfactual: ${j.counterfactual}
`);
    }
  }
  return EXIT_OK;
}
if (isDirectEntry(import.meta, process.argv[1], "unencapsulated-state-judge")) {
  process.exit(await main(process.argv.slice(2)));
}
export {
  DEFAULT_CORPUS_REL,
  EXIT_INSTRUMENT,
  EXIT_OK,
  EXIT_USAGE,
  JUDGE_KIND,
  judgeCandidates,
  loadContract,
  loadCorpus,
  main,
  replayVerdict,
  semanticAdmissionFromJudge,
  verdictKey
};
