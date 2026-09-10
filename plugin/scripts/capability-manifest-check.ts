// capability-manifest-check.ts — bidirectional capability↔delivery-manifest enumeration.
// (tasks/gap-delivery-manifest-capability-map)
//
// WHY THIS EXISTS: delivery-manifest.json used to declare only release ARTIFACTS (npm tarballs /
// SEA binaries / plugin), never the CAPABILITIES those artifacts must carry (driver kind 集合、
// quay CLI 顶层命令集、MCP server 集合). The packaging/closure checks (packages/quay/scripts/
// package.sh, build-plugin-dist.mjs) are "scan-references" heuristics — a NEW literal table or a
// NEW file is structurally invisible to them. GOAL-009 AC-202 measured the canonical instance:
// driver-runtime.ts's DRIVER_KINDS data-table literals referenced files not in any closure check's
// coverage, so 6 driver kinds once shipped without the files they spawn until a third-party host
// actually ran them (gap-driver-kinds-table-literal-not-in-dist-entry, done). The fix is a
// CAPABILITY INVENTORY to diff against — the manifest's `capabilities` array — plus THIS check that
// keeps the inventory honest in BOTH directions:
//   source has X, manifest doesn't register X  ⇒ "unregistered capability"   ⇒ RED (exit 1)
//   manifest registers X, source no longer has X ⇒ "stale registration"      ⇒ RED (exit 1)
//
// The three enumerated source-of-truth kinds (SUPPORTED_KINDS):
//   driver-kind   plugin/scripts/driver-runtime.ts DRIVER_KINDS keys (imported — the REAL runtime
//                 set, not a regex approximation; hard rule 4b: 直接量 over 代理量)
//   cli-command   packages/quay/bin/quay.ts dispatch `if (cmd === "X")` routing lines
//   mcp-server    packages/<pkg>/src/mcp-server.ts — one per package that ships an MCP server
//
// Falsifiability (hard rule 3b / 4 — the meter must be able to read RED, not self-assert PASS):
// the negative control is exercised by plugin/test/capability-manifest-check.test.mjs (hand-built
// source/manifest sets → unregistered + stale both must be non-empty) AND by the checker-mutation
// case plugin/scripts/checker-mutation-cases/capability-manifest-check.sh (delete one driver-kind
// from the manifest → exit 1; restore → exit 0). A source enumeration that cannot be read returns
// NOT-EVALUATED (exit 2), never conflated with "0 unregistered" (a check that found nothing to
// read must not report PASS).
//
// Run:
//   node --experimental-strip-types plugin/scripts/capability-manifest-check.ts --root <dir>
//   node --experimental-strip-types plugin/scripts/capability-manifest-check.ts --root <dir> --json
//   node --experimental-strip-types plugin/scripts/capability-manifest-check.ts --root <dir> --manifest <path>
//     (--manifest overrides the manifest path; used by the mutation case to inject a defect)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./repo-root.ts";
// driver-runtime.ts is widely imported at runtime (outer-driver.test.mjs, meta-driver.ts, …) — import-safe.
import { DRIVER_KINDS } from "./driver-runtime.ts";

export const MANIFEST_REL = "delivery-manifest.json";

/** The capability kinds this check enumerates. A manifest entry of any OTHER kind is structurally
 *  validated (name/sourceRef present) but not enumerated (no source set to diff against — yet). */
export const SUPPORTED_KINDS = ["driver-kind", "cli-command", "mcp-server"] as const;
export type CapabilityKind = (typeof SUPPORTED_KINDS)[number];

export interface Capability {
  name: string;
  kind: string;
  sourceRef?: string;
  verifiedBy?: string;
}

/** Source-of-truth sets, keyed by supported kind. A null value = could not enumerate (NOT-EVALUATED). */
export type SourceSets = Record<CapabilityKind, Set<string> | null>;

// ── Source enumeration ──────────────────────────────────────────────────────────────────────────────

/** The REAL driver-kind set — Object.keys of the imported DRIVER_KINDS table (not a regex). */
export function enumerateDriverKinds(): Set<string> {
  return new Set(Object.keys(DRIVER_KINDS));
}

/** Top-level CLI verbs from the quay.ts dispatch skeleton (`if (cmd === "X")` routing). Returns null
 *  when zero routing lines are found — a structurally-changed dispatch must NOT read as "no commands". */
export function enumerateCliCommands(src: string): Set<string> | null {
  const re = /\bcmd\s*===\s*"([a-z][a-z0-9-]*)"/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) set.add(m[1]);
  return set.size === 0 ? null : set;
}

/** MCP server set — every packages/<pkg> that ships a src/mcp-server.ts (the package dir name IS
 *  the server name: quay / quay-native / quay-github). Returns null when none found. */
export function enumerateMcpServers(root: string): Set<string> | null {
  const pkgDir = path.join(root, "packages");
  const set = new Set<string>();
  if (!fs.existsSync(pkgDir)) return null;
  for (const name of fs.readdirSync(pkgDir)) {
    if (name.startsWith(".")) continue;
    if (fs.existsSync(path.join(pkgDir, name, "src", "mcp-server.ts"))) set.add(name);
  }
  return set.size === 0 ? null : set;
}

// ── Manifest reading ───────────────────────────────────────────────────────────────────────────────

/** Read delivery-manifest.json and return its `capabilities` array, or null when the manifest is
 *  missing / unparseable / has no `capabilities` array (structural defect — NOT a valid "0 caps"). */
export function readManifestCapabilities(root: string, manifestPath?: string): Capability[] | null {
  const p = manifestPath ? path.resolve(manifestPath) : path.join(root, MANIFEST_REL);
  if (!fs.existsSync(p)) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.capabilities)) return null;
  return parsed.capabilities as Capability[];
}

// ── Bidirectional diff (pure — the testable core) ──────────────────────────────────────────────────

export interface KindDiff {
  kind: CapabilityKind;
  source: string[];
  manifest: string[];
  /** in source, not registered in manifest */
  unregistered: string[];
  /** registered in manifest, no longer in source */
  stale: string[];
}

/** Diff one kind: source − manifest = unregistered; manifest − source = stale. */
export function diffKind(kind: CapabilityKind, source: Set<string>, manifest: Set<string>): KindDiff {
  const unregistered = [...source].filter((n) => !manifest.has(n)).sort();
  const stale = [...manifest].filter((n) => !source.has(n)).sort();
  return { kind, source: [...source].sort(), manifest: [...manifest].sort(), unregistered, stale };
}

// ── Full check ──────────────────────────────────────────────────────────────────────────────────────

export interface CapabilityCheckResult {
  ok: boolean;
  /** false = NOT-EVALUATED (a source or the manifest could not be read — never conflated with ok) */
  evaluated: boolean;
  reason: string;
  /** structural defects on individual manifest entries (missing name/sourceRef, empty name, …) */
  structural: string[];
  diffs: KindDiff[];
}

/** Build the source set for a kind from raw enumerations, or null when any enumeration failed. */
export function collectSourceSets(root: string, cliSrc: string): SourceSets {
  return {
    "driver-kind": enumerateDriverKinds(),
    "cli-command": enumerateCliCommands(cliSrc),
    "mcp-server": enumerateMcpServers(root),
  };
}

/** The whole check, import-callable. Returns NOT-EVALUATED (evaluated=false) when the manifest is
 *  absent/unparseable or any supported source cannot be enumerated. */
export function check(
  root: string,
  opts: { manifestPath?: string; cliPath?: string } = {},
): CapabilityCheckResult {
  const manifestPath = opts.manifestPath;
  const cliPath = opts.cliPath ?? path.join(root, "packages", "quay", "bin", "quay.ts");

  const caps = readManifestCapabilities(root, manifestPath);
  if (caps === null) {
    return {
      ok: false,
      evaluated: false,
      reason: `delivery-manifest.json missing/unparseable, or its 'capabilities' array is absent (root=${root})`,
      structural: [],
      diffs: [],
    };
  }

  // Structural validation: every entry needs a non-empty name + sourceRef.
  const structural: string[] = [];
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i];
    const where = `capabilities[${i}]`;
    if (typeof c !== "object" || c === null) {
      structural.push(`${where}: not an object`);
      continue;
    }
    if (typeof c.name !== "string" || c.name.trim() === "") {
      structural.push(`${where}: missing/empty name`);
    }
    if (typeof c.kind !== "string" || c.kind.trim() === "") {
      structural.push(`${where}: missing/empty kind`);
    }
    if (typeof c.sourceRef !== "string" || c.sourceRef.trim() === "") {
      structural.push(`${where}: missing/empty sourceRef`);
    }
  }

  const cliSrc = fs.existsSync(cliPath) ? fs.readFileSync(cliPath, "utf8") : "";
  const sources = collectSourceSets(root, cliSrc);

  // NOT-EVALUATED if any supported source set is null (couldn't read → must not look like "0 drift").
  const unevaluable = SUPPORTED_KINDS.filter((k) => sources[k] === null);
  if (unevaluable.length > 0) {
    return {
      ok: false,
      evaluated: false,
      reason: `cannot enumerate source for: ${unevaluable.join(", ")} (root=${root})`,
      structural,
      diffs: [],
    };
  }

  const diffs: KindDiff[] = SUPPORTED_KINDS.map((kind) => {
    const manifest = new Set(caps.filter((c) => c.kind === kind).map((c) => c.name));
    return diffKind(kind, sources[kind] as Set<string>, manifest);
  });

  const anyDefect =
    structural.length > 0 || diffs.some((d) => d.unregistered.length > 0 || d.stale.length > 0);

  return {
    ok: !anyDefect,
    evaluated: true,
    reason: anyDefect
      ? "capability↔manifest drift (unregistered/stale) or structural defect — see diffs/structural"
      : "capability↔manifest enumeration consistent in both directions",
    structural,
    diffs,
  };
}

// ── Output ──────────────────────────────────────────────────────────────────────────────────────────

export function formatResult(res: CapabilityCheckResult): string {
  if (!res.evaluated) {
    return `capability-manifest-check: NOT-EVALUATED — ${res.reason}`;
  }
  const lines: string[] = [];
  if (res.ok) {
    lines.push("capability-manifest-check: PASS — no unregistered capability, no stale registration");
  } else {
    lines.push("capability-manifest-check: FAIL");
  }
  for (const d of res.diffs) {
    const stat = d.unregistered.length === 0 && d.stale.length === 0 ? "ok" : "DRIFT";
    lines.push(`  [${d.kind}] ${stat}: source=${d.source.length} manifest=${d.manifest.length}`);
    for (const n of d.unregistered) lines.push(`    UNREGISTERED: ${n} (in source, not in manifest)`);
    for (const n of d.stale) lines.push(`    STALE: ${n} (in manifest, not in source)`);
  }
  for (const s of res.structural) lines.push(`  STRUCTURAL: ${s}`);
  return lines.join("\n");
}

export function main(argv: string[]): number {
  const args = argv.slice(2);
  let root: string | null = null;
  let manifestPath: string | null = null;
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      root = args[i + 1];
      i++;
    } else if (args[i].startsWith("--root=")) {
      root = args[i].slice("--root=".length);
    } else if (args[i] === "--manifest") {
      manifestPath = args[i + 1];
      i++;
    } else if (args[i].startsWith("--manifest=")) {
      manifestPath = args[i].slice("--manifest=".length);
    } else if (args[i] === "--json") {
      asJson = true;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(
        "usage: capability-manifest-check.ts [--root <dir>] [--manifest <path>] [--json]\n" +
          "  bidirectional capability↔delivery-manifest enumeration (exit 0 PASS / 1 RED / 2 NOT-EVALUATED)",
      );
      return 0;
    } else {
      console.error(`capability-manifest-check: unknown arg: ${args[i]}`);
      return 2;
    }
  }

  let resolved: string;
  try {
    resolved = root ? path.resolve(root) : repoRoot();
  } catch (e) {
    console.error(`capability-manifest-check: ${(e as Error).message}`);
    return 2;
  }
  if (!fs.existsSync(resolved)) {
    console.error(`capability-manifest-check: check root not found: ${resolved}`);
    return 2;
  }

  const res = check(resolved, manifestPath ? { manifestPath } : {});
  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok: res.ok,
          evaluated: res.evaluated,
          reason: res.reason,
          structural: res.structural,
          diffs: res.diffs,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(formatResult(res));
  }
  if (!res.evaluated) return 2;
  return res.ok ? 0 : 1;
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) &&
  path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "capability-manifest-check";
if (isDirect) {
  process.exitCode = main(process.argv);
}
