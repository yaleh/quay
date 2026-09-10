#!/usr/bin/env node
// host-repo-surface-ratchet.ts — shrink-only ratchet over the HOST REPO's own delivery surface
// (gap-host-repo-surface-ratchet, GOAL-015 退出条件④ / AC-236).
//
// THE DEFECT THIS CLOSES: GOAL-015 退出条件④「本仓库自身行为逐字不变」had NO AC coverage
// (AC-233→①, AC-234→②, AC-235→③, ④ 空缺 ⇒ goalAchieved 的结构性缺口). AC-233's most direct fix
// is deleting packages/quay/bin/quay.ts / quay.js from the npm-pack `files` array — which would
// break THIS repo's OWN development entry points (CLAUDE.md's Commands section records
// `node --experimental-strip-types packages/quay/bin/quay.ts serve …` as the canonical web-UI
// entry). Deleting a file produces no failing assertion (hard rule 3b: 不报红 ≠ 没问题). This
// ratchet makes the host-repo surface MONOTONIC: committed baseline ⊆ current, so a shrink
// (delete/rename of a verb, route, or delivered config key) goes RED while an ADD stays green.
//
// THREE ENUMERATED SETS (by position, not keyword — hard rule 2):
//   cli_verbs                 spawn `packages/quay/bin/quay.ts --help` and extract line-start
//                             "two spaces + `quay ` + verb" — the REAL output (proves the entry
//                             itself still runs), ⛔ not source literals.
//   web_routes                `url.pathname === "…"` position hits in serve-handlers.ts + serve.ts.
//   config_keys_with_consumer `config-key-consumer-check.ts --json` entries with state=="has-consumer"
//                             (reuses the existing mechanism, ⛔ not a separate enumeration).
//
// THREE-STATE OUTPUT (hard rule 3b — 读不懂输入 ≠ 合格):
//   0 = PASS (baseline ⊆ current for every set — 新增允许, 删除/改名不允许)
//   1 = FAIL (a baseline element is missing from current — surface shrank; OR the baseline file is
//       missing — the ratchet is not yet established, the task is not done)
//   3 = NOT-EVALUATED (an enumerated source cannot be read / an entry spawn failed — never conflated
//       with "shrunken to zero", never with pass; printed to STDERR)
//   2 = usage/env error
//
// MODES:
//   default  [--root <dir>] [--json] — gate mode: compare current against the committed baseline.
//   --capture [--root <dir>] [--json] — enumerate and WRITE the committed baseline file.
// The baseline is COMMITTED and mechanically generated (--capture), never hand-written. A pass must
// survive the injection seam being turned off (hard rule 4 推论三) — the checker enumerates the REAL
// entry/sources, never a fixture.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { emitPass, emitFail, emitNotEvaluated, helpExit, isDirectEntry } from "./gate-script-base.ts";
import { repoRoot } from "./repo-root.ts";

// ── surfaces ────────────────────────────────────────────────────────────────────────────────────────

/** The committed baseline file (docs/analysis/, alongside quay-init-closure-ratchet.baseline.json). */
export const BASELINE_FILE_REL = "docs/analysis/goal-015-host-repo-surface.baseline.json";

/** The CLI entry whose --help output IS the cli_verbs surface (and whose runnability is the point). */
export const CLI_ENTRY_REL = "packages/quay/bin/quay.ts";

/** The web-route source files (position hits of `url.pathname === "…"`). */
export const WEB_ROUTE_FILES: readonly string[] = [
  "packages/quay/src/serve-handlers.ts",
  "packages/quay/src/serve.ts",
];

/** The config-key consumer checker whose --json output IS the config_keys_with_consumer surface. */
export const CONFIG_KEY_CHECKER_REL = "plugin/scripts/config-key-consumer-check.ts";

/** Line-start "two spaces + `quay ` + verb" in the --help output (a `--flag` token is not a verb). */
const CLI_VERB_RE = /^  quay ([a-z][a-z0-9-]*)(?=\s|$)/gm;

/** A `url.pathname === "…"` literal route (by position, not keyword — hard rule 2). */
const WEB_ROUTE_RE = /url\.pathname === "([^"]+)"/g;

// ── types ───────────────────────────────────────────────────────────────────────────────────────────

export interface Surface {
  cli_verbs: string[];
  web_routes: string[];
  config_keys_with_consumer: string[];
}

export interface SurfaceCounts {
  cli_verbs: number;
  web_routes: number;
  config_keys_with_consumer: number;
}

export interface EnumeratedSurface extends Surface {
  /** false ⇒ an enumerated source could not be read / an entry spawn failed (NOT-EVALUATED). */
  evaluated: boolean;
  error?: string;
}

export interface ShrunkenSets {
  cli_verbs?: string[];
  web_routes?: string[];
  config_keys_with_consumer?: string[];
}

export interface SubsetVerdict {
  ok: boolean;
  shrunken: ShrunkenSets;
}

// ── small helpers ───────────────────────────────────────────────────────────────────────────────────

function sortedUniq(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

export function countsOf(s: Surface): SurfaceCounts {
  return {
    cli_verbs: s.cli_verbs.length,
    web_routes: s.web_routes.length,
    config_keys_with_consumer: s.config_keys_with_consumer.length,
  };
}

// ── enumeration (the three surfaces) ────────────────────────────────────────────────────────────────

/** Spawn the REAL `quay.ts --help` and extract the verbs. Returns null (NOT-EVALUATED) when the entry
 *  cannot be run or yields zero verbs (a structurally-broken entry must not read as "no commands"). */
export function enumerateCliVerbs(root: string): string[] | null {
  const entry = path.join(root, ...CLI_ENTRY_REL.split("/"));
  if (!fs.existsSync(entry)) return null;
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", entry, "--help"], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (res.error || res.status === null) return null;
  const verbs = [...(res.stdout ?? "").matchAll(CLI_VERB_RE)].map((m) => m[1]);
  return verbs.length === 0 ? null : sortedUniq(verbs);
}

/** Read the web-route source files and extract the `url.pathname === "…"` position hits. Returns null
 *  when any source file cannot be read or zero routes are found (structural change ≠ "no routes"). */
export function enumerateWebRoutes(root: string): string[] | null {
  const routes: string[] = [];
  for (const rel of WEB_ROUTE_FILES) {
    const abs = path.join(root, ...rel.split("/"));
    let src: string;
    try {
      src = fs.readFileSync(abs, "utf8");
    } catch {
      return null;
    }
    routes.push(...[...src.matchAll(WEB_ROUTE_RE)].map((m) => m[1]));
  }
  return routes.length === 0 ? null : sortedUniq(routes);
}

/** Spawn `config-key-consumer-check.ts --json` and extract the state=="has-consumer" keys (reuses the
 *  existing mechanism — hard rule 1, ⛔ not a separate enumeration). Returns null when the spawn fails
 *  or the --json output cannot be parsed. An empty has-consumer set is NOT null — it is a legit shrink. */
export function enumerateConfigKeysWithConsumer(root: string): string[] | null {
  const checker = path.join(root, ...CONFIG_KEY_CHECKER_REL.split("/"));
  if (!fs.existsSync(checker)) return null;
  const res = spawnSync("node", ["--no-warnings", "--experimental-strip-types", checker, "--root", root, "--json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (res.error || res.status === null) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(res.stdout ?? "");
  } catch {
    return null;
  }
  if (!Array.isArray(parsed?.entries)) return null;
  return sortedUniq(
    parsed.entries.filter((e: any) => e?.state === "has-consumer").map((e: any) => String(e.key)),
  );
}

/** Enumerate all three surfaces. evaluated:false (NOT-EVALUATED) when any surface cannot be read. */
export function enumerateSurface(root: string): EnumeratedSurface {
  const cli = enumerateCliVerbs(root);
  if (cli === null) {
    return {
      cli_verbs: [], web_routes: [], config_keys_with_consumer: [], evaluated: false,
      error: `the CLI entry (${CLI_ENTRY_REL}) could not be run or its --help output yielded no verbs`,
    };
  }
  const web = enumerateWebRoutes(root);
  if (web === null) {
    return {
      cli_verbs: [], web_routes: [], config_keys_with_consumer: [], evaluated: false,
      error: `a web-route source (${WEB_ROUTE_FILES.join(", ")}) could not be read or yielded no routes`,
    };
  }
  const cfg = enumerateConfigKeysWithConsumer(root);
  if (cfg === null) {
    return {
      cli_verbs: [], web_routes: [], config_keys_with_consumer: [], evaluated: false,
      error: `the config-key consumer check (${CONFIG_KEY_CHECKER_REL}) could not be run or its --json output could not be parsed`,
    };
  }
  return { cli_verbs: cli, web_routes: web, config_keys_with_consumer: cfg, evaluated: true };
}

// ── judgment (baseline ⊆ current — pure, the testable core) ─────────────────────────────────────────

/** The shrink-only judgment: ok iff every baseline element is present in the current set. Returns the
 *  per-set missing elements (the shrink) for the FAIL path. Additions are legal (baseline ⊆ current). */
export function checkSubset(current: Surface, baseline: Surface): SubsetVerdict {
  const cur = {
    cli_verbs: new Set(current.cli_verbs),
    web_routes: new Set(current.web_routes),
    config_keys_with_consumer: new Set(current.config_keys_with_consumer),
  };
  const missing = (key: "cli_verbs" | "web_routes" | "config_keys_with_consumer") =>
    baseline[key].filter((x) => !cur[key].has(x)).sort();
  const cliMissing = missing("cli_verbs");
  const webMissing = missing("web_routes");
  const cfgMissing = missing("config_keys_with_consumer");
  const shrunken: ShrunkenSets = {};
  if (cliMissing.length) shrunken.cli_verbs = cliMissing;
  if (webMissing.length) shrunken.web_routes = webMissing;
  if (cfgMissing.length) shrunken.config_keys_with_consumer = cfgMissing;
  return { ok: cliMissing.length === 0 && webMissing.length === 0 && cfgMissing.length === 0, shrunken };
}

// ── baseline file ───────────────────────────────────────────────────────────────────────────────────

export function baselineFile(root: string): string {
  return path.join(root, ...BASELINE_FILE_REL.split("/"));
}

export function readBaseline(root: string): Surface | null {
  try {
    const raw = JSON.parse(fs.readFileSync(baselineFile(root), "utf8"));
    if (
      !Array.isArray(raw.cli_verbs) ||
      !Array.isArray(raw.web_routes) ||
      !Array.isArray(raw.config_keys_with_consumer)
    ) {
      return null;
    }
    return {
      cli_verbs: raw.cli_verbs,
      web_routes: raw.web_routes,
      config_keys_with_consumer: raw.config_keys_with_consumer,
    };
  } catch {
    return null;
  }
}

export function writeBaseline(root: string, surface: Surface): void {
  const p = baselineFile(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        cli_verbs: sortedUniq(surface.cli_verbs),
        web_routes: sortedUniq(surface.web_routes),
        config_keys_with_consumer: sortedUniq(surface.config_keys_with_consumer),
      },
      null,
      2,
    ) + "\n",
  );
}

// ── modes ───────────────────────────────────────────────────────────────────────────────────────────

const usage = `host-repo-surface-ratchet.ts — shrink-only ratchet over the host repo's CLI verb / web route / delivered config-key surface (GOAL-015 退出条件④ / AC-236)

Usage:
  node --experimental-strip-types host-repo-surface-ratchet.ts [--root <dir>] [--json]
      gate mode — exit 1 iff the committed baseline is not ⊆ current (a verb/route/key was deleted
                  or renamed) or the baseline file is missing; exit 3 iff an enumerated source cannot
                  be read / an entry spawn failed.
  node --experimental-strip-types host-repo-surface-ratchet.ts --capture [--root <dir>] [--json]
      capture mode — enumerate and WRITE the committed baseline file.
  Exit: 0 PASS · 1 FAIL (surface shrank / baseline missing) · 2 usage/env · 3 NOT-EVALUATED`;

function getArgValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx === -1 ? undefined : args[idx + 1];
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit(usage);
  const root = path.resolve(getArgValue(args, "--root") ?? repoRoot());
  const asJson = args.includes("--json");
  const capture = args.includes("--capture");

  if (capture) {
    const surface = enumerateSurface(root);
    if (!surface.evaluated) {
      return emitNotEvaluated(
        `host-repo-surface-ratchet: NOT-EVALUATED — ${surface.error ?? "the surface could not be enumerated"} (cannot capture a baseline without a measurement)`,
        { evaluated: false },
        { json: asJson, stream: "stderr" },
      );
    }
    writeBaseline(root, surface);
    return emitPass(
      `host-repo-surface-ratchet: captured baseline → cli_verbs=${surface.cli_verbs.length} web_routes=${surface.web_routes.length} config_keys_with_consumer=${surface.config_keys_with_consumer.length}`,
      { evaluated: true, ...countsOf(surface), baselineFile: BASELINE_FILE_REL },
      { json: asJson },
    );
  }

  const baseline = readBaseline(root);
  if (baseline === null) {
    return emitFail(
      `host-repo-surface-ratchet: baseline file missing (${BASELINE_FILE_REL}) — the ratchet is not yet established (run --capture to create it)`,
      { evaluated: false, baselineMissing: true },
      { json: asJson },
    );
  }

  const surface = enumerateSurface(root);
  if (!surface.evaluated) {
    return emitNotEvaluated(
      `host-repo-surface-ratchet: NOT-EVALUATED — ${surface.error ?? "the surface could not be enumerated"} (a checker that cannot read its input is never conflated with "no shrink")`,
      { evaluated: false },
      { json: asJson, stream: "stderr" },
    );
  }

  const verdict = checkSubset(surface, baseline);
  if (verdict.ok) {
    return emitPass(
      `host-repo surface intact: cli_verbs=${surface.cli_verbs.length} web_routes=${surface.web_routes.length} config_keys_with_consumer=${surface.config_keys_with_consumer.length} (baseline ⊆ current)`,
      { evaluated: true, ...countsOf(surface), baseline: countsOf(baseline) },
      { json: asJson },
    );
  }
  return emitFail(
    `host-repo surface shrank: ${JSON.stringify(verdict.shrunken)}`,
    { evaluated: true, ...countsOf(surface), baseline: countsOf(baseline), shrunken: verdict.shrunken },
    { json: asJson },
  );
}

if (isDirectEntry(import.meta, undefined, "host-repo-surface-ratchet")) {
  process.exitCode = main(process.argv);
}
