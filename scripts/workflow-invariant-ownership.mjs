#!/usr/bin/env node
// workflow-invariant-ownership.mjs — DIR-124-A3a: invariant-ownership manifest enforcement.
// Parses invariant-ownership.md (## Invariant: blocks), validates:
//   1. Every invariant has exactly ONE [authoritative] owner (exit 1 on 0 or >1).
//   2. Every [authoritative] owner path resolves to an existing file (exit 1 on missing file).
// Collects deletionList, mirrorList, adapterList from classified occurrences.
// Soft-launch: missing manifest → exit 0 (ok:true) unless --require-manifest.
//
// Usage:
//   node workflow-invariant-ownership.mjs <manifest-path> [--workspace-root <dir>] [--require-manifest] [--check-dsl-mirrors|--check-adapters]
//
// Exit codes: 0 = clean, 1 = violation, 2 = usage/env error.

import fs from "node:fs";
import path from "node:path";

// Import extractSection from the canonical task-schema.ts (DIR-124-A3a DD2 / WIRING-CLAIM A3a-PARSE).
// Node >=20 with --experimental-strip-types (or Node >=23 unflagged) handles .ts imports from .mjs.
import { extractSection } from "./task-schema.ts";
// The spec-driven shared arg parser (gate-script-base.ts). This module previously carried its own
// while-loop flag parser — one of the "three spelling variants" named by semantic-dedup-scan finding
// `parse-args-handrolled-variants` (runId `semantic-dedup-scan-1791536153223`).
import { parseArgs as baseParseArgs } from "./gate-script-base.ts";

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
// The flag loop is the SHARED spec-driven parser; this wrapper only maps the raw flag strings onto
// this command's shape. It could not fold while the shared parser `process.exit()`ed on `--help`
// (now it uses the non-exiting `help: "return"` mode and prints its own usage from `main`).
// `main` takes the SLICED argv tail, so the two leading slots the shared parser skips are re-attached.
function parseArgs(argv) {
  const { args, flags, help } = baseParseArgs(["node", "workflow-invariant-ownership.mjs", ...argv], {
    minArgs: 0,
    usage: "<manifest-path> [--workspace-root <dir>] [--require-manifest] [--check-dsl-mirrors|--check-adapters] [--help]",
    help: "return",
    flags: {
      "workspace-root": { type: "string" },
      "require-manifest": { type: "boolean" },
      "check-dsl-mirrors": { type: "boolean" },
      "check-adapters": { type: "boolean" },
    },
  });
  return {
    manifestPath: args.length > 0 ? args[0] : null,
    workspaceRoot: typeof flags["workspace-root"] === "string" && flags["workspace-root"] !== "" ? flags["workspace-root"] : process.cwd(),
    requireManifest: flags["require-manifest"] === true,
    checkDslMirrors: flags["check-dsl-mirrors"] === true,
    checkAdapters: flags["check-adapters"] === true,
    help: help === true,
  };
}

const USAGE_LINE = "usage: node workflow-invariant-ownership.mjs <manifest-path> [--workspace-root <dir>] [--require-manifest] [--check-dsl-mirrors|--check-adapters]";

// `--help` (exit 0, usage on stdout) and a missing manifest (exit 2, usage on stderr) share ONE
// usage string — the exit code is the only difference.
function usage(exitCode = 2) {
  if (exitCode === 0) console.log(USAGE_LINE);
  else console.error(USAGE_LINE);
  process.exit(exitCode);
}

// ── Parsing helpers ────────────────────────────────────────────────────────────────────────────────

// Discover all invariant names from the manifest text (find "## Invariant: <name>" headings),
// then extract each block via extractSection (the canonical parser from task-schema.ts).
function parseInvariantBlocks(fullText) {
  const headingRe = /^## Invariant: (.+)$/gm;
  const names = [];
  let m;
  while ((m = headingRe.exec(fullText)) !== null) {
    names.push(m[1].trim());
  }
  const blocks = [];
  for (const name of names) {
    const section = extractSection(fullText, `Invariant: ${name}`);
    if (section !== null) {
      blocks.push({ invariant: name, text: section });
    }
  }
  return blocks;
}

// Parse the "**Authoritative owner:**" line from a block.
// Format: - **Authoritative owner:** `<path>` `[authoritative]`
// Returns { path, classification } or null if not found.
function parseAuthoritativeOwner(blockText) {
  const ownerLineRe = /^\s*-\s+\*\*Authoritative owner:\*\*\s*(.+)$/im;
  const match = blockText.match(ownerLineRe);
  if (!match) return null;
  const line = match[1].trim();

  // Extract backtick-quoted path before the classification tag.
  const pathRe = /`([^`]+)`\s+`\[authoritative\]`/i;
  const pathMatch = line.match(pathRe);
  if (!pathMatch) return null;
  return { path: pathMatch[1].trim(), classification: "authoritative" };
}

// Parse "**Other occurrences:**" entries from a block.
// Each entry: - `<path>` `[classification]` -- `<rationale>`
function parseOtherOccurrences(blockText) {
  const entries = [];
  // Find the "Other occurrences:" line, then capture list items until next heading or end-of-section.
  const occSectionRe = /^\s*-\s*\*\*Other occurrences:\*\*\s*$\n?([\s\S]*?)(?=\n##|$)/im;
  const occMatch = blockText.match(occSectionRe);
  if (!occMatch) return entries;

  const occText = occMatch[1];
  const itemRe = /^\s*-\s*`([^`]+)`\s*`\[([^\]]+)\]`\s*--\s*(.+)$/gm;
  let m;
  while ((m = itemRe.exec(occText)) !== null) {
    entries.push({ path: m[1].trim(), classification: m[2].trim(), rationale: m[3].trim() });
  }
  return entries;
}

// ── Classification ─────────────────────────────────────────────────────────────────────────────────
const VALID_CLASSIFICATIONS = new Set([
  "authoritative",
  "compatibility-adapter",
  "dsl-necessity-mirror",
  "generated-view",
  "duplicate-to-remove",
]);

function classifyEntry(entry, invariant) {
  if (entry.classification === "compatibility-adapter") return "adapterList";
  if (entry.classification === "dsl-necessity-mirror") return "mirrorList";
  if (entry.classification === "duplicate-to-remove") return "deletionList";
  return null; // generated-view or unknown — informational only, no action list
}

// ── Main ───────────────────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const args = parseArgs(argv);
  if (args.help) usage(0);

  if (!args.manifestPath) usage();

  // Soft-launch: missing manifest → exit 0 with warning.
  if (!fs.existsSync(args.manifestPath)) {
    if (args.requireManifest) {
      console.error(`ERROR: manifest file not found (--require-manifest set): ${args.manifestPath}`);
      process.exit(2);
    }
    console.log(JSON.stringify({
      ok: true,
      violations: [],
      deletionList: [],
      mirrorList: [],
      adapterList: [],
      totalInvariants: 0,
      warnings: [`no manifest found at ${args.manifestPath} -- invariant ownership unchecked`],
    }));
    process.exit(0);
  }

  const fullText = fs.readFileSync(args.manifestPath, "utf8");

  let blocks;
  try {
    blocks = parseInvariantBlocks(fullText);
  } catch (e) {
    console.error(`ERROR: failed to parse manifest: ${e.message}`);
    process.exit(2);
  }

  const violations = [];
  const deletionList = [];
  const mirrorList = [];
  const adapterList = [];

  for (const block of blocks) {
    const owner = parseAuthoritativeOwner(block.text);

    // Rule 1: Exactly one authoritative owner.
    if (!owner) {
      violations.push({
        invariant: block.invariant,
        rule: "single-authoritative-owner",
        detail: "orphaned invariant: no [authoritative] owner line found",
      });
    } else {
      // Check for duplicate [authoritative] lines (more than one).
      const authCount = (block.text.match(/`\[authoritative\]`/gi) || []).length;
      if (authCount > 1) {
        const authLines = [];
        const re = /^\s*-\s*\*\*Authoritative owner:\*\*\s*(.+)$/gim;
        let m;
        while ((m = re.exec(block.text)) !== null) {
          if (/\[authoritative\]/i.test(m[1])) authLines.push(m[1].trim());
        }
        violations.push({
          invariant: block.invariant,
          rule: "single-authoritative-owner",
          detail: `duplicate authoritative owners (${authCount}): ${authLines.join("; ")}`,
        });
      } else {
        // Rule 2: Owner path must resolve to an existing file.
        const resolvedPath = path.isAbsolute(owner.path)
          ? owner.path
          : path.resolve(args.workspaceRoot, owner.path);
        if (!fs.existsSync(resolvedPath)) {
          violations.push({
            invariant: block.invariant,
            rule: "owner-file-exists",
            detail: `authoritative owner path does not resolve to an existing file: ${owner.path} (resolved: ${resolvedPath})`,
          });
        }
      }
    }

    // Parse other occurrences and classify.
    const occurrences = parseOtherOccurrences(block.text);
    for (const occ of occurrences) {
      const list = classifyEntry(occ, block.invariant);
      if (list === "deletionList") {
        deletionList.push({ invariant: block.invariant, path: occ.path, classification: occ.classification, rationale: occ.rationale });
      } else if (list === "mirrorList") {
        const authSource = owner ? owner.path : null;
        mirrorList.push({ invariant: block.invariant, path: occ.path, authoritativeSource: authSource, classification: occ.classification, rationale: occ.rationale });
      } else if (list === "adapterList") {
        const authSource = owner ? owner.path : null;
        adapterList.push({ invariant: block.invariant, path: occ.path, authoritativeSource: authSource, rationale: occ.rationale });
      }
    }
  }

  // Forward-compat flags — no-ops with a diagnostic message (deferred to DIR-124-B).
  if (args.checkDslMirrors) {
    console.error("NOTE: --check-dsl-mirrors is not yet implemented (deferred to DIR-124-B)");
  }
  if (args.checkAdapters) {
    console.error("NOTE: --check-adapters is not yet implemented (deferred to DIR-124-B)");
  }

  const ok = violations.length === 0;
  const output = {
    ok,
    violations,
    deletionList,
    mirrorList,
    adapterList,
    totalInvariants: blocks.length,
  };

  console.log(JSON.stringify(output, null, 2));
  process.exit(ok ? 0 : 1);
}

main(process.argv.slice(2));
