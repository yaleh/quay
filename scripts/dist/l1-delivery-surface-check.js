#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/l1-delivery-surface-check.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/repo-root.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path.join(dir, "plugin")) && fs.existsSync(path.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/l1-delivery-surface-check.ts
var DEFAULT_ROOT = repoRoot();
var SPEC_BASENAME = "SPEC-complete-delivery-surface-2026-08-05.md";
function findSpecFile(root, explicit) {
  if (explicit && fs2.existsSync(explicit)) return explicit;
  const inRoot = path2.join(root, "orchestration", SPEC_BASENAME);
  if (fs2.existsSync(inRoot)) return inRoot;
  return void 0;
}
function parseCategories(spec) {
  const cats = [];
  const re = /<!--\s*l1-category:\s*([^>]*?)\s*-->/g;
  let m;
  while ((m = re.exec(spec)) !== null) {
    const fields = m[1].split(";").map((s) => s.trim()).filter(Boolean);
    const kv = {};
    let positionalId;
    for (const f of fields) {
      const idx = f.indexOf(":");
      if (idx === -1) {
        const n = Number(f);
        if (Number.isFinite(n)) positionalId = n;
        continue;
      }
      const k = f.slice(0, idx).trim();
      const v = f.slice(idx + 1).trim();
      if (!v) continue;
      if (!kv[k]) kv[k] = [];
      kv[k].push(v);
    }
    const id = Number(kv["id"]?.[0] ?? positionalId);
    const name = kv["name"]?.[0];
    if (!Number.isFinite(id) || !name) continue;
    cats.push({
      id,
      name,
      deliverables: kv["deliverable"] ?? [],
      task: kv["task"]?.[0]
    });
  }
  return cats;
}
function checkSurface(root, specPath) {
  const spec = fs2.readFileSync(specPath, "utf8");
  const cats = parseCategories(spec);
  const results = [];
  let covered = 0;
  for (const cat of cats) {
    const missingDeliverables = [];
    for (const d of cat.deliverables) {
      if (!fs2.existsSync(path2.resolve(root, d))) missingDeliverables.push(d);
    }
    let missingTask;
    if (cat.task && !fs2.existsSync(path2.resolve(root, "tasks", `${cat.task}.md`))) {
      missingTask = cat.task;
    }
    const isCovered = missingDeliverables.length === 0 && missingTask === void 0;
    if (isCovered) covered++;
    results.push({ category: cat, covered: isCovered, missingDeliverables, missingTask });
  }
  return { categories: results, covered, total: cats.length };
}
function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: node l1-delivery-surface-check.ts [--root <dir>] [--spec <file>]");
  const root = path2.resolve(flagValue(argv, "--root") ?? DEFAULT_ROOT);
  const specExplicit = flagValue(argv, "--spec");
  const spec = findSpecFile(root, specExplicit);
  if (!spec) {
    process.stderr.write(
      `ERROR: delivery-surface spec not found \u2014 looked for orchestration/${SPEC_BASENAME} under ${root}` + (specExplicit ? ` and --spec ${specExplicit}` : "") + ". The SPEC is the single source for the six-category L1 check; without it the check is undefined.\n"
    );
    return 2;
  }
  const res = checkSurface(root, spec);
  process.stdout.write(`surface-categories-covered: ${res.covered}/${res.total}
`);
  process.stdout.write(`${JSON.stringify(res)}
`);
  if (res.total === 0) {
    process.stderr.write(
      `ERROR: zero l1-category markers parsed from ${spec} \u2014 the SPEC's machine-readable section is missing/empty. A live six-category delivery surface must declare all six categories.
`
    );
    return 2;
  }
  if (res.covered < res.total) {
    process.stderr.write(
      `ERROR: ${res.total - res.covered} of ${res.total} delivery-surface categories uncovered \u2014 a COMPLETE delivery needs every category's deliverables present and its owning task filed.
`
    );
    for (const r of res.categories) {
      if (r.covered) continue;
      const parts = [];
      for (const d of r.missingDeliverables) parts.push(`deliverable ${d}`);
      if (r.missingTask) parts.push(`owning task ${r.missingTask}`);
      process.stderr.write(`  ${r.category.id}. ${r.category.name}: missing ${parts.join(", ")}
`);
    }
    return 1;
  }
  return 0;
}
if (process.argv[1] && fileURLToPath2(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
export {
  checkSurface,
  findSpecFile,
  main,
  parseCategories
};
