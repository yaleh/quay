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
// Usage: node --experimental-strip-types profiles-role-coverage-check.ts [--check] [--root <dir>] [--carrier <profiles.yml>]… [--json]
// Exit:  0 = pass | 1 = fail | 2 = usage/env error | 3 = NOT-EVALUATED

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { emitPass, emitFail, emitNotEvaluated, helpExit } from "./gate-script-base.ts";
import { readProfilesConfig, resolveRole, type ProfilesConfig } from "./profile-policy.ts";
import { repoRoot } from "./repo-root.ts";
import { walkFiles } from "./fs-walk.ts";
import { parse as parseYaml } from "yaml";

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
 * Single-session-single-model invariant (gap-single-session-single-model-invariant). A session's
 * model has TWO config sources that can disagree — `launchArgv`'s `--model` (profile.model) and the
 * env keys `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` (what Claude Code feeds subagents / default
 * models). When they disagree, a mid-session spawn or fallback silently switches model and the
 * prompt-cache prefix invalidates (cache_read 0.05–0.1× → cache_write 1.25× or fresh 1×). The two
 * carriers in the wild already express the two legal shapes:
 *   · quay dev-tree (`.quay/profiles.yml`) — all three DEFAULT_* == model (self-consistent);
 *   · claudecodeui shipped                  — all three DEFAULT_* ABSENT (the launcher wrapper carries
 *     the model mapping as the single source).
 * Anything else — some keys present, or a present key != the resolved model — is the mixed state that
 * IS the silent mid-session model drift. This is a per-carrier, per-RESOLVED-ROLE judgment (the env
 * the launched session actually receives after profile+role merge), never a template-literal
 * comparison (hard rule 4b: read the host, not a hardcoded model name).
 */
const DEFAULT_MODEL_KEYS = [
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
] as const;

/**
 * The invariant for ONE resolved profile: all three DEFAULT_* absent, or all three present and equal
 * to `model`. Returns [] when the invariant holds; otherwise one human-readable violation per defect
 * (partial declaration / a value != model). `label` names the carrier:role for the report.
 */
export function singleModelInvariantViolations(
  label: string,
  model: string | null,
  env: Record<string, string>,
): string[] {
  const declared = DEFAULT_MODEL_KEYS.filter((k) => env[k] !== undefined);
  if (declared.length === 0) return [];
  const out: string[] = [];
  const missing = DEFAULT_MODEL_KEYS.filter((k) => env[k] === undefined);
  if (missing.length > 0) {
    out.push(
      `${label}: partial ANTHROPIC_DEFAULT_*_MODEL declaration — declared ${declared.join(", ")}, missing ${missing.join(", ")} ` +
        `(legal states are all three == model, or all three absent)`,
    );
  }
  const mismatched = DEFAULT_MODEL_KEYS.filter((k) => env[k] !== undefined && env[k] !== model);
  if (mismatched.length > 0) {
    out.push(
      `${label}: DEFAULT_* != model — model=${JSON.stringify(model)}, but ${mismatched
        .map((k) => `${k}=${JSON.stringify(env[k])}`)
        .join(", ")}`,
    );
  }
  return out;
}

/** The invariant across every role of one carrier: resolve each role, check its merged env vs model. */
function carrierModelInvariantViolations(config: ProfilesConfig, label: string): string[] {
  const out: string[] = [];
  const roles = config.roles ?? {};
  for (const roleName of Object.keys(roles)) {
    try {
      const resolved = resolveRole(config, roleName);
      out.push(...singleModelInvariantViolations(`${label}:${roleName}`, resolved.model, resolved.env));
    } catch (e) {
      out.push(
        `${label}: role "${roleName}" could not be resolved for the model invariant: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return out;
}

/** Read + parse one profiles.yml by FILE path (the `--carrier` surface takes a file, not a root). */
function readProfilesFile(file: string): ProfilesConfig {
  const raw = fs.readFileSync(file, "utf8");
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (e) {
    throw new Error(`profiles config is not valid YAML: ${file} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`profiles config must be a YAML mapping: ${file}`);
  }
  return doc as ProfilesConfig;
}

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

/** Recursively collect *.ts under <pluginRoot>/scripts, minus the excluded subtrees.
 *
 *  Traversal is fs-walk.ts#walkFiles; the skip-set and extension policy stay here
 *  (`.quay/routine-findings.jsonl` finding `hand-rolled-directory-walkers`, routine
 *  `semantic-dedup-scan`, runId `semantic-dedup-scan-1794127147981`). Preserved: `CORPUS_EXCLUDES`
 *  prunes DIRECTORIES only (a file carrying the same name was still scanned before), and
 *  `entry.isFile()` keeps symlinks out — the original's `isDirectory()` / `isFile()` pair dropped a
 *  symlink either way. Absolute paths, sorted. */
function driverSources(pluginRoot: string): string[] {
  return walkFiles(path.join(pluginRoot, "scripts"), {
    absolute: true,
    prune: (name, isDir) => isDir && CORPUS_EXCLUDES.includes(name),
    include: (name, _ext, entry) => entry !== null && entry.isFile() && name.endsWith(".ts"),
  });
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
  modelInvariantViolations: string[];
  modelInvariantCarriers: string[];
}

function evaluate(root: string, extraCarriers: string[] = []): Result {
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
    modelInvariantViolations: [],
    modelInvariantCarriers: [],
  };

  // ── The OTHER template (the one `quay-init.sh` copies into a project) ───────────────────────────
  let shipped: Set<string> | null = null;
  try {
    const shippedConfig = readProfilesConfig(pluginRoot);
    shipped = roleSet(shippedConfig);
    res.shippedRoles = sorted(shipped);
    res.modelInvariantViolations.push(...carrierModelInvariantViolations(shippedConfig, "shipped"));
    res.modelInvariantCarriers.push(`${pluginRoot}/.quay/profiles.yml`);
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
      [
        "--no-warnings", "--experimental-strip-types", cliEntry,
        "init", "--root", ws,
        // This checker's question is the profile CARRIER, not the test-command ladder, so it must
        // supply the one project-derived input `init` fails CLOSED without. That fail-closed is
        // `quay-init.sh`'s `detect_test_command` miss contract (the CLI is its port), and an empty
        // temp dir matches none of its four rungs (scripts/test.sh / package.json scripts.test /
        // go.mod / Cargo.toml). Omitting it makes THIS checker go NOT-EVALUATED for a reason
        // orthogonal to what it asserts — the artifact it examines was never produced.
        "--test-command", "node --test",
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (r.status !== 0) {
      res.notEvaluatedReason = `quay init did not complete (exit ${r.status}): ${(r.stderr || r.stdout || "").trim().slice(0, 800)}`;
      return res;
    }
    let init: Set<string>;
    let initConfig: ProfilesConfig;
    try {
      initConfig = readProfilesConfig(ws);
      init = roleSet(initConfig);
    } catch (e) {
      res.notEvaluatedReason = `init produced no readable .quay/profiles.yml: ${e instanceof Error ? e.message : String(e)}`;
      return res;
    }
    res.initRoles = sorted(init);
    res.modelInvariantViolations.push(...carrierModelInvariantViolations(initConfig, "init"));
    res.modelInvariantCarriers.push(`${ws}/.quay/profiles.yml`);

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

    // ── The dev-tree root carrier (`.quay/profiles.yml`) — the "all three == model" legal shape.
    const devTreeCarrier = path.join(root, ".quay", "profiles.yml");
    if (fs.existsSync(devTreeCarrier)) {
      try {
        res.modelInvariantViolations.push(...carrierModelInvariantViolations(readProfilesConfig(root), "dev-tree"));
        res.modelInvariantCarriers.push(devTreeCarrier);
      } catch (e) {
        res.modelInvariantViolations.push(
          `dev-tree carrier unreadable (${devTreeCarrier}): ${e instanceof Error ? e.message : String(e)}`,
        );
        res.modelInvariantCarriers.push(devTreeCarrier);
      }
    }

    // ── Explicit `--carrier <file>` inputs (cross-project evidence, e.g. claudecodeui's carrier).
    for (const carrierFile of extraCarriers) {
      try {
        res.modelInvariantViolations.push(...carrierModelInvariantViolations(readProfilesFile(carrierFile), `carrier:${carrierFile}`));
        res.modelInvariantCarriers.push(carrierFile);
      } catch (e) {
        res.modelInvariantViolations.push(
          `carrier unreadable (${carrierFile}): ${e instanceof Error ? e.message : String(e)}`,
        );
        res.modelInvariantCarriers.push(carrierFile);
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
      "usage: node --experimental-strip-types profiles-role-coverage-check.ts [--check] [--root <dir>] [--carrier <profiles.yml>]… [--json]\n" +
        "\n" +
        "Does a REAL init produce a profile carrier defining every profile role the drivers request,\n" +
        "and does every carrier obey the single-session-single-model invariant (all three\n" +
        "ANTHROPIC_DEFAULT_*_MODEL absent, or all three equal to the resolved model)?\n" +
        "Exit 0 = pass, 1 = fail, 2 = usage/env error, 3 = NOT-EVALUATED (no init artifact obtainable).",
    );
  }
  let root = repoRoot();
  const extraCarriers: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      const v = args[i + 1];
      if (!v) {
        process.stderr.write("profiles-role-coverage-check: --root requires a value\n");
        return 2;
      }
      root = path.resolve(v);
      i++;
    } else if (args[i] === "--carrier") {
      const v = args[i + 1];
      if (!v) {
        process.stderr.write("profiles-role-coverage-check: --carrier requires a value\n");
        return 2;
      }
      extraCarriers.push(path.resolve(v));
      i++;
    }
  }
  const asJson = args.includes("--json");

  const res = evaluate(root, extraCarriers);

  if (res.notEvaluatedReason) {
    return emitNotEvaluated(res.notEvaluatedReason, res, { json: asJson });
  }
  if (
    res.missingFromInit.length ||
    res.missingFromShipped.length ||
    res.divergent.length ||
    res.retiredPresent.length ||
    res.modelInvariantViolations.length
  ) {
    const parts: string[] = [];
    if (res.missingFromInit.length) parts.push(`init output lacks requested role(s): ${res.missingFromInit.join(", ")}`);
    if (res.missingFromShipped.length) parts.push(`shipped carrier lacks requested role(s): ${res.missingFromShipped.join(", ")}`);
    if (res.divergent.length) parts.push(`the two templates disagree: ${res.divergent.join(", ")}`);
    if (res.retiredPresent.length) {
      parts.push(`retired profile role(s) shipped to every new project: ${res.retiredPresent.join(", ")}`);
    }
    if (res.modelInvariantViolations.length) {
      parts.push(`single-session-single-model invariant violated: ${res.modelInvariantViolations.join(" | ")}`);
    }
    return emitFail(parts.join("; "), res, { json: asJson });
  }
  const notes: string[] = [];
  if (res.directRoles.length) notes.push(`directly-started (no launchArgv call site): ${res.directRoles.join(", ")}`);
  if (res.unknownRoles.length) notes.push(`unconsumed by any known consumer: ${res.unknownRoles.join(", ")}`);
  if (res.modelInvariantCarriers.length) {
    notes.push(`single-model invariant green on ${res.modelInvariantCarriers.length} carrier(s)`);
  }
  return emitPass(
    `init output covers all ${res.requested.length} requested role(s) and matches the shipped carrier` +
      (notes.length ? `; ${notes.join("; ")}` : ""),
    res,
    { json: asJson },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
