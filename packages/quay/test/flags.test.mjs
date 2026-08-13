// @test-group product
// flags.test.mjs — pins the LIGHT helper-module split
// (gap-reduce-sync-spawn-floor-suite-slowdown).
//
// The Core CLI is spawned ~200+ times per suite, and its per-spawn floor was
// dominated by cli/shared.ts's transitive provider-machinery imports
// (../config.ts, ../provider-client.ts, ../provider-env.ts,
// ../gate/config/loader.ts — measured ≈ +0.34s per process). bin/quay.ts
// imports parseFlags/resolveJsonFlag at module load for its pre-dispatch
// plumbing, so EVERY invocation paid that full graph. The fix split the LIGHT
// pure helpers (flag parsing, pure string/body helpers — node builtins only)
// into cli/flags.ts; shared.ts re-exports them so importers keep working.
//
// These tests pin the fix so it cannot silently regress:
//   1. flags.ts must stay FREE of the provider-machinery imports (structural —
//      if someone re-adds `import ... from "../config.ts"` here, the per-spawn
//      floor regresses and THIS test goes red).
//   2. shared.ts must re-export the same function objects from flags.ts (so the
//      existing importers of shared.ts — every src/cli/*.ts handler — keep
//      working unchanged).
//   3. the helpers still behave (parseFlags sanity — no behavior drift from the
//      move).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, "..");
const flagsPath = path.join(pkgRoot, "src", "cli", "flags.ts");
const sharedPath = path.join(pkgRoot, "src", "cli", "shared.ts");

// The provider-machinery modules that made cli/shared.ts heavy. flags.ts must
// never import them (or anything that transitively reaches them via a static
// import) — that is the whole point of the split.
const PROVIDER_GRAPH_MARKERS = [
  "../config.ts",
  "../provider-client.ts",
  "../provider-env.ts",
  "../gate/config/loader.ts",
];

const LIGHT_HELPERS = [
  "parseFlags",
  "parseVerbless",
  "resolveJsonFlag",
  "resolvePageSize",
  "relativeTimeCli",
  "stripHeadings",
  "fsSyncExists",
  "readAll",
  "resolveBody",
];

test("flags.ts stays free of the provider-machinery graph (CLI spawn-floor guard)", () => {
  const src = readFileSync(flagsPath, "utf8");
  // Match only actual `import ... from "<spec>"` / `export ... from "<spec>"`
  // statements — the doc comment above names the heavy modules as prose, which
  // must NOT trip this guard.
  const importSpecifiers = [...src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["'](\.[^"']+)["']/g)].map((m) => m[1]);
  for (const marker of PROVIDER_GRAPH_MARKERS) {
    assert.ok(
      !importSpecifiers.includes(marker),
      `flags.ts must not import ${marker} — re-adding the provider graph to the light module regresses the CLI's per-spawn floor`
    );
  }
  // Sanity: the light module is actually a module (has content), not accidentally empty.
  assert.match(src, /export function parseFlags/, "flags.ts must still define parseFlags");
});

test("shared.ts re-exports the light helpers from flags.ts (importers unchanged)", async () => {
  const flags = await import(`file://${flagsPath}`);
  const shared = await import(`file://${sharedPath}`);
  for (const name of LIGHT_HELPERS) {
    assert.equal(
      typeof flags[name],
      "function",
      `flags.ts must export ${name}`
    );
    assert.equal(
      shared[name],
      flags[name],
      `shared.ts must re-export the SAME ${name} object from flags.ts (existing importers keep working)`
    );
  }
});

test("parseFlags still behaves after the move (no behavior drift)", async () => {
  const { parseFlags } = await import(`file://${flagsPath}`);
  assert.deepEqual(parseFlags([]), { flags: {}, positional: [] });
  // A bare --json followed by another flag stays boolean true.
  assert.deepEqual(parseFlags(["--json", "--label", "x", "--label", "y"]), {
    flags: { json: true, label: ["x", "y"] },
    positional: [],
  });
  // A value after a non-boolean flag is consumed as that flag's value (QX-016
  // repeated flags become arrays).
  assert.deepEqual(parseFlags(["a", "--label", "x", "--label", "y"]), {
    flags: { label: ["x", "y"] },
    positional: ["a"],
  });
  // DIR-103-A known boolean flag: --dry-run never consumes the next token.
  assert.deepEqual(parseFlags(["--dry-run", "start"]), {
    flags: { "dry-run": true },
    positional: ["start"],
  });
});
