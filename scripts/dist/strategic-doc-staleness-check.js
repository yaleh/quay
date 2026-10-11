#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/strategic-doc-staleness-check.ts
import fs from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage2) {
  process.stdout.write(usage2.endsWith("\n") ? usage2 : usage2 + "\n");
  process.exit(0);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/code-span-strip.ts
function stripFences(text) {
  return text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ");
}
function stripInlineCodeSpans(text) {
  return text.replace(/`[^`\n]*`/g, " ");
}
function stripCodeSpans(text) {
  return stripInlineCodeSpans(stripFences(text));
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/strategic-doc-staleness-check.ts
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var DELETED_SCRIPTS = [
  "prepare-milestone.js",
  "execute-milestone.js",
  "milestone-worktree.ts"
];
var DELETED_SCRIPT_RE = /\b(prepare-milestone\.js|execute-milestone\.js|milestone-worktree\.ts)\b/g;
var ANNOTATION_RE = /(retired|superseded|RETIRED|SUPERSEDED|historical|ADR-022|then-current|退役|废除|已退休|已废除|已删除)/;
var STRONG_ANNOTATION_RE = /(retired|superseded|RETIRED|SUPERSEDED|ADR-022|退役|废除|已退休|已废除|已删除)/;
var ANNOTATION_WINDOW = 1;
var KNOWN_STALE_DOCS = /* @__PURE__ */ new Set([
  "exp5-deliverable-improvements.md",
  "exp6-queue-driven-concurrent-executor.md",
  "quay-adaptive-task-packing-and-overlap-concurrency.md",
  "quay-harness-crystallization-roadmap.md",
  "quay-milestone-workflow-git-crystallization.md",
  "quay-workflow-agent-distribution.md",
  // orchestration/*.md pre-existing stale refs surfaced by the dead-glob fix
  // (gap-stale-check-orchestration-arm-is-a-dead-glob, 2026-08-05):
  "FINDING-roadmap-predates-ADR-022-retirement-2026-08-05.md",
  "escalations.md",
  "tick-log.md"
]);
function scanText(src) {
  const refs = [];
  const lines = src.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    DELETED_SCRIPT_RE.lastIndex = 0;
    let m;
    while (m = DELETED_SCRIPT_RE.exec(line)) {
      let annotated = ANNOTATION_RE.test(line);
      if (!annotated) {
        for (let j = Math.max(0, i - ANNOTATION_WINDOW); j <= Math.min(lines.length - 1, i + ANNOTATION_WINDOW); j++) {
          if (j === i) continue;
          if (STRONG_ANNOTATION_RE.test(lines[j])) {
            annotated = true;
            break;
          }
        }
      }
      if (annotated) continue;
      refs.push({ line: i + 1, hit: m[0], snippet: line.trim().slice(0, 90) });
    }
  }
  return refs;
}
function collectStrategicDocs(root) {
  const files = [];
  const proposalDir = path2.join(root, "docs", "proposals");
  if (fs.existsSync(proposalDir)) {
    for (const e of fs.readdirSync(proposalDir)) {
      if (e.endsWith(".md")) files.push(path2.join("docs", "proposals", e));
    }
  }
  const orchDir = path2.join(root, "orchestration");
  if (fs.existsSync(orchDir)) {
    for (const e of fs.readdirSync(orchDir)) {
      if (e.endsWith(".md")) files.push(path2.join("orchestration", e));
    }
  }
  return files.sort();
}
function scanStrategicDocs(root) {
  const out = [];
  for (const rel of collectStrategicDocs(root)) {
    let src = "";
    try {
      src = fs.readFileSync(path2.join(root, rel), "utf8");
    } catch {
      continue;
    }
    out.push({ rel, refs: scanText(src), knownStale: KNOWN_STALE_DOCS.has(path2.basename(rel)) });
  }
  return out;
}
function judgePoolCandidate(root, taskId) {
  const abs = path2.join(root, "tasks", `${taskId}.md`);
  if (!fs.existsSync(abs)) return null;
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*```/.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) lines[i] = stripCodeSpans(lines[i]);
  }
  return scanText(lines.join("\n"));
}
function usage() {
  console.error(
    "usage: node strategic-doc-staleness-check.ts [--root <dir>] [--pool-candidate <task-id> | --judge <path>] [--json]\nExit: 0 = PASS; 1 = FAIL (new stale strategic doc, or flagged pool candidate); 2 = usage/env error."
  );
  process.exit(2);
}
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node strategic-doc-staleness-check.ts [--root <dir>] [--pool-candidate <task-id> | --judge <path>] [--json]");
  const asJson = args.includes("--json");
  const rootArg = args.indexOf("--root");
  const root = path2.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  const pcIdx = args.indexOf("--pool-candidate");
  const judgeIdx = args.indexOf("--judge");
  const poolCandidate = pcIdx !== -1 ? args[pcIdx + 1] : void 0;
  const judgePath = judgeIdx !== -1 ? args[judgeIdx + 1] : void 0;
  if (poolCandidate !== void 0 && judgePath !== void 0) usage();
  if (!fs.existsSync(root)) {
    console.error(`ERROR: scan root not found: ${root}`);
    process.exit(2);
  }
  if (poolCandidate !== void 0) {
    const refs = judgePoolCandidate(root, poolCandidate);
    if (refs === null) {
      const msg = `ERROR: pool-candidate task not found: tasks/${poolCandidate}.md`;
      if (asJson) console.log(JSON.stringify({ mode: "pool-candidate", task: poolCandidate, error: msg }));
      else console.error(msg);
      return 2;
    }
    const flagged = refs.length > 0;
    if (asJson) {
      console.log(JSON.stringify({ mode: "pool-candidate", task: poolCandidate, flagged, refs }, null, 2));
    } else if (flagged) {
      console.log(`strategic-doc-staleness-check --pool-candidate ${poolCandidate}`);
      console.log(`FLAGGED: ${refs.length} stale reference(s) to deleted classic-pipeline scripts (unannotated)`);
      for (const r of refs) console.log(`  tasks/${poolCandidate}.md:${r.line}  [${r.hit}]  ${r.snippet}`);
      console.log("FAIL: candidate references a retired mechanism");
    } else {
      console.log(`strategic-doc-staleness-check --pool-candidate ${poolCandidate}: clean (no stale refs)`);
    }
    return flagged ? 1 : 0;
  }
  if (judgePath !== void 0) {
    const abs = path2.isAbsolute(judgePath) ? judgePath : path2.join(root, judgePath);
    if (!fs.existsSync(abs)) {
      console.error(`ERROR: --judge file not found: ${judgePath}`);
      return 2;
    }
    const refs = scanText(fs.readFileSync(abs, "utf8"));
    const flagged = refs.length > 0;
    if (asJson) {
      console.log(JSON.stringify({ mode: "judge", file: judgePath, flagged, refs }, null, 2));
    } else if (flagged) {
      console.log(`strategic-doc-staleness-check --judge ${judgePath}`);
      console.log(`FLAGGED: ${refs.length} stale reference(s) to deleted classic-pipeline scripts (unannotated)`);
      for (const r of refs) console.log(`  ${judgePath}:${r.line}  [${r.hit}]  ${r.snippet}`);
    } else {
      console.log(`strategic-doc-staleness-check --judge ${judgePath}: clean (no stale refs)`);
    }
    return flagged ? 1 : 0;
  }
  const docs = scanStrategicDocs(root);
  const newDocs = docs.filter((d) => d.refs.length > 0 && !d.knownStale);
  const knownFlagging = docs.filter((d) => d.refs.length > 0 && d.knownStale);
  const newRefs = newDocs.reduce((n, d) => n + d.refs.length, 0);
  const knownRefs = knownFlagging.reduce((n, d) => n + d.refs.length, 0);
  const ok = newDocs.length === 0;
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          mode: "strategic-docs",
          scanned: docs.length,
          stale_refs_found: newRefs,
          // the ## Contract measure (band 0)
          new_stale_docs: newDocs.map((d) => ({ rel: d.rel, refs: d.refs.length })),
          known_stale_docs: knownFlagging.map((d) => ({ rel: d.rel, refs: d.refs.length })),
          known_stale_refs: knownRefs,
          ok
        },
        null,
        2
      )
    );
  } else {
    console.log(`strategic-doc-staleness-check \u2014 ${docs.length} strategic doc(s) scanned (docs/proposals + orchestration/*.md)`);
    console.log(`stale_refs_found (new, beyond baseline): ${newRefs}`);
    if (knownFlagging.length) {
      console.log(`known-stale (baseline, reported not counted): ${knownFlagging.length} doc(s), ${knownRefs} ref(s)`);
      for (const d of knownFlagging) console.log(`  ${d.rel}: ${d.refs.length}`);
    }
    for (const d of newDocs) {
      console.log(`NEW-STALE ${d.rel}: ${d.refs.length} unannotated reference(s) to deleted scripts`);
      for (const r of d.refs.slice(0, 8)) console.log(`  ${d.rel}:${r.line}  [${r.hit}]  ${r.snippet}`);
    }
    if (ok) {
      console.log("PASS: no NEW stale strategic doc beyond the KNOWN_STALE baseline");
    } else {
      console.log(`FAIL: ${newDocs.length} NEW stale strategic doc(s) \u2014 a strategic doc references deleted code without annotation`);
    }
  }
  return ok ? 0 : 1;
}
if (isDirectEntry(import.meta, void 0, "strategic-doc-staleness-check")) {
  process.exit(main(process.argv));
}
export {
  ANNOTATION_RE,
  ANNOTATION_WINDOW,
  DELETED_SCRIPTS,
  DELETED_SCRIPT_RE,
  KNOWN_STALE_DOCS,
  STRONG_ANNOTATION_RE,
  collectStrategicDocs,
  judgePoolCandidate,
  main,
  scanStrategicDocs,
  scanText
};
