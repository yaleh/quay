// serve-binding-literal-check.ts — the AC1/AC7 static check for
// gap-serve-binding-defaults-three-copies-to-one-definition-point.
//
// THE INVARIANT: the `quay serve` web binding's host literal has exactly ONE definition point —
// `SERVE_BINDING_FALLBACK` in `packages/quay/src/serve-binding.ts` (the fallback branch of the one
// resolver every reader goes through). Before this, the same quantity had three definitions that
// DISAGREED about the host (all-interfaces / all-interfaces / loopback), and `plugin/scripts/
// start-drivers.ts` additionally wrote `--port 0` into every spawned host's cmdline — the mechanism
// behind the seventeen `…criterion-cmdline-port-literal-stale` gaps whose criteria derived a live
// address from a literal that was structurally always 0.
//
// THE PREDICATE IS THE AC's OWN GREP, not a paraphrase:
//   grep -rn <DQUOTE>0.0.0.0<DQUOTE>|<DQUOTE>127.0.0.1<DQUOTE> packages/quay/src plugin/scripts
//   → the quoted bind-default literal appears at most ONCE, and that one occurrence rides on the
//     SERVE_BINDING_FALLBACK declaration.
// NOTE the checker does NOT contain either literal itself — it searches for
// `JSON.stringify(SERVE_BINDING_FALLBACK.host)` and `JSON.stringify(CONTROL_PLANE_DEFAULT_HOST)`, so
// the check and the declaration share ONE source and the checker can never be its own false
// positive. (Any real quoted occurrence in this file would be counted by the scan it documents.)
//
// ADVISORY, NOT FAILING (硬规则 5b — the sibling set stays visible): the same two addresses appear
// QUOTED in a handful of files for a DIFFERENT 口径 — normalising a wildcard bind to a probeable
// address, a rendering default, or a probe harness's own loopback listener. Each is listed in
// ADVISORY_ALLOWLIST with its reason and reported with its count, never as a hard failure. Every
// other quoted occurrence anywhere under the scan roots IS a hard hit — so a duplicate introduced
// in a NEW file goes red, which is the re-growth this check exists to stop.
//
// ALSO CHECKED (AC8): the DOC SURFACE that restates the default —
// `plugin/skills/drivers/SKILL.md` — must still contain the fallback host. A doc that silently kept
// an old value would be the same drift, one layer up. (`packages/quay/src/cli/help.ts` cannot drift:
// it INTERPOLATES the constant instead of re-typing it.)
//
// Usage:
//   node --experimental-strip-types plugin/scripts/serve-binding-literal-check.ts [--root <dir>] [--json]
// Exit: 0 = invariant holds (≤1 quoted hit, and it is the declaration); 1 = violated.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";
import { SERVE_BINDING_FALLBACK } from "../../packages/quay/src/serve-binding.ts";
import { CONTROL_PLANE_DEFAULT_HOST } from "../../packages/quay/src/kernel/control-plane-http.ts";

/** The scan roots — the AC's own two arguments. */
export const SCAN_ROOTS = ["packages/quay/src", "plugin/scripts"];

/** The single file allowed to hold the bind-default literal. */
export const HOLDER_REL = "packages/quay/src/serve-binding.ts";

/** The declaration the single hit must ride on. */
export const DECLARATION_MARKER = "SERVE_BINDING_FALLBACK";

/** The doc surface that restates the fallback host (a hand-written file, so it CAN drift). */
export const DOC_SURFACE_REL = "plugin/skills/drivers/SKILL.md";

/**
 * Files where a quoted address is a DIFFERENT 口径, not a second bind default. Every entry carries
 * its reason (ADR-036 规范 5: 豁免须显式且带理由) and is reported as advisory, never silently dropped.
 * Adding an entry here is a deliberate, reviewable act — the default answer for a new quoted
 * occurrence anywhere else is RED.
 */
export const ADVISORY_ALLOWLIST: ReadonlyArray<{ rel: string; reason: string }> = [
  {
    rel: "packages/quay/src/server-state.ts",
    reason: "normalises a wildcard bind host to a PROBEABLE address (the port-probe helper); it compares/derives, it does not define a bind default",
  },
  {
    rel: "packages/quay/src/kernel/control-plane-http.ts",
    reason: "CONTROL_PLANE_DEFAULT_HOST — the control plane's own loopback default, a DIFFERENT quantity from the web binding (loopback by design; exported so serve.ts can publish the same value)",
  },
  {
    rel: "plugin/scripts/server-partial-stop-verify.ts",
    reason: "verification-side normaliser, same 口径 as server-state.ts",
  },
  {
    rel: "plugin/scripts/channel-probe-server.ts",
    reason: "a probe harness's OWN loopback listener — it is not a quay serve host and has no .quay/config.yml",
  },
  {
    rel: "plugin/scripts/develop-deliver-tgz.sh",
    reason: "a throwaway test HTTP server embedded in a shell delivery script — never a workspace's serve host",
  },
];

const SKIP_DIRS = new Set(["node_modules", ".git"]);

export interface LiteralHit {
  /** Repo-relative path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The trimmed line content. */
  text: string;
}

export interface ServeBindingLiteralReport {
  ok: boolean;
  /** The quoted patterns actually searched — built from the declarations, never spelled here. */
  patterns: string[];
  /** Quoted hits that are NOT allowlisted — must be exactly 1, in HOLDER_REL on DECLARATION_MARKER. */
  hits: LiteralHit[];
  /** Allowlisted quoted hits (reported, non-failing). */
  advisory: LiteralHit[];
  /** How many UNQUOTED occurrences of the two addresses the scan roots carry (comments/prose). */
  unquotedCount: number;
  /** AC8 — does the doc surface still carry the fallback host? */
  docSurface: { file: string; ok: boolean; detail: string };
  /** Human-readable verdict. */
  reason: string;
}

function walkFiles(absDir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkFiles(path.join(absDir, e.name), out);
    } else if (e.isFile()) {
      out.push(path.join(absDir, e.name));
    }
  }
}

/**
 * Scan `root` for the serve-binding literal. Pure w.r.t. the filesystem reads it performs; never
 * throws (an unreadable file is skipped, an unreadable doc surface is NOT-EVALUATED, not "ok").
 */
export function checkServeBindingLiteral(root: string): ServeBindingLiteralReport {
  const rootAbs = path.resolve(root);
  const names = [SERVE_BINDING_FALLBACK.host, CONTROL_PLANE_DEFAULT_HOST];
  // The double-quoted forms — the AC's exact pattern, derived so this file holds neither literal.
  const quoted = names.map((n) => JSON.stringify(n));
  const allow = new Set(ADVISORY_ALLOWLIST.map((a) => a.rel));

  const files: string[] = [];
  for (const rel of SCAN_ROOTS) walkFiles(path.join(rootAbs, rel), files);
  files.sort();

  const hits: LiteralHit[] = [];
  const advisory: LiteralHit[] = [];
  let unquotedCount = 0;
  for (const abs of files) {
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!names.some((n) => text.includes(n))) continue;
    const rel = path.relative(rootAbs, abs).split(path.sep).join("/");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasName = names.some((n) => line.includes(n));
      if (!hasName) continue;
      const hit: LiteralHit = { file: rel, line: i + 1, text: line.trim() };
      if (quoted.some((q) => line.includes(q))) {
        if (allow.has(rel)) advisory.push(hit);
        else hits.push(hit);
      } else {
        unquotedCount += 1;
      }
    }
  }

  // AC8: the doc surface that RESTATES the fallback (a hand-written file, so it can drift).
  let docSurface: ServeBindingLiteralReport["docSurface"];
  try {
    const doc = fs.readFileSync(path.join(rootAbs, DOC_SURFACE_REL), "utf8");
    const ok = doc.includes(SERVE_BINDING_FALLBACK.host);
    docSurface = {
      file: DOC_SURFACE_REL,
      ok,
      detail: ok
        ? `${DOC_SURFACE_REL} carries the fallback host`
        : `${DOC_SURFACE_REL} does NOT carry the fallback host — the doc surface has drifted from serve-binding.ts`,
    };
  } catch (err) {
    // 硬规则 3b: "could not read the doc surface" is its OWN state, never folded into "ok".
    docSurface = {
      file: DOC_SURFACE_REL,
      ok: false,
      detail: `${DOC_SURFACE_REL} could not be read (${(err as NodeJS.ErrnoException)?.code ?? String(err)}) — NOT evaluated, so not a pass`,
    };
  }

  // ⛔ The verdict is THREE-valued in shape: zero hits, more-than-one hit, and "exactly one but not
  // the declaration" are three DIFFERENT failures (硬规则 3b) — a lone literal in a non-holder file
  // must not read as a pass just because it happens to be unique.
  const single = hits.length === 1 ? hits[0] : null;
  const declared = single !== null && single.file === HOLDER_REL && single.text.includes(DECLARATION_MARKER);
  const ok = declared && docSurface.ok;
  let reason: string;
  if (hits.length === 0) {
    reason = `no quoted bind default (${quoted.join(" / ")}) in ${SCAN_ROOTS.join(" or ")} — the ${DECLARATION_MARKER} declaration is absent or renamed`;
  } else if (hits.length > 1) {
    reason = `${hits.length} quoted bind-default sites (must be exactly 1): ` +
      hits.map((h) => `${h.file}:${h.line}`).join(", ");
  } else {
    const h = hits[0];
    if (h.file !== HOLDER_REL || !h.text.includes(DECLARATION_MARKER)) {
      reason = `the single quoted bind default is at ${h.file}:${h.line}, NOT the ${DECLARATION_MARKER} declaration in ${HOLDER_REL} — a second reader is spelling the binding itself`;
    } else if (!docSurface.ok) {
      reason = docSurface.detail;
    } else {
      reason = `1 quoted bind default, at ${h.file}:${h.line} (${DECLARATION_MARKER}); ${docSurface.detail}`;
    }
  }
  return { ok, patterns: quoted, hits, advisory, unquotedCount, docSurface, reason };
}

function main(argv: string[]): number {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = argv[++i] ?? root;
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else if (a === "--json") json = true;
  }
  const report = checkServeBindingLiteral(root);
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(
      `serve-binding-literal-check: ${report.ok ? "PASS" : "FAIL"} — ${report.reason}\n` +
        `  advisory (allowlisted, non-failing): ${report.advisory.length} occurrence(s)` +
        (report.advisory.length > 0
          ? "\n" + report.advisory.map((h) => `    ${h.file}:${h.line}`).join("\n")
          : "") +
        `\n  advisory (unquoted, non-failing): ${report.unquotedCount} occurrence(s)\n`,
    );
  }
  return report.ok ? 0 : 1;
}

const invokedDirectly = (() => {
  try {
    return isDirectEntry(import.meta, undefined, "serve-binding-literal-check");
  } catch {
    return false;
  }
})();
if (invokedDirectly) process.exit(main(process.argv.slice(2)));
