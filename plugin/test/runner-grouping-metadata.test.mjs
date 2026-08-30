// @test-group engine
// runner-grouping-metadata.test.mjs — self-test for plugin/scripts/runner-grouping-metadata.mjs
// (gap-suite-metadata-query-subprocess-spawn). Pins the helper's byte-compat contract against the
// OLD grep|awk group_of it replaced, on a small temp fixture — the relationship-invariant tests
// (runner-grouping-list-groups.test.mjs) can NOT catch a per-file misclassification (a product↔engine
// swap keeps `sum == total`), so this file is the ONLY coverage that would turn a classification
// regression red. Fast + hermetic (spawns ONE node helper + a handful of grep|awk on ≤6 fixture files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const helper = join(repoRoot, "plugin", "scripts", "runner-grouping-metadata.mjs");

/** The OLD group_of (grep -m1 -oE | awk) this helper replaced — the byte-compat ground truth. */
function oldGroupOf(file) {
  const r = spawnSync(
    "bash",
    ["-c", `grep -m1 -oE '@test-group[[:space:]]+[a-z]+' "$1" 2>/dev/null | awk '{print $2}' || true`, "_", file],
    { encoding: "utf8" },
  );
  const g = r.stdout.trim();
  if (["product", "engine", "governance", "serial", "lowconc"].includes(g)) return g;
  if (g === "") return "engine";
  return `UNKNOWN:${g}`;
}

function runHelper(files) {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", helper, ...files], { encoding: "utf8" });
  return r;
}

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "rg-meta-"));
  const w = (name, body) => writeFileSync(join(dir, name), body);
  w("a-product.test.mjs", "// @test-group product\n");
  w("b-engine.test.mjs", "// @test-group engine\n");
  w("c-undeclared.test.mjs", "// no declaration\n");
  w("d-governance.test.mjs", "// @test-group governance\n");
  // Binary file: @test-group product declared AFTER a NUL byte in the first 32 KiB — GNU grep treats
  // it as binary and prints nothing to stdout, so old group_of defaulted it to engine. The helper
  // must stay byte-identical (classify engine, never its unreachable decl).
  const bin = Buffer.concat([Buffer.from("// @test-group product\n"), Buffer.alloc(33000, 0)]);
  writeFileSync(join(dir, "e-binary.test.mjs"), bin);
  // Symlink → a-product.test.mjs: realpath dedup collapses it (first-wins).
  symlinkSync(join(dir, "a-product.test.mjs"), join(dir, "f-link.test.mjs"));
  return dir;
}

test("helper output matches the old grep|awk group_of byte-for-byte (incl. dedup + binary + undeclared)", () => {
  const dir = makeFixture();
  const files = [
    join(dir, "a-product.test.mjs"),
    join(dir, "b-engine.test.mjs"),
    join(dir, "c-undeclared.test.mjs"),
    join(dir, "d-governance.test.mjs"),
    join(dir, "e-binary.test.mjs"),
    join(dir, "f-link.test.mjs"),
  ];
  const r = runHelper(files);
  assert.equal(r.status, 0, `helper exit ${r.status}\nstderr: ${r.stderr}`);

  const lines = r.stdout.trim().split("\n").filter(Boolean);
  const got = new Map(lines.map((l) => {
    const i = l.lastIndexOf("\t");
    return [l.slice(0, i), l.slice(i + 1)];
  }));

  // The symlink (f-link) and its target (a-product) collapse to ONE realpath entry.
  const realpaths = new Set([...got.keys()]);
  assert.equal(realpaths.size, 5, `expected 5 deduped files (6 glob-matched, 1 symlink collapsed), got ${realpaths.size}: ${[...realpaths]}`);
  assert.ok(![...realpaths].some((p) => p.endsWith("f-link.test.mjs")), "symlink path must not survive dedup");

  // Per-file classification == old group_of (binary + undeclared both → engine).
  for (const f of files) {
    const rp = realpathSync(f);
    const expected = oldGroupOf(f);
    assert.equal(got.get(rp), expected, `${f}: helper=${got.get(rp)} old=${expected}`);
  }
});

test("unknown @test-group is fail-closed (exit 3), never silently degraded to engine", () => {
  const dir = makeFixture();
  writeFileSync(join(dir, "z-unknown.test.mjs"), "// @test-group bogus\n");
  const r = runHelper([join(dir, "z-unknown.test.mjs")]);
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}`);
  assert.match(r.stderr, /FAIL-CLOSED/);
});

test("binary file (NUL in first 32 KiB) is classified engine even with a @test-group decl", () => {
  const dir = makeFixture();
  const r = runHelper([join(dir, "e-binary.test.mjs")]);
  assert.equal(r.status, 0);
  const line = r.stdout.trim();
  assert.ok(line.endsWith("\tengine"), `binary file must be engine: ${line}`);
});
