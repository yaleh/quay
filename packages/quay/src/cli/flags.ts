// cli/flags.ts — the LIGHT pure-helper half of cli/shared.ts (gap-reduce-sync-
// spawn-floor-suite-slowdown).
//
// The Core CLI is spawned ~200+ times per suite, and its per-spawn floor was
// dominated by cli/shared.ts's transitive provider-machinery imports
// (../config.ts → loadConfig/activeProvider, ../gate/config/loader.ts,
// ../provider-client.ts, ../provider-env.ts — measured ≈ +0.34s per process
// over a bare node startup). bin/quay.ts imports parseFlags/resolveJsonFlag at
// module load for its pre-dispatch plumbing, so EVERY invocation (`--version`,
// `--help`, `task list`, ...) paid that full graph just to print a version.
//
// This module holds the functions that need NONE of that machinery (flag
// parsing, pure string/body helpers — node builtins only), moved VERBATIM from
// cli/shared.ts. cli/shared.ts re-exports them so every existing importer keeps
// working unchanged; bin/quay.ts imports ONLY this module for its eager
// dispatch plumbing, so the provider graph is deferred to the first handler
// that actually connects to a provider (loaded lazily at dispatch).
//
// No behavior change — these are the same functions from shared.ts, moved
// byte-for-byte (golden-replay equivalence preserved).
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { Buffer } from "node:buffer";

// CliFlags — the dynamic flag bag produced by parseFlags/parseVerbless.
// Flag values are strings (--key value), booleans (a bare --key), or arrays of
// strings (repeated flags, e.g. --label A --label B). The object is keyed
// arbitrarily by whichever flags a command surface declares, so it is typed as
// a loose `any`-valued record — restoring the dynamic-shape behavior of the
// pre-migration bin/quay.ts dispatch (gap-cli-import-command-migration-into-src
// dropped the type; the handlers read verb-specific fields like gate/file/json/
// provider/root directly off it).
export type CliFlags = Record<string, any>;

export function fsSyncExists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

// DIR-103-A (M223): known boolean flags — when a flag name is in this set,
// parseFlags sets flags[key]=true WITHOUT consuming the next token (it stays
// a positional / next flag). Name-scoped and safe: `--dry-run` is already a
// pure boolean on the `init` surface (:1077) and no command anywhere takes a
// value after it, so this changes no existing command's parse.
const BOOLEAN_FLAGS = new Set(["dry-run"]);

// CB-021 (M08-merge-recover): `--format json` is a documented alias for
// `--json` (both flags are accepted everywhere `--json` is; see printHelp()).
// Any other `--format <value>` (e.g. `--format yaml`, `--format` with no
// value) is a usage error — it must NOT silently fall through to
// human-readable output, which is exactly the bug this closes.
// Returns { json: boolean } | null (null = invalid --format value, caller
// should print an error and exit 1).
export function resolveJsonFlag(flags: CliFlags): { json: boolean } | null {
  if (flags.format === undefined) {
    return { json: flags.json === true };
  }
  if (typeof flags.format === "string" && flags.format.toLowerCase() === "json") {
    return { json: true };
  }
  return null; // invalid --format value
}

// UQ-047/UQ-048 (M08-merge-recover): shared --page-size parser used by every
// `task list` output mode (CLI table, --json/--format json) AND documented
// for the Web UI's own ?pageSize= param (src/serve.js). A missing --page-size
// means "no limit" (existing behavior, preserved); an explicitly-invalid
// value (0, negative, non-numeric) is a hard usage error, not a silent
// fall-back to "show everything" (UQ-048).
export function resolvePageSize(flags: CliFlags): { pageSize: number | null; error: string | null } {
  if (flags["page-size"] === undefined) {
    return { pageSize: null, error: null };
  }
  const raw = flags["page-size"];
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (typeof raw !== "string" || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return {
      pageSize: null,
      error: `Error: --page-size requires a positive integer (got ${JSON.stringify(raw)})`,
    };
  }
  return { pageSize: n, error: null };
}

export function parseFlags(argv: string[]): { flags: CliFlags; positional: string[] } {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      // DIR-103-A (M223): known boolean flags never consume the next token
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          // QX-016 (experiment 4, iteration 4): support repeated flags (e.g. --label A --label B).
          // If the key already has a value, convert to array or push to existing array.
          // This fixes CB-013 (CLI last-wins bug): previously `flags[key] = next` silently
          // overwrote any prior value, so --label A --label B silently used only B.
          if (flags[key] !== undefined && flags[key] !== true) {
            flags[key] = Array.isArray(flags[key]) ? [...flags[key], next] : [flags[key], next];
          } else {
            flags[key] = next;
          }
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

// Verb-less CLI arg ordering: the six verb-less commands (gate/gate-log/complete/
// adjudicate/promote/retreat) take <task-id> as their first positional. The
// top-level destructure `const [, , cmd, sub, ...rest] = process.argv` puts
// argv[3] in `sub` and parses ONLY `rest`, so a LEADING flag (e.g.
// `quay gate --gate dod ID`) was misread as the id AND its value was dropped
// from the flag parse (flags.gate lost -> silently defaulted). Re-parse the full
// `[sub, ...rest]` — exactly as the `run` command already does — so the id and
// flags are recovered flag-aware, in either order. Returns { flags, id }; `id`
// is undefined when no positional was given (caller must emit a usage error).
export function parseVerbless(sub: string | undefined, rest: string[]): { flags: CliFlags; id: string | undefined } {
  const { flags, positional } = parseFlags([sub, ...rest].filter((a) => a !== undefined));
  return { flags, id: positional[0] };
}

// M16-cli-edit-parity-impl (design doc §1.3): read all of a readable stream
// (used for `--body-file -` / stdin) into a single string.
export async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf8");
}

// M16-cli-edit-parity-impl (design doc §1.3's `resolveBody` sketch):
// whole-body-replacement mode. `--body-file <path>` reads the file's full
// contents as the new body verbatim; `--body-file -` reads from stdin.
// Plain `--body <string>` remains available for short bodies passed
// directly as a shell argument. Mutual exclusion with `--body` is validated
// by the caller (task edit handler) before this is invoked.
export async function resolveBody(flags) {
  if (flags["body-file"] !== undefined) {
    if (flags["body-file"] === "-") {
      return await readAll(process.stdin); // whole-body replacement from stdin
    }
    return await fsPromises.readFile(flags["body-file"], "utf8"); // whole-body replacement from file
  }
  return flags.body; // short-string mode, already validated present by the caller
}

// QX-022 (experiment 4, iteration 5): relative-time helper for CLI timestamp column.
// It was once a self-declared "deliberate mirror" of serve-render.ts's relativeTime,
// kept inline to avoid importing serve.js (which starts an HTTP server on import).
// gap-routine-semantic-dedup-scan-relative-time-mirror: that reason does not apply to
// a pure leaf, so the ONE definition is now ../relative-time.ts — reachable from this
// LIGHT module without pulling the provider graph (the same constraint the inline copy
// existed to respect; see flags.test.mjs's spawn-floor guard). Re-exported under this
// module's original public name so bin/quay.ts and shared.ts keep working unchanged.
export { relativeTime as relativeTimeCli } from "../relative-time.ts";

// QX-028 (experiment 4, iteration 7) introduced this helper here; QX-041 added
// the inFence carve-out only to serve.ts, and QX-044 had to chase the same fix
// into another copy (SH-005) — the drift this re-export removes. The ONE
// definition is now the product-layer leaf ../search-index.ts, imported by
// every search surface (this module, mcp-handlers.ts, serve-render.ts and the
// native store). Re-exported here (the LIGHT module) so bin/quay.ts's and
// shared.ts's existing importers keep working unchanged, without pulling the
// provider graph — search-index.ts is a pure, builtin-free leaf.
export { stripHeadings } from "../search-index.ts";
