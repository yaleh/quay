#!/usr/bin/env node
// chart2-s3-external-validation.ts — the load-bearing cov-calculator for chart-2 surface S3
// (External-validation reach) per DIR-064-A / DIR-064 §6.2.
//
// S3 = External-validation reach. It measures how far quay's product+methodology have ACTUALLY
// reached OUTSIDE the home repo by counting registered foreign workspaces that show a real,
// quay-driven ABI task-status transition in their own gate-events ledger.
//
//   cov = (# registry workspaces with an observed real ABI task-status-transition GateEvent)
//         / (target set size)
//
// The OBJECTIVE, CAPPED denominator is the drivable-workspaces registry
// (experiments/quay-perpetual-stream/drivable-workspaces.yml). This registry is the anti-gaming
// guard (DIR-062): cov CANNOT be inflated beyond the human-authorized, registered workspace set —
// you cannot conjure external reach by pointing at a workspace nobody registered. The target set is
// the registry workspaces MINUS quay's own home repo, because S3 measures EXTERNAL reach: a
// transition in the loop's own value-source repo is not external validation.
//
// What COUNTS as a real ABI task-status transition (operationalized, hard/mechanical — ADR-004):
// a workspace's `<path>/.quay/gate-events.jsonl` ledger EXISTS and contains ≥1 line that parses to
// an object with `verdict === "pass"` on a NON-fixture item — item_id NOT matching /^(QC-|QENG-)/.
// QC-* and QENG-* are the engine's own self-check/fixture item ids; a pass on those is the meter
// testing itself, not a real driven task, so they are excluded (the same "don't let the instrument
// score itself" discipline DIR-038-C applied to the outward term).
//
// Usage:
//   node chart2-s3-external-validation.ts            # compute S3 cov from the real registry + ledgers
//   node chart2-s3-external-validation.ts --selftest # run the embedded RED+GREEN fixture suite
//
// Exit codes:
//   0 = computed a cov (or selftest passed)
//   1 = selftest failed
//   2 = usage/environment error (registry unreadable / empty target set)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Home repo = the repo root this script lives in (experiments/quay-perpetual-stream/scripts → repo root).
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REGISTRY_PATH = path.join(__dirname, "..", "drivable-workspaces.yml");

// ── parseRegistryWorkspaces — extract the `- path: <p>` entries from the registry YAML. ────────────
// Deliberately a flat line-regex, NOT a YAML lib: the `workspaces:` block is a simple flat block
// list of `- path: <p>` entries (some with an extra `session:` line), so a robust `^\s*-\s*path:`
// match is simpler and has no dependency surface. Returns the paths in file order.
export function parseRegistryWorkspaces(yamlText: string): string[] {
  const paths: string[] = [];
  for (const line of yamlText.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*path:\s*(\S+)/);
    if (m) paths.push(m[1]);
  }
  return paths;
}

// ── workspaceHasAbiTransition — true iff the ledger shows ≥1 real driven ABI status transition. ────
// Operationalized as: ≥1 JSONL line parses to an object with verdict === "pass" AND an item_id that
// is NOT a fixture/self-check id (does not start with QC- or QENG-). Malformed lines are skipped
// (a corrupt line is not evidence of a real transition). Empty/whitespace-only text → false.
export function workspaceHasAbiTransition(gateEventsJsonlText: string): boolean {
  for (const rawLine of gateEventsJsonlText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // malformed line — not evidence
    }
    if (!obj || typeof obj !== "object") continue;
    const ev = obj as { verdict?: unknown; item_id?: unknown };
    if (ev.verdict !== "pass") continue;
    if (typeof ev.item_id !== "string") continue;
    if (/^(QC-|QENG-)/.test(ev.item_id)) continue; // fixture / engine self-check id — excluded
    return true;
  }
  return false;
}

export interface S3CovResult {
  cov: number;
  reached: number;
  target: number;
  reachedPaths: string[];
}

// ── computeS3Cov — pure: cov over the registry-bounded, home-excluded target set. ──────────────────
// target = registryPaths excluding homeRepoPath (S3 is EXTERNAL reach).
// reached = target workspaces whose readLedger(path) returns non-null AND whose ledger text has a
//           real ABI transition (workspaceHasAbiTransition).
// cov = reached / target. target === 0 → throw (fail-closed: an empty denominator is an
//       environment error, never a silently-passing cov of 0/0).
// readLedger is INJECTED so this stays a pure, filesystem-free function under test.
export function computeS3Cov(opts: {
  registryPaths: string[];
  homeRepoPath: string;
  readLedger: (path: string) => string | null;
}): S3CovResult {
  const { registryPaths, homeRepoPath, readLedger } = opts;
  const home = path.resolve(homeRepoPath);
  const targetPaths = registryPaths.filter((p) => path.resolve(p) !== home);
  const target = targetPaths.length;
  if (target === 0) {
    throw new Error(
      "S3 cov: empty target set (registry has no non-home workspaces) — fail-closed, refusing 0/0"
    );
  }
  const reachedPaths: string[] = [];
  for (const p of targetPaths) {
    const ledger = readLedger(p);
    if (ledger === null) continue; // no ledger → no observed transition
    if (workspaceHasAbiTransition(ledger)) reachedPaths.push(p);
  }
  const reached = reachedPaths.length;
  return { cov: reached / target, reached, target, reachedPaths };
}

// ── selftest — embedded RED+GREEN fixture suite (no real filesystem). ──────────────────────────────
// RED  : a target workspace with a pass on a fixture-only id (QC-/QENG-) must NOT count;
//        target === 0 must throw.
// GREEN: 2 of 3 non-home workspaces have a real transition → cov 0.666…; home is excluded from target.
export function selftest(): boolean {
  let allPassed = true;
  function check(name: string, cond: boolean): void {
    if (cond) {
      console.log(`SELFTEST PASS: ${name}`);
    } else {
      console.error(`SELFTEST FAIL: ${name}`);
      allPassed = false;
    }
  }

  // parseRegistryWorkspaces on a representative multi-line block (incl. a `session:` sub-line).
  const sampleYaml = [
    "workspaces:",
    "  - path: /w/home              # the home repo",
    "  - path: /w/alpha",
    "    session: alpha-1",
    "  - path: /w/beta",
    "  - path: /w/gamma",
  ].join("\n");
  const parsed = parseRegistryWorkspaces(sampleYaml);
  check(
    "parseRegistryWorkspaces extracts all 4 paths in order, ignoring session lines",
    JSON.stringify(parsed) === JSON.stringify(["/w/home", "/w/alpha", "/w/beta", "/w/gamma"])
  );

  // workspaceHasAbiTransition — GREEN: pass on a real item.
  check(
    "workspaceHasAbiTransition: pass on a real item → true",
    workspaceHasAbiTransition('{"item_id":"DIR-001","verdict":"pass"}') === true
  );
  // RED: pass only on fixture ids (QC-/QENG-) → false.
  check(
    "workspaceHasAbiTransition: pass only on QC-/QENG- fixture ids → false",
    workspaceHasAbiTransition(
      '{"item_id":"QC-1","verdict":"pass"}\n{"item_id":"QENG-2","verdict":"pass"}'
    ) === false
  );
  // RED: only fails → false.
  check(
    "workspaceHasAbiTransition: only fail verdicts → false",
    workspaceHasAbiTransition('{"item_id":"DIR-001","verdict":"fail"}') === false
  );
  // Empty ledger → false.
  check("workspaceHasAbiTransition: empty text → false", workspaceHasAbiTransition("") === false);

  // computeS3Cov — GREEN: 3 non-home targets, 2 with real transitions → cov 2/3; home excluded.
  const ledgers: Record<string, string> = {
    "/w/home": '{"item_id":"DIR-001","verdict":"pass"}', // home: excluded from target entirely
    "/w/alpha": '{"item_id":"TASK-24","verdict":"pass"}', // real transition
    "/w/beta": '{"item_id":"QC-1","verdict":"pass"}', // fixture-only → no transition
    "/w/gamma": '{"item_id":"DIR-002","verdict":"pass"}', // real transition
  };
  const res = computeS3Cov({
    registryPaths: ["/w/home", "/w/alpha", "/w/beta", "/w/gamma"],
    homeRepoPath: "/w/home",
    readLedger: (p) => (p in ledgers ? ledgers[p] : null),
  });
  check("computeS3Cov: target excludes home → target === 3", res.target === 3);
  check("computeS3Cov: 2 of 3 reached → reached === 2", res.reached === 2);
  check("computeS3Cov: cov === 2/3", Math.abs(res.cov - 2 / 3) < 1e-12);
  check(
    "computeS3Cov: reachedPaths are exactly the two real ones",
    JSON.stringify(res.reachedPaths) === JSON.stringify(["/w/alpha", "/w/gamma"])
  );

  // computeS3Cov — RED: empty target set (registry only lists home) → throws (fail-closed).
  let threw = false;
  try {
    computeS3Cov({
      registryPaths: ["/w/home"],
      homeRepoPath: "/w/home",
      readLedger: () => null,
    });
  } catch {
    threw = true;
  }
  check("computeS3Cov: empty target set throws (fail-closed)", threw);

  if (allPassed) {
    console.log("SELFTEST: all fixture cases PASS.");
  } else {
    console.error("SELFTEST: one or more fixture cases FAILED.");
  }
  return allPassed;
}

// ── real-filesystem readLedger — missing file → null. ──────────────────────────────────────────────
function realReadLedger(workspacePath: string): string | null {
  const ledgerPath = path.join(workspacePath, ".quay", "gate-events.jsonl");
  if (!fs.existsSync(ledgerPath)) return null;
  return fs.readFileSync(ledgerPath, "utf8");
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────────
const isDirect =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirect) {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) {
    process.exit(selftest() ? 0 : 1);
  }
  if (!fs.existsSync(REGISTRY_PATH)) {
    console.error(`ERROR: registry not found: ${REGISTRY_PATH}`);
    process.exit(2);
  }
  const registryPaths = parseRegistryWorkspaces(fs.readFileSync(REGISTRY_PATH, "utf8"));
  let result: S3CovResult;
  try {
    result = computeS3Cov({
      registryPaths,
      homeRepoPath: REPO_ROOT,
      readLedger: realReadLedger,
    });
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    process.exit(2);
  }
  const covStr = result.cov.toFixed(4).replace(/\.?0+$/, "") || "0";
  console.log(
    `S3 External-validation cov = ${covStr} (${result.reached}/${result.target} registered workspaces have a real ABI transition)`
  );
  if (result.reachedPaths.length > 0) {
    console.log("reached workspaces:");
    for (const p of result.reachedPaths) console.log(`  - ${p}`);
  } else {
    console.log("reached workspaces: (none — no external workspace has a real ABI transition yet)");
  }
  process.exit(0);
}
