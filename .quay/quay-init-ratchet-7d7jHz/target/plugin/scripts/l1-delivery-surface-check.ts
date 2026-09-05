#!/usr/bin/env node
// l1-delivery-surface-check.ts — the SIX-CATEGORY L1 delivery-completeness check
// (tasks/gap-complete-delivery-surface-spec-and-l1-verification).
//
// PROBLEM IT FIXES: quay-init's verify_referenced_landed only covers category 1 of the delivery
// surface (mechanisms/runtime: referenced ⊆ landed). The SPEC (§4 of
// orchestration/SPEC-complete-delivery-surface-2026-08-05.md) measures SIX delivery categories; a
// COMPLETE cold-start + sustained-correct drive needs every category to have a deliverable AND an
// owning gap task. This check is the L1 (static — runnable before install AND after install)
// assertion: "each of the six categories has a deliverable + its owning task is filed (AC4)".
//
// SINGLE SOURCE OF TRUTH (AC1): orchestration/SPEC-complete-delivery-surface-2026-08-05.md — the
// LIVE six-category list. Each category is declared as an HTML-comment marker:
//   <!-- l1-category: <n>; name: <slug>; deliverable: <rel-path>; deliverable: <rel-path>; task: <gap-task-id> -->
// A category is COVERED iff every declared deliverable resolves under the checked root AND the
// declared owning task resolves at tasks/<id>.md (AC4 no-holes). Deliverables change ⇒ the SPEC
// marker changes ⇒ the L1 check follows (invariant spec_is_live = 1) — the check is never a frozen
// snapshot. The SPEC markers are the ONLY category→deliverable mapping the check knows.
//
// CONTRACT measure `surface_categories_covered` = the covered count on stdout. Band = 6 (all six
// categories covered). CONTROL: removing a category's deliverable (or its owning task) MUST drop
// the count below 6 and name the missing artifact (per-category fixtures in
// plugin/test/l1-delivery-surface-check.test.mjs).
//
// Usage (the ## Contract invoke):
//   node --experimental-strip-types plugin/scripts/l1-delivery-surface-check.ts --surface
//       [--root <dir>] [--spec <path>]
// stdout: `surface-categories-covered: N/6` (the measure) + a JSON detail line
// exit: 0 = 6/6 · 1 = some category uncovered (fail-closed) · 2 = usage / spec-not-found

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helpExit } from "./gate-script-base.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The default checked surface = the quay repo root (this script lives at <repo>/plugin/scripts/). */
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
const SPEC_BASENAME = "SPEC-complete-delivery-surface-2026-08-05.md";

export interface L1Category {
  id: number;
  name: string;
  /** Repo-relative deliverable paths (files or dirs) — the category's delivery surface. */
  deliverables: string[];
  /** Owning gap task id (AC4) — resolved at tasks/<id>.md. Optional. */
  task?: string;
}

export interface L1CategoryResult {
  category: L1Category;
  covered: boolean;
  missingDeliverables: string[];
  missingTask?: string;
}

export interface L1SurfaceResult {
  categories: L1CategoryResult[];
  covered: number;
  total: number;
}

/** Locate the SPEC: explicit --spec wins, else <root>/orchestration/<SPEC_BASENAME>. */
export function findSpecFile(root: string, explicit?: string): string | undefined {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const inRoot = path.join(root, "orchestration", SPEC_BASENAME);
  if (fs.existsSync(inRoot)) return inRoot;
  return undefined;
}

/** Parse the `<!-- l1-category: … -->` markers out of the SPEC live document. */
export function parseCategories(spec: string): L1Category[] {
  const cats: L1Category[] = [];
  const re = /<!--\s*l1-category:\s*([^>]*?)\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec)) !== null) {
    const fields = m[1].split(";").map((s) => s.trim()).filter(Boolean);
    const kv: Record<string, string[]> = {};
    let positionalId: number | undefined;
    for (const f of fields) {
      const idx = f.indexOf(":");
      if (idx === -1) {
        // A field with no colon is the positional category id (`<!-- l1-category: 1; … -->`).
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
      task: kv["task"]?.[0],
    });
  }
  return cats;
}

/** Check every category's deliverables + owning task against the surface at `root`. */
export function checkSurface(root: string, specPath: string): L1SurfaceResult {
  const spec = fs.readFileSync(specPath, "utf8");
  const cats = parseCategories(spec);
  const results: L1CategoryResult[] = [];
  let covered = 0;
  for (const cat of cats) {
    const missingDeliverables: string[] = [];
    for (const d of cat.deliverables) {
      if (!fs.existsSync(path.resolve(root, d))) missingDeliverables.push(d);
    }
    let missingTask: string | undefined;
    if (cat.task && !fs.existsSync(path.resolve(root, "tasks", `${cat.task}.md`))) {
      missingTask = cat.task;
    }
    const isCovered = missingDeliverables.length === 0 && missingTask === undefined;
    if (isCovered) covered++;
    results.push({ category: cat, covered: isCovered, missingDeliverables, missingTask });
  }
  return { categories: results, covered, total: cats.length };
}

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

export function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) helpExit("usage: node l1-delivery-surface-check.ts [--root <dir>] [--spec <file>]");
  const root = path.resolve(parseArg(argv, "--root") ?? DEFAULT_ROOT);
  const specExplicit = parseArg(argv, "--spec");
  const spec = findSpecFile(root, specExplicit);
  if (!spec) {
    process.stderr.write(
      `ERROR: delivery-surface spec not found — looked for orchestration/${SPEC_BASENAME} under ${root}` +
        (specExplicit ? ` and --spec ${specExplicit}` : "") +
        ". The SPEC is the single source for the six-category L1 check; without it the check is undefined.\n",
    );
    return 2;
  }
  const res = checkSurface(root, spec);
  // stdout = the Contract measure `surface_categories_covered` (covered count) + the full detail.
  process.stdout.write(`surface-categories-covered: ${res.covered}/${res.total}\n`);
  process.stdout.write(`${JSON.stringify(res)}\n`);
  if (res.total === 0) {
    process.stderr.write(
      `ERROR: zero l1-category markers parsed from ${spec} — the SPEC's machine-readable section is missing/empty. ` +
        "A live six-category delivery surface must declare all six categories.\n",
    );
    return 2;
  }
  if (res.covered < res.total) {
    process.stderr.write(
      `ERROR: ${res.total - res.covered} of ${res.total} delivery-surface categories uncovered — ` +
        "a COMPLETE delivery needs every category's deliverables present and its owning task filed.\n",
    );
    for (const r of res.categories) {
      if (r.covered) continue;
      const parts: string[] = [];
      for (const d of r.missingDeliverables) parts.push(`deliverable ${d}`);
      if (r.missingTask) parts.push(`owning task ${r.missingTask}`);
      process.stderr.write(`  ${r.category.id}. ${r.category.name}: missing ${parts.join(", ")}\n`);
    }
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
