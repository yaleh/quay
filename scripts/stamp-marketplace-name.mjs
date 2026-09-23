#!/usr/bin/env node
// stamp-marketplace-name.mjs — stamp an ASSEMBLED plugin tree's `.claude-plugin/marketplace.json`
// `name` with the RELEASE channel's marketplace name.
//
// ── WHY (2026-09-23) ──────────────────────────────────────────────────────────────────────────────
// A Claude Code marketplace name is ONE machine-wide slot, and a directory-source marketplace loads its
// plugin IN PLACE (no install record needed). While the repo's `plugin/` declared itself as `quay`, the
// dev tree owned the release channel's slot: every project on the machine that enabled `quay@quay`
// (quay-fleet, meta-cc, lan, claudecodeui — measured with `claude mcp list`) ran quay's MCP straight
// from this working tree. So the SOURCE form of `plugin/.claude-plugin/marketplace.json` is now
// `quay-dev` (this repo dogfoods `quay@quay-dev`), and every PUBLISHED copy is stamped back to the
// release name here — the same source-form vs build-form split `stamp-version` already makes for the
// `-dev` version suffix.
//
// ⛔ Stamp COPIES only (publish-dist-branch.sh's assembled tree, package.sh's staged snapshot). Never
// point it at the repo's own `plugin/`: that would hand the dev tree the release slot again.
//
// The release name is NOT a literal here: it is read from the repo-root `.claude-plugin/marketplace.json`
// — the marketplace `/plugin marketplace add yaleh/quay` actually registers — so the published plugin
// tree and the published marketplace cannot disagree about what the channel is called.
//
// Plain ESM with no dependencies: package.sh runs on the Node-20 floor (ci.yml dist-verify-node-floor).
//
// Usage: node scripts/stamp-marketplace-name.mjs --root <assembled plugin tree> [--repo-root <repo>]
//   exit 0 = stamped (or already the release name); exit 1 = an input is missing/unreadable (fail-closed:
//   a published tree without a readable marketplace.json is not something to wave through).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKETPLACE_REL = path.join(".claude-plugin", "marketplace.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** The release channel's marketplace name, read from the repo-root marketplace. */
export function releaseMarketplaceName(repoRoot) {
  const name = readJson(path.join(repoRoot, MARKETPLACE_REL)).name;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`${path.join(repoRoot, MARKETPLACE_REL)} has no string "name"`);
  }
  return name;
}

/** Rewrite `<root>/.claude-plugin/marketplace.json` `name` to the release name; returns {from, to}. */
export function stampMarketplaceName(root, repoRoot) {
  const to = releaseMarketplaceName(repoRoot);
  const file = path.join(root, MARKETPLACE_REL);
  const raw = fs.readFileSync(file, "utf8");
  const json = JSON.parse(raw);
  const from = json.name;
  if (from !== to) {
    json.name = to;
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  }
  return { from, to, file };
}

function main(argv) {
  let root;
  let repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--repo-root") repoRoot = argv[++i];
    else {
      console.error(`stamp-marketplace-name: unknown argument ${argv[i]}`);
      return 1;
    }
  }
  if (!root) {
    console.error("usage: stamp-marketplace-name.mjs --root <assembled plugin tree> [--repo-root <repo>]");
    return 1;
  }
  try {
    const { from, to, file } = stampMarketplaceName(path.resolve(root), path.resolve(repoRoot));
    console.log(`STAMP-MARKETPLACE-NAME: ${file}: ${JSON.stringify(from)} => ${JSON.stringify(to)}`);
    return 0;
  } catch (err) {
    console.error(`STAMP-MARKETPLACE-NAME: FAILED — ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
