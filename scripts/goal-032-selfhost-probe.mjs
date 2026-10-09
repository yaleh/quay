#!/usr/bin/env node
// scripts/goal-032-selfhost-probe.mjs — GOAL-032 ② (task
// gap-goal032-selfhost-and-archguard-evidence), the module-resolution identity proof plus the
// ArchGuard before/after readings AC-348 is judged on.
//
// ⛔ WHY IT LIVES AT THE REPO ROOT AND NOT IN `plugin/scripts/` (the task's Touches originally
// named `plugin/scripts/goal032-selfhost-probe.mjs`): `plugin/` is the PUBLISHED tree — a `.mjs`
// there is not stripped by publish-dist-branch.sh (it strips only raw `.ts`), so it ships into
// every user's install and pushes the artifact past the size ceiling recorded in
// `plugin/shipped-set-baseline.json` (`shipped.files: 264`). That is the GOAL-029 class
// (dev-only content in the artifact) and it is exactly what the same task hit on GOAL-031
// (`scripts/goal-031-selfhost-probe.mjs`'s own header records the +1-file red). This file follows
// its two siblings — `scripts/branch-selfhost-probe.mjs` (GOAL-030) and
// `scripts/goal-031-selfhost-probe.mjs` (GOAL-031) — and never ships.
//
// ============================ WHAT THIS PROVES ============================
// (A) MODULE-RESOLUTION IDENTITY. GOAL-032 §验证步骤 4: when the goal branch's own worktree is the
// root a process runs from, the three modules the regression tests load resolve to THAT worktree's
// own files — not the main checkout's stale copies. The reading is taken by a CHILD `node` process
// whose cwd IS the tree under evaluation: the child asks Node's own ESM resolver
// (`import.meta.resolve`) for each entry's URL (resolved against `import.meta.url`, i.e.
// `<cwd>/[eval1]`) and then actually `import()`s it. So `loadedFrom` is where the loader looks *when
// rooted there*, not a path the parent glued together. A child rooted in the main checkout reads a
// different (or unresolvable) result — the negative control — which is what makes `allMatch` a
// falsifiable reading rather than a tautology (硬规则 4). The three entries and why they are the
// right three: `packages/quay/src/kernel/verdict-parse.ts` is the new kernel owner,
// `packages/quay/src/criterion-fidelity.ts` is the product-side consumer,
// `plugin/scripts/goal-driver.ts` is the methodology-side consumer.
//
// ⛔ `import()`ing `goal-driver.ts` does NOT run a driver round: its bottom is guarded by
// `isDirectEntry(import.meta, undefined, "goal-driver")`, so a non-entry import only evaluates the
// module's declarations (the same fact GOAL-030/031 relied on).
//
// (B) ARCHGUARD BEFORE/AFTER. Same ArchGuard build, same instrument, same directory shape on both
// sides (`sources = ["packages", "plugin/scripts"]`, test files excluded — the same expand surface
// the MCP `archguard_detect_duplicates` tool uses), only the tree differs:
//   · `before` = a pristine tree of a git ref (default `develop`), materialized with
//     `git archive <ref> packages plugin/scripts` into a throwaway dir — no worktree, no checkout,
//     no mutation of the shared repo.
//   · `after`  = the tree under test (this task's worktree, which carries task ①'s change).
// Two readings per side, both mechanical:
//   · `duplicateGroupPresent` — archguard's own `detectDuplicates` returns a group whose members
//     include BOTH `criterion-fidelity.ts` and `goal-driver.ts`. before=true (the reproduced
//     duplicate), after=false (the group is gone).
//   · `canonicalDefinitionCount` — the count of DISTINCT FILES that carry a function whose
//     structural fingerprint equals the algorithm's (archguard's own `fingerprintSourceText`, the
//     same normalizer `detectDuplicates` uses). 口径 = "implementation sites of this algorithm":
//     before=2 (two verbatim copies), after=1 (the kernel's single implementation; the two wrappers
//     are one-line delegations with their own, different, hashes). The anchor is located by
//     (file, function name) — `parseFidelityVerdict` before, `parseBinaryVerdict` after — so the
//     instrument, not the author, decides which functions count.
//
// (C) CONSUMER CONVERGENCE EVIDENCE. The literal call-site text of `parseBinaryVerdict` in each
// consumer, read off the `after` tree from disk — a grep result, not a restatement of intent.
//
// Usage:
//   node scripts/goal-032-selfhost-probe.mjs \
//     --identity-tree <abs tree>          # tree whose own files must be the ones resolved
//     --after-tree    <abs tree>          # archguard "after" tree (default: identity-tree)
//     [--before-ref   <git ref>]          # default: develop
//     [--repo-root    <abs>]              # default: derived from --identity-tree's git dir
//     [--entry        <rel>]              # repeatable; defaults to the three modules below
//     [--require-substring <s>]           # default: goal-GOAL-032
//     [--also         <abs tree>]         # repeatable; extra honest readings, not part of allMatch
//     [--main         <abs>]              # negative-control root (default: derived)
//     [--out-dir      <abs dir>]          # default: <repo-root>/.quay/goal-032-evidence
//     [--archguard-root <abs>]            # default: ARCHGUARD_ROOT env, then the plugin npm-cache
//     [--json]                            # also echo both documents to stdout
// Exit:
//   0 = both documents written AND identity matched (allMatch === true, group present->absent,
//       canonical count before=2 / after=1)
//   1 = ran, but a reading contradicts the expected before/after shape (`CAUSE=` on stderr)
//   3 = could not be evaluated (bad args, missing tree, git archive failed, archguard not found,
//       child spawn/import failure that no reading can be taken from)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const EXIT_OK = 0;
const EXIT_MISMATCH = 1;
const EXIT_NOT_EVALUATED = 3;

const DEFAULT_ENTRIES = [
  "packages/quay/src/kernel/verdict-parse.ts",
  "packages/quay/src/criterion-fidelity.ts",
  "plugin/scripts/goal-driver.ts",
];
const DEFAULT_SOURCES = ["packages", "plugin/scripts"];
const DEFAULT_REQUIRED_SUBSTRING = "goal-GOAL-032";

// ── args ────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    identityTree: "",
    afterTree: "",
    beforeRef: "develop",
    repoRoot: "",
    entries: [],
    requireSubstring: DEFAULT_REQUIRED_SUBSTRING,
    also: [],
    main: "",
    outDir: "",
    archguardRoot: "",
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--identity-tree") out.identityTree = argv[++i] ?? "";
    else if (a === "--after-tree") out.afterTree = argv[++i] ?? "";
    else if (a === "--before-ref") out.beforeRef = argv[++i] ?? "";
    else if (a === "--repo-root") out.repoRoot = argv[++i] ?? "";
    else if (a === "--entry") out.entries.push(argv[++i] ?? "");
    else if (a === "--require-substring") out.requireSubstring = argv[++i] ?? "";
    else if (a === "--also") out.also.push(argv[++i] ?? "");
    else if (a === "--main") out.main = argv[++i] ?? "";
    else if (a === "--out-dir") out.outDir = argv[++i] ?? "";
    else if (a === "--archguard-root") out.archguardRoot = argv[++i] ?? "";
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "usage: node scripts/goal-032-selfhost-probe.mjs --identity-tree <abs> [--after-tree <abs>]\n" +
          "       [--before-ref <ref>] [--repo-root <abs>] [--entry <rel>]... [--require-substring <s>]\n" +
          "       [--also <abs>]... [--main <abs>] [--out-dir <abs>] [--archguard-root <abs>] [--json]",
      );
      process.exit(EXIT_OK);
    } else {
      console.error(`goal-032-selfhost-probe: unknown arg: ${a}`);
      process.exit(EXIT_NOT_EVALUATED);
    }
  }
  return out;
}

const realDir = (p) => {
  const abs = fs.realpathSync(p);
  if (!fs.statSync(abs).isDirectory()) throw new Error(`not a directory: ${p}`);
  return abs;
};

// ── (A) module-resolution identity ──────────────────────────────────────────────────────────────
// The child program is intentionally tiny and self-contained: it must observe the loader behaviour
// of a process whose cwd is the tree under evaluation, so it cannot reuse anything from the
// parent's location. One JSON line per entry on stdout.
const CHILD_SCRIPT = `
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const rawEntries = JSON.parse(process.env.PROBE_ENTRIES);
const results = [];
for (const raw of rawEntries) {
  // A specifier with no ./ or / prefix is a BARE package name; a tree-relative path must be spelled
  // ./… so it resolves against import.meta.url (cwd/[eval1]) rather than against node_modules.
  const entry = raw.startsWith(".") || raw.startsWith("/") ? raw : "./" + raw;
  const rec = { entry: raw };
  try {
    const url = import.meta.resolve(entry);
    rec.resolvedUrl = url;
    rec.loadedFrom = fs.realpathSync(fileURLToPath(url));
  } catch (e) {
    rec.resolveError = e && e.message ? e.message : String(e);
  }
  try {
    await import(entry);
    rec.loaded = true;
  } catch (e) {
    rec.loaded = false;
    rec.loadError = e && e.message ? e.message : String(e);
  }
  results.push(rec);
}
console.log(JSON.stringify({ cwd: process.cwd(), results }));
`;

function readIdentity(root, entries) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", CHILD_SCRIPT],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 180_000,
      env: {
        ...process.env,
        PROBE_ENTRIES: JSON.stringify(entries),
        // A leaked goal-acceptance env poisons criterion readings (and this probe is not a criterion).
        QUAY_GOAL_ACCEPTANCE_ACTIVE: "",
      },
    },
  );
  if (r.error || r.status !== 0) {
    return { root, error: r.error ? String(r.error) : `child exit ${r.status}: ${(r.stderr || "").slice(0, 400)}` };
  }
  const line = String(r.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    return { root, ...JSON.parse(line) };
  } catch {
    return { root, error: `unparseable child output: ${line.slice(0, 400)}` };
  }
}

function identityBlock(reading, treeRoot, requiredSubstring) {
  if (reading.error) return { root: treeRoot, error: reading.error };
  const entries = (reading.results ?? []).map((rec) => {
    const insideTree =
      typeof rec.loadedFrom === "string" && (rec.loadedFrom === treeRoot || rec.loadedFrom.startsWith(treeRoot + path.sep));
    return {
      ...rec,
      insideTree: typeof rec.loadedFrom === "string" ? insideTree : null,
      hasRequiredSubstring: typeof rec.loadedFrom === "string" ? rec.loadedFrom.includes(requiredSubstring) : null,
    };
  });
  const allMatch =
    entries.length > 0 &&
    entries.every((e) => e.loaded === true && e.insideTree === true && e.hasRequiredSubstring === true);
  return { treeRoot, cwd: reading.cwd, entries, allMatch };
}

// ── (B) ArchGuard readings ──────────────────────────────────────────────────────────────────────
function resolveArchguardRoot(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.ARCHGUARD_ROOT) candidates.push(process.env.ARCHGUARD_ROOT);
  candidates.push(
    path.join(os.homedir(), ".claude", "plugins", "npm-cache", "node_modules", "@yalehwang", "archguard"),
  );
  for (const c of candidates) {
    if (!c) continue;
    try {
      const abs = fs.realpathSync(c);
      if (fs.existsSync(path.join(abs, "dist", "analysis", "duplicates", "group.js"))) return abs;
    } catch {
      /* try next */
    }
  }
  return "";
}

// Materialize `<ref>:packages plugin/scripts` into a throwaway dir. Deliberately NOT a worktree and
// NOT a checkout into the shared repo: `git archive` reads the object store and writes nothing back.
function materializeRef(repoRoot, ref, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const r = spawnSync(
    "bash",
    ["-c", `git -C ${JSON.stringify(repoRoot)} archive ${JSON.stringify(ref)} -- packages plugin/scripts | tar -x -C ${JSON.stringify(dest)}`],
    { encoding: "utf8", timeout: 300_000 },
  );
  if (r.error || r.status !== 0) {
    return { ok: false, error: r.error ? String(r.error) : `git archive|tar exit ${r.status}: ${(r.stderr || "").slice(0, 400)}` };
  }
  return { ok: true };
}

const FP_MOD = "parser/function-fingerprint.js";
const DUP_MOD = "analysis/duplicates/group.js";

// Load the archguard instrument (same build both sides — 硬规则 4b: an instrument that changes
// between readings cannot compare them).
async function loadInstrument(archguardRoot) {
  const dup = await import(path.join(archguardRoot, "dist", DUP_MOD));
  const fp = await import(path.join(archguardRoot, "dist", FP_MOD));
  const pkg = JSON.parse(fs.readFileSync(path.join(archguardRoot, "package.json"), "utf8"));
  return { detectDuplicates: dup.detectDuplicates, collectSourceFiles: dup.collectSourceFiles, fingerprintSourceText: fp.fingerprintSourceText, version: pkg.version };
}

async function archguardReading(instrument, root, sources, anchor) {
  const analysis = await instrument.detectDuplicates(root, sources, { topN: 100 });
  const targetGroup = analysis.groups.find(
    (g) =>
      g.members.some((m) => m.file.endsWith("criterion-fidelity.ts")) &&
      g.members.some((m) => m.file.endsWith("goal-driver.ts")),
  );
  // canonicalDefinitionCount: count DISTINCT FILES carrying a function whose structural fingerprint
  // equals the anchor function's — the same normalizer detectDuplicates groups by.
  const files = instrument.collectSourceFiles(root, sources, false);
  const all = [];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    try {
      all.push(...instrument.fingerprintSourceText(fs.readFileSync(f, "utf-8"), rel));
    } catch {
      /* unparseable file: excluded, same as detectDuplicates */
    }
  }
  const anchorFp = all.find((f) => f.file === anchor.file && f.name === anchor.name);
  const filesWithHash = anchorFp
    ? [...new Set(all.filter((f) => f.hash === anchorFp.hash).map((f) => f.file))].sort()
    : [];
  return {
    scannedFiles: analysis.manifest.scannedFiles,
    scannedFunctions: analysis.manifest.scannedFunctions,
    totalGroups: analysis.manifest.totalGroups,
    duplicateGroupPresent: Boolean(targetGroup),
    duplicateGroup: targetGroup
      ? {
          hash: targetGroup.hash,
          tokenCount: targetGroup.tokenCount,
          statementCount: targetGroup.statementCount,
          members: targetGroup.members.map((m) => ({ file: m.file, startLine: m.startLine, endLine: m.endLine, name: m.name })),
        }
      : null,
    canonicalDefinitionAnchor: anchorFp
      ? { file: anchorFp.file, name: anchorFp.name, hash: anchorFp.hash, tokenCount: anchorFp.tokenCount, statementCount: anchorFp.statementCount }
      : { file: anchor.file, name: anchor.name, error: "anchor function not found in the scanned set" },
    canonicalDefinitionCount: filesWithHash.length,
    canonicalDefinitionFiles: filesWithHash,
  };
}

// ── (C) consumer convergence evidence ───────────────────────────────────────────────────────────
// Read the literal call-site text off the after tree — a grep result, not a restatement of intent.
function grepCallSites(root, relFiles, needle) {
  const out = [];
  for (const rel of relFiles) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(needle)) {
        out.push({ file: rel, line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.identityTree) {
    console.error("goal-032-selfhost-probe: --identity-tree is required");
    return EXIT_NOT_EVALUATED;
  }
  const entries = args.entries.length ? args.entries : DEFAULT_ENTRIES;

  let identityTree;
  let afterTree;
  try {
    identityTree = realDir(args.identityTree);
    afterTree = args.afterTree ? realDir(args.afterTree) : identityTree;
  } catch (e) {
    console.error(`CAUSE=tree-not-a-directory — ${e.message}`);
    return EXIT_NOT_EVALUATED;
  }

  // repo root + main checkout (the negative control) derived from the git common dir — never glued
  // together by the parent.
  let repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : "";
  let mainRoot = args.main ? path.resolve(args.main) : "";
  try {
    const commonGitDir = execFileSync(
      "git",
      ["-C", identityTree, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8" },
    ).trim();
    if (!repoRoot) repoRoot = fs.realpathSync(path.dirname(commonGitDir));
    if (!mainRoot) mainRoot = fs.realpathSync(path.dirname(commonGitDir));
  } catch (e) {
    console.error(`CAUSE=repo-root-underivable — ${e.message}`);
    return EXIT_NOT_EVALUATED;
  }
  const outDir = args.outDir ? path.resolve(args.outDir) : path.join(repoRoot, ".quay", "goal-032-evidence");

  const archguardRoot = resolveArchguardRoot(args.archguardRoot);
  if (!archguardRoot) {
    console.error("CAUSE=archguard-not-found — pass --archguard-root or set ARCHGUARD_ROOT");
    return EXIT_NOT_EVALUATED;
  }
  let instrument;
  try {
    instrument = await loadInstrument(archguardRoot);
  } catch (e) {
    console.error(`CAUSE=archguard-load-failed — ${e.message}`);
    return EXIT_NOT_EVALUATED;
  }

  // ── A: identity ──
  const primary = readIdentity(identityTree, entries);
  if (primary.error) {
    console.error(`CAUSE=child-import-failed — ${primary.error}`);
    return EXIT_NOT_EVALUATED;
  }
  const identity = identityBlock(primary, identityTree, args.requireSubstring);
  const alsoReadings = [];
  for (const extra of args.also) {
    if (!extra) continue;
    let extraRoot;
    try {
      extraRoot = realDir(extra);
    } catch {
      alsoReadings.push({ root: extra, error: "not a directory" });
      continue;
    }
    const rd = readIdentity(extraRoot, entries);
    alsoReadings.push(identityBlock(rd, extraRoot, args.requireSubstring));
  }
  let negativeControl = null;
  if (mainRoot && mainRoot !== identityTree) {
    const nc = readIdentity(mainRoot, entries);
    const block = identityBlock(nc, mainRoot, args.requireSubstring);
    negativeControl = {
      ...block,
      differsFromPrimary: block.allMatch === true ? false : true,
    };
  }
  const selfhostDoc = {
    resolved: Object.fromEntries(identity.entries.map((e) => [e.entry, e.loadedFrom ?? null])),
    worktreeRoot: identity.treeRoot,
    allMatch: identity.allMatch,
    requiredSubstring: args.requireSubstring,
    entries: identity.entries,
    ...(alsoReadings.length ? { alsoReadings } : {}),
    method:
      "child node process with cwd = the tree under evaluation; import.meta.resolve(entry) + realpathSync + real import(); entries spelled ./<rel> so they resolve against import.meta.url (cwd/[eval1])",
    negativeControl,
    generatedAt: new Date().toISOString(),
  };

  // ── B: archguard before/after ──
  const beforeSha = execFileSync("git", ["-C", repoRoot, "rev-parse", args.beforeRef], { encoding: "utf8" }).trim();
  const afterSha = execFileSync("git", ["-C", afterTree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "goal032-before-"));
  let beforeDoc;
  try {
    const mat = materializeRef(repoRoot, args.beforeRef, tmp);
    if (!mat.ok) {
      console.error(`CAUSE=before-tree-materialization-failed — ${mat.error}`);
      return EXIT_NOT_EVALUATED;
    }
    const beforeReading = await archguardReading(instrument, tmp, DEFAULT_SOURCES, {
      file: "packages/quay/src/criterion-fidelity.ts",
      name: "parseFidelityVerdict",
    });
    const afterReading = await archguardReading(instrument, afterTree, DEFAULT_SOURCES, {
      file: "packages/quay/src/kernel/verdict-parse.ts",
      name: "parseBinaryVerdict",
    });
    beforeDoc = {
      before: {
        ref: args.beforeRef,
        sha: beforeSha,
        tree: `git archive ${args.beforeRef} -- packages plugin/scripts → ${tmp}`,
        sources: DEFAULT_SOURCES,
        ...beforeReading,
      },
      after: {
        tree: afterTree,
        sha: afterSha,
        sources: DEFAULT_SOURCES,
        ...afterReading,
      },
      consumerConvergenceEvidence: [
        ...grepCallSites(afterTree, ["packages/quay/src/criterion-fidelity.ts"], "parseBinaryVerdict("),
        ...grepCallSites(afterTree, ["plugin/scripts/goal-driver.ts"], "parseBinaryVerdict("),
      ],
      canonicalDefinitionCountMethod:
        "distinct FILES in the scanned set carrying a function whose ARCHGUARD STRUCTURAL FINGERPRINT equals the anchor function's (fingerprintSourceText — the same normalizer detectDuplicates groups by). Anchor located by (file, function name): parseFidelityVerdict before, parseBinaryVerdict after. Not name-based and not hand-counted: the instrument decides which functions match.",
      method: {
        instrument: `archguard ${instrument.version} detectDuplicates + fingerprintSourceText (${archguardRoot})`,
        sources: DEFAULT_SOURCES,
        options: { minStatements: 6, minTokens: 50, includeTests: false },
        scopeNote:
          "same instrument, same directory shape, only the tree differs — before is a git-archive of the ref (no worktree, no checkout, nothing written back), after is the tree under test",
      },
      generatedAt: new Date().toISOString(),
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  const identityPath = path.join(outDir, "selfhost-identity.json");
  const archguardPath = path.join(outDir, "archguard-before-after.json");
  fs.writeFileSync(identityPath, JSON.stringify(selfhostDoc, null, 2) + "\n");
  fs.writeFileSync(archguardPath, JSON.stringify(beforeDoc, null, 2) + "\n");

  if (args.json) {
    console.log(JSON.stringify({ selfhostIdentity: selfhostDoc, archguardBeforeAfter: beforeDoc }, null, 2));
  } else {
    console.log(`wrote ${identityPath}`);
    console.log(`wrote ${archguardPath}`);
    console.log(
      `identity allMatch=${identity.allMatch} (root ${identity.treeRoot}); ` +
        `duplicateGroupPresent ${beforeDoc.before.duplicateGroupPresent}->${beforeDoc.after.duplicateGroupPresent}; ` +
        `canonicalDefinitionCount ${beforeDoc.before.canonicalDefinitionCount}->${beforeDoc.after.canonicalDefinitionCount}; ` +
        `consumerConvergenceEvidence=${beforeDoc.consumerConvergenceEvidence.length}`,
    );
  }

  // The expected shape is part of the reading, not a separate assertion: a probe that wrote the
  // files but saw the wrong shape must not exit 0.
  if (identity.allMatch !== true) {
    console.error(`CAUSE=identity-not-matched — allMatch=${identity.allMatch} root=${identity.treeRoot}`);
    return EXIT_MISMATCH;
  }
  if (beforeDoc.before.duplicateGroupPresent !== true || beforeDoc.after.duplicateGroupPresent !== false) {
    console.error(
      `CAUSE=duplicate-group-shape-wrong — before=${beforeDoc.before.duplicateGroupPresent} after=${beforeDoc.after.duplicateGroupPresent}`,
    );
    return EXIT_MISMATCH;
  }
  if (beforeDoc.before.canonicalDefinitionCount !== 2 || beforeDoc.after.canonicalDefinitionCount !== 1) {
    console.error(
      `CAUSE=canonical-count-shape-wrong — before=${beforeDoc.before.canonicalDefinitionCount} after=${beforeDoc.after.canonicalDefinitionCount}`,
    );
    return EXIT_MISMATCH;
  }
  if (beforeDoc.consumerConvergenceEvidence.length < 2) {
    console.error(`CAUSE=consumer-convergence-evidence-thin — ${beforeDoc.consumerConvergenceEvidence.length} entries`);
    return EXIT_MISMATCH;
  }
  return EXIT_OK;
}

process.exit(await main());
