// @test-group engine
// entry-guard-adoption.test.mjs — the extraction that closes routine finding `is-direct-arrow`
// (routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1793251416079`).
//
// THE FINDING. `channel-probe-server.ts` and `peer-identity-probe.ts` each carried a BYTE-IDENTICAL
// private "am I the entry point" arrow — a `const isDirect = (() => { … })()` IIFE comparing
// `path.resolve(process.argv[1])` against `path.resolve(fileURLToPath(import.meta.url))` inside a
// try/catch. The shared replacement already existed in `gate-script-base.ts` as `isDirectEntry`
// (NAME identity, `expectedBase` REQUIRED — bundler-safe); the two carriers simply had not adopted it.
//
// SCOPE — WHAT THIS FILE DOES *NOT* COVER. `plugin/scripts` still carries ~38 OTHER private entry
// guards in a one-liner spelling (`const isDirect = process.argv[1] && fileURLToPath(…)
// === path.resolve(process.argv[1])`). Those are NOT the byte-identical arrow this finding named and
// are NOT converged here; they are a separate, still-open family. This file pins the IIFE shape only,
// on purpose — a green run here must not be read as "no private entry guards remain" (硬规则 3b).
//
// WHAT THIS FILE PINS, in BOTH directions (硬规则 2 / 3b):
//   • no file in `plugin/scripts` re-declares the URL-based `const isDirect = (() => …)()` arrow;
//   • each carrier IMPORTS `isDirectEntry` from the base and CALLS it with its OWN basename (the
//     "extracted, not deleted" half — a file that drops its copy without wiring the shared guard
//     would leave `main()` dead and no link error would say so);
//   • the guard still takes both values at runtime: direct invocation runs `main()`, and importing
//     the carrier from a DIFFERENT entry script does not.
//
// The source predicate is exercised on FIXTURES first (a source carrying the private copy must read
// true, a source that delegates must read false) before it is run against the real files — a
// predicate that can only ever say "clean" proves nothing about them.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(__dirname, "..", "scripts");
const NODE_FLAGS = ["--no-warnings", "--experimental-strip-types"];

/** The duplicated arrow, recognized STRUCTURALLY: a module-level `isDirect` IIFE whose body derives
 *  identity from `import.meta.url`. Matching the shape (not the variable's spelling alone, and not
 *  the one-liner variant) is what keeps a reformatted copy of THIS arrow red without sweeping in the
 *  separate one-liner family documented in the header. */
const PRIVATE_URL_IIFE =
  /\bisDirect\s*=\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]{0,400}?fileURLToPath\(\s*import\.meta\.url\s*\)/;

/** The fixture arm of the predicate: the exact body the two carriers carried. */
const FIXTURE_PRIVATE_COPY = `
const isDirect = (() => {
  const a1 = process.argv[1];
  if (!a1) return false;
  try { return path.resolve(a1) === path.resolve(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isDirect) main();
`;

/** The fixture arm's negative: the adopted form. */
const FIXTURE_DELEGATING = `
import { isDirectEntry } from "./gate-script-base.ts";
if (isDirectEntry(import.meta, process.argv[1], "some-carrier")) main();
`;

test("the private-copy predicate takes BOTH values on fixtures (not a green-only reading)", () => {
  assert.equal(PRIVATE_URL_IIFE.test(FIXTURE_PRIVATE_COPY), true, "the arrow the finding names must read as a private guard");
  assert.equal(PRIVATE_URL_IIFE.test(FIXTURE_DELEGATING), false, "delegation to the shared guard must not read as a private guard");
  // Negative control for the SCOPE line above: the one-liner family must NOT read as this arrow,
  // otherwise this file would silently claim to cover it.
  assert.equal(
    PRIVATE_URL_IIFE.test('const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];'),
    false,
    "the one-liner family is out of scope and must not be counted here",
  );
});

test("no plugin/scripts file re-declares the URL-based isDirect arrow", () => {
  const offenders = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => /\.(?:ts|mjs|js)$/.test(f))
    .filter((f) => PRIVATE_URL_IIFE.test(fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8")));
  // Named, not merely counted — an empty count alone would not say WHICH file regressed.
  assert.deepEqual(offenders, [], `private entry-guard arrows re-declared in: ${offenders.join(", ")}`);
});

for (const [carrier, base] of [
  ["channel-probe-server.ts", "channel-probe-server"],
  ["peer-identity-probe.ts", "peer-identity-probe"],
]) {
  test(`${carrier} delegates its entry guard to the shared isDirectEntry`, () => {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, carrier), "utf8");
    assert.match(src, /from\s+["']\.\/gate-script-base\.ts["']/, `${carrier} must import from the base`);
    assert.match(src, /\bisDirectEntry\b/, `${carrier} must import the shared guard`);
    // The call carries its OWN basename — a copied guard with the wrong name would be dead code that
    // still compiles; this is the half that notices.
    assert.match(
      src,
      new RegExp(`isDirectEntry\\(\\s*import\\.meta\\s*,\\s*process\\.argv\\[1\\]\\s*,\\s*["']${base}["']\\s*\\)`),
      `${carrier} must call isDirectEntry(import.meta, process.argv[1], "${base}")`,
    );
  });
}

test("the guard still fires on direct invocation (channel-probe-server --help)", () => {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, path.join(SCRIPTS_DIR, "channel-probe-server.ts"), "--help"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage: channel-probe-server\.ts/);
});

test("the guard does NOT fire when the carrier is imported by another entry script", () => {
  // `peer-identity-probe`'s main() with no argv prints USAGE to stderr and exits 1 — so a guard that
  // wrongly fired here would make REACHED absent AND the status non-zero. Both arms are asserted.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "entry-guard-adoption-"));
  try {
    const fixture = path.join(dir, "importer.mjs");
    const carrierUrl = pathToFileURL(path.join(SCRIPTS_DIR, "peer-identity-probe.ts")).href;
    fs.writeFileSync(fixture, `await import(${JSON.stringify(carrierUrl)});\nconsole.log("REACHED");\n`);
    const r = spawnSync(process.execPath, [...NODE_FLAGS, fixture], { encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /REACHED/);
    assert.doesNotMatch(r.stderr, /usage:/, "importing the carrier must not run its CLI");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
