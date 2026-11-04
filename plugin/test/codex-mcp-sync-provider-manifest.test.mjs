// @test-group product
// codex-mcp-sync-provider-manifest.test.mjs — gap-codex-mcp-sync-omits-provider-yml-stable-install:
// the stable install (`~/.local/share/quay`) must carry `vendor/quay-native/provider.yml` alongside the
// native bundle, and "not installed" must never be indistinguishable from "installed" (硬规则 3b).
//
// The defect: `codex-mcp-sync.sh` copied the Core + Native bundles and the kernel anchor but NEVER
// copied `vendor/quay-native/provider.yml`, and its fail-closed precheck never looked at it. The native
// bundle resolves the manifest relative to its own location
// (`packages/quay-native/src/manifest.ts` DEFAULT_MANIFEST_PATH = `path.join(__dirname, "..",
// "provider.yml")`), so the stable install would ENOENT on `provider://manifest`. The fix adds the
// manifest to the precheck + copy, and adds a falsifiable end-of-install assertion (also exposed as
// `--verify-install` so an existing install can re-check itself without re-copying).
//
// This test exercises the REAL script (no re-implementation of its predicates) on a synthetic dist
// root + a synthetic $HOME, exactly the three arms the AC names: normal install / missing-source
// fail-closed / post-install-unreadable fail-closed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeTmpDir } from "./helpers/tmp-workspace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const SYNC = path.join(pluginDir, "scripts", "codex-mcp-sync.sh");

const MANIFEST_BODY = [
  "name: quay-native",
  "displayName: quay native provider",
  "version: 0.0.0",
  "",
].join("\n");

/** A synthetic dist root in the exact shape --dist-root expects: the two bundles, the manifest, and
 *  the bundled kernel anchor. Returns { distRoot, manifestSrc }. */
function makeDistRoot(root, { withManifest = true } = {}) {
  const distRoot = path.join(root, "dist");
  fs.mkdirSync(path.join(distRoot, "vendor", "quay", "dist"), { recursive: true });
  fs.mkdirSync(path.join(distRoot, "vendor", "quay-native", "dist"), { recursive: true });
  fs.mkdirSync(path.join(distRoot, "scripts", "dist"), { recursive: true });
  fs.writeFileSync(path.join(distRoot, "vendor", "quay", "dist", "quay.js"), "// core bundle\n");
  fs.writeFileSync(path.join(distRoot, "vendor", "quay-native", "dist", "quay-native.js"), "// native bundle\n");
  fs.writeFileSync(path.join(distRoot, "scripts", "dist", "driver-runtime.js"), "// kernel anchor\n");
  const manifestSrc = path.join(distRoot, "vendor", "quay-native", "provider.yml");
  if (withManifest) fs.writeFileSync(manifestSrc, MANIFEST_BODY);
  return { distRoot, manifestSrc };
}

function runSync(args, { home, distRoot }) {
  const env = { ...process.env, HOME: home };
  return spawnSync("bash", [SYNC, ...args, "--dist-root", distRoot], { encoding: "utf8", env });
}

test("normal install lays down provider.yml byte-identical to the source", () => {
  const root = makeTmpDir("codex-sync-manifest-");
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const { distRoot, manifestSrc } = makeDistRoot(root);

  const res = runSync(["--install-only"], { home, distRoot });
  assert.equal(res.status, 0, `install must succeed:\n${res.stdout}\n${res.stderr}`);

  const manifestDest = path.join(home, ".local", "share", "quay", "vendor", "quay-native", "provider.yml");
  assert.ok(fs.existsSync(manifestDest), `installed manifest must exist: ${manifestDest}`);
  const cmp = spawnSync("cmp", ["-s", manifestSrc, manifestDest], { encoding: "utf8" });
  assert.equal(cmp.status, 0, `installed manifest must be byte-identical to the source:\n${cmp.stderr}`);
});

test("missing source provider.yml is refused fail-closed, naming the literal path", () => {
  const root = makeTmpDir("codex-sync-manifest-");
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const { distRoot, manifestSrc } = makeDistRoot(root, { withManifest: false });

  const res = runSync(["--install-only"], { home, distRoot });
  assert.notEqual(res.status, 0, `install from a manifest-less tree must exit non-zero:\n${res.stdout}\n${res.stderr}`);
  assert.ok(
    res.stderr.includes(manifestSrc),
    `stderr must name the literal missing path ${manifestSrc} (got: ${res.stderr})`,
  );
});

test("the end-of-install manifest assertion is falsifiable: --verify-install reds on a deleted/emptied manifest", () => {
  for (const mode of ["delete", "empty"]) {
    const root = makeTmpDir(`codex-sync-manifest-${mode}-`);
    const home = path.join(root, "home");
    fs.mkdirSync(home, { recursive: true });
    const { distRoot } = makeDistRoot(root);
    const manifestDest = path.join(home, ".local", "share", "quay", "vendor", "quay-native", "provider.yml");

    const install = runSync(["--install-only"], { home, distRoot });
    assert.equal(install.status, 0, `install must succeed before tampering (${mode}):\n${install.stdout}\n${install.stderr}`);

    // Positive control: the assertion must pass on a genuinely-readable manifest, or a later red is vacuous.
    const ok = runSync(["--verify-install"], { home, distRoot });
    assert.equal(ok.status, 0, `--verify-install must pass on a readable manifest (${mode}):\n${ok.stdout}\n${ok.stderr}`);

    if (mode === "delete") {
      fs.rmSync(manifestDest, { force: true });
    } else {
      fs.writeFileSync(manifestDest, "");
    }

    const red = runSync(["--verify-install"], { home, distRoot });
    assert.notEqual(red.status, 0, `--verify-install must red on a ${mode}d manifest:\n${red.stdout}\n${red.stderr}`);
  }
});
