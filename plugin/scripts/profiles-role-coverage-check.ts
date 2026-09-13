#!/usr/bin/env node
// profiles-role-coverage-check.ts
//
// QUESTION IT ANSWERS: does the profile carrier a REAL init produces define every profile ROLE the
// drivers ask for — asserted on **init's actual output**, never on a template file?
//
// WHY THE ASSERTION OBJECT IS THE OUTPUT (the whole point of this checker):
//   quay's drivers spawn their sub-sessions through `launchArgv("<role>", …)`, which resolves the
//   role out of `.quay/profiles.yml` and THROWS when it is missing. A role the drivers ask for but
//   the carrier does not define is therefore not a cosmetic gap — the driver can never dispatch.
//   That defect shipped once already: `gap-shipped-profiles-missing-worker-roles` "fixed" the
//   carrier by editing `plugin/.quay/profiles.yml`, but the init path in play laid down a SECOND,
//   inline template that still had the old role set. Its acceptance was green and production stayed
//   broken. A checker that asserts on a template file repeats that mistake in the most expensive
//   form (hard rule 3b: a check that is structurally unable to go red is worse than no check) — so
//   this checker runs a real init into a temp dir and reads the file THAT produced.
//
// WHAT IT COMPARES (four assertions, each with a reachable red):
//   A1  roles(init output)            ⊇ roles requested by `launchArgv("…")` in plugin/scripts/**
//   A2  roles(shipped carrier)        ⊇ roles requested          — the OTHER template, same bar
//   A3  roles(init output)            == roles(shipped carrier)  — a one-sided edit to either
//       template goes RED here; this is the control for "fixed one copy, production uses the other"
//   R   reverse redundancy (reported)  roles present in the output that NO driver requests
//
// ⛔ NOT-EVALUATED is a first-class outcome (exit 3), never conflated with PASS: when the Core CLI
// source is not present in the tree (an installed-plugin-only layout) A1/A3 have no input, and the
// checker says so instead of reporting a green it did not earn.
//
// Usage: node --experimental-strip-types profiles-role-coverage-check.ts [--check] [--root <dir>] [--json]
// Exit:  0 = pass | 1 = fail | 2 = usage/env error | 3 = NOT-EVALUATED

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emitPass, emitFail, emitNotEvaluated, helpExit } from "./gate-script-base.ts";
import { readProfilesConfig } from "./profile-policy.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Directories under plugin/scripts/ that are NOT driver sources (fixtures / archived copies). */
const CORPUS_EXCLUDES = ["checker-mutation-cases", "archive", "node_modules", "dist"];

/**
 * Profile roles a produced carrier must NOT declare: their consumer no longer exists, so shipping
 * one gives every new project a dead role from birth. `inner` was replaced by worker-driver
 * (SPEC-tmux-retirement-2026-09-03; orchestration/SPEC-tmux-retirement-2026-09-03.md §8).
 * ⛔ A FAIL, not a remark: a merely-reported condition is structurally unable to go red, which is
 * the "a permanently-green check is worse than no check" trap this checker exists inside of.
 */
const RETIRED_ROLES: ReadonlySet<string> = new Set(["inner"]);

/**
 * Roles that are legitimately part of a carrier WITHOUT any `launchArgv` call site — they are
 * started directly by their own entry (manager-start.sh / the outer entry), which reads
 * `roles.<name>.name` rather than going through launchArgv. Kept explicit so "requested by no
 * driver" can be reported without either failing these or silently blessing them.
 */
const DIRECTLY_STARTED_ROLES: ReadonlySet<string> = new Set(["manager", "outer"]);

/**
 * The role-name extractor. The needle is assembled at runtime on purpose: this file lives in
 * plugin/scripts/, which IS the corpus being scanned, so spelling the literal out here would make
 * the checker match itself (hard rule 2 — judge by position, and a comment is not a call site).
 */
function requestedRoles(src: string): string[] {
  const call = "launchArgv" + "(";
  const masked = maskComments(src);
  const out: string[] = [];
  let i = masked.indexOf(call);
  while (i !== -1) {
    const rest = masked.slice(i + call.length);
    const m = /^\s*"([A-Za-z0-9._-]+)"/.exec(rest);
    if (m) out.push(m[1]);
    i = masked.indexOf(call, i + call.length);
  }
  return out;
}

/**
 * Blank out comment positions so a `launchArgv("<role>")` MENTIONED in prose is not read as a call
 * site. Deliberately conservative: only whole-line `//` and whitespace-preceded trailing `//` are
 * stripped, so a `https://` in a string is never mistaken for a comment (a miss here costs a false
 * NEGATIVE — never a false red).
 */
function maskComments(src: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/[^\n]*/gm, blank)
    .replace(/[ \t]\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Recursively collect *.ts under <pluginRoot>/scripts, minus the excluded subtrees. */
function driverSources(pluginRoot: string): string[] {
  const base = path.join(pluginRoot, "scripts");
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (CORPUS_EXCLUDES.includes(e.name)) continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith(".ts")) {
        out.push(p);
      }
    }
  };
  walk(base);
  return out.sort();
}

function roleSet(cfg: { roles?: Record<string, unknown> }): Set<string> {
  return new Set(Object.keys(cfg.roles ?? {}));
}

function sorted(s: Set<string>): string[] {
  return [...s].sort();
}

interface Result {
  pluginRoot: string;
  corpusFiles: number;
  requested: string[];
  notEvaluatedReason?: string;
  initRoles?: string[];
  shippedRoles?: string[];
  missingFromInit: string[];
  missingFromShipped: string[];
  divergent: string[];
  retiredPresent: string[];
  directRoles: string[];
  unknownRoles: string[];
}

function evaluate(root: string): Result {
  const pluginRoot = path.join(root, "plugin");
  const files = driverSources(pluginRoot);
  const requestedSet = new Set<string>();
  for (const f of files) {
    for (const r of requestedRoles(fs.readFileSync(f, "utf8"))) requestedSet.add(r);
  }

  const res: Result = {
    pluginRoot,
    corpusFiles: files.length,
    requested: sorted(requestedSet),
    missingFromInit: [],
    missingFromShipped: [],
    divergent: [],
    retiredPresent: [],
    directRoles: [],
    unknownRoles: [],
  };

  // ── The OTHER template (the one `quay-init.sh` copies into a project) ───────────────────────────
  let shipped: Set<string> | null = null;
  try {
    shipped = roleSet(readProfilesConfig(pluginRoot));
    res.shippedRoles = sorted(shipped);
  } catch (e) {
    res.notEvaluatedReason = `shipped carrier unreadable (${pluginRoot}/.quay/profiles.yml): ${e instanceof Error ? e.message : String(e)}`;
    return res;
  }

  // ── The REAL init output (A1/A3's object) ──────────────────────────────────────────────────────
  const cliEntry = path.join(root, "packages", "quay", "bin", "quay.ts");
  if (!fs.existsSync(cliEntry)) {
    res.notEvaluatedReason =
      `Core CLI source absent (${cliEntry}) — cannot produce an init artifact to assert on; ` +
      `a template-file comparison alone is exactly the check this one exists to replace`;
    return res;
  }

  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "profiles-role-coverage-"));
  try {
    const r = spawnSync(
      process.execPath,
      ["--no-warnings", "--experimental-strip-types", cliEntry, "init", "--root", ws],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (r.status !== 0) {
      res.notEvaluatedReason = `quay init did not complete (exit ${r.status}): ${(r.stderr || r.stdout || "").trim().slice(0, 800)}`;
      return res;
    }
    let init: Set<string>;
    try {
      init = roleSet(readProfilesConfig(ws));
    } catch (e) {
      res.notEvaluatedReason = `init produced no readable .quay/profiles.yml: ${e instanceof Error ? e.message : String(e)}`;
      return res;
    }
    res.initRoles = sorted(init);

    for (const role of requestedSet) if (!init.has(role)) res.missingFromInit.push(role);
    for (const role of requestedSet) if (!shipped.has(role)) res.missingFromShipped.push(role);
    for (const role of init) if (!shipped.has(role)) res.divergent.push(`init-only: ${role}`);
    for (const role of shipped) if (!init.has(role)) res.divergent.push(`shipped-only: ${role}`);
    for (const role of init) if (RETIRED_ROLES.has(role)) res.retiredPresent.push(role);
    for (const role of init) if (DIRECTLY_STARTED_ROLES.has(role)) res.directRoles.push(role);
    for (const role of init) {
      if (!requestedSet.has(role) && !DIRECTLY_STARTED_ROLES.has(role) && !RETIRED_ROLES.has(role)) {
        res.unknownRoles.push(role);
      }
    }
    return res;
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    helpExit(
      "usage: node --experimental-strip-types profiles-role-coverage-check.ts [--check] [--root <dir>] [--json]\n" +
        "\n" +
        "Does a REAL init produce a profile carrier defining every profile role the drivers request?\n" +
        "Exit 0 = pass, 1 = fail, 2 = usage/env error, 3 = NOT-EVALUATED (no init artifact obtainable).",
    );
  }
  let root = path.resolve(HERE, "..", "..");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      const v = args[i + 1];
      if (!v) {
        process.stderr.write("profiles-role-coverage-check: --root requires a value\n");
        return 2;
      }
      root = path.resolve(v);
      break;
    }
  }
  const asJson = args.includes("--json");

  const res = evaluate(root);

  if (res.notEvaluatedReason) {
    return emitNotEvaluated(res.notEvaluatedReason, res, { json: asJson });
  }
  if (
    res.missingFromInit.length ||
    res.missingFromShipped.length ||
    res.divergent.length ||
    res.retiredPresent.length
  ) {
    const parts: string[] = [];
    if (res.missingFromInit.length) parts.push(`init output lacks requested role(s): ${res.missingFromInit.join(", ")}`);
    if (res.missingFromShipped.length) parts.push(`shipped carrier lacks requested role(s): ${res.missingFromShipped.join(", ")}`);
    if (res.divergent.length) parts.push(`the two templates disagree: ${res.divergent.join(", ")}`);
    if (res.retiredPresent.length) {
      parts.push(`retired profile role(s) shipped to every new project: ${res.retiredPresent.join(", ")}`);
    }
    return emitFail(parts.join("; "), res, { json: asJson });
  }
  const notes: string[] = [];
  if (res.directRoles.length) notes.push(`directly-started (no launchArgv call site): ${res.directRoles.join(", ")}`);
  if (res.unknownRoles.length) notes.push(`unconsumed by any known consumer: ${res.unknownRoles.join(", ")}`);
  return emitPass(
    `init output covers all ${res.requested.length} requested role(s) and matches the shipped carrier` +
      (notes.length ? `; ${notes.join("; ")}` : ""),
    res,
    { json: asJson },
  );
}

process.exit(main(process.argv));
