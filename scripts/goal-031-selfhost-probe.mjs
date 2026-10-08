#!/usr/bin/env node
// scripts/goal-031-selfhost-probe.mjs — GOAL-031 ② (task
// gap-goal031-selfhost-evidence-and-arch-layer-review), the branch self-hosting identity proof.
//
// ⛔ WHY IT LIVES AT THE REPO ROOT AND NOT IN `plugin/scripts/`: it is a dev-period, goal-scoped
// evidence tool with no runtime consumer — the AC-344 criterion reads the committed snapshot JSON,
// it does not run this file. `plugin/` is the PUBLISHED tree (publish-dist-branch.sh rsyncs it, then
// strips only raw `.ts`), so a `.mjs` under `plugin/scripts/` ships into every user's install — which
// `plugin/shipped-set-baseline.json`'s size ceiling caught as exactly +1 file. That is the GOAL-029
// class (dev-only content in the artifact), so the file lives where the sibling self-host probe lives
// (`scripts/branch-selfhost-probe.mjs`, task gap-goal030-branch-selfhost-probe) and never ships.
// The technique is location-independent: the reading is taken by a child `node` whose cwd is the tree
// under evaluation, so where THIS file sits changes nothing about `loadedFrom`.
//
// WHAT THIS PROVES (GOAL-031 §验证步骤 4): when the GOAL-031 worktree is the *root* a process runs
// from, the module it loads (`plugin/scripts/goal-driver.ts`) resolves to THAT worktree's own file
// — not the main checkout's. The reading is taken by a CHILD `node` process whose cwd IS the tree
// under evaluation: the child asks Node's own ESM resolver (`import.meta.resolve`) for the entry's
// URL (resolved relative to `import.meta.url`, i.e. `<cwd>/[eval1]`) and then actually `import()`s
// it. So `loadedFrom` is where the loader looks *when rooted there*, not a path the parent glued
// together — a child rooted in the main checkout yields a different `loadedFrom` (the negative
// control below), which is what makes the parent's `match` falsifiable rather than a tautology.
//
// ⛔ Deliberately NOT a copy of GOAL-030's `scripts/branch-selfhost-probe.mjs` (that file lives only
// on the unmerged `goal/GOAL-030` branch): GOAL-031's red line forbids depending on GOAL-030's
// unmerged artifacts. This is a smaller, self-contained check reusing the same *technique* (compare
// the loaded module's realpath against the tree under evaluation).
//
// ⛔ `import()`ing `goal-driver.ts` does NOT run a driver round: its bottom is guarded by
// `isDirectEntry(import.meta, undefined, "goal-driver")`, so a non-entry import only evaluates the
// module's declarations. (Verified: the same technique GOAL-030 relied on.)
//
// Usage:
//   node scripts/goal-031-selfhost-probe.mjs --worktree <abs-tree> [--entry <rel>]
//        [--main <abs-main-checkout>] [--out <json-path>] [--json]
// Exit:
//   0 = probe ran AND identity matched (loadedFrom realpath is inside <worktree>)
//   1 = ran, identity MISMATCHED (a `CAUSE=` line on stderr)
//   3 = could not be evaluated (bad args, child spawn/import failed, worktree not a directory)

import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const EXIT_OK = 0;
const EXIT_MISMATCH = 1;
const EXIT_NOT_EVALUATED = 3;

const CAUSE_LOADED_OUTSIDE = "CAUSE=loaded-from-outside-worktree";
const CAUSE_CHILD_FAILED = "CAUSE=child-import-failed";

function parseArgs(argv) {
  const out = { worktree: "", entry: "plugin/scripts/goal-driver.ts", main: "", outPath: "", json: false, also: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--worktree") out.worktree = argv[++i] ?? "";
    else if (a === "--entry") out.entry = argv[++i] ?? "";
    else if (a === "--main") out.main = argv[++i] ?? "";
    else if (a === "--out") out.outPath = argv[++i] ?? "";
    else if (a === "--also") out.also.push(argv[++i] ?? "");
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") {
      console.log("usage: node goal-031-selfhost-probe.mjs --worktree <abs-tree> [--entry <rel>] [--main <abs-main>] [--out <json>] [--json]");
      process.exit(EXIT_OK);
    } else {
      console.error(`goal-031-selfhost-probe: unknown arg: ${a}`);
      process.exit(EXIT_NOT_EVALUATED);
    }
  }
  return out;
}

// The child program. It is intentionally tiny and self-contained: it must observe the loader
// behaviour of a process whose cwd is the tree under evaluation, so it cannot reuse anything from
// the parent's location. Communicates the reading back as one JSON line on stdout.
const CHILD_SCRIPT = `
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const raw = process.env.PROBE_ENTRY;
// Node treats a specifier with no ./ or / prefix as a BARE package name, so a tree-relative entry
// path must be spelled ./… to make it resolve against import.meta.url (cwd/[eval1]) rather than
// against node_modules.
const entry = raw.startsWith(".") || raw.startsWith("/") ? raw : "./" + raw;
const cwd = process.cwd();
let resolvedUrl;
try {
  resolvedUrl = import.meta.resolve(entry);
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: "resolve: " + (e && e.message ? e.message : String(e)) }));
  process.exit(0);
}
const loadedFrom = fs.realpathSync(fileURLToPath(resolvedUrl));
let loaded = false;
let loadErr = null;
try {
  await import(entry);
  loaded = true;
} catch (e) {
  loadErr = e && e.message ? e.message : String(e);
}
console.log(JSON.stringify({ ok: true, cwd, resolvedUrl, loadedFrom, loaded, loadErr }));
`;

// Run the child rooted at `root`; returns the child's reading (or null if it could not be read).
function readIdentity(root, entry) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", CHILD_SCRIPT],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, PROBE_ENTRY: entry, QUAY_GOAL_ACCEPTANCE_ACTIVE: "" },
    },
  );
  if (r.error || r.status !== 0) return { root, error: r.error ? String(r.error) : `child exit ${r.status}: ${(r.stderr || "").slice(0, 400)}` };
  const line = String(r.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "";
  try {
    return { root, ...JSON.parse(line) };
  } catch {
    return { root, error: `unparseable child output: ${line.slice(0, 400)}` };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.worktree) {
    console.error("goal-031-selfhost-probe: --worktree is required");
    return EXIT_NOT_EVALUATED;
  }
  if (!fs.existsSync(args.worktree) || !fs.statSync(args.worktree).isDirectory()) {
    console.error(`goal-031-selfhost-probe: worktree not a directory: ${args.worktree}`);
    return EXIT_NOT_EVALUATED;
  }
  const worktreeRoot = fs.realpathSync(args.worktree);

  // Main checkout (for the negative control): parent of the shared `.git` dir, unless overridden.
  let mainRoot = "";
  try {
    const commonGitDir = execFileSync("git", ["-C", worktreeRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
    mainRoot = fs.realpathSync(path.dirname(commonGitDir));
  } catch {
    mainRoot = args.main ? fs.realpathSync(args.main) : "";
  }
  if (args.main) {
    try { mainRoot = fs.realpathSync(args.main); } catch { /* keep derived */ }
  }

  const primary = readIdentity(worktreeRoot, args.entry);
  if (primary.error) {
    console.error(`${CAUSE_CHILD_FAILED} — ${primary.error}`);
    return EXIT_NOT_EVALUATED;
  }

  const expectedEntry = fs.realpathSync(path.join(worktreeRoot, args.entry));
  const insideWorktree = primary.loadedFrom === expectedEntry && primary.loadedFrom.startsWith(worktreeRoot + path.sep);
  const match = insideWorktree && primary.loaded === true;

  // Negative control: the SAME entry specifier, evaluated from the main checkout. If the reading
  // were a constant (or a path glued by the parent) this would not differ.
  let negativeControl = null;
  if (mainRoot && mainRoot !== worktreeRoot) {
    const nc = readIdentity(mainRoot, args.entry);
    negativeControl = {
      root: mainRoot,
      loadedFrom: nc.loadedFrom ?? null,
      loaded: nc.loaded ?? null,
      error: nc.error ?? null,
      differsFromWorktree: typeof nc.loadedFrom === "string" ? nc.loadedFrom !== primary.loadedFrom : null,
    };
  }

  // Additional readings (optional): e.g. the per-task worktree this evidence is authored in, which
  // is a *different* directory from the goal worktree. Recorded for honesty — the top-level
  // `loadedFrom`/`worktreeRoot`/`match` are always the `--worktree` reading.
  const alsoReadings = [];
  for (const extra of args.also) {
    if (!extra) continue;
    let extraRoot;
    try {
      extraRoot = fs.realpathSync(extra);
    } catch {
      alsoReadings.push({ root: extra, error: "not a directory" });
      continue;
    }
    const rd = readIdentity(extraRoot, args.entry);
    alsoReadings.push({
      root: extraRoot,
      loadedFrom: rd.loadedFrom ?? null,
      loaded: rd.loaded ?? null,
      error: rd.error ?? null,
    });
  }

  const evidence = {
    loadedFrom: primary.loadedFrom,
    worktreeRoot,
    match,
    entry: args.entry,
    expectedEntry,
    resolvedUrl: primary.resolvedUrl,
    loaded: primary.loaded,
    ...(alsoReadings.length ? { alsoReadings } : {}),
    // The evaluated tree is the GOAL-031 worktree (the branch's own tree, whose directory name
    // carries the goal marker). A child rooted ELSEWHERE (the main checkout) reads a different
    // loadedFrom — recorded below so `match` is demonstrably a reading, not a constant.
    method:
      "child node process with cwd = worktreeRoot; import.meta.resolve(entry) + realpathSync + real import()",
    negativeControl,
  };

  if (args.outPath) {
    const abs = path.isAbsolute(args.outPath) ? args.outPath : path.join(worktreeRoot, args.outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(evidence, null, 2) + "\n");
  }
  if (args.json || !args.outPath) console.log(JSON.stringify(evidence, null, 2));

  if (!match) {
    console.error(`${CAUSE_LOADED_OUTSIDE} — loadedFrom=${primary.loadedFrom} expected inside ${worktreeRoot} (loaded=${primary.loaded})`);
    return EXIT_MISMATCH;
  }
  return EXIT_OK;
}

process.exit(main());
