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
import { mkdtempSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const helper = join(repoRoot, "plugin", "scripts", "runner-grouping-metadata.mjs");

/** The OLD group_of (grep -m1 -oE | awk) this helper replaced — the byte-compat ground truth. */
function oldGroupOf(file) {
  // `-I` (== --binary-files=without-match) is NOT decoration: without it the reference is only
  // reproducible on the grep IMPLEMENTATION this test happened to be written against. Whether a
  // binary file's "Binary file <path> matches" notice reaches stdout or stderr is implementation-
  // defined, and `2>/dev/null` only hides the stderr half: on the tokyo-alpha runner (GNU grep) it
  // reaches stdout, so `awk '{print $2}'` yields `file` and the binary fixture classifies as
  // `UNKNOWN:file`, while ugrep/GNU-grep-to-stderr hosts (this repo's dev machines,
  // ubuntu-latest) yield the documented `engine`. Pinning `-I` makes the oracle state the intent
  // the fixture is built on — a binary file never contributes a declaration — on every host.
  const r = spawnSync(
    "bash",
    ["-c", `grep -I -m1 -oE '@test-group[[:space:]]+[a-z]+' "$1" 2>/dev/null | awk '{print $2}' || true`, "_", file],
    { encoding: "utf8" },
  );
  const g = r.stdout.trim();
  if (["product", "engine", "serial", "lowconc"].includes(g)) return g;
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
  // Binary file: @test-group product declared AFTER a NUL byte in the first 32 KiB — GNU grep treats
  // it as binary and prints nothing to stdout, so old group_of defaulted it to engine. The helper
  // must stay byte-identical (classify engine, never its unreachable decl).
  const bin = Buffer.concat([Buffer.from("// @test-group product\n"), Buffer.alloc(33000, 0)]);
  writeFileSync(join(dir, "e-binary.test.mjs"), bin);
  // Symlink → a-product.test.mjs: realpath dedup collapses it (first-wins).
  symlinkSync(join(dir, "a-product.test.mjs"), join(dir, "f-link.test.mjs"));
  return dir;
}

test("helper output matches the old grep|awk group_of byte-for-byte (incl. dedup + binary + undeclared)", (t) => {
  const dir = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = [
    join(dir, "a-product.test.mjs"),
    join(dir, "b-engine.test.mjs"),
    join(dir, "c-undeclared.test.mjs"),
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
  assert.equal(realpaths.size, 4, `expected 4 deduped files (5 glob-matched, 1 symlink collapsed), got ${realpaths.size}: ${[...realpaths]}`);
  assert.ok(![...realpaths].some((p) => p.endsWith("f-link.test.mjs")), "symlink path must not survive dedup");

  // Per-file classification == old group_of (binary + undeclared both → engine).
  for (const f of files) {
    const rp = realpathSync(f);
    const expected = oldGroupOf(f);
    assert.equal(got.get(rp), expected, `${f}: helper=${got.get(rp)} old=${expected}`);
  }
});

test("unknown @test-group is fail-closed (exit 3), never silently degraded to engine", (t) => {
  const dir = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "z-unknown.test.mjs"), "// @test-group bogus\n");
  const r = runHelper([join(dir, "z-unknown.test.mjs")]);
  assert.equal(r.status, 3, `expected exit 3, got ${r.status}`);
  assert.match(r.stderr, /FAIL-CLOSED/);
});

test("binary file (NUL in first 32 KiB) is classified engine even with a @test-group decl", (t) => {
  const dir = makeFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = runHelper([join(dir, "e-binary.test.mjs")]);
  assert.equal(r.status, 0);
  const line = r.stdout.trim();
  assert.ok(line.endsWith("\tengine"), `binary file must be engine: ${line}`);
});

// ── gap-load-sensitive-tests-undeclared-run-in-main-lane-block-fan-in ─────────────────────────
// AC1（由分组机制的输出证明，⛔ 不读文件字符串——硬规则②按位置判定）：三个负载敏感文件必须被
// scripts/test.sh 的分组读取路径（runner-grouping-metadata.mjs = build_deduped_files 的分类器）
// 实际路由到 lowconc。能取假：把任一文件头改回 product/engine ⇒ 本断言立即变红（AC3 隔离对照）。
// ⛔ 注意 observation.test.mjs：它曾含 8 个 NUL 字节（fake /proc cmdline fixture），使 GNU grep 的
// binary 检测把它恒分类为 engine——只改泳道声明不够，须同时把 NUL 换成 \x00 转义（运行时字符串
// 不变），否则本断言恒红。本断言同时钉住这一点。

const LOAD_SENSITIVE_FILES = [
  "plugin/test/worker-driver-resident.test.mjs",
  "packages/quay/test/observation.test.mjs",
  "packages/quay/test/ts-typecheck-gate-config-wiring.test.mjs",
];

test("gap-load-sensitive-tests — AC1: the three load-sensitive files route to lowconc via the grouping read path (⛔ not by reading the file string)", () => {
  const files = LOAD_SENSITIVE_FILES.map((f) => join(repoRoot, f));
  const r = runHelper(files);
  assert.equal(r.status, 0, `helper exit ${r.status}\nstderr: ${r.stderr}`);
  const got = new Map(r.stdout.trim().split("\n").filter(Boolean).map((l) => {
    const i = l.lastIndexOf("\t");
    return [l.slice(0, i), l.slice(i + 1)];
  }));
  for (const f of files) {
    assert.equal(got.get(realpathSync(f)), "lowconc", `${f}: grouped ${got.get(realpathSync(f))}, expected lowconc`);
  }
});
