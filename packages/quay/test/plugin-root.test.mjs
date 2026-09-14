// @test-group product
// plugin-root resolution (tasks/gap-plugin-root-resolution-non-skill-entrypoints, SPEC §6b).
//
// The two negative controls are REQUIRED by AC4 and must actually run red when the resolver
// regresses:
//   ① worktree — the resolved plugin root must NEVER be a linked worktree's copy (AC139-4).
//      If `resolvePluginRoot` is changed to return the worktree path, the `mainCheckoutRoot`
//      unit test and the in-worktree branch of the worktree test below go red.
//   ② no-local-plugin — resolution must NOT be `path.join(process.cwd(), "plugin")`. If the
//      resolver is changed back to workspace-root join, the no-local-plugin test below goes red
//      (its temp cwd has no plugin/, so the returned dir would not contain the kernel).

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { resolvePluginRoot, resolvePluginRootFrom, resolvePluginScript, resolvePluginScriptExec, isPluginSourceCheckout, mainCheckoutRoot } from "../src/plugin-root.ts";

const KERNEL = path.join("scripts", "driver-runtime.ts");

test("resolvePluginRoot() returns the plugin root containing scripts/driver-runtime.ts", () => {
  const root = resolvePluginRoot();
  assert.ok(root, "must resolve a plugin root");
  assert.ok(
    fs.existsSync(path.join(root, KERNEL)),
    `resolved root ${root} must contain ${KERNEL}`
  );
});

test("resolvePluginScript() returns an existing absolute kernel path", () => {
  const kernel = resolvePluginScript(KERNEL);
  assert.ok(kernel, "must resolve the kernel script");
  assert.ok(path.isAbsolute(kernel), "must be absolute");
  assert.ok(fs.existsSync(kernel), `kernel must exist: ${kernel}`);
});

test("no-local-plugin negative control: resolves WITHOUT a local plugin/ copy (⛔ workspace-root join is red)", () => {
  // A workspace with a config but NO plugin/ dir — the AC168 post-contraction consumer shape.
  const noPluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-noplugin-"));
  fs.mkdirSync(path.join(noPluginDir, ".quay"));
  fs.writeFileSync(
    path.join(noPluginDir, ".quay", "config.yml"),
    "providers:\n  native:\n    enabled: true\n"
  );
  const prevCwd = process.cwd();
  process.chdir(noPluginDir);
  try {
    const root = resolvePluginRoot();
    assert.ok(root, "must resolve a plugin root even with no plugin/ in the cwd");
    assert.ok(
      fs.existsSync(path.join(root, KERNEL)),
      `resolved root ${root} must contain ${KERNEL}`
    );
    assert.notEqual(
      path.resolve(root),
      path.resolve(noPluginDir, "plugin"),
      "must NOT resolve to <cwd>/plugin (the workspace-root join that AC168 makes dead)"
    );
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(noPluginDir, { recursive: true, force: true });
  }
});

test("worktree negative control: resolution never points at a worktree copy (AC139-4)", () => {
  const root = resolvePluginRoot();
  assert.ok(root, "must resolve a plugin root");
  assert.ok(
    !/(^|\/)quay-worktrees(\/|$)/.test(root),
    `resolved plugin root must not be a quay-worktrees path: ${root}`
  );
  // When this suite runs OUT OF a linked worktree (the fan-in scoped suite), the resolver must
  // have relocated to the MAIN checkout, never the worktree it was loaded from.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const main = mainCheckoutRoot(moduleDir);
  if (main) {
    assert.ok(
      root === main || root.startsWith(main + path.sep),
      `loaded from a linked worktree → must resolve under main checkout ${main}, got ${root}`
    );
  }
});

test("resolvePluginScriptExec() returns the raw .ts with stripTypes:true (dev form)", () => {
  const r = resolvePluginScriptExec("scripts/task-status-drift-check.ts");
  assert.ok(r, "must resolve the raw .ts in the dev tree");
  assert.equal(r.stripTypes, true, "raw .ts runs with --experimental-strip-types");
  assert.ok(r.path.endsWith(path.join("scripts", "task-status-drift-check.ts")), `raw path: ${r.path}`);
});

test("resolvePluginScriptExec() falls back to the shipped dist bundle with stripTypes:false (⛔ no raw .ts ⇒ bundle)", () => {
  // A synthetic plugin root carrying ONLY the bundled dist/*.js (the shipped artifact DELETES raw
  // .ts — gap-shipped-ts-files-are-not-bundled). The env seam (QUAY_PLUGIN_ROOT) makes it hermetic;
  // if the resolver regresses to a workspace-root join it returns null here (the dist dir has no
  // raw .ts) ⇒ red.
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-dist-"));
  const distDir = path.join(fakeRoot, "scripts", "dist");
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(distDir, "task-status-drift-check.js"), "// bundled\n");
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = fakeRoot;
  try {
    const r = resolvePluginScriptExec("scripts/task-status-drift-check.ts");
    assert.ok(r, "must resolve the dist bundle when the raw .ts is absent");
    assert.equal(r.stripTypes, false, "bundled .js runs WITHOUT --experimental-strip-types");
    assert.ok(
      r.path.endsWith(path.join("scripts", "dist", "task-status-drift-check.js")),
      `bundled path: ${r.path}`
    );
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = prev;
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test("resolvePluginScriptExec() returns null when neither the raw .ts nor a dist bundle resolves", () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-empty-"));
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = fakeRoot;
  try {
    assert.equal(resolvePluginScriptExec("scripts/no-such-tool.ts"), null, "absent .ts ⇒ null (caller fails closed)");
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = prev;
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test("resolvePluginScriptExec() resolves a .sh with stripTypes:false and NO dist fallback", () => {
  // path.join (not a literal) — same AC1b rationale as observation.ts's RESOURCE_GATE_REL: a bare
  // `"scripts/…"` string literal would collide with the OLD repo-root form the scan forbids.
  const r = resolvePluginScriptExec(path.join("scripts", "resource-gate.sh"));
  assert.ok(r, "must resolve the raw .sh");
  assert.equal(r.stripTypes, false, ".sh runs via bash, never --experimental-strip-types");
  assert.ok(r.path.endsWith(path.join("scripts", "resource-gate.sh")), `sh path: ${r.path}`);
});

// ── shipped layout: raw .ts + dist/*.js COEXIST, and raw is NOT runnable there ───────────────────────
// gap-dist-plugin-missing-node-modules-task-schema-yaml. The published plugin ships BOTH forms (the
// marketplace `directory` source copies the plugin tree as-is, raw .ts included; a github/dist-plugin
// install carries the bundles), and an installed copy has NO node_modules — so a raw plugin `.ts`
// dies on its first bare npm import: measured on the real `~/.claude/plugins/cache/quay/quay/0.6.2`
// install, `quay driver start` reported `ERR_MODULE_NOT_FOUND: Cannot find package 'yaml' imported
// from <cache>/scripts/task-schema.ts` for EVERY kind (the raw kernel's 21-file closure needs `yaml`,
// `@modelcontextprotocol/sdk/*`, `zod`), while `<cache>/scripts/dist/driver-runtime.js` ran the same
// verb fine. `stripTypes` is the discriminator the callers branch on, so it is what these assert.

/** A synthetic plugin root: `<dir>/plugin/scripts/<name>.ts` + `<dir>/plugin/scripts/dist/<name>.js`.
 *  `withCoreSrc` additionally plants `<dir>/packages/quay/src` — the source-checkout marker. */
function makePluginRootFixture(withCoreSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-ship-"));
  const pluginRoot = path.join(dir, "plugin");
  fs.mkdirSync(path.join(pluginRoot, "scripts", "dist"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "scripts", "driver-runtime.ts"), 'import { parse } from "yaml";\n');
  fs.writeFileSync(path.join(pluginRoot, "scripts", "dist", "driver-runtime.js"), "// bundled\n");
  if (withCoreSrc) fs.mkdirSync(path.join(dir, "packages", "quay", "src"), { recursive: true });
  return { dir, pluginRoot };
}

function withPluginRoot(root, fn) {
  const prev = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = prev;
  }
}

test("isPluginSourceCheckout() — true only when Core source sits beside the plugin root", () => {
  const shipped = makePluginRootFixture(false);
  const source = makePluginRootFixture(true);
  try {
    assert.equal(isPluginSourceCheckout(shipped.pluginRoot), false, "no sibling packages/quay/src ⇒ shipped install");
    assert.equal(isPluginSourceCheckout(source.pluginRoot), true, "<root>/plugin beside <root>/packages/quay/src ⇒ source checkout");
    assert.equal(isPluginSourceCheckout(null), false, "unresolvable root ⇒ false");
  } finally {
    fs.rmSync(shipped.dir, { recursive: true, force: true });
    fs.rmSync(source.dir, { recursive: true, force: true });
  }
});

test("resolvePluginScriptExec() prefers the dist bundle when raw .ts and dist COEXIST outside the source checkout", () => {
  const fx = makePluginRootFixture(false);
  try {
    const r = withPluginRoot(fx.pluginRoot, () => resolvePluginScriptExec("scripts/driver-runtime.ts"));
    assert.ok(r, "must still resolve");
    assert.equal(r.stripTypes, false, "shipped install ⇒ the raw .ts cannot load its npm imports ⇒ bundle (no strip-types)");
    assert.ok(r.path.endsWith(path.join("scripts", "dist", "driver-runtime.js")), `bundle path: ${r.path}`);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("resolvePluginScriptExec() NEGATIVE CONTROL — the SAME fixture + the source-checkout marker ⇒ raw wins again", () => {
  // Only ONE thing differs from the test above (the `<root>/packages/quay/src` dir), so a pass here
  // is evidence the marker — not some other difference — flips the choice. It also pins the dev
  // behaviour the source checkout depends on (edit `plugin/scripts/*.ts` ⇒ the next spawn sees it,
  // and `driver-runtime.ts::sourceFilesMaxMtimeMs`'s source respawn has a source to watch).
  const fx = makePluginRootFixture(true);
  try {
    const r = withPluginRoot(fx.pluginRoot, () => resolvePluginScriptExec("scripts/driver-runtime.ts"));
    assert.ok(r, "must still resolve");
    assert.equal(r.stripTypes, true, "source checkout ⇒ raw .ts with --experimental-strip-types");
    assert.ok(r.path.endsWith(path.join("scripts", "driver-runtime.ts")), `raw path: ${r.path}`);
  } finally {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("resolvePluginScriptExec() falls back to the raw .ts when the shipped layout has NO bundle for it", () => {
  // A dev-only tool the build never bundles: the bundle is absent, so raw is all there is. The
  // preference must not turn a resolvable script into null (the caller would report "not found").
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-nobundle-"));
  const pluginRoot = path.join(dir, "plugin");
  fs.mkdirSync(path.join(pluginRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "scripts", "dev-only-tool.ts"), "// no bundle anywhere\n");
  try {
    const r = withPluginRoot(pluginRoot, () => resolvePluginScriptExec("scripts/dev-only-tool.ts"));
    assert.ok(r, "raw-only tool must still resolve");
    assert.equal(r.stripTypes, true);
    assert.ok(r.path.endsWith(path.join("scripts", "dev-only-tool.ts")), `raw path: ${r.path}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mainCheckoutRoot() detects inside a linked worktree, null for the main checkout", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-wt-"));
  const main = path.join(base, "main");
  const wt = path.join(base, "wt");
  const sh = (cmd) =>
    execFileSync(cmd[0], cmd.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    fs.mkdirSync(main);
    sh(["git", "init", "-q", "-b", "main", main]);
    sh(["git", "-C", main, "config", "user.email", "t@example.com"]);
    sh(["git", "-C", main, "config", "user.name", "t"]);
    fs.writeFileSync(path.join(main, "f.txt"), "x\n");
    sh(["git", "-C", main, "add", "f.txt"]);
    sh(["git", "-C", main, "commit", "-q", "-m", "init"]);
    sh(["git", "-C", main, "worktree", "add", "-q", "-b", "plugroot-wt", wt]);
    // A deep subdir of the worktree — where a loaded module actually lives.
    const sub = path.join(wt, "packages", "quay", "src");
    fs.mkdirSync(sub, { recursive: true });

    assert.equal(mainCheckoutRoot(wt), path.resolve(main), "worktree root → main checkout");
    assert.equal(
      mainCheckoutRoot(sub),
      path.resolve(main),
      "a subdir of the worktree → main checkout"
    );
    assert.equal(mainCheckoutRoot(main), null, "main checkout is not a worktree");
    assert.equal(mainCheckoutRoot(path.join(main, "sub")), null, "main checkout subdir → null");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// gap-plugin-dist-entry-derivation-blind-to-core-and-table-refs: the shipped artifact DELETES raw
// plugin .ts, so an installed package only carries the bundled `scripts/dist/driver-runtime.js`. The
// plugin-root anchor must resolve from that dist bundle too — otherwise `quay driver` dies with
// "kernel not found" in any installed project (the gap this task closes).
test("resolvePluginRootFrom() anchors on the BUNDLED dist kernel (npm-global installed layout, no raw .ts)", () => {
  const fakePkg = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-dist-anchor-pkg-"));
  try {
    const fakePlugin = path.join(fakePkg, "plugin");
    fs.mkdirSync(path.join(fakePlugin, "scripts", "dist"), { recursive: true });
    fs.writeFileSync(path.join(fakePlugin, "scripts", "dist", "driver-runtime.js"), "// bundled kernel\n");
    const startDir = path.join(fakePkg, "dist"); // bundled Core lives in <pkg>/dist
    fs.mkdirSync(startDir, { recursive: true });
    assert.equal(
      resolvePluginRootFrom(startDir),
      path.resolve(fakePlugin),
      "must anchor on the bundled dist kernel when raw .ts is absent"
    );
  } finally {
    fs.rmSync(fakePkg, { recursive: true, force: true });
  }
});

test("resolvePluginRootFrom() anchors on the dist kernel in the marketplace layout (scripts/ is direct)", () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "quay-plugroot-dist-anchor-mkt-"));
  try {
    fs.mkdirSync(path.join(fakeRoot, "scripts", "dist"), { recursive: true });
    fs.writeFileSync(path.join(fakeRoot, "scripts", "dist", "driver-runtime.js"), "// bundled kernel\n");
    assert.equal(
      resolvePluginRootFrom(fakeRoot),
      path.resolve(fakeRoot),
      "must anchor on the dist bundle where the plugin root IS the scripts' parent"
    );
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});
